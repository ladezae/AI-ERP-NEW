'use client';

import { useState } from 'react';
import Link from 'next/link';
import { ChannelProduct as Product } from '@/lib/types';
import { useCart } from '@/components/CartContext';

export default function ProductDetailClient({ product }: { product: Product }) {
  const { addItem } = useCart();
  const [orderQty, setOrderQty] = useState(product.moq || 1);
  const [sampleQty, setSampleQty] = useState(1);
  const [addedType, setAddedType] = useState<'sample' | 'order' | null>(null);

  const handleAddToCart = (type: 'sample' | 'order') => {
    const qty = type === 'sample' ? sampleQty : orderQty;
    addItem(product, qty, type);
    setAddedType(type);
    setTimeout(() => setAddedType(null), 2000);
  };

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-10">
      {/* 麵包屑 */}
      <nav className="text-sm text-earth-500 mb-6">
        <Link href="/" className="hover:text-leaf-600">首頁</Link>
        <span className="mx-2">/</span>
        <Link href="/products" className="hover:text-leaf-600">商品目錄</Link>
        <span className="mx-2">/</span>
        <span className="text-earth-800">{product.name}</span>
      </nav>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-10 mb-16">
        {/* 左：商品圖片 */}
        <div className="space-y-4">
          <div className="rounded-2xl overflow-hidden bg-brand-50 aspect-square">
            <img
              src={product.imageUrl || '/placeholder.jpg'}
              alt={product.name}
              className="w-full h-full object-cover"
            />
          </div>
          {product.nutritionLabelUrl && (
            <div>
              <p className="text-sm text-earth-500 mb-2">📋 營養標示</p>
              <img src={product.nutritionLabelUrl} alt="營養標示" className="rounded-xl border border-brand-100 max-w-xs" />
            </div>
          )}
        </div>

        {/* 右：商品資訊 */}
        <div>
          {/* 分類 & 標籤 */}
          <div className="flex items-center gap-2 mb-3">
            <span className="badge bg-leaf-100 text-leaf-700">{product.category}</span>
            {!product.sugar && <span className="badge bg-brand-100 text-brand-700">無糖</span>}
            {product.origin && (
              <span className="badge bg-earth-100 text-earth-700">🌿 {product.origin}</span>
            )}
          </div>

          {/* 商品名稱 */}
          <h1 className="font-serif text-2xl md:text-3xl font-bold text-earth-800 mb-4">
            {product.name}
          </h1>

          {/* 重點說明 */}
          {product.highlightNote && (
            <div className="bg-leaf-50 border border-leaf-200 rounded-xl p-4 mb-6">
              <p className="text-sm text-leaf-700 leading-relaxed">✨ {product.highlightNote}</p>
            </div>
          )}

          {/* 批發參考價 */}
          <div className="bg-brand-50 rounded-xl p-5 mb-6">
            <p className="text-sm text-earth-500 mb-1">批發參考價（未稅）</p>
            <div className="flex items-end gap-2">
              <span className="text-3xl font-bold text-earth-800">
                NT$ {product.priceBeforeTax.toLocaleString()}
              </span>
              <span className="text-earth-500 mb-1">/ {product.unit}</span>
            </div>
            <p className="text-xs text-earth-400 mt-1">
              含稅建議售價：NT$ {product.price.toLocaleString()}
            </p>
          </div>

          {/* 規格資訊 */}
          <div className="grid grid-cols-2 gap-3 mb-6 text-sm">
            {product.shelfLife && (
              <div className="flex items-center gap-2 text-earth-600">
                <span>📅</span> <span>保存期限：{product.shelfLife}</span>
              </div>
            )}
            {product.expiryNote && (
              <div className="flex items-center gap-2 text-earth-600">
                <span>ℹ️</span> <span>{product.expiryNote}</span>
              </div>
            )}
            <div className="flex items-center gap-2 text-earth-600">
              <span>📦</span> <span>最低訂購量：{product.moq} {product.unit}</span>
            </div>
          </div>

          {/* ── 樣品購買 ── */}
          <div className="border border-brand-200 rounded-xl p-5 mb-4">
            <h3 className="font-semibold text-earth-800 mb-3">🎁 購買樣品</h3>
            <p className="text-sm text-earth-500 mb-4">先試試看！小量購買確認品質後再大量訂購。</p>
            <div className="flex items-center gap-3">
              <div className="flex items-center border border-brand-200 rounded-lg overflow-hidden">
                <button onClick={() => setSampleQty(q => Math.max(1, q - 1))} className="px-3 py-2 text-earth-600 hover:bg-brand-50">－</button>
                <span className="px-4 py-2 text-earth-800 font-medium">{sampleQty}</span>
                <button onClick={() => setSampleQty(q => q + 1)} className="px-3 py-2 text-earth-600 hover:bg-brand-50">＋</button>
              </div>
              <button
                onClick={() => handleAddToCart('sample')}
                className={`flex-1 btn-outline py-2.5 text-sm transition-all ${addedType === 'sample' ? 'bg-leaf-50 border-leaf-500 text-leaf-700' : ''}`}
              >
                {addedType === 'sample' ? '✓ 已加入購物車' : '加入樣品購物車'}
              </button>
            </div>
          </div>

          {/* ── 正式訂購 ── */}
          <div className="border-2 border-leaf-300 rounded-xl p-5 bg-leaf-50/50">
            <h3 className="font-semibold text-earth-800 mb-3">📦 正式訂購</h3>
            <p className="text-sm text-earth-500 mb-4">
              最低訂購量 {product.moq} {product.unit}，支援貨到付款。
            </p>
            <div className="flex items-center gap-3">
              <div className="flex items-center border border-leaf-300 rounded-lg overflow-hidden bg-white">
                <button onClick={() => setOrderQty(q => Math.max(product.moq || 1, q - 1))} className="px-3 py-2 text-earth-600 hover:bg-leaf-50">－</button>
                <span className="px-4 py-2 text-earth-800 font-medium">{orderQty}</span>
                <button onClick={() => setOrderQty(q => q + 1)} className="px-3 py-2 text-earth-600 hover:bg-leaf-50">＋</button>
              </div>
              <button
                onClick={() => handleAddToCart('order')}
                className={`flex-1 btn-primary py-2.5 text-sm transition-all ${addedType === 'order' ? 'bg-leaf-600' : ''}`}
              >
                {addedType === 'order' ? '✓ 已加入購物車' : '加入訂購車'}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
