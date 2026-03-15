
import { ChangeDetectionStrategy, Component, computed, inject, signal, ViewChild, ElementRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ReactiveFormsModule, FormBuilder, FormGroup, Validators, FormsModule } from '@angular/forms';
import { DataService } from '../../services/data.service';
import { PrintService } from '../../services/print.service';
import { PurchaseOrder, Product, Supplier, CommunicationTemplate } from '../../models/erp.models';
import { ResizableDirective } from '../../directives/resizable.directive';
import { DateUtils } from '../../utils/date.utils';
import { TaiwanDatePipe } from '../../pipes/taiwan-date.pipe';
import { DomSanitizer, SafeResourceUrl } from '@angular/platform-browser';

type PurchaseStep = 'list' | 'select-supplier' | 'select-products' | 'cart-adjust' | 'review' | 'generate-text' | 'ai-wizard';

interface CartItem {
  product: Product;
  quantity: number;
  receivedQuantity: number; 
}

interface DisplayItem {
  purchaseId: string;
  name: string;
  quantity: number;
  unit: string;
  receivedQuantity: number;
  status: { label: string, class: string };
  currentProductTransit: number;
  transitContent: number; // Specific transit qty for this item based on status rules
}

interface GroupedPurchaseOrder {
  poNumber: string;
  purchaseDate: string;
  supplierName: string;
  supplierCode: string;
  supplierTaxType: string;
  supplierInvoiceRule: string;
  supplierLineId?: string; // Added: Supplier LINE ID
  status: string;
  expectedDelivery: string;
  items: PurchaseOrder[];
  totalQty: number;
  totalItems: number;
  displayItems: DisplayItem[];
  purchaser: string;
  isOverdue: boolean;
  purchaseNote: string;
  invoiceStatus: boolean;
  purchaseAuth: string;
}

// --- AI Suggestion Interfaces ---
interface AiSuggestionItem {
  product: Product;
  virtualStock: number; // Stock + Transit - Demand
  demandQty: number;
  transitQty: number;
  shortage: number; // How much below safety stock
  score: number;
  scoreReason: string[];
  suggestedQty: number; // Rounded by package type
  isSelected: boolean;
}

interface AiSupplierGroup {
  supplier: Supplier;
  items: AiSuggestionItem[];
  totalSuggestedQty: number;
  meetsThreshold: boolean;
}

@Component({
  selector: 'app-purchases',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CommonModule, ReactiveFormsModule, FormsModule, ResizableDirective, TaiwanDatePipe],
  templateUrl: './purchases.component.html'
})
export class PurchasesComponent {
  private dataService = inject(DataService);
  private printService = inject(PrintService);
  private sanitizer = inject(DomSanitizer);
  private fb = inject(FormBuilder);

  @ViewChild('previewFrame') previewFrame!: ElementRef<HTMLIFrameElement>;

  // Data Signals
  purchaseOrders = this.dataService.purchaseOrders;
  orders = this.dataService.orders;
  suppliers = this.dataService.suppliers;
  products = this.dataService.products;
  communicationTemplates = this.dataService.communicationTemplates;
  companies = this.dataService.companies;

  // View State
  currentStep = signal<PurchaseStep>('list');
  searchTerm = signal('');
  statusFilter = signal('ACTION_REQUIRED'); 
  supplierCodeFilter = signal('');
  
  // Tooltip State
  noteTooltip = signal<{ text: string, x: number, y: number } | null>(null);

  // Note Modal State
  editingNotePoNumber = signal<string | null>(null);
  editingNoteText = signal('');

  // Wizard State
  wizardSearchTerm = signal('');
  selectedSupplier = signal<Supplier | null>(null);
  cart = signal<CartItem[]>([]);
  
  // Print Preview State
  showPrintPreview = signal(false);
  previewHtmlSrc = signal<SafeResourceUrl | null>(null);
  
  // --- AI Wizard State ---
  aiTargetSupplierCode = signal<string>('all'); 
  
  // Revised: Split Analysis Result
  aiAnalysisResult = signal<{
      recommended: AiSupplierGroup[],
      safe: AiSupplierGroup[]
  }>({ recommended: [], safe: [] });

  isAiCalculating = signal(false);
  isGenerating = signal(false); // New: Generation Loading State

  // Text Generation State
  generatedText = signal('');
  purchaseTemplates = computed(() => this.communicationTemplates().filter(t => t.type === 'purchase'));
  
