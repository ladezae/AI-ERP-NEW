'use client';

import Link from 'next/link';
import { ChannelProduct as Product } from '@/lib/types';
import { useCart } from './CartContext';

interface ProductCardProps {
  product: Product;
  showAddToCart?: boolean;
}

export default function ProductCard({ product, showAddToCart = true }: ProductCardProps) {
  const { addItem } = useCart();

  return (
    <div className="card group">
      {/* 商品圖片 */}
      <Link href={`/products/${product.id}`}>
        <div className="relative overflow-hidden aspect-square bg-brand-50">
          <img
            src={product.imageUrl || '/placeholder.jpg'}
            alt={product.name}
            className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
          />
          {/* 分類標籤 */}
          <span className="absolute top-2 left-2 badge bg-leaf-100 text-leaf-700">
            {product.category}
          </span>
          {/* 無糖標示 */}
          {!product.sugar && (
            <span className="absolute top-2 right-2 badge bg-brand-100 text-brand-700">
              無糖
            </span>
          )}
        </div>
      </Link>

      {/* 商品資訊 */}
      <div className="p-4">
        <Link href={`/products/${product.id}`}>
          <h3 className="font-medium text-earth-800 text-sm leading-snug mb-1 hover:text-leaf-600 transition-colors line-clamp-2">
            {product.name}
          </h3>
        </Link>

        {/* 產地 */}
        <p className="text-xs text-earth-500 mb-3">
          🌿 產地：{product.origin}
        </p>

        {/* 價格 */}
        <div className="flex items-end gap-2 mb-3">
          <span className="text-lg font-bold text-earth-800">
            NT$ {product.price.toLocaleString()}
          </span>
          <span className="text-xs text-earth-400 mb-0.5">/ {product.unit}</span>
        </div>

        {/* 行動按鈕 */}
        {showAddToCart && (
          <div className="flex gap-2">
            <button
              onClick={() => addItem(product, 1, 'sample')}
              className="flex-1 text-xs btn-outline py-2 px-3"
            >
              加入樣品
            </button>
            <button
              onClick={() => addItem(product, product.moq, 'order')}
              className="flex-1 text-xs btn-primary py-2 px-3"
            >
              訂購
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
