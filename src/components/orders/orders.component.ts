
import { ChangeDetectionStrategy, Component, computed, inject, signal, effect, ElementRef, ViewChild, output, OnDestroy } from '@angular/core';
import { CommonModule, DecimalPipe, DOCUMENT } from '@angular/common';
import { ReactiveFormsModule, FormBuilder, FormGroup, Validators, FormsModule } from '@angular/forms';
import { DataService } from '../../services/data.service';
import { PrintService } from '../../services/print.service'; 
import { Order, Product, Customer, CommunicationTemplate, Brand, CompanyProfile } from '../../models/erp.models';
import { ResizableDirective } from '../../directives/resizable.directive';
import { TaiwanDatePipe } from '../../pipes/taiwan-date.pipe';
import { DomSanitizer, SafeResourceUrl } from '@angular/platform-browser';
import { ViewType } from '../../models/erp.models'; // Import ViewType
import jsPDF from 'jspdf';
import html2canvas from 'html2canvas';
import * as d3 from 'd3';

// Updated Step Type
type OrderStep = 'list' | 'select-brand' | 'select-company' | 'select-customer' | 'select-products' | 'select-manufacturing' | 'select-extras' | 'fill-info' | 'review-summary' | 'communication' | 'cart-adjust';

interface CartItem {
  product: Product;
  name: string; 
  quantity: number;
  quantityForOrder: number;
  price: number;
  note?: string; 
  shippedQuantity?: number; 
  pickingQuantity?: number;
  markup?: number;
}

// Local interface mirroring the model for strict typing in this component
interface GroupedOrder {
  baseOrderId: string;
  orderDate: string;
  customerName: string;
  customerId: string;
  salesperson: string;
  status: string;
  paymentStatus: boolean;
  items: Order[];
  displayItems: Order[];
  totalAmount: number;
  sellerName: string; 
  brandName: string; 
  sellerShortName: string; 
  brandShortName: string; 
  brandLogoUrl?: string; 
  clientPaymentTerms: string; 
  isSampleOrder: boolean; 
  customerLineId?: string; 
  specialRequests?: string; // Added: Special Requests / Order Note
  shipmentCount: number; // Added missing property
  daysSinceOrder: number;
}

// Graph Interfaces
interface GraphNode extends d3.SimulationNodeDatum {
  id: string;
  label: string;
  group: 'order' | 'customer' | 'product';
  radius: number;
  x?: number;
  y?: number;
  fx?: number | null;
  fy?: number | null;
}

interface GraphLink extends d3.SimulationLinkDatum<GraphNode> {
  source: string | GraphNode;
  target: string | GraphNode;
  value: number;
}

@Component({
  selector: 'app-orders',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CommonModule, ReactiveFormsModule, FormsModule, ResizableDirective, TaiwanDatePipe],
  providers: [DecimalPipe],
  templateUrl: './orders.component.html',
  styles: [`
    :host { display: block; height: 100%; overflow: hidden; }
  `]
})
export class OrdersComponent implements OnDestroy {
  private dataService = inject(DataService);
  private printService = inject(PrintService); 
  private fb = inject(FormBuilder);
  private decimalPipe = inject(DecimalPipe);
  private sanitizer = inject(DomSanitizer);
  private document = inject(DOCUMENT);

  @ViewChild('previewFrame') previewFrame!: ElementRef<HTMLIFrameElement>;
  @ViewChild('graphContainer') graphContainer!: ElementRef<HTMLDivElement>;

  // Data Signals
  orders = this.dataService.orders;
  customers = this.dataService.customers;
  products = this.dataService.products;
  employees = this.dataService.employees;
  suppliers = this.dataService.suppliers;
  brands = this.dataService.brands;
  companies = this.dataService.companies;
  communicationTemplates = this.dataService.communicationTemplates;

  // List View State
  searchTerm = signal('');
  isVisualMode = signal(false); // Toggle for Visual Graph Mode
  expandedOrderNotes = signal<Set<string>>(new Set()); // Track expanded notes in list view
  
  // Sorting Signals
  sortColumn = signal<string>('orderId');
  sortDirection = signal<'asc' | 'desc'>('desc');

  // Filters
  selectedCompanyFilter = signal('');
  selectedBrandFilter = signal('');
  selectedStatusFilter = signal('ACTION_REQUIRED'); // Default to Action Required
  selectedOrderTypeFilter = signal('all');
  selectedPaymentStatusFilter = signal('all'); // Added: Payment Status Filter
  
  // Wizard State
  currentStep = signal<OrderStep>('list');
  wizardSearchTerm = signal('');
  selectedCategory = signal('');
  selectedSupplierFilter = signal('');
  selectedCustomer = signal<Customer | null>(null);
  
  // Step 5 specific filter
  selectedManufacturingCategory = signal('代工');

  // Entity Selection State
  selectedBrand = signal<Brand | null>(null);
  selectedCompany = signal<CompanyProfile | null>(null);

  cart = signal<CartItem[]>([]);
  
  // New: Track expanded notes in Cart Adjust step
  expandedCartNotes = signal<Set<string>>(new Set());
  
  // Computed to check validity of the whole cart
  isCartValid = computed(() => {
      return this.cart().length > 0 && this.cart().every(item => {
          const min = (item.shippedQuantity || 0) + (item.pickingQuantity || 0);
          return item.quantity >= min && item.quantity > 0;
      });
  });
  
  // Receiver Source Toggle (1 = Primary, 2 = Secondary)
  currentReceiverSource = signal<1 | 2>(1);
  
  // Tax Reactivity
  isOrderTaxable = signal(true);
  
  // Edit State
  editingOrderId = signal<string | null>(null);
  tempOrderId = signal<string | null>(null); 

  // Text Generation State
  communicationText = signal('');
  selectedTemplateId = signal('');
  
  // Print Preview State
  showPrintPreview = signal(false);
  previewHtmlSrc = signal<SafeResourceUrl | null>(null);
  isDownloadingPdf = signal(false);
  
  // New: Print Template State
  currentPreviewGroup = signal<GroupedOrder | null>(null); // To store what we are looking at
  currentPrintTemplateId = signal<string>('');
  
  // --- Full View Edit State ---
  showFullViewModal = signal(false);
  fullViewItems = signal<Order[]>([]);
  fullViewHeaderForm!: FormGroup;
  fullViewDeletedIds = signal<string[]>([]); // Track items to delete

  // New: Available Order Templates
  availableOrderTemplates = computed(() =>
    this.dataService.exportTemplates().filter(t => t.type === 'order')
  );

  // New: Computed Action Required Count
  actionRequiredCount = computed(() => {
    const rawOrders = this.orders();
    const groups = new Map<string, string[]>(); // baseId -> [statuses]

    // Group items to determine aggregate status
    rawOrders.forEach(o => {
        const parts = o.orderId.split('-');
        const baseId = parts.length > 3 ? parts.slice(0, 3).join('-') : o.orderId;
        
        if (!groups.has(baseId)) {
            groups.set(baseId, []);
        }
        groups.get(baseId)!.push(o.status);
    });
    
    let count = 0;
    const actionableStatuses = ['處理中', '部份出貨']; 

    groups.forEach((statuses) => {
        // Aggregate Logic (must match groupedOrders logic)
        let aggStatus = '處理中';
        const unique = new Set(statuses);
        
        if (unique.size === 1) {
            aggStatus = statuses[0];
        } else {
            const activeStatuses = statuses.filter(s => s !== '取消');
            if (activeStatuses.length === 0) aggStatus = '取消';
            else {
                 const activeUnique = new Set(activeStatuses);
                 if ([...activeUnique].every(s => s === '已結案')) aggStatus = '已結案';
                 else if ([...activeUnique].every(s => s === '已出貨' || s === '已結案')) aggStatus = '已出貨';
                 else if (activeUnique.has('部份出貨') || (activeUnique.has('已出貨') && activeUnique.has('處理中'))) aggStatus = '部份出貨';
                 else aggStatus = '處理中';
            }
        }

        if (actionableStatuses.includes(aggStatus)) {
            count++;
        }
    });
    
    return count;
  });

  // Templates
  orderTemplates = computed(() => this.orderTemplatesData());

  orderTemplatesData() {
      return this.communicationTemplates().filter(t => t.type === 'order');
  }