  categorizedTemplates = computed(() => {
    const templates = this.purchaseTemplates();
    const groups = [
      {
        id: 'instant',
        title: '即時通訊 (LINE / 簡訊)',
        iconPath: 'M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z',
        colorClass: 'text-green-600 bg-green-50 border-green-200 hover:bg-green-100 hover:border-green-300 dark:bg-green-900/20 dark:text-green-400 dark:border-green-800 dark:hover:bg-green-900/40',
        activeClass: 'ring-2 ring-green-500 bg-green-100 dark:bg-green-900/60',
        items: [] as CommunicationTemplate[]
      },
      {
        id: 'email',
        title: '正式郵件 (Email)',
        iconPath: 'M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z',
        colorClass: 'text-blue-600 bg-blue-50 border-blue-200 hover:bg-blue-100 hover:border-blue-300 dark:bg-blue-900/20 dark:text-blue-400 dark:border-blue-800 dark:hover:bg-blue-900/40',
        activeClass: 'ring-2 ring-blue-500 bg-blue-100 dark:bg-blue-900/60',
        items: [] as CommunicationTemplate[]
      },
      {
        id: 'other',
        title: '其他格式',
        iconPath: 'M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z',
        colorClass: 'text-slate-600 bg-slate-50 border-slate-200 hover:bg-slate-100 hover:border-slate-300 dark:bg-slate-800 dark:text-slate-400 dark:border-slate-600 dark:hover:bg-slate-700',
        activeClass: 'ring-2 ring-slate-500 bg-slate-200 dark:bg-slate-700',
        items: [] as CommunicationTemplate[]
      }
    ];

    templates.forEach(t => {
      const n = t.name.toLowerCase();
      if (n.includes('line') || n.includes('簡訊') || n.includes('簡易')) {
        groups[0].items.push(t);
      } else if (n.includes('郵件') || n.includes('信') || n.includes('email') || n.includes('正式')) {
        groups[1].items.push(t);
      } else {
        groups[2].items.push(t);
      }
    });

    return groups.filter(g => g.items.length > 0);
  });

  selectedTemplateId = signal('');
  editingPoNumber = signal<string | null>(null);
  tempPoNumber = signal<string | null>(null); // New PO Number for creation flow
  
  poHeaderForm!: FormGroup;

  readonly logisticsOptions = ['黑貓', '大榮'];

  readonly statusOptions = [
    'AI建議', '員工確認', '審核通過(要下單)', '已下訂', '廠商確認', '部份到貨', '已結案', '取消'
  ];

  constructor() {
    this.initHeaderForm();
  }

  // --- Printing Logic ---
  openPrintPreview(group: GroupedPurchaseOrder) {
      // Find default company profile (usually first one or matching settings)
      const companyName = this.dataService.systemSettings().companyName;
      const company = this.companies().find(c => c.name === companyName) || this.companies()[0];
      
      const htmlContent = this.printService.generatePurchaseHtml(group, company);
      
      if (!htmlContent) return;

      const blob = new Blob([htmlContent], { type: 'text/html' });
      const url = URL.createObjectURL(blob);
      this.previewHtmlSrc.set(this.sanitizer.bypassSecurityTrustResourceUrl(url));
      this.showPrintPreview.set(true);
  }

  closePrintPreview() {
      this.showPrintPreview.set(false);
      this.previewHtmlSrc.set(null);
  }

  confirmPrint() {
      if (this.previewFrame && this.previewFrame.nativeElement.contentWindow) {
          this.previewFrame.nativeElement.contentWindow.print();
      }
  }

  printPurchaseOrder(group: GroupedPurchaseOrder) {
      this.openPrintPreview(group);
  }

  // --- AI Logic ---

  openAiWizard() {
      this.currentStep.set('ai-wizard');
      this.aiTargetSupplierCode.set('all');
      this.aiAnalysisResult.set({ recommended: [], safe: [] });
      this.isAiCalculating.set(false);
      this.isGenerating.set(false);
  }

