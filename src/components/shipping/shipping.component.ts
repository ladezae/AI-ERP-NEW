
import { ChangeDetectionStrategy, Component, computed, inject, signal, HostListener } from '@angular/core';
import { CommonModule, DecimalPipe } from '@angular/common';
import { ReactiveFormsModule, FormBuilder, FormGroup, Validators, FormsModule } from '@angular/forms';
import { DataService } from '../../services/data.service';
import { AiService } from '../../services/ai.service';
import { OrderService } from '../../services/order.service';
import { Order, Product, ShippingTemplate, CommunicationTemplate, ShippingOrder, Customer } from '../../models/erp.models';
import { ResizableDirective } from '../../directives/resizable.directive';
import { TaiwanDatePipe } from '../../pipes/taiwan-date.pipe';

type ShippingStep = 'list' | 'shipping-execution' | 'logistics-ocr' | 'shipping-notification';
type ShippingTab = 'pending' | 'history';

interface ShippingItem {
  order: Order;
  product: Product;
  orderedQty: number;
  shippedQty: number;
  pickingQty: number; // Added: Editable Picking Quantity
  currentShipQty: number;
}

interface GroupedOrder {
  baseOrderId: string;
  orderDate: string;
  customerName: string;
  customerId: string;
  salesperson: string;
  status: string;
  items: Order[];        // All items
  displayItems: Order[]; // Filtered items (no fees) for display/shipping
  totalAmount: number;
  shipmentCount: number; 
  clientPaymentTerms?: string; // Added: Customer Payment Terms
  customerLineId?: string; // Added: Customer LINE ID
}

// New Interface for Grouped History Display
interface ShipmentBatch {
  batchNo: string;
  date: string;
  logistics: string;
  trackingId: string;
  trackingUrl: string;
  productsSummary: string; // e.g. "Apple x 10, Banana x 5"
  records: ShippingOrder[]; // Underlying records
}

interface HistoryGroup {
  baseOrderId: string;
  customerName: string;
  salesperson: string; // Derived from records logic if possible, or leave empty if not stored in shipping order
  batches: ShipmentBatch[];
  status: string; // Added: Order Status
  closedAt?: string; // Added: Order Closed Time
  isManufacturingOrder?: boolean; // Added: Manufacturing Order Flag
}

@Component({
  selector: 'app-shipping',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CommonModule, ReactiveFormsModule, FormsModule, ResizableDirective, TaiwanDatePipe],
  providers: [DecimalPipe],
  templateUrl: './shipping.component.html',
  styles: [`
    @keyframes scan {
      0% { top: 0%; opacity: 0; }
      5% { opacity: 1; }
      95% { opacity: 1; }
      100% { top: 100%; opacity: 0; }
    }
    .scan-line {
      position: absolute;
      left: 0;
      width: 100%;
      height: 3px;
      background: linear-gradient(to right, transparent, #6366f1, transparent); /* Indigo-500 */
      box-shadow: 0 0 8px rgba(99, 102, 241, 0.8);
      animation: scan 2s linear infinite;
      z-index: 50;
    }
    @keyframes slide-down {
      from { opacity: 0; transform: translateY(-10px); }
      to { opacity: 1; transform: translateY(0); }
    }
    .animate-slide-down {
      animation: slide-down 0.2s ease-out forwards;
    }
  `]
})
export class ShippingComponent {
  private dataService = inject(DataService);
  private aiService = inject(AiService);
  private orderService = inject(OrderService);
  private fb = inject(FormBuilder);
  private decimalPipe = inject(DecimalPipe); // Added injection

  // Data Signals
  orders = this.dataService.orders;
  products = this.dataService.products;
  shippingOrdersList = this.dataService.shippingOrders; // Database Level ShippingOrder Data
  shippingTemplates = this.dataService.shippingTemplates;
  communicationTemplates = this.dataService.communicationTemplates;

  // View State
  currentStep = signal<ShippingStep>('list');
  activeTab = signal<ShippingTab>('pending'); // New Tab State
  searchTerm = signal('');
  
  // Filters
  pendingStatusFilter = signal<string>('all'); // 'all' | '處理中' | '部份出貨'
  historyStatusFilter = signal<string>('all'); // 'all' | '已結案' | '已出貨' ...

  // Sorting State for History
  historySortBy = signal<'orderId' | 'closedAt'>('orderId');
  historySortDir = signal<'asc' | 'desc'>('desc');
  
  // Expanded State for History Groups
  expandedHistoryGroups = signal<Set<string>>(new Set());
  
  // Expanded State for Batches (New Feature)
  expandedBatches = signal<Set<string>>(new Set());

  // Expanded State for Pending Remarks (New)
  expandedRemarks = signal<Set<string>>(new Set());

  // Image Viewer State (Multi-image Support)
  viewerImages = signal<string[]>([]);
  viewerIndex = signal(0);
  currentViewImage = computed(() => {
      const imgs = this.viewerImages();
      const idx = this.viewerIndex();
      return (imgs && imgs.length > 0 && idx >= 0 && idx < imgs.length) ? imgs[idx] : null;
  });
  
  // Shipping Execution State
  editingOrderId = signal<string | null>(null);
  shippingItems = signal<ShippingItem[]>([]);
  shippingForm!: FormGroup;
  currentShipmentCount = signal(1); // N-th shipment
  
  // Edit History Batch State
  editingBatchNo = signal<string | null>(null);
  originalBatchMap = new Map<string, number>(); // Store old quantities for delta calc
  
  // Modal Edit State (Full Edit)
  showEditModal = signal(false);
  editMode = signal<'pending' | 'history'>('pending'); // Which type we are editing
  currentEditGroup = signal<GroupedOrder | null>(null); // For Pending edit
  currentEditRecord = signal<ShippingOrder | null>(null); // For History edit
  editForm!: FormGroup;

  // AI Logistics OCR State
  logisticsImages = signal<string[]>([]);
  isAnalyzingLogistics = signal(false);
  generatedShippingText = signal('');
  // Added ROI for visualization
  ocrResults = signal<{provider: string, trackingId: string, url: string, roi?: {x: number, y: number, width: number, height: number}}[]>([]);
  
  // Templates
  orderTemplates = computed(() => this.communicationTemplates().filter(t => t.type === 'order'));

  // STRICT LIST: Database level constraint for ShippingOrder
  readonly logisticsOptions = [
    '黑貓', 
    '大榮'
  ];

  constructor() {
    this.initShippingForm();
    this.initEditForm();
  }

