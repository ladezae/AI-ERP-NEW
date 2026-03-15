
import { ChangeDetectionStrategy, Component, inject, signal, computed, effect, output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { DataService } from '../../services/data.service';
import { AiService } from '../../services/ai.service';
import { ViewType } from '../../models/erp.models';
import { MetricDefinition, Product, Order, Supplier, Task } from '../../models/erp.models';
import { TaiwanDatePipe } from '../../pipes/taiwan-date.pipe';

@Component({
  selector: 'app-dashboard',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CommonModule, TaiwanDatePipe],
  styles: [`:host { display: block; height: 100%; }`],
  templateUrl: './dashboard.component.html'
})
export class DashboardComponent {
  dataService = inject(DataService);
  private aiService = inject(AiService);

  navigate = output<ViewType>();

  // --- Metadata Driven Setup ---
  activeDefinitions = computed(() => 
      this.dataService.metricDefinitions().filter(d => d.showOnDashboard)
  );

  // 2. Real-time Calculation Engine (Using Centralized Logic)
  calculatedValues = computed(() => {
      const defs = this.activeDefinitions();
      const results: Record<string, string | number> = {};
      
      defs.forEach(def => {
          results[def.id] = this.dataService.evaluateFormula(def.formula);
      });
      
      return results;
  });

  // 3. Group them by category for layout
  dashboardGroups = computed(() => {
      const defs = this.activeDefinitions();
      const groups: Record<string, MetricDefinition[]> = {};
      
      defs.forEach(d => {
          if (!groups[d.category]) {
              groups[d.category] = [];
          }
          groups[d.category].push(d);
      });

      // Define standard order (Grouped by Business Function)
      // Sales Group: Order -> Shipping -> Customer
      // Purchase Group: Purchase -> Supplier -> Inventory
      const order = [
          'Finance', 
          'Order', 
          'ShippingOrder',
          'Customer',
          'PurchaseOrder', 
          'Supplier', 
          'Inventory', 
          'Product', 
          'Manufacturing', 
          'Employee', 
          'Other'
      ];
      
      return order
          .filter(cat => groups[cat] && groups[cat].length > 0)
          .map(cat => ({ category: cat, items: groups[cat] }));
  });

  // New: Active Tasks Widget Data (General Overview)
  activeTasks = computed(() => {
      // Get incomplete tasks, sort by Priority High -> Low, then date
      return this.dataService.tasks()
          .filter(t => t.status !== 'Completed' && t.status !== 'Archived')
          .sort((a, b) => {
              const pScore = { 'High': 3, 'Medium': 2, 'Low': 1 };
              const diff = pScore[b.priority] - pScore[a.priority];
              if (diff !== 0) return diff;
              return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
          })
          .slice(0, 5); // Top 5
  });

  // Unread Tasks for Modal (User specific)
  myUnreadTasks = this.dataService.myUnreadTasks;

