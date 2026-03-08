
import { ChangeDetectionStrategy, Component, computed, inject, signal, effect } from '@angular/core';
import { CommonModule, DecimalPipe } from '@angular/common';
import { ReactiveFormsModule, FormBuilder, FormGroup, Validators, FormsModule } from '@angular/forms';
import { DataService } from '../../services/data.service';
import { AiService } from '../../services/ai.service';
import { Invoice, InvoiceType, PurchaseOrder, Order, CompanyProfile } from '../../models/erp.models';
import { ResizableDirective } from '../../directives/resizable.directive';
import { read, utils, writeFile, write } from 'xlsx';
import JSZip from 'jszip';

@Component({
  selector: 'app-finance',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CommonModule, ReactiveFormsModule, FormsModule, ResizableDirective],
  providers: [DecimalPipe],
  templateUrl: './finance.component.html'
})
export class FinanceComponent {
  private dataService = inject(DataService);
  private aiService = inject(AiService);
  private fb = inject(FormBuilder);

  // Data
  invoices = this.dataService.invoices;
  purchaseOrders = this.dataService.purchaseOrders;
  orders = this.dataService.orders;
  suppliers = this.dataService.suppliers; 
  companies = this.dataService.companies; 
  
  // UI State
  activeTab = signal<InvoiceType>('Input');
  selectedCompanyId = signal<string>(''); 
  editingInvoiceId = signal<string | null>(null); // Track editing state
  isFullScreen = signal(false); // New: Fullscreen mode state
  invoiceForm!: FormGroup;
  isImporting = signal(false); // Import loading state

  // Delete Confirmation State
  invoiceToDelete = signal<Invoice | null>(null);
  
  // Selection State
  selectedInvoiceIds = signal<Set<string>>(new Set());
  
  // Global Duplicate Check State
  showGlobalDuplicateModal = signal(false);
  globalDuplicateResults = signal<{ invoiceNumber: string, invoices: Invoice[] }[]>([]);
  
  // Global Search State
  showGlobalSearchModal = signal(false);
  globalSearchType = signal<'invoiceNumber' | 'totalAmount'>('invoiceNumber');
  globalSearchQuery = signal<string>('');
  globalSearchResults = signal<Invoice[]>([]);

  // Batch Download State
  showBatchDownloadModal = signal(false);
  showReportPreviewModal = signal(false); // Added: 401 Report Preview Modal
  showTaxAuditModal = signal(false); // Added: Tax Audit Modal
  showAiInsightModal = signal(false); // Added: AI Insight Modal
  aiInsightContent = signal<string>(''); // Added: AI Insight Content
  isAnalyzing = signal(false); // Added: AI Analysis Loading State
  batchSelectedCompanyIds = signal<Set<string>>(new Set());
  batchSelectedPeriods = signal<Set<number>>(new Set());
  batchSelectedYear = signal(new Date().getFullYear());
  
  isAllSelected = computed(() => {
      const filtered = this.filteredInvoices();
      if (filtered.length === 0) return false;
      const selected = this.selectedInvoiceIds();
      return filtered.every(inv => selected.has(inv.id));
  });

  visibleSelectedCount = computed(() => {
      const selected = this.selectedInvoiceIds();
      const filtered = this.filteredInvoices();
      return filtered.filter(inv => selected.has(inv.id)).length;
  });

  // Import Mapping State
  showImportModal = signal(false);
  importFileHeaders = signal<string[]>([]);
  importFileData = signal<any[]>([]);
  
  // Defined System Fields for Mapping
  readonly systemImportFields = [
      { key: 'date', label: '日期 (YYYY-MM-DD)', required: true },
      { key: 'invoiceNumber', label: '發票號碼', required: true },
      { key: 'companyName', label: '交易對象 (買方/賣方)', required: false },
      { key: 'taxId', label: '統編', required: false },
      { key: 'salesAmount', label: '銷售額 (未稅)', required: false }, // Changed to optional (can calc from total)
      { key: 'taxAmount', label: '稅額 (營業稅)', required: false },
      { key: 'totalAmount', label: '總金額 (含稅)', required: false }, // Added
      { key: 'note', label: '備註', required: false },
      { key: 'formatCode', label: '格式代號', required: false },
      { key: 'status', label: '發票狀態', required: false }
  ];

  // =================================================================
  // ★★★ [設定區] Excel 匯入欄位自動對照表 ★★★
  // =================================================================
  readonly PREDEFINED_MAPPINGS: Record<string, string[]> = {
    'date': ['發票日期', '日期', 'Date', 'Invoice Date', '開立日期', '交易日期', '開立年月'],
    'invoiceNumber': ['發票號碼', '發票號', '號碼', 'Invoice No', 'Invoice Number', 'No.'],
    'companyName': ['買方名稱', '賣方名稱', '買受人', '買受人名稱', '交易對象', '公司名稱', '廠商名稱', '客戶名稱', 'Buyer', 'Seller', '買方', '賣方'],
    'taxId': ['買方統一編號', '賣方統一編號', '統一編號', '統編', '買受人統編', 'Tax ID', 'VAT No', '買方統編', '賣方統編'],
    'salesAmount': ['應稅銷售額', '銷售額', '未稅金額', '金額', 'Sales Amount', 'Amount', 'Subtotal', '銷售額合計'],
    'taxAmount': ['營業稅', '稅額', 'Tax', 'VAT', 'Tax Amount', '營業稅額'],
    'totalAmount': ['總計', '總金額', '含稅金額', 'Total', 'Total Amount', '總計金額'],
    'note': ['總備註', '備註', '說明', 'Note', 'Remarks', 'Description'],
    'formatCode': ['格式代號', '格式', 'Format Code', 'Format', '課稅別'],
    'status': ['發票狀態', '狀態', 'Status', 'Invoice Status', 'State']
  };

  // Stores the user's selection: { 'date': 'Excel Column A', 'invoiceNumber': 'Excel Column B' }
  columnMappings = signal<Record<string, string>>({});

  // New Filters
  searchTerm = signal('');
  selectedStatusFilter = signal('all'); // 'all' | '成立' | '作廢'
  selectedRetentionFilter = signal('all'); // 'all' | 'true' | 'false'
  selectedCopyReportedFilter = signal('all'); // 'all' | 'true' | 'false'
  selectedCostCategoryFilter = signal(''); // '' = all
  selectedCrossPeriodFilter = signal('all'); // 'all' | 'true' | 'false'
  selectedFormatFilter = signal('all'); // 'all' | '21' | '22' | '25' | '31' | '32' | '35' | '電子'

  // Sorting State
  sortColumn = signal<string>('date'); // Default sort by date
  sortDirection = signal<'asc' | 'desc'>('desc'); // Default desc

  // Cost Categories
  readonly costCategories = [
    '產品進貨',
    '平台 / 行銷',
    '運費 / 郵資',
    '油資 / 停車費',
    '包材 / 印刷',
    '規費 / 勞健保',
    '設備 / 文具 / 雜支',
    '會計費 / 稅金'
  ];

