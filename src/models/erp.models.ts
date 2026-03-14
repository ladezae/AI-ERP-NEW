
// ─── 通路管理 ────────────────────────────────────────────────────────────────

export type ChannelType = 'wholesale' | 'retail' | 'other';

export interface Channel {
  id: string;                        // 通路唯一識別碼 e.g. 'yiji'
  name: string;                      // 通路名稱 e.g. '一吉水果乾批發零售'
  types: ChannelType[];              // 可複選：批發、零售、其他
  websiteUrl: string;                // 前台網址
  productCollection: string;         // Firebase collection e.g. 'yiji_products'
  orderCollection: string;           // Firebase collection e.g. 'yiji_orders'
  inventoryCollection: string;       // Firebase collection e.g. 'yiji_inventory'
  description?: string;              // 通路說明
  logoUrl?: string;                  // 通路 Logo
  visible: boolean;                  // 是否啟用
  createdAt: string;
  updatedAt: string;
}

export interface ChannelProduct {
  id: string;                        // 同 ERP productId
  productRef: string;                // 指向 ERP products/ 的 ID
  channelId: string;                 // 所屬通路
  // 通路專屬欄位
  imageUrl: string;                  // 通路專屬圖片（初始空白）
  images?: string[];                 // 多張圖片
  description: string;               // 通路專屬文案（初始空白）
  price: number;                     // 通路定價
  visible: boolean;                  // 是否上架
  // 從 ERP 複製過來的基本資料（快照）
  name: string;
  category: string;
  origin: string;
  unit: string;
  moq: number;
  sugar: boolean;
  shelfLife: string;
  highlightNote: string;
  expiryNote: string;
  nutritionLabelUrl?: string;
  isDiscontinued: boolean;
  // 管理欄位
  syncedAt: string;                  // 最後從 ERP 同步的時間
  createdAt: string;
}

export interface ChannelInventory {
  productId: string;
  channelId: string;
  allocated: number;                 // 分配給此通路的庫存數量
  sold: number;                      // 已賣出數量
  pending: number;                   // 待出貨數量
  updatedAt: string;
}

export interface ChannelOrderSummary {
  channelId: string;
  channelName: string;
  totalOrders: number;
  pendingOrders: number;
  shippedOrders: number;
  totalRevenue: number;
  updatedAt: string;
}

// ─────────────────────────────────────────────────────────────────────────────

export interface Product {
  id: string;
  keyProduct?: 'A' | 'B' | 'C' | ''; // Added: 重點商品分級
  name: string;
  stock: number;
  safetyStock: number;
  allocatedStock: number;
  externalStock: number;
  transitQuantity: number; // Added: 在途商品數量
  totalPickingQuantity: number; // Added: 訂單備貨總量 (Database Level)
  qualityConfirmed: number; // Changed: 已挑揀數量 (Numeric)
  category: string;
  unit: string;
  priceBeforeTax: number;
  priceAfterTax: number;
  costBeforeTax: number;
  costAfterTax: number;
  recommendedPrice: number; // Added: 建議售價 (costAfterTax / 0.9)
  supplierCode: string;
  supplierName: string;
  controlStatus: boolean; // Changed: true=控貨中, false=正常
  purchasingStatus: boolean; // Changed: true=採購中, false=停止採購
  moq: number;
  packageType: number;
  isDiscontinued: boolean; // true=停售, false=正常銷售
  isCalculable: boolean; // Added: 應計算商品 (true=應計算, false=不計算/費用/折讓)
  origin: string;
  sugar: boolean; // Changed: true=有糖, false=無糖
  shelfLife: string;
  expiryNote: string;
  highlightNote: string;
  productFeatures?: string; // Added: 商品特色
  notes: string;
  imageUrl: string;
  nutritionLabelUrl?: string; // Added: 營養標示圖片 URL
  serviceStatus?: '正常供貨' | '缺貨等復供' | '滿箱代訂' | '限量配貨' | '付款順序供貨' | ''; // Added: 服務狀態
  stockUpdatedAt?: string;
  stockUpdateSource?: 'S' | 'M';
  lastUpdated: string;
  // 通路管理
  channelRefs?: string[];            // 已上架到哪些通路 e.g. ['yiji', 'retail_site']
}

