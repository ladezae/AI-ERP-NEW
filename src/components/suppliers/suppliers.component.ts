
import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ReactiveFormsModule, FormBuilder, FormGroup, Validators } from '@angular/forms';
import { DataService } from '../../services/data.service';
import { AiService } from '../../services/ai.service';
import { Supplier } from '../../models/erp.models';
import { ResizableDirective } from '../../directives/resizable.directive';
import { utils, writeFile, read } from 'xlsx';

@Component({
  selector: 'app-suppliers',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CommonModule, ReactiveFormsModule, ResizableDirective],
  templateUrl: './suppliers.component.html'
})
export class SuppliersComponent {
  private dataService = inject(DataService);
  private aiService = inject(AiService);
  private fb: FormBuilder = inject(FormBuilder);

  suppliers = this.dataService.suppliers;
  searchTerm = signal('');
  selectedCategory = signal(''); // New: Category Filter Signal
  
  showModal = signal(false);
  isEditMode = signal(false); // New state for edit mode
  
  // Import State
  isImporting = signal(false);
  
  // Research State
  showResearchModal = signal(false);
  researchingSupplier = signal<string>('');
  researchResult = signal<{text: string, sources: any[]} | null>(null);
  isResearching = signal(false);
  researchError = signal('');

  supplierForm!: FormGroup;

  // Suppliers keep the full range of logistics options
  readonly logisticsOptions = ['黑貓', '大榮'];

  // Identical categories list to Products module
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

  constructor() {
    this.initForm();
  }

  initForm() {
    // Removed Validators.required from all fields
    this.supplierForm = this.fb.group({
      code: [''],
      shortName: [''],
      fullName: [''],
      taxId: [''],
      supplierCategory: [''], // 新增: 供應商類別
      
      jobTitle: [''],
      phone: [''],
      mobile: [''],
      lineId: [''],
      email: ['', [Validators.email]], // Keep email format check, but not required
      
      address: [''],
      website: [''],
      
      shipLogistics: [''], // Renamed from logistics
      paymentTerms: [false], // Changed to boolean (default false=後付)
      taxType: [true], // Default True (應稅)
      invoiceRule: [true], // Default True (隨貨)
      freeShippingThreshold: [0, [Validators.min(0)]] // Added: 免運門檻
    });
  }

  filteredSuppliers = computed(() => {
    const term = this.searchTerm().toLowerCase();
    const cat = this.selectedCategory();

    return this.suppliers().filter(s => {
      const matchesSearch = !term || (
        s.code.toLowerCase().includes(term) || 
        s.shortName.toLowerCase().includes(term) ||
        s.fullName.toLowerCase().includes(term) ||
        s.taxId.includes(term) ||
        (s.supplierCategory && s.supplierCategory.toLowerCase().includes(term))
      );

      const matchesCategory = !cat || s.supplierCategory === cat;

      return matchesSearch && matchesCategory;
    });
  });

  onSearchTermChange(event: Event): void {
    const value = (event.target as HTMLInputElement).value;
    this.searchTerm.set(value);
  }

  onCategoryChange(event: Event): void {
    const value = (event.target as HTMLSelectElement).value;
    this.selectedCategory.set(value);
  }

  openAddModal() {
    this.isEditMode.set(false);
    this.initForm(); // Re-initialize to clear values and reset controls
    this.showModal.set(true);
  }

  openEditModal(supplier: Supplier) {
    this.isEditMode.set(true);
    this.initForm();
    this.supplierForm.patchValue(supplier);
    // Disable primary key editing
    this.supplierForm.get('code')?.disable(); 
    this.showModal.set(true);
  }

  closeModal() {
    this.showModal.set(false);
  }
  
  // --- Import / Export Logic ---
  
  downloadTemplate() {
    const headers = [
      '供應商代碼', '簡稱', '全名', '統編', '供應商類別',
      '職稱', '電話', '手機', 'Email', '地址',
      '物流', '付款條件(是=先匯款)', '是否應稅(是=應稅)', '發票隨貨(是=隨貨)', '免運門檻'
    ];
    
    const sample = [
      'SUP-001', '範例供應商', '範例股份有限公司', '12345678', '食品',
      '經理', '02-23456789', '0912345678', 'test@example.com', '台北市信義區',
      '黑貓', '是', '是', '是', 2000
    ];

    const ws = utils.aoa_to_sheet([headers, sample]);
    
    // Auto-width hint
    ws['!cols'] = headers.map(() => ({ wch: 15 }));

    const wb = utils.book_new();
    utils.book_append_sheet(wb, ws, "供應商匯入範本");
    writeFile(wb, "供應商匯入範本.xlsx");
  }
  
