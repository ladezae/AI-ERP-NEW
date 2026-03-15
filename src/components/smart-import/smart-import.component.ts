
import { ChangeDetectionStrategy, Component, inject, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { AiService } from '../../services/ai.service';
import { DataService } from '../../services/data.service';
import { Product, Supplier, Customer, Order, PurchaseOrder, Employee } from '../../models/erp.models';
import { read, utils, writeFile } from 'xlsx';

type ImportType = 'product' | 'supplier' | 'customer' | 'order' | 'purchase' | 'employee';
type ImportMode = 'standard' | 'ai';
type LogType = 'info' | 'success' | 'warning' | 'error';

interface ImportLog {
  timestamp: string;
  type: LogType;
  message: string;
  data?: any; // 用於儲存導致錯誤的原始資料，供除錯用
}

@Component({
  selector: 'app-smart-import',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CommonModule, FormsModule],
  templateUrl: './smart-import.component.html'
})
export class SmartImportComponent {
  private aiService = inject(AiService);
  private dataService = inject(DataService);

  // State
  activeStep = signal<1 | 2>(1);
  importType = signal<ImportType>('product');
  importMode = signal<ImportMode>('standard');
  
  inputText = signal('');
  isParsing = signal(false);
  progress = signal(0); // 0-100
  parsedData = signal<any[]>([]);
  parseError = signal('');
  importSuccess = signal(false);
  
  // Logs & Debugging
  logs = signal<ImportLog[]>([]);
  
  // Batch Processing State
  currentBatch = signal(0);
  totalBatches = signal(0);
  
  // Internal
  private rawFileJson: any[] | null = null;
  selectedFileName = signal('');
  
  // Constants
  readonly importTypes: {value: ImportType, label: string, desc: string}[] = [
    { value: 'product', label: '商品資料', desc: '庫存、價格與規格' },
    { value: 'supplier', label: '供應商資料', desc: '聯絡資訊與條款' },
    { value: 'customer', label: '客戶資料', desc: '客戶名單與地址' },
    { value: 'order', label: '訂單資料', desc: '銷售訂單紀錄' },
    { value: 'purchase', label: '採購資料', desc: '採購進貨紀錄' },
    { value: 'employee', label: '員工資料', desc: '員工與權限' }
  ];

  readonly COLUMN_MAPS: Record<ImportType, Record<string, string>> = {
      product: {
          '商品編號': 'id', '重點商品': 'keyProduct', '商品名稱': 'name', '庫存': 'stock', '安全庫存': 'safetyStock', 
          '分類': 'category', '單位': 'unit', '未稅售價': 'priceBeforeTax', '未稅成本': 'costBeforeTax',
          '供應商代碼': 'supplierCode', '產地': 'origin', '備註': 'notes',
          '控貨': 'controlStatus', '採購狀態': 'purchasingStatus', '有糖': 'sugar',
          '已挑揀': 'qualityConfirmed'
      },
      supplier: {
          '供應商代碼': 'code', '簡稱': 'shortName', '全名': 'fullName', '統編': 'taxId',
          '供應商類別': 'supplierCategory', // New field mapping
          '電話': 'phone', 'Email': 'email', '地址': 'address', '付款條件': 'paymentTerms',
          '是否應稅': 'taxType', '發票隨貨': 'invoiceRule'
      },
      customer: {
          '客戶編號': 'id', '簡稱': 'shortName', '全名': 'fullName', '統編': 'taxId',
          '電話': 'phone', '地址': 'address1', '負責業務': 'salesperson',
          '是否應稅': 'taxType',
          '付款條件': 'clientPaymentTerms', // Mapped for boolean
          '貨到通知': 'needsDeliveryNotification' // New
      },
      order: {
          '訂單編號': 'orderId', '訂單日期': 'orderDate', '客戶名稱': 'customerName', '客戶編號': 'customerId',
          '商品名稱': 'productName', '商品編號': 'productId', '數量': 'quantity', '金額': 'totalAmount', '狀態': 'status'
      },
      purchase: {
          '採購單號': 'purchaseId', '採購日期': 'purchaseDate', '供應商': 'supplierName',
          '商品': 'productId', '數量': 'quantity', '狀態': 'status'
      },
      employee: {
          '員工編號': 'id', '姓名': 'name', 'Email': 'email', '電話': 'phone',
          '部門': 'department', '職稱': 'jobTitle', '角色': 'roleName'
      }
  };