export interface Order {
  orderId: string;
  productId: string;
  unit?: string; // Added: 訂購單位 (Snapshot from Product)
  quantity: number; // 確認訂購數量 (Confirmed/Billable Qty)
  quantityForOrder?: number; // 訂單需求統計量 (Statistical Demand Qty) - 用於計算總需求
  shippedQuantity: number;
  pickingQuantity: number; // 訂單備貨量 (Allocated/Reserved Stock) - 已從庫存撥出鎖定的數量
  manufacturedQuantity: number;
  outstandingManufacturingQty?: number; // Added: 未完成代工數量 (quantity - manufacturedQuantity)
  outstandingQuantity?: number; // Added: 未出貨數量 (quantity - shippedQuantity)
  packingQuantity: number;
  orderDate: string;
  status: string;
  customerId: string;
  customerName: string;
  salesperson: string;
  productName: string;
  productNote: string;
  priceBeforeTax: number;
  subtotal: number;
  orderSubtotal: number;
  taxAmount: number;
  totalAmount: number;
  codAmount?: number; // Added: 到付金額 (Cash on Delivery Amount)
  shipLogistics: string; // Changed: Renamed from logistics
  shippingId: string;
  trackingUrl: string;
  invoiceNumber: string;
  orderTaxType: boolean; // Changed: Renamed from ordertaxType, true=應稅, false=免稅
  paymentStatus: boolean; // Changed: true=已付款, false=未付款
  paymentTerms?: string; // Added: 付款條件 (Snapshot from Customer)
  paymentDueDate?: string; // Added: 約定貨款日 (ISO Date String YYYY-MM-DD)
  receiverName: string;
  receiverPhone: string;
  receiverAddress: string;
  // New: Receiver 2 Fields
  receiverName2?: string;
  receiverPhone2?: string;
  receiverAddress2?: string;
  
  specialRequests: string;
  sellerName: string;
  brandName?: string; // Added: 品牌名稱 (nameTw)
  manufacturingStatus: string;
  estimatedCompletionDate: string;
  requestedShippingDate: string;
  manufacturingPriority: boolean; // Changed: true=優先, false=標準
  isManufacturingOrder: boolean; // Added: true=代工單, false=批發單 (Default: false)
  isSampleOrder: boolean; // Added: true=樣品單, false=一般單 (Default: false)
  closedAt?: string; // Added: 結案時間 (ISO String)
}

export interface Customer {
  id: string;
  shortName: string;
  fullName: string;
  taxId: string;
  salesperson: string;
  level: string;
  phone: string;
  mobile: string;
  lineId: string;
  email: string;
  jobTitle: string;
  address1: string;
  receiver1: string;
  phone1: string;
  address2: string;
  receiver2: string;
  phone2: string;
  clientPaymentTerms: string; // Changed: '先匯款' | '貨到付款' | '帳期後付'
  taxType: boolean; // Changed: true=應稅, false=免稅
  isStopTrading: boolean; // Added: true=停止交易, false=正常交易 (Default: false)
  needsDeliveryNotification: boolean; // Added: true=需要通知, false=無 (Default: false)
  firstTradeDate: string;
  specialRequests: string;
  expectedProducts: string;
  consignedPackagingUrl: string;
}

export interface Supplier {
  code: string;
  shortName: string;
  fullName: string;
  taxId: string;
  jobTitle: string;
  phone: string;
  mobile: string;
  lineId: string;
  email: string;
  address: string;
  shipLogistics: string; // Range: '黑貓', '大榮', '宅配通', '新竹', '郵局', '自取', '自派黑貓'
  paymentTerms: boolean; // Changed: true=先匯款, false=後付
  taxType: boolean; // true=應稅, false=免稅
  invoiceRule: boolean; // true=隨貨, false=另寄
  website: string;
  supplierCategory?: string; // Added: 供應商類別
  freeShippingThreshold?: number; // Added: 免運數量 (採購數量 >= 此值時免運)
}