  // Format Code Display Map
  readonly formatMap: Record<string, string> = {
    '21': '21 三聯',
    '22': '22 二聯',
    '25': '25',
    '31': '31 三聯',
    '32': '32 二聯',
    '35': '35',
    '電子': '電子'
  };

  // --- Tax Period Logic ---
  currentDate = new Date();
  selectedYear = signal(this.currentDate.getFullYear());
  selectedPeriod = signal(Math.ceil((this.currentDate.getMonth() + 1) / 2));

  readonly periods = [
    { id: 1, label: '第一期', sub: '1-2 月' },
    { id: 2, label: '第二期', sub: '3-4 月' },
    { id: 3, label: '第三期', sub: '5-6 月' },
    { id: 4, label: '第四期', sub: '7-8 月' },
    { id: 5, label: '第五期', sub: '9-10 月' },
    { id: 6, label: '第六期', sub: '11-12 月' },
  ];

  // Helper: Filter Logic for Period
  private isInvoiceInPeriod(inv: Invoice): boolean {
      if (!inv.date) return false;
      const d = new Date(inv.date);
      const year = d.getFullYear();
      const month = d.getMonth() + 1; // 1-12
      const period = Math.ceil(month / 2);

      return year === this.selectedYear() && period === this.selectedPeriod();
  }

  // Filtered Lists for Linking
  taxableSuppliers = computed(() => {
      return this.suppliers().filter(s => s.taxType === true);
  });

  activePurchaseOrders = computed(() => {
      const pos = this.purchaseOrders().filter(p => p.status !== '取消' && p.status !== '已結案');
      const uniqueMap = new Map<string, PurchaseOrder>();
      pos.forEach(p => {
          const key = p.poNumber || p.purchaseId;
          if (!uniqueMap.has(key)) uniqueMap.set(key, p);
      });
      return Array.from(uniqueMap.values());
  });

  activeOrders = computed(() => {
      const ords = this.orders().filter(o => o.status !== '取消' && o.status !== '已結案');
      const uniqueMap = new Map<string, Order>();
      ords.forEach(o => {
          const parts = o.orderId.split('-');
          const baseId = parts.length > 3 ? parts.slice(0, 3).join('-') : o.orderId;
          if (!uniqueMap.has(baseId)) uniqueMap.set(baseId, o);
      });
      return Array.from(uniqueMap.values());
  });

  // Stats Computed (Filtered by Company AND Period)
  totalInputTax = computed(() => 
      this.invoices()
          .filter(i => 
              i.type === 'Input' && 
              (!i.ownerCompanyId || i.ownerCompanyId === this.selectedCompanyId()) &&
              this.isInvoiceInPeriod(i) &&
              !i.isRetention && // Exclude Retained
              !i.isCrossPeriod && // Exclude Cross Period
              i.status !== '作廢' // Exclude Voided
          )
          .reduce((sum, i) => sum + i.taxAmount, 0)
  );
  
  totalPurchaseAmount = computed(() => 
      this.invoices()
          .filter(i => 
              i.type === 'Input' && 
              (!i.ownerCompanyId || i.ownerCompanyId === this.selectedCompanyId()) &&
              this.isInvoiceInPeriod(i) &&
              !i.isRetention && // Exclude Retained
              !i.isCrossPeriod && // Exclude Cross Period
              i.status !== '作廢' // Exclude Voided
          )
          .reduce((sum, i) => sum + i.totalAmount, 0) // Sum TOTAL amount as requested
  );

  // NEW: Total Retained Amount (Net Sales) - CURRENT PERIOD
  totalRetainedAmount = computed(() => 
      this.invoices()
          .filter(i => 
              i.type === 'Input' && 
              (!i.ownerCompanyId || i.ownerCompanyId === this.selectedCompanyId()) &&
              this.isInvoiceInPeriod(i) &&
              i.isRetention && // Only Retained
              i.status !== '作廢' // Exclude Voided
          )
          .reduce((sum, i) => sum + i.salesAmount, 0)
  );

  // NEW: Total Retained Tax - CURRENT PERIOD
  totalRetainedTax = computed(() => 
      this.invoices()
          .filter(i => 
              i.type === 'Input' && 
              (!i.ownerCompanyId || i.ownerCompanyId === this.selectedCompanyId()) &&
              this.isInvoiceInPeriod(i) &&
              i.isRetention && // Only Retained
              i.status !== '作廢' // Exclude Voided
          )
          .reduce((sum, i) => sum + i.taxAmount, 0)
  );

  // --- LAST PERIOD RETENTION CALCULATION ---
  private getLastPeriodInfo(): { year: number, period: number } {
      let targetPeriod = this.selectedPeriod() - 1;
      let targetYear = this.selectedYear();

      if (targetPeriod < 1) {
          targetPeriod = 6;
          targetYear -= 1;
      }
      return { year: targetYear, period: targetPeriod };
  }

  // NEW: Total Last Period Retained Amount
  totalLastPeriodRetainedAmount = computed(() => {
      const { year, period } = this.getLastPeriodInfo();
      
      return this.invoices()
          .filter(i => {
              if (!i.date) return false;
              const d = new Date(i.date);
              const iYear = d.getFullYear();
              const iPeriod = Math.ceil((d.getMonth() + 1) / 2);
              
              return i.type === 'Input' &&
                     (!i.ownerCompanyId || i.ownerCompanyId === this.selectedCompanyId()) &&
                     iYear === year && iPeriod === period && // Previous Period
                     i.isRetention && // Only Retained
                     i.status !== '作廢';
          })
          .reduce((sum, i) => sum + i.totalAmount, 0); // Using Total Amount
  });

  // NEW: Total Last Period Retained Tax
  totalLastPeriodRetainedTax = computed(() => {
      const { year, period } = this.getLastPeriodInfo();

      return this.invoices()
          .filter(i => {
              if (!i.date) return false;
              const d = new Date(i.date);
              const iYear = d.getFullYear();
              const iPeriod = Math.ceil((d.getMonth() + 1) / 2);

              return i.type === 'Input' &&
                     (!i.ownerCompanyId || i.ownerCompanyId === this.selectedCompanyId()) &&
                     iYear === year && iPeriod === period && // Previous Period
                     i.isRetention && // Only Retained
                     i.status !== '作廢';
          })
          .reduce((sum, i) => sum + i.taxAmount, 0);
  });

  // NEW: Total Cross Period Offset Amount (Total) - PREVIOUS PERIOD, isCrossPeriod=TRUE
  totalCrossPeriodOffsetAmount = computed(() => {
      const { year, period } = this.getLastPeriodInfo();
      
      return this.invoices()
          .filter(i => {
              if (!i.date) return false;
              const d = new Date(i.date);
              const iYear = d.getFullYear();
              const iPeriod = Math.ceil((d.getMonth() + 1) / 2);
              
              return i.type === 'Input' &&
                     (!i.ownerCompanyId || i.ownerCompanyId === this.selectedCompanyId()) &&
                     iYear === year && iPeriod === period && // Previous Period
                     i.isCrossPeriod === true && // Must be Cross Period
                     i.status !== '作廢';
          })
          .reduce((sum, i) => sum + i.totalAmount, 0); // Calculate Total Amount as requested
  });

