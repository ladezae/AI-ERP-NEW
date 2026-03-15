
import { ChangeDetectionStrategy, Component, ElementRef, ViewChild, computed, effect, inject, signal } from '@angular/core';
import { CommonModule, DecimalPipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { DataService } from '../../services/data.service';
import { Order, Product, Customer } from '../../models/erp.models';
import * as d3 from 'd3';

type ReportTab = 'product-sales' | 'customer-analysis' | 'inventory-analysis';

interface SalesStat {
  key: string; // Product Name or Date
  quantity: number;
  amount: number;
  percentage?: number;
}

@Component({
  selector: 'app-reports',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CommonModule, FormsModule],
  providers: [DecimalPipe],
  templateUrl: './reports.component.html',
  styles: [`
    :host { display: block; height: 100%; overflow: hidden; }
  `]
})
// Reports Component - ERP Analytics
export class ReportsComponent {
  private dataService = inject(DataService);
  
  // Data Sources
  orders = this.dataService.orders;
  products = this.dataService.products;
  suppliers = this.dataService.suppliers; // Added for filter
  customers = this.dataService.customers; // Added for customer lookup

  // View State
  activeTab = signal<ReportTab>('product-sales');
  
  // Filters
  startDate = signal('');
  endDate = signal('');
  selectedProductId = signal<string>('all'); // 'all' or Product ID
  
  // New Filters for Multi-select Category
  selectedCategories = signal<Set<string>>(new Set()); 
  isCategoryDropdownOpen = signal(false);

  selectedSupplier = signal<string>('all');
  customerSearchTerm = signal<string>(''); // New: Customer Search

  // --- Range Selector State ---
  currentDate = new Date();
  
  // The year currently displayed in the button grid (navigable)
  viewYear = signal(this.currentDate.getFullYear()); 

  // The actual selected range
  selectionStart = signal<{year: number, month: number} | null>(null);
  selectionEnd = signal<{year: number, month: number} | null>(null);

  // Chart Container
  @ViewChild('chartContainer') chartContainer!: ElementRef<HTMLDivElement>;

  // Categories Constant (Synced with Products Module)
  readonly categories = [
    '水果乾', '鮮果', '堅果', '蔬果脆片', '水果凍乾', 
    '沖泡類', '零食', '蜜餞', '包材', '代工', 
    '費用', '折讓', '成品', '樣品', '其他'
  ];

  // Storage Key
  private readonly STORAGE_KEY_CATEGORIES = 'erp_report_selected_categories';

  // Computed Label for the Category Button
  categoryLabel = computed(() => {
      const selected = this.selectedCategories();
      const total = this.categories.length;
      if (selected.size === total) return '全部分類 (All)';
      if (selected.size === 0) return '未選擇分類';
      if (selected.size <= 2) return Array.from(selected).join(', ');
      return `已選擇 ${selected.size} 個分類`;
  });

  // Computed: Range Display Text
  rangeLabel = computed(() => {
      const start = this.selectionStart();
      const end = this.selectionEnd();
      
      if (!start) return '請選擇月份';
      
      const startStr = `${start.year}/${start.month}`;
      if (!end) return `${startStr} (請選擇結束月份)`;
      
      if (start.year === end.year && start.month === end.month) {
          return `${startStr} (單月)`;
      }
      
      return `${startStr} ~ ${end.year}/${end.month}`;
  });

  // Computed: Filtered Product Options for Dropdown
  filteredProductOptions = computed(() => {
      const selectedCats = this.selectedCategories();
      const sup = this.selectedSupplier();
      const allProducts = this.products();

      return allProducts.filter(p => {
          const matchCat = selectedCats.has(p.category);
          const matchSup = sup === 'all' || p.supplierCode === sup;
          return matchCat && matchSup;
      });
  });

