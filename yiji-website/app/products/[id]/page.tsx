import { getProduct, getSiteConfig } from '@/lib/firebase';
import { notFound } from 'next/navigation';
import ProductDetailClient from './ProductDetailClient';

// 強制動態渲染，避免 build 時 Firestore 連線失敗
export const dynamic = 'force-dynamic';

export default async function ProductDetailPage({ params }: { params: { id: string } }) {
  let product = null;
  let siteConfig = null;
  try {
    [product, siteConfig] = await Promise.all([
      getProduct(params.id),
      getSiteConfig('yiji').catch(() => null),
    ]);
  } catch {
    // Firebase 未設定
  }

  if (!product) notFound();
  return <ProductDetailClient product={product} siteConfig={siteConfig} />;
}
