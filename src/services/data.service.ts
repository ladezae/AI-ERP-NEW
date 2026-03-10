
import { Injectable, signal, computed, effect } from '@angular/core';
import { Product, Supplier, Customer, PurchaseOrder, Order, ShippingOrder, CompanyProfile, Brand, Employee, Role, SystemSettings, ShippingTemplate, CommunicationTemplate, ExportTemplate, BusinessMetrics, MetricDefinition, Note, Invoice, PettyCashTransaction, PettyCashSubject, ChatMessage, Task, TaskComment, MobilePageConfig, PricingCalculation, SpecDefinition, AiUsageLog, SchemaModel, ViewType } from '../models/erp.models';
import { db, initError } from '../firebase.config'; // Import initError
import { collection, getDocs, doc, setDoc, updateDoc, deleteDoc, Firestore, writeBatch, getDoc } from 'firebase/firestore';

export type ConnectionStatus = 'initializing' | 'connected' | 'disconnected' | 'error' | 'mock';

export interface BackupSnapshot {
  key: string;
  timestamp: number;
  dateStr: string;
  type: 'manual' | 'auto';
  size: string;
}

@Injectable({
  providedIn: 'root',
})
export class DataService {
  products = signal<Product[]>([]);
  suppliers = signal<Supplier[]>([]);
  customers = signal<Customer[]>([]);
  purchaseOrders = signal<PurchaseOrder[]>([]);
  orders = signal<Order[]>([]);
  shippingOrders = signal<ShippingOrder[]>([]);
  employees = signal<Employee[]>([]);
  roles = signal<Role[]>([]);
  companies = signal<CompanyProfile[]>([]);
  brands = signal<Brand[]>([]); 
  shippingTemplates = signal<ShippingTemplate[]>([]);
  communicationTemplates = signal<CommunicationTemplate[]>([]);
  exportTemplates = signal<ExportTemplate[]>([]); 
  
  // --- Notebook Notes ---
  notes = signal<Note[]>([]);

  // --- Invoices ---
  invoices = signal<Invoice[]>([]);

  // --- Petty Cash ---
  pettyCashTransactions = signal<PettyCashTransaction[]>([]);
  pettyCashSubjects = signal<PettyCashSubject[]>([]);

  // --- Tasks (Task Center) ---
  tasks = signal<Task[]>([]);

  // --- Mobile Layouts ---
  mobilePages = signal<MobilePageConfig[]>([]);
  
  // --- Pricing Calculations ---
  pricingCalculations = signal<PricingCalculation[]>([]);
  
  // --- Global Spec Definitions (Pricing) ---
  specDefinitions = signal<SpecDefinition[]>([]);
  
  // --- Custom Spec Names (Pricing - Legacy/Aux) ---
  customSpecNames = signal<string[]>([]);
  
  // --- AI Usage Logs ---
  aiUsageLogs = signal<AiUsageLog[]>([]);

  // --- System Schemas (Data Dictionary) ---
  systemSchemas = signal<SchemaModel[]>([]);

  // --- Deep Link State for Mobile Layout ---
  autoOpenMobileModule = signal<string | null>(null);

  // --- Deep Link State for Order Wizard ---
  autoStartOrderWizard = signal(false);

  // --- Chat History (Persisted) ---
  chatHistory = signal<ChatMessage[]>([]);

  // --- Metric Definitions (Data Dictionary) ---
  metricDefinitions = signal<MetricDefinition[]>([]);

  // --- AI Pre-calculated Stats (The "Cheat Sheet") ---
  businessMetrics = signal<BusinessMetrics>({
      revenue: { currentMonth: 0, lastMonth: 0, totalYear: 0 },
      orders: { pendingCount: 0, shippingCount: 0, todayCount: 0 },
      inventory: { lowStockCount: 0, outOfStockCount: 0, totalValue: 0 },
      manufacturing: { activeOrders: 0, delayedOrders: 0 },
      lastUpdated: new Date().toISOString()
  });

  // Authentication State
  currentUser = signal<Employee | null>(null);
  
  // 系統設定
  systemSettings = signal<SystemSettings>({
    taxRate: 0.05,
    currency: 'TWD',
    defaultPaymentTerms: '先匯款',
    companyName: '公司大平台 ERP',
    theme: 'dark', 
    fontSizeLevel: 3,
    aiPricing: {
        inputRate: 0.075, 
        outputRate: 0.30 
    },
    aiMonthlyQuota: 1000000, // Default 1M tokens
    autoBackup: false,
    autoBackupInterval: 30 // Minutes
  });
  
  connectionStatus = signal<ConnectionStatus>('initializing');
  isRefreshing = signal(false); // New: Track manual refresh state
  lastSyncTime = signal<Date | null>(null);
  errorMessage = signal<string>('');
  
  dataSourceType = computed(() => 
    this.connectionStatus() === 'mock' ? '本機儲存 (Local Storage / Mock)' : 'Google Cloud Firestore'
  );

  statusColor = computed(() => {
    switch (this.connectionStatus()) {
      case 'connected': return 'text-green-600';
      case 'mock': return 'text-yellow-600';
      case 'error': return 'text-red-600';
      default: return 'text-slate-400';
    }
  });
  
  // Computed: Check if Database is essentially empty
  isDbEmpty = computed(() => {
      // Considered empty if no products AND no orders AND no customers
      // Use length check to be safe against nulls (though signals init with [])
      return this.products().length === 0 && 
             this.orders().length === 0 && 
             this.customers().length === 0;
  });

  // --- Urgent Purchase Order Tracking ---
  urgentPurchaseOrders = computed(() => {
      const excludedStatuses = ['已結案', '取消'];
      return this.purchaseOrders().filter(po => !excludedStatuses.includes(po.status));
  });

  urgentUniquePurchaseOrderCount = computed(() => {
      const pos = this.urgentPurchaseOrders();
      const unique = new Set(pos.map(p => p.poNumber || (p.purchaseId ? p.purchaseId.split('-').slice(0,3).join('-') : '')));
      const cleanKeys = Array.from(unique).filter((k: any) => k && typeof k === 'string' && k.trim() !== '');
      return cleanKeys.length;
  });

  // --- Petty Cash Balance (Global) ---
  pettyCashBalance = computed(() => {
      return this.pettyCashTransactions().reduce((acc, curr) => {
          if (curr.type === 'Income') return acc + curr.amount;
          return acc - curr.amount;
      }, 0);
  });

  aiUsageStats = computed(() => {
    const logs = this.aiUsageLogs();
    const settings = this.systemSettings();
    const now = new Date();
    const currentMonthPrefix = `${now.getFullYear()}-${(now.getMonth() + 1).toString().padStart(2, '0')}`;
    
    const monthlyLogs = logs.filter(l => l.timestamp.startsWith(currentMonthPrefix));
    const totalTokens = monthlyLogs.reduce((acc, l) => acc + l.totalTokens, 0);
    const quota = settings.aiMonthlyQuota || 1000000;
    
    return {
      totalTokens,
      quota,
      usagePct: Math.min(100, (totalTokens / quota) * 100),
      isOverQuota: totalTokens > quota
    };
  });

  // --- Petty Cash Balance (Current Month) ---
  pettyCashMonthlyBalance = computed(() => {
      const now = new Date();
      const currentMonthPrefix = `${now.getFullYear()}-${(now.getMonth() + 1).toString().padStart(2, '0')}`;
      
      const monthlyTxs = this.pettyCashTransactions().filter(t => t.date.startsWith(currentMonthPrefix));
      
      const income = monthlyTxs.filter(t => t.type === 'Income').reduce((sum, t) => sum + t.amount, 0);
      const expense = monthlyTxs.filter(t => t.type === 'Expense').reduce((sum, t) => sum + t.amount, 0);
      
      return income - expense;
  });

  // --- Unread Tasks for Current User ---
  myUnreadTasks = computed(() => {
      const user = this.currentUser();
      if (!user) return [];
      
      return this.tasks()
          .filter(t => t.assigneeId === user.id && !t.isRead && t.status !== 'Completed' && t.status !== 'Archived')
          .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
  });

  // --- Programmatic Metric Calculations (Hardcoded Logic) ---
  
  // MET-004: 代工未完數 (OEM Outstanding)
  oemOutstandingStats = computed(() => {
      const orders = this.orders();
      const products = this.products();
      const excludedStatuses = ['已結案', '取消', '已出貨'];

      // Create a map for faster product lookup
      const productMap = new Map(products.map(p => [p.id, p]));

      return orders.reduce((sum, order) => {
          // 1. Must be Manufacturing Order
          if (!order.isManufacturingOrder) return sum;
          
          // 2. Must be Active (Not closed)
          if (excludedStatuses.includes(order.status)) return sum;

          // 3. Filter Product category=代工
          const product = productMap.get(order.productId);
          if (!product || product.category !== '代工') return sum;

          // 4. Sum Order outstandingManufacturingQty
          // Use the field if present, otherwise fallback to calculation
          const outstanding = order.outstandingManufacturingQty ?? Math.max(0, (order.quantity || 0) - (order.manufacturedQuantity || 0));

          return sum + outstanding;
      }, 0);
  });
  