  // NEW: Total Cross Period Offset Tax
  totalCrossPeriodOffsetTax = computed(() => {
      const { year, period } = this.getLastPeriodInfo();

      return this.invoices()
          .filter(i => {
              if (!i.date) return false;
              const d = new Date(i.date);
              const iYear = d.getFullYear();
              const iPeriod = Math.ceil((d.getMonth() + 1) / 2);

              return i.type === 'Input' &&
                     (!i.ownerCompanyId || i.ownerCompanyId === this.selectedCompanyId()) &&
                     iYear === year && iPeriod === period && // Previous Period
                     i.isCrossPeriod === true && // Must be Cross Period
                     i.status !== '作廢';
          })
          .reduce((sum, i) => sum + i.taxAmount, 0);
  });

  totalOutputTax = computed(() => 
      this.invoices()
          .filter(i => 
              i.type === 'Output' && 
              (!i.ownerCompanyId || i.ownerCompanyId === this.selectedCompanyId()) &&
              this.isInvoiceInPeriod(i) &&
              i.status !== '作廢' // Exclude Voided
          )
          .reduce((sum, i) => sum + i.taxAmount, 0)
  );

  totalSalesAmount = computed(() => 
      this.invoices()
          .filter(i => 
              i.type === 'Output' && 
              (!i.ownerCompanyId || i.ownerCompanyId === this.selectedCompanyId()) &&
              this.isInvoiceInPeriod(i) &&
              i.status !== '作廢' // Exclude Voided
          )
          .reduce((sum, i) => sum + i.salesAmount, 0)
  );

  // NEW: Total Input + Offset Amount (Sum of Input + Cross Period)
  totalInputPlusOffsetAmount = computed(() => 
      this.totalPurchaseAmount() + this.totalCrossPeriodOffsetAmount()
  );

  // NEW: Total Input + Offset Tax
  totalInputPlusOffsetTax = computed(() => 
      this.totalInputTax() + this.totalCrossPeriodOffsetTax()
  );

  // New: Sales - Purchase Gap (Net Amount)
  // Updated Logic: GAP = Output (Sales) - Input (Purchase + Offset)
  salesGap = computed(() => this.totalSalesAmount() - this.totalInputPlusOffsetAmount());

  vatPayable = computed(() => this.totalOutputTax() - this.totalInputTax());

  // Main List Filter
  filteredInvoices = computed(() => {
      const term = this.searchTerm().toLowerCase();
      const statusFilter = this.selectedStatusFilter();
      const retention = this.selectedRetentionFilter();
      const copyRep = this.selectedCopyReportedFilter();
      const costCat = this.selectedCostCategoryFilter();
      const crossPeriod = this.selectedCrossPeriodFilter();
      const formatFilter = this.selectedFormatFilter();
      
      const sortCol = this.sortColumn();
      const sortDir = this.sortDirection();

      return this.invoices()
          .filter(i => {
              // Basic Filters
              const matchBasic = i.type === this.activeTab() && 
                                 (!i.ownerCompanyId || i.ownerCompanyId === this.selectedCompanyId()) &&
                                 this.isInvoiceInPeriod(i);
              
              if (!matchBasic) return false;

              // Search Filter
              if (term) {
                  const matchSearch = i.invoiceNumber.toLowerCase().includes(term) ||
                                      (i.companyName && i.companyName.toLowerCase().includes(term)) ||
                                      (i.taxId && i.taxId.includes(term)) ||
                                      (i.note && i.note.toLowerCase().includes(term));
                  if (!matchSearch) return false;
              }

              // Status Filter
              if (statusFilter !== 'all' && i.status !== statusFilter) return false;

              // Retention Filter
              if (retention === 'true' && !i.isRetention) return false;
              if (retention === 'false' && i.isRetention) return false;

              // Copy Reported Filter
              if (copyRep === 'true' && !i.isCopyReported) return false;
              if (copyRep === 'false' && i.isCopyReported) return false;

              // Cost Category Filter
              if (costCat && i.costCategory !== costCat) return false;

              // Cross Period Filter
              if (crossPeriod === 'true' && !i.isCrossPeriod) return false;
              if (crossPeriod === 'false' && i.isCrossPeriod) return false;

              // Format Filter
              if (formatFilter !== 'all' && i.formatCode !== formatFilter) return false;

              return true;
          })
          .sort((a, b) => {
              const dir = sortDir === 'asc' ? 1 : -1;
              let valA: any = a[sortCol as keyof Invoice];
              let valB: any = b[sortCol as keyof Invoice];

              if (sortCol === 'date' || sortCol === 'createdDate') {
                  valA = new Date(valA).getTime();
                  valB = new Date(valB).getTime();
              } else if (typeof valA === 'string') {
                  valA = valA.toLowerCase();
                  valB = valB.toLowerCase();
              }

              if (valA < valB) return -1 * dir;
              if (valA > valB) return 1 * dir;
              return 0;
          });
  });

  taxAuditResults = computed(() => {
      const allInvoices = this.invoices();
      const results: { invoice: Invoice, expectedTax: number, diff: number }[] = [];
      
      allInvoices.forEach(inv => {
          if (inv.status === '作廢') return;
          
          // Only audit taxable formats (e.g. 21, 22, 25, 31, 32, 35)
          // Simplified check: if taxAmount > 0 or salesAmount > 0
          if (inv.salesAmount > 0) {
              const expectedTax = Math.round(inv.salesAmount * 0.05);
              const diff = Math.abs(inv.taxAmount - expectedTax);
              
              // Allow 1-2 unit difference for rounding
              if (diff > 2) {
                  results.push({ invoice: inv, expectedTax, diff });
              }
          }
      });
      
      return results;
  });

  // 401 Report Data
  report401Data = computed(() => {
      const companyId = this.selectedCompanyId();
      const year = this.selectedYear();
      const periodId = this.selectedPeriod();
      
      const invoices = this.invoices().filter(inv => {
          if (inv.ownerCompanyId && inv.ownerCompanyId !== companyId) return false;
          if (inv.status === '作廢') return false;
          if (!inv.date) return false;
          const d = new Date(inv.date);
          return d.getFullYear() === year && Math.ceil((d.getMonth() + 1) / 2) === periodId;
      });

      const output = invoices.filter(i => i.type === 'Output');
      const input = invoices.filter(i => i.type === 'Input');

      // Simplified 401 Boxes
      const taxableSales = output.reduce((sum, i) => sum + i.salesAmount, 0);
      const outputTax = output.reduce((sum, i) => sum + i.taxAmount, 0);
      
      const taxablePurchases = input.reduce((sum, i) => sum + i.salesAmount, 0);
      const inputTax = input.reduce((sum, i) => sum + i.taxAmount, 0);
      
      const lastRetention = this.totalLastPeriodRetainedTax();
      const vatPayable = Math.max(0, outputTax - inputTax - lastRetention);
      const currentRetention = Math.max(0, inputTax + lastRetention - outputTax);

      return {
          taxableSales,
          outputTax,
          taxablePurchases,
          inputTax,
          lastRetention,
          vatPayable,
          currentRetention,
          company: this.companies().find(c => c.id === companyId)
      };
  });