export interface PurchaseOrder {
  purchaseId: string; // Unique Record ID (e.g. PO-001-P01)
  poNumber?: string;  // Logical PO Number (e.g. PO-001) for grouping
  productId: string;
  quantity: number;
  receivedQuantity: number;
  purchaseDate: string;
  status: string;
  supplierCode: string;
  supplierName: string;
  purchaser: string;
  expectedShippingDate: string;
  expectedDeliveryDate: string;
  purchaseNote: string;
  isOrdered: boolean;
  shipLogistics?: string; // Renamed from logistics
  // New Field: Database level delivery status
  deliveryStatus?: '尚未到貨' | '部份到貨' | '全部到貨';
  // Modified Field: Invoice Management (Boolean)
  invoiceStatus: boolean; // true = 已收到, false = 未收到
  purchaseAuth?: 'AI 生成' | '員工確認' | '主管授權' | '主管審核'; // Added: 採購單授權
}

// New Interface: Shipping Order (出貨單)
export interface ShippingOrder {
  id: string; // Unique ID for this shipment record
  orderId: string; // Linked Order ID (Line Item or Group ID)
  customerName: string;
  productName: string;
  shippingQuantity: number; // Renamed: 本次出貨數量 (Was: quantity)
  actualShippingDate: string; // 實際出貨日
  batchNo: string; // 出貨批次
  logistics: string; // STRICT: Only '黑貓' or '大榮'
  shipLogistics: string; // Deprecated: Kept for legacy support/migration
  shippingId: string; // Tracking Number
  trackingUrl: string;
  specialRequests: string; // 備註/特殊需求
  waybillImages?: string[]; // Changed: 支援多張物流單據圖片 (Base64 Array)
}

export interface CompanyProfile {
  id: string;
  name: string;
  shortName?: string; // Added: 公司簡稱
  taxId: string;
  owner: string;
  phone: string;
  fax: string;
  email: string;
  address: string;
  website: string;
  bankName: string;
  bankBranch: string;
  bankAccount: string;
  bankAccountName: string;
  logoUrl: string;
  description: string;
}

// New Interface: Brand (品牌管理)
export interface Brand {
  id: string;
  nameTw: string; // 品牌中文名
  nameEn: string; // 品牌英文名
  shortName?: string; // Added: 品牌簡稱
  websiteUrl: string; // 網址URL
  logoUrl: string; // 品牌LOGO(JPG/PNG)
}

export interface Employee {
  id: string;
  name: string;
  email: string;
  phone: string;
  department: string;
  jobTitle: string;
  roleId: string;
  roleName: string;
  status: 'Active' | 'Inactive';
  joinDate: string;
  avatarUrl: string;
  // Added for Authentication
  account?: string;
  password?: string;
}

export interface Permission {
  moduleId: string;
  moduleName: string;
  canRead: boolean;
  canWrite: boolean;
  canDelete: boolean;
}

export interface Role {
  id: string;
  name: string;
  description: string;
  permissions: Permission[];
}

export interface SystemSettings {
  taxRate: number; // e.g., 0.05 for 5%
  currency: string;
  defaultPaymentTerms: string;
  companyName: string;
  // Appearance
  theme: 'light' | 'medium' | 'dark'; // 淺色 | 中性(護眼) | 深色
  fontSizeLevel: 1 | 2 | 3 | 4 | 5 | 6 | 7; // 1 (Tiny) to 7 (Huge)
  
  // AI Pricing Config
  aiPricing?: {
      inputRate: number; // USD per 1M tokens
      outputRate: number; // USD per 1M tokens
  };

  // AI Quota Config
  aiMonthlyQuota?: number; // Total tokens allowed per month

