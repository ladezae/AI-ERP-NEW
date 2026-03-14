// ─── 通路商品（yiji_products collection）────────────────────────────────────
// 由 ERP 通路管理中心勾選匯入，非直接讀 ERP products/

export interface ChannelProduct {
  id: string;                   // 同 ERP productId
  productRef: string;           // 指向 ERP products/ 的 ID
  channelId: string;            // 所屬通路 e.g. 'yiji'
  // 通路專屬欄位
  imageUrl: string;             // 通路專屬圖片
  images?: string[];            // 多張圖片
  description: string;          // 通路專屬文案
  price: number;                // 通路定價（建議售價）
  visible: boolean;             // 是否上架
  // 從 ERP 複製的快照
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
  syncedAt: string;
  createdAt: string;
}

// 購物車商品
export interface CartItem {
  product: ChannelProduct;
  quantity: number;
  type: 'sample' | 'order';
}

// 訂單類型
export type OrderType = 'sample' | 'order';

// 訂單資料（寫入 yiji_orders）
export interface Order {
  id?: string;
  orderType: OrderType;
  items: CartItem[];
  customer: CustomerInfo;
  paymentMethod: 'ecpay' | 'cod';
  totalAmount: number;
  status: OrderStatus;
  createdAt: string;
  updatedAt: string;
  shippingStatus?: ShippingStatus;
  notes?: string;
  channelId: string;            // 固定為 'yiji'
}

export type OrderStatus = 'pending' | 'paid' | 'processing' | 'shipped' | 'delivered' | 'cancelled';
export type ShippingStatus = 'pending' | 'prepared' | 'shipped' | 'delivered';

// 客戶資料
export interface CustomerInfo {
  name: string;
  phone: string;
  email: string;
  address: string;
  company?: string;
  taxId?: string;
}
