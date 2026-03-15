'use client';

import { useState, useCallback } from 'react';
import Link from 'next/link';
import { ChannelProduct as Product } from '@/lib/types';
import { useCart } from '@/components/CartContext';

export default function ProductDetailClient({ product, siteConfig }: { product: Product; siteConfig?: Record<string, any> | null }) {
  const { addItem } = useCart();
  const [orderQty, setOrderQty] = useState(product.moq || 1);
  const [sampleQty, setSampleQty] = useState(1);
  const [addedType, setAddedType] = useState<'sample' | 'order' | null>(null);
  const [activeTab, setActiveTab] = useState<'desc' | 'spec' | 'faq'>('desc');

  // 多圖展示：合併主圖 + images 陣列 + 營養標示圖
  const allImages = buildImageList(product);
  const [selectedImg, setSelectedImg] = useState(0);

  const handleAddToCart = useCallback((type: 'sample' | 'order') => {
    const qty = type === 'sample' ? sampleQty : orderQty;
    addItem(product, qty, type);
    setAddedType(type);
    setTimeout(() => setAddedType(null), 2500);
  }, [sampleQty, orderQty, addItem, product]);

  // 通路售價（ERP 通路管理中的「售價」欄位）
  const channelPrice = product.price;

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 md:py-10">
      {/* 麵包屑 */}
      <nav className="text-sm text-earth-500 mb-6">
        <Link href="/" className="hover:text-leaf-600 transition-colors">首頁</Link>
        <span className="mx-2">/</span>
        <Link href="/products" className="hover:text-leaf-600 transition-colors">商品目錄</Link>
        <span className="mx-2">/</span>
        <Link href={`/products?category=${encodeURIComponent(product.category)}`} className="hover:text-leaf-600 transition-colors">
          {product.category}
        </Link>
        <span className="mx-2">/</span>
        <span className="text-earth-800">{product.name}</span>
      </nav>

      {/* ══ 主要內容：圖片 + 商品資訊 ══ */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-8 lg:gap-12 mb-12">

        {/* ── 左：商品圖片 ── */}
        <div className="space-y-3">
          {/* 主圖 */}
          <div className="rounded-2xl overflow-hidden bg-brand-50 aspect-square relative group">
            <img
              src={allImages[selectedImg]?.url || '/placeholder.jpg'}
              alt={allImages[selectedImg]?.label || product.name}
              className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-105"
            />
            {allImages[selectedImg]?.label && (
              <span className="absolute bottom-3 left-3 bg-black/50 text-white text-xs px-3 py-1 rounded-full">
                {allImages[selectedImg].label}
              </span>
            )}
            {/* 左右切換箭頭 */}
            {allImages.length > 1 && (
              <>
                <button
                  onClick={() => setSelectedImg(i => (i - 1 + allImages.length) % allImages.length)}
                  className="absolute left-2 top-1/2 -translate-y-1/2 w-10 h-10 rounded-full bg-white/80 hover:bg-white flex items-center justify-center shadow-md opacity-0 group-hover:opacity-100 transition-opacity"
                  aria-label="上一張"
                >
                  <svg className="w-5 h-5 text-earth-700" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                  </svg>
                </button>
                <button
                  onClick={() => setSelectedImg(i => (i + 1) % allImages.length)}
                  className="absolute right-2 top-1/2 -translate-y-1/2 w-10 h-10 rounded-full bg-white/80 hover:bg-white flex items-center justify-center shadow-md opacity-0 group-hover:opacity-100 transition-opacity"
                  aria-label="下一張"
                >
                  <svg className="w-5 h-5 text-earth-700" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                  </svg>
                </button>
              </>
            )}
          </div>

          {/* 縮圖列 */}
          {allImages.length > 1 && (
            <div className="flex gap-2 overflow-x-auto pb-1">
              {allImages.map((img, i) => (
                <button
                  key={i}
                  onClick={() => setSelectedImg(i)}
                  className={`flex-shrink-0 w-16 h-16 md:w-20 md:h-20 rounded-lg overflow-hidden border-2 transition-all ${
                    selectedImg === i ? 'border-leaf-500 ring-2 ring-leaf-200' : 'border-brand-200 hover:border-leaf-300'
                  }`}
                >
                  <img src={img.url} alt={img.label || `圖片 ${i + 1}`} className="w-full h-full object-cover" />
                </button>
              ))}
            </div>
          )}
        </div>

        {/* ── 右：商品資訊 ── */}
        <div>
          {/* 分類 & 標籤 */}
          <div className="flex flex-wrap items-center gap-2 mb-3">
            <span className="inline-block bg-leaf-100 text-leaf-700 text-xs font-medium px-2.5 py-1 rounded-full">{product.category}</span>
            {!product.sugar && <span className="inline-block bg-brand-100 text-brand-700 text-xs font-medium px-2.5 py-1 rounded-full">無糖</span>}
            {product.origin && (
              <span className="inline-block bg-earth-100 text-earth-700 text-xs font-medium px-2.5 py-1 rounded-full">產地：{product.origin}</span>
            )}
            {product.certifications?.map(cert => (
              <span key={cert} className="inline-block bg-blue-50 text-blue-700 text-xs font-medium px-2.5 py-1 rounded-full">{cert}</span>
            ))}
          </div>

          {/* 商品名稱 */}
          <h1 className="font-serif text-2xl md:text-3xl font-bold text-earth-800 mb-3">
            {product.name}
          </h1>

          {/* 商品簡述 */}
          {product.description && (
            <p className="text-earth-600 text-sm leading-relaxed mb-4">{product.description}</p>
          )}

          {/* 重點說明 */}
          {product.highlightNote && (
            <div className="bg-leaf-50 border border-leaf-200 rounded-xl p-4 mb-5">
              <p className="text-sm text-leaf-700 leading-relaxed">
                <span className="font-semibold mr-1">特色亮點</span>
                {product.highlightNote}
              </p>
            </div>
          )}

          {/* 價格區塊 */}
          <div className="bg-brand-50 rounded-xl p-5 mb-5">
            <div className="flex items-end gap-3 mb-1">
              <span className="text-3xl font-bold text-earth-800">
                NT$ {channelPrice.toLocaleString()}
              </span>
              <span className="text-earth-500 mb-1">/ {product.unit}</span>
            </div>
            <p className="text-xs text-earth-400">
              通路售價（含稅）
            </p>
          </div>

          {/* 規格快覽 */}
          <div className="grid grid-cols-2 gap-3 mb-5 text-sm">
            {product.weight && (
              <div className="flex items-center gap-2 text-earth-600 bg-white rounded-lg px-3 py-2 border border-brand-100">
                <span className="text-base">📏</span> <span>規格：{product.weight}</span>
              </div>
            )}
            {product.shelfLife && (
              <div className="flex items-center gap-2 text-earth-600 bg-white rounded-lg px-3 py-2 border border-brand-100">
                <span className="text-base">📅</span> <span>保存期限：{product.shelfLife}</span>
              </div>
            )}
            <div className="flex items-center gap-2 text-earth-600 bg-white rounded-lg px-3 py-2 border border-brand-100">
              <span className="text-base">📦</span> <span>最低訂購量：{product.moq} {product.unit}</span>
            </div>
            {product.origin && (
              <div className="flex items-center gap-2 text-earth-600 bg-white rounded-lg px-3 py-2 border border-brand-100">
                <span className="text-base">🌍</span> <span>產地：{product.origin}</span>
              </div>
            )}
          </div>

          {/* ── 樣品購買 ── */}
          <div className="border border-brand-200 rounded-xl p-5 mb-4">
            <h3 className="font-semibold text-earth-800 mb-2 flex items-center gap-2">
              <span className="w-6 h-6 bg-brand-100 rounded-full flex items-center justify-center text-xs">試</span>
              購買樣品
            </h3>
            <p className="text-sm text-earth-500 mb-4">先試試看！小量購買確認品質後再大量訂購。</p>
            <div className="flex items-center gap-3">
              <div className="flex items-center border border-brand-200 rounded-lg overflow-hidden">
                <button onClick={() => setSampleQty(q => Math.max(1, q - 1))} className="px-3 py-2.5 text-earth-600 hover:bg-brand-50 active:bg-brand-100 transition-colors">－</button>
                <span className="px-4 py-2.5 text-earth-800 font-medium min-w-[3rem] text-center">{sampleQty}</span>
                <button onClick={() => setSampleQty(q => q + 1)} className="px-3 py-2.5 text-earth-600 hover:bg-brand-50 active:bg-brand-100 transition-colors">＋</button>
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
            <h3 className="font-semibold text-earth-800 mb-2 flex items-center gap-2">
              <span className="w-6 h-6 bg-leaf-500 text-white rounded-full flex items-center justify-center text-xs">訂</span>
              正式訂購
            </h3>
            <p className="text-sm text-earth-500 mb-4">
              最低訂購量 {product.moq} {product.unit}，支援貨到付款與線上付款。
            </p>
            <div className="flex items-center gap-3">
              <div className="flex items-center border border-leaf-300 rounded-lg overflow-hidden bg-white">
                <button onClick={() => setOrderQty(q => Math.max(product.moq || 1, q - 1))} className="px-3 py-2.5 text-earth-600 hover:bg-leaf-50 active:bg-leaf-100 transition-colors">－</button>
                <span className="px-4 py-2.5 text-earth-800 font-medium min-w-[3rem] text-center">{orderQty}</span>
                <button onClick={() => setOrderQty(q => q + 1)} className="px-3 py-2.5 text-earth-600 hover:bg-leaf-50 active:bg-leaf-100 transition-colors">＋</button>
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

      {/* ══ 下方 Tabs：商品詳情 / 規格成分 / 常見問題 ══ */}
      <div className="border-t border-brand-200 pt-8">
        {/* Tab 標籤列 */}
        <div className="flex border-b border-brand-200 mb-6">
          {([
            { key: 'desc', label: '商品詳情' },
            { key: 'spec', label: '規格與成分' },
            { key: 'faq', label: '常見問題' },
          ] as const).map(tab => (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={`px-5 py-3 text-sm font-medium border-b-2 transition-colors -mb-px ${
                activeTab === tab.key
                  ? 'border-leaf-500 text-leaf-700'
                  : 'border-transparent text-earth-500 hover:text-earth-700'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* Tab 內容 */}
        <div className="max-w-3xl">
          {activeTab === 'desc' && (
            <div className="space-y-6 text-earth-700 leading-relaxed">
              {/* 商品描述 */}
              {product.description ? (
                <div>
                  <h3 className="font-semibold text-earth-800 mb-2">商品介紹</h3>
                  <p className="text-sm whitespace-pre-line">{product.description}</p>
                </div>
              ) : (
                <p className="text-sm text-earth-400">商品介紹即將更新，請持續關注。</p>
              )}

              {/* 使用建議 */}
              {product.usageSuggestion && (
                <div className="bg-brand-50 rounded-xl p-5">
                  <h3 className="font-semibold text-earth-800 mb-2">使用建議</h3>
                  <p className="text-sm">{product.usageSuggestion}</p>
                </div>
              )}

              {/* 保存方式 */}
              {product.storageMethod && (
                <div className="bg-leaf-50 rounded-xl p-5">
                  <h3 className="font-semibold text-earth-800 mb-2">保存方式</h3>
                  <p className="text-sm">{product.storageMethod}</p>
                </div>
              )}

              {/* 沒有任何詳細資訊時的預設內容 */}
              {!product.description && !product.usageSuggestion && !product.storageMethod && (
                <div className="bg-brand-50 rounded-xl p-5 text-sm space-y-3">
                  <h3 className="font-semibold text-earth-800">購買提醒</h3>
                  <p>建議先購買樣品確認品質，滿意後再進行大量訂購。如有任何疑問，歡迎透過 AI 問答或聯絡我們取得更多資訊。</p>
                </div>
              )}
            </div>
          )}

          {activeTab === 'spec' && (
            <div className="space-y-4">
              <table className="w-full text-sm">
                <tbody className="divide-y divide-brand-100">
                  <SpecRow label="商品名稱" value={product.name} />
                  <SpecRow label="分類" value={product.category} />
                  {product.weight && <SpecRow label="淨重/規格" value={product.weight} />}
                  <SpecRow label="產地" value={product.origin} />
                  {product.ingredients && <SpecRow label="成分" value={product.ingredients} />}
                  <SpecRow label="含糖" value={product.sugar ? '是' : '否（無糖）'} />
                  {product.shelfLife && <SpecRow label="保存期限" value={product.shelfLife} />}
                  {product.expiryNote && <SpecRow label="效期說明" value={product.expiryNote} />}
                  {product.storageMethod && <SpecRow label="保存方式" value={product.storageMethod} />}
                  <SpecRow label="最低訂購量" value={`${product.moq} ${product.unit}`} />
                  {product.certifications && product.certifications.length > 0 && (
                    <SpecRow label="認證標章" value={product.certifications.join('、')} />
                  )}
                </tbody>
              </table>
            </div>
          )}

          {activeTab === 'faq' && (
            <div className="space-y-4">
              {product.faq && product.faq.length > 0 ? (
                product.faq.map((item, i) => (
                  <div key={i} className="bg-white border border-brand-100 rounded-xl p-5">
                    <p className="font-medium text-earth-800 mb-2">Q：{item.q}</p>
                    <p className="text-sm text-earth-600">A：{item.a}</p>
                  </div>
                ))
              ) : (
                // 預設常見問題（從 siteConfig 讀取，無資料時用預設值）
                <div className="space-y-4">
                  {(siteConfig?.faq ?? [
                    { q: '如何購買樣品？', a: '直接在上方「購買樣品」區塊加入購物車即可。樣品不限最低訂購量，可先試吃確認品質。' },
                    { q: '大量採購有優惠嗎？', a: '歡迎聯絡我們的業務人員洽談長期合作或量大優惠方案。' },
                    { q: '出貨時間多久？', a: '一般訂單在付款確認後 1-3 個工作天出貨，採自簽物流配送。' },
                    { q: '可以開發票嗎？', a: '可以！結帳時填寫公司名稱與統一編號，我們會開立正式發票。' },
                  ]).map((item: any, i: number) => (
                    <div key={i} className="bg-white border border-brand-100 rounded-xl p-5">
                      <p className="font-medium text-earth-800 mb-2">Q：{item.q}</p>
                      <p className="text-sm text-earth-600">A：{item.a}</p>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* ══ 手機版底部固定購物列 ══ */}
      <div className="fixed bottom-0 left-0 right-0 bg-white border-t border-brand-200 px-4 py-3 flex gap-3 md:hidden z-40 shadow-[0_-4px_12px_rgba(0,0,0,0.08)]">
        <div className="text-sm leading-tight flex-shrink-0">
          <p className="text-earth-500 text-xs">售價</p>
          <p className="font-bold text-earth-800">NT$ {channelPrice.toLocaleString()}</p>
        </div>
        <button
          onClick={() => handleAddToCart('sample')}
          className="flex-1 btn-outline py-2 text-xs"
        >
          {addedType === 'sample' ? '✓ 已加入' : '加入樣品'}
        </button>
        <button
          onClick={() => handleAddToCart('order')}
          className="flex-1 btn-primary py-2 text-xs"
        >
          {addedType === 'order' ? '✓ 已加入' : '立即訂購'}
        </button>
      </div>
      {/* 手機版底部留白（避免被固定列遮住） */}
      <div className="h-20 md:hidden" />
    </div>
  );
}

// ── 輔助元件：規格表行 ──
function SpecRow({ label, value }: { label: string; value: string }) {
  return (
    <tr>
      <td className="py-3 pr-4 text-earth-500 font-medium w-28 align-top whitespace-nowrap">{label}</td>
      <td className="py-3 text-earth-800">{value}</td>
    </tr>
  );
}

// ── 輔助函式：組合所有圖片 ──
function buildImageList(product: Product): { url: string; label?: string }[] {
  const list: { url: string; label?: string }[] = [];

  // 主圖
  if (product.imageUrl) {
    list.push({ url: product.imageUrl, label: '商品主圖' });
  }

  // 多圖（排除與主圖重複的）
  if (product.images && product.images.length > 0) {
    product.images.forEach((url, i) => {
      if (url !== product.imageUrl) {
        list.push({ url, label: `商品圖 ${i + 1}` });
      }
    });
  }

  // 營養標示
  if (product.nutritionLabelUrl) {
    list.push({ url: product.nutritionLabelUrl, label: '營養標示' });
  }

  return list.length > 0 ? list : [{ url: '/placeholder.jpg', label: '商品圖片' }];
}
