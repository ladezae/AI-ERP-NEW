import { getProduct, getVisibleProducts } from '@/lib/firebase';
import { notFound } from 'next/navigation';
import ProductDetailClient from './ProductDetailClient';

export async function generateStaticParams() {
  try {
    const products = await getVisibleProducts();
    return products.map(p => ({ id: p.id }));
  } catch {
    return [];
  }
}

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
