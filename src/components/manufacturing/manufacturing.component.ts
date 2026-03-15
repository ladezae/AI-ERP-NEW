
// Force re-compilation to fix dynamic import error
import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { CommonModule, DecimalPipe } from '@angular/common';
import { ReactiveFormsModule, FormBuilder, FormGroup, FormsModule } from '@angular/forms';
import { DataService } from '../../services/data.service';
import { Order, Product, Customer } from '../../models/erp.models';
import { ResizableDirective } from '../../directives/resizable.directive';
import { TaiwanDatePipe } from '../../pipes/taiwan-date.pipe';

interface GroupedManufacturingOrder {
  baseOrderId: string;
  orderDate: string;
  customerName: string;
  status: string;
  items: Order[];        // All items in the order
  manufacturingItems: Order[]; // Items to display in manufacturing view
  totalQuantity: number; // Total quantity of displayed items
  totalOutstandingQty: number; // Added: Sum of outstanding manufacturing qty
  // Derived fields for group display (taken from first item usually)
  estimatedCompletionDate?: string;
  requestedShippingDate?: string;
  manufacturingStatus?: string;
  specialRequests?: string;
  customerLineId?: string; // Added: Customer LINE ID
}

@Component({
  selector: 'app-manufacturing',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CommonModule, ResizableDirective, TaiwanDatePipe, ReactiveFormsModule, FormsModule],
  providers: [DecimalPipe],
  templateUrl: './manufacturing.component.html'
})
export class ManufacturingComponent {
  private dataService = inject(DataService);
  private fb = inject(FormBuilder);

  // Data Signals
  orders = this.dataService.orders;
  products = this.dataService.products;
  customers = this.dataService.customers; // Added customers signal

  // View State
  searchTerm = signal('');
  statusFilter = signal('');
  showOnlyOemItems = signal(true); // Default: Show only OEM items

  // Modal State
  showModal = signal(false);
  currentEditingGroup = signal<GroupedManufacturingOrder | null>(null);
  editingItems = signal<Order[]>([]); // Local copy of items for editing quantities
  
  editForm!: FormGroup;

  readonly statusOptions = ['處理中', '已出貨', '部份出貨', '已結案', '取消'];
  readonly manufacturingStatusOptions = ['備料中', '排程中', '生產中', '已完成'];

  constructor() {
    this.initForm();
  }

  initForm() {
    this.editForm = this.fb.group({
      manufacturingStatus: [''],
      estimatedCompletionDate: [''],
      requestedShippingDate: [''],
      specialRequests: ['']
    });
  }

