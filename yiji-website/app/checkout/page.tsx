'use client';

import { useState, useMemo } from 'react';
import { useCart } from '@/components/CartContext';
import { createOrder, recordSales } from '@/lib/firebase';
import { CustomerInfo } from '@/lib/types';
import Link from 'next/link';

type Step = 'cart' | 'info' | 'payment' | 'done';

const EMPTY_CUSTOMER: CustomerInfo = {
  name: '', phone: '', email: '', address: '', company: '', taxId: '',
};

// 表單欄位定義
const FORM_FIELDS = [
  { key: 'name', label: '收件人姓名', placeholder: '王小明', required: true, type: 'text' },
  { key: 'phone', label: '聯絡電話', placeholder: '0912-345-678', required: true, type: 'tel' },
  { key: 'email', label: '電子郵件', placeholder: 'name@example.com', required: true, type: 'email' },
  { key: 'address', label: '收件地址', placeholder: '台北市信義區...', required: true, type: 'text' },
] as const;

const B2B_FIELDS = [
  { key: 'company', label: '公司名稱', placeholder: '○○有限公司', required: false, type: 'text' },
  { key: 'taxId', label: '統一編號', placeholder: '12345678', required: false, type: 'text' },
] as const;

export default function CheckoutPage() {
  const { items, totalAmount, removeItem, updateQuantity, clearCart } = useCart();
  const [step, setStep] = useState<Step>('cart');
  const [customer, setCustomer] = useState<CustomerInfo>(EMPTY_CUSTOMER);
  const [paymentMethod, setPaymentMethod] = useState<'ecpay' | 'cod'>('cod');
  const [orderNote, setOrderNote] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [orderId, setOrderId] = useState('');
  const [isB2B, setIsB2B] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  const sampleItems = useMemo(() => items.filter(i => i.type === 'sample'), [items]);
  const orderItems = useMemo(() => items.filter(i => i.type === 'order'), [items]);
  const hasOrders = orderItems.length > 0;

  const sampleTotal = useMemo(
    () => sampleItems.reduce((sum, i) => sum + i.product.price * i.quantity, 0),
    [sampleItems]
  );
  const orderTotal = useMemo(
    () => orderItems.reduce((sum, i) => sum + i.product.price * i.quantity, 0),
    [orderItems]
  );

  // 正式訂單才需填資料
  const handleProceed = () => {
    if (items.length === 0) return;
    setStep(hasOrders ? 'info' : 'payment');
  };

  // 表單驗證
  const validateForm = (): boolean => {
    const errors: Record<string, string> = {};

    if (!customer.name.trim()) errors.name = '請填寫收件人姓名';
    if (!customer.phone.trim()) errors.phone = '請填寫聯絡電話';
    else if (!/^0\d{8,9}$/.test(customer.phone.replace(/-/g, '')))
      errors.phone = '請輸入正確的電話格式';

    if (!customer.email.trim()) errors.email = '請填寫電子郵件';
    else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(customer.email))
      errors.email = '請輸入正確的 Email 格式';

    if (!customer.address.trim()) errors.address = '請填寫收件地址';

    if (isB2B && customer.taxId && !/^\d{8}$/.test(customer.taxId))
      errors.taxId = '統一編號應為 8 碼數字';

    setFieldErrors(errors);
    return Object.keys(errors).length === 0;
  };

  const handleInfoNext = () => {
    if (validateForm()) {
      setStep('payment');
    }
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
          channelId: 'yiji',
        });
        // 回報銷售數量
        await recordSales(orderItems.map(i => ({ productId: i.product.id, quantity: i.quantity, orderId: id })));
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
        <div className="w-20 h-20 bg-brand-50 rounded-full flex items-center justify-center mx-auto mb-6">
          <svg className="w-10 h-10 text-earth-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
              d="M3 3h2l.4 2M7 13h10l4-8H5.4M7 13L5.4 5M7 13l-2.293 2.293c-.63.63-.184 1.707.707 1.707H17m0 0a2 2 0 100 4 2 2 0 000-4zm-8 2a2 2 0 11-4 0 2 2 0 014 0z" />
          </svg>
        </div>
        <h2 className="section-title mb-4">購物車是空的</h2>
        <p className="text-earth-500 mb-8">先去瀏覽商品，加入想要的品項吧！</p>
        <Link href="/products" className="btn-primary inline-block">瀏覽商品目錄</Link>
      </div>
    );
  }

  // ── 完成頁 ──
  if (step === 'done') {
    return (
      <div className="max-w-2xl mx-auto px-4 py-20 text-center">
        <div className="w-20 h-20 bg-leaf-100 rounded-full flex items-center justify-center mx-auto mb-6">
          <svg className="w-10 h-10 text-leaf-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
          </svg>
        </div>
        <h2 className="font-serif text-3xl font-bold text-earth-800 mb-4">訂單已送出！</h2>
        {orderId && (
          <div className="inline-block bg-brand-50 rounded-lg px-4 py-2 mb-4">
            <p className="text-sm text-earth-500">訂單編號</p>
            <p className="font-mono font-medium text-earth-800">{orderId}</p>
          </div>
        )}
        <p className="text-earth-600 mb-8 leading-relaxed">
          感謝您的訂購，我們將盡快為您安排出貨。
          {paymentMethod === 'cod' && <><br />採貨到付款方式，收到貨品時再付款即可。</>}
        </p>
        <div className="flex gap-4 justify-center">
          <Link href="/products" className="btn-primary">繼續購物</Link>
          <Link href="/" className="btn-outline">回首頁</Link>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-8 md:py-10">
      {/* 步驟指示器 */}
      <StepIndicator currentStep={step} hasOrders={hasOrders} />

      {/* ── 步驟1：購物車 ── */}
      {step === 'cart' && (
        <div>
          <h1 className="section-title mb-6">購物車確認</h1>

          {sampleItems.length > 0 && (
            <div className="mb-8">
              <div className="flex items-center gap-2 mb-4">
                <span className="inline-flex items-center px-3 py-1 rounded-full text-xs font-medium bg-brand-100 text-brand-700">樣品</span>
                <h2 className="font-semibold text-earth-700">樣品訂購 {sampleItems.length} 項</h2>
              </div>
              <div className="space-y-3">
                {sampleItems.map(item => (
                  <CartItemRow key={`sample-${item.product.id}`} item={item}
                    onRemove={() => removeItem(item.product.id, 'sample')}
                    onUpdateQty={q => updateQuantity(item.product.id, 'sample', q)} />
                ))}
              </div>
              <div className="text-right mt-3 text-sm text-earth-500">
                樣品小計：<span className="font-semibold text-earth-700">NT$ {sampleTotal.toLocaleString()}</span>
              </div>
            </div>
          )}

          {orderItems.length > 0 && (
            <div className="mb-8">
              <div className="flex items-center gap-2 mb-4">
                <span className="inline-flex items-center px-3 py-1 rounded-full text-xs font-medium bg-leaf-100 text-leaf-700">訂購</span>
                <h2 className="font-semibold text-earth-700">正式訂購 {orderItems.length} 項</h2>
              </div>
              <div className="space-y-3">
                {orderItems.map(item => (
                  <CartItemRow key={`order-${item.product.id}`} item={item}
                    onRemove={() => removeItem(item.product.id, 'order')}
                    onUpdateQty={q => updateQuantity(item.product.id, 'order', q)} />
                ))}
              </div>
              <div className="text-right mt-3 text-sm text-earth-500">
                訂購小計：<span className="font-semibold text-earth-700">NT$ {orderTotal.toLocaleString()}</span>
              </div>
            </div>
          )}

          {/* 合計 */}
          <div className="bg-brand-50 rounded-xl p-5 flex items-center justify-between mb-6">
            <div>
              <span className="font-semibold text-earth-700">合計</span>
              <span className="text-xs text-earth-500 ml-2">（共 {items.reduce((s, i) => s + i.quantity, 0)} 件）</span>
            </div>
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
          <h1 className="section-title mb-2">填寫收件資料</h1>
          <p className="text-earth-500 text-sm mb-6">請填寫出貨所需的基本資訊</p>

          {/* B2B / B2C 切換 */}
          <div className="flex gap-3 mb-6">
            <button
              onClick={() => setIsB2B(false)}
              className={`flex-1 p-4 rounded-xl border-2 text-left transition-colors ${
                !isB2B ? 'border-leaf-400 bg-leaf-50' : 'border-brand-200 hover:border-brand-300'
              }`}
            >
              <div className="flex items-center gap-2 mb-1">
                <span className="text-lg">🧑</span>
                <span className="font-medium text-earth-800">個人購買</span>
              </div>
              <p className="text-xs text-earth-500">零售散客、一般消費者</p>
            </button>
            <button
              onClick={() => setIsB2B(true)}
              className={`flex-1 p-4 rounded-xl border-2 text-left transition-colors ${
                isB2B ? 'border-leaf-400 bg-leaf-50' : 'border-brand-200 hover:border-brand-300'
              }`}
            >
              <div className="flex items-center gap-2 mb-1">
                <span className="text-lg">🏢</span>
                <span className="font-medium text-earth-800">公司行號</span>
              </div>
              <p className="text-xs text-earth-500">批發採購、需開發票</p>
            </button>
          </div>

          <div className="card p-6 space-y-5">
            {/* 基本欄位 */}
            {FORM_FIELDS.map(field => (
              <FormField
                key={field.key}
                field={field}
                value={(customer as unknown as Record<string, string>)[field.key] || ''}
                error={fieldErrors[field.key]}
                onChange={val => {
                  setCustomer(prev => ({ ...prev, [field.key]: val }));
                  if (fieldErrors[field.key]) {
                    setFieldErrors(prev => {
                      const next = { ...prev };
                      delete next[field.key];
                      return next;
                    });
                  }
                }}
              />
            ))}

            {/* B2B 額外欄位 */}
            {isB2B && (
              <div className="border-t border-brand-100 pt-5 space-y-5">
                <p className="text-xs text-earth-500 font-medium">公司/營業資料</p>
                {B2B_FIELDS.map(field => (
                  <FormField
                    key={field.key}
                    field={field}
                    value={(customer as unknown as Record<string, string>)[field.key] || ''}
                    error={fieldErrors[field.key]}
                    onChange={val => {
                      setCustomer(prev => ({ ...prev, [field.key]: val }));
                      if (fieldErrors[field.key]) {
                        setFieldErrors(prev => {
                          const next = { ...prev };
                          delete next[field.key];
                          return next;
                        });
                      }
                    }}
                  />
                ))}
              </div>
            )}

            {/* 備註 */}
            <div>
              <label className="block text-sm font-medium text-earth-700 mb-1.5">備註</label>
              <textarea
                value={orderNote}
                onChange={e => setOrderNote(e.target.value)}
                placeholder="特殊要求或備註...（如：指定到貨時間、包裝需求等）"
                rows={3}
                className="w-full px-4 py-2.5 border border-brand-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-leaf-400 resize-none text-sm"
              />
            </div>
          </div>

          <div className="flex gap-4 mt-6">
            <button onClick={() => setStep('cart')} className="btn-outline flex-1">上一步</button>
            <button onClick={handleInfoNext} className="btn-primary flex-1">
              下一步：確認付款
            </button>
          </div>
        </div>
      )}

      {/* ── 步驟3：確認付款 ── */}
      {step === 'payment' && (
        <div>
          <h1 className="section-title mb-6">確認結帳</h1>
          <div className="grid md:grid-cols-2 gap-6 mb-8">
            {/* 訂單摘要 */}
            <div className="card p-5">
              <h3 className="font-semibold text-earth-800 mb-4 flex items-center gap-2">
                <svg className="w-5 h-5 text-leaf-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
                </svg>
                訂單摘要
              </h3>
              <div className="space-y-2 text-sm text-earth-600 mb-4">
                {items.map(i => (
                  <div key={`${i.type}-${i.product.id}`} className="flex justify-between">
                    <span className="flex items-center gap-1.5">
                      <span className={`w-1.5 h-1.5 rounded-full ${i.type === 'sample' ? 'bg-brand-400' : 'bg-leaf-500'}`} />
                      {i.product.name} x{i.quantity}
                    </span>
                    <span className="font-medium">NT$ {(i.product.price * i.quantity).toLocaleString()}</span>
                  </div>
                ))}
              </div>
              <div className="border-t border-brand-100 pt-3 flex justify-between font-bold text-earth-800">
                <span>合計</span>
                <span className="text-lg">NT$ {totalAmount.toLocaleString()}</span>
              </div>
            </div>

            {/* 付款方式 */}
            <div className="card p-5">
              <h3 className="font-semibold text-earth-800 mb-4 flex items-center gap-2">
                <svg className="w-5 h-5 text-leaf-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z" />
                </svg>
                付款方式
              </h3>
              <div className="space-y-3">
                {[
                  { id: 'cod', label: '貨到付款', desc: '自簽物流，收到貨再付款', icon: '🚚' },
                  { id: 'ecpay', label: '線上付款', desc: '信用卡 / ATM 轉帳（綠界）', icon: '💳' },
                ].map(opt => (
                  <label key={opt.id} className={`flex items-center gap-3 p-4 rounded-xl border-2 cursor-pointer transition-colors ${
                    paymentMethod === opt.id ? 'border-leaf-400 bg-leaf-50' : 'border-brand-200 hover:border-brand-300'
                  }`}>
                    <input type="radio" name="payment" value={opt.id}
                      checked={paymentMethod === opt.id}
                      onChange={() => setPaymentMethod(opt.id as 'cod' | 'ecpay')}
                      className="text-leaf-500 w-4 h-4" />
                    <span className="text-xl">{opt.icon}</span>
                    <div>
                      <div className="font-medium text-earth-800">{opt.label}</div>
                      <div className="text-xs text-earth-500">{opt.desc}</div>
                    </div>
                  </label>
                ))}
              </div>

              {/* 收件人摘要（若有填寫） */}
              {hasOrders && customer.name && (
                <div className="mt-5 pt-4 border-t border-brand-100">
                  <p className="text-xs text-earth-500 mb-2">收件資訊</p>
                  <div className="text-sm text-earth-700 space-y-0.5">
                    <p>{customer.name} / {customer.phone}</p>
                    <p className="text-earth-500">{customer.address}</p>
                    {customer.company && <p className="text-earth-500">{customer.company} {customer.taxId}</p>}
                  </div>
                </div>
              )}
            </div>
          </div>

          <div className="flex gap-4">
            <button onClick={() => setStep(hasOrders ? 'info' : 'cart')} className="btn-outline flex-1">上一步</button>
            <button
              onClick={handleSubmit}
              disabled={submitting}
              className="btn-primary flex-1 disabled:opacity-60"
            >
              {submitting ? (
                <span className="flex items-center justify-center gap-2">
                  <svg className="animate-spin w-4 h-4" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                  </svg>
                  處理中...
                </span>
              ) : '確認送出訂單'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ── 步驟指示器元件 ──
function StepIndicator({ currentStep, hasOrders }: { currentStep: Step; hasOrders: boolean }) {
  const steps = hasOrders
    ? [
        { key: 'cart', label: '購物車' },
        { key: 'info', label: '填寫資料' },
        { key: 'payment', label: '確認結帳' },
      ]
    : [
        { key: 'cart', label: '購物車' },
        { key: 'payment', label: '確認結帳' },
      ];

  const currentIndex = steps.findIndex(s => s.key === currentStep);

  return (
    <div className="flex items-center justify-center mb-10">
      {steps.map((s, i) => (
        <div key={s.key} className="flex items-center">
          <div className="flex flex-col items-center">
            <div className={`w-9 h-9 rounded-full flex items-center justify-center text-sm font-bold transition-colors ${
              i === currentIndex
                ? 'bg-leaf-500 text-white shadow-md shadow-leaf-200'
                : i < currentIndex
                ? 'bg-leaf-100 text-leaf-700'
                : 'bg-brand-100 text-earth-400'
            }`}>
              {i < currentIndex ? (
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
                </svg>
              ) : (
                i + 1
              )}
            </div>
            <span className={`mt-1.5 text-xs whitespace-nowrap ${
              i === currentIndex ? 'text-earth-800 font-medium' : 'text-earth-400'
            }`}>
              {s.label}
            </span>
          </div>
          {i < steps.length - 1 && (
            <div className={`w-12 md:w-20 h-0.5 mx-2 mt-[-1rem] ${
              i < currentIndex ? 'bg-leaf-300' : 'bg-brand-200'
            }`} />
          )}
        </div>
      ))}
    </div>
  );
}

// ── 表單欄位元件 ──
function FormField({
  field,
  value,
  error,
  onChange,
}: {
  field: { key: string; label: string; placeholder: string; required: boolean; type: string };
  value: string;
  error?: string;
  onChange: (val: string) => void;
}) {
  return (
    <div>
      <label className="block text-sm font-medium text-earth-700 mb-1.5">
        {field.label} {field.required && <span className="text-red-500">*</span>}
      </label>
      <input
        type={field.type}
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder={field.placeholder}
        className={`w-full px-4 py-2.5 border rounded-xl focus:outline-none focus:ring-2 text-sm transition-colors ${
          error
            ? 'border-red-300 focus:ring-red-400 bg-red-50'
            : 'border-brand-200 focus:ring-leaf-400'
        }`}
      />
      {error && (
        <p className="mt-1 text-xs text-red-500 flex items-center gap-1">
          <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
            <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
          </svg>
          {error}
        </p>
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
    <div className="card p-4 flex items-center gap-3 md:gap-4">
      <img
        src={item.product.imageUrl || '/placeholder.jpg'}
        alt={item.product.name}
        className="w-14 h-14 md:w-16 md:h-16 object-cover rounded-lg bg-brand-50 flex-shrink-0"
      />
      <div className="flex-1 min-w-0">
        <p className="font-medium text-earth-800 text-sm truncate">{item.product.name}</p>
        <p className="text-xs text-earth-500">NT$ {item.product.price.toLocaleString()} / {item.product.unit}</p>
      </div>
      <div className="flex items-center border border-brand-200 rounded-lg overflow-hidden flex-shrink-0">
        <button onClick={() => onUpdateQty(item.quantity - 1)} className="px-2.5 py-2 text-earth-600 hover:bg-brand-50 text-sm active:bg-brand-100 transition-colors">－</button>
        <span className="px-3 py-2 text-earth-800 font-medium text-sm min-w-[2.5rem] text-center">{item.quantity}</span>
        <button onClick={() => onUpdateQty(item.quantity + 1)} className="px-2.5 py-2 text-earth-600 hover:bg-brand-50 text-sm active:bg-brand-100 transition-colors">＋</button>
      </div>
      <span className="text-sm font-semibold text-earth-800 w-20 md:w-24 text-right flex-shrink-0">
        NT$ {(item.product.price * item.quantity).toLocaleString()}
      </span>
      <button onClick={onRemove} className="text-earth-300 hover:text-red-400 transition-colors p-1 flex-shrink-0">
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
        </svg>
      </button>
    </div>
  );
}
