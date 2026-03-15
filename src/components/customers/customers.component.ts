
import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ReactiveFormsModule, FormBuilder, FormGroup, Validators, AbstractControl, ValidationErrors } from '@angular/forms';
import { DataService } from '../../services/data.service';
import { Customer, Product } from '../../models/erp.models';
import { ResizableDirective } from '../../directives/resizable.directive';
import { TaiwanDatePipe } from '../../pipes/taiwan-date.pipe';
import { utils, writeFile, read } from 'xlsx';

@Component({
  selector: 'app-customers',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CommonModule, ReactiveFormsModule, ResizableDirective, TaiwanDatePipe],
  templateUrl: './customers.component.html'
})
export class CustomersComponent {
  private dataService = inject(DataService);
  private fb = inject(FormBuilder);

  customers = this.dataService.customers;
  orders = this.dataService.orders; // Need orders to calculate Top 3
  employees = this.dataService.employees; // Expose employees for dropdown
  products = this.dataService.products; // For fuzzy search & Wishlist selection
  
  searchTerm = signal('');
  selectedSalesperson = signal(''); 
  selectedStatus = signal('all'); // Status Filter Signal ('all' | 'active' | 'stopped')
  selectedNotificationFilter = signal('all'); // New: Notification Filter ('all' | 'notify' | 'none')
  selectedWishlistFilter = signal('all'); // NEW: Wishlist Filter ('all' | 'has_wishlist' | 'no_wishlist')

  showModal = signal(false);
  isEditMode = signal(false);
  customerForm!: FormGroup;
  
  // Import State
  isImporting = signal(false);

  // --- Wishlist / Expected Products State ---
  wishlistItems = signal<Product[]>([]);
  wishlistSearchTerm = signal('');
  
  constructor() {
    this.initForm();
  }

  initForm() {
    this.customerForm = this.fb.group({
      // Basic Info
      id: [''], 
      shortName: ['', Validators.required], // Required
      fullName: [''], 
      taxId: [''],
      level: [''],
      salesperson: [''],
      
      // Contact Info - Phone/Mobile Cross Validation handled at group level
      jobTitle: [''],
      phone: [''], 
      mobile: [''],
      lineId: [''],
      email: ['', [Validators.email]],
      
      // Address 1
      address1: ['', Validators.required], // Required
      receiver1: [''],
      phone1: [''],
      
      // Address 2
      address2: [''],
      receiver2: [''],
      phone2: [''],
      
      // Trade Conditions
      clientPaymentTerms: ['先匯款'], // Changed: string default
      taxType: [true], 
      isStopTrading: [false], 
      needsDeliveryNotification: [false],
      firstTradeDate: [''],
      
      // Notes & Wishlist
      specialRequests: [''],
      expectedProducts: [''], // Stored as comma-separated string
      consignedPackagingUrl: ['']
    }, { validators: this.atLeastOneContactValidator });
  }

  // Custom Validator: Phone OR Mobile must be present
  atLeastOneContactValidator(control: AbstractControl): ValidationErrors | null {
      const phone = control.get('phone')?.value;
      const mobile = control.get('mobile')?.value;
      return (!phone && !mobile) ? { atLeastOneContact: true } : null;
  }

  filteredCustomers = computed(() => {
    const term = this.searchTerm().toLowerCase();
    const sales = this.selectedSalesperson();
    const status = this.selectedStatus();
    const notify = this.selectedNotificationFilter();
    const wishlist = this.selectedWishlistFilter();

    return this.customers().filter(c => {
      // 1. Search Term
      const matchesSearch = !term || (
        c.shortName.toLowerCase().includes(term) ||
        c.fullName.toLowerCase().includes(term) ||
        c.taxId.includes(term) ||
        (c.phone && c.phone.includes(term)) ||
        (c.mobile && c.mobile.includes(term)) ||
        (c.lineId && c.lineId.toLowerCase().includes(term))
      );

      // 2. Salesperson
      const matchesSales = !sales || c.salesperson === sales;

      // 3. Status
      let matchesStatus = true;
      if (status === 'active') matchesStatus = !c.isStopTrading;
      if (status === 'stopped') matchesStatus = c.isStopTrading;

      // 4. Notification
      let matchesNotify = true;
      if (notify === 'notify') matchesNotify = c.needsDeliveryNotification;
      if (notify === 'none') matchesNotify = !c.needsDeliveryNotification;

      // 5. Wishlist (Expected Products)
      let matchesWishlist = true;
      if (wishlist === 'has_wishlist') matchesWishlist = !!c.expectedProducts && c.expectedProducts.length > 0;
      if (wishlist === 'no_wishlist') matchesWishlist = !c.expectedProducts || c.expectedProducts.length === 0;

      return matchesSearch && matchesSales && matchesStatus && matchesNotify && matchesWishlist;
    });
  });