  // Computed: Filtered Orders based on Date AND Product Attributes
  filteredOrders = computed(() => {
      const start = this.startDate();
      const end = this.endDate();
      const pId = this.selectedProductId();
      const selectedCats = this.selectedCategories();
      const sup = this.selectedSupplier();
      const custTerm = this.customerSearchTerm().toLowerCase().trim();
      
      // Create a map for fast product lookup to check attributes
      const productMap = new Map<string, Product>(this.products().map(p => [p.id, p]));
      // Create a map for fast customer lookup
      const customerMap = new Map<string, Customer>(this.customers().map(c => [c.id, c]));

      return this.orders().filter(o => {
          // 1. Status Filter: Exclude Cancelled
          if (o.status === '取消') return false;
          
          // 2. Date Filter
          if (start && o.orderDate < start) return false;
          if (end && o.orderDate > end) return false;

          // 3. Customer Filter (Fuzzy Search)
          if (custTerm) {
              const customer = customerMap.get(o.customerId);
              const matchSnapshot = o.customerName && o.customerName.toLowerCase().includes(custTerm);
              
              let matchDetails = false;
              if (customer) {
                  matchDetails = (customer.fullName && customer.fullName.toLowerCase().includes(custTerm)) ||
                                 (customer.shortName && customer.shortName.toLowerCase().includes(custTerm)) ||
                                 (customer.lineId && customer.lineId.toLowerCase().includes(custTerm));
              }
              
              if (!matchSnapshot && !matchDetails) return false;
          }

          // 4. Specific Product Filter (Overrides Cat/Sup filters if set to a specific ID)
          if (pId !== 'all') {
              if (o.productId !== pId) {
                  // Handle variant IDs (simple check)
                  if (!o.productId.startsWith(pId + '-')) return false; 
              }
              return true; 
          }

          // 5. Category & Supplier Filter (Applied when Product is 'All')
          let product = productMap.get(o.productId);
          
          // Try base ID lookup for variants
          if (!product && o.productId.includes('-')) {
              const baseId = o.productId.substring(0, o.productId.lastIndexOf('-'));
              product = productMap.get(baseId);
          }

          // If product details not found, exclude it (safe default)
          if (!product) return false;

          // Multi-category check
          if (!selectedCats.has(product.category)) return false;
          
          if (sup !== 'all' && product.supplierCode !== sup) return false;

          return true;
      });
  });

  // Computed: Statistics Aggregation
  salesStats = computed(() => {
      const orders = this.filteredOrders();
      // Determine mode: If specific product selected -> Show Trend (Date keys)
      // If 'all' selected -> Show Ranking (Product Name keys)
      const isSingleProduct = this.selectedProductId() !== 'all';
      
      const map = new Map<string, { qty: number, amt: number }>();
      let totalQty = 0;
      let totalAmt = 0;
      const uniqueOrderIds = new Set<string>();

      orders.forEach(o => {
          // Key: If single product mode -> Date; Else -> Product Name
          const key = isSingleProduct ? o.orderDate : o.productName;
          
          const current = map.get(key) || { qty: 0, amt: 0 };
          
          const qty = Number(o.quantity) || 0;
          const price = Number(o.priceBeforeTax) || 0;

          // Calculate Line Amount: Quantity * PriceBeforeTax
          const lineAmount = qty * price; 
          
          map.set(key, {
              qty: current.qty + qty,
              amt: current.amt + lineAmount
          });

          totalQty += qty;
          totalAmt += lineAmount;

          // Count Unique Orders (Base ID)
          const parts = o.orderId.split('-');
          const baseId = parts.length > 3 ? parts.slice(0, 3).join('-') : o.orderId;
          uniqueOrderIds.add(baseId);
      });

      // Convert to Array
      let stats: SalesStat[] = Array.from(map.entries()).map(([key, val]) => ({
          key,
          quantity: val.qty,
          amount: val.amt,
          percentage: totalAmt > 0 ? (val.amt / totalAmt) * 100 : 0
      }));

      // Sort
      if (isSingleProduct) {
          // Sort by Date Ascending
          stats.sort((a, b) => a.key.localeCompare(b.key));
      } else {
          // Sort by Amount Descending (Top Products)
          stats.sort((a, b) => b.amount - a.amount);
      }
      
      const orderCount = uniqueOrderIds.size;
      const avgOrderValue = orderCount > 0 ? Math.round(totalAmt / orderCount) : 0;

      return { stats, totalQty, totalAmt, orderCount, avgOrderValue };
  });

  constructor() {
      // Initialize with current month range
      const current = { year: this.currentDate.getFullYear(), month: this.currentDate.getMonth() + 1 };
      this.selectionStart.set(current);
      this.selectionEnd.set(current);
      this.updateDateRangeFromSelection();

      // Initialize categories from Local Storage or Default All
      this.loadSavedCategories();

      // Effect to Render Chart
      effect(() => {
          const data = this.salesStats().stats;
          const isSingle = this.selectedProductId() !== 'all';
          // Trigger render whenever data changes
          setTimeout(() => {
             this.renderChart(data, isSingle);
          }, 0); // Next tick to ensure ViewChild is ready if switching tabs
      });
  }

  private loadSavedCategories() {
      const saved = localStorage.getItem(this.STORAGE_KEY_CATEGORIES);
      if (saved) {
          try {
              const parsed = JSON.parse(saved);
              if (Array.isArray(parsed) && parsed.length > 0) {
                  // Use persisted categories, filter to ensure they are valid
                  const validSet = new Set(this.categories);
                  const filteredSaved = parsed.filter(c => validSet.has(c));
                  if (filteredSaved.length > 0) {
                       this.selectedCategories.set(new Set(filteredSaved));
                       return;
                  }
              }
          } catch (e) {
              console.warn('Failed to load saved report categories', e);
          }
      }
      // Fallback: Select All
      this.selectedCategories.set(new Set(this.categories));
  }

