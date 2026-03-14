'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useCart } from './CartContext';

export default function Header() {
  const [menuOpen, setMenuOpen] = useState(false);
  const { itemCount, totalAmount } = useCart();
  const pathname = usePathname();

  // 路由切換時自動關閉選單
  useEffect(() => {
    setMenuOpen(false);
  }, [pathname]);

  // 手機選單開啟時鎖定背景捲動
  useEffect(() => {
    if (menuOpen) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }
    return () => { document.body.style.overflow = ''; };
  }, [menuOpen]);

  const isCheckout = pathname === '/checkout';

  return (
    <>
      <header className="bg-white border-b border-brand-200 sticky top-0 z-50 shadow-sm">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-16">

            {/* Logo */}
            <Link href="/" className="flex items-center gap-3">
              <div className="w-10 h-10 bg-leaf-500 rounded-full flex items-center justify-center">
                <span className="text-white font-serif font-bold text-lg">吉</span>
              </div>
              <div>
                <div className="font-serif font-bold text-earth-800 leading-tight">
                  一吉水果乾<span className="text-leaf-600">批發零售</span>
                </div>
                <div className="text-xs text-earth-500 leading-tight hidden sm:block">天然 · 健康 · 信賴</div>
              </div>
            </Link>

            {/* 桌面版導覽 */}
            <nav className="hidden md:flex items-center gap-8">
              <NavLink href="/products" label="商品目錄" active={pathname === '/products'} />
              <NavLink href="/products?type=sample" label="購買樣品" active={pathname === '/products' && false} />
              <NavLink href="/#inquiry" label="詢價說明" />
              <NavLink href="/#contact" label="聯絡我們" />
            </nav>

            {/* 右側按鈕 */}
            <div className="flex items-center gap-3">
              {/* AI 問答 */}
              <Link href="/#ai-chat" className="hidden md:flex items-center gap-1.5 text-sm text-leaf-600 hover:text-leaf-700 font-medium transition-colors">
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z" />
                </svg>
                AI 問答
              </Link>

              {/* 購物車 */}
              <Link href="/checkout" className="relative p-2 text-earth-700 hover:text-leaf-600 transition-colors">
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                    d="M3 3h2l.4 2M7 13h10l4-8H5.4M7 13L5.4 5M7 13l-2.293 2.293c-.63.63-.184 1.707.707 1.707H17m0 0a2 2 0 100 4 2 2 0 000-4zm-8 2a2 2 0 11-4 0 2 2 0 014 0z" />
                </svg>
                {itemCount > 0 && (
                  <span className="absolute -top-0.5 -right-0.5 min-w-[1.25rem] h-5 bg-leaf-500 text-white rounded-full text-xs flex items-center justify-center font-bold px-1">
                    {itemCount > 99 ? '99+' : itemCount}
                  </span>
                )}
              </Link>

              {/* 漢堡選單 */}
              <button
                className="md:hidden p-2 text-earth-700"
                onClick={() => setMenuOpen(!menuOpen)}
                aria-label={menuOpen ? '關閉選單' : '開啟選單'}
              >
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  {menuOpen
                    ? <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    : <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
                  }
                </svg>
              </button>
            </div>
          </div>
        </div>

        {/* 手機版選單（覆蓋式） */}
        {menuOpen && (
          <>
            <div className="fixed inset-0 bg-black/20 z-40 md:hidden" onClick={() => setMenuOpen(false)} />
            <div className="fixed top-16 left-0 right-0 bg-white z-50 md:hidden border-t border-brand-100 shadow-lg animate-slide-down">
              <nav className="px-4 py-4 space-y-1">
                <MobileNavLink href="/products" label="商品目錄" icon="📦" />
                <MobileNavLink href="/products?type=sample" label="購買樣品" icon="🎁" />
                <MobileNavLink href="/#inquiry" label="詢價說明" icon="💰" />
                <MobileNavLink href="/#contact" label="聯絡我們" icon="📞" />
                <MobileNavLink href="/#ai-chat" label="AI 智能問答" icon="🤖" highlight />
              </nav>
            </div>
          </>
        )}
      </header>

      {/* 手機版底部固定購物車列（非結帳頁面、有商品時顯示） */}
      {!isCheckout && itemCount > 0 && (
        <div className="fixed bottom-0 left-0 right-0 bg-white border-t border-brand-200 z-40 md:hidden shadow-[0_-4px_12px_rgba(0,0,0,0.08)]">
          <Link href="/checkout" className="flex items-center justify-between px-4 py-3">
            <div className="flex items-center gap-3">
              <div className="relative">
                <svg className="w-6 h-6 text-leaf-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                    d="M3 3h2l.4 2M7 13h10l4-8H5.4M7 13L5.4 5M7 13l-2.293 2.293c-.63.63-.184 1.707.707 1.707H17m0 0a2 2 0 100 4 2 2 0 000-4zm-8 2a2 2 0 11-4 0 2 2 0 014 0z" />
                </svg>
                <span className="absolute -top-1 -right-1 w-4 h-4 bg-leaf-500 text-white rounded-full text-[10px] flex items-center justify-center font-bold">
                  {itemCount}
                </span>
              </div>
              <div>
                <p className="text-xs text-earth-500">{itemCount} 件商品</p>
                <p className="text-sm font-bold text-earth-800">NT$ {totalAmount.toLocaleString()}</p>
              </div>
            </div>
            <span className="bg-leaf-500 text-white text-sm font-medium px-5 py-2.5 rounded-lg shadow-sm">
              前往結帳
            </span>
          </Link>
        </div>
      )}
    </>
  );
}

// 桌面版導覽連結
function NavLink({ href, label, active }: { href: string; label: string; active?: boolean }) {
  return (
    <Link
      href={href}
      className={`font-medium transition-colors ${
        active ? 'text-leaf-600' : 'text-earth-700 hover:text-leaf-600'
      }`}
    >
      {label}
    </Link>
  );
}

// 手機版導覽連結
function MobileNavLink({ href, label, icon, highlight }: { href: string; label: string; icon: string; highlight?: boolean }) {
  return (
    <Link
      href={href}
      className={`flex items-center gap-3 px-3 py-3 rounded-xl font-medium transition-colors ${
        highlight
          ? 'text-leaf-600 bg-leaf-50'
          : 'text-earth-700 hover:bg-brand-50'
      }`}
    >
      <span className="text-lg">{icon}</span>
      {label}
    </Link>
  );
}