  async runAiAnalysis() {
      this.isAiCalculating.set(true);
      // Simulate "Thinking" time for UX
      await new Promise(resolve => setTimeout(resolve, 800));

      const targetSupplier = this.aiTargetSupplierCode();
      const allProducts = this.products();
      const allOrders = this.orders();
      const allPOs = this.purchaseOrders();
      const allSuppliers = this.suppliers();

      // 1. Calculate Demand & Transit per Product
      const demandMap = new Map<string, number>();
      const transitMap = new Map<string, number>();

      // Demand: Sales Orders
      allOrders.forEach(o => {
          if (o.status !== '取消' && o.status !== '已結案' && o.status !== '已出貨') {
              const outstanding = Math.max(0, (o.quantity || 0) - (o.shippedQuantity || 0));
              if (outstanding > 0) {
                  demandMap.set(o.productId, (demandMap.get(o.productId) || 0) + outstanding);
              }
          }
      });

      // Transit: Purchase Orders
      allPOs.forEach(po => {
          // Strict Transit Definition: Only '廠商確認' or '部份到貨'
          // Exclude '已下訂', '員工確認', etc.
          const activeStatuses = ['廠商確認', '部份到貨'];
          if (activeStatuses.includes(po.status)) {
              const pending = Math.max(0, po.quantity - (po.receivedQuantity || 0));
              if (pending > 0) {
                  transitMap.set(po.productId, (transitMap.get(po.productId) || 0) + pending);
              }
          }
      });

      // 2. Evaluate Products
      const recommendedItems: AiSuggestionItem[] = [];
      const safeItems: AiSuggestionItem[] = [];

      allProducts.forEach(p => {
          // Filter by Supplier if selected
          if (targetSupplier !== 'all' && p.supplierCode !== targetSupplier) return;
          // Filter: Must be active and purchasing
          if (p.isDiscontinued || !p.purchasingStatus) return;

          const stock = p.stock || 0;
          const transit = transitMap.get(p.id) || 0;
          const demand = demandMap.get(p.id) || 0;
          const safety = p.safetyStock || 0;

          // ★★★ Virtual Stock Formula ★★★
          const virtualStock = stock + transit - demand;
          const deficit = safety - virtualStock;
          
          let score = 0;
          const reasons: string[] = [];
          let suggestedQty = 0;
          let isSelected = false;

          // Category 1: Urgent (Deficit > 0)
          if (deficit > 0) {
              if (virtualStock <= 0) {
                  score += 50;
                  reasons.push(`庫存耗盡 (${virtualStock})`);
              } else {
                  score += 20;
                  reasons.push(`低於安全水位 (${safety})`);
              }

              if (p.keyProduct === 'A') { score += 10; reasons.push('A級重點'); }
              else if (p.keyProduct === 'B') { score += 5; reasons.push('B級'); }
              
              // Calc Qty
              const pkg = p.packageType || 1;
              suggestedQty = Math.ceil(deficit / pkg) * pkg;
              if (suggestedQty < pkg) suggestedQty = pkg;
              isSelected = true;

              recommendedItems.push({
                  product: p, virtualStock, demandQty: demand, transitQty: transit, shortage: deficit,
                  score, scoreReason: reasons, suggestedQty, isSelected
              });

          } else {
              // Category 2: Safe
              reasons.push('庫存充足');
              safeItems.push({
                  product: p, virtualStock, demandQty: demand, transitQty: transit, shortage: 0,
                  score: 0, scoreReason: reasons, suggestedQty: 0, isSelected: false
              });
          }
      });

      // 3. Helper to Group Items
      const groupItems = (items: AiSuggestionItem[]): AiSupplierGroup[] => {
          const supplierMap = new Map<string, AiSuggestionItem[]>();
          items.forEach(item => {
              const sCode = item.product.supplierCode;
              if (!supplierMap.has(sCode)) supplierMap.set(sCode, []);
              supplierMap.get(sCode)!.push(item);
          });

          const groups: AiSupplierGroup[] = [];
          supplierMap.forEach((grpItems, code) => {
              const supplier = allSuppliers.find(s => s.code === code);
              if (supplier) {
                  grpItems.sort((a, b) => b.score - a.score);
                  const totalQty = grpItems.reduce((sum, i) => sum + i.suggestedQty, 0);
                  groups.push({
                      supplier,
                      items: grpItems,
                      totalSuggestedQty: totalQty,
                      meetsThreshold: totalQty >= (supplier.freeShippingThreshold || 0)
                  });
              }
          });
          return groups.sort((a, b) => a.supplier.code.localeCompare(b.supplier.code));
      };

      this.aiAnalysisResult.set({
          recommended: groupItems(recommendedItems),
          safe: groupItems(safeItems)
      });
      
      this.isAiCalculating.set(false);
  }

  toggleAiItemSelection(type: 'recommended' | 'safe', groupIndex: number, itemIndex: number) {
      this.aiAnalysisResult.update(current => {
          const newResult = { ...current };
          const targetGroups = type === 'recommended' ? [...newResult.recommended] : [...newResult.safe];
          
          if (!targetGroups[groupIndex]) return current;

          const group = { ...targetGroups[groupIndex] };
          const items = [...group.items];
          const item = { ...items[itemIndex] };
          
          item.isSelected = !item.isSelected;
          // If selected and qty is 0, define default qty (e.g. MOQ)
          if (item.isSelected && item.suggestedQty === 0) {
              item.suggestedQty = item.product.packageType || 1;
          }

          items[itemIndex] = item;
          
          // Re-calc totals
          const totalQty = items.filter(i => i.isSelected).reduce((sum, i) => sum + i.suggestedQty, 0);
          group.items = items;
          group.totalSuggestedQty = totalQty;
          group.meetsThreshold = totalQty >= (group.supplier.freeShippingThreshold || 0);
          
          targetGroups[groupIndex] = group;
          
          if (type === 'recommended') newResult.recommended = targetGroups;
          else newResult.safe = targetGroups;
          
          return newResult;
      });
  }