  categorizedTemplates = computed(() => {
    const templates = this.orderTemplatesData();
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

  // Forms
  orderForm!: FormGroup;

  readonly logisticsOptions = [
    '黑貓', '大榮', '宅配通', '新竹', '郵局', '自取', '自派黑貓'
  ];

  // Updated exclusion list
  readonly SHIPPING_FEE_IDS = ['FEE-DLV-HM', 'FEE-DLV-DR', 'FEE-DIS-DLV', 'FEE-DIS-Product'];
  
  // Specific IDs for Extras Step
  readonly EXTRA_IDS = ['FEE-DLV-DR', 'FEE-DLV-HM', 'FEE-DIS-DLV', 'FEE-DIS-Product'];

  readonly categories = [
    '水果乾', '鮮果', '堅果', '蔬果脆片', '水果凍乾',
    '沖泡類', '零食', '蜜餞', '包材', '代工', '費用', '折讓', '成品', '樣品', '其他'
  ];

  readonly statusOptions = ['處理中', '已出貨', '部份出貨', '已結案', '取消'];

  constructor() {
    this.initForm();
    this.initFullViewForm();

    // Effect: Automated COD Amount Calculation based on Cart Total
    effect(() => {
        const totals = this.cartTotal(); 
        this.updateCodAmount();
    });

    // Effect: Watch for Auto Start Trigger from Deep Link
    effect(() => {
        if (this.dataService.autoStartOrderWizard()) {
            this.startCreateOrder();
            this.dataService.autoStartOrderWizard.set(false);
        }
    });

    // Effect: Graph Rendering
    effect(() => {
        if (this.isVisualMode() && this.currentStep() === 'list') {
            // Need a slight delay to ensure container exists in DOM
            setTimeout(() => {
                this.renderRelationshipGraph();
            }, 50);
        }
    });
  }
  
  ngOnDestroy() {
      this.toggleViewportZoom(false);
  }

  // --- Cart Note Toggle Logic ---
  toggleCartNote(productId: string) {
      this.expandedCartNotes.update(set => {
          const newSet = new Set(set);
          if (newSet.has(productId)) newSet.delete(productId);
          else newSet.add(productId);
          return newSet;
      });
  }

  isCartNoteExpanded(productId: string): boolean {
      return this.expandedCartNotes().has(productId);
  }

  // --- Visual Graph Logic ---
  
  toggleVisualMode() {
      this.isVisualMode.update(v => !v);
  }
  
  private renderRelationshipGraph() {
      if (!this.graphContainer) return;
      
      const element = this.graphContainer.nativeElement;
      // Clear previous
      d3.select(element).selectAll('*').remove();
      
      const width = element.clientWidth;
      const height = element.clientHeight;
      
      const data = this.prepareGraphData();
      
      if (data.nodes.length === 0) {
          d3.select(element).append('div')
            .attr('class', 'flex items-center justify-center h-full text-slate-400')
            .text('目前篩選條件下無資料');
          return;
      }

      // Zoom support
      const zoom = d3.zoom<SVGSVGElement, unknown>()
          .scaleExtent([0.1, 4])
          .on('zoom', (event) => {
              g.attr('transform', event.transform);
          });

      const svg = d3.select(element).append('svg')
          .attr('width', width)
          .attr('height', height)
          .call(zoom)
          .on("dblclick.zoom", null); // Disable double click zoom

      const g = svg.append('g');

      // Simulation
      const simulation = d3.forceSimulation<GraphNode, GraphLink>(data.nodes)
          .force('link', d3.forceLink<GraphNode, GraphLink>(data.links).id(d => d.id).distance(100))
          .force('charge', d3.forceManyBody().strength(-300))
          .force('center', d3.forceCenter(width / 2, height / 2))
          .force('collide', d3.forceCollide().radius(d => (d as any).radius + 10).iterations(2));

      // Links
      const link = g.append('g')
          .attr('stroke', '#94a3b8') // slate-400
          .attr('stroke-opacity', 0.6)
          .selectAll('line')
          .data(data.links)
          .join('line')
          .attr('stroke-width', d => Math.sqrt(d.value));

      // Nodes
      const node = g.append('g')
          .attr('stroke', '#fff')
          .attr('stroke-width', 1.5)
          .selectAll('circle')
          .data(data.nodes)
          .join('circle')
          .attr('r', d => d.radius)
          .attr('fill', d => this.getNodeColor(d.group))
          .call(d3.drag<SVGCircleElement, GraphNode>()
              .on('start', dragstarted)
              .on('drag', dragged)
              .on('end', dragended));

      // Labels
      const text = g.append('g')
          .selectAll('text')
          .data(data.nodes)
          .join('text')
          .text(d => d.label)
          .attr('x', 12)
          .attr('y', 4)
          .attr('font-size', '10px')
          .attr('fill', d => document.documentElement.classList.contains('dark') ? '#cbd5e1' : '#475569') // slate-300 / slate-600
          .style('pointer-events', 'none'); // Let clicks pass through to node

      // Title/Tooltip
      node.append('title').text(d => d.label);

      simulation.on('tick', () => {
          link
              .attr('x1', d => (d.source as GraphNode).x!)
              .attr('y1', d => (d.source as GraphNode).y!)
              .attr('x2', d => (d.target as GraphNode).x!)
              .attr('y2', d => (d.target as GraphNode).y!);

          node
              .attr('cx', d => d.x!)
              .attr('cy', d => d.y!);
              
          text
              .attr('x', d => d.x! + 12)
              .attr('y', d => d.y! + 4);
      });

      function dragstarted(event: any) {
          if (!event.active) simulation.alphaTarget(0.3).restart();
          event.subject.fx = event.subject.x;
          event.subject.fy = event.subject.y;
      }

      function dragged(event: any) {
          event.subject.fx = event.x;
          event.subject.fy = event.y;
      }

      function dragended(event: any) {
          if (!event.active) simulation.alphaTarget(0);
          event.subject.fx = null;
          event.subject.fy = null;
      }
  }
  
  private getNodeColor(group: string): string {
      switch(group) {
          case 'order': return '#3b82f6'; // blue-500
          case 'customer': return '#10b981'; // emerald-500
          case 'product': return '#f97316'; // orange-500
          default: return '#9ca3af';
      }
  }
  
  private prepareGraphData(): { nodes: GraphNode[], links: GraphLink[] } {
      const orders = this.groupedOrders(); // Use filtered orders to respect search
      const nodes: Map<string, GraphNode> = new Map();
      const links: GraphLink[] = [];
      
      // Limit to top 50 to prevent performance issues
      const limitedOrders = orders.slice(0, 50);
      
      limitedOrders.forEach(group => {
          // 1. Order Node (Center)
          if (!nodes.has(group.baseOrderId)) {
              nodes.set(group.baseOrderId, {
                  id: group.baseOrderId,
                  label: `${group.baseOrderId} (${group.status})`,
                  group: 'order',
                  radius: 12
              });
          }
          
          // 2. Customer Node
          const custId = `CUST-${group.customerId}`; // Prefix to avoid ID collision
          if (!nodes.has(custId)) {
              nodes.set(custId, {
                  id: custId,
                  label: group.customerName,
                  group: 'customer',
                  radius: 15 // Bigger
              });
          }
          
          // Link Order <-> Customer
          links.push({
              source: custId,
              target: group.baseOrderId,
              value: 2
          });
          
          // 3. Product Nodes
          group.displayItems.forEach(item => {
              const prodId = item.productId;
              if (!nodes.has(prodId)) {
                  nodes.set(prodId, {
                      id: prodId,
                      label: item.productName,
                      group: 'product',
                      radius: 8
                  });
              }
              
              // Link Order <-> Product
              links.push({
                  source: group.baseOrderId,
                  target: prodId,
                  value: 1
              });
          });
      });
      
      return {
          nodes: Array.from(nodes.values()),
          links: links
      };
  }

  // --- Dynamic Viewport Zoom Control ---
  private toggleViewportZoom(enable: boolean) {
      const viewportMeta = this.document.querySelector('meta[name="viewport"]');
      if (viewportMeta) {
          if (enable) {
              // Enable zoom: user-scalable=yes, max-scale=5.0
              viewportMeta.setAttribute('content', 'width=device-width, initial-scale=1, maximum-scale=5, user-scalable=yes');
          } else {
              // Lock zoom: user-scalable=no, max-scale=1.0 (Default App Behavior)
              viewportMeta.setAttribute('content', 'width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no');
          }
      }
  }

  // --- Mobile App Mode Launch ---
  openMobileApp() {
      // Set the intent to open 'order' wizard via hash
      // This reloads the app to clear state and triggers the AppComponent logic
      // which then sets currentView='orders' and sets autoStartOrderWizard=true
      window.location.hash = '#order-create';
      window.location.reload();
  }

  // --- Helper: Generate Sequential Order ID ---
  private generateNextOrderId(dateCompact: string): string {
    const prefix = `ORD-${dateCompact}-`; // e.g., ORD-20240520-
    const existingOrders = this.orders();
    let maxSeq = 0;
    const processedIds = new Set<string>();

    existingOrders.forEach(o => {
        if (o.orderId && o.orderId.startsWith(prefix)) {
            const parts = o.orderId.split('-');
            if (parts.length >= 3) {
                const seqStr = parts[2];
                if (!processedIds.has(seqStr)) {
                    processedIds.add(seqStr);
                    const seq = parseInt(seqStr, 10);
                    if (!isNaN(seq) && seq > maxSeq) {
                        maxSeq = seq;
                    }
                }
            }
        }
    });

    const nextSeq = maxSeq + 1;
    return `${prefix}${nextSeq.toString().padStart(3, '0')}`;
  }

  isOverdue(dateStr: string | undefined): boolean {
    if (!dateStr) return false;
    const due = new Date(dateStr);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    return due < today;
  }

  toggleSort(column: string) {
    if (this.sortColumn() === column) {
      this.sortDirection.set(this.sortDirection() === 'asc' ? 'desc' : 'asc');
    } else {
      this.sortColumn.set(column);
      this.sortDirection.set('asc');
    }
  }

  isRefreshing = computed(() => this.dataService.isRefreshing());

  async refreshData() {
    await this.dataService.refreshAll();
  }

  navigateToImport() {
    this.dataService.navigateTo('import');
  }

  async loadDemoData() {
    if (confirm('確定要載入展示資料嗎？這將會新增一些範例訂單、客戶與商品。')) {
      await this.dataService.loadMockData();
      // Force refresh if needed, though signals should handle it
    }
  }

  initForm() {
    const today = new Date().toISOString().split('T')[0];
    
    this.orderForm = this.fb.group({
      orderId: [''], 
      orderDate: [today, Validators.required],
      status: ['處理中', Validators.required],
      salesperson: ['', Validators.required],
      sellerName: ['公司大平台'],
      brandName: [''], 
      customerId: ['', Validators.required],
      customerName: ['', Validators.required],
      productId: [''],
      productName: [''],
      productNote: [''],
      quantity: [0],
      shippedQuantity: [0],
      pickingQuantity: [0],
      manufacturedQuantity: [0],
      packingQuantity: [0],
      priceBeforeTax: [0],
      subtotal: [0],
      taxAmount: [0],
      totalAmount: [0],
      codAmount: [0, [Validators.min(0)]], 
      orderTaxType: [true],
      paymentStatus: [false],
      paymentTerms: ['先匯款'], // Added
      paymentDueDate: [''], 
      invoiceNumber: [''],
      shipLogistics: ['黑貓'], 
      shippingId: [''],
      trackingUrl: [''],
      
      receiverName: [''],
      receiverPhone: [''],
      receiverAddress: [''],
      
      receiverName2: [''],
      receiverPhone2: [''],
      receiverAddress2: [''],

      specialRequests: [''],
      requestedShippingDate: [''],
      manufacturingStatus: ['備料中'], 
      estimatedCompletionDate: [''],
      manufacturingPriority: [false],
      isManufacturingOrder: [false], 
      isSampleOrder: [false] 
    });

    this.orderForm.get('orderTaxType')?.valueChanges.subscribe(val => {
        this.isOrderTaxable.set(!!val);
    });
    this.isOrderTaxable.set(this.orderForm.get('orderTaxType')?.value ?? true);

    // Listen to paymentTerms changes to trigger COD update AND Validation logic
    this.orderForm.get('paymentTerms')?.valueChanges.subscribe(term => {
        // 1. COD logic
        this.updateCodAmount();
        
        // 2. Payment Due Date Validation logic
        const dueDateControl = this.orderForm.get('paymentDueDate');
        if (term === '帳期後付') {
            dueDateControl?.setValidators([Validators.required]);
        } else {
            dueDateControl?.clearValidators();
        }
        dueDateControl?.updateValueAndValidity();
    });
  }
  
  initFullViewForm() {
    this.fullViewHeaderForm = this.fb.group({
      baseOrderId: [''],
      orderDate: ['', Validators.required],
      status: ['', Validators.required],
      salesperson: [''],
      paymentStatus: [false],
      paymentTerms: [''],
      receiverName: [''],
      receiverPhone: [''],
      receiverAddress: [''],
      shipLogistics: [''],
      specialRequests: [''],
      orderTaxType: [true],
      codAmount: [0]
    });

    // Listen for tax toggle changes to update totals immediately
    this.fullViewHeaderForm.get('orderTaxType')?.valueChanges.subscribe(isTaxable => {
      this.recalculateFullViewItemsTax(isTaxable);
    });
  }

  recalculateFullViewItemsTax(isTaxable: boolean) {
    this.fullViewItems.update(items => {
      return items.map(item => {
        const updatedItem = { ...item };
        const qty = Number(updatedItem.quantity) || 0;
        const price = Number(updatedItem.priceBeforeTax) || 0;
        updatedItem.subtotal = Math.round(qty * price);
        
        if (isTaxable) {
          updatedItem.taxAmount = Math.round(updatedItem.subtotal * 0.05);
          updatedItem.totalAmount = updatedItem.subtotal + updatedItem.taxAmount;
        } else {
          updatedItem.taxAmount = 0;
          updatedItem.totalAmount = updatedItem.subtotal;
        }
        return updatedItem;
      });
    });
  }

  updateCodAmount() {
      if (!this.orderForm) return;
      const paymentTerm = this.orderForm.get('paymentTerms')?.value;
      const isCOD = paymentTerm === '貨到付款';
      const codControl = this.orderForm.get('codAmount');
      
      if (!codControl) return;

      if (isCOD) {
          const totals = this.cartTotal();
          const totalAmount = totals.total || 0;
          let calculatedCod = 0;

          // Logic: <= 3000 -> +30, > 3000 -> * 1.01
          if (totalAmount <= 3000) {
              calculatedCod = totalAmount + 30;
          } else {
              calculatedCod = Math.round(totalAmount * 1.01);
          }

          if (codControl.value !== calculatedCod) {
              codControl.setValue(calculatedCod, { emitEvent: false });
          }
      } else {
          if (codControl.value !== 0) {
              codControl.setValue(0, { emitEvent: false });
          }
      }
  }

  updateOrderStatus(baseOrderId: string, event: Event) {
      const selectEl = event.target as HTMLSelectElement;
      const newStatus = selectEl.value;
      
      // 1. Get current raw data to ensure we have everything, not just filtered views
      const allOrders = this.orders();
      
      // 2. Find all items belonging to this group based on ID pattern
      // Uses a more robust check that handles both simple and extended IDs
      // e.g. baseOrderId="ORD-001" matches "ORD-001", "ORD-001-01", "ORD-001-02"
      const targetItems = allOrders.filter(o => {
          // Check if the order ID starts with the base ID AND (is exact match OR followed by a hyphen)
          // This prevents "ORD-1" matching "ORD-10"
          return o.orderId === baseOrderId || o.orderId.startsWith(baseOrderId + '-');
      });
      
      if (targetItems.length > 0) {
          const now = new Date().toISOString();
          
          const updates = targetItems.map(item => {
              // Create shallow copy to modify
              const updatedItem: Order = { ...item };
              
              // Update Status
              updatedItem.status = newStatus;
              
              // Handle Timestamp Logic
              if (newStatus === '已結案') {
                  // If moving TO Closed, set timestamp if missing
                  if (!updatedItem.closedAt) {
                      updatedItem.closedAt = now;
                  }
              } else {
                  // If moving TO anything else (Processing, Shipped...), Clear timestamp
                  if (updatedItem.closedAt) {
                      delete updatedItem.closedAt; 
                  }
              }
              return updatedItem;
          });
          
          this.dataService.updateOrders(updates);
      }
  }

  groupedOrders = computed(() => {
    const term = this.searchTerm().toLowerCase();
    const companyFilter = this.selectedCompanyFilter();
    const brandFilter = this.selectedBrandFilter();
    const statusFilter = this.selectedStatusFilter();
    const typeFilter = this.selectedOrderTypeFilter();
    const paymentFilter = this.selectedPaymentStatusFilter();
    
    const rawOrders = this.orders();
    
    const allCompanies = this.companies();
    const allBrands = this.brands();
    const companyMap = new Map<string, string>(); 
    allCompanies.forEach(c => {
        if (c.name) companyMap.set(c.name, c.shortName || c.name);
    });

    const brandShortMap = new Map<string, string>(); 
    const brandLogoMap = new Map<string, string>();
    allBrands.forEach(b => {
        if (b.nameTw) {
            brandShortMap.set(b.nameTw, b.shortName || b.nameTw);
            brandLogoMap.set(b.nameTw, b.logoUrl || '');
        }
    });

    const customerMap = new Map<string, Customer>(this.customers().map(c => [c.id, c]));
    const productMap = new Map<string, Product>(this.products().map(p => [p.id, p] as [string, Product]));
    const groups: Record<string, GroupedOrder> = {};

    rawOrders.forEach(o => {
        const parts = o.orderId.split('-');
        const baseId = parts.length > 3 ? parts.slice(0, 3).join('-') : o.orderId;

        if (!groups[baseId]) {
            const shortComp = companyMap.get(o.sellerName) || o.sellerName;
            const shortBrand = o.brandName ? (brandShortMap.get(o.brandName) || o.brandName) : '';
            const brandLogo = o.brandName ? (brandLogoMap.get(o.brandName) || '') : '';
            
            const customer = customerMap.get(o.customerId);

            // Calculate days since order
            const today = new Date();
            today.setHours(0, 0, 0, 0);
            const orderDate = new Date(o.orderDate);
            orderDate.setHours(0, 0, 0, 0);
            const diffDays = Math.floor((today.getTime() - orderDate.getTime()) / (1000 * 60 * 60 * 24));

            groups[baseId] = {
                baseOrderId: baseId,
                orderDate: o.orderDate,
                customerName: o.customerName,
                customerId: o.customerId,
                salesperson: o.salesperson,
                status: '處理中', // Will be recalculated below
                paymentStatus: o.paymentStatus || false,
                items: [],
                displayItems: [],
                totalAmount: 0,
                sellerName: o.sellerName,
                brandName: o.brandName || '',
                sellerShortName: shortComp,
                brandShortName: shortBrand,
                brandLogoUrl: brandLogo,
                clientPaymentTerms: o.paymentTerms || (customer ? customer.clientPaymentTerms : '先匯款'), // Use order's terms first
                customerLineId: customer ? customer.lineId : '', 
                isSampleOrder: o.isSampleOrder || false,
                specialRequests: o.specialRequests, // Populate specialRequests
                shipmentCount: 0,
                daysSinceOrder: diffDays
            };
        }
        
        const displayOrder = { ...o };
        groups[baseId].items.push(displayOrder);
        
        let product = productMap.get(o.productId);
        
        if (!product && o.productId.includes('-')) {
             const potentialBase = o.productId.substring(0, o.productId.lastIndexOf('-'));
             product = productMap.get(potentialBase);
        }

        if (!displayOrder.unit) {
            displayOrder.unit = product ? product.unit : '個';
        }

        let isCalculable = true;

        if (product) {
            // undefined 也視為 isCalculable=true，除非明確設為 false
            // 但費用/折讓類別的商品也一律排除
            const isFeeCat = ['費用', '折讓'].includes(product.category);
            isCalculable = product.isCalculable !== false && !isFeeCat;
        } else {
            if (
                this.SHIPPING_FEE_IDS.includes(o.productId) ||
                o.productId.startsWith('FEE-')
            ) {
                isCalculable = false;
            }
        }

        if (isCalculable) {
            groups[baseId].displayItems.push(displayOrder);
        }

        groups[baseId].totalAmount += o.totalAmount;
    });

    let groupedList = Object.values(groups).map(g => {
        // --- ROBUST STATUS AGGREGATION LOGIC ---
        // Determines the overall status based on the status of individual items.
        
        // Filter items for status calculation
        // Exclude items that are Fees/Services
        const relevantItems = g.items.filter(i => {
             const prod = productMap.get(i.productId);
             if (prod && prod.isCalculable === false) return false;
             if (['FEE-DLV-HM', 'FEE-DLV-DR', 'FEE-DIS-DLV', 'FEE-DIS-Product'].includes(i.productId)) return false;
             return true;
        });
        
        const targetItems = relevantItems.length > 0 ? relevantItems : g.items;
        const statuses = targetItems.map(i => i.status || '處理中');
        
        let aggStatus = '處理中';
        
        // Helpers
        const has = (s: string) => statuses.includes(s);
        const all = (s: string) => statuses.length > 0 && statuses.every(st => st === s);
        // Special case: Mix of Shipped and Closed is effectively Shipped (Done)
        const allDone = statuses.length > 0 && statuses.every(st => st === '已結案' || st === '已出貨');

        if (all('已結案')) {
            aggStatus = '已結案';
        } else if (all('取消')) {
            aggStatus = '取消';
        } else if (allDone) {
            aggStatus = '已出貨'; 
        } else if (has('部份出貨') || (has('已出貨') && has('處理中'))) {
            aggStatus = '部份出貨';
        } else if (has('處理中')) {
            aggStatus = '處理中';
        } else {
             // Fallback for weird states
             aggStatus = statuses[0] || '處理中';
        }
        
        g.status = aggStatus;
        return g;
    });

    const col = this.sortColumn();
    const dir = this.sortDirection();

    groupedList.sort((a, b) => {
        let valA: any;
        let valB: any;

        switch (col) {
            case 'orderId':
                valA = a.baseOrderId;
                valB = b.baseOrderId;
                break;
            case 'quantity':
                valA = a.items.reduce((sum, i) => sum + (i.quantity || 0), 0);
                valB = b.items.reduce((sum, i) => sum + (i.quantity || 0), 0);
                break;
            case 'orderDate':
                valA = a.orderDate;
                valB = b.orderDate;
                break;
            case 'customer':
                valA = a.customerName;
                valB = b.customerName;
                break;
            case 'amount':
                valA = a.totalAmount;
                valB = b.totalAmount;
                break;
            case 'status':
                valA = a.status;
                valB = b.status;
                break;
            case 'brand':
                valA = a.brandShortName || a.sellerShortName;
                valB = b.brandShortName || b.sellerShortName;
                break;
            case 'days':
                valA = a.daysSinceOrder;
                valB = b.daysSinceOrder;
                break;
            default:
                valA = a.baseOrderId;
                valB = b.baseOrderId;
        }

        if (valA < valB) return dir === 'asc' ? -1 : 1;
        if (valA > valB) return dir === 'asc' ? 1 : -1;
        return 0;
    });

    if (term) {
        groupedList = groupedList.filter(g => 
            g.baseOrderId.toLowerCase().includes(term) ||
            g.customerName.toLowerCase().includes(term) ||
            (g.customerLineId && g.customerLineId.toLowerCase().includes(term)) ||
            g.items.some(i => i.productName.toLowerCase().includes(term))
        );
    }
    
    if (companyFilter) {
        groupedList = groupedList.filter(g => g.sellerName === companyFilter);
    }

    if (brandFilter) {
        groupedList = groupedList.filter(g => g.brandName === brandFilter);
    }

    // Status Filter Logic
    if (statusFilter === 'ACTION_REQUIRED') {
        // Only show items that need attention
        const actionable = ['處理中', '部份出貨']; 
        groupedList = groupedList.filter(g => actionable.includes(g.status));
    } else if (statusFilter) {
        groupedList = groupedList.filter(g => g.status === statusFilter);
    }

    if (typeFilter !== 'all') {
        const isManufacturing = typeFilter === 'manufacturing';
        groupedList = groupedList.filter(g => g.items.some(i => i.isManufacturingOrder === isManufacturing));
    }
    
    if (paymentFilter !== 'all') {
        const isPaid = paymentFilter === 'paid';
        groupedList = groupedList.filter(g => g.paymentStatus === isPaid);
    }

    return groupedList;
  });

  // --- Full View (Detail) Logic ---
  
  openFullView(group: GroupedOrder) {
      // 1. Set State
      this.fullViewDeletedIds.set([]);
      
      // 2. Clone Items for Editing (Deep Copy to avoid mutation reference issues)
      const items = JSON.parse(JSON.stringify(group.items));
      this.fullViewItems.set(items);
      
      // 3. Initialize Header Form
      const firstItem = items[0] || {};
      
      this.fullViewHeaderForm.patchValue({
          baseOrderId: group.baseOrderId,
          orderDate: group.orderDate,
          status: group.status,
          salesperson: group.salesperson,
          paymentStatus: group.paymentStatus,
          paymentTerms: group.clientPaymentTerms,
          receiverName: firstItem.receiverName || '',
          receiverPhone: firstItem.receiverPhone || '',
          receiverAddress: firstItem.receiverAddress || '',
          shipLogistics: firstItem.shipLogistics || '',
          specialRequests: group.specialRequests || '',
          orderTaxType: firstItem.orderTaxType !== false, // default true
          codAmount: firstItem.codAmount || 0
      });
      
      this.showFullViewModal.set(true);
  }

  closeFullView() {
      this.showFullViewModal.set(false);
      this.fullViewItems.set([]);
      this.fullViewDeletedIds.set([]);
  }

  updateFullViewItem(index: number, field: keyof Order, value: any) {
      this.fullViewItems.update(items => {
          const newItems = [...items];
          const item = { ...newItems[index] };
          (item as any)[field] = value;
          
          // Auto-calc logic if qty or price changes
          if (field === 'quantity' || field === 'priceBeforeTax') {
              const qty = Number(item.quantity) || 0;
              const price = Number(item.priceBeforeTax) || 0;
              item.subtotal = Math.round(qty * price);
              
              // Recalculate tax if tax type is enabled on the header form (or item level if specific)
              const isTaxable = this.fullViewHeaderForm.get('orderTaxType')?.value;
              if (isTaxable) {
                  item.taxAmount = Math.round(item.subtotal * 0.05);
                  item.totalAmount = item.subtotal + item.taxAmount;
              } else {
                  item.taxAmount = 0;
                  item.totalAmount = item.subtotal;
              }
          }
          
          newItems[index] = item;
          return newItems;
      });
  }

  removeFullViewItem(index: number) {
      const item = this.fullViewItems()[index];
      if (item.orderId) {
          // Track for deletion
          this.fullViewDeletedIds.update(ids => [...ids, item.orderId]);
      }
      // Remove from view
      this.fullViewItems.update(items => items.filter((_, i) => i !== index));
  }
  
  // Computed Total for Full View
  fullViewTotal = computed(() => {
      return this.fullViewItems().reduce((sum, item) => sum + (item.totalAmount || 0), 0);
  });

  async saveFullView() {
      if (this.fullViewHeaderForm.invalid) {
          alert('請檢查必填欄位');
          return;
      }
      
      const header = this.fullViewHeaderForm.value;
      const items = this.fullViewItems();
      const deletedIds = this.fullViewDeletedIds();
      
      // 1. Process Deletions
      if (deletedIds.length > 0) {
          const deletePromises = deletedIds.map(id => this.dataService.deleteOrder(id));
          await Promise.all(deletePromises);
      }
      
      // 2. Process Updates
      if (items.length > 0) {
          const updates = items.map(item => {
              // Ensure header fields sync to all items
              return {
                  ...item,
                  orderDate: header.orderDate,
                  status: header.status,
                  salesperson: header.salesperson,
                  paymentStatus: header.paymentStatus,
                  paymentTerms: header.paymentTerms,
                  receiverName: header.receiverName,
                  receiverPhone: header.receiverPhone,
                  receiverAddress: header.receiverAddress,
                  shipLogistics: header.shipLogistics,
                  specialRequests: header.specialRequests,
                  orderTaxType: header.orderTaxType,
                  codAmount: header.codAmount,
                  
                  // Recalculate totals one last time to be safe
                  subtotal: (item.quantity || 0) * (item.priceBeforeTax || 0),
                  taxAmount: header.orderTaxType ? Math.round((item.quantity || 0) * (item.priceBeforeTax || 0) * 0.05) : 0,
                  totalAmount: header.orderTaxType ? Math.round((item.quantity || 0) * (item.priceBeforeTax || 0) * 1.05) : ((item.quantity || 0) * (item.priceBeforeTax || 0))
              };
          });
          
          await this.dataService.updateOrders(updates);
      }
      
      this.closeFullView();
  }

  // --- Printing Preview Logic ---
  
  openPrintPreview(group: GroupedOrder) {
    const freshGroup = this.groupedOrders().find(g => g.baseOrderId === group.baseOrderId);
    this.currentPreviewGroup.set(freshGroup ?? group); 
      
      // Auto-select first template if not set or invalid
      const templates = this.availableOrderTemplates();
      if (templates.length > 0) {
          const current = this.currentPrintTemplateId();
          if (!current || !templates.find(t => t.id === current)) {
              this.currentPrintTemplateId.set(templates[0].id);
          }
      }

      this.generatePreviewHtml();
      this.showPrintPreview.set(true);
      
      // Enable Zoom for Preview
      this.toggleViewportZoom(true);
  }

  generatePreviewHtml() {
      const group = this.currentPreviewGroup();
      if (!group) return;
      
      // Fix: Use the company profile matching the order's sellerName (Check Name OR ShortName)
      const seller = group.sellerName;
      let company = this.companies().find(c => c.name === seller || c.shortName === seller);
      
      // Only fallback to default if no seller name is specified on the order
      if (!company && !seller) {
          company = this.companies().find(c => c.name === this.dataService.systemSettings().companyName || c.shortName === this.dataService.systemSettings().companyName) || 
                    this.companies()[0];
      }
                      
      const tplId = this.currentPrintTemplateId();

      const htmlContent = this.printService.generateOrderHtml(group, company, tplId);
      
      if (!htmlContent) {
          this.previewHtmlSrc.set(null);
          return;
      }

      const blob = new Blob([htmlContent], { type: 'text/html' });
      const url = URL.createObjectURL(blob);
      this.previewHtmlSrc.set(this.sanitizer.bypassSecurityTrustResourceUrl(url));
  }
  
  onPrintTemplateChange(event: Event) {
      const val = (event.target as HTMLSelectElement).value;
      this.currentPrintTemplateId.set(val);
      this.generatePreviewHtml();
  }

  closePrintPreview() {
      this.showPrintPreview.set(false);
      this.previewHtmlSrc.set(null);
      this.isDownloadingPdf.set(false);
      this.currentPreviewGroup.set(null);
      
      // Disable Zoom (Lock App)
      this.toggleViewportZoom(false);
  }

  confirmPrint() {
      if (this.previewFrame && this.previewFrame.nativeElement.contentWindow) {
          this.previewFrame.nativeElement.contentWindow.print();
      }
  }

  async downloadPdf() {
    if (!this.previewFrame) return;
    const doc = this.previewFrame.nativeElement.contentDocument;
    if (!doc) return;

    this.isDownloadingPdf.set(true);

    try {
        const canvas = await html2canvas(doc.body, {
            scale: 2, // Higher resolution
            useCORS: true, // Allow cross-origin images
            logging: false,
            width: 794, // A4 width in pixels at 96 DPI approx (210mm)
            windowWidth: 794
        });

        const imgData = canvas.toDataURL('image/png');
        
        // Create PDF: Portrait, mm, A4
        const pdf = new jsPDF('p', 'mm', 'a4');
        const pdfWidth = 210;
        const pdfHeight = 297;
        
        const imgProps = pdf.getImageProperties(imgData);
        const imgHeight = (imgProps.height * pdfWidth) / imgProps.width;
        
        let heightLeft = imgHeight;
        let position = 0;
        
        // Add first page
        pdf.addImage(imgData, 'PNG', 0, position, pdfWidth, imgHeight);
        heightLeft -= pdfHeight;

        // If content is longer than one page, add more pages
        while (heightLeft >= 0) {
          position = heightLeft - imgHeight;
          pdf.addPage();
          pdf.addImage(imgData, 'PNG', 0, position, pdfWidth, imgHeight);
          heightLeft -= pdfHeight;
        }

        // Generate Filename based on Order ID or default
        let filename = 'order.pdf';
        const orderId = this.editingOrderId() || this.tempOrderId();
        if (orderId) {
            filename = `${orderId}.pdf`;
        }

        pdf.save(filename);

    } catch (err) {
        console.error('PDF Generation Error:', err);
        alert('PDF 下載失敗，請稍後再試。');
    } finally {
        this.isDownloadingPdf.set(false);
    }
  }

  printOrder(group: GroupedOrder) {
      this.openPrintPreview(group);
  }

  printCurrentOrder() {
      const targetId = this.tempOrderId() || this.editingOrderId();
      if (!targetId) return;

      // 1. Try to find in current filtered list
      let group = this.groupedOrders().find(g => g.baseOrderId === targetId);

      // 2. If not found (hidden by filter), construct from current form state
      if (!group) {
          const form = this.orderForm.getRawValue();
          const cartItems = this.cart();
          
          // Map cart items to Order-like objects
          const items = cartItems.map((item) => ({
              productId: item.product.id,
              productName: item.name,
              quantity: item.quantity,
              unit: item.product.unit,
              priceBeforeTax: item.price,
              subtotal: item.price * item.quantity,
              productNote: item.note || '',
              // Attach shipping info to items as PrintService might look there
              receiverName: form.receiverName,
              receiverPhone: form.receiverPhone,
              receiverAddress: form.receiverAddress,
              specialRequests: form.specialRequests,
              codAmount: form.codAmount,
              orderTaxType: form.orderTaxType
          }));

          const { total } = this.cartTotal();

          const today = new Date();
          today.setHours(0, 0, 0, 0);
          const orderDate = new Date(form.orderDate);
          orderDate.setHours(0, 0, 0, 0);
          const diffDays = Math.floor((today.getTime() - orderDate.getTime()) / (1000 * 60 * 60 * 24));

          group = {
              baseOrderId: targetId,
              orderDate: form.orderDate,
              customerName: form.customerName,
              customerId: form.customerId,
              sellerName: form.sellerName,
              brandName: this.selectedBrand()?.nameTw || form.brandName || '',
              items: items as Order[], // Cast to Order[]
              totalAmount: total,
              // Required for PrintService fallback if items are empty (unlikely)
              salesperson: form.salesperson,
              status: form.status,
              paymentStatus: form.paymentStatus,
              displayItems: items as Order[],
              shipmentCount: 0,
              sellerShortName: form.sellerName,
              brandShortName: this.selectedBrand()?.shortName || '',
              brandLogoUrl: this.selectedBrand()?.logoUrl || '',
              clientPaymentTerms: form.paymentTerms,
              customerLineId: '',
              isSampleOrder: form.isSampleOrder,
              specialRequests: form.specialRequests,
              daysSinceOrder: diffDays
          };
      }
      
      this.openPrintPreview(group);
  }

  getGroupShippedQty(group: GroupedOrder): number {
      return group.displayItems.reduce((sum, item) => sum + (item.shippedQuantity || 0), 0);
  }

  getGroupOrderedQty(group: GroupedOrder): number {
      return group.displayItems.reduce((sum, item) => sum + (item.quantity || 0), 0);
  }

  wizardFilteredCustomers = computed(() => {
    const term = this.wizardSearchTerm().toLowerCase();
    if (!term) return this.customers();
    return this.customers().filter(c => 
      c.shortName.toLowerCase().includes(term) ||
      c.fullName.toLowerCase().includes(term) ||
      c.id.toLowerCase().includes(term) ||
      (c.phone && c.phone.includes(term)) ||
      (c.lineId && c.lineId.toLowerCase().includes(term))
    );
  });

  // --- New 8-Step Navigation Flow ---
  
  startCreateOrder() {
      this.currentStep.set('select-brand');
      this.editingOrderId.set(null);
      this.tempOrderId.set(null);
      this.cart.set([]);
      this.wizardSearchTerm.set('');
      this.selectedCustomer.set(null);
      this.selectedBrand.set(null);
      this.selectedCompany.set(null);
      this.currentReceiverSource.set(1);
      this.selectedManufacturingCategory.set('代工'); // Reset category default
      this.selectedSupplierFilter.set(''); // Ensure supplier filter is clear at start
      this.initForm();
      const user = this.dataService.currentUser();
      if(user) this.orderForm.patchValue({ salesperson: user.name });
  }
  
  selectBrand(brand: Brand) { 
      this.selectedBrand.set(brand); 
      this.goToCompany(); // Auto advance
  }
  
  selectCompany(company: CompanyProfile) { 
      this.selectedCompany.set(company);
      this.orderForm.patchValue({ sellerName: company.name });
      this.goToCustomer(); // Auto advance
  }
  
  selectCustomer(c: Customer) {
      this.selectedCustomer.set(c);
      const recName = c.receiver1?.trim() ? c.receiver1 : c.shortName;
      const recPhone = c.phone1?.trim() ? c.phone1 : (c.mobile?.trim() ? c.mobile : c.phone);
      const recAddress = c.address1;
      this.orderForm.patchValue({
          customerId: c.id,
          customerName: c.shortName,
          receiverName: recName,
          receiverPhone: recPhone,
          receiverAddress: recAddress,
          receiverName2: c.receiver2 || '',
          receiverPhone2: c.phone2 || '',
          receiverAddress2: c.address2 || '',
          orderTaxType: c.taxType,
          paymentTerms: c.clientPaymentTerms || '先匯款' // Ensure Customer Default Terms is loaded with fallback
      });
      this.currentReceiverSource.set(1);
      this.wizardSearchTerm.set('');
      this.goToProducts(); // Auto advance
  }

  // --- Step Navigation Methods ---
  goToCompany() { this.currentStep.set('select-company'); }
  goToCustomer() { this.currentStep.set('select-customer'); }
  goToProducts() { this.currentStep.set('select-products'); }

  // --- Step 5: Manufacturing ---
  goToManufacturing() {
      this.currentStep.set('select-manufacturing');
      this.wizardSearchTerm.set('');
      this.selectedManufacturingCategory.set('代工'); // Reset category default
      this.selectedSupplierFilter.set('ET'); // Set Supplier 'ET'
  }

  goToExtras() {
      this.currentStep.set('select-extras');
  }

  goToFillInfo() {
      this.currentStep.set('fill-info');
  }

  goToReview() { 
      this.currentStep.set('review-summary'); 
  }
  
  goBack() {
      const step = this.currentStep();
      switch (step) {
          case 'select-company': this.currentStep.set('select-brand'); break;
          case 'select-customer': this.currentStep.set('select-company'); break;
          case 'select-products': this.currentStep.set('select-customer'); break;
          
          // Flow: Products -> Manufacturing -> Extras -> CartAdjust -> FillInfo -> Review
          
          case 'select-manufacturing': this.currentStep.set('select-products'); break;
          case 'select-extras': this.currentStep.set('select-manufacturing'); break;
          case 'cart-adjust': this.currentStep.set('select-extras'); break; // Was select-products
          case 'fill-info': this.currentStep.set('cart-adjust'); break; // Was select-extras
          case 'review-summary': this.currentStep.set('fill-info'); break;
          case 'communication': this.currentStep.set('review-summary'); break;
      }
  }

  goToCartAdjust() {
      this.currentStep.set('cart-adjust');
  }

  cancelWizard() {
      if (confirm('確定要取消嗎？所有資料將會遺失。')) {
          this.currentStep.set('list');
          this.cart.set([]);
          this.editingOrderId.set(null);
      }
  }

  onWizardSearchChange(event: Event) { this.wizardSearchTerm.set((event.target as HTMLInputElement).value); }
  
  setReceiverSource(source: 1 | 2) {
      const cust = this.selectedCustomer();
      if (!cust) return;
      this.currentReceiverSource.set(source);
      if (source === 1) {
          const recName = cust.receiver1?.trim() ? cust.receiver1 : cust.shortName;
          const recPhone = cust.phone1?.trim() ? cust.phone1 : (cust.mobile?.trim() ? cust.mobile : cust.phone);
          const recAddress = cust.address1;
          this.orderForm.patchValue({ receiverName: recName, receiverPhone: recPhone, receiverAddress: recAddress });
      } else {
          this.orderForm.patchValue({ receiverName: cust.receiver2 || '', receiverPhone: cust.phone2 || '', receiverAddress: cust.address2 || '' });
      }
  }

  onCategoryChange(event: Event) { this.selectedCategory.set((event.target as HTMLSelectElement).value); }
  onManufacturingCategoryChange(event: Event) { this.selectedManufacturingCategory.set((event.target as HTMLSelectElement).value); }
  onSupplierFilterChange(event: Event) { this.selectedSupplierFilter.set((event.target as HTMLSelectElement).value); }
  isInCart(productId: string) { return this.cart().some(i => i.product.id === productId); }
  getCartItem(productId: string): CartItem | undefined { return this.cart().find(i => i.product.id === productId); }
  
  // Helper to get all cart items that belong to a specific base product (for variants like OEM)
  getCartItemsByBaseId(baseId: string): CartItem[] {
      return this.cart().filter(item => {
          // Exact match
          if (item.product.id === baseId) return true;
          
          // Strict Variant match: Check if prefix before last dash matches exactly
          const lastDashIndex = item.product.id.lastIndexOf('-');
          if (lastDashIndex > 0) {
              const extractedBase = item.product.id.substring(0, lastDashIndex);
              return extractedBase === baseId;
          }
          
          return false;
      });
  }

  updateCartQty(productId: string, delta: number) {
      this.cart.update(items => {
          const item = items.find(i => i.product.id === productId);
          if (item) {
              const newQty = item.quantity + delta;
              if (newQty <= 0) return items.filter(i => i.product.id !== productId);
              return items.map(i => i.product.id === productId ? { ...i, quantity: newQty, quantityForOrder: i.quantityForOrder + delta } : i);
          }
          return items;
      });
  }

  addToCart(product: Product) {
      if (product.id === 'FEE-DLV-HM') this.orderForm.patchValue({ shipLogistics: '黑貓' });
      else if (product.id === 'FEE-DLV-DR') this.orderForm.patchValue({ shipLogistics: '大榮' });

      // Determine if this is a manufacturing item
      // Logic: Explicit category OR we are in the manufacturing selection step
      const isManufacturingStep = this.currentStep() === 'select-manufacturing';
      const isManufacturingProduct = ['代工', 'OEM', '加工'].includes(product.category);
      
      // Force Mfg flag if added from Mfg step or is explicitly OEM product
      if (isManufacturingStep || isManufacturingProduct) {
          this.orderForm.patchValue({ isManufacturingOrder: true });
          
          // OEM Variant Logic
          const regex = new RegExp(`^${product.id}-\\d{2}$`);
          const existingVariants = this.cart().filter(i => regex.test(i.product.id));
          let nextSuffix = 1;
          if (existingVariants.length > 0) {
              const max = Math.max(...existingVariants.map(i => {
                  const parts = i.product.id.split('-');
                  const numStr = parts[parts.length - 1];
                  return parseInt(numStr, 10) || 0;
              }));
              nextSuffix = max + 1;
          }
          const suffixStr = nextSuffix.toString().padStart(2, '0');
          const newId = `${product.id}-${suffixStr}`;
          const variantProduct = { ...product, id: newId, name: `${product.name} (#${suffixStr})` };
          
          this.cart.update(items => [...items, {
              product: variantProduct, name: variantProduct.name, quantity: product.moq || 1, quantityForOrder: product.moq || 1,
              price: product.priceBeforeTax, note: '', shippedQuantity: 0, pickingQuantity: 0, markup: 0
          }]);
          return;
      }

      this.cart.update(items => {
          const existingIndex = items.findIndex(i => i.product.id === product.id);
          if (existingIndex > -1) {
              const item = items[existingIndex];
              const newQty = item.quantity + (product.moq || 1);
              const newItems = [...items];
              newItems[existingIndex] = { ...item, quantity: newQty, quantityForOrder: newQty };
              return newItems;
          } else {
              return [...items, {
                  product: product, name: product.name, quantity: product.moq || 1, quantityForOrder: product.moq || 1,
                  price: product.priceBeforeTax, note: '', shippedQuantity: 0, pickingQuantity: 0, markup: 0
              }];
          }
      });
  }

  removeFromCart(productId: string) { this.cart.update(items => items.filter(i => i.product.id !== productId)); }
  onQtyInput(productId: string, event: Event) {
      const val = parseInt((event.target as HTMLInputElement).value, 10);
      if (!isNaN(val) && val > 0) this.cart.update(items => items.map(i => i.product.id === productId ? { ...i, quantity: val } : i));
  }
  onPriceInput(productId: string, event: Event) {
      const val = parseFloat((event.target as HTMLInputElement).value);
      if (!isNaN(val)) this.cart.update(items => items.map(i => i.product.id === productId ? { ...i, price: val, markup: i.product.priceBeforeTax > 0 ? Math.round(((val / i.product.priceBeforeTax) - 1) * 1000) / 10 : 0 } : i));
  }
  onMarkupInput(productId: string, event: Event) {
      const val = parseFloat((event.target as HTMLInputElement).value);
      if (!isNaN(val)) this.cart.update(items => items.map(i => i.product.id === productId ? { ...i, markup: val, price: Math.round(i.product.priceBeforeTax * (1 + val / 100)) } : i));
  }
  onNoteInput(productId: string, event: Event) {
      const val = (event.target as HTMLInputElement).value;
      this.cart.update(items => items.map(i => i.product.id === productId ? { ...i, note: val } : i));
  }
  onNameInput(productId: string, event: Event) {
      const val = (event.target as HTMLInputElement).value;
      this.cart.update(items => items.map(i => i.product.id === productId ? { ...i, name: val } : i));
  }
  
  // Revised saveOrderProgress with optional notification
  async saveOrderProgress(showNotification: boolean = true) {
      // Basic validation for minimal draft saving
      if (this.cart().length === 0) {
          if (showNotification) alert('請至少選擇一項商品才能儲存進度。');
          return;
      }
      
      const formVal = this.orderForm.getRawValue(); // Use getRawValue to include any disabled fields
      
      // Validation Check
      if (!formVal.customerId) {
          if (showNotification) alert('尚未選擇客戶，無法儲存。');
          return;
      }
      
      if (!formVal.orderDate) {
          if (showNotification) alert('訂單日期為必填');
          return;
      }

      // Calculate ID if new
      const dateCompact = formVal.orderDate.replace(/-/g, '');
      let baseOrderId = this.editingOrderId() || (formVal.orderId ? formVal.orderId : null);
      
      if (!baseOrderId) {
          // Check if temp ID already generated in session
          baseOrderId = this.tempOrderId();
          if (!baseOrderId) {
              baseOrderId = this.generateNextOrderId(dateCompact);
              this.tempOrderId.set(baseOrderId);
          }
      } else {
          // If editing existing, delete old lines to overwrite
          const itemsToDelete = this.orders().filter(o => o.orderId === baseOrderId || o.orderId.startsWith(baseOrderId + '-'));
          if (itemsToDelete.length > 0) {
              const deletePromises = itemsToDelete.map(o => this.dataService.deleteOrder(o.orderId));
              await Promise.all(deletePromises);
          }
      }

      const items = this.cart();
      const orderObjects: Order[] = items.map((item, index) => {
          const suffix = (index + 1).toString().padStart(2, '0');
          const lineTotal = item.price * item.quantity;
          
          return {
              orderId: `${baseOrderId}-${suffix}`,
              orderDate: formVal.orderDate,
              status: formVal.status || '處理中', // Default to Processing if not set
              customerId: formVal.customerId,
              customerName: formVal.customerName,
              salesperson: formVal.salesperson,
              sellerName: formVal.sellerName || '公司大平台',
              brandName: this.selectedBrand()?.nameTw || formVal.brandName || '',
              productId: item.product.id,
              productName: item.name,
              productNote: item.note || '',
              quantity: item.quantity,
              quantityForOrder: item.quantityForOrder || item.quantity,
              unit: item.product.unit,
              shippedQuantity: item.shippedQuantity || 0,
              pickingQuantity: item.pickingQuantity || 0,
              manufacturedQuantity: item.product.id.includes('-') ? 0 : 0, 
              packingQuantity: 0,
              priceBeforeTax: item.price,
              subtotal: lineTotal,
              taxAmount: 0, 
              totalAmount: lineTotal, 
              shipLogistics: formVal.shipLogistics,
              shippingId: formVal.shippingId,
              trackingUrl: formVal.trackingUrl,
              invoiceNumber: formVal.invoiceNumber,
              orderTaxType: formVal.orderTaxType,
              paymentStatus: formVal.paymentStatus,
              paymentTerms: formVal.paymentTerms,
              paymentDueDate: formVal.paymentDueDate,
              codAmount: formVal.codAmount || 0,
              receiverName: formVal.receiverName,
              receiverPhone: formVal.receiverPhone,
              receiverAddress: formVal.receiverAddress,
              receiverName2: formVal.receiverName2,
              receiverPhone2: formVal.receiverPhone2,
              receiverAddress2: formVal.receiverAddress2,
              specialRequests: formVal.specialRequests,
              manufacturingStatus: formVal.manufacturingStatus || '備料中',
              estimatedCompletionDate: formVal.estimatedCompletionDate || '',
              requestedShippingDate: formVal.requestedShippingDate || '',
              manufacturingPriority: formVal.manufacturingPriority || false,
              isManufacturingOrder: formVal.isManufacturingOrder || false,
              isSampleOrder: formVal.isSampleOrder || false
          };
      });
      
      // Calc Totals
      if (this.isOrderTaxable()) {
          const ratio = 1.05;
          const globalSubtotal = orderObjects.reduce((sum, o) => sum + o.subtotal, 0);
          const globalTotal = Math.round(globalSubtotal * ratio);
          const globalTax = globalTotal - globalSubtotal;
          let currentTaxSum = 0;
          orderObjects.forEach((o, index) => {
              let lineTax = Math.round(o.subtotal * 0.05);
              if (index === orderObjects.length - 1) lineTax = globalTax - currentTaxSum;
              o.taxAmount = lineTax;
              o.totalAmount = o.subtotal + lineTax;
              currentTaxSum += lineTax;
          });
      } else {
          orderObjects.forEach(o => { o.totalAmount = o.subtotal; o.taxAmount = 0; });
      }

      // Sanitize to remove undefined values which crash Firestore
      const cleanOrders = orderObjects.map(o => JSON.parse(JSON.stringify(o)));

      await this.dataService.addOrders(cleanOrders);
      
      // Set editing mode so next save updates this record
      this.editingOrderId.set(baseOrderId);
      
      if (showNotification) {
          alert('進度已儲存！');
      }
  }

  async submitWizardOrder() {
      // 1. Validation Check with UX Feedback
      if (this.orderForm.invalid) {
          this.orderForm.markAllAsTouched(); 
          
          // Identify invalid controls for better feedback
          const invalidControls = [];
          const controls = this.orderForm.controls;
          for (const name in controls) {
              if (controls[name].invalid) {
                  // Map field name to human readable (simplified)
                  let label = name;
                  if(name === 'paymentDueDate') label = '約定貨款日';
                  if(name === 'orderDate') label = '訂單日期';
                  if(name === 'customerId') label = '客戶';
                  if(name === 'salesperson') label = '負責業務';
                  invalidControls.push(label);
              }
          }

          alert(`訂單資訊不完整，無法建立。\n請檢查以下欄位：${invalidControls.join(', ')}`);
          
          // If payment/date fields are missing (likely in Step 7), send back to Step 7
          if (controls['paymentDueDate'].invalid || controls['orderDate'].invalid || controls['salesperson'].invalid) {
               this.currentStep.set('fill-info');
          }
          return;
      }

      if (this.cart().length === 0) { 
          alert('請至少選擇一項商品'); 
          return; 
      }
      
      try {
          // 2. Perform Save
          await this.saveOrderProgress(false);
          
          // 3. System Message (Requested Update)
          const action = this.editingOrderId() ? '更新' : '建立';
          alert(`系統通知：訂單已${action}成功！\n即將進入單據預覽頁面。`);

          // 4. Transition to Communication/Print Step
          const baseOrderId = this.editingOrderId();
          const formVal = this.orderForm.getRawValue();
          const items = this.cart();
          
          this.generateCommunicationText(baseOrderId!, formVal, items);
          this.currentStep.set('communication');
          
      } catch (e: any) {
          console.error('Order Submit Error:', e);
          // Show actual error message
          alert(`儲存失敗: ${e.message || '未知錯誤'}`);
      }
  }

  generateCommunicationText(orderId: string, form: any, items: CartItem[]) {
      const defaultTpl = this.orderTemplatesData().find(t => t.isSystemDefault) || this.orderTemplatesData()[0];
      if (defaultTpl) this.applyTemplate(defaultTpl.id);
  }

  applyTemplate(tplId: string) {
      this.selectedTemplateId.set(tplId);
      const template = this.communicationTemplates().find(t => t.id === tplId);
      if (!template) return;
      const orderId = this.tempOrderId() || this.editingOrderId() || 'ORD-NEW';
      const form = this.orderForm.getRawValue();
      const items = this.cart();
      
      const currentLogistics = form.shipLogistics;
      const isSpecialLogistics = ['黑貓', '大榮'].includes(currentLogistics);

      const filteredItems = items.filter(i => !isSpecialLogistics || i.product.isCalculable !== false);

      const itemsList = filteredItems.map((i, idx) => `${idx + 1}. ${i.name} x ${i.quantity} ${i.product.unit}`).join('\n');
      const subtotal = items.reduce((sum, i) => sum + i.price * i.quantity, 0);
      const isTax = this.isOrderTaxable();
      const total = isTax ? Math.round(subtotal * 1.05) : subtotal;
      const totalOutstanding = filteredItems.reduce((sum, i) => sum + (i.quantity - (i.shippedQuantity || 0)), 0);
      const outstandingItemsStr = filteredItems.map(i => {
              const remaining = i.quantity - (i.shippedQuantity || 0);
              return remaining > 0 ? `${i.name} x ${remaining}` : null;
          }).filter(item => item !== null).join('\n');
      const data: any = {
          orderId: orderId,
          customerName: form.customerName,
          items: itemsList,
          totalAmount: `$${this.decimalPipe.transform(total)}`,
          codAmount: `$${this.decimalPipe.transform(form.codAmount || 0)}`,
          receiverName: form.receiverName,
          receiverPhone: form.receiverPhone,
          receiverAddress: form.receiverAddress,
          logistics: form.shipLogistics,
          trackingId: form.shippingId || '尚未產生',
          trackingUrl: form.trackingUrl || '',
          shippingDate: '待定',
          companyName: this.dataService.systemSettings().companyName,
          outstandingQuantity: totalOutstanding.toString(),
          outstandingItems: outstandingItemsStr || '無'
      };
      let content = template.content;
      Object.keys(data).forEach(key => {
          const regex = new RegExp(`{{${key}}}`, 'g');
          content = content.replace(regex, data[key]);
      });
      this.communicationText.set(content);
  }

  copyAndFinish() {
      navigator.clipboard.writeText(this.communicationText()).then(() => {
          alert('已複製到剪貼簿！');
          this.finishWizard();
      });
  }

  finishWizard() {
      this.currentStep.set('list');
      this.editingOrderId.set(null);
      this.tempOrderId.set(null);
  }

  // --- REVISED: Customer History Items (Top 8 Frequent) ---
  customerHistoryItems = computed(() => {
    const cust = this.selectedCustomer();
    if (!cust) return [];
    
    const custOrders = this.orders().filter(o => o.customerId === cust.id && !this.SHIPPING_FEE_IDS.includes(o.productId));
        
    const itemMap = new Map<string, { product: Product, count: number, lastDate: string }>();
    const allProducts = this.products();
    
    custOrders.forEach(o => {
       let lookupId = o.productId;
       let prod = allProducts.find(p => p.id === lookupId);
       // Handle variants
       if (!prod && lookupId.includes('-')) {
           lookupId = lookupId.substring(0, lookupId.lastIndexOf('-'));
           prod = allProducts.find(p => p.id === lookupId);
       }
       if (prod) {
           if (!itemMap.has(prod.id)) { 
               itemMap.set(prod.id, { product: prod, count: 0, lastDate: o.orderDate }); 
           }
           const entry = itemMap.get(prod.id)!;
           entry.count += 1;
           // Keep latest date
           if (o.orderDate > entry.lastDate) entry.lastDate = o.orderDate;
       }
    });
    
    // Sort by Count Descending (Frequency), then Last Date Descending
    return Array.from(itemMap.values())
        .sort((a, b) => {
            const countDiff = b.count - a.count;
            if (countDiff !== 0) return countDiff;
            return b.lastDate.localeCompare(a.lastDate);
        })
        .slice(0, 8); 
  });

  // Filter regular products (Excluding Manufacturing '代工' unless requested in other context, but here we exclude them for Step 4)
  wizardFilteredProducts = computed(() => {
    const term = this.wizardSearchTerm().toLowerCase();
    const cat = this.selectedCategory();
    const supFilter = this.selectedSupplierFilter();
    
    return this.products().filter(product => {
        // Exclude manufacturing products from standard product selection step
        // if (product.category === '代工') return false; // REMOVED per user request

        const matchesSearch = !term || (
            product.name.toLowerCase().includes(term) || 
            product.id.toLowerCase().includes(term)
        );
        const matchesCategory = !cat || product.category === cat;
        const matchesSupplier = !supFilter || product.supplierCode === supFilter;
        const isNotFee = !this.SHIPPING_FEE_IDS.includes(product.id);
        
        return matchesSearch && matchesCategory && matchesSupplier && isNotFee && !product.isDiscontinued;
    });
  });

  // NEW: Filter ONLY Manufacturing products for Step 5
  wizardFilteredManufacturingProducts = computed(() => {
    const term = this.wizardSearchTerm().toLowerCase();
    const supFilter = this.selectedSupplierFilter();
    const catFilter = this.selectedManufacturingCategory(); // Use new filter signal
    
    return this.products().filter(product => {
        // Only include manufacturing products or matching category filter
        // If filter is present, strict match. If empty, allow all (but logic implies only '代工' here usually)
        // Revised logic: Always filter for '代工' OR selected category if specified. 
        // But since we want to allow user to pick other items if they change the filter:
        if (catFilter && product.category !== catFilter) return false;
        // If no filter selected (all), still default context of this step is Manufacturing? 
        // Let's stick to the filter driving it. If filter is empty, show all? Or show '代工'?
        // The prompt says "Default to '代工'". So the filter signal handles the logic.
        // If user clears filter, show all.
        
        const matchesSearch = !term || (
            product.name.toLowerCase().includes(term) || 
            product.id.toLowerCase().includes(term)
        );
        const matchesSupplier = !supFilter || product.supplierCode === supFilter;
        
        return matchesSearch && matchesSupplier && !product.isDiscontinued;
    });
  });

  cartTotal = computed(() => {
    const subtotal = this.cart().reduce((sum, item) => sum + (item.price * item.quantity), 0);
    const isTaxable = this.isOrderTaxable(); 
    const taxRate = isTaxable ? 0.05 : 0;
    const tax = Math.round(subtotal * taxRate * 100) / 100;
    const total = Math.round((subtotal + tax) * 100) / 100;
    return { subtotal: Math.round(subtotal * 100) / 100, tax, total };
  });

  cartShippingItems = computed(() => { return this.cart().filter(i => this.SHIPPING_FEE_IDS.includes(i.product.id)); });

  getShippingProduct(id: string): Product {
      const existingProduct = this.products().find(p => p.id === id);
      if (existingProduct) return existingProduct;
      let name = '運費'; let price = 0;
      switch(id) {
          case 'FEE-DLV-HM': name = '運費(黑貓)'; price = 0; break;
          case 'FEE-DLV-DR': name = '運費(大榮)'; price = 0; break;
          case 'FEE-DIS-DLV': name = '運費折讓'; price = 0; break;
          case 'FEE-DIS-Product': name = '貨價折讓'; price = 0; break;
      }
      return {
          id: id, name: name, priceBeforeTax: price, stock: 9999, safetyStock: 0, allocatedStock: 0, externalStock: 0, transitQuantity: 0, totalPickingQuantity: 0,
          category: '費用', unit: '次', priceAfterTax: price, costBeforeTax: 0, costAfterTax: 0, recommendedPrice: price, supplierCode: 'INTERNAL', supplierName: '內部費用',
          controlStatus: false, purchasingStatus: false, moq: 1, packageType: 1, isDiscontinued: false, isCalculable: false, qualityConfirmed: 0,
          origin: 'TW', sugar: false, shelfLife: '', expiryNote: '', highlightNote: '', notes: '', imageUrl: '', lastUpdated: new Date().toISOString()
      };
  }

  // Computed list of products for the extras step
  extrasList = computed(() => {
      return this.EXTRA_IDS.map(id => this.getShippingProduct(id));
  });

  shippingFeeDefinitions = computed(() => {
      return {
          hm: this.getShippingProduct('FEE-DLV-HM'),
          dr: this.getShippingProduct('FEE-DLV-DR'),
          disDlv: this.getShippingProduct('FEE-DIS-DLV'),
          disPrd: this.getShippingProduct('FEE-DIS-Product')
      };
  });

  getCartPrice(id: string): number { const item = this.cart().find(i => i.product.id === id); return item ? item.price : 0; }
  getCartVariantCount(baseId: string): number { return this.cart().filter(i => i.product.id.startsWith(baseId)).length; }
  
  onSearchTermChange(event: Event) { this.searchTerm.set((event.target as HTMLInputElement).value); }

  toggleOrderNote(orderId: string): void {
    const current = new Set(this.expandedOrderNotes());
    if (current.has(orderId)) {
      current.delete(orderId);
    } else {
      current.add(orderId);
    }
    this.expandedOrderNotes.set(current);
  }
  onCompanyFilterChange(event: Event) { this.selectedCompanyFilter.set((event.target as HTMLSelectElement).value); }
  onBrandFilterChange(event: Event) { this.selectedBrandFilter.set((event.target as HTMLSelectElement).value); }
  
  // Updated onStatusFilterChange to accept Event
  onStatusFilterChange(event: Event) { 
      this.selectedStatusFilter.set((event.target as HTMLSelectElement).value); 
  }
  
  onPaymentStatusFilterChange(event: Event) {
      this.selectedPaymentStatusFilter.set((event.target as HTMLSelectElement).value);
  }

  onOrderTypeFilterChange(event: Event) { this.selectedOrderTypeFilter.set((event.target as HTMLSelectElement).value); }
  toggleOemFilter() { if (this.selectedCategory() === '代工') this.selectedCategory.set(''); else this.selectedCategory.set('代工'); }
  updatePaymentStatus(baseOrderId: string, event: Event) {
      const input = event.target as HTMLInputElement;
      const isPaid = input.checked;
      const group = this.groupedOrders().find(g => g.baseOrderId === baseOrderId);
      if (group) {
          const updates = group.items.map(item => ({ ...item, paymentStatus: isPaid }));
          this.dataService.updateOrders(updates);
      }
  }
  updateCustomerLineId(customerId: string, event: Event) {
      const val = (event.target as HTMLInputElement).value.trim();
      const customer = this.customers().find(c => c.id === customerId);
      if (customer && customer.lineId !== val) {
          const updatedCustomer = { ...customer, lineId: val };
          this.dataService.updateCustomer(updatedCustomer);
      }
  }
  
  // New Toggle for Action Required Filter
  toggleActionRequiredFilter() {
      if (this.selectedStatusFilter() === 'ACTION_REQUIRED') {
          this.selectedStatusFilter.set('');
      } else {
          this.selectedStatusFilter.set('ACTION_REQUIRED');
      }
  }

  editOrderGroup(group: GroupedOrder) {
      this.editingOrderId.set(group.baseOrderId);
      const cust = this.customers().find(c => c.id === group.customerId);
      this.selectedCustomer.set(cust || null);
      const brand = this.brands().find(b => b.nameTw === group.brandName);
      this.selectedBrand.set(brand || null);
      const company = this.companies().find(c => c.name === group.sellerName);
      this.selectedCompany.set(company || null);
      const mergedItems = new Map<string, CartItem>();
      const productMap = new Map<string, Product>(this.products().map(p => [p.id, p] as [string, Product]));
      group.items.forEach(orderItem => {
          let product = productMap.get(orderItem.productId);
          if (!product && orderItem.productId.includes('-')) {
              const baseId = orderItem.productId.substring(0, orderItem.productId.lastIndexOf('-'));
              const baseProduct = productMap.get(baseId);
              if (baseProduct) product = { ...baseProduct, id: orderItem.productId };
          }
          const safeProduct = product || { id: orderItem.productId, name: orderItem.productName, priceBeforeTax: orderItem.priceBeforeTax, stock: 0, unit: '個', costBeforeTax: 0, category: '其他' } as any;
          let initialMarkup = 0;
          if (safeProduct.priceBeforeTax > 0 && orderItem.priceBeforeTax > 0) {
              initialMarkup = ((orderItem.priceBeforeTax / safeProduct.priceBeforeTax) - 1) * 100;
              initialMarkup = Math.round(initialMarkup * 10) / 10;
          }
          if (mergedItems.has(orderItem.productId)) {
              const existing = mergedItems.get(orderItem.productId)!;
              existing.quantity += orderItem.quantity;
              existing.quantityForOrder += (orderItem.quantityForOrder || orderItem.quantity);
              existing.shippedQuantity = (existing.shippedQuantity || 0) + (orderItem.shippedQuantity || 0);
              existing.pickingQuantity = (existing.pickingQuantity || 0) + (orderItem.pickingQuantity || 0);
              if (orderItem.productNote && !existing.note?.includes(orderItem.productNote)) {
                  existing.note = existing.note ? existing.note + '; ' + orderItem.productNote : orderItem.productNote;
              }
          } else {
              mergedItems.set(orderItem.productId, {
                  product: safeProduct, name: orderItem.productName, quantity: orderItem.quantity, quantityForOrder: orderItem.quantityForOrder || orderItem.quantity,
                  price: orderItem.priceBeforeTax, note: orderItem.productNote, shippedQuantity: orderItem.shippedQuantity || 0, pickingQuantity: orderItem.pickingQuantity || 0, markup: initialMarkup
              });
          }
      });
      this.cart.set(Array.from(mergedItems.values()));
      this.orderForm.patchValue({
          orderId: group.baseOrderId, orderDate: group.orderDate, status: group.status, salesperson: group.salesperson, sellerName: group.sellerName, brandName: group.brandName,
          customerId: group.customerId, customerName: group.customerName, orderTaxType: group.items[0].orderTaxType, paymentStatus: group.paymentStatus, 
          paymentTerms: group.items[0].paymentTerms, 
          paymentDueDate: group.items[0].paymentDueDate || '',
          shipLogistics: group.items[0].shipLogistics, receiverName: group.items[0].receiverName, receiverPhone: group.items[0].receiverPhone, receiverAddress: group.items[0].receiverAddress,
          receiverName2: group.items[0].receiverName2, receiverPhone2: group.items[0].receiverPhone2, receiverAddress2: group.items[0].receiverAddress2,
          specialRequests: group.items[0].specialRequests, requestedShippingDate: group.items[0].requestedShippingDate, manufacturingPriority: group.items[0].manufacturingPriority,
          isManufacturingOrder: group.items[0].isManufacturingOrder, isSampleOrder: group.isSampleOrder, codAmount: group.items[0].codAmount || 0
      });
      this.isOrderTaxable.set(!!group.items[0].orderTaxType);
      this.currentStep.set('review-summary');
  }
  copyOrderGroup(group: GroupedOrder) {
      this.editingOrderId.set(null);
      this.tempOrderId.set(null);
      const cust = this.customers().find(c => c.id === group.customerId);
      this.selectedCustomer.set(cust || null);
      const brand = this.brands().find(b => b.nameTw === group.brandName);
      this.selectedBrand.set(brand || null);
      const company = this.companies().find(c => c.name === group.sellerName);
      this.selectedCompany.set(company || null);
      const mergedItems = new Map<string, CartItem>();
      const productMap = new Map<string, Product>(this.products().map(p => [p.id, p] as [string, Product]));
      group.items.forEach(orderItem => {
          let product = productMap.get(orderItem.productId);
          if (!product && orderItem.productId.includes('-')) {
              const baseId = orderItem.productId.substring(0, orderItem.productId.lastIndexOf('-'));
              const baseProduct = productMap.get(baseId);
              if (baseProduct) product = { ...baseProduct, id: orderItem.productId };
          }
          const safeProduct = product || { id: orderItem.productId, name: orderItem.productName, priceBeforeTax: orderItem.priceBeforeTax, stock: 0, unit: '個', costBeforeTax: 0, category: '其他' } as any;
          let initialMarkup = 0;
          if (safeProduct.priceBeforeTax > 0 && orderItem.priceBeforeTax > 0) {
              initialMarkup = ((orderItem.priceBeforeTax / safeProduct.priceBeforeTax) - 1) * 100;
              initialMarkup = Math.round(initialMarkup * 10) / 10;
          }
          if (mergedItems.has(orderItem.productId)) {
              const existing = mergedItems.get(orderItem.productId)!;
              existing.quantity += orderItem.quantity;
              existing.quantityForOrder += (orderItem.quantityForOrder || orderItem.quantity);
              if (orderItem.productNote && !existing.note?.includes(orderItem.productNote)) {
                  existing.note = existing.note ? existing.note + '; ' + orderItem.productNote : orderItem.productNote;
              }
          } else {
              mergedItems.set(orderItem.productId, {
                  product: safeProduct, name: orderItem.productName, quantity: orderItem.quantity, quantityForOrder: orderItem.quantityForOrder || orderItem.quantity,
                  price: orderItem.priceBeforeTax, note: orderItem.productNote, shippedQuantity: 0, pickingQuantity: 0, markup: initialMarkup
              });
          }
      });
      this.cart.set(Array.from(mergedItems.values()));
      const today = new Date().toISOString().split('T')[0];
      const firstItem = group.items[0];
      this.orderForm.patchValue({
          orderId: '', orderDate: today, status: '處理中', paymentStatus: false, paymentDueDate: '',
          salesperson: firstItem.salesperson, sellerName: firstItem.sellerName, brandName: firstItem.brandName, customerId: firstItem.customerId, customerName: firstItem.customerName, orderTaxType: firstItem.orderTaxType,
          paymentTerms: firstItem.paymentTerms,
          shipLogistics: firstItem.shipLogistics, receiverName: firstItem.receiverName, receiverPhone: firstItem.receiverPhone, receiverAddress: firstItem.receiverAddress,
          receiverName2: firstItem.receiverName2, receiverPhone2: firstItem.receiverPhone2, receiverAddress2: firstItem.receiverAddress2,
          specialRequests: firstItem.specialRequests, requestedShippingDate: '', manufacturingPriority: firstItem.manufacturingPriority, isManufacturingOrder: firstItem.isManufacturingOrder, isSampleOrder: group.isSampleOrder, codAmount: 0
      });
      this.isOrderTaxable.set(!!firstItem.orderTaxType);
      this.currentStep.set('review-summary');
  }
  deleteOrderGroup(group: GroupedOrder) {
      if(confirm(`確定要刪除訂單 ${group.baseOrderId} 嗎？此動作無法復原。`)) {
          group.items.forEach(item => { this.dataService.deleteOrder(item.orderId); });
      }
  }
}
