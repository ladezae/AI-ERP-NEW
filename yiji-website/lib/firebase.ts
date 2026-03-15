import { initializeApp, getApps } from 'firebase/app';
import {
  getFirestore, collection, getDocs, doc, getDoc,
  query, where, addDoc, updateDoc, serverTimestamp
} from 'firebase/firestore';
import { ChannelProduct, Order } from './types';

const firebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
};

const app = getApps().length === 0 ? initializeApp(firebaseConfig) : getApps()[0];
export const db = getFirestore(app);

// 此官網專屬 collection（與 ERP 核心完全隔離）
const PRODUCT_COLLECTION = 'yiji_products';
const ORDER_COLLECTION   = 'yiji_orders';
const SALES_COLLECTION   = 'yiji_sales_summary';

// ─── 商品 ────────────────────────────────────────────────────────────────────

/**
 * 取得所有上架商品
 * 來源：yiji_products（由 ERP 通路管理中心勾選匯入）
 */
export async function getVisibleProducts(): Promise<ChannelProduct[]> {
  const q = query(
    collection(db, PRODUCT_COLLECTION),
    where('visible', '==', true),
    where('isDiscontinued', '==', false)
  );
  const snapshot = await getDocs(q);
  return snapshot.docs.map(d => ({ id: d.id, ...d.data() } as ChannelProduct));
}

/** 取得所有通路商品（後台，含未上架） */
export async function getAllChannelProducts(): Promise<ChannelProduct[]> {
  const snapshot = await getDocs(collection(db, PRODUCT_COLLECTION));
  return snapshot.docs.map(d => ({ id: d.id, ...d.data() } as ChannelProduct));
}

/** 取得單一商品 */
export async function getProduct(id: string): Promise<ChannelProduct | null> {
  const snap = await getDoc(doc(db, PRODUCT_COLLECTION, id));
  if (!snap.exists()) return null;
  return { id: snap.id, ...snap.data() } as ChannelProduct;
}

/** 更新商品上架狀態（後台） */
export async function updateProductVisibility(id: string, visible: boolean): Promise<void> {
  await updateDoc(doc(db, PRODUCT_COLLECTION, id), { visible });
}

// ─── 訂單 ────────────────────────────────────────────────────────────────────

/** 建立正式訂單（樣品不回寫） */
export async function createOrder(order: Omit<Order, 'id'>): Promise<string> {
  const ref = await addDoc(collection(db, ORDER_COLLECTION), {
    ...order,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
  return ref.id;
}

/** 更新訂單狀態（後台） */
export async function updateOrderStatus(
  orderId: string,
  status: string,
  shippingStatus?: string
): Promise<void> {
  await updateDoc(doc(db, ORDER_COLLECTION, orderId), {
    status,
    ...(shippingStatus ? { shippingStatus } : {}),
    updatedAt: serverTimestamp(),
  });
}

/** 取得所有訂單（後台） */
export async function getAllOrders(): Promise<Order[]> {
  const snapshot = await getDocs(collection(db, ORDER_COLLECTION));
  return snapshot.docs.map(d => ({ id: d.id, ...d.data() } as Order));
}

/**
 * 銷售數量回報 → yiji_sales_summary
 * ERP 端定期讀取此 collection 做庫存匯總
 * 完全不動 ERP 核心欄位
 */
export async function recordSales(
  items: { productId: string; quantity: number; orderId: string }[]
): Promise<void> {
  await Promise.all(
    items.map(item =>
      addDoc(collection(db, SALES_COLLECTION), {
        productId: item.productId,
        orderId: item.orderId,
        quantity: item.quantity,
        channelId: 'yiji',
        soldAt: serverTimestamp(),
      })
    )
  );
}
