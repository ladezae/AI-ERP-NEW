'use client';

import { createContext, useContext, useState, ReactNode } from 'react';
import { CartItem, ChannelProduct as Product } from '@/lib/types';

interface CartContextType {
  items: CartItem[];
  itemCount: number;
  totalAmount: number;
  addItem: (product: Product, quantity: number, type: 'sample' | 'order') => void;
  removeItem: (productId: string, type: 'sample' | 'order') => void;
  updateQuantity: (productId: string, type: 'sample' | 'order', quantity: number) => void;
  clearCart: () => void;
}

const CartContext = createContext<CartContextType | undefined>(undefined);

export function CartProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<CartItem[]>([]);

  const itemCount = items.reduce((sum, i) => sum + i.quantity, 0);
  const totalAmount = items.reduce((sum, i) => sum + i.product.price * i.quantity, 0);

  const addItem = (product: Product, quantity: number, type: 'sample' | 'order') => {
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
  };

  const removeItem = (productId: string, type: 'sample' | 'order') => {
    setItems(prev => prev.filter(i => !(i.product.id === productId && i.type === type)));
  };

  const updateQuantity = (productId: string, type: 'sample' | 'order', quantity: number) => {
    if (quantity <= 0) {
      removeItem(productId, type);
      return;
    }
    setItems(prev =>
      prev.map(i =>
        i.product.id === productId && i.type === type ? { ...i, quantity } : i
      )
    );
  };

  const clearCart = () => setItems([]);

  return (
    <CartContext.Provider value={{ items, itemCount, totalAmount, addItem, removeItem, updateQuantity, clearCart }}>
      {children}
    </CartContext.Provider>
  );
}

export function useCart() {
  const ctx = useContext(CartContext);
  if (!ctx) throw new Error('useCart must be used within CartProvider');
  return ctx;
}
