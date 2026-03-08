
import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { DataService } from '../../services/data.service';
import { ScreenService } from '../../services/screen.service';
import { ImageService } from '../../services/image.service';
import { Product } from '../../models/erp.models';
import { FormBuilder, FormGroup, ReactiveFormsModule, Validators, AbstractControl, ValidationErrors } from '@angular/forms';
import { ResizableDirective } from '../../directives/resizable.directive';
import { utils, writeFile, read } from 'xlsx';

@Component({
  selector: 'app-products',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CommonModule, ReactiveFormsModule, ResizableDirective],
  templateUrl: './products.component.html'
})
export class ProductsComponent {
  private dataService: DataService = inject(DataService);
  private imageService: ImageService = inject(ImageService);
  public screenService: ScreenService = inject(ScreenService);
  private fb: FormBuilder = inject(FormBuilder);
  
  products = this.dataService.products;
  suppliers = this.dataService.suppliers; // Access suppliers for dropdown
  purchaseOrders = this.dataService.purchaseOrders; // Access POs for transit details
  orders = this.dataService.orders; // Access Orders for Outstanding Demand
  
  // Filter Signals
  searchTerm = signal('');
  selectedCategory = signal('');
  selectedControlStatus = signal(''); // 'true', 'false', ''
  selectedAvailability = signal('active'); // 'all', 'active', 'discontinued'
  selectedStockStatus = signal('all'); // 'all', 'low'
  selectedSupplier = signal(''); // New: Supplier Filter

  // Sorting Signals
  sortColumn = signal<string>('');
  sortDirection = signal<'asc' | 'desc'>('asc');

  // Pagination Signals
  currentPage = signal(1);
  pageSize = signal(10);

  // Tooltip State (Fixed Position)
  transitTooltip = signal<{ items: any[], x: number, y: number } | null>(null);
  
  // New: Image Hover State
  hoveredImage = signal<string | null>(null);

  // Edit/Modal State
  showModal = signal(false);
  isEditMode = signal(false);
  productForm!: FormGroup;
  isUploading = signal(false);
  
  // Import State
  isImporting = signal(false);

  // Constants
  readonly categories = [
    '水果乾',
    '鮮果',
    '堅果',
    '蔬果脆片',
    '水果凍乾',
    '沖泡類',
    '零食',
    '蜜餞',
    '包材',
    '代工',
    '費用',
    '折讓',
    '成品',
    '樣品',
    '其他'
  ];

  readonly origins = [
    '台灣',
    '越南',
    '泰國',
    '中國',
    '土耳其',
    '美國',
    '智利',
    '伊朗'
  ];

  readonly units = [
    '台斤',
    '公斤',
    '箱',
    '包',
    'g',
    '個'
  ];
  
  readonly moqOptions = [1, 2, 3, 4, 5, 6, 10, 15, 20, 30, 40];
  readonly packageCounts = [1, 2, 3, 4, 5, 6, 7, 8, 10, 12, 15, 20, 24, 30, 40];

  readonly serviceStatusOptions = [
    '正常供貨',
    '缺貨等復供',
    '滿箱代訂',
    '限量配貨',
    '付款順序供貨'
  ];

  // 計算「訂單總需」(Outstanding Demand)
  // 邏輯: 累加所有「處理中/部份出貨」訂單的 (訂購數量 - 已出貨數量)
  outstandingDemandMap = computed(() => {
    const map = new Map<string, number>();
    const allOrders = this.orders();
    // 建立現有商品 ID 集合，用於檢查是否存在
    const allProductIds = new Set(this.products().map(p => p.id));
    
    allOrders.forEach(o => {
      // 1. 排除已取消或已結案的訂單
      if (o.status === '取消' || o.status === '已結案') return;
      
      // 2. 計算剩餘需求: 訂購量 - 已出貨量
      const demand = Math.max(0, (o.quantity || 0) - (o.shippedQuantity || 0));
      
      if (demand > 0) {
        let targetId = o.productId;

        // 3. 代工單變體處理 (Variant Handling)
        // 如果訂單中的 ID (如 S-OEM-01-01) 在商品列表中找不到，
        // 嘗試去除尾綴 (如 -01) 找回母商品 ID (S-OEM-01) 進行歸戶。
        if (!allProductIds.has(targetId) && targetId.includes('-')) {
            const potentialBase = targetId.substring(0, targetId.lastIndexOf('-'));
            if (allProductIds.has(potentialBase)) {
                targetId = potentialBase;
            }
        }

        const current = map.get(targetId) || 0;
        map.set(targetId, current + demand);
      }
    });
    return map;
  });