  private getSchemaDefinition(type: ImportType): string {
      switch(type) {
          case 'product':
              return `
                interface Product {
                  id: string; // Generate unique ID if missing
                  keyProduct: string; // A, B, C or empty
                  name: string;
                  stock: number;
                  safetyStock: number; // default 10
                  allocatedStock: number; // default 0
                  externalStock: number; // default 0
                  transitQuantity: number; // default 0
                  totalPickingQuantity: number; // default 0
                  category: string;
                  unit: string;
                  priceBeforeTax: number;
                  priceAfterTax: number; // calculate if missing (1.05 * before tax)
                  costBeforeTax: number;
                  costAfterTax: number; // calculate if missing
                  recommendedPrice: number; // calculate if missing (costAfterTax / 0.9)
                  supplierCode: string; 
                  supplierName: string; 
                  controlStatus: boolean; // default false (false=正常, true=控貨)
                  purchasingStatus: boolean; // default true (true=採購中, false=停止)
                  moq: number; // default 1
                  packageType: number; // default 1
                  isDiscontinued: boolean; // default false
                  qualityConfirmed: boolean; // default false (true=已挑揀)
                  origin: string;
                  sugar: boolean; // default false
                  shelfLife: string;
                  expiryNote: string;
                  highlightNote: string;
                  notes: string;
                  imageUrl: string; 
                  lastUpdated: string; 
                }
              `;
           default: return 'any';
      }
  }

  setImportMode(mode: ImportMode) {
      this.importMode.set(mode);
      this.reset(false);
  }
  
  onFileSelected(event: Event) {
    const input = event.target as HTMLInputElement;
    if (!input.files?.length) return;

    const file = input.files[0];
    this.selectedFileName.set(file.name);
    this.addLog('info', `已選擇檔案: ${file.name} (${(file.size / 1024).toFixed(2)} KB)`);
    this.readFile(file, input);
  }