  // --- Helper: Calculate Top 3 Products ---
  getTopProducts(customerId: string): {name: string, count: number}[] {
      // 1. 準備排除的分類
      const excludedCategories = new Set(['包材', '代工', '費用', '折讓']);
      
      // 2. 建立商品ID對應分類的 Map 以快速查詢
      const productCategoryMap = new Map<string, string>();
      this.products().forEach(p => productCategoryMap.set(p.id, p.category));

      // 3. 篩選訂單
      const customerOrders = this.orders().filter(o => {
          // 基礎過濾：客戶ID吻合且非取消單
          if (o.customerId !== customerId || o.status === '取消') return false;
          
          // 分類過濾：
          let category = productCategoryMap.get(o.productId);
          
          // 處理變體ID (例如: S-OEM-P3-01)，若找不到則嘗試找母商品
          if (!category && o.productId.includes('-')) {
              const baseId = o.productId.substring(0, o.productId.lastIndexOf('-'));
              category = productCategoryMap.get(baseId);
          }

          // 若分類存在且在排除清單中，則不計入
          if (category && excludedCategories.has(category)) {
              return false;
          }
          
          return true;
      });

      // 4. 統計數量
      const productCounts = new Map<string, number>();
      
      customerOrders.forEach(o => {
          const current = productCounts.get(o.productName) || 0;
          productCounts.set(o.productName, current + o.quantity);
      });

      // 5. 排序並取前三名
      return Array.from(productCounts.entries())
          .map(([name, count]) => ({ name, count }))
          .sort((a, b) => b.count - a.count)
          .slice(0, 3);
  }

  // --- Wishlist Logic ---
  
  getWishlistItems(wishlistStr: string): string[] {
      if (!wishlistStr) return [];
      return wishlistStr.split(',').filter(s => s.trim().length > 0);
  }

  filteredWishlistProducts = computed(() => {
      const term = this.wishlistSearchTerm().toLowerCase();
      if (!term) return [];
      
      return this.products().filter(p => {
          // Filter out discontinued products
          if (p.isDiscontinued) return false;

          // Fuzzy search on Name OR ID OR SupplierCode (matching Product Management logic)
          return p.name.toLowerCase().includes(term) || 
                 p.id.toLowerCase().includes(term) ||
                 (p.supplierCode && p.supplierCode.toLowerCase().includes(term));
      }).slice(0, 10); // Limit results
  });

  onWishlistSearch(event: Event) {
      this.wishlistSearchTerm.set((event.target as HTMLInputElement).value);
  }

  addToWishlist(product: Product) {
      const current = this.wishlistItems();
      if (!current.find(p => p.id === product.id)) {
          this.wishlistItems.update(items => [...items, product]);
      }
      this.wishlistSearchTerm.set(''); // Clear search
  }

  removeFromWishlist(productId: string) {
      this.wishlistItems.update(items => items.filter(p => p.id !== productId));
  }

  // --- Actions ---

  onSearchTermChange(event: Event): void {
    const value = (event.target as HTMLInputElement).value;
    this.searchTerm.set(value);
  }

  onSalespersonChange(event: Event): void {
      this.selectedSalesperson.set((event.target as HTMLSelectElement).value);
  }

  onStatusChange(event: Event): void {
      this.selectedStatus.set((event.target as HTMLSelectElement).value);
  }

