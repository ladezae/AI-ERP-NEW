

import { ChangeDetectionStrategy, Component, inject, signal, computed, effect, input, output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { DataService } from '../../services/data.service';
import { MobilePageConfig, MobileFieldConfig } from '../../models/erp.models';

@Component({
  selector: 'app-mobile-layout',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CommonModule, FormsModule],
  templateUrl: './mobile-layout.component.html'
})
export class MobileLayoutComponent {
  private dataService = inject(DataService);
  
  // Inputs/Outputs for Standalone Mode
  isStandalone = input(false);
  exitStandalone = output<void>();
  launchStandalone = output<void>(); // New output to tell AppComponent to switch view

  mobilePages = this.dataService.mobilePages;
  
  // View State
  isBuilderMode = signal(false);
  isRunMode = signal(false); // To hide builder tools for deep linking or standalone
  currentPageConfig = signal<MobilePageConfig | null>(null);
  
  // Carousel State for Preview
  currentSlideIndex = signal(0);
  
  // Action Page State (New)
  actionNote = signal(''); // For the note input on the action page
  isResultPage = signal(false);
  resultMessage = signal('');
  
  // Purchase Workflow State
  isReviewStarted = signal(false);
  
  // Available Modules Definition
  readonly modules = [
      { id: 'purchase', name: '採購單 (Purchase)', icon: 'shopping_cart' },
      { id: 'order', name: '訂單 (Order)', icon: 'clipboard-list' },
      { id: 'product', name: '商品 (Product)', icon: 'cube' }
  ];

  // Mock Fields Definition (In real app, derive from Schema)
  readonly availableFields: Record<string, MobileFieldConfig[]> = {
      purchase: [
          { key: 'poNumber', label: '採購單號', type: 'text', isEditable: false, isVisible: true, order: 0 },
          { key: 'productName', label: '商品名稱', type: 'text', isEditable: false, isVisible: true, order: 0 },
          { key: 'quantity', label: '採購數量', type: 'number', isEditable: true, isVisible: true, order: 0 },
          { key: 'supplierName', label: '供應商', type: 'text', isEditable: false, isVisible: true, order: 0 },
          { key: 'receivedQuantity', label: '已收數量', type: 'number', isEditable: true, isVisible: true, order: 0 },
          { key: 'expectedDeliveryDate', label: '預計到貨', type: 'date', isEditable: true, isVisible: true, order: 0 },
          { key: 'status', label: '狀態', type: 'text', isEditable: false, isVisible: true, order: 0 },
          { key: 'purchaseNote', label: '備註', type: 'text', isEditable: true, isVisible: true, order: 0 },
          
          // New Product Reference Fields (Requested)
          { key: 'productStock', label: '商品庫存 (Stock)', type: 'number', isEditable: false, isVisible: true, order: 0 },
          { key: 'productSafetyStock', label: '安全庫存 (Safety)', type: 'number', isEditable: false, isVisible: true, order: 0 },
          { key: 'productOutstandingDemand', label: '訂單總需 (Order Qty)', type: 'number', isEditable: false, isVisible: true, order: 0 }, 
          { key: 'productTotalPickingQuantity', label: '總備貨 (Picking Qty)', type: 'number', isEditable: false, isVisible: true, order: 0 },
          { key: 'productTransitQuantity', label: '總在途 (Transit Qty)', type: 'number', isEditable: false, isVisible: true, order: 0 }
      ],
      order: [
          { key: 'orderId', label: '訂單編號', type: 'text', isEditable: false, isVisible: true, order: 0 },
          { key: 'customerName', label: '客戶名稱', type: 'text', isEditable: false, isVisible: true, order: 0 },
          { key: 'productName', label: '商品名稱', type: 'text', isEditable: false, isVisible: true, order: 0 },
          { key: 'quantity', label: '訂購數量', type: 'number', isEditable: false, isVisible: true, order: 0 },
          { key: 'shippedQuantity', label: '已出貨', type: 'number', isEditable: true, isVisible: true, order: 0 },
          { key: 'status', label: '狀態', type: 'text', isEditable: true, isVisible: true, order: 0 }
      ],
      product: [
          { key: 'id', label: '商品編號', type: 'text', isEditable: false, isVisible: true, order: 0 },
          { key: 'name', label: '商品名稱', type: 'text', isEditable: false, isVisible: true, order: 0 },
          { key: 'stock', label: '庫存', type: 'number', isEditable: true, isVisible: true, order: 0 },
          { key: 'priceBeforeTax', label: '售價', type: 'number', isEditable: false, isVisible: true, order: 0 },
          { key: 'costBeforeTax', label: '成本', type: 'number', isEditable: false, isVisible: true, order: 0 }
      ]
  };