  constructor() {
      this.initForm();
      
      // Auto-select first company if none selected
      effect(() => {
          const comps = this.companies();
          if (comps.length > 0 && !this.selectedCompanyId()) {
              this.selectedCompanyId.set(comps[0].id);
          }
      });
  }

  initForm() {
      const today = new Date().toISOString().split('T')[0];
      this.invoiceForm = this.fb.group({
          date: [today, Validators.required],
          formatCode: ['21', Validators.required],
          invoiceNumber: ['', [Validators.required, Validators.pattern(/^[A-Z]{2}[-]?\d{8}$/)]],
          taxId: [''],
          companyName: [''],
          salesAmount: [0, Validators.required],
          taxAmount: [0, Validators.required],
          totalAmount: [0], // calculated
          note: [''],
          linkedOrderId: [''],
          isRetention: [false], // Default False
          isCopyReported: [false], // Default False
          isCrossPeriod: [false], // Added: Cross Period Default False
          costCategory: [''], // Added: Cost Category
          status: ['成立', Validators.required] // Added: Invoice Status
      });

      // Auto-Format Invoice Number (XX-YYYYYYYY)
      this.invoiceForm.get('invoiceNumber')?.valueChanges.subscribe(val => {
          if (!val) return;
          // 1. Convert to Upper, remove non-alphanumeric
          let clean = val.toUpperCase().replace(/[^A-Z0-9]/g, '');
          
          // 2. Insert Hyphen after 2 chars
          if (clean.length > 2) {
              clean = clean.substring(0, 2) + '-' + clean.substring(2);
          }
          
          // 3. Limit length to 11 (2 letters + 1 dash + 8 digits)
          if (clean.length > 11) {
              clean = clean.substring(0, 11);
          }

          // 4. Update control if different
          if (val !== clean) {
              this.invoiceForm.get('invoiceNumber')?.setValue(clean, { emitEvent: false });
          }
      });

      // Auto-calc tax logic
      this.invoiceForm.get('salesAmount')?.valueChanges.subscribe(val => {
          const sales = Number(val) || 0;
          const tax = Math.round(sales * 0.05);
          const total = sales + tax;
          this.invoiceForm.patchValue({ 
              taxAmount: tax,
              totalAmount: total 
          }, { emitEvent: false });
      });

      this.invoiceForm.get('taxAmount')?.valueChanges.subscribe(val => {
          const tax = Number(val) || 0;
          const sales = Number(this.invoiceForm.get('salesAmount')?.value) || 0;
          const total = sales + tax;
          this.invoiceForm.patchValue({ 
              totalAmount: total 
          }, { emitEvent: false });
      });

      this.invoiceForm.get('totalAmount')?.valueChanges.subscribe(val => {
          const total = Number(val) || 0;
          const sales = Math.round(total / 1.05);
          const tax = total - sales;
          this.invoiceForm.patchValue({ 
              salesAmount: sales,
              taxAmount: tax
          }, { emitEvent: false });
      });

      this.invoiceForm.get('taxAmount')?.valueChanges.subscribe(val => {
          const tax = Number(val) || 0;
          const sales = Number(this.invoiceForm.get('salesAmount')?.value) || 0;
          const total = sales + tax;
          this.invoiceForm.patchValue({ 
              totalAmount: total 
          }, { emitEvent: false });
      });

      this.invoiceForm.get('totalAmount')?.valueChanges.subscribe(val => {
          const total = Number(val) || 0;
          const sales = Math.round(total / 1.05);
          const tax = total - sales;
          this.invoiceForm.patchValue({ 
              salesAmount: sales,
              taxAmount: tax
          }, { emitEvent: false });
      });

      // Auto-fill from Linked Order (or Supplier)
      this.invoiceForm.get('linkedOrderId')?.valueChanges.subscribe(id => {
          if (!id) return;
          
          if (this.activeTab() === 'Input') {
              // Find Supplier by Code
              const supplier = this.suppliers().find(s => s.code === id);
              if (supplier) {
                  this.invoiceForm.patchValue({
                      companyName: supplier.fullName, // Changed: shortName -> fullName for better formal records
                      taxId: supplier.taxId
                  });
              }
          } else {
              // Find Order
              const ord = this.activeOrders().find(o => o.orderId.startsWith(id));
              if (ord) {
                  // Sum totals for this group
                  const groupTotal = this.orders()
                      .filter(o => o.orderId.startsWith(id))
                      .reduce((sum, o) => sum + o.totalAmount, 0);
                  
                  const salesAmt = Math.round(groupTotal / 1.05);
                  const taxAmt = groupTotal - salesAmt;
                  
                  this.invoiceForm.patchValue({
                      companyName: ord.customerName,
                      salesAmount: salesAmt,
                      taxAmount: taxAmt,
                      totalAmount: groupTotal,
                      note: `訂單: ${id}`
                  });
                  
                  // Find tax ID
                  const customer = this.dataService.customers().find(c => c.id === ord.customerId);
                  if (customer) {
                      this.invoiceForm.patchValue({ taxId: customer.taxId });
                  }
              }
          }
      });
      
      // Auto-fill Company Name from Tax ID
      this.invoiceForm.get('taxId')?.valueChanges.subscribe(val => {
          const taxId = val?.trim();
          if (!taxId || taxId.length < 8) return; 

          // Check distinct logic for Input vs Output
          if (this.activeTab() === 'Input') {
              const supplier = this.suppliers().find(s => s.taxId === taxId);
              if (supplier) {
                   // Changed: shortName -> fullName
                   this.invoiceForm.patchValue({ companyName: supplier.fullName }, { emitEvent: false });
              }
          } else {
              const customer = this.dataService.customers().find(c => c.taxId === taxId);
              if (customer) {
                   this.invoiceForm.patchValue({ companyName: customer.shortName }, { emitEvent: false });
              }
          }
      });
  }

  setActiveTab(tab: InvoiceType) {
      this.activeTab.set(tab);
      this.cancelEdit(); // Reset form when switching tabs
      this.selectedInvoiceIds.set(new Set()); // Clear selection
      this.invoiceForm.patchValue({ 
          formatCode: tab === 'Input' ? '21' : '31',
          linkedOrderId: ''
      });
  }
  
  setSelectedCompany(id: string) {
      this.selectedCompanyId.set(id);
      this.cancelEdit();
      this.selectedInvoiceIds.set(new Set()); // Clear selection
  }

  // --- Filter Changes ---
  onSearchTermChange(event: Event) {
      this.searchTerm.set((event.target as HTMLInputElement).value);
  }

  onStatusFilterChange(event: Event) {
      this.selectedStatusFilter.set((event.target as HTMLSelectElement).value);
  }

  onRetentionFilterChange(event: Event) {
      this.selectedRetentionFilter.set((event.target as HTMLSelectElement).value);
  }

  onCopyReportedFilterChange(event: Event) {
      this.selectedCopyReportedFilter.set((event.target as HTMLSelectElement).value);
  }