  onNotificationFilterChange(event: Event): void {
      this.selectedNotificationFilter.set((event.target as HTMLSelectElement).value);
  }

  onWishlistFilterChange(event: Event): void {
      this.selectedWishlistFilter.set((event.target as HTMLSelectElement).value);
  }

  // Helper to generate sequential ID based on user request "000000+1"
  private generateNextCustomerId(): string {
      const customers = this.customers();
      // Baseline 939 so the sequence continues from 940 if no higher ID exists
      let maxId = 939;

      customers.forEach(c => {
          // Extract numeric part from the end of the ID string
          const match = c.id.match(/(\d+)$/);
          if (match) {
              const num = parseInt(match[1], 10);
              // Filter out extremely large numbers (like timestamps) to keep sequence clean
              if (!isNaN(num) && num > maxId && num < 9999999) {
                  maxId = num;
              }
          }
      });

      // Increment max ID found and pad to 6 digits
      return (maxId + 1).toString().padStart(6, '0');
  }

  openAddModal() {
    this.isEditMode.set(false);
    this.initForm();
    
    // Auto-generate ID using sequential logic
    const nextId = this.generateNextCustomerId();
    this.customerForm.patchValue({ id: nextId });
    
    this.wishlistItems.set([]); // Clear wishlist UI
    this.showModal.set(true);
  }

  openEditModal(customer: Customer) {
    this.isEditMode.set(true);
    this.initForm();
    this.customerForm.patchValue(customer);
    this.customerForm.get('id')?.disable();
    
    // Restore Wishlist from string
    if (customer.expectedProducts) {
        const names = customer.expectedProducts.split(',');
        const items = names.map(name => {
            const found = this.products().find(p => p.name === name);
            return found || { id: 'UNKNOWN', name: name, stock: 0 } as Product;
        });
        this.wishlistItems.set(items);
    } else {
        this.wishlistItems.set([]);
    }

    this.showModal.set(true);
  }

  closeModal() {
    this.showModal.set(false);
  }

  deleteCustomer(customer: Customer) {
      if(confirm(`確定要刪除客戶 ${customer.shortName} 嗎？`)) {
          this.dataService.deleteCustomer(customer.id);
      }
  }
  
  // --- Import / Export Logic ---

  downloadTemplate() {
    const headers = [
      '客戶編號', '客戶簡稱', '客戶全名', '統編', '客戶等級',
      '負責業務', '職稱', '公司電話', '手機', 'LINE ID', 'Email',
      '收貨地址1', '收件人1', '電話1',
      '收貨地址2', '收件人2', '電話2',
      '付款條件', '是否應稅(是/否)', '停止交易(是/否)', '貨到通知(是/否)', 
      '首交日(YYYY-MM-DD)', '特別要求', '許願商品(逗號分隔)'
    ];
    
    const sample = [
      'CUST-001', '範例客戶', '範例客戶股份有限公司', '12345678', 'A級',
      '王大明', '採購經理', '02-22334455', '0912345678', 'line_id_123', 'test@example.com',
      '台北市信義區', '陳先生', '0912345678',
      '', '', '',
      '先匯款', '是', '否', '是',
      '2024-01-01', '週一不收貨', '芒果乾,鳳梨乾'
    ];

    const ws = utils.aoa_to_sheet([headers, sample]);
    
    // Auto-width hint
    ws['!cols'] = headers.map(() => ({ wch: 15 }));

    const wb = utils.book_new();
    utils.book_append_sheet(wb, ws, "客戶匯入範本");
    writeFile(wb, "客戶匯入範本.xlsx");
  }

  triggerImport() {
      const fileInput = document.getElementById('customerImportInput') as HTMLInputElement;
      if(fileInput) fileInput.click();
  }