  // --- New Computed: Pending Count (Action Required) ---
  pendingOrderCount = computed(() => {
      const rawOrders = this.orders();
      const products = this.products();
      // Pre-calculate calculable products for O(1) lookup
      const calculableMap = new Set<string>();
      products.forEach(p => {
          if (p.isCalculable !== false) calculableMap.add(p.id);
      });
      const ignoredIds = new Set(['FEE-DLV-HM', 'FEE-DLV-DR', 'FEE-DIS-DLV', 'FEE-DIS-Product']);

      const uniqueActionableIds = new Set<string>();
      
      rawOrders.forEach(o => {
          // 1. Status Filter: Must be active
          if (o.status === '已結案' || o.status === '取消' || o.status === '已出貨') return;
          
          // 2. Quantity Check: Must have remaining items
          const remaining = (o.quantity || 0) - (o.shippedQuantity || 0);
          if (remaining <= 0) return;

          // 3. Calculable Check: Must be a real product
          const isCalculable = calculableMap.has(o.productId) && !ignoredIds.has(o.productId);
          
          if (isCalculable) {
              const parts = o.orderId.split('-');
              const baseId = parts.length > 3 ? parts.slice(0, 3).join('-') : o.orderId;
              uniqueActionableIds.add(baseId);
          }
      });
      
      return uniqueActionableIds.size;
  });

  initShippingForm() {
    this.shippingForm = this.fb.group({
      logistics: ['黑貓'], // Use new field name
      shippingId: [''],
      trackingUrl: [''],
      specialRequests: [''] 
    });

    // Auto-generate Tracking URL when ID or Logistics changes
    const updateUrl = () => {
        const val = this.shippingForm.getRawValue();
        const id = val.shippingId;
        const provider = val.logistics;
        
        if (id && provider) {
            const tpl = this.shippingTemplates().find(t => t.logistics === provider);
            if (tpl && tpl.trackingUrlPattern) {
                const firstId = id.split(',')[0].trim();
                const newUrl = tpl.trackingUrlPattern.replace('{{id}}', firstId);
                
                if (this.shippingForm.get('trackingUrl')?.value !== newUrl) {
                    console.log("[Shipping] Auto-updating URL from template:", newUrl);
                    this.shippingForm.patchValue({ trackingUrl: newUrl }, { emitEvent: false });
                }
            }
        }
    };

    this.shippingForm.get('logistics')?.valueChanges.subscribe(updateUrl);
    this.shippingForm.get('shippingId')?.valueChanges.subscribe(updateUrl);
  }

  initEditForm() {
    this.editForm = this.fb.group({
      // Common / Pending Fields
      receiverName: [''],
      receiverPhone: [''],
      receiverAddress: [''],
      logistics: [''],
      specialRequests: [''],
      
      // History Specific Fields
      shippingId: [''],
      trackingUrl: [''],
      actualShippingDate: ['']
    });

    // Auto-generate Tracking URL for Edit Form (History Mode)
    const updateEditUrl = () => {
        if (this.editMode() !== 'history') return;

        const val = this.editForm.getRawValue();
        const id = val.shippingId;
        const provider = val.logistics;
        
        if (id && provider) {
            const tpl = this.shippingTemplates().find(t => t.logistics === provider);
            if (tpl && tpl.trackingUrlPattern) {
                const firstId = id.split(',')[0].trim();
                const newUrl = tpl.trackingUrlPattern.replace('{{id}}', firstId);
                
                if (this.editForm.get('trackingUrl')?.value !== newUrl) {
                    this.editForm.patchValue({ trackingUrl: newUrl }, { emitEvent: false });
                }
            }
        }
    };

    this.editForm.get('logistics')?.valueChanges.subscribe(updateEditUrl);
    this.editForm.get('shippingId')?.valueChanges.subscribe(updateEditUrl);
  }

  toggleRemark(baseOrderId: string, event: Event) {
      event.stopPropagation();
      this.expandedRemarks.update(set => {
          const newSet = new Set(set);
          if (newSet.has(baseOrderId)) {
              newSet.delete(baseOrderId);
          } else {
              newSet.add(baseOrderId);
          }
          return newSet;
      });
  }

  isRemarkExpanded(baseOrderId: string): boolean {
      return this.expandedRemarks().has(baseOrderId);
  }

  // --- Computed: Shipment History Grouped by Order ---
  historyGroups = computed(() => {
      const term = this.searchTerm().toLowerCase();
      const statusFilter = this.historyStatusFilter(); // Get status filter

      const list = this.shippingOrdersList();
      const allOrders = this.orders(); // Live orders for status lookup
      const groups: Record<string, HistoryGroup> = {};

      // 1. Group by Base Order ID
      list.forEach(record => {
          // Extract base Order ID (e.g. ORD-20260117-013-01 -> ORD-20260117-013)
          // Usually first 3 parts
          const parts = record.orderId.split('-');
          const baseId = parts.length >= 3 ? parts.slice(0, 3).join('-') : record.orderId;

          if (!groups[baseId]) {
              // Find live status and salesperson
              const orderRef = allOrders.find(o => o.orderId.startsWith(baseId));
              const currentStatus = orderRef ? orderRef.status : '未知';
              const salesperson = orderRef ? orderRef.salesperson : '';

              groups[baseId] = {
                  baseOrderId: baseId,
                  customerName: record.customerName,
                  salesperson: salesperson, // Map salesperson
                  batches: [],
                  status: currentStatus,
                  closedAt: orderRef?.closedAt, // Map closedAt
                  isManufacturingOrder: orderRef?.isManufacturingOrder // Map manufacturing flag
              };
          }

          // Group by BatchNo within Order
          const batchNo = record.batchNo || 'Unknown-Batch';
          let batch = groups[baseId].batches.find(b => b.batchNo === batchNo);
          
          if (!batch) {
              batch = {
                  batchNo: batchNo,
                  date: record.actualShippingDate,
                  logistics: record.logistics || record.shipLogistics,
                  trackingId: record.shippingId,
                  trackingUrl: record.trackingUrl,
                  productsSummary: '',
                  records: []
              };
              groups[baseId].batches.push(batch);
          }
          
          batch.records.push(record);
      });

      // 2. Process Summaries & Sorting
      let result = Object.values(groups).map(group => {
          // Process batches
          group.batches.forEach(batch => {
              batch.productsSummary = batch.records
                  .map(r => `${r.productName}${r.shippingQuantity ? ' x' + r.shippingQuantity : ''}`)
                  .join(', ');
          });
          // Sort batches desc (S2, S1...)
          group.batches.sort((a, b) => b.batchNo.localeCompare(a.batchNo));
          return group;
      });

      // 3. Filter
      // Search Term
      if (term) {
          result = result.filter(g => 
              g.baseOrderId.toLowerCase().includes(term) ||
              g.customerName.toLowerCase().includes(term) ||
              g.batches.some(b => 
                  b.batchNo.toLowerCase().includes(term) ||
                  b.trackingId.toLowerCase().includes(term) ||
                  b.productsSummary.toLowerCase().includes(term)
              )
          );
      }

      // Status Filter
      if (statusFilter !== 'all') {
          result = result.filter(g => g.status === statusFilter);
      }

      // 4. Sort Groups based on current criteria
      const sortBy = this.historySortBy();
      const sortDir = this.historySortDir() === 'asc' ? 1 : -1;

      return result.sort((a, b) => {
          if (sortBy === 'orderId') {
              return a.baseOrderId.localeCompare(b.baseOrderId) * sortDir;
          } else if (sortBy === 'closedAt') {
              const dateA = a.closedAt ? new Date(a.closedAt).getTime() : 0;
              const dateB = b.closedAt ? new Date(b.closedAt).getTime() : 0;
              // If dates are equal (e.g. both 0/unfinished), fallback to order ID
              if (dateA === dateB) {
                  return a.baseOrderId.localeCompare(b.baseOrderId) * sortDir;
              }
              return (dateA - dateB) * sortDir;
          }
          return 0;
      });
  });

