'use client';

import { useState } from 'react';
import { useCart } from '@/components/CartContext';
import { createOrder, recordSales } from '@/lib/firebase';
import { CustomerInfo } from '@/lib/types';
import Link from 'next/link';

type Step = 'cart' | 'info' | 'payment' | 'done';

const EMPTY_CUSTOMER: CustomerInfo = {
  name: '', phone: '', email: '', address: '', company: '', taxId: '',
};

export default function CheckoutPage() {
  const { items, totalAmount, removeItem, updateQuantity, clearCart } = useCart();
  const [step, setStep] = useState<Step>('cart');
  const [customer, setCustomer] = useState<CustomerInfo>(EMPTY_CUSTOMER);
  const [paymentMethod, setPaymentMethod] = useState<'ecpay' | 'cod'>('cod');
  const [orderNote, setOrderNote] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [orderId, setOrderId] = useState('');

  const sampleItems = items.filter(i => i.type === 'sample');
  const orderItems = items.filter(i => i.type === 'order');
  const hasOrders = orderItems.length > 0;

  // 正式訂單才需填資料
  const handleProceed = () => {
    if (items.length === 0) return;
    setStep(hasOrders ? 'info' : 'payment');
  };

  const handleSubmit = async () => {
    setSubmitting(true);
    try {
      // 正式訂單才回寫 Firebase
      if (hasOrders) {
        const id = await createOrder({
          orderType: 'order',
          items: orderItems,
          customer,
          paymentMethod,
          totalAmount,
          status: 'pending',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          notes: orderNote,
        });
        // 回報銷售數量
        await recordSales(orderItems.map(i => ({ productId: i.product.id, quantity: i.quantity })));
        setOrderId(id);
      }

      if (paymentMethod === 'ecpay') {
        // 跳轉綠界付款（實際串接需呼叫後端產生表單）
        const res = await fetch('/api/payment/create', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ items, customer, totalAmount }),
        });
        const { paymentUrl } = await res.json();
        window.location.href = paymentUrl;
      } else {
        clearCart();
        setStep('done');
      }
    } catch (err) {
      console.error(err);
      alert('訂單送出失敗，請稍後再試。');
    } finally {
      setSubmitting(false);
    }
  };

  // ── 購物車空 ──
  if (items.length === 0 && step !== 'done') {
    return (
      <div className="max-w-2xl mx-auto px-4 py-20 text-center">
        <div className="text-6xl mb-6">🛒</div>
        <h2 className="section-title mb-4">購物車是空的</h2>
        <p className="text-earth-500 mb-8">先去瀏覽商品，加入想要的品項吧！</p>
        <Link href="/products" className="btn-primary">瀏覽商品目錄</Link>
      </div>
    );
  }

  // ── 完成頁 ──
  if (step === 'done') {
    return (
      <div className="max-w-2xl mx-auto px-4 py-20 text-center">
        <div className="text-6xl mb-6">✅</div>
        <h2 className="font-serif text-3xl font-bold text-earth-800 mb-4">訂單已送出！</h2>
        {orderId && <p className="text-sm text-earth-500 mb-2">訂單編號：{orderId}</p>}
        <p className="text-earth-600 mb-8">
          感謝您的訂購，我們將盡快為您安排出貨。
          {paymentMethod === 'cod' && '採貨到付款方式，收到貨品時再付款即可。'}
        </p>
        <Link href="/products" className="btn-primary">繼續購物</Link>
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-10">
      {/* 步驟指示 */}
      <div className="flex items-center justify-center gap-4 mb-10">
        {(['cart', 'info', 'payment'] as Step[]).map((s, i) => (
          <div key={s} className="flex items-center gap-2">
            <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold ${
              step === s ? 'bg-leaf-500 text-white' :
              ['cart', 'info', 'payment'].indexOf(step) > i ? 'bg-leaf-200 text-leaf-700' :
              'bg-brand-100 text-earth-400'
            }`}>
              {i + 1}
            </div>
            <span className={`text-sm hidden md:block ${step === s ? 'text-earth-800 font-medium' : 'text-earth-400'}`}>
              {['購物車確認', '填寫資料', '確認結帳'][i]}
            </span>
            {i < 2 && <div className="w-8 h-px bg-brand-200 mx-1" />}
          </div>
        ))}
      </div>

      {/* ── 步驟1：購物車 ── */}
      {step === 'cart' && (
        <div>
          <h1 className="section-title mb-8">購物車確認</h1>

          {sampleItems.length > 0 && (
            <div className="mb-8">
              <h2 className="font-semibold text-earth-700 mb-4 flex items-center gap-2">
                <span className="badge bg-brand-100 text-brand-700">樣品</span>
                樣品訂購 {sampleItems.length} 項
              </h2>
              <div className="space-y-3">
                {sampleItems.map(item => (
                  <CartItemRow key={`sample-${item.product.id}`} item={item}
                    onRemove={() => removeItem(item.product.id, 'sample')}
                    onUpdateQty={q => updateQuantity(item.product.id, 'sample', q)} />
                ))}
              </div>
            </div>
          )}

          {orderItems.length > 0 && (
            <div className="mb-8">
              <h2 className="font-semibold text-earth-700 mb-4 flex items-center gap-2">
                <span className="badge bg-leaf-100 text-leaf-700">訂購</span>
                正式訂購 {orderItems.length} 項
              </h2>
              <div className="space-y-3">
                {orderItems.map(item => (
                  <CartItemRow key={`order-${item.product.id}`} item={item}
                    onRemove={() => removeItem(item.product.id, 'order')}
                    onUpdateQty={q => updateQuantity(item.product.id, 'order', q)} />
                ))}
              </div>
            </div>
          )}

          <div className="bg-brand-50 rounded-xl p-5 flex items-center justify-between mb-6">
            <span className="font-semibold text-earth-700">合計</span>
            <span className="text-2xl font-bold text-earth-800">NT$ {totalAmount.toLocaleString()}</span>
          </div>

          <div className="flex gap-4">
            <Link href="/products" className="btn-outline flex-1 text-center">繼續選購</Link>
            <button onClick={handleProceed} className="btn-primary flex-1">
              {hasOrders ? '下一步：填寫資料' : '前往結帳'}
            </button>
          </div>
        </div>
      )}

      {/* ── 步驟2：填寫資料（正式訂單必填）── */}
      {step === 'info' && (
        <div>
          <h1 className="section-title mb-8">填寫收件資料</h1>
          <div className="card p-6 space-y-5">
            {[
              { key: 'name', label: '收件人姓名', placeholder: '王小明', required: true },
              { key: 'phone', label: '聯絡電話', placeholder: '0912-345-678', required: true },
              { key: 'email', label: '電子郵件', placeholder: 'name@example.com', required: true },
              { key: 'address', label: '收件地址', placeholder: '台北市信義區...', required: true },
              { key: 'company', label: '公司名稱（選填）', placeholder: '○○有限公司', required: false },
              { key: 'taxId', label: '統一編號（選填）', placeholder: '12345678', required: false },
            ].map(field => (
              <div key={field.key}>
                <label className="block text-sm font-medium text-earth-700 mb-1.5">
                  {field.label} {field.required && <span className="text-red-500">*</span>}
                </label>
                <input
                  type="text"
                  value={(customer as Record<string, string>)[field.key] || ''}
                  onChange={e => setCustomer(prev => ({ ...prev, [field.key]: e.target.value }))}
                  placeholder={field.placeholder}
                  className="w-full px-4 py-2.5 border border-brand-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-leaf-400"
                />
              </div>
            ))}
            <div>
              <label className="block text-sm font-medium text-earth-700 mb-1.5">備註</label>
              <textarea
                value={orderNote}
                onChange={e => setOrderNote(e.target.value)}
                placeholder="特殊要求或備註..."
                rows={3}
                className="w-full px-4 py-2.5 border border-brand-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-leaf-400 resize-none"
              />
            </div>
          </div>
          <div className="flex gap-4 mt-6">
            <button onClick={() => setStep('cart')} className="btn-outline flex-1">上一步</button>
            <button
              onClick={() => {
                if (!customer.name || !customer.phone || !customer.email || !customer.address) {
                  alert('請填寫必填欄位');
                  return;
                }
                setStep('payment');
              }}
              className="btn-primary flex-1"
            >
              下一步：確認付款
            </button>
          </div>
        </div>
      )}

      {/* ── 步驟3：確認付款 ── */}
      {step === 'payment' && (
        <div>
          <h1 className="section-title mb-8">確認結帳</h1>
          <div className="grid md:grid-cols-2 gap-6 mb-8">
            {/* 訂單摘要 */}
            <div className="card p-5">
              <h3 className="font-semibold text-earth-800 mb-4">訂單摘要</h3>
              <div className="space-y-2 text-sm text-earth-600 mb-4">
                {items.map(i => (
                  <div key={`${i.type}-${i.product.id}`} className="flex justify-between">
                    <span>{i.product.name} ×{i.quantity}</span>
                    <span>NT$ {(i.product.price * i.quantity).toLocaleString()}</span>
                  </div>
                ))}
              </div>
              <div className="border-t border-brand-100 pt-3 flex justify-between font-bold text-earth-800">
                <span>合計</span>
                <span>NT$ {totalAmount.toLocaleString()}</span>
              </div>
            </div>

            {/* 付款方式 */}
            <div className="card p-5">
              <h3 className="font-semibold text-earth-800 mb-4">付款方式</h3>
              <div className="space-y-3">
                {[
                  { id: 'cod', label: '貨到付款', desc: '自簽物流，收到貨再付款', icon: '🚚' },
                  { id: 'ecpay', label: '線上付款', desc: '信用卡 / ATM 轉帳（綠界）', icon: '💳' },
                ].map(opt => (
                  <label key={opt.id} className={`flex items-center gap-3 p-4 rounded-xl border-2 cursor-pointer transition-colors ${
                    paymentMethod === opt.id ? 'border-leaf-400 bg-leaf-50' : 'border-brand-200'
                  }`}>
                    <input type="radio" name="payment" value={opt.id}
                      checked={paymentMethod === opt.id}
                      onChange={() => setPaymentMethod(opt.id as 'cod' | 'ecpay')}
                      className="text-leaf-500" />
                    <span className="text-xl">{opt.icon}</span>
                    <div>
                      <div className="font-medium text-earth-800">{opt.label}</div>
                      <div className="text-xs text-earth-500">{opt.desc}</div>
                    </div>
                  </label>
                ))}
              </div>
            </div>
          </div>

          <div className="flex gap-4">
            <button onClick={() => setStep(hasOrders ? 'info' : 'cart')} className="btn-outline flex-1">上一步</button>
            <button
              onClick={handleSubmit}
              disabled={submitting}
              className="btn-primary flex-1 disabled:opacity-60"
            >
              {submitting ? '處理中...' : '確認送出訂單'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ── 購物車商品列 ──
function CartItemRow({
  item, onRemove, onUpdateQty,
}: {
  item: import('@/lib/types').CartItem;
  onRemove: () => void;
  onUpdateQty: (q: number) => void;
}) {
  return (
    <div className="card p-4 flex items-center gap-4">
      <img src={item.product.imageUrl} alt={item.product.name} className="w-16 h-16 object-cover rounded-lg bg-brand-50" />
      <div className="flex-1 min-w-0">
        <p className="font-medium text-earth-800 text-sm truncate">{item.product.name}</p>
        <p className="text-xs text-earth-500">NT$ {item.product.price.toLocaleString()} / {item.product.unit}</p>
      </div>
      <div className="flex items-center border border-brand-200 rounded-lg overflow-hidden">
        <button onClick={() => onUpdateQty(item.quantity - 1)} className="px-2.5 py-1.5 text-earth-600 hover:bg-brand-50 text-sm">－</button>
        <span className="px-3 py-1.5 text-earth-800 font-medium text-sm">{item.quantity}</span>
        <button onClick={() => onUpdateQty(item.quantity + 1)} className="px-2.5 py-1.5 text-earth-600 hover:bg-brand-50 text-sm">＋</button>
      </div>
      <span className="text-sm font-semibold text-earth-800 w-24 text-right">
        NT$ {(item.product.price * item.quantity).toLocaleString()}
      </span>
      <button onClick={onRemove} className="text-earth-300 hover:text-red-400 transition-colors p-1">
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
        </svg>
      </button>
    </div>
  );
}