  // Backup Config
  autoBackup?: boolean;
  autoBackupInterval?: number; // Minutes
}

// New Interface for OCR Templates
export interface ShippingTemplate {
  id: string;
  name: string;
  logistics: string; // Changed: Renamed from shipLogistics/logisticsProvider to match ShippingOrder
  imageUrl: string; // Base64 or URL of the sample image
  // Region of Interest (ROI) - stored as percentages (0-100)
  roi: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
  lastUpdated: string;
  trackingUrlPattern?: string; // URL template, e.g., "https://trace.com?no={{id}}"
}

// New Interface for Communication Templates
export interface CommunicationTemplate {
  id: string;
  name: string;
  type: 'purchase' | 'order'; // 採購通知 | 出貨通知
  logistics?: '黑貓' | '大榮' | '';  // 物流商綁定，空白=不限
  content: string;
  isSystemDefault?: boolean;
}

// --- Dynamic Print Template Models ---

export type SectionType = 
  | 'company_header'   // 公司資訊 + Logo (Header)
  | 'document_title'   // 單據標題與資訊 (Title, ID, Date)
  | 'customer_info'    // 客戶資料 (Bill To)
  | 'shipping_info'    // 出貨資料 (Ship To) - optional/merged
  | 'items_table'      // 商品明細與金額
  | 'amount_summary'   // 金額總計 (if separated from table)
  | 'custom_text'      // 自定義文字區塊 (條款、備註)
  | 'signatures'       // 簽核欄位
  | 'gap'              // 空白間隔
  | 'cod_amount';      // 代收金額 (COD)

export interface TemplateSection {
  id: string;
  type: SectionType;
  visible: boolean;
  title?: string; // Used for Section Headers or Custom Title
  content?: string; // For custom_text
  height?: number; // For gap (in mm or px)
  order: number; // Display order
}

export interface ExportTemplate {
  id: string;
  name: string;
  type: 'order' | 'purchase' | 'shipping'; // 適用單據類型
  sections: TemplateSection[];
  title: string; // Default Document Title (e.g. "出貨單")
  showPrice: boolean; // Global switch to show/hide prices
}

// --- Data Dictionary (Metric Definitions) ---
// UPDATED: Categories now align with System Schemas
export interface MetricDefinition {
  id: string;
  fieldEn: string;
  fieldTw: string;
  formula?: string; 
  logicDescription: string; 
  category: 'Finance' | 'Order' | 'Product' | 'Inventory' | 'PurchaseOrder' | 'ShippingOrder' | 'Manufacturing' | 'Customer' | 'Supplier' | 'Employee' | 'Other';
  showOnDashboard: boolean; // Added: Toggle for Dashboard Visibility
  isLocked: boolean; // Added: Database protection lock (True=ReadOnly, False=Editable)
  lastUpdated: string;
  referenceImageUrl?: string; // Added: 圖片輔助說明 (User uploaded reference for AI)
}

// --- NEW: Schema Definitions for Data Dictionary ---
export interface SchemaField {
  name: string;
  chineseName: string;
  type: string;
  description: string;
}

export interface SchemaModel {
  name: string;
  chineseName: string;
  description: string;
  fields: SchemaField[];
}

// --- AI Optimized Metrics (The "Fast Field") ---
export interface BusinessMetrics {
  revenue: {
    currentMonth: number;
    lastMonth: number;
    totalYear: number;
  };
  orders: {
    pendingCount: number; // 處理中
    shippingCount: number; // 部份出貨
    todayCount: number; // 今日新增
  };
  inventory: {
    lowStockCount: number;
    outOfStockCount: number;
    totalValue: number; // 庫存總成本
  };
  manufacturing: {
    activeOrders: number; // 進行中代工單
    delayedOrders: number; // 逾期
  };
  lastUpdated: string;
}

// --- Note Interface for Notebook Module ---
export type NoteStatus = 'draft' | 'validation' | 'completed';