  updateAiItemQty(type: 'recommended' | 'safe', groupIndex: number, itemIndex: number, event: Event) {
      const val = parseInt((event.target as HTMLInputElement).value, 10);
      if (isNaN(val) || val < 0) return;

      this.aiAnalysisResult.update(current => {
          const newResult = { ...current };
          const targetGroups = type === 'recommended' ? [...newResult.recommended] : [...newResult.safe];
          
          if (!targetGroups[groupIndex]) return current;

          const group = { ...targetGroups[groupIndex] };
          const items = [...group.items];
          const item = { ...items[itemIndex] };
          
          item.suggestedQty = val;
          // Auto select if Qty > 0, unselect if Qty is 0
          item.isSelected = val > 0;
          
          items[itemIndex] = item;
          
          const totalQty = items.filter(i => i.isSelected).reduce((sum, i) => sum + i.suggestedQty, 0);
          
          group.items = items;
          group.totalSuggestedQty = totalQty;
          group.meetsThreshold = totalQty >= (group.supplier.freeShippingThreshold || 0);
          
          targetGroups[groupIndex] = group;
          
          if (type === 'recommended') newResult.recommended = targetGroups;
          else newResult.safe = targetGroups;
          
          return newResult;
      });
  }

  async confirmAiGeneration() {
      // Prevent double submission
      if (this.isGenerating()) return;
      
      this.isGenerating.set(true);

      // Simulate network/processing delay for visual feedback (UX)
      await new Promise(resolve => setTimeout(resolve, 800));

      try {
          const { recommended, safe } = this.aiAnalysisResult();
          const allGroups = [...recommended, ...safe]; // Merge logic for generation
          
          const mergedMap = new Map<string, { supplier: Supplier, items: AiSuggestionItem[] }>();

          allGroups.forEach(group => {
              const sCode = group.supplier.code;
              if (!mergedMap.has(sCode)) {
                  mergedMap.set(sCode, { supplier: group.supplier, items: [] });
              }
              const entry = mergedMap.get(sCode)!;
              // Add only selected items with Qty > 0
              const selected = group.items.filter(i => i.isSelected && i.suggestedQty > 0);
              entry.items.push(...selected);
          });

          const todayDash = new Date().toISOString().split('T')[0];
          const dateCompact = todayDash.replace(/-/g, '');
          const prefix = `PO-${dateCompact}-`;
          
          // Calculate start sequence
          const existingOrders = this.dataService.purchaseOrders();
          let maxSeq = 0;
          existingOrders.forEach(po => {
              const poNum = po.poNumber || po.purchaseId;
              if (poNum && poNum.startsWith(prefix)) {
                  const suffix = poNum.slice(prefix.length); 
                  const seq = parseInt(suffix, 10);
                  if (!isNaN(seq) && seq > maxSeq) maxSeq = seq;
              }
          });

          const newPos: PurchaseOrder[] = [];
          let generatedCount = 0;

          for (const [code, data] of mergedMap.entries()) {
              if (data.items.length === 0) continue;

              maxSeq++;
              const poNumber = `${prefix}${maxSeq.toString().padStart(3, '0')}`;
              
              // Build detailed AI note
              const logicSummary = data.items.map(i => `${i.product.name}: ${i.scoreReason.join(', ')} (建議:${i.suggestedQty})`).join('\n');
              const aiNote = `[AI自動建議]\n${logicSummary}`;

              data.items.forEach((item, idx) => {
                  const suffix = (idx + 1).toString().padStart(2, '0');
                  newPos.push({
                      purchaseId: `${poNumber}-${suffix}`,
                      poNumber: poNumber,
                      productId: item.product.id,
                      quantity: item.suggestedQty,
                      receivedQuantity: 0,
                      purchaseDate: todayDash,
                      status: 'AI建議',
                      supplierCode: data.supplier.code,
                      supplierName: data.supplier.shortName,
                      purchaser: 'AI Agent',
                      expectedShippingDate: '',
                      expectedDeliveryDate: '',
                      purchaseNote: aiNote,
                      isOrdered: false,
                      shipLogistics: data.supplier.shipLogistics,
                      invoiceStatus: false,
                      purchaseAuth: 'AI 生成'
                  });
              });
              generatedCount++;
          }

          if (newPos.length > 0) {
              await Promise.all(newPos.map(po => this.dataService.addPurchaseOrder(po)));
              alert(`成功生成 ${generatedCount} 張採購單，共包含 ${newPos.length} 個品項。`);
              this.currentStep.set('list');
              this.statusFilter.set('AI建議'); 
          } else {
              alert('未選擇任何商品，無生成採購單。');
          }
      } catch (e) {
          console.error(e);
          alert('採購單生成失敗，請稍後再試。');
      } finally {
          this.isGenerating.set(false);
      }
  }