  setHistorySort(sortBy: 'orderId' | 'closedAt') {
      if (this.historySortBy() === sortBy) {
          // Toggle direction
          this.historySortDir.update(d => d === 'asc' ? 'desc' : 'asc');
      } else {
          this.historySortBy.set(sortBy);
          this.historySortDir.set('desc'); // Default to desc for new criteria
      }
  }

  // --- Grouped Orders Logic (Filtered for Shipping Pending) ---
  shippingOrders = computed(() => {
    const term = this.searchTerm().toLowerCase();
    const statusFilter = this.pendingStatusFilter(); // Get pending filter

    const rawOrders = this.orders();
    const history = this.shippingOrdersList();
    const customers = this.dataService.customers(); // Get customers
    const customerMap = new Map<string, Customer>(customers.map(c => [c.id, c])); // Create map for lookup

    const groups: Record<string, GroupedOrder> = {};
    
    // Create product map for fast lookup
    const productMap = new Map<string, Product>(this.products().map(p => [p.id, p] as [string, Product]));

    rawOrders.forEach(o => {
        // Filter: Only show orders that are actionable for shipping
        if (o.status === '已結案' || o.status === '取消') return;

        const parts = o.orderId.split('-');
        const baseId = parts.length > 3 ? parts.slice(0, 3).join('-') : o.orderId;

        if (!groups[baseId]) {
            // Calculate previous shipments count for this order ID based on history DB
            // Look for existing batches matching SH-{core}-S...
            const coreId = baseId.replace('ORD-', '');
            const prefix = `SH-${coreId}-S`;
            
            const existingBatches = new Set(
                history
                    .filter(h => h.batchNo && h.batchNo.startsWith(prefix))
                    .map(h => h.batchNo)
            );

            // Lookup Customer
            const cust = customerMap.get(o.customerId);

            groups[baseId] = {
                baseOrderId: baseId,
                orderDate: o.orderDate,
                customerName: o.customerName,
                customerId: o.customerId,
                salesperson: o.salesperson,
                status: o.status,
                items: [],
                displayItems: [],
                totalAmount: 0,
                shipmentCount: existingBatches.size + 1, // Next shipment is N+1
                clientPaymentTerms: cust ? cust.clientPaymentTerms : '帳期後付',
                customerLineId: cust ? cust.lineId : '' // Populate LINE ID
            };
        }
        
        // Add to main list
        groups[baseId].items.push(o);

        // --- Logic for Display Items (Physical Products only) ---
        const product = productMap.get(o.productId);
        let isCalculable = true;
        if (product) {
            // Use DB property, default to true if undefined, explicit false check
            isCalculable = product.isCalculable !== false;
        } else {
            // Fallback for known fee IDs
            if (['FEE-DLV-HM', 'FEE-DLV-DR', 'FEE-DIS-DLV', 'FEE-DIS-Product'].includes(o.productId)) {
                isCalculable = false;
            }
        }

        // Logic: Only add to "Pending Shipping" display if NOT fully shipped
        const isFullyShipped = (o.shippedQuantity || 0) >= (o.quantity || 0);

        // Only add to display/shipping list if calculable AND still has items to ship
        if (isCalculable && !isFullyShipped) {
            groups[baseId].displayItems.push(o);
        }

        // Retain total amount including fees
        groups[baseId].totalAmount += o.totalAmount;
    });

    let groupedList = Object.values(groups);
    // Filter out groups that have no shippable items (e.g. all items fully shipped or only fees pending)
    groupedList = groupedList.filter(g => g.displayItems.length > 0);
    
    groupedList.sort((a, b) => b.baseOrderId.localeCompare(a.baseOrderId));

    // Apply Search Term Filter
    if (term) {
        groupedList = groupedList.filter(g => 
            g.baseOrderId.toLowerCase().includes(term) ||
            g.customerName.toLowerCase().includes(term) ||
            g.items.some(i => i.productName.toLowerCase().includes(term))
        );
    }
    
    // Apply Pending Status Filter
    if (statusFilter !== 'all') {
        groupedList = groupedList.filter(g => g.status === statusFilter);
    }

    return groupedList;
  });

  getGroupShippedQty(group: GroupedOrder): number {
      return group.items.reduce((sum, item) => sum + (item.shippedQuantity || 0), 0);
  }

  getGroupOrderedQty(group: GroupedOrder): number {
      return group.items
          .filter(i => !['FEE-DLV-HM', 'FEE-DLV-DR', 'FEE-DIS-DLV', 'FEE-DIS-Product'].includes(i.productId))
          .reduce((sum, item) => sum + (item.quantity || 0), 0);
  }

  // New: Copy Tracking Info for a batch
  copyBatchTracking(batch: ShipmentBatch) {
      if (typeof window === 'undefined') return;
      
      const text = `物流商: ${batch.logistics}\n單號: ${batch.trackingId}\n查詢網址: ${batch.trackingUrl}`;
      navigator.clipboard.writeText(text).then(() => {
          alert('物流資訊已複製！');
      }).catch(err => {
          console.error('Copy failed', err);
          alert('複製失敗，請手動選取。');
      });
  }

  // --- Image Handling Helpers ---
  
  openImageViewer(images: string[], startIndex: number = 0) {
      if (!images || images.length === 0) return;
      this.viewerImages.set(images);
      this.viewerIndex.set(startIndex);
  }

  closeImageViewer() {
      this.viewerImages.set([]);
      this.viewerIndex.set(0);
  }

  nextImage() {
      const len = this.viewerImages().length;
      if (len > 1) {
          this.viewerIndex.update(i => (i + 1) % len);
      }
  }

  prevImage() {
      const len = this.viewerImages().length;
      if (len > 1) {
          this.viewerIndex.update(i => (i - 1 + len) % len);
      }
  }

  // New: Copy current image to clipboard
  async copyCurrentImage() {
      const currentUrl = this.currentViewImage();
      if (!currentUrl) return;

      try {
          const response = await fetch(currentUrl);
          const blob = await response.blob();
          
          // Must ensure it's a PNG for best clipboard compatibility on some browsers
          const item = new ClipboardItem({ [blob.type]: blob });
          await navigator.clipboard.write([item]);
          alert('圖片已複製！(可直接在 LINE/Email 貼上)');
      } catch (err) {
          console.error('Image copy failed', err);
          alert('複製失敗，瀏覽器可能不支援此格式複製。請嘗試下載。');
      }
  }

  // New: Download current image
  downloadCurrentImage() {
      const currentUrl = this.currentViewImage();
      if (!currentUrl) return;
      
      const link = document.createElement('a');
      link.href = currentUrl;
      link.download = `shipping-image-${Date.now()}.jpg`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
  }

