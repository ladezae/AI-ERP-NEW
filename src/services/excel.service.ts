
import { Injectable } from '@angular/core';
import { utils, writeFile } from 'xlsx';
import { Order } from '../models/erp.models';

@Injectable({
  providedIn: 'root'
})
export class ExcelService {

  constructor() { }

  /**
   * 將訂單群組匯出為 Excel
   * @param group 訂單群組資料
   */
  exportOrdersGroup(group: any) {
    // 1. 準備 Excel 資料結構 (Flatten Data)
    const data = group.items.map((item: Order) => ({
      '訂單單號': item.orderId,
      '訂單日期': item.orderDate,
      '客戶名稱': item.customerName,
      '客戶編號': item.customerId,
      '業務人員': item.salesperson,
      '商品名稱': item.productName,
      '商品編號': item.productId,
      '數量': item.quantity,
      '單價(未稅)': item.priceBeforeTax,
      '小計(未稅)': item.subtotal,
      '稅額': item.taxAmount,
      '總金額': item.totalAmount,
      '付款狀態': item.paymentStatus ? '已付款' : '未付款',
      '訂單狀態': item.status,
      '收件人': item.receiverName,
      '備註': item.productNote || ''
    }));

    // 2. 建立工作表 (Worksheet)
    const ws = utils.json_to_sheet(data);

    // 3. 設定欄位寬度 (Optional)
    const wscols = [
      { wch: 20 }, // A: 單號
      { wch: 12 }, // B: 日期
      { wch: 20 }, // C: 客戶
      { wch: 10 }, // D: 客戶ID
      { wch: 10 }, // E: 業務
      { wch: 25 }, // F: 商品
      { wch: 15 }, // G: 商品ID
      { wch: 8 },  // H: 數量
      { wch: 10 }, // I: 單價
      { wch: 10 }, // J: 小計
      { wch: 8 },  // K: 稅額
      { wch: 10 }, // L: 總額
      { wch: 10 }, // M: 付款
      { wch: 10 }, // N: 狀態
      { wch: 10 }, // O: 收件
      { wch: 20 }  // P: 備註
    ];
    ws['!cols'] = wscols;

    // 4. 建立活頁簿 (Workbook) 並加入工作表
    const wb = utils.book_new();
    utils.book_append_sheet(wb, ws, "訂單明細");

    // 5. 匯出檔案
    const fileName = `${group.baseOrderId}_${group.customerName}_export.xlsx`;
    writeFile(wb, fileName);
  }
}