  // --- List View Computed ---
  groupedPurchaseOrders = computed(() => {
    const term = this.searchTerm().toLowerCase();
    const sFilter = this.statusFilter();
    const supFilter = this.supplierCodeFilter(); 
    
    const rawOrders = this.purchaseOrders();
    const suppliersList = this.suppliers();

    const groups: Record<string, GroupedPurchaseOrder> = {};

    rawOrders.forEach(po => {
        const groupKey = po.poNumber || po.purchaseId;
        
        if (!groups[groupKey]) {
            const supplier = suppliersList.find(s => s.code === po.supplierCode);
            const displayTaxType = supplier ? (supplier.taxType ? '應稅' : '免稅') : '應稅';
            const displayInvoiceRule = supplier ? (supplier.invoiceRule ? '是 (隨貨)' : '否 (另寄)') : '是 (隨貨)';

            groups[groupKey] = {
                poNumber: groupKey,
                purchaseDate: po.purchaseDate,
                supplierName: po.supplierName,
                supplierCode: po.supplierCode,
                supplierTaxType: displayTaxType,
                supplierInvoiceRule: displayInvoiceRule,
                supplierLineId: supplier ? supplier.lineId : '', // Added: Populate supplier LINE ID
                status: po.status,
                expectedDelivery: po.expectedDeliveryDate,
                items: [],
                totalQty: 0,
                totalItems: 0,
                displayItems: [],
                purchaser: po.purchaser || 'Admin',
                isOverdue: false,
                purchaseNote: po.purchaseNote || '',
                invoiceStatus: po.invoiceStatus,
                purchaseAuth: po.purchaseAuth || '員工確認'
            };
        }
        
        const currentGroup = groups[groupKey];
        currentGroup.items.push(po);
        currentGroup.totalQty += po.quantity;
        
        // Add to Display Items (All items in PO)
        const product = this.products().find(p => p.id === po.productId);
        
        // Calculate Transit Qty for this specific product across ALL orders
        // STRICT RULE: Only '廠商確認' or '部份到貨' counts as In Transit
        const productTransit = this.purchaseOrders()
            .filter(p => p.productId === po.productId && 
                   ['廠商確認', '部份到貨'].includes(p.status)) 
            .reduce((sum, p) => sum + Math.max(0, p.quantity - (p.receivedQuantity||0)), 0);

        // Logic for "In Transit" column display for THIS item
        // Rule: Only '廠商確認' or '部份到貨' contributes to transit
        let itemTransit = 0;
        if (po.status === '廠商確認' || po.status === '部份到貨') {
            itemTransit = Math.max(0, po.quantity - (po.receivedQuantity || 0));
        }

        currentGroup.displayItems.push({
            purchaseId: po.purchaseId,
            name: product ? product.name : po.productId,
            quantity: po.quantity,
            unit: product ? product.unit : '個',
            receivedQuantity: po.receivedQuantity || 0,
            status: this.getItemStatus(po),
            currentProductTransit: productTransit,
            transitContent: itemTransit // Assign calculated value based on status
        });
    });

    let groupedList = Object.values(groups);
    
    // Sort by Date Descending
    groupedList.sort((a, b) => b.poNumber.localeCompare(a.poNumber));

    // Overdue Check
    const today = new Date();
    today.setHours(0,0,0,0);
    groupedList.forEach(g => {
        g.totalItems = g.items.length;
        if (g.expectedDelivery) {
            const deliveryDate = new Date(g.expectedDelivery);
            if (deliveryDate < today && g.status !== '已結案' && g.status !== '取消') {
                g.isOverdue = true;
            }
        }
    });

    // Filters
    if (term) {
        groupedList = groupedList.filter(g => 
            g.poNumber.toLowerCase().includes(term) ||
            g.supplierName.toLowerCase().includes(term) ||
            g.supplierCode.toLowerCase().includes(term) ||
            g.displayItems.some(i => i.name.toLowerCase().includes(term))
        );
    }

    if (supFilter) {
        groupedList = groupedList.filter(g => g.supplierCode === supFilter);
    }

    if (sFilter === 'ACTION_REQUIRED') {
        const actionable = ['AI建議', '員工確認', '審核通過(要下單)', '已下訂', '廠商確認', '部份到貨'];
        groupedList = groupedList.filter(g => actionable.includes(g.status));
    } else if (sFilter) {
        groupedList = groupedList.filter(g => g.status === sFilter);
    }

    return groupedList;
  });

  // --- Wizard Logic (Manual) ---
  startCreateProcess() {
      this.currentStep.set('select-supplier');
      this.resetWizard();
  }

  resetWizard() {
      this.selectedSupplier.set(null);
      this.cart.set([]);
      this.wizardSearchTerm.set('');
      this.editingPoNumber.set(null);
      this.tempPoNumber.set(null); // Reset Temp Number
      this.generatedText.set('');
      this.initHeaderForm();
  }

  selectSupplier(supplier: Supplier) {
      this.selectedSupplier.set(supplier);
      this.currentStep.set('select-products');
      this.wizardSearchTerm.set('');
      this.poHeaderForm.patchValue({ 
          logistics: supplier.shipLogistics 
      });
  }

  // --- Basic Helpers ---
  getItemStatus(po: PurchaseOrder): { label: string, class: string } {
      if (po.receivedQuantity >= po.quantity && po.quantity > 0) return { label: '全到', class: 'bg-green-100 text-green-800' };
      if (po.receivedQuantity > 0) return { label: '部份', class: 'bg-yellow-100 text-yellow-800' };
      return { label: '未到', class: 'bg-slate-100 text-slate-500' };
  }