  onCostCategoryFilterChange(event: Event) {
      this.selectedCostCategoryFilter.set((event.target as HTMLSelectElement).value);
  }

  onCrossPeriodFilterChange(event: Event) {
      this.selectedCrossPeriodFilter.set((event.target as HTMLSelectElement).value);
  }

  onFormatFilterChange(event: Event) {
      this.selectedFormatFilter.set((event.target as HTMLSelectElement).value);
  }

  // --- Sorting ---
  toggleSort(col: string) {
      if (this.sortColumn() === col) {
          this.sortDirection.update(d => d === 'asc' ? 'desc' : 'asc');
      } else {
          this.sortColumn.set(col);
          this.sortDirection.set('desc'); // Default to desc for new column
      }
  }

  getSortIcon(col: string): string {
      if (this.sortColumn() !== col) return '';
      return this.sortDirection() === 'asc' ? '↑' : '↓';
  }

  // --- Period Controls ---
  setYear(delta: number) {
      this.selectedYear.update(y => y + delta);
      this.selectedInvoiceIds.set(new Set()); // Clear selection
  }

  setPeriod(p: number) {
      this.selectedPeriod.set(p);
      this.selectedInvoiceIds.set(new Set()); // Clear selection
  }

  // New Methods for Previous/Next Period
  prevPeriod() {
      let p = this.selectedPeriod();
      let y = this.selectedYear();
      
      p--;
      if (p < 1) {
          p = 6;
          y--;
      }
      this.selectedPeriod.set(p);
      this.selectedYear.set(y);
      this.selectedInvoiceIds.set(new Set()); // Clear selection
  }

  nextPeriod() {
      let p = this.selectedPeriod();
      let y = this.selectedYear();
      
      p++;
      if (p > 6) {
          p = 1;
          y++;
      }
      this.selectedPeriod.set(p);
      this.selectedYear.set(y);
      this.selectedInvoiceIds.set(new Set()); // Clear selection
  }

  // --- Duplicate Removal Logic ---
  
  // Calculate completeness score to keep the best record
  private calculateCompletenessScore(inv: Invoice): number {
      let score = 0;
      if (inv.taxId) score += 2; 
      if (inv.companyName) score += 2;
      if (inv.linkedOrderId) score += 3; // High value for linked orders
      if (inv.note && inv.note !== 'Excel 匯入') score += 1;
      if (inv.costCategory) score += 1;
      if (inv.totalAmount > 0) score += 1;
      if (inv.status === '成立') score += 1;
      return score;
  }

  removeDuplicates() {
      const targetInvoices = this.invoices().filter(i => 
          i.type === this.activeTab() && 
          (!i.ownerCompanyId || i.ownerCompanyId === this.selectedCompanyId()) &&
          this.isInvoiceInPeriod(i)
      );

      if (targetInvoices.length === 0) {
          alert('目前列表無資料。');
          return;
      }

      // Group by invoice number
      const groups: Record<string, Invoice[]> = {};
      targetInvoices.forEach(inv => {
          const key = inv.invoiceNumber.replace(/-/g, '').toUpperCase();
          if (!groups[key]) groups[key] = [];
          groups[key].push(inv);
      });

      const toDeleteIds: string[] = [];
      let duplicateGroupsCount = 0;

      for (const key in groups) {
          const group = groups[key];
          if (group.length > 1) {
              duplicateGroupsCount++;
              group.sort((a, b) => {
                  const scoreA = this.calculateCompletenessScore(a);
                  const scoreB = this.calculateCompletenessScore(b);
                  if (scoreA !== scoreB) return scoreB - scoreA;
                  
                  const timeA = new Date(a.createdDate).getTime();
                  const timeB = new Date(b.createdDate).getTime();
                  return timeB - timeA;
              });

              for (let i = 1; i < group.length; i++) {
                  toDeleteIds.push(group[i].id);
              }
          }
      }

      if (toDeleteIds.length === 0) {
          alert('未發現重複的發票號碼。');
          return;
      }

      if (confirm(`掃描完成！發現 ${duplicateGroupsCount} 組重複發票號碼。\n即將保留資料最完整的一筆，並刪除其餘 ${toDeleteIds.length} 筆重複資料。\n是否執行？`)) {
          toDeleteIds.forEach(id => this.dataService.deleteInvoice(id));
          alert(`已成功清除 ${toDeleteIds.length} 筆重複資料。`);
      }
  }

  // --- Excel Export & Import ---

  exportCurrentView() {
      const companyId = this.selectedCompanyId();
      if (!companyId) {
          alert('請先選擇公司主體');
          return;
      }
      
      const company = this.companies().find(c => c.id === companyId);
      if (!company) return;

      const type = this.activeTab(); // 'Input' | 'Output'
      const typeName = type === 'Input' ? '進項' : '銷項';
      const year = this.selectedYear();
      const period = this.periods.find(p => p.id === this.selectedPeriod());
      const periodStr = period ? `${period.label}(${period.sub})` : `${this.selectedPeriod()}期`;

      const data = this.filteredInvoices().map(inv => {
          const row: any = {
              '日期': inv.date,
              '發票號碼': inv.invoiceNumber,
              '狀態': inv.status,
              '格式': this.formatMap[inv.formatCode] || inv.formatCode,
              [type === 'Input' ? '廠商名稱' : '客戶全名']: inv.companyName,
              '統編': inv.taxId,
              '費用類別': inv.costCategory || '',
              '銷售額': inv.salesAmount,
              '稅額': inv.taxAmount,
              '總計': inv.totalAmount,
              '備註': inv.note
          };
          
          if (type === 'Input') {
              row['留抵'] = inv.isRetention ? 'Y' : '';
              row['副本'] = inv.isCopyReported ? 'Y' : '';
              row['跨期'] = inv.isCrossPeriod ? 'Y' : '';
          }
          
          return row;
      });

      if (data.length === 0) {
          alert('目前無資料可匯出');
          return;
      }

      const ws = utils.json_to_sheet(data);
      
      const wscols = [
          { wch: 12 }, // Date
          { wch: 15 }, // Inv No
          { wch: 8 },  // Status
          { wch: 10 }, // Format
          { wch: 25 }, // Name
          { wch: 12 }, // TaxId
          { wch: 12 }, // Category
          { wch: 12 }, // Sales
          { wch: 10 }, // Tax
          { wch: 12 }, // Total
          { wch: 30 }, // Note
      ];
      if (type === 'Input') {
          wscols.push({ wch: 5 }, { wch: 5 }, { wch: 5 });
      }
      ws['!cols'] = wscols;

      const wb = utils.book_new();
      utils.book_append_sheet(wb, ws, `${typeName}發票`);
      
      const fileName = `${company.name}_${company.taxId}_${year}年_${periodStr}_${typeName}發票.xlsx`;
      
      writeFile(wb, fileName);
  }

