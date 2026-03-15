'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { getSiteConfig } from '@/lib/firebase';

export default function Footer() {
  const [cfg, setCfg] = useState<Record<string, any> | null>(null);

  useEffect(() => {
    getSiteConfig('yiji').then(setCfg).catch(() => {});
  }, []);

  const brandName  = cfg?.footerBrandName ?? '一吉水果乾批發零售';
  const tagline    = cfg?.footerTagline   ?? '天然 · 健康 · 信賴';
  const desc       = cfg?.footerDesc      ?? '嚴選台灣及世界各地優質水果，以衛生專業的加工技術，\n提供天然美味的水果乾與蔬果脆片。適合零售、禮盒、烘焙等多種用途。';
  const copyright  = cfg?.footerCopyright ?? '© 2024 一吉水果乾批發零售. All rights reserved.';
  const phone      = cfg?.contactPhone    ?? '';
  const email      = cfg?.contactEmail    ?? 'service@yiji.com.tw';

  return (
    <footer className="bg-earth-800 text-earth-200">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-8">

          {/* 品牌簡介 */}
          <div className="md:col-span-2">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 bg-leaf-500 rounded-full flex items-center justify-center">
                <span className="text-white font-serif font-bold text-lg">吉</span>
              </div>
              <div>
                <div className="font-serif font-bold text-white text-lg">{brandName}</div>
                <div className="text-xs text-earth-400">{tagline}</div>
              </div>
            </div>
            <p className="text-sm text-earth-400 leading-relaxed max-w-sm whitespace-pre-line">
              {desc}
            </p>
          </div>

          {/* 快速連結 */}
          <div>
            <h4 className="font-semibold text-white mb-4">快速連結</h4>
            <ul className="space-y-2 text-sm">
              <li><Link href="/products" className="text-earth-400 hover:text-white transition-colors">商品目錄</Link></li>
              <li><Link href="/products?type=sample" className="text-earth-400 hover:text-white transition-colors">購買樣品</Link></li>
              <li><Link href="/#inquiry" className="text-earth-400 hover:text-white transition-colors">詢價說明</Link></li>
              <li><Link href="/#ai-chat" className="text-earth-400 hover:text-white transition-colors">AI 智能問答</Link></li>
            </ul>
          </div>

          {/* 聯絡資訊 */}
          <div>
            <h4 className="font-semibold text-white mb-4">聯絡我們</h4>
            <ul className="space-y-2 text-sm text-earth-400">
              <li className="flex items-start gap-2">
                <span className="mt-0.5">📞</span>
                <span>{phone || '請洽業務人員'}</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="mt-0.5">📧</span>
                <span>{email}</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="mt-0.5">🏭</span>
                <span>台灣製造・品質保證</span>
              </li>
            </ul>
          </div>
        </div>

        {/* 版權 */}
        <div className="border-t border-earth-700 mt-8 pt-6 flex flex-col md:flex-row justify-between items-center gap-4">
          <p className="text-xs text-earth-500">
            {copyright}
          </p>
          <div className="flex gap-4 text-xs text-earth-500">
            <span>綠界金流保障安全付款</span>
            <span>·</span>
            <span>自簽物流貨到付款</span>
          </div>
        </div>
      </div>
    </footer>
  );
}