  toggleActionRequiredFilter() {
      if (this.statusFilter() === 'ACTION_REQUIRED') {
          this.statusFilter.set('');
      } else {
          this.statusFilter.set('ACTION_REQUIRED');
      }
  }

  // --- Event Handlers ---
  onSearchTermChange(event: Event) { this.searchTerm.set((event.target as HTMLInputElement).value); }
  onStatusFilterChange(event: Event) { this.statusFilter.set((event.target as HTMLSelectElement).value); }
  onListSupplierFilterChange(event: Event) { this.supplierCodeFilter.set((event.target as HTMLSelectElement).value); }
  
  onWizardSearchChange(event: Event) { this.wizardSearchTerm.set((event.target as HTMLInputElement).value); }
  
  // --- Cart Logic (Manual Wizard) ---
  wizardFilteredSuppliers = computed(() => {
      const term = this.wizardSearchTerm().toLowerCase();
      if (!term) return this.suppliers();
      return this.suppliers().filter(s => 
          s.shortName.toLowerCase().includes(term) || 
          s.code.toLowerCase().includes(term) ||
          s.taxId.includes(term)
      );
  });

  wizardFilteredProducts = computed(() => {
      const term = this.wizardSearchTerm().toLowerCase();
      const sup = this.selectedSupplier();
      if (!sup) return [];
      
      return this.products().filter(p => {
          const matchSup = p.supplierCode === sup.code;
          const matchTerm = !term || p.name.toLowerCase().includes(term) || p.id.toLowerCase().includes(term);
          return matchSup && matchTerm && !p.isDiscontinued && p.purchasingStatus;
      });
  });

  getCartItem(productId: string) { return this.cart().find(i => i.product.id === productId); }
  
  addToCart(product: Product) {
      this.cart.update(items => [...items, { product, quantity: 1, receivedQuantity: 0 }]);
  }
  
  updateCartQty(productId: string, delta: number) {
      this.cart.update(items => {
          return items.map(item => {
              if (item.product.id === productId) {
                  const newQty = item.quantity + delta;
                  return newQty > 0 ? { ...item, quantity: newQty } : null;
              }
              return item;
          }).filter(Boolean) as CartItem[];
      });
  }
  
  onQtyInput(productId: string, event: Event) {
      const val = parseInt((event.target as HTMLInputElement).value, 10);
      if (isNaN(val) || val <= 0) return;
      this.cart.update(items => items.map(i => i.product.id === productId ? { ...i, quantity: val } : i));
  }

  removeFromCart(productId: string) {
      this.cart.update(items => items.filter(i => i.product.id !== productId));
  }

  cartTotal = computed(() => {
      return this.cart().reduce((sum, item) => sum + (item.product.costBeforeTax * item.quantity), 0);
  });

  goToCartAdjust() { this.currentStep.set('cart-adjust'); }
  goToReview() { this.currentStep.set('review'); }
  
  goBack() {
      if (this.currentStep() === 'select-products') this.currentStep.set('select-supplier');
      else if (this.currentStep() === 'cart-adjust') this.currentStep.set('select-products');
      else if (this.currentStep() === 'review') this.currentStep.set('cart-adjust');
      else if (this.currentStep() === 'generate-text') this.currentStep.set('review');
      else if (this.currentStep() === 'ai-wizard') this.currentStep.set('list');
  }

  cancelProcess() {
      if (confirm('確定要取消嗎？所有進度將遺失。')) {
          this.currentStep.set('list');
          this.resetWizard();
      }
  }

  // --- List Updates ---
  updatePoStatus(poNumber: string, event: Event) {
      const status = (event.target as HTMLSelectElement).value;
      const group = this.groupedPurchaseOrders().find(g => g.poNumber === poNumber);
      if (group) {
          const updates = group.items.map(item => ({ ...item, status }));
          // This call triggers updatePurchaseOrders in DataService, 
          // which in turn triggers syncProductTransitTotals.
          this.dataService.updatePurchaseOrders(updates)
              .then(() => {
                  // Optional debug log
                  console.log(`PO Status updated: ${status}. Transit quantity synced.`);
              });
      }
  }

  updateReceivedQuantityList(purchaseId: string, event: Event) {
      const val = parseInt((event.target as HTMLInputElement).value, 10);
      if (isNaN(val) || val < 0) return;
      
      // Since grouping is by PO Number, we need to find the specific item by purchaseId
      const allOrders = this.purchaseOrders();
      const target = allOrders.find(p => p.purchaseId === purchaseId);
      if (target) {
          this.dataService.updatePurchaseOrder({ ...target, receivedQuantity: val });
      }
  }

