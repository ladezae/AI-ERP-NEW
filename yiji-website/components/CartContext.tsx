'use client';

import { createContext, useContext, useState, useEffect, useCallback, ReactNode } from 'react';
import { CartItem, ChannelProduct as Product } from '@/lib/types';

// ─── Toast 通知系統 ──────────────────────────────────────────────────────
export interface ToastMessage {
  id: string;
  type: 'success' | 'info' | 'error';
  title: string;
  description?: string;
  productName?: string;
  action?: { label: string; href: string };
}

interface CartContextType {
  items: CartItem[];
  itemCount: number;
  totalAmount: number;
  addItem: (product: Product, quantity: number, type: 'sample' | 'order') => void;
  removeItem: (productId: string, type: 'sample' | 'order') => void;
  updateQuantity: (productId: string, type: 'sample' | 'order', quantity: number) => void;
  clearCart: () => void;
  // Toast 相關
  toasts: ToastMessage[];
  dismissToast: (id: string) => void;
}

const CartContext = createContext<CartContextType | undefined>(undefined);

const STORAGE_KEY = 'yiji_cart_items';

// 從 localStorage 讀取購物車
function loadCartFromStorage(): CartItem[] {
  if (typeof window === 'undefined') return [];
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (!stored) return [];
    const parsed = JSON.parse(stored);
    // 基本驗證
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (item: CartItem) => item.product && item.product.id && item.quantity > 0
    );
  } catch {
    return [];
  }
}

// 寫入 localStorage
function saveCartToStorage(items: CartItem[]) {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
  } catch {
    // 寫入失敗不阻止功能
  }
}

export function CartProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<CartItem[]>([]);
  const [toasts, setToasts] = useState<ToastMessage[]>([]);
  const [hydrated, setHydrated] = useState(false);

  // 初次載入從 localStorage 讀取
  useEffect(() => {
    const stored = loadCartFromStorage();
    if (stored.length > 0) {
      setItems(stored);
    }
    setHydrated(true);
  }, []);

  // items 變化時同步到 localStorage（跳過初始化前的空寫入）
  useEffect(() => {
    if (hydrated) {
      saveCartToStorage(items);
    }
  }, [items, hydrated]);

  const itemCount = items.reduce((sum, i) => sum + i.quantity, 0);
  const totalAmount = items.reduce((sum, i) => sum + i.product.price * i.quantity, 0);

  // Toast 管理
  const showToast = useCallback((toast: Omit<ToastMessage, 'id'>) => {
    const id = Date.now().toString(36) + Math.random().toString(36).slice(2);
    setToasts(prev => [...prev, { ...toast, id }]);
    // 自動消失
    setTimeout(() => {
      setToasts(prev => prev.filter(t => t.id !== id));
    }, 3500);
  }, []);

  const dismissToast = useCallback((id: string) => {
    setToasts(prev => prev.filter(t => t.id !== id));
  }, []);

  const addItem = useCallback((product: Product, quantity: number, type: 'sample' | 'order') => {
    setItems(prev => {
      const existing = prev.find(i => i.product.id === product.id && i.type === type);
      if (existing) {
        return prev.map(i =>
          i.product.id === product.id && i.type === type
            ? { ...i, quantity: i.quantity + quantity }
            : i
        );
      }
      return [...prev, { product, quantity, type }];
    });

    // 顯示 Toast
    showToast({
      type: 'success',
      title: type === 'sample' ? '已加入樣品購物車' : '已加入訂購車',
      productName: product.name,
      description: `${quantity} ${product.unit}`,
      action: { label: '前往結帳', href: '/checkout' },
    });
  }, [showToast]);

  const removeItem = useCallback((productId: string, type: 'sample' | 'order') => {
    setItems(prev => prev.filter(i => !(i.product.id === productId && i.type === type)));
  }, []);

  const updateQuantity = useCallback((productId: string, type: 'sample' | 'order', quantity: number) => {
    if (quantity <= 0) {
      removeItem(productId, type);
      return;
    }
    setItems(prev =>
      prev.map(i =>
        i.product.id === productId && i.type === type ? { ...i, quantity } : i
      )
    );
  }, [removeItem]);

  const clearCart = useCallback(() => {
    setItems([]);
  }, []);

  return (
    <CartContext.Provider value={{ items, itemCount, totalAmount, addItem, removeItem, updateQuantity, clearCart, toasts, dismissToast }}>
      {children}
    </CartContext.Provider>
  );
}

export function useCart() {
  const ctx = useContext(CartContext);
  if (!ctx) throw new Error('useCart must be used within CartProvider');
  return ctx;
}