  // --- Computed: Grouped Manufacturing Orders ---
  groupedManufacturingOrders = computed(() => {
    const term = this.searchTerm().toLowerCase();
    const sFilter = this.statusFilter();
    const onlyOem = this.showOnlyOemItems();
    
    // Create Customer Map for Line ID Lookup
    const customerMap = new Map<string, Customer>(this.customers().map(c => [c.id, c]));

    // Create Product Category Map for filtering
    const productCategoryMap = new Map<string, string>();
    this.products().forEach(p => productCategoryMap.set(p.id, p.category));

    // Filter raw orders: Include if Flag is True OR if Product Category is Manufacturing
    const rawOrders = this.orders().filter(o => {
        // Condition 1: Explicit Flag
        if (o.isManufacturingOrder === true) return true;

        // Condition 2: Implicit Category Check (Safety Net)
        let cat = productCategoryMap.get(o.productId);
        // Handle variant IDs (e.g., P-001-01) if standard lookup fails
        if (!cat && o.productId.includes('-')) {
             const baseProdId = o.productId.substring(0, o.productId.lastIndexOf('-'));
             cat = productCategoryMap.get(baseProdId);
        }
        
        return cat === '代工' || cat === 'OEM' || cat === '加工';
    });

    const groups: Record<string, GroupedManufacturingOrder> = {};

    rawOrders.forEach(o => {
        const parts = o.orderId.split('-');
        const baseId = parts.length > 3 ? parts.slice(0, 3).join('-') : o.orderId;

        if (!groups[baseId]) {
            const customer = customerMap.get(o.customerId);

            groups[baseId] = {
                baseOrderId: baseId,
                orderDate: o.orderDate,
                customerName: o.customerName,
                status: '處理中', // Default, will be recalculated
                items: [],
                manufacturingItems: [],
                totalQuantity: 0,
                totalOutstandingQty: 0,
                // Init with first item data
                estimatedCompletionDate: o.estimatedCompletionDate,
                requestedShippingDate: o.requestedShippingDate,
                manufacturingStatus: o.manufacturingStatus || '備料中',
                specialRequests: o.specialRequests,
                customerLineId: customer ? customer.lineId : '' // Populate LINE ID
            };
        }
        
        groups[baseId].items.push(o);

        // Determine if this item should be included in the manufacturing view
        let shouldInclude = true;
        if (onlyOem) {
            let cat = productCategoryMap.get(o.productId);
            // Handle variant IDs (e.g., P-001-01) if standard lookup fails
            if (!cat && o.productId.includes('-')) {
                 const baseProdId = o.productId.substring(0, o.productId.lastIndexOf('-'));
                 cat = productCategoryMap.get(baseProdId);
            }
            
            if (cat !== '代工' && cat !== 'OEM' && cat !== '加工') {
                shouldInclude = false;
            }
        }

        if (shouldInclude) {
            groups[baseId].manufacturingItems.push(o);
            groups[baseId].totalQuantity += o.quantity;
            
            // Sum Outstanding Qty (Quantity - Manufactured)
            const outstanding = Math.max(0, (o.quantity || 0) - (o.manufacturedQuantity || 0));
            groups[baseId].totalOutstandingQty += outstanding;
        }
    });

    let groupedList = Object.values(groups).map(g => {
        // --- STATUS AGGREGATION LOGIC (Synced with OrdersComponent) ---
        const statuses = g.items.map(i => i.status || '處理中');
        const has = (s: string) => statuses.includes(s);
        const all = (s: string) => statuses.length > 0 && statuses.every(st => st === s);
        // Special case: Mix of Shipped and Closed is effectively Shipped (Done)
        const allDone = statuses.length > 0 && statuses.every(st => st === '已結案' || st === '已出貨');

        let aggStatus = '處理中';

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
             aggStatus = statuses[0] || '處理中';
        }
        
        g.status = aggStatus;
        return g;
    });
    
    // Sort by Date Descending
    groupedList.sort((a, b) => b.baseOrderId.localeCompare(a.baseOrderId));

    // Filter Logic
    if (term) {
        groupedList = groupedList.filter(g => 
            g.baseOrderId.toLowerCase().includes(term) ||
            g.customerName.toLowerCase().includes(term) ||
            g.items.some(i => i.productName.toLowerCase().includes(term))
        );
    }

    if (sFilter) {
        groupedList = groupedList.filter(g => g.status === sFilter);
    }

    return groupedList;
  });

  // --- Total Statistics ---
  totalOemQuantity = computed(() => {
      return this.groupedManufacturingOrders().reduce((sum, group) => sum + group.totalQuantity, 0);
  });

  // --- Actions ---

  onSearchTermChange(event: Event) {
    this.searchTerm.set((event.target as HTMLInputElement).value);
  }

  onStatusFilterChange(event: Event) {
    this.statusFilter.set((event.target as HTMLSelectElement).value);
  }

  toggleOemFilter(event: Event) {
      const checked = (event.target as HTMLInputElement).checked;
      this.showOnlyOemItems.set(checked);
  }

  // Inline Status Update (Main Table) - Order Status
  updateStatus(baseOrderId: string, event: Event) {
      const newStatus = (event.target as HTMLSelectElement).value;
      
      // FIX: Use ALL orders from source to ensure we update the complete order, not just filtered view
      // This prevents "split state" where hidden items remain in old status, causing aggregation to revert.
      const allOrders = this.orders();
      const targetItems = allOrders.filter(o => {
          // Robust ID matching (handles ORD-001 vs ORD-001-01)
          const bId = o.orderId.split('-').length >= 3 ? o.orderId.split('-').slice(0, 3).join('-') : o.orderId;
          return bId === baseOrderId;
      });
      
      if (targetItems.length > 0) {
          const now = new Date().toISOString();
          const updates = targetItems.map(item => {
              const updatedItem = { ...item, status: newStatus };
              
              // Handle ClosedAt logic to keep consistency with OrdersComponent
              if (newStatus === '已結案') {
                  if (!updatedItem.closedAt) updatedItem.closedAt = now;
              } else {
                  if (updatedItem.closedAt) delete updatedItem.closedAt;
              }
              
              return updatedItem;
          });
          this.dataService.updateOrders(updates);
      }
  }

  // Inline Manufacturing Status Update
  updateManufacturingStatus(baseOrderId: string, event: Event) {
      const newStatus = (event.target as HTMLSelectElement).value;
      
      // FIX: Use ALL orders from source to ensure we update the complete order
      const allOrders = this.orders();
      const targetItems = allOrders.filter(o => {
          const bId = o.orderId.split('-').length >= 3 ? o.orderId.split('-').slice(0, 3).join('-') : o.orderId;
          return bId === baseOrderId;
      });
      
      if (targetItems.length > 0) {
          const updates = targetItems.map(item => ({
              ...item,
              manufacturingStatus: newStatus
          }));
          this.dataService.updateOrders(updates);
      }
  }

  // Inline Product Note Update
  updateItemNote(orderId: string, event: Event) {
      const val = (event.target as HTMLInputElement).value;
      const order = this.orders().find(o => o.orderId === orderId);
      
      if (order && order.productNote !== val) {
          const updated = { ...order, productNote: val };
          this.dataService.updateOrder(updated);
      }
  }

  // Inline Manufactured Qty Update
  updateInlineManufacturedQty(orderId: string, event: Event) {
      const val = parseInt((event.target as HTMLInputElement).value, 10);
      if (isNaN(val) || val < 0) return;

      const order = this.orders().find(o => o.orderId === orderId);
      
      if (order && order.manufacturedQuantity !== val) {
          // DataService.updateOrder will recalculate outstandingManufacturingQty automatically via processOrderDerivedFields
          const updated = { ...order, manufacturedQuantity: val };
          this.dataService.updateOrder(updated);
      }
  }

  // --- Edit Modal Logic ---

  openEditModal(group: GroupedManufacturingOrder) {
    this.currentEditingGroup.set(group);
    
    // Deep copy items to avoid mutating signal directly until save
    this.editingItems.set(JSON.parse(JSON.stringify(group.manufacturingItems)));

    // Fill Form with Group Level Data (taken from the group object which aggregates this)
    this.editForm.patchValue({
      manufacturingStatus: group.manufacturingStatus,
      estimatedCompletionDate: group.estimatedCompletionDate,
      requestedShippingDate: group.requestedShippingDate,
      specialRequests: group.specialRequests
    });

    this.showModal.set(true);
  }

  closeModal() {
    this.showModal.set(false);
    this.currentEditingGroup.set(null);
    this.editingItems.set([]);
  }

  // Update quantity in local editing array
  updateItemManufacturedQty(orderId: string, event: Event) {
    const val = parseInt((event.target as HTMLInputElement).value, 10);
    if (isNaN(val) || val < 0) return;

    this.editingItems.update(items => items.map(item => {
        if (item.orderId === orderId) {
            return { ...item, manufacturedQuantity: val };
        }
        return item;
    }));
  }

  saveChanges() {
    const group = this.currentEditingGroup();
    if (!group) return;

    const formVal = this.editForm.value;
    const updatedItems = this.editingItems();

    // We need to update ALL items in the group with the shared dates/status/notes
    // AND update specific manufacturing items with their new quantities.
    
    const allUpdates = group.items.map(originalItem => {
        // Check if this item has a specific quantity update
        const editedItem = updatedItems.find(i => i.orderId === originalItem.orderId);
        
        return {
            ...originalItem,
            // Shared Fields update for all items in the order group
            manufacturingStatus: formVal.manufacturingStatus,
            estimatedCompletionDate: formVal.estimatedCompletionDate,
            requestedShippingDate: formVal.requestedShippingDate,
            specialRequests: formVal.specialRequests,
            // Specific Field update
            manufacturedQuantity: editedItem ? editedItem.manufacturedQuantity : originalItem.manufacturedQuantity
        };
    });

    this.dataService.updateOrders(allUpdates);
    this.closeModal();
  }
}