  // Builder State
  availableSourceFields = computed(() => {
      const page = this.currentPageConfig();
      if (!page) return [];
      const moduleKey = page.sourceModule;
      // Filter out fields already selected
      const selectedKeys = page.fields.map(f => f.key);
      return (this.availableFields[moduleKey] || []).filter(f => !selectedKeys.includes(f.key));
  });

  // Computed: Pending Purchase Groups (AI建議 or 員工確認)
  // Sorted by PO Number Ascending (Oldest First)
  pendingPurchaseGroups = computed(() => {
    const list = this.dataService.purchaseOrders();
    const groups: Record<string, any[]> = {};
    
    // Filter for pending statuses
    list.filter(po => ['AI建議', '員工確認'].includes(po.status))
        .forEach(po => {
            const key = po.poNumber || po.purchaseId;
            if (!groups[key]) groups[key] = [];
            groups[key].push(po);
        });
    
    // Convert to array and sort by key (PO Number) ASC
    return Object.entries(groups)
        .sort((a, b) => a[0].localeCompare(b[0]))
        .map(([key, items]) => ({ key, items }));
  });

  // Computed Sample Data List for Preview (Returns Array of Items)
  sampleDataList = computed(() => {
      const page = this.currentPageConfig();
      if (!page) return [];

      const moduleKey = page.sourceModule;
      
      if (moduleKey === 'purchase') {
          // Priority: Show Pending Orders first if available
          const pendingGroups = this.pendingPurchaseGroups();
          let items: any[] = [];
          
          if (pendingGroups.length > 0) {
              // Always pick the FIRST group (Oldest) for review
              items = pendingGroups[0].items;
          } else {
              // Fallback for builder visualization if no pending orders exist
              // Just pick any largest group
              const list = this.dataService.purchaseOrders();
              if (list.length > 0) {
                  const groups: Record<string, any[]> = {};
                  list.forEach(po => {
                      const key = po.poNumber || po.purchaseId;
                      if (!groups[key]) groups[key] = [];
                      groups[key].push(po);
                  });
                  // Pick best key
                  const bestKey = Object.keys(groups).reduce((a, b) => groups[a].length > groups[b].length ? a : b);
                  items = groups[bestKey];
              }
          }

          if (!items || items.length === 0) return [];

          // Enrich with product data
          return items.map(po => {
              const product = this.dataService.products().find(p => p.id === po.productId);
              const demand = this.dataService.orders()
                  .filter(o => o.productId === po.productId && o.status !== '已結案' && o.status !== '取消')
                  .reduce((sum, o) => sum + Math.max(0, o.quantity - (o.shippedQuantity || 0)), 0);

              return {
                  ...po,
                  productName: product ? product.name : po.productId,
                  productStock: product ? product.stock : 0,
                  productSafetyStock: product ? product.safetyStock : 0,
                  productTotalPickingQuantity: product ? product.totalPickingQuantity : 0,
                  productTransitQuantity: product ? product.transitQuantity : 0,
                  productOutstandingDemand: demand
              };
          });

      } else if (moduleKey === 'order') {
          // For orders, simulate single item or find grouped logic if needed. 
          const list = this.dataService.orders();
          return list.slice(0, 3); // Return top 3 orders as if they are a sequence
      } else if (moduleKey === 'product') {
           const list = this.dataService.products();
           return list.slice(0, 3);
      }
      
      return [];
  });

  // Current Item Data based on slide index
  currentItemData = computed(() => {
      const list = this.sampleDataList();
      const index = this.currentSlideIndex();
      if (index >= 0 && index < list.length) {
          return list[index];
      }
      return null;
  });
  
  // Check if we are on the Summary Page (Index == Length)
  isSummaryPage = computed(() => {
      return this.currentSlideIndex() === this.sampleDataList().length;
  });

