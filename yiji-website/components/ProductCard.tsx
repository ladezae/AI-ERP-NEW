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

  // 通路售價（ERP 通路管理中的「售價」欄位）
  const channelPrice = product.price;

  return (
    <div className="card group flex flex-col">
      {/* 商品圖片 */}
      <Link href={`/products/${product.id}`}>
        <div className="relative overflow-hidden aspect-square bg-brand-50">
          <img
            src={product.imageUrl || '/placeholder.jpg'}
            alt={product.name}
            loading="lazy"
            className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
          />
          {/* 分類標籤 */}
          <span className="absolute top-2 left-2 inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-leaf-100 text-leaf-700">
            {product.category}
          </span>
          {/* 無糖標示 */}
          {!product.sugar && (
            <span className="absolute top-2 right-2 inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-brand-100 text-brand-700">
              無糖
            </span>
          )}
        </div>
      </Link>

      {/* 商品資訊 */}
      <div className="p-4 flex flex-col flex-1">
        <Link href={`/products/${product.id}`}>
          <h3 className="font-medium text-earth-800 text-sm leading-snug mb-1 hover:text-leaf-600 transition-colors line-clamp-2">
            {product.name}
          </h3>
        </Link>

        {/* 產地 */}
        {product.origin && (
          <p className="text-xs text-earth-500 mb-2">
            產地：{product.origin}
          </p>
        )}

        {/* 規格（如有） */}
        {product.weight && (
          <p className="text-xs text-earth-400 mb-2">{product.weight}</p>
        )}

        {/* 價格 */}
        <div className="mt-auto">
          <div className="flex items-end gap-1.5 mb-3">
            <span className="text-lg font-bold text-earth-800">
              NT$ {channelPrice.toLocaleString()}
            </span>
            <span className="text-xs text-earth-400 mb-0.5">/ {product.unit}</span>
          </div>

          {/* 行動按鈕 */}
          {showAddToCart && (
            <div className="flex gap-2">
              <button
                onClick={(e) => {
                  e.preventDefault();
                  addItem(product, 1, 'sample');
                }}
                className="flex-1 text-xs border-2 border-leaf-500 text-leaf-600 hover:bg-leaf-50 font-medium py-2 px-2 rounded-lg transition-colors duration-200 active:scale-95"
              >
                加入樣品
              </button>
              <button
                onClick={(e) => {
                  e.preventDefault();
                  addItem(product, product.moq, 'order');
                }}
                className="flex-1 text-xs bg-leaf-500 hover:bg-leaf-600 text-white font-medium py-2 px-2 rounded-lg transition-colors duration-200 shadow-sm active:scale-95"
              >
                訂購
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
