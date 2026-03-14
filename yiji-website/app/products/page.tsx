'use client';

import { useEffect, useState, useMemo, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { getVisibleProducts } from '@/lib/firebase';
import { ChannelProduct as Product } from '@/lib/types';
import ProductCard from '@/components/ProductCard';

const ALL = '全部';
const PAGE_SIZE = 12;

function ProductsContent() {
  const searchParams = useSearchParams();
  const categoryParam = searchParams.get('category') || ALL;
  const typeParam = searchParams.get('type'); // 'sample' 表示樣品模式

  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeCategory, setActiveCategory] = useState(categoryParam);
  const [searchQuery, setSearchQuery] = useState('');
  const [currentPage, setCurrentPage] = useState(1);

  useEffect(() => {
    getVisibleProducts()
      .then(setProducts)
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  // URL 的 category 參數改變時同步
  useEffect(() => {
    setActiveCategory(categoryParam);
    setCurrentPage(1);
  }, [categoryParam]);

  // 取得所有分類
  const categories = useMemo(
    () => [ALL, ...Array.from(new Set(products.map(p => p.category))).sort()],
    [products]
  );

  // 篩選商品
  const filtered = useMemo(() => {
    return products.filter(p => {
      const matchCat = activeCategory === ALL || p.category === activeCategory;
      const matchSearch = !searchQuery || p.name.includes(searchQuery) || p.category.includes(searchQuery);
      return matchCat && matchSearch;
    });
  }, [products, activeCategory, searchQuery]);

  // 分頁計算
  const totalPages = Math.ceil(filtered.length / PAGE_SIZE);
  const pagedProducts = useMemo(
    () => filtered.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE),
    [filtered, currentPage]
  );

  // 切換分類或搜尋時重設頁碼
  const handleCategoryChange = (cat: string) => {
    setActiveCategory(cat);
    setCurrentPage(1);
  };

  const handleSearchChange = (val: string) => {
    setSearchQuery(val);
    setCurrentPage(1);
  };

  const isSampleMode = typeParam === 'sample';

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 md:py-10">
      {/* 頁面標題 */}
      <div className="mb-8">
        <h1 className="section-title mb-2">
          {isSampleMode ? '購買樣品' : '商品目錄'}
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
          onChange={e => handleSearchChange(e.target.value)}
          className="w-full pl-10 pr-4 py-3 border border-brand-200 rounded-xl bg-white focus:outline-none focus:ring-2 focus:ring-leaf-400 focus:border-transparent text-sm"
        />
        <svg className="absolute left-3 top-3.5 w-5 h-5 text-earth-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
        </svg>
        {searchQuery && (
          <button
            onClick={() => handleSearchChange('')}
            className="absolute right-3 top-3.5 text-earth-400 hover:text-earth-600"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        )}
      </div>

      {/* 分類篩選 */}
      <div className="flex flex-wrap gap-2 mb-6">
        {categories.map(cat => (
          <button
            key={cat}
            onClick={() => handleCategoryChange(cat)}
            className={`px-4 py-2 rounded-full text-sm font-medium transition-colors ${
              activeCategory === cat
                ? 'bg-leaf-500 text-white shadow-sm'
                : 'bg-white border border-brand-200 text-earth-700 hover:border-leaf-400'
            }`}
          >
            {cat}
          </button>
        ))}
      </div>

      {/* 商品數量提示 */}
      {!loading && (
        <div className="flex items-center justify-between mb-6">
          <p className="text-sm text-earth-500">
            共 {filtered.length} 件商品
            {activeCategory !== ALL && ` · ${activeCategory}`}
            {searchQuery && ` · 搜尋「${searchQuery}」`}
          </p>
          {totalPages > 1 && (
            <p className="text-xs text-earth-400">
              第 {currentPage} / {totalPages} 頁
            </p>
          )}
        </div>
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
      ) : pagedProducts.length > 0 ? (
        <>
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-5">
            {pagedProducts.map(p => (
              <ProductCard key={p.id} product={p} />
            ))}
          </div>

          {/* 分頁控制 */}
          {totalPages > 1 && (
            <div className="flex items-center justify-center gap-2 mt-10">
              <button
                onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                disabled={currentPage === 1}
                className="px-3 py-2 rounded-lg text-sm font-medium border border-brand-200 text-earth-600 hover:bg-brand-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              >
                上一頁
              </button>

              {generatePageNumbers(currentPage, totalPages).map((page, i) => (
                page === '...' ? (
                  <span key={`ellipsis-${i}`} className="px-2 text-earth-400">...</span>
                ) : (
                  <button
                    key={page}
                    onClick={() => setCurrentPage(page as number)}
                    className={`w-10 h-10 rounded-lg text-sm font-medium transition-colors ${
                      currentPage === page
                        ? 'bg-leaf-500 text-white shadow-sm'
                        : 'border border-brand-200 text-earth-600 hover:bg-brand-50'
                    }`}
                  >
                    {page}
                  </button>
                )
              ))}

              <button
                onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
                disabled={currentPage === totalPages}
                className="px-3 py-2 rounded-lg text-sm font-medium border border-brand-200 text-earth-600 hover:bg-brand-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              >
                下一頁
              </button>
            </div>
          )}
        </>
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

// 分頁頁碼產生器
function generatePageNumbers(current: number, total: number): (number | '...')[] {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1);

  const pages: (number | '...')[] = [1];
  if (current > 3) pages.push('...');

  const start = Math.max(2, current - 1);
  const end = Math.min(total - 1, current + 1);
  for (let i = start; i <= end; i++) pages.push(i);

  if (current < total - 2) pages.push('...');
  pages.push(total);

  return pages;
}

// 用 Suspense 包住以支援 useSearchParams()
export default function ProductsPage() {
  return (
    <Suspense fallback={<div className="max-w-7xl mx-auto px-4 py-20 text-center text-earth-400">載入中...</div>}>
      <ProductsContent />
    </Suspense>
  );
}
