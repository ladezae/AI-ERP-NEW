import { getProduct } from '@/lib/firebase';
import { notFound } from 'next/navigation';
import ProductDetailClient from './ProductDetailClient';

// 強制動態渲染，避免 build 時 Firestore 連線失敗
export const dynamic = 'force-dynamic';

export default async function ProductDetailPage({ params }: { params: { id: string } }) {
  let product = null;
  try {
    product = await getProduct(params.id);
  } catch {
    // Firebase 未設定
  }

  if (!product) notFound();
  return <ProductDetailClient product={product} />;
}