  triggerImport() {
      const fileInput = document.getElementById('supplierImportInput') as HTMLInputElement;
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
                      const supplier = this.mapRowToSupplier(row);
                      // Basic validation
                      if (supplier.shortName) {
                          const exists = this.suppliers().some(s => s.code === supplier.code);
                          if (exists) {
                              await this.dataService.updateSupplier(supplier);
                          } else {
                              await this.dataService.addSupplier(supplier);
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

  private mapRowToSupplier(row: any): Supplier {
      const randomId = 'SUP-' + Math.floor(Math.random() * 10000).toString().padStart(4, '0');
      
      const parseBool = (val: any, defaultVal: boolean): boolean => {
          if (val === undefined || val === null || val === '') return defaultVal;
          const s = String(val).trim().toLowerCase();
          return ['true', 'yes', 'y', '是', '1'].includes(s);
      };

      return {
          code: row['供應商代碼'] ? String(row['供應商代碼']).trim() : randomId,
          shortName: row['簡稱'] ? String(row['簡稱']).trim() : (row['全名'] || '未命名'),
          fullName: row['全名'] || '',
          taxId: row['統編'] ? String(row['統編']) : '',
          supplierCategory: row['供應商類別'] || '',
          
          jobTitle: row['職稱'] || '',
          phone: row['電話'] || '',
          mobile: row['手機'] || '',
          lineId: '', // Excel 範本沒放，預設空
          email: row['Email'] || '',
          address: row['地址'] || '',
          website: '',
          
          shipLogistics: row['物流'] || '',
          paymentTerms: parseBool(row['付款條件(是=先匯款)'], false), // Default: 後付
          taxType: parseBool(row['是否應稅(是=應稅)'], true), // Default: 應稅
          invoiceRule: parseBool(row['發票隨貨(是=隨貨)'], true), // Default: 隨貨
          freeShippingThreshold: Number(row['免運門檻']) || 0
      };
  }
  
  // --- Research Logic ---
  
  openResearchModal(supplierName: string) {
     this.researchingSupplier.set(supplierName);
     this.showResearchModal.set(true);
     this.researchResult.set(null);
     this.researchError.set('');
     this.startResearch(supplierName);
  }
  
  closeResearchModal() {
     this.showResearchModal.set(false);
  }
  
  async startResearch(name: string) {
      this.isResearching.set(true);
      const query = `請搜尋關於「${name}」這家公司的最新市場資訊、主要產品、任何公開的評價或新聞。請總結這家公司的信譽與業務概況。如果這是一家食品相關公司，請特別留意食安相關新聞。`;
      
      try {
          const result = await this.aiService.performWebSearch(query);
          this.researchResult.set(result);
      } catch(err: any) {
          this.researchError.set(err.message || '搜尋發生錯誤');
      } finally {
          this.isResearching.set(false);
      }
  }

  // --- Delete Logic ---
  deleteSupplier(supplier: Supplier, event: Event) {
      event.stopPropagation();
      if (confirm(`確定要刪除供應商「${supplier.shortName}」嗎？\n此動作無法復原。`)) {
          this.dataService.deleteSupplier(supplier.code);
      }
  }

  onSubmit() {
    if (this.supplierForm.valid) {
      // Use getRawValue() to include disabled fields like 'code'
      const supplierData: Supplier = this.supplierForm.getRawValue();
      
      // Safety Net: Auto-generate ID if missing (Critical for DB)
      if (!supplierData.code) {
          const random = Math.floor(1000 + Math.random() * 9000).toString();
          supplierData.code = `SUP-${random}`;
      }

      // Safety Net: Ensure display name exists
      if (!supplierData.shortName) {
          supplierData.shortName = supplierData.fullName || `未命名(${supplierData.code})`;
      }
      
      if (this.isEditMode()) {
        this.dataService.updateSupplier(supplierData);
      } else {
        this.dataService.addSupplier(supplierData);
      }
      this.closeModal();
    } else {
      this.supplierForm.markAllAsTouched();
    }
  }
}