  private compressImage(base64: string): Promise<string> {
      return new Promise((resolve, reject) => {
          const img = new Image();
          img.src = base64;
          img.onload = () => {
              const canvas = document.createElement('canvas');
              let width = img.width;
              let height = img.height;
              const MAX_SIZE = 1200; // Increased for better OCR accuracy

              if (width > height) {
                  if (width > MAX_SIZE) {
                      height *= MAX_SIZE / width;
                      width = MAX_SIZE;
                  }
              } else {
                  if (height > MAX_SIZE) {
                      width *= MAX_SIZE / height;
                      height = MAX_SIZE;
                  }
              }

              canvas.width = width;
              canvas.height = height;
              const ctx = canvas.getContext('2d');
              if (ctx) {
                  ctx.drawImage(img, 0, 0, width, height);
                  const compressed = canvas.toDataURL('image/jpeg', 0.8);
                  resolve(compressed);
              } else {
                  resolve(base64); 
              }
          };
          img.onerror = (e) => resolve(base64); 
      });
  }

  // --- Actions ---

  setActiveTab(tab: ShippingTab) {
      this.activeTab.set(tab);
      this.searchTerm.set(''); // Clear search when switching tabs
  }

  onSearchTermChange(event: Event) {
    this.searchTerm.set((event.target as HTMLInputElement).value);
  }

  onPendingStatusFilterChange(event: Event) {
    this.pendingStatusFilter.set((event.target as HTMLSelectElement).value);
  }

  onHistoryStatusFilterChange(event: Event) {
    this.historyStatusFilter.set((event.target as HTMLSelectElement).value);
  }

  // New: Update Picking Quantity directly from list
  // CONSTRAINT: Ordered >= Shipped + Picking (New Value)
  updatePickingQuantityList(orderId: string, event: Event) {
      const val = parseInt((event.target as HTMLInputElement).value, 10);
      if (isNaN(val) || val < 0) return;

      const allOrders = this.dataService.orders();
      const targetOrder = allOrders.find(o => o.orderId === orderId);

      if (targetOrder) {
          const remaining = (targetOrder.quantity || 0) - (targetOrder.shippedQuantity || 0);
          
          if (val > remaining) {
              alert(`備貨數量 (${val}) 不可超過未出貨數量 (${remaining})。\n公式: 訂購量 >= 已出貨 + 已備貨`);
              // Reset input value to DB value
              (event.target as HTMLInputElement).value = (targetOrder.pickingQuantity || 0).toString();
              return;
          }

          const updatedOrder = {
              ...targetOrder,
              pickingQuantity: val
          };
          this.dataService.updateOrder(updatedOrder);
      }
  }

  // REVISED: Delete Entire Batch
  async deleteShipmentBatch(batch: ShipmentBatch) {
      if(confirm(`確定要刪除出貨單 ${batch.batchNo} 嗎？\n共包含 ${batch.records.length} 筆明細。\n(注意：這只會刪除出貨紀錄，不會自動回滾庫存或訂單狀態)`)) {
          const promises = batch.records.map(r => this.dataService.deleteShippingOrder(r.id));
          await Promise.all(promises);
      }
  }

  toggleHistoryGroup(baseOrderId: string) {
    this.expandedHistoryGroups.update(current => {
      const next = new Set(current);
      if (next.has(baseOrderId)) {
        next.delete(baseOrderId);
      } else {
        next.add(baseOrderId);
      }
      return next;
    });
  }

  isHistoryGroupExpanded(baseOrderId: string): boolean {
    return this.expandedHistoryGroups().has(baseOrderId);
  }
  
  // --- Batch Expansion Logic ---
  toggleBatch(batchNo: string) {
    this.expandedBatches.update(current => {
      const next = new Set(current);
      if (next.has(batchNo)) {
        next.delete(batchNo);
      } else {
        next.add(batchNo);
      }
      return next;
    });
  }

  isBatchExpanded(batchNo: string): boolean {
    return this.expandedBatches().has(batchNo);
  }

  // --- Full Editing Logic (Modal) ---

  openPendingEdit(group: GroupedOrder) {
      this.editMode.set('pending');
      this.currentEditGroup.set(group);
      
      // Populate form with order details (Use first item as representative for shared fields)
      const firstItem = group.items[0];
      this.editForm.patchValue({
          receiverName: firstItem.receiverName,
          receiverPhone: firstItem.receiverPhone,
          receiverAddress: firstItem.receiverAddress,
          logistics: firstItem.shipLogistics,
          specialRequests: firstItem.specialRequests,
      });
      this.showEditModal.set(true);
  }

  savePendingEdit() {
      const group = this.currentEditGroup();
      if (group && this.editForm.valid) {
          const val = this.editForm.value;
          
          // Update all orders in the group with new shipping details
          const updates = group.items.map(order => ({
              ...order,
              receiverName: val.receiverName,
              receiverPhone: val.receiverPhone,
              receiverAddress: val.receiverAddress,
              shipLogistics: val.logistics,
              specialRequests: val.specialRequests
          }));
          
          this.dataService.updateOrders(updates);
          this.closeEditModal();
      }
  }

  openHistoryEdit(record: ShippingOrder) {
      this.editMode.set('history');
      this.currentEditRecord.set(record);
      
      this.editForm.patchValue({
          logistics: record.logistics || record.shipLogistics,
          shippingId: record.shippingId,
          trackingUrl: record.trackingUrl,
          actualShippingDate: record.actualShippingDate,
          specialRequests: record.specialRequests
      });
      this.showEditModal.set(true);
  }

  async saveHistoryEdit() {
      const record = this.currentEditRecord();
      if (record && this.editForm.valid) {
          const val = this.editForm.value;
          
          // NEW: Update ALL records in the same batch for consistency
          const allShippingOrders = this.shippingOrdersList();
          const batchRecords = allShippingOrders.filter(r => r.batchNo === record.batchNo);
          
          const updatedRecords = batchRecords.map(r => ({
              ...r,
              logistics: val.logistics,
              shippingId: val.shippingId,
              trackingUrl: val.trackingUrl,
              actualShippingDate: val.actualShippingDate,
              specialRequests: val.specialRequests
          }));
          
          // Sync changes back to the Order if logistics/tracking changed
          const allOrders = this.dataService.orders();
          const orderUpdates: Order[] = [];

          batchRecords.forEach(r => {
              const targetOrder = allOrders.find(o => o.orderId === r.orderId);
              if (targetOrder) {
                  orderUpdates.push({
                      ...targetOrder,
                      shipLogistics: val.logistics,
                      shippingId: val.shippingId,
                      trackingUrl: val.trackingUrl
                  });
              }
          });

          const promises: Promise<any>[] = updatedRecords.map(r => this.dataService.updateShippingOrder(r));
          if (orderUpdates.length > 0) {
              promises.push(this.dataService.updateOrders(orderUpdates));
          }

          await Promise.all(promises);
          
          this.closeEditModal();
      }
  }

  closeEditModal() {
      this.showEditModal.set(false);
      this.currentEditGroup.set(null);
      this.currentEditRecord.set(null);
      this.editForm.reset();
  }

  // --- Shipping Wizard Logic ---

