'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useCart } from './CartContext';

export default function Header() {
  const [menuOpen, setMenuOpen] = useState(false);
  const { itemCount } = useCart();

  return (
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
              <div className="text-xs text-earth-500 leading-tight">天然 · 健康 · 信賴</div>
            </div>
          </Link>

          {/* 桌面版導覽 */}
          <nav className="hidden md:flex items-center gap-8">
            <Link href="/products" className="text-earth-700 hover:text-leaf-600 font-medium transition-colors">
              商品目錄
            </Link>
            <Link href="/products?type=sample" className="text-earth-700 hover:text-leaf-600 font-medium transition-colors">
              購買樣品
            </Link>
            <Link href="/#inquiry" className="text-earth-700 hover:text-leaf-600 font-medium transition-colors">
              詢價說明
            </Link>
            <Link href="/#contact" className="text-earth-700 hover:text-leaf-600 font-medium transition-colors">
              聯絡我們
            </Link>
          </nav>

          {/* 右側按鈕 */}
          <div className="flex items-center gap-3">
            {/* AI 問答 */}
            <Link href="/#ai-chat" className="hidden md:flex items-center gap-1.5 text-sm text-leaf-600 hover:text-leaf-700 font-medium">
              <span>🤖</span> AI 問答
            </Link>

            {/* 購物車 */}
            <Link href="/checkout" className="relative p-2 text-earth-700 hover:text-leaf-600 transition-colors">
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                  d="M3 3h2l.4 2M7 13h10l4-8H5.4M7 13L5.4 5M7 13l-2.293 2.293c-.63.63-.184 1.707.707 1.707H17m0 0a2 2 0 100 4 2 2 0 000-4zm-8 2a2 2 0 11-4 0 2 2 0 014 0z" />
              </svg>
              {itemCount > 0 && (
                <span className="absolute -top-1 -right-1 w-5 h-5 bg-leaf-500 text-white rounded-full text-xs flex items-center justify-center font-bold">
                  {itemCount}
                </span>
              )}
            </Link>

            {/* 漢堡選單 */}
            <button
              className="md:hidden p-2 text-earth-700"
              onClick={() => setMenuOpen(!menuOpen)}
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

      {/* 手機版選單 */}
      {menuOpen && (
        <div className="md:hidden bg-cream border-t border-brand-100 px-4 py-4 space-y-3">
          <Link href="/products" className="block text-earth-700 font-medium py-2" onClick={() => setMenuOpen(false)}>商品目錄</Link>
          <Link href="/products?type=sample" className="block text-earth-700 font-medium py-2" onClick={() => setMenuOpen(false)}>購買樣品</Link>
          <Link href="/#inquiry" className="block text-earth-700 font-medium py-2" onClick={() => setMenuOpen(false)}>詢價說明</Link>
          <Link href="/#contact" className="block text-earth-700 font-medium py-2" onClick={() => setMenuOpen(false)}>聯絡我們</Link>
          <Link href="/#ai-chat" className="block text-leaf-600 font-medium py-2" onClick={() => setMenuOpen(false)}>🤖 AI 問答</Link>
        </div>
      )}
    </header>
  );
}