  // Check if we are on the Action/Reply Page (Index == Length + 1)
  isActionPage = computed(() => {
      // Only for Purchase module we enable the extra Action page logic
      if (this.currentPageConfig()?.sourceModule !== 'purchase') return false;
      return this.currentSlideIndex() === this.sampleDataList().length + 1;
  });

  constructor() {
      // Reset slide when entering builder
      effect(() => {
          if (this.isBuilderMode()) {
              this.resetPreview();
          }
      });

      // STANDALONE MODE INITIALIZATION
      effect(() => {
          if (this.isStandalone()) {
              // 1. Force Run Mode to true
              this.isRunMode.set(true);
              this.isBuilderMode.set(true); // Needed to show canvas logic
              
              // 2. Determine target module from intent or default
              const req = this.dataService.autoOpenMobileModule() || 'purchase';

              // 3. Select default page matching the module or create temp one
              const targetPage = this.mobilePages().find(p => p.sourceModule === req);
              
              if (targetPage) {
                  this.currentPageConfig.set(targetPage);
              } else {
                  // Fallback
                  const dummyPage: MobilePageConfig = {
                       id: `TEMP-${req.toUpperCase()}-SA`,
                       name: 'App 模式',
                       sourceModule: req as any,
                       fields: this.availableFields[req] || [],
                       description: '系統自動生成的頁面',
                       icon: 'shopping_cart'
                  };
                  this.currentPageConfig.set(dummyPage);
              }
              this.resetPreview();
              
              // Clear the intent flag so it doesn't trigger again unnecessarily
              this.dataService.autoOpenMobileModule.set(null);
          }
      });
      
      // Auto-fill note when entering Action Page
      effect(() => {
          if (this.isActionPage()) {
              const data = this.sampleDataList();
              // Use the note from the first item as the "Order Level" note
              if (data.length > 0 && data[0].purchaseNote) {
                  this.actionNote.set(data[0].purchaseNote);
              } else {
                  this.actionNote.set('');
              }
          }
      });
      
      // Deep Link intent logic (For Non-Standalone Preview)
      effect(() => {
          const target = this.dataService.autoOpenMobileModule();
          if (target && !this.isStandalone()) { // Only if not already in standalone
              const page = this.mobilePages().find(p => p.sourceModule === target);
              
              if (page) {
                  this.currentPageConfig.set(page);
                  this.isBuilderMode.set(true); 
                  this.isRunMode.set(true);     
                  this.resetPreview();
              } else {
                  const dummyPage: MobilePageConfig = {
                       id: 'TEMP-PURCHASE',
                       name: '採購回覆功能',
                       sourceModule: target as any,
                       fields: this.availableFields[target] || [],
                       description: '系統自動生成的審核頁面',
                       icon: 'shopping_cart'
                  };
                  this.currentPageConfig.set(dummyPage);
                  this.isBuilderMode.set(true);
                  this.isRunMode.set(true);
                  this.resetPreview();
              }
              
              if (target === 'purchase') {
                  this.isReviewStarted.set(false);
              }
              
              this.dataService.autoOpenMobileModule.set(null);
          }
      });
  }
  
  resetPreview() {
      this.currentSlideIndex.set(0);
      this.isResultPage.set(false);
      this.isReviewStarted.set(false);
      this.actionNote.set('');
  }
  
  exitRunMode() {
      if (this.isStandalone()) {
          // Emit event to parent to switch view back to dashboard
          this.exitStandalone.emit();
      } else {
          this.isRunMode.set(false);
          this.isBuilderMode.set(false);
          this.currentPageConfig.set(null);
      }
  }
  
  requestLaunchStandalone() {
      this.launchStandalone.emit();
  }

  // --- Purchase Workflow ---
  startReview() {
      this.isReviewStarted.set(true);
      this.currentSlideIndex.set(0);
  }

  // --- Carousel Navigation ---
  nextSlide() {
      const list = this.sampleDataList();
      let max = list.length; 
      // If purchase, add one more page for Action
      if (this.currentPageConfig()?.sourceModule === 'purchase') {
          max += 1;
      }
      
      if (this.currentSlideIndex() < max) {
          this.currentSlideIndex.update(i => i + 1);
      }
  }

  prevSlide() {
      if (this.currentSlideIndex() > 0) {
          this.currentSlideIndex.update(i => i - 1);
      }
  }