export interface Note {
  id: string;
  title: string;
  content: string;
  status: NoteStatus;
  color?: string; // Optional color coding
  createdAt: string;
  updatedAt: string;
}

// --- Finance Invoice Model ---
export type InvoiceType = 'Input' | 'Output'; // 進項 | 銷項

export interface Invoice {
  id: string; // Internal ID
  type: InvoiceType;
  date: string; // 開立日期
  invoiceNumber: string; // 發票號碼 (字軌+8碼)
  taxId: string; // 對方統編
  companyName: string; // 對方公司名稱 (Customer or Supplier Name)
  salesAmount: number; // 銷售額 (未稅)
  taxAmount: number; // 稅額 (通常是 5%)
  totalAmount: number; // 總計
  formatCode: string; // 格式代碼 (e.g. 21, 25, 31, 35)
  note: string; // 備註
  linkedOrderId?: string; // 關聯單號 (Purchase ID or Order ID)
  ownerCompanyId?: string; // Added: 所屬主體公司 (Internal Company ID)
  createdDate: string; // 建立時間
  isRetention?: boolean; // Added: 留抵未報 (True=留抵, False=本期)
  isCopyReported?: boolean; // Added: 副本已報 (True=副本已報, False=正本已報)
  isCrossPeriod?: boolean; // Added: 跨期抵報 (True=跨期, False=N/A)
  costCategory?: string; // Added: 費用類別 (e.g. 油資/停車費)
  status: '成立' | '作廢'; // Added: 發票狀態
}

// --- Petty Cash Transaction ---
export interface PettyCashTransaction {
  id: string;
  date: string;
  type: 'Income' | 'Expense'; // 補款 | 請款
  amount: number;
  item: string; // 項目/科目
  note: string; // 備註
  handler: string; // 經手人
  createdAt: string;
}

// --- Petty Cash Subject (New) ---
export interface PettyCashSubject {
  id: string;
  name: string;
  type: 'Income' | 'Expense' | 'Both'; // 適用類型
}

// --- Chat History Model ---
export interface ChatMessage {
  sender: 'user' | 'ai';
  text: string;
  image?: string;
  timestamp: string;
}

// --- Task Center Model (New) ---
export type TaskType = 'Task' | 'Reminder' | 'Requirement'; // 任務 | 提醒 | 需求
export type TaskPriority = 'High' | 'Medium' | 'Low';
export type TaskStatus = 'Pending' | 'In Progress' | 'On Hold' | 'Completed' | 'Cancelled' | 'Archived';

export interface TaskComment {
  id: string;
  taskId: string;
  authorId: string;
  authorName: string;
  content: string;
  imageUrl?: string;
  timestamp: string;
}

export interface Task {
  id: string;
  title: string;
  type: TaskType;
  status: TaskStatus;
  priority: TaskPriority;
  description: string;
  creatorId: string;
  creatorName: string;
  assigneeId?: string;
  assigneeName?: string;
  createdAt: string;
  updatedAt: string;
  deadline?: string; // Added: 截止日期
  reminderDate?: string; // Added: 提醒時間
  comments: TaskComment[];
  isRead?: boolean; // Added: 是否已讀 (For assignee notifications)
  imageUrl?: string; // Added: 任務主圖 (for pasting in create modal)
}

// --- Mobile Layout Config Models ---
export interface MobileFieldConfig {
  key: string;
  label: string;
  type: 'text' | 'number' | 'date' | 'boolean' | 'select' | 'image';
  isEditable: boolean;
  isVisible: boolean;
  order: number;
}

export interface MobilePageConfig {
  id: string;
  name: string; // Layout name e.g. "快速採購"
  sourceModule: 'purchase' | 'order' | 'product';
  fields: MobileFieldConfig[];
  description?: string;
  icon?: string;
}

// --- Pricing Calculation Model ---
// Updated to support multiple Scenarios per Product
export interface PricingScenario {
  id: string; // Unique ID for this scenario config
  name: string; // e.g., "春哥好物蝦皮"
  