  downloadTemplate() {
      const type = this.activeTab();
      const isInput = type === 'Input';
      const label = isInput ? '進項' : '銷項';
      const partyName = isInput ? '賣方名稱' : '買方名稱';
      const partyTax = isInput ? '賣方統一編號' : '買方統一編號';

      const headers = ['發票日期', '發票號碼', '格式代號', '發票狀態', partyTax, partyName, '應稅銷售額', '營業稅', '總計', '總備註'];
      const data = [headers];
      const wb = utils.book_new();
      const ws = utils.aoa_to_sheet(data);
      
      ws['!cols'] = [
          { wch: 15 }, { wch: 15 }, { wch: 10 }, { wch: 12 }, { wch: 12 }, { wch: 25 }, { wch: 12 }, { wch: 10 }, { wch: 12 }, { wch: 30 }
      ];

      utils.book_append_sheet(wb, ws, `${label}發票匯入範本`);
      writeFile(wb, `${label}發票匯入範本_${this.selectedYear()}.xlsx`);
  }

  onFileSelected(event: Event) {
      const input = event.target as HTMLInputElement;
      if (!input.files?.length) return;
      const file = input.files[0];
      
      if (!this.selectedCompanyId()) {
          alert('請先選擇公司主體。');
          input.value = '';
          return;
      }

      this.isImporting.set(true);
      const reader = new FileReader();
      
      reader.onload = (e) => {
          try {
              const data = e.target?.result;
              const workbook = read(data, { type: 'array' });
              const firstSheetName = workbook.SheetNames[0];
              const worksheet = workbook.Sheets[firstSheetName];
              
              const jsonData = utils.sheet_to_json(worksheet);
              
              const headers = jsonData.length > 0 ? Object.keys(jsonData[0] as object) : [];
              
              if (headers.length === 0) {
                  alert('檔案內容為空或無法讀取標題。');
                  this.isImporting.set(false);
                  return;
              }

              this.importFileHeaders.set(headers);
              this.importFileData.set(jsonData);
              
              this.guessMappings(headers);
              
              this.showImportModal.set(true);
              
          } catch (err: any) {
              console.error('Import Error:', err);
              alert('讀取檔案失敗：' + err.message);
          } finally {
              this.isImporting.set(false);
              input.value = '';
          }
      };
      
      reader.readAsArrayBuffer(file);
  }

  private getSavedMappings(): Record<string, string> {
      try {
          const saved = localStorage.getItem('erp_finance_import_map');
          return saved ? JSON.parse(saved) : {};
      } catch { return {}; }
  }

  private saveMappings() {
      localStorage.setItem('erp_finance_import_map', JSON.stringify(this.columnMappings()));
  }

  guessMappings(headers: string[]) {
      const mapping: Record<string, string> = {};
      const saved = this.getSavedMappings();

      this.systemImportFields.forEach(field => {
          let match = '';

          if (saved[field.key] && headers.includes(saved[field.key])) {
              match = saved[field.key];
          }

          if (!match) {
              const definedAliases = this.PREDEFINED_MAPPINGS[field.key] || [];
              const exactMatch = headers.find(h => definedAliases.includes(h.trim()));
              
              if (exactMatch) {
                  match = exactMatch;
              } else {
                  match = headers.find(h => 
                      h.includes(field.label.split(' ')[0]) || 
                      h.toLowerCase().includes(field.key.toLowerCase()) || 
                      (field.key === 'salesAmount' && (h.includes('未稅') || h.includes('銷售'))) ||
                      (field.key === 'totalAmount' && (h.includes('總計') || h.includes('含稅')))
                  ) || '';
              }
          }
          
          if (match) {
              mapping[field.key] = match;
          } else {
              mapping[field.key] = '';
          }
      });
      
      this.columnMappings.set(mapping);
  }

  updateMapping(systemKey: string, fileHeader: string) {
      this.columnMappings.update(map => ({ ...map, [systemKey]: fileHeader }));
  }

  closeImportModal() {
      this.showImportModal.set(false);
      this.importFileHeaders.set([]);
      this.importFileData.set([]);
  }

  executeImport() {
      this.saveMappings();

      const data = this.importFileData();
      const map = this.columnMappings();
      const companyId = this.selectedCompanyId();
      
      let successCount = 0;
      let skippedCount = 0;
      const duplicatesInDb: string[] = [];
      const existing = this.invoices();
      const type = this.activeTab();

      data.forEach((row: any) => {
          const invNoKey = map['invoiceNumber'];
          const dateKey = map['date'];

          // Only skip if essential keys are missing in MAPPING, not necessarily if value is empty in row (though value check is good)
          if (!invNoKey || !dateKey) return; 
          
          const invNo = row[invNoKey];
          if (!invNo) return;

          // Check duplicate in DB within the same type
          const exists = existing.some(i => i.invoiceNumber === String(invNo) && i.type === type);
          if (exists) {
              duplicatesInDb.push(String(invNo));
              skippedCount++;
              return;
          }

          const salesKey = map['salesAmount'];
          const taxKey = map['taxAmount'];
          const totalKey = map['totalAmount'];

          let totalAmt = totalKey ? (Number(row[totalKey]) || 0) : 0;
          let salesAmt = salesKey ? (Number(row[salesKey]) || 0) : 0;
          let taxAmt = taxKey ? (Number(row[taxKey]) || 0) : 0;

          // Smart Calc Logic:
          // 1. If Sales is missing but Total is present -> Back calculate
          if (salesAmt === 0 && totalAmt > 0) {
              salesAmt = Math.round(totalAmt / 1.05);
              if (taxAmt === 0) taxAmt = totalAmt - salesAmt;
          }
          
          // 2. If Tax is missing but Sales is present -> Calculate 5%
          if (taxAmt === 0 && salesAmt > 0 && !taxKey) {
               taxAmt = Math.round(salesAmt * 0.05);
          }

          // 3. Final Total consistency
          if (totalAmt === 0) {
              totalAmt = salesAmt + taxAmt;
          }

          let statusVal = '成立';
          if (map['status'] && row[map['status']]) {
              const s = row[map['status']];
              if (s === '作廢' || s === 'Void' || s === 'Invalid') statusVal = '作廢';
          }

          let fmt = type === 'Output' ? '電子' : '21';
          if (map['formatCode'] && row[map['formatCode']]) {
              fmt = String(row[map['formatCode']]);
          }

          const newInvoice: Invoice = {
              id: `INV-${Date.now()}-${Math.floor(Math.random()*1000)}`,
              type: type,
              ownerCompanyId: companyId,
              invoiceNumber: String(invNo),
              date: this.parseExcelDate(row[dateKey]),
              salesAmount: salesAmt,
              taxAmount: taxAmt,
              totalAmount: totalAmt,
              // Strictly map string values from Excel
              companyName: map['companyName'] ? (row[map['companyName']] || '') : '',
              taxId: map['taxId'] ? (String(row[map['taxId']]) || '') : '',
              note: map['note'] ? (row[map['note']] || 'Excel 匯入') : 'Excel 匯入',
              formatCode: fmt,
              createdDate: new Date().toISOString(),
              status: statusVal as '成立' | '作廢',
              // No linked order logic
              linkedOrderId: '',
              isRetention: false,
              isCopyReported: false,
              isCrossPeriod: false
          };

          this.dataService.addInvoice(newInvoice);
          successCount++;
      });

      let msg = `匯入完成！成功: ${successCount} 筆。`;
      if (skippedCount > 0) {
          msg += `\n跳過重複: ${skippedCount} 筆`;
      }
      alert(msg);
      this.closeImportModal();
  }