  updateInvoiceStatus(poNumber: string, event: Event) {
      const checked = (event.target as HTMLInputElement).checked;
      const group = this.groupedPurchaseOrders().find(g => g.poNumber === poNumber);
      if (group) {
          const updates = group.items.map(item => ({ ...item, invoiceStatus: checked }));
          this.dataService.updatePurchaseOrders(updates);
      }
  }

  deleteOrder(group: GroupedPurchaseOrder) {
      if (confirm(`確定要刪除採購單 ${group.poNumber} 嗎？`)) {
          const ids = group.items.map(i => i.purchaseId);
          this.dataService.deletePurchaseOrders(ids);
      }
  }

  receiveFullOrder(group: GroupedPurchaseOrder) {
      if (confirm('確定全部到貨？將更新所有品項的已收數量等於採購數量。')) {
          const updates = group.items.map(item => ({
              ...item,
              receivedQuantity: item.quantity,
              status: '全部到貨'
          }));
          this.dataService.updatePurchaseOrders(updates);
      }
  }

  // --- Revise Order (Edit Existing) ---
  reviseOrder(group: GroupedPurchaseOrder) {
      this.editingPoNumber.set(group.poNumber);
      this.tempPoNumber.set(null); // Clear Temp ID

      const supplier = this.suppliers().find(s => s.code === group.supplierCode);
      this.selectedSupplier.set(supplier || null);
      
      // Load Cart
      const cartItems = group.items.map(item => {
          const prod = this.products().find(p => p.id === item.productId);
          return {
              product: prod || { id: item.productId, name: item.productId, stock: 0 } as any,
              quantity: item.quantity,
              receivedQuantity: item.receivedQuantity || 0
          };
      });
      this.cart.set(cartItems);

      // Load Header Form
      // FIX: Use emitEvent: false to prevent auto-calculation logic from overwriting saved dates
      this.poHeaderForm.patchValue({
          purchaseDate: group.purchaseDate,
          expectedShippingDate: group.items[0].expectedShippingDate,
          expectedDeliveryDate: group.expectedDelivery,
          purchaseNote: group.purchaseNote,
          status: group.status,
          purchaser: group.purchaser,
          logistics: group.items[0].shipLogistics,
          invoiceStatus: group.invoiceStatus,
          purchaseAuth: group.purchaseAuth
      }, { emitEvent: false });

      this.currentStep.set('review');
  }

  updateReceivedQuantity(productId: string, event: Event) {
      const val = parseInt((event.target as HTMLInputElement).value, 10);
      if (isNaN(val) || val < 0) return;
      this.cart.update(items => items.map(i => i.product.id === productId ? { ...i, receivedQuantity: val } : i));
  }

  receiveAllItems() {
      this.cart.update(items => items.map(i => ({ ...i, receivedQuantity: i.quantity })));
  }

  initHeaderForm() {
    const now = new Date();
    const todayDash = now.toISOString().split('T')[0];
    const user = this.dataService.currentUser();
    const isAutoApprove = user?.roleId === 'ROLE-001' || user?.name === 'Gerald Chen';
    
    // FIX: Calculate default dates based on logic
    const defaultShip = DateUtils.addWorkingDays(todayDash, 1);
    const defaultDelivery = DateUtils.addWorkingDays(defaultShip, 1);

    this.poHeaderForm = this.fb.group({
        purchaseDate: [todayDash, Validators.required],
        expectedShippingDate: [defaultShip],
        expectedDeliveryDate: [defaultDelivery],
        purchaseNote: [''],
        status: [isAutoApprove ? '審核通過(要下單)' : '員工確認'],
        purchaser: [user?.name || 'Admin'],
        logistics: [''],
        invoiceStatus: [false],
        purchaseAuth: ['員工確認']
    });

    // FIX: Add Logic Subscriptions
    this.poHeaderForm.get('purchaseDate')?.valueChanges.subscribe(val => {
        if (val) {
            const ship = DateUtils.addWorkingDays(val, 1);
            const dev = DateUtils.addWorkingDays(ship, 1);
            this.poHeaderForm.patchValue({
                expectedShippingDate: ship,
                expectedDeliveryDate: dev
            });
        }
    });

    this.poHeaderForm.get('expectedShippingDate')?.valueChanges.subscribe(val => {
        if (val) {
            const dev = DateUtils.addWorkingDays(val, 1);
            this.poHeaderForm.patchValue({
                expectedDeliveryDate: dev
            }, { emitEvent: false });
        }
    });
  }

