'use client';

import { useState, useEffect } from 'react';
import { getAllOrders, updateOrderStatus, getAllChannelProducts, updateProductVisibility } from '@/lib/firebase';
import { Order, ChannelProduct as Product } from '@/lib/types';

type AdminTab = 'orders' | 'products';

const STATUS_LABELS: Record<string, string> = {
  pending: '待付款',
  paid: '已付款',
  processing: '備貨中',
  shipped: '已出貨',
  delivered: '已送達',
  cancelled: '已取消',
};

const STATUS_COLORS: Record<string, string> = {
  pending: 'bg-yellow-100 text-yellow-700',
  paid: 'bg-blue-100 text-blue-700',
  processing: 'bg-purple-100 text-purple-700',
  shipped: 'bg-orange-100 text-orange-700',
  delivered: 'bg-green-100 text-green-700',
  cancelled: 'bg-red-100 text-red-700',
};

export default function AdminPage() {
  const [authenticated, setAuthenticated] = useState(false);
  const [password, setPassword] = useState('');
  const [activeTab, setActiveTab] = useState<AdminTab>('orders');
  const [orders, setOrders] = useState<Order[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(false);

  const handleLogin = async () => {
    const res = await fetch('/api/admin/auth', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password }),
    });
    if (res.ok) {
      setAuthenticated(true);
      loadData();
    } else {
      alert('密碼錯誤');
    }
  };

  const loadData = async () => {
    setLoading(true);
    try {
      const [ordersData, productsData] = await Promise.all([
        getAllOrders(),
        getAllChannelProducts(),
      ]);
      setOrders(ordersData.sort((a, b) =>
        new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
      ));
      setProducts(productsData);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const handleUpdateStatus = async (orderId: string, status: string) => {
    await updateOrderStatus(orderId, status);
    setOrders(prev => prev.map(o => o.id === orderId ? { ...o, status: status as Order['status'] } : o));
  };

  const handleToggleVisibility = async (productId: string, current: boolean) => {
    await updateProductVisibility(productId, !current);
    setProducts(prev => prev.map(p => p.id === productId ? { ...p, visible: !current } : p));
  };

  // ── 登入頁 ──
  if (!authenticated) {
    return (
      <div className="min-h-screen bg-cream flex items-center justify-center px-4">
        <div className="card p-8 w-full max-w-sm">
          <div className="text-center mb-6">
            <div className="w-14 h-14 bg-leaf-500 rounded-full flex items-center justify-center mx-auto mb-3">
              <span className="text-white font-serif font-bold text-2xl">吉</span>
            </div>
            <h1 className="font-serif text-xl font-bold text-earth-800">後台管理</h1>
            <p className="text-sm text-earth-500">一吉水果乾批發</p>
          </div>
          <div className="space-y-4">
            <input
              type="password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleLogin()}
              placeholder="請輸入管理密碼"
              className="w-full px-4 py-3 border border-brand-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-leaf-400"
            />
            <button onClick={handleLogin} className="btn-primary w-full">登入</button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-brand-50">
      {/* 後台頂部 */}
      <div className="bg-earth-800 text-white px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 bg-leaf-500 rounded-full flex items-center justify-center text-sm font-bold">吉</div>
          <span className="font-semibold">後台管理系統</span>
        </div>
        <div className="flex items-center gap-4">
          <a href="/" target="_blank" className="text-earth-300 hover:text-white text-sm">前往官網 →</a>
          <button onClick={() => setAuthenticated(false)} className="text-earth-300 hover:text-white text-sm">登出</button>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* 統計卡片 */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
          {[
            { label: '總訂單', value: orders.length, icon: '📦' },
            { label: '待處理', value: orders.filter(o => o.status === 'pending' || o.status === 'paid').length, icon: '⏳' },
            { label: '已出貨', value: orders.filter(o => o.status === 'shipped').length, icon: '🚚' },
            { label: '已完成', value: orders.filter(o => o.status === 'delivered').length, icon: '✅' },
          ].map(stat => (
            <div key={stat.label} className="card p-5 text-center">
              <div className="text-3xl mb-2">{stat.icon}</div>
              <div className="text-2xl font-bold text-earth-800">{stat.value}</div>
              <div className="text-sm text-earth-500">{stat.label}</div>
            </div>
          ))}
        </div>

        {/* 分頁 Tab */}
        <div className="flex gap-2 mb-6">
          {(['orders', 'products'] as AdminTab[]).map(tab => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`px-5 py-2.5 rounded-lg font-medium text-sm transition-colors ${
                activeTab === tab ? 'bg-earth-700 text-white' : 'bg-white text-earth-700 hover:bg-brand-100'
              }`}
            >
              {tab === 'orders' ? '📋 訂單管理' : '🛍️ 商品顯示管理'}
            </button>
          ))}
          <button onClick={loadData} className="ml-auto text-sm text-earth-500 hover:text-earth-700 flex items-center gap-1">
            🔄 重新整理
          </button>
        </div>

        {/* ── 訂單管理 ── */}
        {activeTab === 'orders' && (
          <div className="space-y-4">
            {loading ? (
              <div className="card p-8 text-center text-earth-400">載入中...</div>
            ) : orders.length === 0 ? (
              <div className="card p-12 text-center text-earth-400">
                <div className="text-5xl mb-4">📭</div>
                <p>尚無訂單資料</p>
              </div>
            ) : orders.map(order => (
              <div key={order.id} className="card p-5">
                <div className="flex flex-wrap items-start justify-between gap-4 mb-4">
                  <div>
                    <div className="flex items-center gap-2 mb-1">
                      <span className="font-mono text-sm text-earth-500">#{order.id?.substring(0, 8)}</span>
                      <span className={`badge ${STATUS_COLORS[order.status]}`}>
                        {STATUS_LABELS[order.status]}
                      </span>
                      <span className="badge bg-brand-100 text-brand-700">
                        {order.orderType === 'sample' ? '樣品' : '正式訂購'}
                      </span>
                    </div>
                    <p className="text-sm text-earth-500">
                      {new Date(order.createdAt).toLocaleString('zh-TW')}
                    </p>
                  </div>
                  <div className="text-right">
                    <div className="font-bold text-earth-800">NT$ {order.totalAmount.toLocaleString()}</div>
                    <div className="text-xs text-earth-500">{order.paymentMethod === 'cod' ? '貨到付款' : '線上付款'}</div>
                  </div>
                </div>

                {/* 訂購品項 */}
                <div className="bg-brand-50 rounded-lg p-3 mb-4">
                  {order.items.map((item, i) => (
                    <div key={i} className="flex justify-between text-sm py-1">
                      <span className="text-earth-700">{item.product.name} × {item.quantity}</span>
                      <span className="text-earth-500">NT$ {(item.product.price * item.quantity).toLocaleString()}</span>
                    </div>
                  ))}
                </div>

                {/* 客戶資料 */}
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm text-earth-600 mb-4">
                  <div>👤 {order.customer.name}</div>
                  <div>📞 {order.customer.phone}</div>
                  <div>📧 {order.customer.email}</div>
                  <div>📍 {order.customer.address}</div>
                </div>

                {/* 狀態更新 */}
                <div className="flex gap-2 flex-wrap">
                  {Object.entries(STATUS_LABELS).map(([status, label]) => (
                    <button
                      key={status}
                      onClick={() => handleUpdateStatus(order.id!, status)}
                      disabled={order.status === status}
                      className={`text-xs px-3 py-1.5 rounded-lg border transition-colors ${
                        order.status === status
                          ? 'bg-earth-100 text-earth-400 border-earth-100 cursor-not-allowed'
                          : 'border-brand-200 text-earth-600 hover:bg-brand-100'
                      }`}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}

        {/* ── 商品顯示管理 ── */}
        {activeTab === 'products' && (
          <div className="card overflow-hidden">
            <table className="w-full">
              <thead className="bg-brand-50 border-b border-brand-100">
                <tr>
                  <th className="text-left px-5 py-3 text-sm font-semibold text-earth-700">商品</th>
                  <th className="text-left px-5 py-3 text-sm font-semibold text-earth-700 hidden md:table-cell">分類</th>
                  <th className="text-left px-5 py-3 text-sm font-semibold text-earth-700 hidden md:table-cell">參考價</th>
                  <th className="text-center px-5 py-3 text-sm font-semibold text-earth-700">官網顯示</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-brand-100">
                {products.map(p => (
                  <tr key={p.id} className="hover:bg-brand-50/50 transition-colors">
                    <td className="px-5 py-3">
                      <div className="flex items-center gap-3">
                        <img src={p.imageUrl} alt={p.name} className="w-10 h-10 rounded-lg object-cover bg-brand-100" />
                        <div>
                          <p className="font-medium text-earth-800 text-sm">{p.name}</p>
                          <p className="text-xs text-earth-500 font-mono">{p.id}</p>
                        </div>
                      </div>
                    </td>
                    <td className="px-5 py-3 hidden md:table-cell">
                      <span className="badge bg-leaf-100 text-leaf-700">{p.category}</span>
                    </td>
                    <td className="px-5 py-3 hidden md:table-cell text-sm text-earth-700">
                      NT$ {p.price.toLocaleString()}
                    </td>
                    <td className="px-5 py-3 text-center">
                      <button
                        onClick={() => handleToggleVisibility(p.id, p.visible)}
                        className={`relative inline-flex h-6 w-11 rounded-full transition-colors ${
                          p.visible ? 'bg-leaf-500' : 'bg-brand-200'
                        }`}
                      >
                        <span className={`inline-block h-5 w-5 rounded-full bg-white shadow transform transition-transform mt-0.5 ${
                          p.visible ? 'translate-x-5' : 'translate-x-0.5'
                        }`} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
