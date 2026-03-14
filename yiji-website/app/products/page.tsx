'use client';

import { useEffect, useState, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { getVisibleProducts } from '@/lib/firebase';
import { ChannelProduct as Product } from '@/lib/types';
import ProductCard from '@/components/ProductCard';

const ALL = '全部';

function ProductsContent() {
  const searchParams = useSearchParams();
  const categoryParam = searchParams.get('category') || ALL;
  const typeParam = searchParams.get('type'); // 'sample' 表示樣品模式

  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeCategory, setActiveCategory] = useState(categoryParam);
  const [searchQuery, setSearchQuery] = useState('');

  useEffect(() => {
    getVisibleProducts()
      .then(setProducts)
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  // 取得所有分類
  const categories = [ALL, ...Array.from(new Set(products.map(p => p.category))).sort()];

  // 篩選商品
  const filtered = products.filter(p => {
    const matchCat = activeCategory === ALL || p.category === activeCategory;
    const matchSearch = !searchQuery || p.name.includes(searchQuery) || p.category.includes(searchQuery);
    const matchSugar = true; // 未來可擴充無糖篩選
    return matchCat && matchSearch && matchSugar;
  });

  const isSampleMode = typeParam === 'sample';

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-10">
      {/* 頁面標題 */}
      <div className="mb-8">
        <h1 className="section-title mb-2">
          {isSampleMode ? '🎁 購買樣品' : '📦 商品目錄'}
        </h1>
        <p className="text-earth-500">
          {isSampleMode
            ? '以小量購買方式確認品質，再決定是否大量訂購'
            : '所有商品均可直接查看批發參考價，無需登入詢問'}
        </p>
      </div>

      {/* 搜尋列 */}
      <div className="relative mb-6">
        <input
          type="text"
          placeholder="搜尋商品名稱或分類..."
          value={searchQuery}
          onChange={e => setSearchQuery(e.target.value)}
          className="w-full pl-10 pr-4 py-3 border border-brand-200 rounded-xl bg-white focus:outline-none focus:ring-2 focus:ring-leaf-400 focus:border-transparent"
        />
        <svg className="absolute left-3 top-3.5 w-5 h-5 text-earth-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
        </svg>
      </div>

      {/* 分類篩選 */}
      <div className="flex flex-wrap gap-2 mb-8">
        {categories.map(cat => (
          <button
            key={cat}
            onClick={() => setActiveCategory(cat)}
            className={`px-4 py-2 rounded-full text-sm font-medium transition-colors ${
              activeCategory === cat
                ? 'bg-leaf-500 text-white'
                : 'bg-white border border-brand-200 text-earth-700 hover:border-leaf-400'
            }`}
          >
            {cat}
          </button>
        ))}
      </div>

      {/* 商品數量提示 */}
      {!loading && (
        <p className="text-sm text-earth-500 mb-6">
          共 {filtered.length} 件商品
          {activeCategory !== ALL && ` · ${activeCategory}`}
        </p>
      )}

      {/* 商品列表 */}
      {loading ? (
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-5">
          {[...Array(8)].map((_, i) => (
            <div key={i} className="card animate-pulse">
              <div className="aspect-square bg-brand-100" />
              <div className="p-4 space-y-3">
                <div className="h-4 bg-brand-100 rounded w-3/4" />
                <div className="h-3 bg-brand-100 rounded w-1/2" />
                <div className="h-6 bg-brand-100 rounded w-1/3" />
              </div>
            </div>
          ))}
        </div>
      ) : filtered.length > 0 ? (
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-5">
          {filtered.map(p => (
            <ProductCard key={p.id} product={p} />
          ))}
        </div>
      ) : (
        <div className="text-center py-20 text-earth-400">
          <div className="text-6xl mb-4">🔍</div>
          <p className="text-lg mb-2">找不到符合的商品</p>
          <p className="text-sm">試試調整篩選條件或搜尋關鍵字</p>
        </div>
      )}
    </div>
  );
}

// 用 Suspense 包住以支援 useSearchParams()
export default function ProductsPage() {
  return (
    <Suspense fallback={<div className="max-w-7xl mx-auto px-4 py-20 text-center text-earth-400">載入中...</div>}>
      <ProductsContent />
    </Suspense>
  );
}