  // --- Purchase Action Logic ---
  async submitAction(action: 'approve' | 'reply') {
      const items = this.sampleDataList();
      if (items.length === 0) return;

      const note = this.actionNote();
      let newStatus = items[0].status; // Default keep current
      let successMsg = '';

      if (action === 'approve') {
          newStatus = '審核通過(要下單)';
          successMsg = '審核通過！訂單狀態已更新。';
      } else {
          // For reply/send, we keep status or assume it's just updating note
          successMsg = '備註已送出！等待修改後再次審核。';
      }

      // Update in DB (Simulated by updating DataService which updates Signal)
      const updates = items.map(item => ({
          ...item,
          status: newStatus,
          purchaseNote: note
      }));

      // We need to cast back to PurchaseOrder type structure for the service
      const cleanUpdates = updates.map(u => ({
          purchaseId: u.purchaseId,
          poNumber: u.poNumber,
          productId: u.productId,
          quantity: u.quantity,
          receivedQuantity: u.receivedQuantity,
          purchaseDate: u.purchaseDate,
          status: u.status,
          supplierCode: u.supplierCode,
          supplierName: u.supplierName,
          purchaser: u.purchaser,
          expectedShippingDate: u.expectedShippingDate,
          expectedDeliveryDate: u.expectedDeliveryDate,
          purchaseNote: u.purchaseNote, // Updated Note
          isOrdered: u.isOrdered,
          shipLogistics: u.shipLogistics,
          invoiceStatus: u.invoiceStatus,
          purchaseAuth: u.purchaseAuth
      }));

      await this.dataService.updatePurchaseOrders(cleanUpdates);
      
      this.resultMessage.set(successMsg);
      this.isResultPage.set(true);
  }

  finishPreview() {
      this.resetPreview();
  }

  // --- CRUD Config ---
  createNewPage() {
      const newPage: MobilePageConfig = {
          id: `MP-${Date.now()}`,
          name: '新行動頁面',
          sourceModule: 'purchase',
          fields: [],
          description: '自定義行動版面',
          icon: 'document-text'
      };
      this.currentPageConfig.set(newPage);
      this.isBuilderMode.set(true);
  }

  editPage(page: MobilePageConfig) {
      this.currentPageConfig.set(JSON.parse(JSON.stringify(page)));
      this.isBuilderMode.set(true);
  }

  deletePage(id: string) {
      if (confirm('確定要刪除此版面配置嗎？')) {
          this.dataService.deleteMobilePage(id);
      }
  }

  savePage() {
      const page = this.currentPageConfig();
      if (!page) return;
      if (!page.name) {
          alert('請輸入版面名稱');
          return;
      }
      const exists = this.mobilePages().some(p => p.id === page.id);
      if (exists) {
          this.dataService.updateMobilePage(page);
      } else {
          this.dataService.addMobilePage(page);
      }
      this.isBuilderMode.set(false);
      this.currentPageConfig.set(null);
  }

  cancelEdit() {
      this.isBuilderMode.set(false);
      this.currentPageConfig.set(null);
  }

  // --- Builder Actions ---
  addField(fieldTemplate: MobileFieldConfig) {
      this.currentPageConfig.update(page => {
          if (!page) return null;
          const newField = { ...fieldTemplate, order: page.fields.length + 1 };
          return { ...page, fields: [...page.fields, newField] };
      });
  }

  removeField(index: number) {
      this.currentPageConfig.update(page => {
          if (!page) return null;
          const newFields = page.fields.filter((_, i) => i !== index);
          return { ...page, fields: newFields };
      });
  }

  moveField(index: number, direction: -1 | 1) {
      this.currentPageConfig.update(page => {
          if (!page) return null;
          const newFields = [...page.fields];
          if (index + direction < 0 || index + direction >= newFields.length) return page;
          const temp = newFields[index];
          newFields[index] = newFields[index + direction];
          newFields[index + direction] = temp;
          newFields.forEach((f, i) => f.order = i + 1);
          return { ...page, fields: newFields };
      });
  }

  updateFieldProperty(index: number, key: keyof MobileFieldConfig, value: any) {
      this.currentPageConfig.update(page => {
          if (!page) return null;
          const newFields = [...page.fields];
          newFields[index] = { ...newFields[index], [key]: value };
          return { ...page, fields: newFields };
      });
  }
}
