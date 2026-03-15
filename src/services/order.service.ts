import { inject, Injectable } from '@angular/core';
import { doc, updateDoc, setDoc } from 'firebase/firestore';
import { DataService } from './data.service';
import { db } from '../firebase.config';

@Injectable({
  providedIn: 'root'
})
export class OrderService {
  private dataService = inject(DataService);

  /**
   * 將 AI OCR 辨識結果寫入訂單，並更新狀態為「已出貨」
   * @param orderId ERP 系統中的訂單編號
   * @param provider 物流商 (例：黑貓)
   * @param trackingId 追蹤單號
   * @param trackingUrl 追蹤網址 (選填)
   */
  async updateOrderShippingInfo(orderId: string, provider: string, trackingId: string, trackingUrl: string = ''): Promise<void> {
    // 1. 先更新本地狀態 (DataService)
    const allOrders = this.dataService.orders();
    const orderIndex = allOrders.findIndex(o => o.orderId === orderId);
    
    if (orderIndex === -1) {
      throw new Error(`找不到訂單: ${orderId}`);
    }

    const order = allOrders[orderIndex];
    const updatedOrder = {
      ...order,
      status: '已出貨',
      shipLogistics: provider,
      shippingId: trackingId,
      trackingUrl: trackingUrl,
      shippedAt: new Date().toISOString()
    };

    // 更新 DataService 的 Signal
    this.dataService.orders.update(current => current.map(o => o.orderId === orderId ? updatedOrder : o));

    // 2. 同步至 Firestore (如果已連線)
    if (this.dataService.connectionStatus() === 'connected' && db) {
      try {
        const orderDocRef = doc(db, 'orders', orderId);
        await updateDoc(orderDocRef, {
          status: '已出貨',
          shipLogistics: provider,
          shippingId: trackingId,
          trackingUrl: trackingUrl,
          shippedAt: updatedOrder.shippedAt
        });
        console.log(`[AI ERP PIXEL] 訂單 ${orderId} 物流資訊更新成功！`);
      } catch (error) {
        console.error(`[AI ERP PIXEL] 更新 Firebase 失敗:`, error);
        // 如果 updateDoc 失敗，嘗試 setDoc (以防文件不存在)
        try {
           await setDoc(doc(db, 'orders', orderId), updatedOrder);
        } catch (e) {
           throw new Error('無法更新訂單狀態，請檢查資料庫權限或連線狀態。');
        }
      }
    }
  }
}