  // REVISED: Supports entering Wizard from History
  editHistoryBatch(batch: ShipmentBatch, group: HistoryGroup) {
      this.editingBatchNo.set(batch.batchNo);
      this.editingOrderId.set(group.baseOrderId);
      
      const allOrders = this.orders();
      const allProducts = this.products();
      const itemsToShip: ShippingItem[] = [];
      this.originalBatchMap.clear();

      batch.records.forEach(record => {
          const order = allOrders.find(o => o.orderId === record.orderId);
          if (order) {
              const product = allProducts.find(p => p.id === order.productId) 
                           || { id: order.productId, name: order.productName, stock: 0 } as any; // Cast to any
              
              // Store original for delta
              const recordQty = record.shippingQuantity || 0; // Use shippingQuantity
              this.originalBatchMap.set(record.id, recordQty);

              // Calculate shippedQty EXCLUDING this batch
              const shippedBefore = (order.shippedQuantity || 0) - recordQty;

              itemsToShip.push({
                  order: order,
                  product: product,
                  orderedQty: order.quantity,
                  shippedQty: Math.max(0, shippedBefore), // Only what was shipped before
                  pickingQty: order.pickingQuantity || 0, // Load picking
                  currentShipQty: recordQty // Load current saved qty
              });
          }
      });

      this.shippingItems.set(itemsToShip);
      
      // Load form details from the first record of batch
      const refRecord = batch.records[0];
      this.shippingForm.patchValue({
          logistics: refRecord.logistics || refRecord.shipLogistics,
          shippingId: refRecord.shippingId,
          trackingUrl: refRecord.trackingUrl,
          specialRequests: refRecord.specialRequests
      });
      
      // Load Images
      if (refRecord.waybillImages) {
          this.logisticsImages.set(refRecord.waybillImages);
      } else {
          this.logisticsImages.set([]);
      }
      
      this.currentStep.set('shipping-execution');
  }

  openShippingWizard(group: GroupedOrder) {
      this.editingBatchNo.set(null); // Create Mode
      this.originalBatchMap.clear();

      const itemsToShip = group.displayItems.map(orderItem => {
          const product = this.products().find(p => p.id === orderItem.productId);
          
          // Logic: 
          // Remaining = Ordered - Shipped
          // SafeShip = Remaining - Picking
          const remaining = Math.max(0, orderItem.quantity - (orderItem.shippedQuantity || 0));
          const picking = orderItem.pickingQuantity || 0;
          
          // REMOVED: Hard stock check to allow manual entry even if stock is 0
          const safeShip = Math.max(0, remaining - picking);

          return {
              order: orderItem,
              product: product || { id: orderItem.productId, name: orderItem.productName, stock: 0 } as any,
              orderedQty: orderItem.quantity,
              shippedQty: orderItem.shippedQuantity || 0,
              pickingQty: picking, // Init Picking Qty
              currentShipQty: safeShip // Init Ship Qty = Unpicked Remainder
          };
      });
      
      this.editingOrderId.set(group.baseOrderId);
      this.shippingItems.set(itemsToShip);
      this.currentShipmentCount.set(group.shipmentCount);
      
      this.logisticsImages.set([]);
      this.ocrResults.set([]);
      this.isAnalyzingLogistics.set(false);
      this.generatedShippingText.set('');
      
      let defaultLog = '黑貓';
      const orderLog = group.items[0]?.shipLogistics;
      if (orderLog && this.logisticsOptions.includes(orderLog)) {
          defaultLog = orderLog;
      }

      this.shippingForm.reset({ 
          logistics: defaultLog, 
          shippingId: '', 
          trackingUrl: '',
          specialRequests: '' 
      });

      this.currentStep.set('shipping-execution');
  }

  // REVISED: updateShipQty by INDEX to avoid duplicate ID issues
  updateShipQty(index: number, event: Event) {
      let val = parseInt((event.target as HTMLInputElement).value, 10);
      if (isNaN(val) || val < 0) val = 0;

      this.shippingItems.update(items => {
          const newItems = [...items];
          // Use index to target specific item
          const item = newItems[index]; 
          
          if (item) {
              const remaining = Math.max(0, item.orderedQty - item.shippedQty);
              const maxAllowedShip = Math.max(0, remaining - item.pickingQty);
              
              // REMOVED: Hard stock check to allow manual entry
              if (val > maxAllowedShip) val = maxAllowedShip;
              
              newItems[index] = { ...item, currentShipQty: val };
          }
          return newItems;
      });
      
      // Force update input value visually
      (event.target as HTMLInputElement).value = val.toString();
  }

  // REVISED: updatePickingQty by INDEX to avoid duplicate ID issues
  updatePickingQty(index: number, event: Event) {
      let val = parseInt((event.target as HTMLInputElement).value, 10);
      if (isNaN(val) || val < 0) val = 0;

      this.shippingItems.update(items => {
          const newItems = [...items];
          const item = newItems[index];

          if (item) {
              const remaining = Math.max(0, item.orderedQty - item.shippedQty);
              const maxAllowedPicking = Math.max(0, remaining - item.currentShipQty);
              
              // REMOVED: Hard stock check to allow manual entry
              if (val > maxAllowedPicking) val = maxAllowedPicking;
              
              newItems[index] = { ...item, pickingQty: val };
          }
          return newItems;
      });

      // Force update input value visually
      (event.target as HTMLInputElement).value = val.toString();
  }

  // Helper function to calculate unallocated quantity for display
  getUnallocatedQty(item: ShippingItem): number {
      const remaining = Math.max(0, item.orderedQty - item.shippedQty);
      const allocated = item.pickingQty + item.currentShipQty;
      return Math.max(0, remaining - allocated);
  }

  shipAllItems() {
      // Logic: Ship everything remaining.
      // Priority: Highest. Reset pickingQty to 0.
      // Formula: currentShipQty = min(ordered - shipped, stock)
      this.shippingItems.update(items =>
          items.map(i => {
              const remaining = Math.max(0, i.orderedQty - i.shippedQty);
              // REMOVED: Hard stock check
              return { ...i, currentShipQty: remaining, pickingQty: 0 };
          })
      );
  }
  
  // Revised: Move Picking to Ship (Apply to ALL items in current view)
  movePickingToShip() {
      this.shippingItems.update(items => items.map(i => {
          const remaining = Math.max(0, i.orderedQty - i.shippedQty);
          const newShip = Math.min(i.currentShipQty + i.pickingQty, remaining);
          return { ...i, currentShipQty: newShip, pickingQty: 0 };
      }));
  }

  processStockAndNext() {
      const hasItems = this.shippingItems().some(i => i.currentShipQty > 0);
      if (!hasItems) {
          alert('請至少輸入一項出貨數量');
          return;
      }
      this.currentStep.set('logistics-ocr');
  }