  // Package Spec for this scenario
  packageSpec: string; // e.g., "150g"
  adjustedWeight: number; // e.g. 150 (Manual override in 'fixed_price' mode, or calculated in 'fixed_weight' mode)
  
  // Cost Structure
  packingLaborCost: number; 
  packingMaterialCost: number; 
  boxCost: number; 
  
  // Strategy
  taxRate: number; // %
  platformCommissionRate: number; // %
  marketingAdRate: number; // % Added: 行銷廣告成本%
  
  // Target
  targetMarginRateA: number; // % (Target Margin)
  
  // Final Decision
  decidedPrice: number; 
  
  // NEW FIELDS 2024-05
  specName?: string; // 規格名稱 (例如: 大包/小包/家庭號)
  actualPrice?: number; // 實際售價 (Use this for final profit calculation if present)
  marketPrice?: number; // 市場價 (Reference only)

  // NEW FIELDS: Cost Breakdown (Persisted)
  rawMaterialCost?: number; // 原料成本
  taxCost?: number; // 稅務成本
  commissionCost?: number; // 抽成成本
  packingTotalCost?: number; // 總包裝成本

  // NEW: Calculation Mode
  calculationMode?: 'fixed_weight' | 'fixed_price'; // Default: 'fixed_price'
  
  // NEW: Suggested Max Weight (Result of Fixed Price calc)
  suggestedWeight?: number; 
}

// NEW: Spec Definition for reusable pricing presets
export interface SpecDefinition {
  id: string;
  specName: string;
  weight: number;
  targetPrice: number; // 目標售價
  marketPrice: number; // 市場參考價
  actualPrice: number; // 實際售價
}

export interface PricingCalculation {
  id: string; // Project ID
  productId: string; 
  productName: string; 
  updatedAt: string;

  // Shared / Global Product Settings
  lossRate: number; // %
  purchaseUnit: 600 | 1000; 
  
  // New: Cost Base Source Selection
  basePriceSource?: 'costBeforeTax' | 'costAfterTax' | 'priceBeforeTax' | 'priceAfterTax';

  // List of Scenarios
  scenarios: PricingScenario[];
  
  // New: Defined Specifications for this product
  specDefinitions?: SpecDefinition[];

  // --- NEW: Shopee Prices ---
  priceASingle?: number; // 獨享包 'SHOPEE Price single'
  priceBShare?: number;  // 分享包 'SHOPEE Price share'
  priceCM?: number;      // 中包 'SHOPEE Price M'
  priceDL?: number;      // 大包 'SHOPEE Price L'
  priceEXL?: number;     // 特大包 'SHOPEE Price XL'
  priceFParty?: number;  // 派對包 'SHOPEE Price Party'

  // Legacy fields (Optional, for migration support)
  packageSpec?: string;
  adjustedWeight?: number;
  packingLaborCost?: number;
  packingMaterialCost?: number;
  boxCost?: number;
  taxRate?: number;
  platformCommissionRate?: number;
  targetMarginRateA?: number;
  decidedPrice?: number;
}

// --- AI Usage Logging (New) ---
export interface AiUsageLog {
  id: string;
  timestamp: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  context: string; // e.g. "Chat", "Import", "OCR"
}

export type ViewType = 
  | 'dashboard' 
  | 'products' 
  | 'suppliers' 
  | 'customers' 
  | 'orders' 
  | 'manufacturing' 
  | 'shipping' 
  | 'purchases' 
  | 'employees' 
  | 'system' 
  | 'company' 
  | 'brand' 
  | 'import' 
  | 'ai-training' 
  | 'definitions' 
  | 'allocator' 
  | 'notebook' 
  | 'finance' 
  | 'tasks' 
  | 'mobile-layout' 
  | 'petty-cash' 
  | 'reports' 
  | 'price-calculator' 
  | 'standalone-mobile' 
  | 'external-portal'
  | 'mobile-quote'
  | 'channels';        // 通路管理中心