  // 計算「總備貨量」(Total Picking Quantity)
  // 邏輯: 累加所有「處理中/部份出貨」訂單的 pickingQuantity
  totalPickingQuantityMap = computed(() => {
    const map = new Map<string, number>();
    const allOrders = this.orders();
    const allProductIds = new Set(this.products().map(p => p.id));

    allOrders.forEach(o => {
      if (o.status === '取消' || o.status === '已結案') return;
      
      const picking = o.pickingQuantity || 0;
      if (picking > 0) {
        let targetId = o.productId;

        // Variant Handling
        if (!allProductIds.has(targetId) && targetId.includes('-')) {
            const potentialBase = targetId.substring(0, targetId.lastIndexOf('-'));
            if (allProductIds.has(potentialBase)) {
                targetId = potentialBase;
            }
        }

        const current = map.get(targetId) || 0;
        map.set(targetId, current + picking);
      }
    });
    return map;
  });

  // 計算「在途數量」(Transit Quantity)
  // 邏輯: 累加所有「廠商確認/部份到貨」採購單的 (採購數量 - 已收數量)
  transitQuantityMap = computed(() => {
    const map = new Map<string, number>();
    const allPOs = this.purchaseOrders();
    
    allPOs.forEach(po => {
      // 狀態邏輯需與 Tooltip 一致: 只有 '廠商確認' 或 '部份到貨' 算在途
      if (po.status === '廠商確認' || po.status === '部份到貨') {
         const remaining = Math.max(0, (po.quantity || 0) - (po.receivedQuantity || 0));
         if (remaining > 0) {
             const current = map.get(po.productId) || 0;
             map.set(po.productId, current + remaining);
         }
      }
    });
    return map;
  });

  constructor() {
    this.initForm();
  }

  // Custom ID Validator to check for duplicates
  duplicateIdValidator(control: AbstractControl): ValidationErrors | null {
    // Skip validation if in edit mode (ID is disabled anyway)
    if (this.isEditMode()) return null;
    
    const value = control.value;
    if (!value) return null;
    
    const exists = this.products().some(p => p.id === value);
    return exists ? { duplicate: true } : null;
  }