  private saveCategories() {
      localStorage.setItem(this.STORAGE_KEY_CATEGORIES, JSON.stringify(Array.from(this.selectedCategories())));
  }

  // --- Date Range Selector Logic ---
  
  shiftViewYear(delta: number) {
      this.viewYear.update(y => y + delta);
  }

  selectMonth(month: number) {
      const year = this.viewYear();
      const currentStart = this.selectionStart();
      const currentEnd = this.selectionEnd();
      
      const candidate = { year, month };
      const candidateTime = new Date(year, month - 1).getTime();

      // Logic:
      // 1. If start is null, or both start and end are set -> Start new selection
      // 2. If start is set but end is null:
      //    - If candidate < start -> Candidate becomes new start
      //    - If candidate >= start -> Candidate becomes end

      if (!currentStart || (currentStart && currentEnd)) {
          // Start fresh
          this.selectionStart.set(candidate);
          this.selectionEnd.set(null);
          // Auto-set range to single month immediately for better UX
          this.updateDateRangeFromSelection();
      } else {
          const startTime = new Date(currentStart.year, currentStart.month - 1).getTime();
          
          if (candidateTime < startTime) {
              // Clicked earlier than start, treat as new start
              this.selectionStart.set(candidate);
              this.updateDateRangeFromSelection();
          } else {
              // Clicked later or same, treat as end
              this.selectionEnd.set(candidate);
              this.updateDateRangeFromSelection();
          }
      }
  }

  private updateDateRangeFromSelection() {
      const start = this.selectionStart();
      let end = this.selectionEnd();
      
      if (!start) return;
      if (!end) end = start; // If end not set, use start (single month)

      const firstDay = new Date(start.year, start.month - 1, 1);
      const lastDay = new Date(end.year, end.month, 0); // Last day of end month

      const fmt = (d: Date) => {
          const year = d.getFullYear();
          const month = (d.getMonth() + 1).toString().padStart(2, '0');
          const day = d.getDate().toString().padStart(2, '0');
          return `${year}-${month}-${day}`;
      };

      this.startDate.set(fmt(firstDay));
      this.endDate.set(fmt(lastDay));
  }

  // Helper for template styling
  getMonthButtonClass(month: number): string {
      const y = this.viewYear();
      const start = this.selectionStart();
      const end = this.selectionEnd();
      
      // Base class
      let classes = 'border border-slate-200 dark:border-slate-600 transition-all ';

      const currentTime = new Date(y, month - 1).getTime();
      const startTime = start ? new Date(start.year, start.month - 1).getTime() : -1;
      const endTime = end ? new Date(end.year, end.month - 1).getTime() : -1;

      const isStart = start && currentTime === startTime;
      const isEnd = end && currentTime === endTime;
      
      // Case 1: Is Start or End Point
      if (isStart || isEnd) {
          return classes + 'bg-indigo-600 text-white font-bold shadow-md transform scale-105 z-10 border-indigo-600';
      }

      // Case 2: In Range
      if (start && end && currentTime > startTime && currentTime < endTime) {
          return classes + 'bg-indigo-100 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-300 font-medium';
      }

      // Case 3: Default
      return classes + 'bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700';
  }


  // --- Actions ---

  toggleCategoryDropdown() {
    this.isCategoryDropdownOpen.update(v => !v);
  }

  closeCategoryDropdown() {
    this.isCategoryDropdownOpen.set(false);
  }

  toggleCategory(cat: string) {
      this.selectedCategories.update(current => {
          const next = new Set(current);
          if (next.has(cat)) {
              next.delete(cat);
          } else {
              next.add(cat);
          }
          return next;
      });
      // Save state
      this.saveCategories();
      // Reset product selection when filters change to avoid invalid state
      this.selectedProductId.set('all');
  }

  toggleAllCategories() {
      const current = this.selectedCategories();
      if (current.size === this.categories.length) {
          // If all selected, deselect all
          this.selectedCategories.set(new Set());
      } else {
          // Select all
          this.selectedCategories.set(new Set(this.categories));
      }
      // Save state
      this.saveCategories();
      this.selectedProductId.set('all');
  }
  
  isCategorySelected(cat: string): boolean {
      return this.selectedCategories().has(cat);
  }

  isAllCategoriesSelected(): boolean {
      return this.selectedCategories().size === this.categories.length;
  }

  onSupplierChange(event: Event) {
      this.selectedSupplier.set((event.target as HTMLSelectElement).value);
      this.selectedProductId.set('all');
  }

  onCustomerSearchChange(event: Event) {
      this.customerSearchTerm.set((event.target as HTMLInputElement).value);
  }