  onImportFileSelected(event: Event) {
      const input = event.target as HTMLInputElement;
      if (!input.files || input.files.length === 0) return;
      
      const file = input.files[0];
      this.isImporting.set(true);

      const reader = new FileReader();
      reader.onload = async (e: any) => {
          try {
              const data = e.target.result;
              const workbook = read(data, { type: 'array' });
              const sheetName = workbook.SheetNames[0];
              const worksheet = workbook.Sheets[sheetName];
              const jsonData = utils.sheet_to_json(worksheet);

              if (jsonData.length === 0) {
                  alert('檔案內容為空');
                  return;
              }

              let successCount = 0;
              let failCount = 0;
              
              const promises = jsonData.map(async (row: any) => {
                  try {
                      const customer = this.mapRowToCustomer(row);
                      // Basic validation
                      if (customer.shortName && (customer.phone || customer.mobile)) {
                          const exists = this.customers().some(c => c.id === customer.id);
                          if (exists) {
                              await this.dataService.updateCustomer(customer);
                          } else {
                              await this.dataService.addCustomer(customer);
                          }
                          successCount++;
                      } else {
                          failCount++;
                      }
                  } catch (err) {
                      console.error('Row import failed', row, err);
                      failCount++;
                  }
              });

              await Promise.all(promises);
              alert(`匯入完成！\n成功: ${successCount} 筆\n失敗/跳過: ${failCount} 筆\n(失敗原因通常為缺少簡稱或聯絡電話)`);
              
          } catch (err) {
              console.error('File parsing error', err);
              alert('匯入失敗，請檢查檔案格式是否正確。');
          } finally {
              this.isImporting.set(false);
              input.value = '';
          }
      };
      
      reader.onerror = () => {
          alert('讀取檔案時發生錯誤');
          this.isImporting.set(false);
          input.value = '';
      };

      reader.readAsArrayBuffer(file);
  }

  private mapRowToCustomer(row: any): Customer {
      // Auto Generate ID if missing
      let id = row['客戶編號'] ? String(row['客戶編號']).trim() : '';
      if (!id) {
          const randomId = 'CUST-' + Math.floor(Math.random() * 10000).toString().padStart(4, '0');
          id = randomId;
      }
      
      const parseBool = (val: any, defaultVal: boolean): boolean => {
          if (val === undefined || val === null || val === '') return defaultVal;
          const s = String(val).trim().toLowerCase();
          return ['true', 'yes', 'y', '是', '1'].includes(s);
      };

      return {
          id: id,
          shortName: row['客戶簡稱'] ? String(row['客戶簡稱']).trim() : (row['客戶全名'] || '未命名'),
          fullName: row['客戶全名'] || '',
          taxId: row['統編'] ? String(row['統編']) : '',
          level: row['客戶等級'] || '',
          salesperson: row['負責業務'] || '',
          
          jobTitle: row['職稱'] || '',
          phone: row['公司電話'] || '',
          mobile: row['手機'] || '',
          lineId: row['LINE ID'] || '',
          email: row['Email'] || '',
          
          address1: row['收貨地址1'] || '',
          receiver1: row['收件人1'] || '',
          phone1: row['電話1'] || '',
          
          address2: row['收貨地址2'] || '',
          receiver2: row['收件人2'] || '',
          phone2: row['電話2'] || '',
          
          clientPaymentTerms: row['付款條件'] || '先匯款',
          taxType: parseBool(row['是否應稅(是/否)'], true),
          isStopTrading: parseBool(row['停止交易(是/否)'], false),
          needsDeliveryNotification: parseBool(row['貨到通知(是/否)'], false),
          firstTradeDate: row['首交日(YYYY-MM-DD)'] || '',
          
          specialRequests: row['特別要求'] || '',
          expectedProducts: row['許願商品(逗號分隔)'] || '',
          consignedPackagingUrl: ''
      };
  }

  onSubmit() {
    if (this.customerForm.valid) {
      const formValue = this.customerForm.getRawValue();
      
      // Serialize Wishlist
      const wishlistStr = this.wishlistItems().map(p => p.name).join(',');
      
      const customerData: Customer = { 
          ...formValue,
          expectedProducts: wishlistStr
      };

      if (this.isEditMode()) {
        this.dataService.updateCustomer(customerData);
      } else {
        this.dataService.addCustomer(customerData);
      }
      this.closeModal();
    } else {
      this.customerForm.markAllAsTouched();
    }
  }
}