  // --- OCR Logic ---
  @HostListener('window:paste', ['$event'])
  async onPaste(event: ClipboardEvent) {
    if (this.currentStep() !== 'logistics-ocr') return;

    const items = event.clipboardData?.items;
    if (!items) return;

    const imageBlobs: File[] = [];
    for (let i = 0; i < items.length; i++) {
      // Check for image type or file kind
      if (items[i].type.indexOf('image') !== -1 || items[i].kind === 'file') {
        const blob = items[i].getAsFile();
        if (blob && blob.type.startsWith('image/')) {
          imageBlobs.push(blob);
        }
      }
    }

    if (imageBlobs.length > 0) {
      this.processLogisticsImages(imageBlobs);
    }
  }

  onDrop(event: DragEvent) {
    event.preventDefault();
    if (this.currentStep() !== 'logistics-ocr') return;

    const files = event.dataTransfer?.files;
    if (!files || files.length === 0) return;

    const imageFiles: File[] = [];
    for (let i = 0; i < files.length; i++) {
      if (files[i].type.startsWith('image/')) {
        imageFiles.push(files[i]);
      }
    }

    if (imageFiles.length > 0) {
      this.processLogisticsImages(imageFiles);
    }
  }

  onFileSelected(event: Event) {
    const input = event.target as HTMLInputElement;
    if (!input.files || input.files.length === 0) return;

    const files = Array.from(input.files).filter(f => f.type.startsWith('image/'));
    if (files.length > 0) {
      this.processLogisticsImages(files);
    }
    input.value = ''; // Reset for next selection
  }

  async processLogisticsImages(imageBlobs: File[]) {
    // 確保有 API Key 才能執行辨識
    const hasKey = await this.aiService.ensureApiKey();
    if (!hasKey) {
        return;
    }

    this.isAnalyzingLogistics.set(true);

    try {
        const base64Promises = imageBlobs.map(blob => new Promise<string>((resolve) => {
            const reader = new FileReader();
            reader.onload = (e) => resolve(e.target?.result as string);
            reader.readAsDataURL(blob);
        }));
        
        const rawNewImages = await Promise.all(base64Promises);
        
        const currentImages = this.logisticsImages();
        const newImages = rawNewImages.filter(img => !currentImages.includes(img));

        if (newImages.length === 0) {
             this.isAnalyzingLogistics.set(false);
             return; 
        }

        this.logisticsImages.update(current => [...current, ...newImages]);

        const analysisPromises = newImages.map(async (img) => {
            try {
                // Step 1: Initial scan without ROI to identify provider
                let result = await this.aiService.parseLogisticsImage(img, this.logisticsOptions);
                
                // Step 2: If provider identified, look for a matching OCR template
                if (result.provider) {
                    // Try to find a template that matches the identified provider
                    const matchedTemplate = this.shippingTemplates().find(t => 
                        t.logistics === result.provider || 
                        result.provider.includes(t.logistics) || 
                        t.logistics.includes(result.provider)
                    );

                    if (matchedTemplate) {
                        // If template has an ROI, perform a second targeted scan for better accuracy
                        if (matchedTemplate.roi) {
                            const refinedResult = await this.aiService.parseLogisticsImage(
                                img, 
                                this.logisticsOptions, 
                                matchedTemplate.roi, 
                                matchedTemplate.trackingUrlPattern?.replace('{{id}}', '{trackingId}')
                            );
                            
                            // Merge results, preferring the refined tracking ID if it's valid
                            result = {
                                ...result,
                                provider: refinedResult.provider || result.provider,
                                trackingId: refinedResult.trackingId !== '未辨識' ? refinedResult.trackingId : result.trackingId,
                                trackingUrl: refinedResult.trackingUrl || result.trackingUrl
                            };
                        } else if (matchedTemplate.trackingUrlPattern) {
                            // If no ROI but has pattern, update the URL using the pattern
                            const pattern = matchedTemplate.trackingUrlPattern.replace('{{id}}', '{trackingId}');
                            result.trackingUrl = pattern.replace('{trackingId}', result.trackingId);
                        }
                    }
                }

                return { ...result, url: result.trackingUrl };
            } catch (e) {
                console.error("OCR Analysis Error:", e);
                return { provider: '未知', trackingId: '', url: '' };
            }
        });
        
        const newResults = await Promise.all(analysisPromises);
        console.log("[Shipping] OCR Results received:", newResults);
        
        this.ocrResults.update(prev => [...prev, ...newResults]);

        const validResults = newResults.filter(r => r.trackingId && r.trackingId !== '未辨識');
        if (validResults.length > 0) {
            const lastResult = validResults[validResults.length - 1];
            console.log("[Shipping] Applying last valid result to form:", lastResult);
            
            const allIds = this.ocrResults()
                .filter(r => r.trackingId && r.trackingId !== '未辨識')
                .map(r => r.trackingId);
            
            const uniqueIds = Array.from(new Set(allIds)).join(', ');

            let providerToSet = this.shippingForm.get('logistics')?.value;
            if (lastResult.provider) {
                const matched = this.logisticsOptions.find(opt => 
                    lastResult.provider.includes(opt) || opt.includes(lastResult.provider)
                );
                if (matched) {
                    providerToSet = matched;
                    console.log("[Shipping] Matched provider:", providerToSet);
                }
            }

            this.shippingForm.patchValue({
                logistics: providerToSet,
                shippingId: uniqueIds,
                trackingUrl: lastResult.url || this.shippingForm.get('trackingUrl')?.value
            });
            
            console.log("[Shipping] Form patched successfully. Current form value:", this.shippingForm.value);
        } else {
            console.warn("[Shipping] No valid tracking IDs found in OCR results.");
        }

    } catch(e) {
        console.error('Batch image processing failed', e);
        alert('圖片辨識發生錯誤，請重試。');
    } finally {
        this.isAnalyzingLogistics.set(false);
    }
  }

  /**
   * 將目前的 OCR 辨識結果立即寫入資料庫 (落雷模式)
   */
  async quickSaveOcrToDb() {
    const formVal = this.shippingForm.value;
    if (!formVal.shippingId) {
        alert('請先辨識或輸入單號');
        return;
    }

    if (!confirm(`確定要將單號 ${formVal.shippingId} 立即寫入訂單系統嗎？`)) return;

    this.isAnalyzingLogistics.set(true);
    try {
        // 取得目前正在處理的所有訂單 ID
        const orderIds = Array.from(new Set(this.shippingItems().map(i => i.order.orderId)));
        
        // 逐一更新 (落雷)
        for (const id of orderIds) {
            await this.orderService.updateOrderShippingInfo(
                id,
                formVal.logistics,
                formVal.shippingId,
                formVal.trackingUrl || ''
            );
        }
        
        alert('落雷成功！已將物流資訊同步至資料庫。');
    } catch (e: any) {
        alert('寫入失敗: ' + e.message);
    } finally {
        this.isAnalyzingLogistics.set(false);
    }
  }

  removeImage(index: number) {
    this.logisticsImages.update(imgs => imgs.filter((_, i) => i !== index));
    this.ocrResults.update(res => res.filter((_, i) => i !== index));
    
    const allIds = this.ocrResults()
        .filter(r => r.trackingId)
        .map(r => r.trackingId);
    
    const uniqueIds = Array.from(new Set(allIds)).join(', ');
    
    this.shippingForm.patchValue({ shippingId: uniqueIds });
  }