  private parseExcelDate(val: any): string {
      if (!val) return new Date().toISOString().split('T')[0];
      if (val instanceof Date) return val.toISOString().split('T')[0];
      if (typeof val === 'number') {
          const date = new Date((val - 25569) * 86400 * 1000);
          return date.toISOString().split('T')[0];
      }
      const str = String(val).trim();
      if (/^\d{8}$/.test(str)) {
          return `${str.substring(0,4)}-${str.substring(4,6)}-${str.substring(6,8)}`;
      }
      return str.replace(/\//g, '-');
  }

  // --- Invoice CRUD ---

  submitInvoice() {
      if (this.invoiceForm.valid) {
          const formValue = this.invoiceForm.getRawValue();
          
          if (this.editingInvoiceId()) {
              const original = this.invoices().find(i => i.id === this.editingInvoiceId());
              if (original) {
                  const updated: Invoice = {
                      ...original,
                      ...formValue,
                      type: this.activeTab(), // Ensure type doesn't change
                      ownerCompanyId: this.selectedCompanyId()
                  };
                  this.dataService.updateInvoice(updated);
                  this.cancelEdit();
              }
          } else {
              const newInvoice: Invoice = {
                  id: `INV-${Date.now()}`,
                  type: this.activeTab(),
                  ownerCompanyId: this.selectedCompanyId(),
                  createdDate: new Date().toISOString(),
                  ...formValue
              };
              
              // Check duplicate Invoice Number for this type
              const exists = this.invoices().some(i => i.invoiceNumber === newInvoice.invoiceNumber && i.type === newInvoice.type);
              if (exists) {
                  alert('發票號碼已存在！');
                  return;
              }

              this.dataService.addInvoice(newInvoice);
              // Reset form but keep date/format convenient
              this.invoiceForm.reset({
                  date: formValue.date,
                  formatCode: formValue.formatCode,
                  salesAmount: 0,
                  taxAmount: 0,
                  totalAmount: 0,
                  status: '成立',
                  isRetention: false,
                  isCopyReported: false,
                  isCrossPeriod: false
              });
          }
      }
  }

  editInvoice(inv: Invoice) {
      this.editingInvoiceId.set(inv.id);
      this.invoiceForm.patchValue(inv);
  }

  cancelEdit() {
      this.editingInvoiceId.set(null);
      const today = new Date().toISOString().split('T')[0];
      this.invoiceForm.reset({
          date: today,
          formatCode: this.activeTab() === 'Input' ? '21' : '31',
          salesAmount: 0,
          taxAmount: 0,
          totalAmount: 0,
          status: '成立',
          isRetention: false,
          isCopyReported: false,
          isCrossPeriod: false
      });
  }
  
  openDeleteConfirm(inv: Invoice) {
      this.invoiceToDelete.set(inv);
  }

  performDelete() {
      const inv = this.invoiceToDelete();
      if (inv) {
          this.dataService.deleteInvoice(inv.id);
          if (this.editingInvoiceId() === inv.id) {
              this.cancelEdit();
          }
          this.invoiceToDelete.set(null);
      }
  }

  cancelDelete() {
      this.invoiceToDelete.set(null);
  }

  toggleFullScreen() {
      this.isFullScreen.update(v => !v);
  }

  // --- Selection Logic ---
  toggleSelect(id: string) {
      this.selectedInvoiceIds.update(prev => {
          const next = new Set(prev);
          if (next.has(id)) {
              next.delete(id);
          } else {
              next.add(id);
          }
          return next;
      });
  }

  toggleSelectAll() {
      const filtered = this.filteredInvoices();
      const allSelected = this.isAllSelected();
      
      this.selectedInvoiceIds.update(prev => {
          const next = new Set(prev);
          if (allSelected) {
              // Deselect all filtered
              filtered.forEach(inv => next.delete(inv.id));
          } else {
              // Select all filtered
              filtered.forEach(inv => next.add(inv.id));
          }
          return next;
      });
  }

  deleteSelectedInvoices() {
      const selectedIds = Array.from(this.selectedInvoiceIds());
      const filteredSelectedIds = selectedIds.filter(id => 
          this.filteredInvoices().some(inv => inv.id === id)
      );

      if (filteredSelectedIds.length === 0) {
          alert('請先選取要刪除的發票。');
          return;
      }

      if (confirm(`確定要刪除選取的 ${filteredSelectedIds.length} 筆發票嗎？此動作無法復原。`)) {
          filteredSelectedIds.forEach(id => {
              this.dataService.deleteInvoice(id);
              if (this.editingInvoiceId() === id) {
                  this.cancelEdit();
              }
          });
          
          // Clear selection after delete
          this.selectedInvoiceIds.update(prev => {
              const next = new Set(prev);
              filteredSelectedIds.forEach(id => next.delete(id));
              return next;
          });
          
          alert(`已成功刪除 ${filteredSelectedIds.length} 筆發票。`);
      }
  }

  // --- Global Duplicate Check ---
  checkGlobalDuplicates() {
      const allInvoices = this.invoices();
      const groups: Record<string, Invoice[]> = {};

      allInvoices.forEach(inv => {
          // Normalize invoice number (uppercase, remove dashes)
          const key = inv.invoiceNumber.replace(/-/g, '').toUpperCase();
          if (!groups[key]) groups[key] = [];
          groups[key].push(inv);
      });

      const results = Object.keys(groups)
          .filter(key => groups[key].length > 1)
          .map(key => ({
              invoiceNumber: key,
              invoices: groups[key]
          }));

      this.globalDuplicateResults.set(results);
      this.showGlobalDuplicateModal.set(true);
  }

  closeGlobalDuplicateModal() {
      this.showGlobalDuplicateModal.set(false);
      this.globalDuplicateResults.set([]);
  }

  // --- Global Search ---
  openGlobalSearch(type: 'invoiceNumber' | 'totalAmount') {
      this.globalSearchType.set(type);
      this.globalSearchQuery.set('');
      this.globalSearchResults.set([]);
      this.showGlobalSearchModal.set(true);
  }

  performGlobalSearch() {
      const query = this.globalSearchQuery().trim();
      if (!query) return;

      const type = this.globalSearchType();
      const allInvoices = this.invoices();
      let results: Invoice[] = [];

      if (type === 'invoiceNumber') {
          const normalizedQuery = query.replace(/-/g, '').toUpperCase();
          results = allInvoices.filter(inv => 
              inv.invoiceNumber.replace(/-/g, '').toUpperCase().includes(normalizedQuery)
          );
      } else if (type === 'totalAmount') {
          const amountQuery = parseFloat(query);
          if (!isNaN(amountQuery)) {
              results = allInvoices.filter(inv => inv.totalAmount === amountQuery);
          }
      }

      this.globalSearchResults.set(results);
  }

  closeGlobalSearchModal() {
      this.showGlobalSearchModal.set(false);
      this.globalSearchResults.set([]);
  }

  // --- Batch Download ---
  openBatchDownload() {
      this.showBatchDownloadModal.set(true);
      // Default select current company and period
      this.batchSelectedCompanyIds.set(new Set([this.selectedCompanyId()]));
      this.batchSelectedPeriods.set(new Set([this.selectedPeriod()]));
      this.batchSelectedYear.set(this.selectedYear());
  }

  closeBatchDownloadModal() {
      this.showBatchDownloadModal.set(false);
  }

  toggleBatchCompany(id: string) {
      this.batchSelectedCompanyIds.update(prev => {
          const next = new Set(prev);
          if (next.has(id)) next.delete(id);
          else next.add(id);
          return next;
      });
  }

  toggleBatchPeriod(p: number) {
      this.batchSelectedPeriods.update(prev => {
          const next = new Set(prev);
          if (next.has(p)) next.delete(p);
          else next.add(p);
          return next;
      });
  }

  setBatchYear(delta: number) {
      this.batchSelectedYear.update(y => y + delta);
  }

  async performBatchDownload() {
      const zip = new JSZip();
      const companies = this.companies().filter(c => this.batchSelectedCompanyIds().has(c.id));
      const periods = this.periods.filter(p => this.batchSelectedPeriods().has(p.id));
      const year = this.batchSelectedYear();

      if (companies.length === 0 || periods.length === 0) {
          alert('請至少選擇一家公司與一個期別');
          return;
      }

      let fileCount = 0;

      for (const company of companies) {
          for (const period of periods) {
              // Generate Input Excel
              const inputData = this.getInvoiceDataForExport(company.id, 'Input', year, period.id);
              if (inputData.length > 0) {
                  const ws = utils.json_to_sheet(inputData);
                  const wb = utils.book_new();
                  utils.book_append_sheet(wb, ws, '進項發票');
                  const buf = write(wb, { type: 'array', bookType: 'xlsx' });
                  zip.file(`${company.name}_${year}年_${period.label}_進項發票.xlsx`, buf);
                  fileCount++;
              }

              // Generate Output Excel
              const outputData = this.getInvoiceDataForExport(company.id, 'Output', year, period.id);
              if (outputData.length > 0) {
                  const ws = utils.json_to_sheet(outputData);
                  const wb = utils.book_new();
                  utils.book_append_sheet(wb, ws, '銷項發票');
                  const buf = write(wb, { type: 'array', bookType: 'xlsx' });
                  zip.file(`${company.name}_${year}年_${period.label}_銷項發票.xlsx`, buf);
                  fileCount++;
              }
          }
      }

      if (fileCount === 0) {
          alert('所選範圍內無發票資料。');
          return;
      }

      const content = await zip.generateAsync({ type: 'blob' });
      const url = window.URL.createObjectURL(content);
      const a = document.createElement('a');
      a.href = url;
      a.download = `財務報表批次下載_${year}.zip`;
      a.click();
      window.URL.revokeObjectURL(url);
      this.showBatchDownloadModal.set(false);
  }

  private getInvoiceDataForExport(companyId: string, type: InvoiceType, year: number, periodId: number): any[] {
      return this.invoices().filter(inv => {
          if (inv.type !== type) return false;
          if (inv.ownerCompanyId && inv.ownerCompanyId !== companyId) return false;
          if (!inv.date) return false;
          const d = new Date(inv.date);
          const iYear = d.getFullYear();
          const iMonth = d.getMonth() + 1;
          const iPeriod = Math.ceil(iMonth / 2);
          return iYear === year && iPeriod === periodId;
      }).map(inv => ({
          '日期': inv.date,
          '發票號碼': inv.invoiceNumber,
          '狀態': inv.status,
          '格式': this.formatMap[inv.formatCode] || inv.formatCode,
          [type === 'Input' ? '廠商名稱' : '客戶全名']: inv.companyName,
          '統一編號': inv.taxId,
          '銷售額(未稅)': inv.salesAmount,
          '稅額': inv.taxAmount,
          '總計(含稅)': inv.totalAmount,
          '費用類別': inv.costCategory || '',
          '備註': inv.note || ''
      }));
  }

  // --- AI Financial Insights ---
  async generateAiInsights() {
      this.isAnalyzing.set(true);
      this.showAiInsightModal.set(true);
      this.aiInsightContent.set('正在分析財務數據，請稍候...');

      const data = this.report401Data();
      const period = this.periods.find(p => p.id === this.selectedPeriod());
      
      const prompt = `
          請以專業財務顧問的身份，分析以下公司的 401 營業稅數據並提供建議：
          公司：${data.company?.name}
          期間：${this.selectedYear()} 年 ${period?.label} (${period?.sub})
          
          數據摘要：
          - 銷項總額：${data.taxableSales} (稅額：${data.outputTax})
          - 進項總額：${data.taxablePurchases} (稅額：${data.inputTax})
          - 上期留抵：${data.lastRetention}
          - 預估應納稅額：${data.vatPayable}
          - 預估留抵稅額：${data.currentRetention}
          
          請針對以下面向提供簡短精確的建議（繁體中文）：
          1. 稅務負擔評估
          2. 進銷項平衡建議
          3. 潛在風險或異常提醒
      `;

      try {
          const response = await this.aiService.sendMessage(prompt);
          this.aiInsightContent.set(response);
      } catch (error) {
          this.aiInsightContent.set('分析失敗，請稍後再試。');
      } finally {
          this.isAnalyzing.set(false);
      }
  }

  closeAiInsightModal() {
      this.showAiInsightModal.set(false);
      this.aiInsightContent.set('');
  }

  // --- 401 Report Preview ---
  openReportPreview() {
      this.showReportPreviewModal.set(true);
  }

  closeReportPreview() {
      this.showReportPreviewModal.set(false);
  }

  // --- Tax Audit ---
  openTaxAudit() {
      this.showTaxAuditModal.set(true);
  }

  closeTaxAudit() {
      this.showTaxAuditModal.set(false);
  }

  goToInvoice(inv: Invoice) {
      // 1. Set Company
      if (inv.ownerCompanyId) {
          this.selectedCompanyId.set(inv.ownerCompanyId);
      }
      
      // 2. Set Tab
      this.activeTab.set(inv.type);
      
      // 3. Set Year & Period
      if (inv.date) {
          const d = new Date(inv.date);
          this.selectedYear.set(d.getFullYear());
          this.selectedPeriod.set(Math.ceil((d.getMonth() + 1) / 2));
      }
      
      // 4. Set Search Term to highlight
      this.searchTerm.set(inv.invoiceNumber);
      
      // 5. Close Modals
      this.closeGlobalSearchModal();
      this.closeGlobalDuplicateModal();
  }

  getCompanyNameById(companyId?: string): string {
      if (!companyId) return '未指定公司';
      const company = this.companies().find(c => c.id === companyId);
      return company ? company.name : '未知公司';
  }
}