  initForm() {
    this.productForm = this.fb.group({
      // Bind validator to check against existing products
      id: ['', [Validators.required, this.duplicateIdValidator.bind(this)]],
      name: ['', Validators.required],
      keyProduct: [''], // Added: Key Product Grade
      category: [this.categories[0], Validators.required], // Default to first option
      unit: [this.units[0], Validators.required],
      imageUrl: ['https://picsum.photos/200/200'],
      nutritionLabelUrl: [''], // Added: 營養標示圖片
      serviceStatus: ['正常供貨'], // Added: 服務狀態
      
      stock: [0, [Validators.required]], // Removed Validators.min(0) to allow negative stock
      safetyStock: [0, [Validators.required, Validators.min(0)]],
      allocatedStock: [0, Validators.min(0)], // Kept in form for compatibility but usually read-only
      externalStock: [0, Validators.min(0)],
      transitQuantity: [0, Validators.min(0)], // Added: 在途
      totalPickingQuantity: [{value: 0, disabled: true}], // Added: 總備貨 (Read only)
      qualityConfirmed: [0, Validators.min(0)], // Added: 已挑揀 (Number)
      
      priceBeforeTax: [0, [Validators.required]],
      priceAfterTax: [0, [Validators.required]],
      costBeforeTax: [0, [Validators.required]],
      costAfterTax: [0, [Validators.required]],
      recommendedPrice: [0], // Added: 建議售價
      
      supplierCode: ['', Validators.required],
      supplierName: [{value: '', disabled: true}, Validators.required], // Auto-filled based on code
      
      // Boolean Fields
      purchasingStatus: [true], // Default: 採購中
      controlStatus: [false],   // Default: 正常
      isDiscontinued: [false],  // Default: 正常銷售
      sugar: [false],           // Default: 無糖
      isCalculable: [true],     // Default: 應計算
      
      moq: [1, [Validators.required]],
      packageType: [1, [Validators.required]],
      origin: ['', Validators.required],
      shelfLife: [''],
      productFeatures: [''], // Added: 商品特色
      
      expiryNote: [''],
      highlightNote: [''],
      notes: ['']
    });

    // Auto-calculate tax logic
    // User Requirement: 
    // costAfterTax = costBeforeTax * 1.05
    // priceAfterTax = priceBeforeTax * 1.05
    // Automatically fill

    this.productForm.get('priceBeforeTax')?.valueChanges.subscribe(val => {
       const settings = this.dataService.systemSettings();
       const taxRate = settings.taxRate ?? 0.05; // Default 0.05 if not set
       const multiplier = 1 + taxRate;

       if (val !== null && val !== undefined && val !== '') {
           const num = parseFloat(val);
           if (!isNaN(num)) {
               const calculated = num * multiplier;
               // Round to 2 decimals
               const result = Math.round(calculated * 100) / 100;
               this.productForm.patchValue({ priceAfterTax: result }, { emitEvent: false });
           }
       }
    });

    this.productForm.get('costBeforeTax')?.valueChanges.subscribe(val => {
       const settings = this.dataService.systemSettings();
       const taxRate = settings.taxRate ?? 0.05;
       const multiplier = 1 + taxRate;

       if (val !== null && val !== undefined && val !== '') {
           const num = parseFloat(val);
           if (!isNaN(num)) {
               const calculated = num * multiplier;
               const result = Math.round(calculated * 100) / 100;
               
               // Fix: Also calculate recommended price here explicitly 
               // because emitEvent: false on costAfterTax patch prevents chain reaction
               const rec = Math.round(result / 0.9);

               this.productForm.patchValue({ 
                   costAfterTax: result,
                   recommendedPrice: rec 
               }, { emitEvent: false });
           }
       }
    });

    // Auto-calculate Recommended Price: costAfterTax / 0.9
    // This handles manual edits to costAfterTax
    this.productForm.get('costAfterTax')?.valueChanges.subscribe(val => {
       if (val !== null && val !== undefined && val !== '') {
           const num = parseFloat(val);
           if (!isNaN(num) && num > 0) {
               // Recommended = Cost / 0.9
               const rec = Math.round(num / 0.9);
               this.productForm.patchValue({ recommendedPrice: rec }, { emitEvent: false });
           }
       }
    });

    // Auto-fill Supplier Name based on Supplier Code selection
    this.productForm.get('supplierCode')?.valueChanges.subscribe(code => {
        const supplier = this.suppliers().find(s => s.code === code);
        if (supplier) {
            this.productForm.patchValue({ supplierName: supplier.shortName });
        }
    });

    // Auto-set isCalculable based on Category
    this.productForm.get('category')?.valueChanges.subscribe(cat => {
        const isNotCalculable = cat === '費用' || cat === '折讓';
        this.productForm.patchValue({ isCalculable: !isNotCalculable });
    });
  }

