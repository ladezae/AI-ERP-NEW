'use client';

import Link from 'next/link';
import { useCart, ToastMessage } from './CartContext';

export default function ToastContainer() {
  const { toasts, dismissToast } = useCart();

  if (toasts.length === 0) return null;

  return (
    <div className="fixed top-20 right-4 z-[9999] flex flex-col gap-2 max-w-sm w-full pointer-events-none">
      {toasts.map(toast => (
        <ToastItem key={toast.id} toast={toast} onDismiss={() => dismissToast(toast.id)} />
      ))}
    </div>
  );
}

function ToastItem({ toast, onDismiss }: { toast: ToastMessage; onDismiss: () => void }) {
  return (
    <div
      className="pointer-events-auto bg-white rounded-xl shadow-lg border border-brand-200 p-4 animate-slide-in-right flex items-start gap-3"
      role="alert"
    >
      {/* 圖示 */}
      <div className={`flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center ${
        toast.type === 'success' ? 'bg-leaf-100 text-leaf-600' :
        toast.type === 'error' ? 'bg-red-100 text-red-600' :
        'bg-blue-100 text-blue-600'
      }`}>
        {toast.type === 'success' ? (
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
          </svg>
        ) : (
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
        )}
      </div>

      {/* 內容 */}
      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold text-earth-800">{toast.title}</p>
        {toast.productName && (
          <p className="text-xs text-earth-500 truncate">{toast.productName} {toast.description}</p>
        )}
        {toast.action && (
          <Link
            href={toast.action.href}
            className="inline-block mt-1.5 text-xs font-medium text-leaf-600 hover:text-leaf-700 underline underline-offset-2"
          >
            {toast.action.label} →
          </Link>
        )}
      </div>

      {/* 關閉 */}
      <button
        onClick={onDismiss}
        className="flex-shrink-0 text-earth-300 hover:text-earth-500 transition-colors p-0.5"
      >
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
        </svg>
      </button>
    </div>
  );
}