  // --- Submit Order ---
  async submitOrder() {
      if (this.poHeaderForm.invalid) return;
      const header = this.poHeaderForm.value;
      const items = this.cart();
      const supplier = this.selectedSupplier();
      
      // Determine if we are updating an existing (or just-created) order
      let poNumber = this.editingPoNumber() || this.tempPoNumber();
      
      if (!poNumber) {
          const dateCompact = header.purchaseDate.replace(/-/g, '');
          poNumber = this.generateNextPoId(dateCompact);
          this.tempPoNumber.set(poNumber); // Track new PO Number
      } else {
          // Delete existing to rewrite
          const group = this.groupedPurchaseOrders().find(g => g.poNumber === poNumber);
          if (group) {
              const ids = group.items.map(i => i.purchaseId);
              await this.dataService.deletePurchaseOrders(ids);
          }
      }

      const newPos: PurchaseOrder[] = items.map((item, index) => {
          const suffix = (index + 1).toString().padStart(2, '0');
          return {
              purchaseId: `${poNumber}-${suffix}`,
              poNumber: poNumber!,
              productId: item.product.id,
              quantity: item.quantity,
              receivedQuantity: item.receivedQuantity || 0,
              purchaseDate: header.purchaseDate,
              status: header.status,
              supplierCode: supplier?.code || 'UNKNOWN',
              supplierName: supplier?.shortName || 'Unknown',
              purchaser: header.purchaser,
              expectedShippingDate: header.expectedShippingDate,
              expectedDeliveryDate: header.expectedDeliveryDate,
              purchaseNote: header.purchaseNote,
              isOrdered: header.status === '已下訂' || header.status === '廠商確認',
              shipLogistics: header.logistics,
              invoiceStatus: header.invoiceStatus,
              purchaseAuth: header.purchaseAuth
          };
      });

      await Promise.all(newPos.map(po => this.dataService.addPurchaseOrder(po)));
      
      // Auto-generate text
      this.generateCommunicationText(poNumber!);
      this.currentStep.set('generate-text');
  }

  // --- Text Generation ---
  generateCommunicationText(poId: string) {
      // Find default template
      const defaultTpl = this.purchaseTemplates().find(t => t.isSystemDefault) || this.purchaseTemplates()[0];
      if (defaultTpl) this.applyTemplate(defaultTpl.id);
  }

  applyTemplate(tplId: string) {
      this.selectedTemplateId.set(tplId);
      const tpl = this.communicationTemplates().find(t => t.id === tplId);
      if (!tpl) return;

      const header = this.poHeaderForm.value;
      const items = this.cart();
      
      // Prefer Temp ID (newly created) -> Editing ID -> Fallback
      const poId = this.tempPoNumber() || this.editingPoNumber() || 'NEW-PO'; 

      const itemsStr = items.map((i, idx) => `${idx+1}. ${i.product.name} x ${i.quantity} ${i.product.unit}`).join('\n');
      
      let content = tpl.content;
      const data: any = {
          poId: poId,
          purchaseDate: header.purchaseDate,
          supplierName: this.selectedSupplier()?.shortName,
          items: itemsStr,
          deliveryDate: header.expectedDeliveryDate || '盡快',
          purchaser: header.purchaser,
          companyName: this.dataService.systemSettings().companyName,
          note: header.purchaseNote || '無'
      };

      Object.keys(data).forEach(key => {
          const regex = new RegExp(`{{${key}}}`, 'g');
          content = content.replace(regex, data[key]);
      });
      
      this.generatedText.set(content);
  }

  copyAndFinish() {
      navigator.clipboard.writeText(this.generatedText()).then(() => {
          alert('已複製！');
          this.finish();
      });
  }

  finish() {
      this.currentStep.set('list');
      this.resetWizard(); // Includes clearing tempPoNumber
  }

  // Tooltip Logic
  showNoteTooltip(event: MouseEvent, text: string) {
    const el = event.currentTarget as HTMLElement;
    const rect = el.getBoundingClientRect();
    this.noteTooltip.set({ text, x: rect.left + (rect.width / 2), y: rect.top - 10 });
  }
  hideNoteTooltip() { this.noteTooltip.set(null); }

  // Note Modal
  openNoteModal(group: GroupedPurchaseOrder, event: Event) {
    event.stopPropagation();
    this.editingNotePoNumber.set(group.poNumber);
    this.editingNoteText.set(group.purchaseNote || '');
  }
  closeNoteModal() {
    this.editingNotePoNumber.set(null);
    this.editingNoteText.set('');
  }
  saveNote() {
    const poNumber = this.editingNotePoNumber();
    if (poNumber) {
        const group = this.groupedPurchaseOrders().find(g => g.poNumber === poNumber);
        if (group) {
            const updates = group.items.map(item => ({ ...item, purchaseNote: this.editingNoteText() }));
            this.dataService.updatePurchaseOrders(updates);
        }
    }
    this.closeNoteModal();
  }

  private generateNextPoId(dateCompact: string): string {
    const prefix = `PO-${dateCompact}-`;
    const existingOrders = this.purchaseOrders();
    let maxSeq = 0;
    existingOrders.forEach(po => {
        const poNum = po.poNumber || po.purchaseId;
        if (poNum && poNum.startsWith(prefix)) {
            const suffix = poNum.slice(prefix.length); 
            const seq = parseInt(suffix, 10);
            if (!isNaN(seq) && seq > maxSeq) maxSeq = seq;
        }
    });
    return `${prefix}${(maxSeq + 1).toString().padStart(3, '0')}`;
  }
}