  // Latest Publish Time
  publishTime = signal<string>(new Date().toLocaleString('zh-TW', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false
  }));

  aiInsight = signal<string>('');
  isGeneratingInsight = signal(false);
  isInsightExpanded = signal(false); // New: Control card expansion
  
  // Demo Data Gen State
  isGeneratingDemo = signal(false);

  // --- Drill Down State ---
  showDrillDownModal = signal(false);
  drillDownTitle = signal('');
  drillDownItems = signal<any[]>([]);
  drillDownType = signal<'Order' | 'Product' | 'PurchaseOrder' | 'Other'>('Other');

  constructor() {}

  onQuickNavigate(view: ViewType) {
      this.navigate.emit(view);
  }
  
  goToSettings() {
      this.navigate.emit('system');
  }
  
  refreshData() {
      this.dataService.refreshAll();
  }
  
  // New: Attempt to reconnect or prompt user
  checkConnection() {
      if (this.dataService.connectionStatus() === 'mock') {
          if (confirm('您目前處於本機模擬模式 (Mock Mode)。\n\n這表示您的資料僅儲存於此瀏覽器，無法跨電腦同步。\n\n若您希望同步資料，請確認 src/firebase.config.ts 中的設定是否正確。\n\n是否嘗試重新連線？')) {
              this.dataService.loadDataFromFirebase();
          }
      } else if (this.dataService.connectionStatus() === 'connected') {
          this.dataService.refreshAll();
      }
  }
  
  // New Method to trigger data generation from empty state banner
  async generateDemoData() {
      if (this.isGeneratingDemo()) return;
      
      if (confirm('確定要生成演示資料嗎？\n(將會建立商品、客戶、訂單等範例數據，若已連線雲端將同步寫入)')) {
          this.isGeneratingDemo.set(true);
          try {
              await this.dataService.loadMockData();
              alert('資料生成完畢！');
          } catch(e) {
              console.error(e);
              alert('資料生成部分失敗，請檢查連線。');
          } finally {
              this.isGeneratingDemo.set(false);
          }
      }
  }
  
  // NEW: Quick action to open Mobile Purchase Review flow (Direct App Mode)
  goToPurchaseReview() {
      // Set the intent to open 'purchase' module in mobile layout
      this.dataService.autoOpenMobileModule.set('purchase');
      // Navigate to STANDALONE mobile layout view directly
      this.navigate.emit('standalone-mobile');
  }

  // NEW: Quick action to start order creation
  goToCreateOrder() {
      this.dataService.autoStartOrderWizard.set(true);
      this.navigate.emit('orders');
  }

  // NEW: Copy Direct Link
  copyPurchaseReviewLink(event: Event) {
      event.stopPropagation();
      const baseUrl = window.location.origin + window.location.pathname;
      const link = `${baseUrl}#purchase-review`;
      
      navigator.clipboard.writeText(link).then(() => {
          alert('已複製採購審核專用連結！\n您可以在瀏覽器直接開啟此連結進入 App 模式。');
      }).catch(err => {
          console.error('Failed to copy', err);
          prompt('請手動複製連結:', link);
      });
  }

  goToMobileQuote() {
      this.navigate.emit('mobile-quote' as any);
  }

  copyMobileQuoteLink(event: Event) {
      event.stopPropagation();
      const baseUrl = window.location.origin + window.location.pathname;
      const link = `${baseUrl}#mobile-quote`;
      navigator.clipboard.writeText(link).then(() => {
          alert('已複製手機報價連結！');
      }).catch(() => {
          prompt('請手動複製連結:', link);
      });
  }

  // NEW: Copy Create Order Link
  copyCreateOrderLink(event: Event) {
      event.stopPropagation();
      const baseUrl = window.location.origin + window.location.pathname;
      const link = `${baseUrl}#order-create`;
      
      navigator.clipboard.writeText(link).then(() => {
          alert('已複製新增訂單專用連結！\n您可以在瀏覽器直接開啟此連結進入快速下單模式。');
      }).catch(err => {
          console.error('Failed to copy', err);
          prompt('請手動複製連結:', link);
      });
  }

  markAsRead(task: Task) {
      this.dataService.markTaskAsRead(task.id);
  }

  goToTasksAndDismiss() {
      this.myUnreadTasks().forEach(task => this.dataService.markTaskAsRead(task.id));
      this.navigate.emit('tasks');
  }

  getCardColorClass(category: string): string {
      switch (category) {
          // Finance: Green (Emerald)
          case 'Finance': return 'border-emerald-500 text-emerald-700 bg-emerald-50 dark:bg-emerald-900/30 dark:text-emerald-400';
          
          // Sales Group: Blue/Cool Tones
          case 'Order': return 'border-blue-500 text-blue-700 bg-blue-50 dark:bg-blue-900/30 dark:text-blue-400';
          case 'ShippingOrder': return 'border-sky-500 text-sky-700 bg-sky-50 dark:bg-sky-900/30 dark:text-sky-400';
          case 'Customer': return 'border-indigo-500 text-indigo-700 bg-indigo-50 dark:bg-indigo-900/30 dark:text-indigo-400';
          
          // Purchase Group: Orange/Warm Tones
          case 'PurchaseOrder': return 'border-orange-500 text-orange-700 bg-orange-50 dark:bg-orange-900/30 dark:text-orange-400';
          case 'Supplier': return 'border-amber-500 text-amber-700 bg-amber-50 dark:bg-amber-900/30 dark:text-amber-400';
          case 'Inventory': return 'border-yellow-500 text-yellow-700 bg-yellow-50 dark:bg-yellow-900/30 dark:text-yellow-400';
          
          // Production: Purple
          case 'Manufacturing': return 'border-purple-500 text-purple-700 bg-purple-50 dark:bg-purple-900/30 dark:text-purple-400';
          
          // Product: Rose
          case 'Product': return 'border-rose-500 text-rose-700 bg-rose-50 dark:bg-rose-900/30 dark:text-rose-400';
          
          // HR: Teal
          case 'Employee': return 'border-teal-500 text-teal-700 bg-teal-50 dark:bg-teal-900/30 dark:text-teal-400';
          
          default: return 'border-slate-400 text-slate-700 bg-slate-50 dark:bg-slate-800 dark:text-slate-400';
      }
  }
  
  getCategoryHeaderColor(category: string): string {
      switch (category) {
          case 'Finance': return 'text-emerald-600 dark:text-emerald-400';
          
          case 'Order': return 'text-blue-600 dark:text-blue-400';
          case 'ShippingOrder': return 'text-sky-600 dark:text-sky-400';
          case 'Customer': return 'text-indigo-600 dark:text-indigo-400';
          
          case 'PurchaseOrder': return 'text-orange-600 dark:text-orange-400';
          case 'Supplier': return 'text-amber-600 dark:text-amber-400';
          case 'Inventory': return 'text-yellow-600 dark:text-yellow-400';
          
          case 'Manufacturing': return 'text-purple-600 dark:text-purple-400';
          case 'Product': return 'text-rose-600 dark:text-rose-400';
          case 'Employee': return 'text-teal-600 dark:text-teal-400';
          
          default: return 'text-slate-500 dark:text-slate-400';
      }
  }

  // Check if a card should have breathing animation
  // Condition: Category is 'PurchaseOrder' AND there are urgent POs in the system
  shouldAnimate(category: string): boolean {
      if (category !== 'PurchaseOrder') return false;
      return this.dataService.urgentPurchaseOrders().length > 0;
  }

  toggleInsight() {
      this.isInsightExpanded.update(v => !v);
  }

  async generateInsight() {
    if (this.isGeneratingInsight()) return;

    // Check for API Key first
    const hasKey = await this.aiService.ensureApiKey();
    if (!hasKey) return;

    this.isGeneratingInsight.set(true);
    this.isInsightExpanded.set(true); // Auto expand when generating
    
    // Build context from visible metrics
    let context = `【儀表板數據快照】\n`;
    const values = this.calculatedValues();
    this.activeDefinitions().forEach(d => {
        context += `- ${d.fieldTw}: ${values[d.id] ?? 'N/A'}\n`;
    });
    
    // Add Tasks Context
    const tasks = this.activeTasks();
    if (tasks.length > 0) {
        context += `\n【待辦任務 (Top 5)】\n`;
        tasks.forEach(t => context += `- [${t.priority}] ${t.title} (${t.status})\n`);
    }
    
    try {
      const insight = await this.aiService.generateBusinessInsight(context);
      this.aiInsight.set(insight);
    } catch (err) {
      this.aiInsight.set("無法產生報告，請檢查連線。");
    } finally {
      this.isGeneratingInsight.set(false);
    }
  }

  // --- Drill Down Logic ---
  onCardClick(def: MetricDefinition) {
      // 1. Identify Data Source
      let sourceData: any[] = [];
      let type: 'Order' | 'Product' | 'PurchaseOrder' | 'Other' = 'Other';

      // *** PROGRAMMATIC OVERRIDE (For OEM Outstanding) ***
      if (def.formula === 'PROGRAMMATIC_OEM_CALC') {
          sourceData = this.dataService.orders();
          type = 'Order';
      }
      else if (def.formula.includes('Order') && !def.formula.includes('PurchaseOrder')) {
          sourceData = this.dataService.orders();
          type = 'Order';
      } else if (def.formula.includes('Product')) {
          sourceData = this.dataService.products();
          type = 'Product';
      } else if (def.formula.includes('PurchaseOrder')) {
          sourceData = this.dataService.purchaseOrders();
          type = 'PurchaseOrder';
      } else {
          // Fallback or complex formula
          return;
      }

      let filtered = [...sourceData];
      const formula = def.formula;

      // 2. Specific Filtering Logic for OEM Calc
      if (formula === 'PROGRAMMATIC_OEM_CALC') {
          // Updated to match DataService Logic (Filtering by Product Category '代工')
          const excludedStatuses = ['已結案', '取消', '已出貨'];
          const products = this.dataService.products();
          const productMap = new Map(products.map(p => [p.id, p]));
          
          filtered = filtered.filter(order => {
              // 1. Must be Manufacturing Order
              if (!order.isManufacturingOrder) return false;
              
              // 2. Must be Active (Not closed)
              if (excludedStatuses.includes(order.status)) return false;

              // 3. Filter Product category=代工
              const product = productMap.get(order.productId);
              if (!product || product.category !== '代工') return false;

              // 4. Must have Outstanding Qty (Qty - Manufactured > 0)
              const outstanding = order.outstandingManufacturingQty ?? ((order.quantity || 0) - (order.manufacturedQuantity || 0));
              return outstanding > 0;
          });
      } 
      // 3. Standard Formula Parsing
      else {
          // Simple Parsing logic for "status in [...]"
          const statusInMatch = formula.match(/status\s+in\s*\[(.*?)\]/);
          if (statusInMatch) {
              const statuses = statusInMatch[1].split(',').map(s => s.trim().replace(/['"]/g, ''));
              filtered = filtered.filter(item => statuses.includes(item.status));
          }

          // Simple Parsing for "status != '...'"
          const neRegex = /status\s*!=\s*["']([^"']+)["']/g;
          let neMatch;
          while ((neMatch = neRegex.exec(formula)) !== null) {
              const val = neMatch[2];
              filtered = filtered.filter(item => item.status !== val);
          }

          // Simple Parsing for "Product.stock < Product.safetyStock"
          if (formula.toLowerCase().includes('stock <') && formula.toLowerCase().includes('safetystock')) {
               filtered = filtered.filter(item => (Number(item.stock) || 0) < (Number(item.safetyStock) || 0));
          }
          
          // Stock <= 0 check
          if (formula.toLowerCase().includes('stock <= 0')) {
               filtered = filtered.filter(item => (Number(item.stock) || 0) <= 0);
          }

          // Special Handling for "Unique OrderId"
          // If the formula counts Unique IDs, we should group the list to show 1 row per unique ID
          if (formula.toLowerCase().includes('unique orderid') || formula.toLowerCase().includes('unique order')) {
               const grouped = new Map<string, any>();
               filtered.forEach(item => {
                   // Logic to get base ID
                   let baseId = item.orderId;
                   const parts = item.orderId.split('-');
                   if (parts.length >= 4) {
                       baseId = parts.slice(0, 3).join('-');
                   } else if (baseId.match(/-\d{2}$/)) {
                       baseId = baseId.replace(/-\d{2}$/, '');
                   }
                   
                   if (!grouped.has(baseId)) {
                       grouped.set(baseId, { ...item, _displayId: baseId }); // Use first item as representative
                   }
               });
               filtered = Array.from(grouped.values());
          }
          
          // Handle Unique PO Number
          if (formula.toLowerCase().includes('unique ponumber')) {
               const grouped = new Map<string, any>();
               filtered.forEach(item => {
                   const key = item.poNumber || (item.purchaseId ? item.purchaseId.split('-').slice(0,3).join('-') : '');
                   if (key && !grouped.has(key)) {
                       grouped.set(key, { ...item, _displayId: key });
                   }
               });
               filtered = Array.from(grouped.values());
          }

          // Manufacturing Filter
          if (formula.includes('isManufacturingOrder == true')) {
              filtered = filtered.filter((item: any) => item.isManufacturingOrder === true);
          }
          
          // Date Filters
          if (formula.includes('Current Month')) {
              const now = new Date();
              const cm = now.getMonth();
              const cy = now.getFullYear();
              filtered = filtered.filter(item => {
                  const dateVal = item.orderDate || item.date || item.purchaseDate;
                  if (!dateVal) return false;
                  const d = new Date(dateVal);
                  return d.getMonth() === cm && d.getFullYear() === cy;
              });
          }
          
          if (formula.includes('Last Month')) {
               const now = new Date();
               let targetMonth = now.getMonth() - 1;
               let targetYear = now.getFullYear();
               if (targetMonth < 0) { targetMonth = 11; targetYear -= 1; }

               filtered = filtered.filter(item => {
                   const dateVal = item.orderDate || item.date || item.purchaseDate;
                   if (!dateVal) return false;
                   const d = new Date(dateVal);
                   return d.getMonth() === targetMonth && d.getFullYear() === targetYear;
               });
          }
      }

      this.drillDownTitle.set(def.fieldTw);
      this.drillDownItems.set(filtered);
      this.drillDownType.set(type);
      this.showDrillDownModal.set(true);
  }

  closeDrillDown() {
      this.showDrillDownModal.set(false);
  }

  async syncToCloud() {
      if (!confirm('確定要將本機資料同步到雲端嗎？這將會覆蓋雲端現有的資料。')) return;
      
      try {
          await this.dataService.syncLocalToCloud();
          alert('同步成功！');
      } catch (e: any) {
          alert('同步失敗: ' + e.message);
      }
  }

  async pullFromCloud() {
      if (!confirm('確定要從雲端同步資料嗎？這將會覆蓋本機目前的資料。')) return;
      
      try {
          await this.dataService.syncCloudToLocal();
          alert('同步成功！');
      } catch (e: any) {
          alert('同步失敗: ' + e.message);
      }
  }
}