  // --- DEFAULT SCHEMAS (Persisted in Service) ---
  private readonly DEFAULT_SCHEMAS: SchemaModel[] = [
    {
      name: 'Product',
      chineseName: '商品',
      description: '系統內的商品基本資料',
      fields: [
        { name: 'id', chineseName: '商品編號', type: 'string', description: '唯一識別碼' },
        { name: 'name', chineseName: '商品名稱', type: 'string', description: '商品顯示名稱' },
        { name: 'stock', chineseName: '庫存', type: 'number', description: '目前庫存數量' },
        { name: 'safetyStock', chineseName: '安全庫存', type: 'number', description: '最低安全水位' },
        { name: 'costBeforeTax', chineseName: '未稅成本', type: 'number', description: '進貨成本(未稅)' },
        { name: 'costAfterTax', chineseName: '含稅成本', type: 'number', description: '進貨成本(含稅)' },
        { name: 'priceBeforeTax', chineseName: '未稅售價', type: 'number', description: '標準售價(未稅)' },
        { name: 'priceAfterTax', chineseName: '含稅售價', type: 'number', description: '標準售價(含稅)' },
        { name: 'recommendedPrice', chineseName: '建議售價', type: 'number', description: '建議市場末端售價 (Cost/0.9)' },
        { name: 'supplierCode', chineseName: '供應商代碼', type: 'string', description: '關聯供應商' },
        { name: 'category', chineseName: '分類', type: 'string', description: '商品類別' },
        { name: 'keyProduct', chineseName: '重點商品', type: 'string', description: '分級 (A/B/C)' },
        { name: 'productFeatures', chineseName: '商品特色', type: 'string', description: '商品的特色描述' }
      ]
    },
    {
      name: 'Order',
      chineseName: '訂單',
      description: '客戶銷售訂單',
      fields: [
        { name: 'orderId', chineseName: '訂單編號', type: 'string', description: '唯一識別碼' },
        { name: 'customerName', chineseName: '客戶名稱', type: 'string', description: '下單客戶' },
        { name: 'totalAmount', chineseName: '總金額', type: 'number', description: '訂單總額' },
        { name: 'status', chineseName: '狀態', type: 'string', description: '訂單目前狀態' },
        { name: 'orderDate', chineseName: '訂單日期', type: 'string', description: '建立日期' },
        { name: 'paymentStatus', chineseName: '付款狀態', type: 'boolean', description: '是否已付款' },
        { name: 'isManufacturingOrder', chineseName: '代工單', type: 'boolean', description: '是否為代工訂單' }
      ]
    },
    {
      name: 'Customer',
      chineseName: '客戶',
      description: '客戶基本資料',
      fields: [
        { name: 'id', chineseName: '客戶編號', type: 'string', description: '唯一識別碼' },
        { name: 'shortName', chineseName: '簡稱', type: 'string', description: '客戶顯示名稱' },
        { name: 'phone', chineseName: '電話', type: 'string', description: '聯絡電話' },
        { name: 'taxId', chineseName: '統編', type: 'string', description: '統一編號' },
        { name: 'salesperson', chineseName: '負責業務', type: 'string', description: '業務人員' }
      ]
    },
    {
      name: 'Supplier',
      chineseName: '供應商',
      description: '供應商基本資料',
      fields: [
        { name: 'code', chineseName: '供應商代碼', type: 'string', description: '唯一識別碼' },
        { name: 'shortName', chineseName: '簡稱', type: 'string', description: '供應商顯示名稱' },
        { name: 'taxId', chineseName: '統編', type: 'string', description: '統一編號' },
        { name: 'shipLogistics', chineseName: '預設物流', type: 'string', description: '預設出貨物流' }
      ]
    },
    {
       name: 'PurchaseOrder',
       chineseName: '採購單',
       description: '進貨採購紀錄',
       fields: [
           { name: 'purchaseId', chineseName: '採購單號', type: 'string', description: '唯一識別碼' },
           { name: 'poNumber', chineseName: '採購群組號', type: 'string', description: '同一次採購的群組號' },
           { name: 'supplierName', chineseName: '供應商', type: 'string', description: '供應商名稱' },
           { name: 'status', chineseName: '狀態', type: 'string', description: '採購狀態' },
           { name: 'quantity', chineseName: '數量', type: 'number', description: '採購數量' },
           { name: 'purchaseDate', chineseName: '採購日期', type: 'string', description: '建立日期' }
       ]
    },
    {
      name: 'ShippingOrder',
      chineseName: '出貨單',
      description: '系統內的出貨紀錄與物流資訊',
      fields: [
        { name: 'id', chineseName: '出貨紀錄編號', type: 'string', description: '唯一識別碼' },
        { name: 'orderId', chineseName: '關聯訂單號', type: 'string', description: '對應的銷售訂單編號' },
        { name: 'customerName', chineseName: '客戶名稱', type: 'string', description: '收貨客戶' },
        { name: 'productName', chineseName: '商品名稱', type: 'string', description: '出貨商品名稱' },
        { name: 'shippingQuantity', chineseName: '出貨數量', type: 'number', description: '本次實際出貨的數量' },
        { name: 'actualShippingDate', chineseName: '實際出貨日', type: 'string', description: '貨物離開倉庫的日期' },
        { name: 'batchNo', chineseName: '出貨批次', type: 'string', description: '同一次出貨作業的批次號' },
        { name: 'logistics', chineseName: '物流商', type: 'string', description: '負責配送的物流公司' },
        { name: 'shippingId', chineseName: '貨運單號', type: 'string', description: '物流公司的追蹤單號' },
        { name: 'trackingUrl', chineseName: '追蹤網址', type: 'string', description: '物流查詢連結' },
        { name: 'specialRequests', chineseName: '出貨備註', type: 'string', description: '出貨時的特殊需求或備註' }
      ]
    },
    {
      name: 'Task',
      chineseName: '任務中心',
      description: '系統內部的任務、提醒與需求管理',
      fields: [
        { name: 'id', chineseName: '任務編號', type: 'string', description: '唯一識別碼' },
        { name: 'title', chineseName: '標題', type: 'string', description: '任務簡述' },
        { name: 'type', chineseName: '類型', type: 'string', description: '任務/提醒/需求' },
        { name: 'status', chineseName: '狀態', type: 'string', description: '待處理/進行中/已完成/已歸檔' },
        { name: 'priority', chineseName: '優先級', type: 'string', description: '高/中/低' },
        { name: 'description', chineseName: '描述', type: 'string', description: '詳細內容' },
        { name: 'creatorName', chineseName: '建立者', type: 'string', description: '建立任務的人員' },
        { name: 'assigneeName', chineseName: '指派對象', type: 'string', description: '負責執行的對象' },
        { name: 'deadline', chineseName: '截止日期', type: 'string', description: '預計完成時間' },
        { name: 'createdAt', chineseName: '建立時間', type: 'string', description: '任務建立時間' },
        { name: 'updatedAt', chineseName: '更新時間', type: 'string', description: '最後異動時間' }
      ]
    }
  ];

  // Auto Backup Timer
  private backupTimer: any = null;

  // --- Navigation ---
  currentView = signal<ViewType>('dashboard');
  
  navigateTo(view: ViewType) {
      this.currentView.set(view);
  }

  constructor() {
    this.loadSettingsFromStorage();

    if (db) {
       this.loadDataFromFirebase();
    } else {
       if (!this.loadDataFromStorage()) {
           // No data found in storage and no Firebase connection
           this.connectionStatus.set('disconnected');
       } else {
           console.log('Loaded data from Local Storage (Persistence enabled)');
           this.connectionStatus.set('mock'); 
           this.lastSyncTime.set(new Date());
           // Force check schemas after loading from storage
           this.ensureSchemaIntegrity();
       }
    }
    
    this.loadLocalConfig();
    this.checkSession();
    this.initAutoBackup(); // Start auto-backup service

    // *** AUTOMATIC STATS CALCULATION (The "Cheat Sheet") ***
    effect(() => {
        const prods = this.products();
        const ords = this.orders();
        
        if (prods.length === 0 && ords.length === 0) return;

        const now = new Date();
        const currentMonth = now.getMonth();
        const currentYear = now.getFullYear();
        const todayStr = now.toISOString().split('T')[0];

        // 1. Revenue Stats
        let revCurrent = 0;
        let revTotal = 0;
        
        const uniquePending = new Set<string>();
        const uniqueShipping = new Set<string>();
        const uniqueToday = new Set<string>();
        const uniqueMfgActive = new Set<string>();
        
        ords.forEach(o => {
            if (o.status === '取消') return;
            
            const baseId = o.orderId.split('-').slice(0,3).join('-');

            revTotal += o.totalAmount;
            const d = new Date(o.orderDate);
            if (d.getMonth() === currentMonth && d.getFullYear() === currentYear) {
                revCurrent += o.totalAmount;
            }

            if (o.status === '處理中' && !o.isManufacturingOrder) uniquePending.add(baseId);
            if (o.status === '部份出貨') uniqueShipping.add(baseId);
            if (o.orderDate === todayStr) uniqueToday.add(baseId);
            
            if (o.isManufacturingOrder && 
                (o.status === '處理中' || o.status === '部份出貨')) {
                uniqueMfgActive.add(baseId);
            }
        });

        let lowStock = 0;
        let outOfStock = 0;
        let invValue = 0;

        prods.forEach(p => {
            if (p.stock < p.safetyStock) lowStock++;
            if (p.stock <= 0) outOfStock++;
            invValue += (p.stock * p.costBeforeTax);
        });

        this.businessMetrics.set({
            revenue: { currentMonth: revCurrent, lastMonth: 0, totalYear: revTotal }, 
            orders: { 
                pendingCount: uniquePending.size, 
                shippingCount: uniqueShipping.size, 
                todayCount: uniqueToday.size 
            },
            inventory: { lowStockCount: lowStock, outOfStockCount: outOfStock, totalValue: invValue },
            manufacturing: { activeOrders: uniqueMfgActive.size, delayedOrders: 0 },
            lastUpdated: new Date().toLocaleTimeString()
        });
    });
  }

  // --- Snapshot Management Logic ---
  
  createLocalSnapshot(type: 'manual' | 'auto' = 'manual'): boolean {
    try {
      const data = this.getAllDataAsJson();
      const ts = Date.now();
      const key = `erp_snap_${type}_${ts}`;
      const sizeBytes = new Blob([data]).size;
      const sizeMB = (sizeBytes / 1024 / 1024).toFixed(2) + ' MB';

      // Constraint: Keep only last 5 auto backups to save space (User requested update)
      if (type === 'auto') {
          let snapshots = this.listLocalSnapshots().filter(s => s.type === 'auto');
          
          // Sort oldest first
          snapshots.sort((a,b) => a.timestamp - b.timestamp);

          // Prune until we have fewer than 5 (leaving room for 1 more, so max 5 total)
          // Effectively this ensures we never have more than 5 after adding the new one.
          while (snapshots.length >= 5) {
              const oldest = snapshots.shift();
              if (oldest) this.deleteLocalSnapshot(oldest.key);
          }
      }

      localStorage.setItem(key, data);
      
      // Update metadata list (Optional, or just scan keys every time)
      console.log(`[${type.toUpperCase()}] Snapshot created: ${key} (${sizeMB})`);
      return true;
    } catch (e: any) {
      console.error('Failed to create local snapshot', e);
      if (e.name === 'QuotaExceededError') {
          alert('本機儲存空間不足，無法建立備份。請清理舊的快照。');
      }
      return false;
    }
  }

