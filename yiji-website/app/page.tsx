import Link from 'next/link';
import { getVisibleProducts, getSiteConfig } from '@/lib/firebase';
import ProductCard from '@/components/ProductCard';
import AIChat from '@/components/AIChat';

// 分類資料（固定，不需動態管理）
const CATEGORIES = [
  { name: '水果乾', icon: '🍎', desc: '天然風味濃縮' },
  { name: '蔬果脆片', icon: '🥕', desc: '輕盈酥脆口感' },
  { name: '沖泡類', icon: '☕', desc: '熱飲冷飲皆宜' },
  { name: '綜合堅果', icon: '🌰', desc: '香脆豐富營養' },
];

// 預設品牌特點（Firestore 無資料時 fallback）
const DEFAULT_FEATURES = [
  { icon: '🏅', title: '嚴格品質把關', desc: '每批商品皆經品管檢驗，符合食品安全標準。' },
  { icon: '🌿', title: '天然無添加', desc: '堅持使用優質原料，減少不必要的添加物。' },
  { icon: '🚚', title: '快速配送出貨', desc: '自簽物流，貨到付款，安心方便。' },
  { icon: '🤝', title: '彈性詢價採購', desc: '大量採購享優惠，歡迎洽談長期合作。' },
];

export default async function HomePage() {
  // 並行載入商品與網站設定
  const [allProducts, cfg] = await Promise.all([
    getVisibleProducts().catch(() => []),
    getSiteConfig('yiji').catch(() => null),
  ]);
  const featuredProducts = allProducts.slice(0, 8);

  // 從 siteConfig 取值，無資料時用預設值
  const heroTagline   = cfg?.heroTagline   ?? '台灣在地・天然健康';
  const heroTitle     = cfg?.heroTitle     ?? '嚴選水果乾\n批發直供';
  const heroSubtitle  = cfg?.heroSubtitle  ?? '水果乾・蔬果脆片・沖泡果乾\n品質保證・衛生可靠・彈性詢價';
  const features      = cfg?.features      ?? DEFAULT_FEATURES;
  const inquiryTitle  = cfg?.inquiryTitle  ?? '批發詢價說明';
  const inquiryDesc   = cfg?.inquiryDesc   ?? '我們提供透明的批發價格，無需填寫任何資料即可直接查看商品定價。\n如需進一步的量大優惠或長期合作方案，歡迎聯絡我們的業務人員。';
  const inquirySteps  = cfg?.inquirySteps  ?? [
    { icon: '👀', title: '直接查看', desc: '商品頁面即可查看批發參考價' },
    { icon: '📦', title: '樣品試購', desc: '小量購買確認品質後再大量訂購' },
    { icon: '💎', title: '量大議價', desc: '聯絡業務洽談更優惠的專案報價' },
  ];
  const contactPhone     = cfg?.contactPhone     ?? '';
  const contactPhoneNote = cfg?.contactPhoneNote ?? '業務時間：週一至週五 9:00 - 18:00';
  const contactEmail     = cfg?.contactEmail     ?? 'service@yiji.com.tw';
  const contactEmailNote = cfg?.contactEmailNote ?? '24 小時內回覆';
  const contactLine      = cfg?.contactLine      ?? '';
  const contactLineNote  = cfg?.contactLineNote  ?? '即時回覆，快速報價';

  // Hero 標題分行
  const heroLines = heroTitle.split('\n');

  return (
    <div>
      {/* ── Hero 區塊 ───────────────────────────────────── */}
      <section className="relative bg-gradient-to-br from-leaf-700 via-leaf-600 to-earth-600 text-white overflow-hidden">
        {/* 裝飾背景 */}
        <div className="absolute inset-0 opacity-10">
          <div className="absolute top-10 left-10 text-9xl">🍎</div>
          <div className="absolute top-20 right-20 text-7xl">🥭</div>
          <div className="absolute bottom-10 left-1/4 text-8xl">🍓</div>
          <div className="absolute bottom-20 right-10 text-6xl">🥝</div>
        </div>

        <div className="relative max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-20 md:py-28">
          <div className="max-w-2xl">
            <div className="inline-flex items-center gap-2 bg-white/20 rounded-full px-4 py-1.5 text-sm mb-6">
              <span>🌿</span>
              <span>{heroTagline}</span>
            </div>
            <h1 className="font-serif text-4xl md:text-5xl lg:text-6xl font-bold leading-tight mb-6">
              {heroLines[0]}{heroLines.length > 1 && <><br /><span className="text-brand-200">{heroLines[1]}</span></>}
            </h1>
            <p className="text-lg text-white/90 mb-8 leading-relaxed whitespace-pre-line">
              {heroSubtitle}
            </p>
            <div className="flex flex-wrap gap-4">
              <Link href="/products" className="btn-primary bg-white text-leaf-700 hover:bg-brand-50">
                瀏覽商品目錄
              </Link>
              <Link href="/products?type=sample" className="btn-outline border-white text-white hover:bg-white/10">
                購買樣品試用
              </Link>
            </div>
          </div>
        </div>
      </section>

      {/* ── 品牌特點 ─────────────────────────────────────── */}
      <section className="bg-white border-b border-brand-100">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-6">
            {features.map((f: any, i: number) => (
              <div key={i} className="text-center p-4">
                <div className="text-4xl mb-3">{f.icon}</div>
                <h3 className="font-semibold text-earth-800 mb-2">{f.title}</h3>
                <p className="text-sm text-earth-500 leading-relaxed">{f.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── 商品分類 ─────────────────────────────────────── */}
      <section className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-16">
        <div className="text-center mb-10">
          <h2 className="section-title mb-3">商品分類</h2>
          <p className="text-earth-500">多元品項，滿足各種採購需求</p>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {CATEGORIES.map(cat => (
            <Link
              key={cat.name}
              href={`/products?category=${encodeURIComponent(cat.name)}`}
              className="card p-6 text-center hover:border-leaf-300 hover:bg-leaf-50 group"
            >
              <div className="text-5xl mb-3 group-hover:scale-110 transition-transform">{cat.icon}</div>
              <h3 className="font-semibold text-earth-800 mb-1">{cat.name}</h3>
              <p className="text-xs text-earth-500">{cat.desc}</p>
            </Link>
          ))}
        </div>
      </section>

      {/* ── 精選商品 ─────────────────────────────────────── */}
      <section className="bg-brand-50/50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-16">
          <div className="flex items-end justify-between mb-10">
            <div>
              <h2 className="section-title mb-2">精選商品</h2>
              <p className="text-earth-500">熱銷品項，品質有保證</p>
            </div>
            <Link href="/products" className="text-leaf-600 hover:text-leaf-700 font-medium text-sm flex items-center gap-1">
              查看全部 →
            </Link>
          </div>
          {featuredProducts.length > 0 ? (
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-5">
              {featuredProducts.map(p => (
                <ProductCard key={p.id} product={p} />
              ))}
            </div>
          ) : (
            <div className="text-center py-16 text-earth-400">
              <div className="text-6xl mb-4">🍎</div>
              <p>商品資料載入中，請確認 Firebase 設定...</p>
            </div>
          )}
        </div>
      </section>

      {/* ── 詢價說明 ─────────────────────────────────────── */}
      <section id="inquiry" className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-16">
        <div className="bg-gradient-to-r from-earth-700 to-earth-800 rounded-2xl p-8 md:p-12 text-white">
          <div className="max-w-2xl">
            <h2 className="font-serif text-3xl font-bold mb-4">{inquiryTitle}</h2>
            <p className="text-earth-200 mb-6 leading-relaxed whitespace-pre-line">
              {inquiryDesc}
            </p>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">
              {inquirySteps.map((item: any, i: number) => (
                <div key={i} className="bg-white/10 rounded-xl p-4">
                  <div className="font-semibold mb-1">{item.icon ?? ''} {item.title}</div>
                  <div className="text-sm text-earth-300">{item.desc}</div>
                </div>
              ))}
            </div>
            <Link href="/products" className="btn-primary bg-white text-earth-800 hover:bg-cream">
              開始瀏覽商品
            </Link>
          </div>
        </div>
      </section>

      {/* ── AI 問答 ──────────────────────────────────────── */}
      <section id="ai-chat" className="bg-leaf-50 border-t border-leaf-100">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-16">
          <div className="text-center mb-10">
            <h2 className="section-title mb-3">🤖 AI 智能問答</h2>
            <p className="text-earth-500">有關商品成分、保存方式、詢價建議？直接問 AI！</p>
          </div>
          <div className="max-w-3xl mx-auto">
            <AIChat siteConfig={cfg} />
          </div>
        </div>
      </section>

      {/* ── 聯絡我們 ─────────────────────────────────────── */}
      <section id="contact" className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-16">
        <div className="text-center mb-10">
          <h2 className="section-title mb-3">聯絡我們</h2>
          <p className="text-earth-500">有任何問題或合作需求，歡迎與我們聯繫</p>
        </div>
        <div className="max-w-lg mx-auto card p-8">
          <div className="space-y-4 text-earth-700">
            <div className="flex items-center gap-3">
              <span className="text-2xl">📞</span>
              <div>
                <div className="font-medium">{contactPhone || '電話洽詢'}</div>
                <div className="text-sm text-earth-500">{contactPhoneNote}</div>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <span className="text-2xl">📧</span>
              <div>
                <div className="font-medium">{contactEmail}</div>
                <div className="text-sm text-earth-500">{contactEmailNote}</div>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <span className="text-2xl">💬</span>
              <div>
                <div className="font-medium">{contactLine || 'LINE 官方帳號'}</div>
                <div className="text-sm text-earth-500">{contactLineNote}</div>
              </div>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