  // --- Notification Logic ---
  goToShippingNotification() {
      // Logic same for edit and create
      const editGroup = this.historyGroups().find(g => g.baseOrderId === this.editingOrderId());
      const pendingGroup = this.shippingOrders().find(g => g.baseOrderId === this.editingOrderId());
      
      const groupBase = pendingGroup || editGroup;
      
      if (!groupBase && this.shippingItems().length === 0) return;

      // Ensure we have a valid reference to the first order to extract COD info
      const firstOrder = this.shippingItems()[0].order;

      const template = this.orderTemplates().find(t => t.isSystemDefault) || this.orderTemplates()[0];
      
      const formVal = this.shippingForm.value;
      const currentLogistics = formVal.logistics;
      const isSpecialLogistics = ['黑貓', '大榮'].includes(currentLogistics);

      // List of CURRENT shipped items
      const itemsList = this.shippingItems()
          .filter(i => i.currentShipQty > 0)
          .filter(i => !isSpecialLogistics || i.product.isCalculable !== false)
          .map(i => `${i.product.name} x ${i.currentShipQty}`)
          .join('\n');

      const today = new Date();
      const shippingDateStr = `${today.getFullYear()}-${(today.getMonth()+1).toString().padStart(2,'0')}-${today.getDate().toString().padStart(2,'0')}`;

      // Calculate remaining outstanding AFTER this shipment
      // Ordered - (Previously Shipped + Current Shipping)
      const totalOutstanding = this.shippingItems()
          .filter(i => !isSpecialLogistics || i.product.isCalculable !== false)
          .reduce((sum, i) => 
              sum + Math.max(0, i.orderedQty - i.shippedQty - i.currentShipQty), 0
          );

      // Generate Outstanding Items List (String)
      const outstandingItemsStr = this.shippingItems()
          .filter(i => !isSpecialLogistics || i.product.isCalculable !== false)
          .map(i => {
              const remaining = Math.max(0, i.orderedQty - i.shippedQty - i.currentShipQty);
              return remaining > 0 ? `${i.product.name} x ${remaining}` : null;
          })
          .filter(item => item !== null)
          .join('\n');

      if (template) {
          let content = template.content;
          const data: any = {
              orderId: this.editingOrderId(),
              customerName: firstOrder.customerName,
              items: itemsList,
              receiverName: firstOrder.receiverName,
              receiverPhone: firstOrder.receiverPhone,
              receiverAddress: firstOrder.receiverAddress,
              logistics: formVal.logistics,
              trackingId: formVal.shippingId,
              trackingUrl: formVal.trackingUrl || '',
              shippingDate: shippingDateStr,
              companyName: this.dataService.systemSettings().companyName,
              outstandingQuantity: totalOutstanding.toString(),
              outstandingItems: outstandingItemsStr || '無',
              codAmount: `$${this.decimalPipe.transform(firstOrder.codAmount || 0)}` // Added COD amount
          };

          Object.keys(data).forEach(key => {
              const regex = new RegExp(`{{${key}}}`, 'g');
              content = content.replace(regex, data[key]);
          });
          
          this.generatedShippingText.set(content);
      }

      this.currentStep.set('shipping-notification');
  }

  copyShippingText() {
      navigator.clipboard.writeText(this.generatedShippingText()).then(() => alert('已複製文字！'));
  }

  // NEW: Copy both Text and First Image
  async copyTextAndImage() {
      const text = this.generatedShippingText();
      const images = this.logisticsImages();
      
      if (!text && images.length === 0) return;

      try {
          const clipboardItems: any = {};
          
          // 1. Prepare Text
          if (text) {
              clipboardItems['text/plain'] = new Blob([text], { type: 'text/plain' });
          }

          // 2. Prepare Image (First one)
          if (images.length > 0) {
              const firstImg = images[0];
              // Convert Base64 to Blob
              const response = await fetch(firstImg);
              const blob = await response.blob();
              
              // Ensure it's PNG for maximum clipboard compatibility (Safari strictness)
              if (blob.type === 'image/png') {
                  clipboardItems['image/png'] = blob;
              } else {
                  // If not PNG, try to send it anyway, or we could canvas convert (omitted for brevity)
                  // Chrome supports JPEG in clipboard now, Safari often needs PNG.
                  clipboardItems[blob.type] = blob;
              }
          }

          const item = new ClipboardItem(clipboardItems);
          await navigator.clipboard.write([item]);
          
          alert('已嘗試複製文字與圖片！\n(請注意：能否同時貼上取決於目標應用程式)');
      } catch (err) {
          console.error('Copy failed', err);
          alert('複製失敗，請嘗試單獨複製文字。');
      }
  }

  // Helper method for silent copying
  async performSilentCopy() {
      const text = this.generatedShippingText();
      const images = this.logisticsImages();
      
      if (!text && images.length === 0) return;

      try {
          const clipboardItems: any = {};
          
          if (text) {
              clipboardItems['text/plain'] = new Blob([text], { type: 'text/plain' });
          }

          if (images.length > 0) {
              const firstImg = images[0];
              const response = await fetch(firstImg);
              const blob = await response.blob();
              
              if (blob.type === 'image/png') {
                  clipboardItems['image/png'] = blob;
              } else {
                  clipboardItems[blob.type] = blob;
              }
          }

          const item = new ClipboardItem(clipboardItems);
          await navigator.clipboard.write([item]);
      } catch (err) {
          console.error('Silent copy failed', err);
          // Fallback to text only if image copy fails (e.g. Item type not supported)
          if (text) {
             try { await navigator.clipboard.writeText(text); } catch(e) {}
          }
      }
  }