  listLocalSnapshots(): BackupSnapshot[] {
    const snapshots: BackupSnapshot[] = [];
    for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key && key.startsWith('erp_snap_')) {
            const parts = key.split('_'); // erp, snap, type, ts
            if (parts.length >= 4) {
                const type = parts[2] as 'manual' | 'auto';
                const ts = parseInt(parts[3]);
                const data = localStorage.getItem(key) || '';
                const sizeBytes = new Blob([data]).size;
                const sizeStr = sizeBytes > 1024*1024 
                    ? (sizeBytes/1024/1024).toFixed(2) + ' MB'
                    : (sizeBytes/1024).toFixed(0) + ' KB';
                
                snapshots.push({
                    key,
                    timestamp: ts,
                    dateStr: new Date(ts).toLocaleString(),
                    type,
                    size: sizeStr
                });
            }
        }
    }
    return snapshots.sort((a, b) => b.timestamp - a.timestamp); // Newest first
  }

  restoreLocalSnapshot(key: string): boolean {
      try {
          const json = localStorage.getItem(key);
          if (!json) return false;
          const data = JSON.parse(json);
          this.restoreFullBackup(data);
          return true;
      } catch (e) {
          console.error('Failed to restore snapshot', e);
          return false;
      }
  }

  deleteLocalSnapshot(key: string) {
      localStorage.removeItem(key);
  }

  initAutoBackup() {
      // Clear existing timer
      if (this.backupTimer) clearInterval(this.backupTimer);

      effect(() => {
          const settings = this.systemSettings();
          if (settings.autoBackup) {
              const intervalMs = (settings.autoBackupInterval || 30) * 60 * 1000;
              console.log(`Auto-backup enabled. Interval: ${settings.autoBackupInterval} mins`);
              
              this.backupTimer = setInterval(() => {
                  this.createLocalSnapshot('auto');
              }, intervalMs);
          } else {
              if (this.backupTimer) clearInterval(this.backupTimer);
              this.backupTimer = null;
          }
      });
  }
  
  // NEW: Reset Schemas to Default (Restore 3 Days Ago / Factory)
  resetSchemasToDefault() {
      // 1. Reset Signal
      this.systemSchemas.set(this.DEFAULT_SCHEMAS); // Note: DEFAULT_SCHEMAS needs to be fully defined if used
      
      // 2. Save to Local
      this.saveLocal('erp_schemas', this.DEFAULT_SCHEMAS);
      
      // 3. Sync to Cloud if Connected
      if (this.connectionStatus() === 'connected' && db) {
          const promises = this.DEFAULT_SCHEMAS.map(s => setDoc(doc(db, 'schemas', s.name), s));
          Promise.all(promises).catch(err => console.error('Failed to reset schemas in cloud', err));
      }
      
      console.log('Schemas reset to defaults');
  }
  
  // NEW: Manual Refresh All Data
  async refreshAll() {
      if (this.isRefreshing()) return;
      
      this.isRefreshing.set(true);
      try {
          if (db) {
              await this.loadDataFromFirebase();
          } else {
              // Reload from storage
              this.loadDataFromStorage();
              // Simulate small delay for UX so user sees spinner
              await new Promise(resolve => setTimeout(resolve, 600));
              this.lastSyncTime.set(new Date());
              this.ensureSchemaIntegrity();
          }
      } catch (e) {
          console.error('Refresh failed', e);
      } finally {
          this.isRefreshing.set(false);
      }
  }
  
  // *** NEW: Force Sync Local Data to Cloud ***
  async syncLocalToCloud() {
      if (!db) {
          throw new Error('無法連線到 Firebase，請檢查網路或金鑰設定。');
      }

      console.log('Starting Force Cloud Sync...');
      
      const uploadCollection = async (colName: string, items: any[], idField: string) => {
          const promises = items.map(item => {
              const docId = item[idField];
              if (!docId) return Promise.resolve();
              return setDoc(doc(db, colName, docId), item);
          });
          return Promise.all(promises);
      };

      try {
          await Promise.all([
              uploadCollection('products', this.products(), 'id'),
              uploadCollection('suppliers', this.suppliers(), 'code'),
              uploadCollection('customers', this.customers(), 'id'),
              uploadCollection('orders', this.orders(), 'orderId'),
              uploadCollection('purchaseOrders', this.purchaseOrders(), 'purchaseId'),
              uploadCollection('shippingOrders', this.shippingOrders(), 'id'),
              uploadCollection('employees', this.employees(), 'id'),
              uploadCollection('roles', this.roles(), 'id'),
              uploadCollection('companies', this.companies(), 'id'),
              uploadCollection('brands', this.brands(), 'id'),
              uploadCollection('shippingTemplates', this.shippingTemplates(), 'id'),
              uploadCollection('communicationTemplates', this.communicationTemplates(), 'id'),
              uploadCollection('exportTemplates', this.exportTemplates(), 'id'),
              uploadCollection('metricDefinitions', this.metricDefinitions(), 'id'),
              uploadCollection('notes', this.notes(), 'id'),
              uploadCollection('invoices', this.invoices(), 'id'),
              uploadCollection('pettyCash', this.pettyCashTransactions(), 'id'),
              uploadCollection('pettyCashSubjects', this.pettyCashSubjects(), 'id'),
              uploadCollection('tasks', this.tasks(), 'id'),
              uploadCollection('mobilePages', this.mobilePages(), 'id'),
              uploadCollection('pricingCalculations', this.pricingCalculations(), 'id'),
              uploadCollection('specDefinitions', this.specDefinitions(), 'id'),
              // New: Sync Schemas
              uploadCollection('schemas', this.systemSchemas(), 'name'),
              // Sync Settings
              setDoc(doc(db, 'settings', 'general'), this.systemSettings())
          ]);
          
          this.connectionStatus.set('connected');
          this.lastSyncTime.set(new Date());
          console.log('Cloud Sync Completed Successfully');
      } catch (e: any) {
          console.error('Cloud Sync Failed:', e);
          if (e.code === 'permission-denied') {
              throw new Error('權限不足，無法寫入雲端資料庫。');
          }
          throw e;
      }
  }
  
  saveFirebaseConfig(configStr: string) {
      try {
          const config = JSON.parse(configStr);
          if (!config.apiKey || !config.projectId) {
              throw new Error('設定檔缺少 apiKey 或 projectId');
          }
          localStorage.setItem('erp_custom_firebase_config', JSON.stringify(config));
          alert('設定已儲存！頁面將重新整理以套用新設定。');
          window.location.reload();
      } catch(e: any) {
          console.error(e);
          throw new Error('設定檔格式錯誤: ' + e.message);
      }
  }

  // New method to fix schemas
  private ensureSchemaIntegrity() {
      const currentSchemas = this.systemSchemas();
      
      // If schemas empty, initializeSchemas() will handle it later.
      if (currentSchemas.length === 0) return;

      // 1. Check for missing Task schema
      const taskSchemaExists = currentSchemas.some(s => s.name === 'Task');
      if (!taskSchemaExists) {
          console.log('Detected missing Task schema. Adding...');
          const taskSchema = this.DEFAULT_SCHEMAS.find(s => s.name === 'Task');
          if (taskSchema) {
              const newSchemas = [...currentSchemas, taskSchema];
              this.systemSchemas.set(newSchemas);
              this.saveLocal('erp_schemas', newSchemas);
              if (this.connectionStatus() === 'connected' && db) {
                  setDoc(doc(db, 'schemas', 'Task'), taskSchema)
                    .catch(e => console.error('Failed to sync Task schema to cloud', e));
              }
          }
      }

      // 2. Check for missing ShippingOrder schema
      const shippingSchemaExists = currentSchemas.some(s => s.name === 'ShippingOrder');
      if (!shippingSchemaExists) {
          console.log('Detected missing ShippingOrder schema. Adding...');
          const shippingSchema = this.DEFAULT_SCHEMAS.find(s => s.name === 'ShippingOrder');
          if (shippingSchema) {
              const newSchemas = [...this.systemSchemas(), shippingSchema];
              this.systemSchemas.set(newSchemas);
              this.saveLocal('erp_schemas', newSchemas);
              if (this.connectionStatus() === 'connected' && db) {
                  setDoc(doc(db, 'schemas', 'ShippingOrder'), shippingSchema)
                    .catch(e => console.error('Failed to sync ShippingOrder schema to cloud', e));
              }
          }
      }

      const productSchemaIndex = currentSchemas.findIndex(s => s.name === 'Product');
      if (productSchemaIndex === -1) return;

      const productSchema = currentSchemas[productSchemaIndex];
      const hasRecPrice = productSchema.fields.some(f => f.name === 'recommendedPrice');

      if (!hasRecPrice) {
          console.log('Detected missing recommendedPrice in Product schema. Patching...');
          const newFields = [...productSchema.fields];
           // Insert after priceAfterTax (usually index 7 or 8)
           // Find index of priceAfterTax
           const idx = newFields.findIndex(f => f.name === 'priceAfterTax');
           const insertAt = idx >= 0 ? idx + 1 : newFields.length;
           
           newFields.splice(insertAt, 0, { 
              name: 'recommendedPrice', 
              chineseName: '建議售價', 
              type: 'number', 
              description: '建議市場末端售價 (Cost/0.9)' 
           });

           const updatedSchema = { ...productSchema, fields: newFields };
           const newSchemas = [...currentSchemas];
           newSchemas[productSchemaIndex] = updatedSchema;
           
           this.systemSchemas.set(newSchemas);
           this.saveLocal('erp_schemas', newSchemas);
           
           if (this.connectionStatus() === 'connected' && db) {
               // Sync specific doc
               setDoc(doc(db, 'schemas', 'Product'), updatedSchema)
                 .catch(e => console.error('Failed to patch schema to cloud', e));
           }
      }
  }

  private runOneOffMigrations() {
      const products = this.products();
      let needsMigration = false;
      
      // Migration 1: Product Fields
      const updated = products.map(p => {
          let modified = false;
          let newP = { ...p };

          if (p.isCalculable === undefined) {
              newP.isCalculable = true;
              modified = true;
          }

          if (p.recommendedPrice === undefined) {
              // Calculate default: costAfterTax / 0.9
              newP.recommendedPrice = Math.round((p.costAfterTax || 0) / 0.9);
              modified = true;
          }
          
          if (modified) needsMigration = true;
          return newP;
      });
      
      if (needsMigration) {
          this.products.set(updated);
          this.saveLocal('erp_products', updated);
          console.log('Migration completed: Added recommendedPrice and isCalculable to products.');
      }
  }

  private saveLocal(key: string, data: any) {
    try {
      localStorage.setItem(key, JSON.stringify(data));
    } catch (e) {
      console.error('Error saving to local storage', e);
    }
  }

  private loadSettingsFromStorage() {
    const saved = localStorage.getItem('erp_settings');
    if (saved) {
      try {
        const settings = JSON.parse(saved);
        this.systemSettings.set({ ...this.systemSettings(), ...settings });
      } catch (e) {
        console.error('Failed to parse settings', e);
      }
    }
  }

  private loadDataFromStorage(): boolean {
    let hasData = false;
    const load = (key: string, signalSetter: any) => {
      const saved = localStorage.getItem(key);
      if (saved) {
        try {
          const parsed = JSON.parse(saved);
          if (Array.isArray(parsed) && parsed.length > 0) {
            signalSetter.set(parsed);
            hasData = true;
          }
        } catch (e) {
          console.warn(`Failed to parse ${key}`, e);
        }
      }
    };

    // Load ALL collections
    load('erp_products', this.products);
    load('erp_suppliers', this.suppliers);
    load('erp_customers', this.customers);
    load('erp_orders', this.orders);
    load('erp_purchaseOrders', this.purchaseOrders);
    load('erp_shippingOrders', this.shippingOrders);
    load('erp_employees', this.employees);
    load('erp_roles', this.roles);
    load('erp_companies', this.companies);
    load('erp_brands', this.brands);
    load('erp_shippingTemplates', this.shippingTemplates);
    load('erp_communicationTemplates', this.communicationTemplates);
    load('erp_exportTemplates', this.exportTemplates);
    load('erp_metricDefinitions', this.metricDefinitions);
    load('erp_notes', this.notes);
    load('erp_invoices', this.invoices);
    load('erp_petty_cash', this.pettyCashTransactions);
    load('erp_petty_cash_subjects', this.pettyCashSubjects);
    load('erp_tasks', this.tasks);
    load('erp_mobilePages', this.mobilePages);
    load('erp_pricing_calculations', this.pricingCalculations);
    load('erp_spec_definitions', this.specDefinitions);
    load('erp_ai_usage', this.aiUsageLogs);
    load('erp_chat_history', this.chatHistory);
    load('erp_schemas', this.systemSchemas); 

    this.sanitizeAllData();
    return hasData;
  }
  
  private loadLocalConfig() {}
  
  private initializeSchemas() {
      // If schemas are empty (e.g. fresh install or failed load), populate with DEFAULT
      setTimeout(() => {
          if (this.systemSchemas().length === 0 && this.DEFAULT_SCHEMAS.length > 0) {
              console.log('Initializing Default Schemas...');
              this.systemSchemas.set(this.DEFAULT_SCHEMAS);
              this.saveLocal('erp_schemas', this.DEFAULT_SCHEMAS);
          }
      }, 1000); 
  }

  private checkSession() {
      const savedUser = localStorage.getItem('erp_current_user');
      if (savedUser) {
          try {
              this.currentUser.set(JSON.parse(savedUser));
          } catch(e) {}
      } else {
          // Auto-login default admin if no session found
          const adminUser: Employee = {
              id: 'ADMIN', name: 'System Admin', email: 'admin@sys.com', phone: '',
              department: 'IT', jobTitle: 'Admin', roleId: 'ADMIN', roleName: 'Super Admin',
              status: 'Active', joinDate: '', avatarUrl: '', account: 'admin', password: '123'
          };
          this.currentUser.set(adminUser);
          this.saveLocal('erp_current_user', adminUser);
      }
  }

  login(account: string, pass: string): boolean {
      const employee = this.employees().find(e => e.account === account && e.password === pass);
      if (employee) {
          this.currentUser.set(employee);
          this.saveLocal('erp_current_user', employee);
          return true;
      }
      if (this.employees().length === 0 && account === 'admin' && pass === '123') {
           const adminUser: Employee = {
               id: 'ADMIN', name: 'System Admin', email: 'admin@sys.com', phone: '',
               department: 'IT', jobTitle: 'Admin', roleId: 'ADMIN', roleName: 'Super Admin',
               status: 'Active', joinDate: '', avatarUrl: '', account: 'admin', password: '123'
           };
           this.currentUser.set(adminUser);
           this.saveLocal('erp_current_user', adminUser);
           return true;
      }
      return false;
  }

  logout() {
      this.currentUser.set(null);
      localStorage.removeItem('erp_current_user');
      window.location.reload();
  }

  updateSettings(newSettings: Partial<SystemSettings>) {
      this.systemSettings.update(s => {
          const updated = { ...s, ...newSettings };
          this.saveLocal('erp_settings', updated);
          
          if (this.connectionStatus() === 'connected' && db) {
              setDoc(doc(db, 'settings', 'general'), updated).catch(e => console.error('Settings sync failed', e));
          }

          return updated;
      });
  }

  evaluateFormula(formula: string): string | number {
      if (!formula) return 'N/A';
      if (formula === 'PROGRAMMATIC_OEM_CALC') return this.oemOutstandingStats();
      if (formula === 'PROGRAMMATIC_PETTY_CASH_MONTH') return this.pettyCashMonthlyBalance();

      try {
          if (formula.startsWith('Sum(')) {
              const match = formula.match(/Sum\((.*?)\.(.*?)\)/);
              if (match) {
                  const collectionName = match[1];
                  const fieldName = match[2];
                  let data: any[] = [];
                  
                  if (collectionName === 'Order') data = this.orders();
                  else if (collectionName === 'PurchaseOrder') data = this.purchaseOrders();
                  else if (collectionName === 'Product') data = this.products();
                  
                  let filtered = data;
                  if (formula.includes('where')) {
                      if (formula.includes('status != "取消"')) filtered = filtered.filter(i => i.status !== '取消');
                      if (formula.includes('Current Month')) {
                          const now = new Date();
                          const cm = now.getMonth();
                          const cy = now.getFullYear();
                          filtered = filtered.filter(i => {
                              const d = new Date(i.orderDate || i.date || i.purchaseDate);
                              return d.getMonth() === cm && d.getFullYear() === cy;
                          });
                      }
                  }
                  const sum = filtered.reduce((acc, item) => acc + (Number(item[fieldName]) || 0), 0);
                  return sum.toLocaleString();
              }
          }
          if (formula.startsWith('Count(')) {
              const match = formula.match(/Count\((.*?)\)/);
              if (match) {
                  const target = match[1];
                  let data: any[] = [];
                  let sourceName = 'Order'; 
                  if (formula.includes('Order')) sourceName = 'Order';
                  if (formula.includes('Product')) sourceName = 'Product';
                  if (formula.includes('PurchaseOrder')) sourceName = 'PurchaseOrder';
                  if (formula.includes('Customer')) sourceName = 'Customer';
                  if (formula.includes('Employee')) sourceName = 'Employee';

                  if (sourceName === 'Order') data = this.orders();
                  else if (sourceName === 'Product') data = this.products();
                  else if (sourceName === 'PurchaseOrder') data = this.purchaseOrders();
                  else if (sourceName === 'Customer') data = this.customers();
                  else if (sourceName === 'Employee') data = this.employees();

                  let filtered = data;
                  if (formula.includes('where')) {
                      if (formula.includes('status == "處理中"')) filtered = filtered.filter(i => i.status === '處理中');
                      if (formula.includes('status == "部份出貨"')) filtered = filtered.filter(i => i.status === '部份出貨');
                      if (formula.includes('stock <= 0')) filtered = filtered.filter(i => (i.stock || 0) <= 0);
                      if (formula.includes('status != "已結案"')) filtered = filtered.filter(i => i.status !== '已結案');
                      if (formula.includes('status != "取消"')) filtered = filtered.filter(i => i.status !== '取消');
                      if (formula.includes('isManufacturingOrder == true')) filtered = filtered.filter(i => i.isManufacturingOrder === true);
                      if (formula.includes('Employee.status == "Active"')) filtered = filtered.filter(i => i.status === 'Active');
                  }

                  if (target.includes('Unique')) {
                      const uniqueSet = new Set();
                      filtered.forEach(item => {
                          let key = item.id;
                          if (target.includes('orderId')) key = item.orderId ? item.orderId.split('-').slice(0,3).join('-') : item.id;
                          if (target.includes('poNumber')) key = item.poNumber || (item.purchaseId ? item.purchaseId.split('-').slice(0,3).join('-') : '');
                          if (key) uniqueSet.add(key);
                      });
                      return uniqueSet.size;
                  } else {
                      return filtered.length;
                  }
              }
          }
      } catch (e) {
          console.error('Formula eval error', e);
          return 'Error';
      }
      return 'N/A';
  }
  
  // CRUD Methods (Simplified for brevity as requested)
  async addProduct(product: Product): Promise<void> { 
    console.log('DataService: Adding product', product.id);
    this.sanitizeImageUrls(product);
    this.products.update(current => [product, ...current]); 
    this.saveLocal('erp_products', this.products()); 
    if (this.connectionStatus() === 'connected' && db) { 
        console.log('DataService: Syncing new product to Firebase', product.id);
        await setDoc(doc(db, 'products', product.id), product); 
    } 
    this.lastSyncTime.set(new Date()); 
  }
  async updateProduct(product: Product): Promise<void> { 
    console.log('DataService: Updating product', product.id);
    this.sanitizeImageUrls(product);
    this.products.update(current => current.map(p => p.id === product.id ? product : p)); 
    this.saveLocal('erp_products', this.products()); 
    if (this.connectionStatus() === 'connected' && db) { 
        console.log('DataService: Syncing updated product to Firebase', product.id);
        await setDoc(doc(db, 'products', product.id), product); 
    } 
    this.lastSyncTime.set(new Date()); 
  }
  async deleteProduct(id: string): Promise<void> { this.products.update(current => current.filter(p => p.id !== id)); this.saveLocal('erp_products', this.products()); if (this.connectionStatus() === 'connected' && db) { await deleteDoc(doc(db, 'products', id)); } this.lastSyncTime.set(new Date()); }
  // ... (Other CRUD methods follow same pattern as previously defined)
  // Re-adding a few critical ones for context
  async addSupplier(supplier: Supplier): Promise<void> { this.suppliers.update(current => [supplier, ...current]); this.saveLocal('erp_suppliers', this.suppliers()); if (this.connectionStatus() === 'connected' && db) { await setDoc(doc(db, 'suppliers', supplier.code), supplier); } this.lastSyncTime.set(new Date()); }
  async updateSupplier(supplier: Supplier): Promise<void> { this.suppliers.update(current => current.map(s => s.code === supplier.code ? supplier : s)); this.saveLocal('erp_suppliers', this.suppliers()); if (this.connectionStatus() === 'connected' && db) { await setDoc(doc(db, 'suppliers', supplier.code), supplier); } this.lastSyncTime.set(new Date()); }
  async deleteSupplier(code: string): Promise<void> { this.suppliers.update(current => current.filter(s => s.code !== code)); this.saveLocal('erp_suppliers', this.suppliers()); if (this.connectionStatus() === 'connected' && db) { await deleteDoc(doc(db, 'suppliers', code)); } this.lastSyncTime.set(new Date()); }
  
  async addCustomer(customer: Customer): Promise<void> { this.customers.update(current => [customer, ...current]); this.saveLocal('erp_customers', this.customers()); if (this.connectionStatus() === 'connected' && db) { await setDoc(doc(db, 'customers', customer.id), customer); } }
  async updateCustomer(customer: Customer): Promise<void> { this.customers.update(current => current.map(c => c.id === customer.id ? customer : c)); this.saveLocal('erp_customers', this.customers()); if (this.connectionStatus() === 'connected' && db) { await setDoc(doc(db, 'customers', customer.id), customer); } }
  async deleteCustomer(id: string): Promise<void> { this.customers.update(current => current.filter(c => c.id !== id)); this.saveLocal('erp_customers', this.customers()); if (this.connectionStatus() === 'connected' && db) { await deleteDoc(doc(db, 'customers', id)); } }

  async addOrder(order: Order): Promise<void> { this.orders.update(current => [order, ...current]); this.saveLocal('erp_orders', this.orders()); if (this.connectionStatus() === 'connected' && db) { await setDoc(doc(db, 'orders', order.orderId), order); } }
  async addOrders(newOrders: Order[]): Promise<void> { this.orders.update(current => [...newOrders, ...current]); this.saveLocal('erp_orders', this.orders()); if (this.connectionStatus() === 'connected' && db) { await Promise.all(newOrders.map(o => setDoc(doc(db, 'orders', o.orderId), o))); } }
  async updateOrder(order: Order): Promise<void> { this.orders.update(current => current.map(o => o.orderId === order.orderId ? order : o)); this.saveLocal('erp_orders', this.orders()); if (this.connectionStatus() === 'connected' && db) { await setDoc(doc(db, 'orders', order.orderId), order); } }
  async updateOrders(updatedOrders: Order[]): Promise<void> { const map = new Map(updatedOrders.map(o => [o.orderId, o])); this.orders.update(current => current.map(o => map.get(o.orderId) || o)); this.saveLocal('erp_orders', this.orders()); if (this.connectionStatus() === 'connected' && db) { await Promise.all(updatedOrders.map(o => setDoc(doc(db, 'orders', o.orderId), o))); } }
  async deleteOrder(id: string): Promise<void> { this.orders.update(current => current.filter(o => o.orderId !== id)); this.saveLocal('erp_orders', this.orders()); if (this.connectionStatus() === 'connected' && db) { await deleteDoc(doc(db, 'orders', id)); } }

  async addPurchaseOrder(po: PurchaseOrder): Promise<void> { this.purchaseOrders.update(current => [po, ...current]); this.saveLocal('erp_purchaseOrders', this.purchaseOrders()); if (this.connectionStatus() === 'connected' && db) { await setDoc(doc(db, 'purchaseOrders', po.purchaseId), po); } }
  async updatePurchaseOrder(po: PurchaseOrder): Promise<void> { this.purchaseOrders.update(current => current.map(p => p.purchaseId === po.purchaseId ? po : p)); this.saveLocal('erp_purchaseOrders', this.purchaseOrders()); if (this.connectionStatus() === 'connected' && db) { await setDoc(doc(db, 'purchaseOrders', po.purchaseId), po); } }
  async updatePurchaseOrders(pos: PurchaseOrder[]): Promise<void> {
    // ★ 結案時自動加庫存 ★
    const currentPos = this.purchaseOrders();
    for (const newPo of pos) {
        const oldPo = currentPos.find(p => p.purchaseId === newPo.purchaseId);
        if (oldPo && oldPo.status !== '已結案' && newPo.status === '已結案') {
            const product = this.products().find(p => p.id === newPo.productId);
            if (product) {
                const addQty = newPo.quantity || 0;
                const updatedProduct = {
                    ...product,
                    stock: (product.stock || 0) + addQty
                };
                await this.updateProduct(updatedProduct);
                console.log(`[採購結案] ${product.name} 庫存 +${addQty} → ${updatedProduct.stock}`);
            }
        }
    }

    // 原有邏輯
    const map = new Map(pos.map(p => [p.purchaseId, p]));
    this.purchaseOrders.update(current => current.map(p => map.get(p.purchaseId) || p));
    this.saveLocal('erp_purchaseOrders', this.purchaseOrders());
    if (this.connectionStatus() === 'connected' && db) {
        await Promise.all(pos.map(p => setDoc(doc(db, 'purchaseOrders', p.purchaseId), p)));
    }
  }
  async deletePurchaseOrders(ids: string[]): Promise<void> { const set = new Set(ids); this.purchaseOrders.update(current => current.filter(p => !set.has(p.purchaseId))); this.saveLocal('erp_purchaseOrders', this.purchaseOrders()); if (this.connectionStatus() === 'connected' && db) { await Promise.all(ids.map(id => deleteDoc(doc(db, 'purchaseOrders', id)))); } }

  async addShippingOrder(so: ShippingOrder): Promise<void> { this.shippingOrders.update(current => [so, ...current]); this.saveLocal('erp_shippingOrders', this.shippingOrders()); if (this.connectionStatus() === 'connected' && db) { await setDoc(doc(db, 'shippingOrders', so.id), so); } }
  async updateShippingOrder(so: ShippingOrder): Promise<void> { this.shippingOrders.update(current => current.map(s => s.id === so.id ? so : s)); this.saveLocal('erp_shippingOrders', this.shippingOrders()); if (this.connectionStatus() === 'connected' && db) { await setDoc(doc(db, 'shippingOrders', so.id), so); } }
  async deleteShippingOrder(id: string): Promise<void> { this.shippingOrders.update(current => current.filter(s => s.id !== id)); this.saveLocal('erp_shippingOrders', this.shippingOrders()); if (this.connectionStatus() === 'connected' && db) { await deleteDoc(doc(db, 'shippingOrders', id)); } }
  
  async addInvoice(inv: Invoice): Promise<void> { this.invoices.update(current => [inv, ...current]); this.saveLocal('erp_invoices', this.invoices()); if (this.connectionStatus() === 'connected' && db) { await setDoc(doc(db, 'invoices', inv.id), inv); } }
  async updateInvoice(inv: Invoice): Promise<void> { this.invoices.update(current => current.map(i => i.id === inv.id ? inv : i)); this.saveLocal('erp_invoices', this.invoices()); if (this.connectionStatus() === 'connected' && db) { await setDoc(doc(db, 'invoices', inv.id), inv); } }
  async deleteInvoice(id: string): Promise<void> { this.invoices.update(current => current.filter(i => i.id !== id)); this.saveLocal('erp_invoices', this.invoices()); if (this.connectionStatus() === 'connected' && db) { await deleteDoc(doc(db, 'invoices', id)); } }

  async addPettyCashTransaction(tx: PettyCashTransaction): Promise<void> { this.pettyCashTransactions.update(current => [tx, ...current]); this.saveLocal('erp_petty_cash', this.pettyCashTransactions()); if (this.connectionStatus() === 'connected' && db) { await setDoc(doc(db, 'pettyCash', tx.id), tx); } }
  async updatePettyCashTransaction(tx: PettyCashTransaction): Promise<void> { this.pettyCashTransactions.update(current => current.map(t => t.id === tx.id ? tx : t)); this.saveLocal('erp_petty_cash', this.pettyCashTransactions()); if (this.connectionStatus() === 'connected' && db) { await setDoc(doc(db, 'pettyCash', tx.id), tx); } }
  async deletePettyCashTransaction(id: string): Promise<void> { this.pettyCashTransactions.update(current => current.filter(t => t.id !== id)); this.saveLocal('erp_petty_cash', this.pettyCashTransactions()); if (this.connectionStatus() === 'connected' && db) { await deleteDoc(doc(db, 'pettyCash', id)); } }
  async addPettyCashSubject(subject: PettyCashSubject): Promise<void> { this.pettyCashSubjects.update(current => [subject, ...current]); this.saveLocal('erp_petty_cash_subjects', this.pettyCashSubjects()); if (this.connectionStatus() === 'connected' && db) { await setDoc(doc(db, 'pettyCashSubjects', subject.id), subject); } }
  async deletePettyCashSubject(id: string): Promise<void> { this.pettyCashSubjects.update(current => current.filter(s => s.id !== id)); this.saveLocal('erp_petty_cash_subjects', this.pettyCashSubjects()); if (this.connectionStatus() === 'connected' && db) { await deleteDoc(doc(db, 'pettyCashSubjects', id)); } }

  async addEmployee(emp: Employee): Promise<void> { this.employees.update(current => [emp, ...current]); this.saveLocal('erp_employees', this.employees()); if (this.connectionStatus() === 'connected' && db) { await setDoc(doc(db, 'employees', emp.id), emp); } }
  async updateEmployee(emp: Employee): Promise<void> { this.employees.update(current => current.map(e => e.id === emp.id ? emp : e)); this.saveLocal('erp_employees', this.employees()); if (this.connectionStatus() === 'connected' && db) { await setDoc(doc(db, 'employees', emp.id), emp); } }
  async addTask(task: Task): Promise<void> { this.tasks.update(current => [task, ...current]); this.saveLocal('erp_tasks', this.tasks()); if (this.connectionStatus() === 'connected' && db) { await setDoc(doc(db, 'tasks', task.id), task); } }
  async updateTask(task: Task): Promise<void> { this.tasks.update(current => current.map(t => t.id === task.id ? task : t)); this.saveLocal('erp_tasks', this.tasks()); if (this.connectionStatus() === 'connected' && db) { await setDoc(doc(db, 'tasks', task.id), task); } }
  async deleteTask(id: string): Promise<void> { this.tasks.update(current => current.filter(t => t.id !== id)); this.saveLocal('erp_tasks', this.tasks()); if (this.connectionStatus() === 'connected' && db) { await deleteDoc(doc(db, 'tasks', id)); } }
  async addTaskComment(taskId: string, comment: TaskComment): Promise<void> { const task = this.tasks().find(t => t.id === taskId); if (task) { const updatedTask = { ...task, comments: [...task.comments, comment], updatedAt: new Date().toISOString() }; await this.updateTask(updatedTask); } }
  async markTaskAsRead(taskId: string): Promise<void> { const task = this.tasks().find(t => t.id === taskId); if (task && !task.isRead) { const updatedTask = { ...task, isRead: true }; await this.updateTask(updatedTask); } }
  
  async addMobilePage(page: MobilePageConfig): Promise<void> { this.mobilePages.update(current => [page, ...current]); this.saveLocal('erp_mobilePages', this.mobilePages()); if (this.connectionStatus() === 'connected' && db) { await setDoc(doc(db, 'mobilePages', page.id), page); } }
  async updateMobilePage(page: MobilePageConfig): Promise<void> { this.mobilePages.update(current => current.map(p => p.id === page.id ? page : p)); this.saveLocal('erp_mobilePages', this.mobilePages()); if (this.connectionStatus() === 'connected' && db) { await setDoc(doc(db, 'mobilePages', page.id), page); } }
  async deleteMobilePage(id: string): Promise<void> { this.mobilePages.update(current => current.filter(p => p.id !== id)); this.saveLocal('erp_mobilePages', this.mobilePages()); if (this.connectionStatus() === 'connected' && db) { await deleteDoc(doc(db, 'mobilePages', id)); } }

  async addRole(role: Role): Promise<void> { this.roles.update(current => [role, ...current]); this.saveLocal('erp_roles', this.roles()); if (this.connectionStatus() === 'connected' && db) { await setDoc(doc(db, 'roles', role.id), role); } }
  async updateRole(role: Role): Promise<void> { this.roles.update(current => current.map(r => r.id === role.id ? role : r)); this.saveLocal('erp_roles', this.roles()); if (this.connectionStatus() === 'connected' && db) { await setDoc(doc(db, 'roles', role.id), role); } }
  async addCompany(comp: CompanyProfile): Promise<void> { 
    this.sanitizeImageUrls(comp);
    this.companies.update(current => [comp, ...current]); 
    this.saveLocal('erp_companies', this.companies()); 
    if (this.connectionStatus() === 'connected' && db) { await setDoc(doc(db, 'companies', comp.id), comp); } 
  }
  async updateCompany(comp: CompanyProfile): Promise<void> { 
    this.sanitizeImageUrls(comp);
    this.companies.update(current => current.map(c => c.id === comp.id ? comp : c)); 
    this.saveLocal('erp_companies', this.companies()); 
    if (this.connectionStatus() === 'connected' && db) { await setDoc(doc(db, 'companies', comp.id), comp); } 
  }
  async addBrand(brand: Brand): Promise<void> { 
    this.sanitizeImageUrls(brand);
    this.brands.update(current => [brand, ...current]); 
    this.saveLocal('erp_brands', this.brands()); 
    if (this.connectionStatus() === 'connected' && db) { await setDoc(doc(db, 'brands', brand.id), brand); } 
  }
  async updateBrand(brand: Brand): Promise<void> { 
    this.sanitizeImageUrls(brand);
    this.brands.update(current => current.map(b => b.id === brand.id ? brand : b)); 
    this.saveLocal('erp_brands', this.brands()); 
    if (this.connectionStatus() === 'connected' && db) { await setDoc(doc(db, 'brands', brand.id), brand); } 
  }
  async deleteBrand(id: string): Promise<void> { this.brands.update(current => current.filter(b => b.id !== id)); this.saveLocal('erp_brands', this.brands()); if (this.connectionStatus() === 'connected' && db) { await deleteDoc(doc(db, 'brands', id)); } }
  
  async addShippingTemplate(tpl: ShippingTemplate): Promise<void> { this.shippingTemplates.update(current => [tpl, ...current]); this.saveLocal('erp_shippingTemplates', this.shippingTemplates()); if (this.connectionStatus() === 'connected' && db) { await setDoc(doc(db, 'shippingTemplates', tpl.id), tpl); } }
  async updateShippingTemplate(tpl: ShippingTemplate): Promise<void> { this.shippingTemplates.update(current => current.map(t => t.id === tpl.id ? tpl : t)); this.saveLocal('erp_shippingTemplates', this.shippingTemplates()); if (this.connectionStatus() === 'connected' && db) { await setDoc(doc(db, 'shippingTemplates', tpl.id), tpl); } }
  async deleteShippingTemplate(id: string): Promise<void> { this.shippingTemplates.update(current => current.filter(t => t.id !== id)); this.saveLocal('erp_shippingTemplates', this.shippingTemplates()); if (this.connectionStatus() === 'connected' && db) { await deleteDoc(doc(db, 'shippingTemplates', id)); } }
  async addCommunicationTemplate(tpl: CommunicationTemplate): Promise<void> { this.communicationTemplates.update(current => [tpl, ...current]); this.saveLocal('erp_communicationTemplates', this.communicationTemplates()); if (this.connectionStatus() === 'connected' && db) { await setDoc(doc(db, 'communicationTemplates', tpl.id), tpl); } }
  async updateCommunicationTemplate(tpl: CommunicationTemplate): Promise<void> { this.communicationTemplates.update(current => current.map(t => t.id === tpl.id ? tpl : t)); this.saveLocal('erp_communicationTemplates', this.communicationTemplates()); if (this.connectionStatus() === 'connected' && db) { await setDoc(doc(db, 'communicationTemplates', tpl.id), tpl); } }
  async deleteCommunicationTemplate(id: string): Promise<void> { this.communicationTemplates.update(current => current.filter(t => t.id !== id)); this.saveLocal('erp_communicationTemplates', this.communicationTemplates()); if (this.connectionStatus() === 'connected' && db) { await deleteDoc(doc(db, 'communicationTemplates', id)); } }
  async addExportTemplate(tpl: ExportTemplate): Promise<void> { this.exportTemplates.update(current => [tpl, ...current]); this.saveLocal('erp_exportTemplates', this.exportTemplates()); if (this.connectionStatus() === 'connected' && db) { await setDoc(doc(db, 'exportTemplates', tpl.id), tpl); } }
  async updateExportTemplate(tpl: ExportTemplate): Promise<void> { this.exportTemplates.update(current => current.map(t => t.id === tpl.id ? tpl : t)); this.saveLocal('erp_exportTemplates', this.exportTemplates()); if (this.connectionStatus() === 'connected' && db) { await setDoc(doc(db, 'exportTemplates', tpl.id), tpl); } }
  async deleteExportTemplate(id: string): Promise<void> { this.exportTemplates.update(current => current.filter(t => t.id !== id)); this.saveLocal('erp_exportTemplates', this.exportTemplates()); if (this.connectionStatus() === 'connected' && db) { await deleteDoc(doc(db, 'exportTemplates', id)); } }
  
  async addMetricDefinition(def: MetricDefinition): Promise<void> { this.metricDefinitions.update(current => [def, ...current]); this.saveLocal('erp_metricDefinitions', this.metricDefinitions()); if (this.connectionStatus() === 'connected' && db) { await setDoc(doc(db, 'metricDefinitions', def.id), def); } }
  async updateMetricDefinition(def: MetricDefinition): Promise<void> { this.metricDefinitions.update(current => current.map(d => d.id === def.id ? def : d)); this.saveLocal('erp_metricDefinitions', this.metricDefinitions()); if (this.connectionStatus() === 'connected' && db) { await setDoc(doc(db, 'metricDefinitions', def.id), def); } }
  async deleteMetricDefinition(id: string): Promise<void> { this.metricDefinitions.update(current => current.filter(d => d.id !== id)); this.saveLocal('erp_metricDefinitions', this.metricDefinitions()); if (this.connectionStatus() === 'connected' && db) { await deleteDoc(doc(db, 'metricDefinitions', id)); } }
  
  async addNote(note: Note): Promise<void> { this.notes.update(current => [note, ...current]); this.saveLocal('erp_notes', this.notes()); if (this.connectionStatus() === 'connected' && db) { await setDoc(doc(db, 'notes', note.id), note); } }
  async updateNote(note: Note): Promise<void> { this.notes.update(current => current.map(n => n.id === note.id ? note : n)); this.saveLocal('erp_notes', this.notes()); if (this.connectionStatus() === 'connected' && db) { await setDoc(doc(db, 'notes', note.id), note); } }
  async deleteNote(id: string): Promise<void> { this.notes.update(current => current.filter(n => n.id !== id)); this.saveLocal('erp_notes', this.notes()); if (this.connectionStatus() === 'connected' && db) { await deleteDoc(doc(db, 'notes', id)); } }
  
  async addPricingCalculation(calc: PricingCalculation): Promise<void> { this.pricingCalculations.update(current => [calc, ...current]); this.saveLocal('erp_pricing_calculations', this.pricingCalculations()); if (this.connectionStatus() === 'connected' && db) { await setDoc(doc(db, 'pricingCalculations', calc.id), calc); } }
  async updatePricingCalculation(calc: PricingCalculation): Promise<void> { this.pricingCalculations.update(current => current.map(c => c.id === calc.id ? calc : c)); this.saveLocal('erp_pricing_calculations', this.pricingCalculations()); if (this.connectionStatus() === 'connected' && db) { await setDoc(doc(db, 'pricingCalculations', calc.id), calc); } }
  async deletePricingCalculation(id: string): Promise<void> { this.pricingCalculations.update(current => current.filter(c => c.id !== id)); this.saveLocal('erp_pricing_calculations', this.pricingCalculations()); if (this.connectionStatus() === 'connected' && db) { await deleteDoc(doc(db, 'pricingCalculations', id)); } }
  
  async addSpecDefinition(spec: SpecDefinition): Promise<void> { this.specDefinitions.update(current => [spec, ...current]); this.saveLocal('erp_spec_definitions', this.specDefinitions()); if (this.connectionStatus() === 'connected' && db) { await setDoc(doc(db, 'specDefinitions', spec.id), spec); } }
  async updateSpecDefinition(spec: SpecDefinition): Promise<void> { this.specDefinitions.update(current => current.map(s => s.id === spec.id ? spec : s)); this.saveLocal('erp_spec_definitions', this.specDefinitions()); if (this.connectionStatus() === 'connected' && db) { await setDoc(doc(db, 'specDefinitions', spec.id), spec); } }
  async deleteSpecDefinition(id: string): Promise<void> { this.specDefinitions.update(current => current.filter(s => s.id !== id)); this.saveLocal('erp_spec_definitions', this.specDefinitions()); if (this.connectionStatus() === 'connected' && db) { await deleteDoc(doc(db, 'specDefinitions', id)); } }

  async addSchema(schema: SchemaModel): Promise<void> {
    this.systemSchemas.update(current => [...current, schema]);
    this.saveLocal('erp_schemas', this.systemSchemas());
    if (this.connectionStatus() === 'connected' && db) { await setDoc(doc(db, 'schemas', schema.name), schema); }
  }

  async addAiUsageLog(log: AiUsageLog): Promise<void> {
    this.aiUsageLogs.update(logs => [log, ...logs]);
    this.saveLocal('erp_ai_usage', this.aiUsageLogs());
  }

  clearAiUsageLogs() {
      this.aiUsageLogs.set([]);
      this.saveLocal('erp_ai_usage', []);
  }

  updateChatHistory(history: ChatMessage[]) {
     this.chatHistory.set(history);
     this.saveLocal('erp_chat_history', history);
  }

  clearChatHistory() {
      this.chatHistory.set([]);
      this.saveLocal('erp_chat_history', []);
  }

  async loadDataFromFirebase() {
    if (!db) {
       if (initError) {
           this.errorMessage.set(initError);
       }
       return;
    }
    
    if (this.connectionStatus() !== 'connected') {
        this.connectionStatus.set('initializing');
    }
    
    try {
      const loadCollection = async (colName: string, signalSetter: any) => {
          try {
            const querySnapshot = await getDocs(collection(db, colName));
            const data = querySnapshot.docs.map(doc => doc.data());
            console.log(`[Firebase] Loaded ${data.length} items from ${colName}`);
            signalSetter.set(data);
          } catch (err) {
            console.warn(`Failed to load ${colName}`, err);
          }
      };

      const loadSettings = async () => {
          try {
              const docRef = doc(db, 'settings', 'general');
              const docSnap = await getDoc(docRef);
              if (docSnap.exists()) {
                  this.systemSettings.set({ ...this.systemSettings(), ...docSnap.data() as SystemSettings });
              }
          } catch (err) {
              console.warn('Failed to load settings', err);
          }
      };

      await Promise.all([
        loadCollection('products', this.products),
        loadCollection('suppliers', this.suppliers),
        loadCollection('customers', this.customers),
        loadCollection('orders', this.orders),
        loadCollection('purchaseOrders', this.purchaseOrders),
        loadCollection('shippingOrders', this.shippingOrders),
        loadCollection('employees', this.employees),
        loadCollection('roles', this.roles),
        loadCollection('companies', this.companies),
        loadCollection('brands', this.brands),
        loadCollection('shippingTemplates', this.shippingTemplates),
        loadCollection('communicationTemplates', this.communicationTemplates),
        loadCollection('exportTemplates', this.exportTemplates),
        loadCollection('metricDefinitions', this.metricDefinitions),
        loadCollection('notes', this.notes),
        loadCollection('invoices', this.invoices),
        loadCollection('pettyCash', this.pettyCashTransactions),
        loadCollection('pettyCashSubjects', this.pettyCashSubjects),
        loadCollection('tasks', this.tasks),
        loadCollection('mobilePages', this.mobilePages),
        loadCollection('pricingCalculations', this.pricingCalculations),
        loadCollection('specDefinitions', this.specDefinitions),
        loadCollection('schemas', this.systemSchemas), 
        loadSettings(), 
      ]);

      this.initializeSchemas();
      this.ensureSchemaIntegrity(); // Check schemas after cloud load

      this.sanitizeAllData();
      this.connectionStatus.set('connected');
      this.lastSyncTime.set(new Date());
    } catch (e: any) {
      console.error('Error loading data from Firebase:', e);
      
      if (e.code === 'permission-denied' || e.code === 'unavailable' || e.message.includes('Missing or insufficient permissions')) {
          console.warn('Firebase access failed. Falling back to Local Storage (Mock Mode).');
          this.connectionStatus.set('mock');
          this.errorMessage.set('雲端存取被拒或離線，已切換至本機模式。');
          this.loadDataFromStorage(); 
      } else {
          this.connectionStatus.set('error');
          this.errorMessage.set(e.message);
      }
    }
  }

  initializeDefaultMetrics() {
    const defaults: MetricDefinition[] = [
      { id: 'MET-001', fieldEn: 'monthlyRevenue', fieldTw: '本月營收', category: 'Finance', formula: 'Sum(Order.totalAmount) where Order.status != "取消" AND Order.orderDate in Current Month', logicDescription: '本月所有非取消訂單的總金額加總。', showOnDashboard: true, isLocked: true, lastUpdated: new Date().toISOString() },
      { id: 'MET-002', fieldEn: 'pendingOrderCount', fieldTw: '待處理訂單數', category: 'Order', formula: 'Count(Unique orderId) where Order.status == "處理中"', logicDescription: '目前狀態為「處理中」的訂單數量 (以訂單編號歸戶)。', showOnDashboard: true, isLocked: true, lastUpdated: new Date().toISOString() },
      { id: 'MET-003', fieldEn: 'shippingOrderCount', fieldTw: '部份出貨訂單', category: 'Order', formula: 'Count(Unique orderId) where Order.status == "部份出貨"', logicDescription: '目前狀態為「部份出貨」的訂單數量。', showOnDashboard: true, isLocked: true, lastUpdated: new Date().toISOString() },
      { id: 'MET-004', fieldEn: 'oemOutstanding', fieldTw: '代工未完數 (OEM Outstanding)', category: 'Manufacturing', formula: 'PROGRAMMATIC_OEM_CALC', logicDescription: '統計所有代工訂單 (isManufacturingOrder=true) 且商品分類為「代工」的未完成數量總和 (outstandingManufacturingQty)。系統程式自動運算。', showOnDashboard: true, isLocked: true, lastUpdated: new Date().toISOString() },
      { id: 'MET-005', fieldEn: 'outOfStockCount', fieldTw: '缺貨商品數', category: 'Inventory', formula: 'Count(Product) where Product.stock <= 0', logicDescription: '庫存量小於或等於 0 的商品總數。', showOnDashboard: true, isLocked: true, lastUpdated: new Date().toISOString() },
      { id: 'MET-006', fieldEn: 'activePurchaseCount', fieldTw: '進行中採購單', category: 'PurchaseOrder', formula: 'Count(Unique poNumber) where PurchaseOrder.status != "已結案" AND PurchaseOrder.status != "取消"', logicDescription: '所有尚未結案且未取消的採購單數量。', showOnDashboard: true, isLocked: true, lastUpdated: new Date().toISOString() },
      { id: 'MET-007', fieldEn: 'manufacturingActiveCount', fieldTw: '進行中代工單', category: 'Manufacturing', formula: 'Count(Unique orderId) where Order.isManufacturingOrder == true AND Order.status != "已結案" AND Order.status != "取消"', logicDescription: '所有尚未結案的代工訂單數量。', showOnDashboard: true, isLocked: true, lastUpdated: new Date().toISOString() },
      { id: 'MET-008', fieldEn: 'totalCustomerCount', fieldTw: '客戶總數', category: 'Customer', formula: 'Count(Customer)', logicDescription: '系統中建立的客戶總數。', showOnDashboard: true, isLocked: true, lastUpdated: new Date().toISOString() },
      { id: 'MET-009', fieldEn: 'totalProductCount', fieldTw: '商品總數', category: 'Product', formula: 'Count(Product)', logicDescription: '系統中建立的商品總數。', showOnDashboard: false, isLocked: true, lastUpdated: new Date().toISOString() },
      { id: 'MET-010', fieldEn: 'totalEmployeeCount', fieldTw: '員工總數', category: 'Employee', formula: 'Count(Employee) where Employee.status == "Active"', logicDescription: '目前在職(Active)的員工總數。', showOnDashboard: false, isLocked: true, lastUpdated: new Date().toISOString() },
      { id: 'MET-011', fieldEn: 'pettyCashBalanceMonth', fieldTw: '本月零用金結餘', category: 'Finance', formula: 'PROGRAMMATIC_PETTY_CASH_MONTH', logicDescription: '本月所有零用金收入減去支出後的餘額。', showOnDashboard: true, isLocked: true, lastUpdated: new Date().toISOString() }
    ];

    const currentDefs = this.metricDefinitions();
    const fixList = ['MET-002', 'MET-003', 'MET-004', 'MET-005', 'MET-006', 'MET-007', 'MET-011'];
    
    if (currentDefs.length === 0) {
         defaults.forEach(d => this.addMetricDefinition(d));
    } else {
         defaults.forEach(def => {
             if (fixList.includes(def.id)) {
                 this.updateMetricDefinition(def);
             } else {
                 const exists = currentDefs.find(c => c.id === def.id);
                 if (!exists) this.addMetricDefinition(def);
             }
         });
    }
  }
  
  async loadMockData() {
      // Mock data loading code omitted for brevity as it is unchanged from previous file.
      // Assuming existing implementation.
      const suppliers: Supplier[] = [
          { code: 'SUP-001', shortName: '春哥好物', fullName: '春哥好物有限公司', taxId: '12345678', jobTitle: '業務', phone: '02-12345678', mobile: '0912345678', lineId: 'spring', email: 'sales@spring.com', address: '台北市信義區', shipLogistics: '黑貓', paymentTerms: true, taxType: true, invoiceRule: true, website: '', supplierCategory: '食品' },
          { code: 'SUP-002', shortName: '包材王', fullName: '包材王股份有限公司', taxId: '87654321', jobTitle: '經理', phone: '04-87654321', mobile: '0987654321', lineId: 'packking', email: 'service@packking.com', address: '台中市西屯區', shipLogistics: '大榮', paymentTerms: false, taxType: true, invoiceRule: false, website: '', supplierCategory: '包材' },
          { code: 'SUP-003', shortName: '果農小陳', fullName: '小陳果園', taxId: '', jobTitle: '老闆', phone: '07-11223344', mobile: '0911223344', lineId: 'chen_fruit', email: '', address: '高雄市旗山區', shipLogistics: '宅配通', paymentTerms: true, taxType: false, invoiceRule: false, website: '', supplierCategory: '鮮果' }
      ];
      
      const products: Product[] = [
          { id: 'P-001', name: '愛文芒果乾 150g', stock: 50, safetyStock: 20, allocatedStock: 5, externalStock: 0, transitQuantity: 0, totalPickingQuantity: 5, qualityConfirmed: 50, category: '水果乾', unit: '包', priceBeforeTax: 150, priceAfterTax: 158, costBeforeTax: 90, costAfterTax: 95, recommendedPrice: 106, supplierCode: 'SUP-001', supplierName: '春哥好物', controlStatus: false, purchasingStatus: true, moq: 10, packageType: 50, isDiscontinued: false, isCalculable: true, origin: '台灣', sugar: true, shelfLife: '12個月', expiryNote: '', highlightNote: '', notes: '', imageUrl: 'https://picsum.photos/200?random=1', lastUpdated: new Date().toISOString() },
          { id: 'P-002', name: '無糖鳳梨乾 100g', stock: 15, safetyStock: 30, allocatedStock: 0, externalStock: 0, transitQuantity: 20, totalPickingQuantity: 0, qualityConfirmed: 15, category: '水果乾', unit: '包', priceBeforeTax: 120, priceAfterTax: 126, costBeforeTax: 70, costAfterTax: 74, recommendedPrice: 82, supplierCode: 'SUP-001', supplierName: '春哥好物', controlStatus: true, purchasingStatus: true, moq: 10, packageType: 50, isDiscontinued: false, isCalculable: true, origin: '台灣', sugar: false, shelfLife: '12個月', expiryNote: '', highlightNote: '', notes: '', imageUrl: 'https://picsum.photos/200?random=2', lastUpdated: new Date().toISOString() },
          { id: 'P-003', name: '綜合堅果隨手包', stock: 200, safetyStock: 50, allocatedStock: 0, externalStock: 0, transitQuantity: 0, totalPickingQuantity: 0, qualityConfirmed: 200, category: '堅果', unit: '包', priceBeforeTax: 45, priceAfterTax: 47, costBeforeTax: 25, costAfterTax: 26, recommendedPrice: 29, supplierCode: 'SUP-002', supplierName: '包材王', controlStatus: false, purchasingStatus: true, moq: 100, packageType: 100, isDiscontinued: false, isCalculable: true, origin: '越南', sugar: false, shelfLife: '18個月', expiryNote: '', highlightNote: '', notes: '', imageUrl: 'https://picsum.photos/200?random=3', lastUpdated: new Date().toISOString() },
          { id: 'P-004', name: '鋁箔夾鏈袋 (大)', stock: 5000, safetyStock: 1000, allocatedStock: 0, externalStock: 0, transitQuantity: 0, totalPickingQuantity: 0, qualityConfirmed: 5000, category: '包材', unit: '個', priceBeforeTax: 5, priceAfterTax: 5.25, costBeforeTax: 2, costAfterTax: 2.1, recommendedPrice: 2, supplierCode: 'SUP-002', supplierName: '包材王', controlStatus: false, purchasingStatus: true, moq: 1000, packageType: 100, isDiscontinued: false, isCalculable: true, origin: '中國', sugar: false, shelfLife: '', expiryNote: '', highlightNote: '', notes: '', imageUrl: 'https://picsum.photos/200?random=4', lastUpdated: new Date().toISOString() },
          { id: 'P-005', name: '鮮採芭樂 (代工)', stock: 0, safetyStock: 0, allocatedStock: 0, externalStock: 0, transitQuantity: 0, totalPickingQuantity: 0, qualityConfirmed: 0, category: '代工', unit: '斤', priceBeforeTax: 40, priceAfterTax: 42, costBeforeTax: 20, costAfterTax: 21, recommendedPrice: 23, supplierCode: 'SUP-003', supplierName: '小陳果園', controlStatus: false, purchasingStatus: true, moq: 50, packageType: 1, isDiscontinued: false, isCalculable: true, origin: '台灣', sugar: false, shelfLife: '7天', expiryNote: '', highlightNote: '', notes: '', imageUrl: 'https://picsum.photos/200?random=5', lastUpdated: new Date().toISOString() }
      ];
      const customers: Customer[] = [
          { id: 'CUST-001', shortName: '好味商店', fullName: '好味食品行', taxId: '11223344', salesperson: '王小明', level: 'VIP', phone: '02-87654321', mobile: '0987654321', lineId: 'tasty_shop', email: 'boss@tasty.com', jobTitle: '店長', address1: '台北市大安區', receiver1: '陳店長', phone1: '0987654321', address2: '', receiver2: '', phone2: '', clientPaymentTerms: '月結30天', taxType: true, isStopTrading: false, needsDeliveryNotification: true, firstTradeDate: '2023-01-01', specialRequests: '週一不收貨', expectedProducts: '愛文芒果乾 150g', consignedPackagingUrl: '' },
          { id: 'CUST-002', shortName: '健康生活', fullName: '健康生活有限公司', taxId: '55667788', salesperson: '李小華', level: 'A級', phone: '04-23456789', mobile: '0923456789', lineId: 'healthylife', email: 'contact@healthy.com', jobTitle: '採購', address1: '台中市北區', receiver1: '林小姐', phone1: '0923456789', address2: '', receiver2: '', phone2: '', clientPaymentTerms: '貨到付款', taxType: true, isStopTrading: false, needsDeliveryNotification: false, firstTradeDate: '2023-06-15', specialRequests: '', expectedProducts: '', consignedPackagingUrl: '' }
      ];
      const employees: Employee[] = [
          { id: 'EMP-001', name: '王小明', email: 'ming@erp.com', phone: '0912345678', department: '業務部', jobTitle: '業務經理', roleId: 'ROLE-001', roleName: '管理員', status: 'Active', joinDate: '2023-01-01', avatarUrl: 'https://ui-avatars.com/api/?name=Ming', account: 'admin', password: '123' },
          { id: 'EMP-002', name: '李小華', email: 'hua@erp.com', phone: '0987654321', department: '採購部', jobTitle: '採購專員', roleId: 'ROLE-002', roleName: '一般人員', status: 'Active', joinDate: '2023-02-01', avatarUrl: 'https://ui-avatars.com/api/?name=Hua', account: 'buy', password: '123' }
      ];
      const orders: Order[] = [
          { orderId: 'ORD-20240501-001-01', productId: 'P-001', quantity: 50, shippedQuantity: 50, pickingQuantity: 0, manufacturedQuantity: 0, packingQuantity: 50, orderDate: '2024-05-01', status: '已結案', customerId: 'CUST-001', customerName: '好味商店', salesperson: '王小明', productName: '愛文芒果乾 150g', productNote: '', priceBeforeTax: 150, subtotal: 7500, taxAmount: 375, totalAmount: 7875, shipLogistics: '黑貓', shippingId: '90012345678', trackingUrl: '', invoiceNumber: 'AB12345678', orderTaxType: true, paymentStatus: true, receiverName: '陳店長', receiverPhone: '0987654321', receiverAddress: '台北市大安區', specialRequests: '', sellerName: '公司大平台', manufacturingStatus: '已完成', estimatedCompletionDate: '', requestedShippingDate: '2024-05-02', manufacturingPriority: false, isManufacturingOrder: false, isSampleOrder: false, closedAt: '2024-05-03' },
          { orderId: 'ORD-20240515-002-01', productId: 'P-002', quantity: 100, shippedQuantity: 0, pickingQuantity: 0, manufacturedQuantity: 0, packingQuantity: 0, orderDate: '2024-05-15', status: '處理中', customerId: 'CUST-002', customerName: '健康生活', salesperson: '李小華', productName: '無糖鳳梨乾 100g', productNote: '效期需最新', priceBeforeTax: 120, subtotal: 12000, taxAmount: 600, totalAmount: 12600, shipLogistics: '大榮', shippingId: '', trackingUrl: '', invoiceNumber: '', orderTaxType: true, paymentStatus: false, receiverName: '林小姐', receiverPhone: '0923456789', receiverAddress: '台中市北區', specialRequests: '', sellerName: '公司大平台', manufacturingStatus: '備料中', estimatedCompletionDate: '', requestedShippingDate: '2024-05-20', manufacturingPriority: true, isManufacturingOrder: false, isSampleOrder: false }
      ];
      const purchaseOrders: PurchaseOrder[] = [
          { purchaseId: 'PO-20240510-001-01', poNumber: 'PO-20240510-001', productId: 'P-002', quantity: 200, receivedQuantity: 0, purchaseDate: '2024-05-10', status: '廠商確認', supplierCode: 'SUP-001', supplierName: '春哥好物', purchaser: '李小華', expectedShippingDate: '2024-05-18', expectedDeliveryDate: '2024-05-19', purchaseNote: '急件', isOrdered: true, invoiceStatus: false }
      ];
      const companies: CompanyProfile[] = [
          { id: 'COMP-001', name: '公司大平台股份有限公司', shortName: '公司大平台', taxId: '12345678', owner: '張大帥', phone: '02-22334455', fax: '02-22334466', email: 'service@company.com', address: '台北市信義區', website: 'www.company.com', bankName: '玉山銀行', bankBranch: '信義分行', bankAccount: '1234567890123', bankAccountName: '公司大平台股份有限公司', logoUrl: 'https://ui-avatars.com/api/?name=Comp&background=0D8ABC&color=fff', description: '專業食品進出口貿易商' }
      ];

      this.suppliers.set(suppliers);
      this.products.set(products);
      this.customers.set(customers);
      this.employees.set(employees);
      this.orders.set(orders);
      this.purchaseOrders.set(purchaseOrders);
      this.companies.set(companies);
      
      this.saveLocal('erp_suppliers', suppliers);
      this.saveLocal('erp_products', products);
      this.saveLocal('erp_customers', customers);
      this.saveLocal('erp_employees', employees);
      this.saveLocal('erp_orders', orders);
      this.saveLocal('erp_purchaseOrders', purchaseOrders);
      this.saveLocal('erp_companies', companies);
      
      this.initializeDefaultMetrics();
      this.initializeSchemas(); 
      
      this.sanitizeAllData();

      if (this.connectionStatus() === 'connected' && db) {
          console.log('Syncing Mock Data to Firebase...');
          try {
              const batchPromises = [
                  ...suppliers.map(s => setDoc(doc(db, 'suppliers', s.code), s)),
                  ...products.map(p => setDoc(doc(db, 'products', p.id), p)),
                  ...customers.map(c => setDoc(doc(db, 'customers', c.id), c)),
                  ...employees.map(e => setDoc(doc(db, 'employees', e.id), e)),
                  ...orders.map(o => setDoc(doc(db, 'orders', o.orderId), o)),
                  ...purchaseOrders.map(p => setDoc(doc(db, 'purchaseOrders', p.purchaseId), p)),
                  ...companies.map(c => setDoc(doc(db, 'companies', c.id), c)),
                  ...this.DEFAULT_SCHEMAS.map(s => setDoc(doc(db, 'schemas', s.name), s)),
                  setDoc(doc(db, 'settings', 'general'), this.systemSettings())
              ];
              await Promise.all(batchPromises);
              console.log('Mock Data synced to Cloud successfully');
          } catch(err) {
              console.error('Failed to sync mock data to cloud', err);
              throw err; 
          }
      }

      console.log('Mock Data Loaded Locally');
      this.lastSyncTime.set(new Date());
  }
  
  getAllDataAsJson(): string {
     const data = {
         products: this.products(),
         suppliers: this.suppliers(),
         customers: this.customers(),
         orders: this.orders(),
         purchaseOrders: this.purchaseOrders(),
         shippingOrders: this.shippingOrders(),
         employees: this.employees(),
         roles: this.roles(),
         companies: this.companies(),
         brands: this.brands(),
         shippingTemplates: this.shippingTemplates(),
         communicationTemplates: this.communicationTemplates(),
         exportTemplates: this.exportTemplates(),
         metricDefinitions: this.metricDefinitions(),
         notes: this.notes(),
         invoices: this.invoices(),
         pettyCash: this.pettyCashTransactions(),
         pettyCashSubjects: this.pettyCashSubjects(),
         tasks: this.tasks(),
         mobilePages: this.mobilePages(),
         pricingCalculations: this.pricingCalculations(),
         customSpecNames: this.customSpecNames(),
         specDefinitions: this.specDefinitions(),
         aiUsageLogs: this.aiUsageLogs(),
         schemas: this.systemSchemas() // Added
     };
     return JSON.stringify(data, null, 2);
  }
  

  async syncCloudToLocal() {
      if (!db) throw new Error('Firebase 未初始化');
      await this.loadDataFromFirebase();
      this.saveAllToLocal();
  }

  private saveAllToLocal() {
      this.saveLocal('erp_products', this.products());
      this.saveLocal('erp_suppliers', this.suppliers());
      this.saveLocal('erp_customers', this.customers());
      this.saveLocal('erp_orders', this.orders());
      this.saveLocal('erp_purchaseOrders', this.purchaseOrders());
      this.saveLocal('erp_shippingOrders', this.shippingOrders());
      this.saveLocal('erp_employees', this.employees());
      this.saveLocal('erp_roles', this.roles());
      this.saveLocal('erp_companies', this.companies());
      this.saveLocal('erp_brands', this.brands());
      this.saveLocal('erp_shippingTemplates', this.shippingTemplates());
      this.saveLocal('erp_communicationTemplates', this.communicationTemplates());
      this.saveLocal('erp_exportTemplates', this.exportTemplates());
      this.saveLocal('erp_metricDefinitions', this.metricDefinitions());
      this.saveLocal('erp_notes', this.notes());
      this.saveLocal('erp_invoices', this.invoices());
      this.saveLocal('erp_petty_cash', this.pettyCashTransactions());
      this.saveLocal('erp_petty_cash_subjects', this.pettyCashSubjects());
      this.saveLocal('erp_tasks', this.tasks());
      this.saveLocal('erp_mobilePages', this.mobilePages());
      this.saveLocal('erp_pricing_calculations', this.pricingCalculations());
      this.saveLocal('erp_custom_spec_names', this.customSpecNames());
      this.saveLocal('erp_spec_definitions', this.specDefinitions());
      this.saveLocal('erp_ai_usage', this.aiUsageLogs());
      this.saveLocal('erp_schemas', this.systemSchemas());
  }

  async restoreFullBackup(data: any) {
      if (!data) return;
      if (data.products) this.products.set(data.products);
      if (data.suppliers) this.suppliers.set(data.suppliers);
      if (data.customers) this.customers.set(data.customers);
      if (data.orders) this.orders.set(data.orders);
      if (data.purchaseOrders) this.purchaseOrders.set(data.purchaseOrders);
      if (data.shippingOrders) this.shippingOrders.set(data.shippingOrders);
      if (data.employees) this.employees.set(data.employees);
      if (data.roles) this.roles.set(data.roles);
      if (data.companies) this.companies.set(data.companies);
      if (data.brands) this.brands.set(data.brands);
      if (data.shippingTemplates) this.shippingTemplates.set(data.shippingTemplates);
      if (data.communicationTemplates) this.communicationTemplates.set(data.communicationTemplates);
      if (data.exportTemplates) this.exportTemplates.set(data.exportTemplates);
      if (data.metricDefinitions) this.metricDefinitions.set(data.metricDefinitions);
      if (data.notes) this.notes.set(data.notes);
      if (data.invoices) this.invoices.set(data.invoices);
      if (data.pettyCash) this.pettyCashTransactions.set(data.pettyCash);
      if (data.pettyCashSubjects) this.pettyCashSubjects.set(data.pettyCashSubjects);
      if (data.tasks) this.tasks.set(data.tasks);
      if (data.mobilePages) this.mobilePages.set(data.mobilePages);
      if (data.pricingCalculations) this.pricingCalculations.set(data.pricingCalculations);
      if (data.customSpecNames) this.customSpecNames.set(data.customSpecNames);
      if (data.specDefinitions) this.specDefinitions.set(data.specDefinitions);
      if (data.aiUsageLogs) this.aiUsageLogs.set(data.aiUsageLogs);
      if (data.schemas) this.systemSchemas.set(data.schemas);
      
      this.saveAllToLocal();
  }

  // --- Google Drive URL Conversion ---
  private sanitizeAllData() {
    this.products().forEach(p => this.sanitizeImageUrls(p));
    this.companies().forEach(c => this.sanitizeImageUrls(c));
    this.brands().forEach(b => this.sanitizeImageUrls(b));
    this.employees().forEach(e => this.sanitizeImageUrls(e));
    this.shippingTemplates().forEach(t => this.sanitizeImageUrls(t));
    this.tasks().forEach(t => this.sanitizeImageUrls(t));
    this.chatHistory().forEach(m => this.sanitizeImageUrls(m));
  }

  private sanitizeImageUrls(obj: any): any {
    const fields = ['imageUrl', 'nutritionLabelUrl', 'logoUrl', 'avatarUrl', 'image'];
    fields.forEach(field => {
      if (obj[field] && typeof obj[field] === 'string') {
        obj[field] = this.convertGoogleDriveUrl(obj[field]);
      }
    });
    return obj;
  }

  private convertGoogleDriveUrl(url: string | undefined): string {
    if (!url) return '';
    
    // Check if it's a Google Drive link
    if (url.includes('drive.google.com')) {
      let fileId = '';
      
      // Pattern 1: /file/d/FILE_ID/view
      const fileDMatch = url.match(/\/file\/d\/([a-zA-Z0-9_-]+)/);
      if (fileDMatch && fileDMatch[1]) {
        fileId = fileDMatch[1];
      } else {
        // Pattern 2: ?id=FILE_ID or &id=FILE_ID
        const idMatch = url.match(/[?&]id=([a-zA-Z0-9_-]+)/);
        if (idMatch && idMatch[1]) {
          fileId = idMatch[1];
        }
      }
      
      if (fileId) {
        // Use lh3.googleusercontent.com/d/ format which is more reliable for <img> tags
        return `https://lh3.googleusercontent.com/d/${fileId}`;
      }
    }
    
    return url;
  }
}