  readFile(file: File, input: HTMLInputElement) {
    this.progress.set(10);
    this.addLog('info', '開始讀取檔案內容...');
    
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
          this.progress.set(30);
          const data = e.target?.result;
          const workbook = read(data, { type: 'array' });
          const firstSheetName = workbook.SheetNames[0];
          if (!firstSheetName) throw new Error("檔案中找不到工作表");

          const worksheet = workbook.Sheets[firstSheetName];
          this.rawFileJson = utils.sheet_to_json(worksheet);
          
          this.progress.set(50);
          this.addLog('success', `讀取成功，共 ${this.rawFileJson.length} 筆原始資料。`);
          
          if (this.importMode() === 'standard') {
              this.processStandardImport();
          } else {
              const csv = utils.sheet_to_csv(worksheet);
              this.inputText.set(csv);
              this.progress.set(0); // AI mode waits for user trigger
          }
          
          input.value = '';
          this.parseError.set(''); 
      } catch (err: any) {
          console.error('File Parsing Error:', err);
          this.parseError.set(`讀取失敗: ${err.message || '無法識別的檔案格式'}。`);
          this.addLog('error', `讀取失敗: ${err.message}`);
          this.progress.set(0);
          input.value = '';
      }
    };
    
    reader.onerror = () => {
       this.parseError.set('瀏覽器讀取檔案時發生錯誤。');
       this.addLog('error', 'FileReader 發生錯誤。');
       this.progress.set(0);
       input.value = '';
    };

    reader.readAsArrayBuffer(file);
  }

  downloadTemplate() {
      const type = this.importType();
      const map = this.COLUMN_MAPS[type];
      const headers = Object.keys(map);
      const data = [headers];
      const wb = utils.book_new();
      const ws = utils.aoa_to_sheet(data);
      ws['!cols'] = headers.map(() => ({ wch: 15 }));
      utils.book_append_sheet(wb, ws, "匯入範本");
      writeFile(wb, `${type}_template.xlsx`);
      this.addLog('info', `已下載 ${type} 匯入範本。`);
  }

  // 使用 async/await 與 setTimeout 來釋放 UI thread，讓進度條可以跑動
  async processStandardImport() {
      if (!this.rawFileJson || this.rawFileJson.length === 0) {
          this.parseError.set('檔案內容為空或無法讀取。');
          return;
      }

      this.isParsing.set(true);
      this.addLog('info', '開始解析標準格式資料...');
      
      const type = this.importType();
      const map = this.COLUMN_MAPS[type];
      const results: any[] = [];
      const total = this.rawFileJson.length;

      try {
          for (let i = 0; i < total; i++) {
              // 每處理 20 筆稍微暫停一下讓 UI 更新
              if (i % 20 === 0) {
                 this.progress.set(50 + Math.round((i / total) * 50));
                 await new Promise(resolve => setTimeout(resolve, 10));
              }

              const row = this.rawFileJson[i];
              const newItem: any = {};
              let hasData = false;
              const rowKeys = Object.keys(row);

              Object.keys(map).forEach(cnKey => {
                  const enKey = map[cnKey];
                  
                  // 1. 嘗試尋找中文標題 (Chinese Header Match)
                  let foundKey = rowKeys.find(k => k.trim() === cnKey.trim());
                  
                  // 2. 如果找不到，嘗試尋找英文標題 (English Key Match - Exact or Case-insensitive)
                  // 支援系統匯出的檔案或僅有英文標題的檔案
                  if (!foundKey) {
                      foundKey = rowKeys.find(k => k.trim() === enKey || k.trim().toLowerCase() === enKey.toLowerCase());
                  }

                  if (foundKey && row[foundKey] !== undefined) {
                      newItem[enKey] = row[foundKey];
                      hasData = true;
                  }
              });
              
              if (hasData) {
                  this.enrichStandardData(newItem, type);
                  results.push(newItem);
              } else {
                  this.addLog('warning', `第 ${i+1} 列無法識別有效欄位，已略過。`, row);
              }
          }

          this.parsedData.set(results);
          this.progress.set(100);
          
          if (results.length > 0) {
            this.activeStep.set(2);
            this.addLog('success', `解析完成！成功識別 ${results.length} 筆資料。`);
          } else {
            const msg = '無法從檔案中對應到有效欄位。請檢查 Excel 標題是否與範本一致，或確認是否選擇了正確的「資料類型」。';
            this.parseError.set(msg);
            this.addLog('error', msg);
          }
      } catch (e: any) {
          this.parseError.set('解析過程發生錯誤: ' + e.message);
          this.addLog('error', `解析例外錯誤: ${e.message}`);
      } finally {
          this.isParsing.set(false);
          setTimeout(() => this.progress.set(0), 1000);
      }
  }

  enrichStandardData(item: any, type: ImportType) {
      const randomSuffix = Math.floor(Math.random() * 10000).toString().padStart(4, '0');
      const todayStr = new Date().toISOString().split('T')[0];

      if (type === 'product') {
          if (!item.id) item.id = 'P' + randomSuffix;
          item.stock = Number(item.stock) || 0;
          item.safetyStock = Number(item.safetyStock) || 10;
          item.priceBeforeTax = Number(item.priceBeforeTax) || 0;
          item.priceAfterTax = Math.round(item.priceBeforeTax * 1.05);
          item.costBeforeTax = Number(item.costBeforeTax) || 0;
          item.costAfterTax = Math.round(item.costBeforeTax * 1.05);
          item.recommendedPrice = Math.round(item.costAfterTax / 0.9);
          item.lastUpdated = new Date().toISOString();
          
          // Boolean conversions from text inputs
          item.controlStatus = item.controlStatus === '控貨' || item.controlStatus === true;
          item.purchasingStatus = item.purchasingStatus !== '停止採購' && item.purchasingStatus !== '停止' && item.purchasingStatus !== false; // Default to true if missing
          item.sugar = item.sugar === '加糖' || item.sugar === '有糖' || item.sugar === true;
          item.isDiscontinued = item.isDiscontinued === '停售' || item.isDiscontinued === true;
          
          // New: qualityConfirmed
          const qc = item.qualityConfirmed;
          item.qualityConfirmed = (qc === '已挑揀' || qc === '是' || qc === true);
          
          // Key Product normalization
          if (!item.keyProduct || (item.keyProduct !== 'A' && item.keyProduct !== 'B' && item.keyProduct !== 'C')) {
              item.keyProduct = ''; // Reset if invalid
          }

          // Fill defaults for mandatory fields
          item.allocatedStock = 0; item.externalStock = 0;
          item.transitQuantity = 0;
          item.totalPickingQuantity = 0;
          item.supplierName = item.supplierName || '未知供應商';
          item.moq = 1; item.packageType = 1; 
          item.isCalculable = true;
      }
      else if (type === 'supplier') {
          if (!item.code) item.code = 'SUP-' + randomSuffix;
          if (!item.shortName && item.fullName) item.shortName = item.fullName;
          
          // Boolean conversions
          item.invoiceRule = item.invoiceRule === '是 (隨貨)' || item.invoiceRule === '是' || item.invoiceRule === true || item.invoiceRule === '隨貨';
          item.taxType = item.taxType === '應稅' || item.taxType === true || item.taxType === '是';
          
          if (!item.supplierCategory) item.supplierCategory = ''; // Default empty
      }
      else if (type === 'customer') {
          if (!item.id) item.id = 'CUST-' + randomSuffix;
          if (!item.shortName && item.fullName) item.shortName = item.fullName;
          
          // Customer Boolean Conversions
          item.taxType = item.taxType === '應稅' || item.taxType === true || item.taxType === '是';
          
          // Payment Terms boolean conversion
          const pTerms = item.clientPaymentTerms;
          item.clientPaymentTerms = (pTerms === '先匯款' || pTerms === '是' || pTerms === true || pTerms === 'Prepaid');

          // New: needsDeliveryNotification
          const nNotify = item.needsDeliveryNotification;
          item.needsDeliveryNotification = (nNotify === '是' || nNotify === 'Y' || nNotify === 'TRUE' || nNotify === true);
      }
      else if (type === 'order') {
          if (!item.orderId) item.orderId = `ORD-${todayStr.replace(/-/g, '')}-${randomSuffix}`;
          if (!item.orderDate) item.orderDate = todayStr;
          item.quantity = Number(item.quantity) || 1;
          item.totalAmount = Number(item.totalAmount) || 0;
          if (!item.status) item.status = '處理中';
          
          // Ensure boolean payment status
          item.paymentStatus = item.paymentStatus === '已付款' || item.paymentStatus === true; 
          
          // Ensure ordertaxType boolean
          item.ordertaxType = item.ordertaxType === '應稅' || item.ordertaxType === true; 
          item.manufacturingPriority = item.manufacturingPriority === '優先' || item.manufacturingPriority === '急件' || item.manufacturingPriority === true;
          
          // Link to customer if possible
          if (!item.customerId && item.customerName) {
              const cust = this.dataService.customers().find(c => c.shortName === item.customerName || c.fullName === item.customerName);
              if (cust) item.customerId = cust.id;
          }
          
          // Link to product if possible
          if (!item.productId && item.productName) {
              const prod = this.dataService.products().find(p => p.name === item.productName);
              if (prod) item.productId = prod.id;
          }
      }
      else if (type === 'purchase') {
          if (!item.purchaseId) item.purchaseId = `PO-${todayStr.replace(/-/g, '')}-${randomSuffix}`;
          if (!item.purchaseDate) item.purchaseDate = todayStr;
          item.quantity = Number(item.quantity) || 1;
      }
      else if (type === 'employee') {
          if (!item.id) item.id = 'EMP-' + randomSuffix;
          if (!item.status) item.status = 'Active';
          if (!item.joinDate) item.joinDate = todayStr;
          if (!item.roleName) item.roleName = '一般人員'; 
          if (!item.roleId) item.roleId = 'ROLE-000';
      }
  }

  async onAiParse() {
    if (!this.inputText().trim()) return;
    
    this.isParsing.set(true);
    this.parseError.set('');
    this.parsedData.set([]);
    this.progress.set(0);
    this.currentBatch.set(0);
    this.logs.set([]); // Clear previous logs
    this.addLog('info', '開始 AI 智慧解析...');

    const schema = this.getSchemaDefinition(this.importType());
    const BATCH_SIZE = 5; 
    
    let chunks: string[] = [];

    // 分割資料
    if (this.rawFileJson && this.rawFileJson.length > 0) {
        for (let i = 0; i < this.rawFileJson.length; i += BATCH_SIZE) {
            const chunkObj = this.rawFileJson.slice(i, i + BATCH_SIZE);
            chunks.push(JSON.stringify(chunkObj));
        }
    } else {
        chunks.push(this.inputText());
    }

    this.totalBatches.set(chunks.length);
    let allResults: any[] = [];

    try {
       for (let i = 0; i < chunks.length; i++) {
           this.currentBatch.set(i + 1);
           const progressPct = Math.round(((i + 1) / chunks.length) * 100);
           this.progress.set(progressPct);
           
           this.addLog('info', `正在處理第 ${i+1}/${chunks.length} 批次...`);
           
           const chunk = chunks[i];
           try {
               const result = await this.aiService.parseUnstructuredData(chunk, schema);
               if (Array.isArray(result)) {
                   allResults = [...allResults, ...result];
                   this.addLog('success', `批次 ${i+1} 完成，解析出 ${result.length} 筆資料。`);
               }
           } catch (batchErr: any) {
               this.addLog('error', `批次 ${i+1} 解析失敗`, { error: batchErr.message, chunkData: chunk });
           }
       }

       if (allResults.length > 0) {
           this.parsedData.set(allResults);
           this.activeStep.set(2);
           this.addLog('success', `AI 解析全部完成！共取得 ${allResults.length} 筆有效資料。`);
       } else {
           const msg = 'AI 無法識別有效資料，請檢查輸入內容是否過於模糊。';
           this.parseError.set(msg);
           this.addLog('error', msg);
       }
    } catch (err: any) {
        console.error("AI Global Error:", err);
        this.parseError.set(err.message);
        this.addLog('error', `嚴重錯誤: ${err.message}`);
    } finally {
        this.isParsing.set(false);
    }
  }

  // --- Logs & Utilities ---

  addLog(type: LogType, message: string, data?: any) {
      const newLog: ImportLog = {
          timestamp: new Date().toLocaleTimeString(),
          type,
          message,
          data
      };
      this.logs.update(prev => [...prev, newLog]);
  }

  // Generate Debug Report for AI Studio
  copyDebugInfo(log: ImportLog) {
      const report = `
[AI Studio Debug Report]
Type: ${this.importType()} Import Error
Timestamp: ${log.timestamp}
Message: ${log.message}
----------------------------------------
[Raw Data Context]
${JSON.stringify(log.data, null, 2)}
----------------------------------------
[Schema Definition]
${this.getSchemaDefinition(this.importType())}
`;
      navigator.clipboard.writeText(report).then(() => {
          alert('除錯報告已複製到剪貼簿！請貼給 AI Studio 進行分析。');
      });
  }

  onManualInput() {
    this.rawFileJson = null;
  }

  reset(full: boolean = true) {
      this.activeStep.set(1);
      this.parsedData.set([]);
      this.importSuccess.set(false);
      this.inputText.set('');
      this.rawFileJson = null;
      this.selectedFileName.set('');
      this.parseError.set('');
      this.logs.set([]);
      this.progress.set(0);
      this.currentBatch.set(0);
      this.totalBatches.set(0);
  }

  async confirmImport() {
      const data = this.parsedData();
      const type = this.importType();
      this.isParsing.set(true); // Reuse parsing flag for saving UI state
      this.addLog('info', `開始寫入 ${data.length} 筆資料至資料庫...`);
      
      try {
          // Simulate write delay for progress effect
          const total = data.length;
          for (let i = 0; i < total; i++) {
              if (i % 10 === 0) {
                   this.progress.set(Math.round((i / total) * 100));
                   await new Promise(r => setTimeout(r, 5));
              }
              const item = data[i];
              switch (type) {
                  case 'product': await this.dataService.addProduct(item as Product); break;
                  case 'supplier': await this.dataService.addSupplier(item as Supplier); break;
                  case 'customer': await this.dataService.addCustomer(item as Customer); break;
                  case 'order': await this.dataService.addOrder(item as Order); break;
                  case 'purchase': await this.dataService.addPurchaseOrder(item as PurchaseOrder); break;
                  case 'employee': await this.dataService.addEmployee(item as Employee); break;
              }
          }
          this.progress.set(100);
          this.importSuccess.set(true);
          this.addLog('success', '資料庫寫入完成。');
          setTimeout(() => { this.reset(); }, 3000);
      } catch (err: any) {
          console.error(err);
          this.parseError.set('匯入資料庫時發生錯誤。');
          this.addLog('error', `寫入失敗: ${err.message}`);
      } finally {
          this.isParsing.set(false);
      }
  }

  removeRow(index: number) {
      this.parsedData.update(data => data.filter((_, i) => i !== index));
      if (this.parsedData().length === 0) this.activeStep.set(1);
  }

  getObjectKeys(obj: any): string[] {
      return obj ? Object.keys(obj).slice(0, 6) : [];
  }
}