  // --- D3 Chart Logic ---
  private renderChart(data: SalesStat[], isSingleProduct: boolean) {
      if (!this.chartContainer) return;
      
      const element = this.chartContainer.nativeElement;
      d3.select(element).selectAll('*').remove(); // Clear previous

      if (data.length === 0) {
          d3.select(element).append('div').attr('class', 'flex items-center justify-center h-full text-slate-400').text('無資料可顯示');
          return;
      }

      // Increased bottom margin for multi-line text
      const margin = { top: 20, right: 30, bottom: 80, left: 60 }; 
      const width = element.clientWidth - margin.left - margin.right;
      const height = 300 - margin.top - margin.bottom;

      const svg = d3.select(element)
          .append('svg')
          .attr('width', width + margin.left + margin.right)
          .attr('height', height + margin.top + margin.bottom)
          .append('g')
          .attr('transform', `translate(${margin.left},${margin.top})`);

      if (isSingleProduct) {
          // --- LINE CHART (Trend) ---
          
          // X Axis (Date)
          const x = d3.scalePoint()
              .domain(data.map(d => d.key))
              .range([0, width])
              .padding(0.5); // Add padding for points

          svg.append('g')
              .attr('transform', `translate(0,${height})`)
              .call(d3.axisBottom(x).tickFormat((d: string) => d.slice(5))) // Show MM-DD
              .selectAll('text')
              .style('text-anchor', 'middle')
              .style('font-size', '12px');

          // Y Axis (Amount)
          const maxVal = d3.max(data, d => d.amount) || 0;
          const y = d3.scaleLinear()
              .domain([0, maxVal * 1.1])
              .range([height, 0]);

          svg.append('g')
              .call(d3.axisLeft(y).ticks(5).tickFormat(d => `${Number(d)/1000}k`)); // Format thousands

          // Line
          const line = d3.line<SalesStat>()
              .x(d => x(d.key)!)
              .y(d => y(d.amount));

          svg.append('path')
              .datum(data)
              .attr('fill', 'none')
              .attr('stroke', '#6366f1') // Indigo-500
              .attr('stroke-width', 2.5)
              .attr('d', line);
            
          // Dots
          svg.selectAll('dot')
              .data(data)
              .enter()
              .append('circle')
              .attr('cx', d => x(d.key)!)
              .attr('cy', d => y(d.amount))
              .attr('r', 4)
              .attr('fill', '#6366f1');

      } else {
          // --- BAR CHART (Ranking) ---
          // Limit to Top 10 for readability
          const chartData = data.slice(0, 10);

          // X Axis (Product Name)
          const x = d3.scaleBand()
              .range([0, width])
              .domain(chartData.map(d => d.key))
              .padding(0.3);

          const xAxis = svg.append('g')
              .attr('transform', `translate(0,${height})`)
              .call(d3.axisBottom(x));
          
          // Apply wrapping and styling to X-axis labels
          // Horizontal (no rotate), Larger Font, Two Lines
          xAxis.selectAll('text')
              .style('text-anchor', 'middle')
              .style('font-size', '13px')
              .attr('transform', 'translate(0, 0)') // Reset any potential transform
              .call(this.wrap, x.bandwidth());

          // Y Axis
          const maxVal = d3.max(chartData, d => d.amount) || 0;
          const y = d3.scaleLinear()
              .domain([0, maxVal * 1.1])
              .range([height, 0]);

          svg.append('g')
              .call(d3.axisLeft(y).ticks(5).tickFormat(d => `${Number(d)/1000}k`));

          // Bars
          svg.selectAll('bar')
              .data(chartData)
              .enter()
              .append('rect')
              .attr('x', d => x(d.key)!)
              .attr('y', d => y(d.amount))
              .attr('width', x.bandwidth())
              .attr('height', d => height - y(d.amount))
              .attr('fill', '#0ea5e9') // Sky-500
              .attr('rx', 4); // Rounded top corners visually
      }
  }
  
  // Custom Wrap Function for D3 Text
  private wrap(text: any, width: number) {
    text.each(function(this: SVGTextElement) {
      const textEl = d3.select(this);
      const content = textEl.text();
      
      if (content.length > 5) {
         const mid = Math.ceil(content.length / 2);
         const line1 = content.slice(0, mid);
         const line2 = content.slice(mid);
         
         textEl.text(null);
         textEl.append("tspan")
             .attr("x", 0)
             .attr("y", 9) 
             .attr("dy", "0.71em")
             .text(line1);
         textEl.append("tspan")
             .attr("x", 0)
             .attr("y", 9)
             .attr("dy", "2.1em")
             .text(line2);
      } else {
         textEl.attr("y", 9); 
         textEl.attr("dy", "0.71em");
      }
    });
  }

  setActiveTab(tab: ReportTab) {
      this.activeTab.set(tab);
  }
}