  // --- Download Template ---
  downloadTemplate() {
    const headers = [
      '商品編號', '商品名稱', '重點商品', '分類', '單位', 
      '庫存', '安全庫存', '已挑揀', 
      '未稅售價', '未稅成本', 
      '供應商代碼', '產地', 
      '控貨', '採購狀態', '有糖', '服務狀態', '商品特色', '備註'
    ];
    
    // Sample data to guide user
    const sample = [
      'P-SAMPLE-01', '範例商品名稱', 'A', '食品', '包',
      100, 20, 0,
      200, 100,
      'SUP-001', '台灣',
      '否', '是', '否', '限量配貨', '這是商品特色描述', '這是範例'
    ];

    const ws = utils.aoa_to_sheet([headers, sample]);
    
    // Auto-width hint
    ws['!cols'] = headers.map(() => ({ wch: 15 }));

    const wb = utils.book_new();
    utils.book_append_sheet(wb, ws, "商品匯入範本");
    writeFile(wb, "商品匯入範本.xlsx");
  }

  // --- Import Logic ---
  triggerImport() {
      const fileInput = document.getElementById('productImportInput') as HTMLInputElement;
      if(fileInput) fileInput.click();
  }

  async onImportFileSelected(event: Event) {
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
              // Use generic array of arrays or objects
              const jsonData = utils.sheet_to_json(worksheet);

              if (jsonData.length === 0) {
                  alert('檔案內容為空');
                  return;
              }

              let successCount = 0;
              let failCount = 0;
              
              const promises = jsonData.map(async (row: any) => {
                  try {
                      const product = this.mapRowToProduct(row);
                      // Basic validation: Name is required
                      if (product.name) {
                          // Check duplicate ID if present, otherwise DataService handles update/add
                          const exists = this.products().some(p => p.id === product.id);
                          if (exists) {
                              await this.dataService.updateProduct(product); // Update existing
                          } else {
                              await this.dataService.addProduct(product); // Add new
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
              alert(`匯入完成！\n成功: ${successCount} 筆\n失敗/跳過: ${failCount} 筆`);
              
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

  private mapRowToProduct(row: any): Product {
      const randomId = 'P-' + Math.floor(Math.random() * 100000).toString().padStart(6, '0');
      
      // Parse Booleans (Handle '是'/'否', 'Y'/'N', true/false)
      const parseBool = (val: any, defaultVal: boolean): boolean => {
          if (val === undefined || val === null || val === '') return defaultVal;
          const s = String(val).trim().toLowerCase();
          return ['true', 'yes', 'y', '是', '1'].includes(s);
      };

      // Auto calc tax
      const costBefore = Number(row['未稅成本']) || 0;
      const priceBefore = Number(row['未稅售價']) || 0;
      const settings = this.dataService.systemSettings();
      const taxRate = settings.taxRate || 0.05;
      const multiplier = 1 + taxRate;
      
      const costAfterTax = Math.round(costBefore * multiplier * 100) / 100;
      const recommendedPrice = Math.round(costAfterTax / 0.9);

      return {
          id: row['商品編號'] ? String(row['商品編號']).trim() : randomId,
          name: row['商品名稱'] ? String(row['商品名稱']).trim() : '',
          keyProduct: (['A', 'B', 'C'].includes(row['重點商品']) ? row['重點商品'] : '') as any,
          category: row['分類'] || '未分類',
          unit: row['單位'] || '個',
          stock: Number(row['庫存']) || 0,
          safetyStock: Number(row['安全庫存']) || 10,
          qualityConfirmed: Number(row['已挑揀']) || 0,
          
          priceBeforeTax: priceBefore,
          priceAfterTax: Math.round(priceBefore * multiplier * 100) / 100,
          costBeforeTax: costBefore,
          costAfterTax: costAfterTax,
          recommendedPrice: recommendedPrice,
          
          supplierCode: row['供應商代碼'] || 'UNKNOWN',
          supplierName: '', // Will be filled by service if possible, or leave empty
          origin: row['產地'] || '台灣',
          serviceStatus: row['服務狀態'] || '正常供貨',
          productFeatures: row['商品特色'] || '',
          
          controlStatus: parseBool(row['控貨'], false),
          purchasingStatus: parseBool(row['採購狀態'], true), // Default true
          sugar: parseBool(row['有糖'], false),
          isDiscontinued: false,
          isCalculable: true,
          
          moq: 1,
          packageType: 1,
          
          shelfLife: '',
          expiryNote: '',
          highlightNote: '',
          notes: row['備註'] || '',
          
          imageUrl: 'https://picsum.photos/200/200', // Default placeholder
          lastUpdated: new Date().toISOString(),
          
          // Defaults for derived fields
          allocatedStock: 0,
          externalStock: 0,
          transitQuantity: 0,
          totalPickingQuantity: 0
      };
  }

  // --- Image Upload ---
  async onImageUpload(event: Event) {
    const input = event.target as HTMLInputElement;
    if (input.files && input.files[0]) {
      const file = input.files[0];
      if (!file.type.startsWith('image/')) return;

      this.isUploading.set(true);
      try {
        const compressedBase64 = await this.imageService.compressImage(file);
        this.productForm.patchValue({ imageUrl: compressedBase64 });
        this.productForm.markAsDirty();
      } catch (error) {
        console.error('Image upload failed', error);
        alert('圖片處理失敗');
      } finally {
        this.isUploading.set(false);
        input.value = '';
      }
    }
  }

  // --- Nutrition Label Upload ---
  async onNutritionLabelUpload(event: Event) {
    const input = event.target as HTMLInputElement;
    if (input.files && input.files[0]) {
      const file = input.files[0];
      this.processNutritionFile(file);
      input.value = '';
    }
  }

  // --- NEW: Paste Handler for Nutrition Label ---
  async onNutritionLabelPaste(event: ClipboardEvent) {
    const items = event.clipboardData?.items;
    if (!items) return;

    for (let i = 0; i < items.length; i++) {
        if (items[i].type.indexOf('image') !== -1) {
            event.preventDefault(); // Prevent default paste behavior
            const file = items[i].getAsFile();
            if (file) {
                this.processNutritionFile(file);
            }
            break; // Stop after first image
        }
    }
  }

  // Helper to process file (from upload or paste)
  async processNutritionFile(file: File) {
      if (!file.type.startsWith('image/')) return;

      this.isUploading.set(true);
      try {
        const compressedBase64 = await this.imageService.compressImage(file, 1200, 0.8);
        this.productForm.patchValue({ nutritionLabelUrl: compressedBase64 });
        this.productForm.markAsDirty();
      } catch (error) {
        console.error('Nutrition label processing failed', error);
        alert('營養標示圖片處理失敗');
      } finally {
        this.isUploading.set(false);
      }
  }

  // --- Hover Image Logic ---
  showHoverImage(url: any) {
      if (typeof url === 'string' && url.length > 0) {
          this.hoveredImage.set(url);
      }
  }

  hideHoverImage() {
      this.hoveredImage.set(null);
  }

  paginatedProducts = computed(() => {
    const products = this.filteredProducts();
    const startIndex = (this.currentPage() - 1) * this.pageSize();
    return products.slice(startIndex, startIndex + this.pageSize());
  });

  filteredProducts = computed(() => {
    const term = this.searchTerm().toLowerCase();
    const category = this.selectedCategory();
    const control = this.selectedControlStatus(); // 'true', 'false', ''
    const avail = this.selectedAvailability();
    const stockStatus = this.selectedStockStatus();
    const supplier = this.selectedSupplier();

    let result = this.products().filter(p => {
      // 1. Search
      const matchesSearch = !term || 
        p.name.toLowerCase().includes(term) || 
        p.id.toLowerCase().includes(term) ||
        (p.supplierCode && p.supplierCode.toLowerCase().includes(term)) ||
        (p.keyProduct && p.keyProduct.toLowerCase().includes(term));

      // 2. Category
      const matchesCategory = !category || p.category === category;

      // 3. Control Status
      let matchesControl = true;
      if (control === 'true') matchesControl = p.controlStatus === true;
      if (control === 'false') matchesControl = p.controlStatus === false;

      // 4. Availability
      let matchesAvail = true;
      if (avail === 'active') matchesAvail = !p.isDiscontinued;
      if (avail === 'discontinued') matchesAvail = p.isDiscontinued;

      // 5. Stock Status
      let matchesStock = true;
      if (stockStatus === 'low') matchesStock = p.stock < p.safetyStock;
      
      // 6. Supplier
      const matchesSupplier = !supplier || p.supplierCode === supplier;

      return matchesSearch && matchesCategory && matchesControl && matchesAvail && matchesStock && matchesSupplier;
    });

    // Sorting Logic
    const col = this.sortColumn();
    const dir = this.sortDirection();
    
    if (col) {
        result = result.sort((a, b) => {
            let valA: any;
            let valB: any;

            if (col === 'demand') {
                valA = this.outstandingDemandMap().get(a.id) || 0;
                valB = this.outstandingDemandMap().get(b.id) || 0;
            } else if (col === 'totalPickingQuantity') {
                valA = this.totalPickingQuantityMap().get(a.id) || 0;
                valB = this.totalPickingQuantityMap().get(b.id) || 0;
            } else if (col === 'transit') {
                valA = this.transitQuantityMap().get(a.id) || 0;
                valB = this.transitQuantityMap().get(b.id) || 0;
            } else if (col === 'priceBeforeTax') {
                valA = a.priceBeforeTax || 0;
                valB = b.priceBeforeTax || 0;
            } else {
                valA = (a as any)[col];
                valB = (b as any)[col];
            }

            // Handle numeric sorting
            if (typeof valA === 'number' && typeof valB === 'number') {
                return (valA - valB) * (dir === 'asc' ? 1 : -1);
            }
            
            // Handle string sorting
            const strA = (valA || '').toString();
            const strB = (valB || '').toString();
            return strA.localeCompare(strB, 'zh-TW') * (dir === 'asc' ? 1 : -1);
        });
    }

    return result;
  });

  // --- Pagination Logic ---
  totalItems = computed(() => this.filteredProducts().length);
  totalPages = computed(() => Math.ceil(this.totalItems() / this.pageSize()));
  
  itemStart = computed(() => {
      if (this.totalItems() === 0) return 0;
      return (this.currentPage() - 1) * this.pageSize() + 1;
  });

  itemEnd = computed(() => {
      const end = this.currentPage() * this.pageSize();
      return end > this.totalItems() ? this.totalItems() : end;
  });

  nextPage() {
    if (this.currentPage() < this.totalPages()) {
      this.currentPage.update(p => p + 1);
    }
  }

  prevPage() {
    if (this.currentPage() > 1) {
      this.currentPage.update(p => p - 1);
    }
  }

  // --- Actions ---

  onSearchTermChange(event: Event): void {
    const value = (event.target as HTMLInputElement).value;
    this.searchTerm.set(value);
    this.currentPage.set(1); // Reset page
  }

  onCategoryChange(event: Event): void {
    const value = (event.target as HTMLSelectElement).value;
    this.selectedCategory.set(value);
    this.currentPage.set(1);
  }

  onControlStatusChange(event: Event): void {
    const value = (event.target as HTMLSelectElement).value;
    this.selectedControlStatus.set(value);
    this.currentPage.set(1);
  }

  onAvailabilityChange(event: Event): void {
    const value = (event.target as HTMLSelectElement).value;
    this.selectedAvailability.set(value);
    this.currentPage.set(1);
  }

  onStockStatusChange(event: Event): void {
      const value = (event.target as HTMLSelectElement).value;
      this.selectedStockStatus.set(value);
      this.currentPage.set(1);
  }

  onSupplierFilterChange(event: Event): void {
      const value = (event.target as HTMLSelectElement).value;
      this.selectedSupplier.set(value);
      this.currentPage.set(1);
  }

  onSortColumnChange(event: Event): void {
      const value = (event.target as HTMLSelectElement).value;
      this.sortColumn.set(value);
      this.currentPage.set(1);
  }

  toggleSortDirection(): void {
      this.sortDirection.update(d => d === 'asc' ? 'desc' : 'asc');
  }

  toggleSort(column: string) {
      if (this.sortColumn() === column) {
          this.sortDirection.update(d => d === 'asc' ? 'desc' : 'asc');
      } else {
          this.sortColumn.set(column);
          this.sortDirection.set('asc');
      }
  }

  clearAllFilters() {
      this.searchTerm.set('');
      this.selectedCategory.set('');
      this.selectedControlStatus.set('');
      this.selectedAvailability.set('active'); // Reset to default 'active'
      this.selectedStockStatus.set('all');
      this.selectedSupplier.set('');
      this.sortColumn.set('');
      this.currentPage.set(1);
  }
  
  deleteProduct(product: Product, event: Event) {
      event.stopPropagation(); // Prevent row click triggering edit
      if (confirm(`確定要刪除商品「${product.name}」嗎？\n此動作無法復原。`)) {
          this.dataService.deleteProduct(product.id);
      }
  }

  // --- Inline Editing ---
  
  onStockUpdate(product: Product, event: Event) {
      const newVal = parseFloat((event.target as HTMLInputElement).value); // Allowed decimals
      // Allowed negative values
      if (!isNaN(newVal)) {
          const updated = { ...product, stock: newVal, lastUpdated: new Date().toISOString() };
          this.dataService.updateProduct(updated);
      }
  }

  // NEW: External Stock Update
  onExternalStockUpdate(product: Product, event: Event) {
      const newVal = parseFloat((event.target as HTMLInputElement).value); // Allowed decimals
      if (!isNaN(newVal) && newVal >= 0) {
          const updated = { ...product, externalStock: newVal, lastUpdated: new Date().toISOString() };
          this.dataService.updateProduct(updated);
      }
  }
  
  // NEW: Safety Stock Update
  onSafetyStockUpdate(product: Product, event: Event) {
      const newVal = parseFloat((event.target as HTMLInputElement).value); // Allowed decimals
      if (!isNaN(newVal) && newVal >= 0) {
          const updated = { ...product, safetyStock: newVal, lastUpdated: new Date().toISOString() };
          this.dataService.updateProduct(updated);
      }
  }

  // NEW: Cost Update (Inline) with Tax Sync
  onCostUpdate(product: Product, event: Event) {
      const newVal = parseFloat((event.target as HTMLInputElement).value);
      if (!isNaN(newVal) && newVal >= 0) {
          const settings = this.dataService.systemSettings();
          const taxRate = settings.taxRate ?? 0.05;
          const costAfterTax = Math.round(newVal * (1 + taxRate) * 100) / 100;
          const recommendedPrice = Math.round(costAfterTax / 0.9);

          const updated = { 
              ...product, 
              costBeforeTax: newVal, 
              costAfterTax: costAfterTax,
              recommendedPrice: recommendedPrice,
              lastUpdated: new Date().toISOString() 
          };
          this.dataService.updateProduct(updated);
      }
  }

  // NEW: Package Type Update
  onPackageTypeUpdate(product: Product, event: Event) {
      const newVal = parseInt((event.target as HTMLInputElement).value, 10);
      if (!isNaN(newVal) && newVal > 0) {
          const updated = { ...product, packageType: newVal, lastUpdated: new Date().toISOString() };
          this.dataService.updateProduct(updated);
      }
  }

  onQualityConfirmedUpdate(product: Product, event: Event) {
      const newVal = parseFloat((event.target as HTMLInputElement).value); // Allowed decimals
      if (!isNaN(newVal) && newVal >= 0) {
          const updated = { ...product, qualityConfirmed: newVal, lastUpdated: new Date().toISOString() };
          this.dataService.updateProduct(updated);
      }
  }

  onInlineUpdate(product: Product, field: 'expiryNote' | 'highlightNote', event: Event) {
      const val = (event.target as HTMLInputElement).value;
      if (product[field] !== val) {
          const updated = { ...product, [field]: val, lastUpdated: new Date().toISOString() };
          this.dataService.updateProduct(updated);
      }
  }

  // --- CRUD Modals ---

  openAddModal() {
    this.isEditMode.set(false);
    this.initForm();
    this.productForm.patchValue({ id: '' }); // Ensure ID is empty for manual input
    this.showModal.set(true);
  }

  openEditModal(product: Product) {
    this.isEditMode.set(true);
    this.initForm();
    
    this.productForm.patchValue({
        ...product
    });
    
    // Disable ID editing
    this.productForm.get('id')?.disable();
    this.showModal.set(true);
  }

  closeModal() {
    this.showModal.set(false);
  }

  async onSubmit() {
    if (this.productForm.valid) {
      const formValue = this.productForm.getRawValue();
      const productData: Product = { 
          ...formValue, 
          lastUpdated: new Date().toISOString() 
      };

      try {
        if (this.isEditMode()) {
          await this.dataService.updateProduct(productData);
        } else {
          // Double check for duplicate ID (Validator should handle this, but extra safety)
          const exists = this.dataService.products().some(p => p.id === productData.id);
          if (exists) {
              alert(`錯誤：商品編號 (ID) "${productData.id}" 已存在，請修改編號。`);
              return;
          }
          await this.dataService.addProduct(productData);
          // Reset to first page to see the new product
          this.currentPage.set(1);
        }
        
        // Success feedback
        alert('儲存成功！');
        this.closeModal();
      } catch (error: any) {
        console.error('儲存失敗:', error);
        alert('儲存失敗，請檢查網路連線或權限設定。\n錯誤訊息: ' + (error.message || '未知錯誤'));
      }
    } else {
      this.productForm.markAllAsTouched();
      
      // Identify invalid fields for better user guidance
      const invalidFields = Object.keys(this.productForm.controls)
        .filter(key => this.productForm.controls[key].invalid)
        .map(key => {
            // Map technical keys to Chinese names for better UX
            const mapping: any = {
                id: '商品編號',
                name: '商品名稱',
                category: '分類',
                unit: '單位',
                supplierCode: '供應商代碼',
                origin: '產地',
                priceBeforeTax: '未稅售價',
                costBeforeTax: '未稅成本'
            };
            return mapping[key] || key;
        });

      console.warn('Form Invalid Controls:', invalidFields);
      alert('請檢查必填欄位是否填寫完整：\n' + invalidFields.join(', '));
    }
  }

  copyProduct(product: Product, event: Event) {
      event.stopPropagation();
      
      // 1. 設定為新增模式 (因為最終是產生新的一筆)
      this.isEditMode.set(false);
      this.initForm();
      
      // 2. 填入來源資料
      // 根據需求：保留原始 ID 格式供使用者修改
      this.productForm.patchValue({
          ...product,
          // 保留原始 ID，使用者需手動修改後才能存檔
          id: product.id, 
          // 名稱加上 (複製)
          name: `${product.name} (複製)`,
          // 重置庫存相關數據
          stock: 0,
          qualityConfirmed: 0,
          allocatedStock: 0,
          transitQuantity: 0,
          totalPickingQuantity: 0,
          // 確保新商品是銷售中
          isDiscontinued: false,
          // 保留營養標示圖片
          nutritionLabelUrl: product.nutritionLabelUrl
      });
      
      // 3. 確保 ID 欄位是可編輯的
      this.productForm.get('id')?.enable();
      
      // 4. 開啟視窗
      this.showModal.set(true);
  }

  // --- Transit Tooltip Logic ---
  
  showTransitTooltip(event: MouseEvent, productId: string) {
      const pos = this.purchaseOrders().filter(po => 
          po.productId === productId && 
          (po.status === '廠商確認' || po.status === '部份到貨')
      ).map(po => ({
          id: po.poNumber || po.purchaseId,
          qty: Math.max(0, po.quantity - (po.receivedQuantity || 0)),
          status: po.status
      }));

      if (pos.length > 0) {
          const target = event.currentTarget as HTMLElement;
          const rect = target.getBoundingClientRect();
          this.transitTooltip.set({
              items: pos,
              x: rect.left + (rect.width / 2),
              y: rect.top - 10
          });
      }
  }

  hideTransitTooltip() {
      this.transitTooltip.set(null);
  }
}