  // FINALIZATION: All DB Updates happen here
  async finalizeShipping(forceClose: boolean = false) {
      // 1. Copy Text & Image (Auto)
      await this.performSilentCopy();

      const formVal = this.shippingForm.value;
      const shippingItems = this.shippingItems();
      const nowISO = new Date().toISOString();
      const isEdit = !!this.editingBatchNo();
      const currentBaseId = this.editingOrderId();
      
      // Compress ALL images uploaded
      const waybillImages: string[] = [];
      const rawImages = this.logisticsImages();
      
      if (rawImages.length > 0) {
          try {
              // Parallel compression
              const compressed = await Promise.all(rawImages.map(img => this.compressImage(img)));
              waybillImages.push(...compressed);
          } catch (e) {
              console.error('Image compression failed', e);
          }
      }

      const orderUpdates: Order[] = [];
      const productUpdates: Product[] = [];
      const shippingOrderUpdates: ShippingOrder[] = [];
      
      // Batch No Logic
      let batchNo = '';
      const todayStr = new Date().toISOString().split('T')[0];
      const coreOrderId = currentBaseId!.replace('ORD-', '');

      if (isEdit) {
          batchNo = this.editingBatchNo()!;
      } else {
          const history = this.shippingOrdersList();
          const prefix = `SH-${coreOrderId}-S`;
          const existingBatches = new Set(
              history
                  .filter(h => h.batchNo && h.batchNo.startsWith(prefix))
                  .map(h => h.batchNo)
          );
          const nextSeq = existingBatches.size + 1;
          batchNo = `SH-${coreOrderId}-S${nextSeq}`;
      }

      const processedOrderIds = new Set<string>();

      // Process Items
      for (const item of shippingItems) {
          
          // Condition: Process if shipping qty > 0 OR it's an edit (might be reducing to 0) OR we are forcing close (need to update status)
          if (item.currentShipQty > 0 || isEdit || forceClose) {
              
              processedOrderIds.add(item.order.orderId);

              // 1. Calculate Stock Delta & Shipping Records
              let stockDelta = 0;
              let shippedDelta = 0;

              // Only perform stock/shipping operations if there is a quantity change involved
              // If it's just a Force Close with 0 qty, we skip shipping record creation
              const isEffectiveShipment = item.currentShipQty > 0 || isEdit;

              if (isEffectiveShipment) {
                  if (isEdit) {
                      const historyList = this.shippingOrdersList();
                      const existingRecord = historyList.find(r => r.batchNo === batchNo && r.orderId === item.order.orderId);
                      
                      const oldQty = existingRecord?.shippingQuantity || 0; 
                      stockDelta = oldQty - item.currentShipQty; 
                      shippedDelta = item.currentShipQty - oldQty; 
                      
                      // Update ShippingOrder Record
                      if (existingRecord) {
                          shippingOrderUpdates.push({
                              ...existingRecord,
                              shippingQuantity: item.currentShipQty,
                              logistics: formVal.logistics,
                              shipLogistics: formVal.logistics,
                              shippingId: formVal.shippingId,
                              trackingUrl: formVal.trackingUrl,
                              specialRequests: formVal.specialRequests || '',
                              waybillImages: waybillImages.length > 0 ? waybillImages : existingRecord.waybillImages
                          });
                      } else if (item.currentShipQty > 0) {
                          const uniqueId = `SHIP-${item.order.orderId}-${Date.now()}`;
                          shippingOrderUpdates.push({
                              id: uniqueId,
                              orderId: item.order.orderId,
                              customerName: item.order.customerName,
                              productName: item.product.name,
                              shippingQuantity: item.currentShipQty,
                              actualShippingDate: todayStr,
                              batchNo: batchNo,
                              logistics: formVal.logistics,
                              shipLogistics: formVal.logistics,
                              shippingId: formVal.shippingId,
                              trackingUrl: formVal.trackingUrl,
                              specialRequests: formVal.specialRequests || '',
                              waybillImages: waybillImages
                          });
                      }

                  } else {
                      // Create Mode
                      stockDelta = -item.currentShipQty;
                      shippedDelta = item.currentShipQty;
                      
                      if (item.currentShipQty > 0) {
                          const uniqueId = `SHIP-${item.order.orderId}-${Date.now()}`;
                          shippingOrderUpdates.push({
                              id: uniqueId,
                              orderId: item.order.orderId,
                              customerName: item.order.customerName,
                              productName: item.product.name,
                              shippingQuantity: item.currentShipQty, 
                              actualShippingDate: todayStr,
                              batchNo: batchNo,
                              logistics: formVal.logistics,
                              shipLogistics: formVal.logistics,
                              shippingId: formVal.shippingId,
                              trackingUrl: formVal.trackingUrl,
                              specialRequests: formVal.specialRequests || '',
                              waybillImages: waybillImages
                          });
                      }
                  }

                  // 2. Update Product Stock
                  if (item.product.id && stockDelta !== 0) {
                      const newStock = item.product.stock + stockDelta;
                      productUpdates.push({ ...item.product, stock: newStock, lastUpdated: new Date().toISOString() });
                  }
              }

              // 3. Update Order Status
              // Note: If !isEffectiveShipment, shippedDelta is 0.
              const finalShipped = (item.order.shippedQuantity || 0) + shippedDelta;
              
              let newStatus = item.order.status;
              if (finalShipped >= item.orderedQty) newStatus = '已出貨';
              else if (finalShipped > 0) newStatus = '部份出貨';
              else newStatus = '處理中'; 

              if (forceClose) newStatus = '已結案';

              // If fully shipped or closed, clear picking quantity
              let finalPickingQty = item.pickingQty;
              if (newStatus === '已出貨' || newStatus === '已結案') {
                  finalPickingQty = 0;
              }

              // Prepare update if anything changed
              // Condition: Shipped changed OR status changed OR picking changed
              if (shippedDelta !== 0 || item.order.status !== newStatus || item.order.pickingQuantity !== finalPickingQty) {
                  const updateObj: Order = {
                      ...item.order,
                      shippedQuantity: finalShipped,
                      pickingQuantity: finalPickingQty, 
                      status: newStatus,
                      shipLogistics: formVal.logistics || item.order.shipLogistics,
                      shippingId: formVal.shippingId,
                      trackingUrl: formVal.trackingUrl
                  };

                  if (newStatus === '已結案') {
                      updateObj.closedAt = item.order.closedAt || nowISO;
                  } else {
                      if (item.order.status === '已結案' && newStatus !== '已結案') {
                          delete updateObj.closedAt; // Reopen
                      }
                  }

                  orderUpdates.push(updateObj);
              }
          }
      }

      // 4. Force Close: Handle all other items in this order that were NOT in the shipping list
      // (e.g. Items already fully shipped, or items not selected if we had selection logic)
      if (forceClose && currentBaseId) {
           const allOrders = this.dataService.orders();
           const otherItems = allOrders.filter(o => {
               // Check if part of same group
               const oBase = o.orderId.split('-').length >= 3 ? o.orderId.split('-').slice(0,3).join('-') : o.orderId;
               return oBase === currentBaseId && !processedOrderIds.has(o.orderId);
           });
           
           otherItems.forEach(o => {
               if (o.status !== '已結案') {
                   orderUpdates.push({
                       ...o,
                       status: '已結案',
                       closedAt: o.closedAt || nowISO,
                       pickingQuantity: 0
                   });
               }
           });
      }

      // Execute DB Actions
      const promises = [];
      if (productUpdates.length) promises.push(...productUpdates.map(p => this.dataService.updateProduct(p)));
      if (orderUpdates.length) promises.push(this.dataService.updateOrders(orderUpdates));
      
      for (const so of shippingOrderUpdates) {
          if (isEdit && this.originalBatchMap.has(so.id)) {
               promises.push(this.dataService.updateShippingOrder(so));
          } else {
               promises.push(this.dataService.addShippingOrder(so));
          }
      }

      await Promise.all(promises);

      alert('出貨成功！內容已複製。\n即將返回待出貨列表。');

      // Reset UI
      this.currentStep.set('list');
      this.editingOrderId.set(null);
      this.editingBatchNo.set(null);
      this.activeTab.set('pending');
      this.expandedHistoryGroups.set(new Set()); 
  }

  goToStep(step: ShippingStep) {
      this.currentStep.set(step);
  }

  cancelWizard() {
      if (confirm('確定要取消嗎？')) {
          this.currentStep.set('list');
          this.editingBatchNo.set(null);
      }
  }
}
