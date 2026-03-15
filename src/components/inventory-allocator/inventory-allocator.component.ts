
// Force re-compilation
import { ChangeDetectionStrategy, Component, computed, signal } from '@angular/core';
import { CommonModule, DecimalPipe } from '@angular/common';
import { FormsModule } from '@angular/forms';

interface AllocationPreset {
  size: number;
  enabled: boolean;
  // Calculated results
  calculatedCount: number;
  usedWeight: number;
}

interface AllocationBrand {
  id: string;
  name: string;
  ratio: number;
  presets: AllocationPreset[]; 
  // Result Snapshot
  totalAllocatedWeight: number;
  totalUsedWeight: number;
  remainder: number;
}

@Component({
  selector: 'app-inventory-allocator',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CommonModule, FormsModule, DecimalPipe],
  template: `
<div class="p-8 h-full flex flex-col overflow-hidden">
  <header class="mb-6 flex-shrink-0">
    <h1 class="text-3xl font-bold text-slate-800 dark:text-white">智慧控貨配量計算機</h1>
    <p class="text-slate-500 dark:text-slate-400 mt-1">設定總庫存與品牌配比，自由選擇分裝規格，一鍵試算包裝數量。</p>
  </header>

  <div class="flex-1 overflow-y-auto">
      <div class="grid grid-cols-1 lg:grid-cols-12 gap-6 h-full pb-20">
          
          <!-- Left Panel: Input & Config -->
          <div class="lg:col-span-5 flex flex-col space-y-6">
              
              <!-- Total Stock Card -->
              <div class="bg-white dark:bg-slate-800 p-6 rounded-xl shadow-md border border-slate-200 dark:border-slate-700">
                  <h3 class="text-lg font-bold text-slate-700 dark:text-slate-200 mb-4 flex items-center">
                      <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5 mr-2 text-sky-500" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" /></svg>
                      1. 設定總庫存量 (Total Stock)
                  </h3>
                  <div class="relative">
                      <input type="number" 
                             [ngModel]="totalStock()" 
                             (ngModelChange)="totalStock.set($event); isCalculated.set(false)"
                             class="w-full text-3xl font-bold text-center py-4 border-2 border-slate-300 dark:border-slate-600 rounded-lg focus:ring-4 focus:ring-sky-200 focus:border-sky-500 text-slate-800 dark:text-white dark:bg-slate-900 transition-colors"
                             placeholder="例如: 3000">
                      <span class="absolute right-4 top-1/2 -translate-y-1/2 text-slate-400 font-bold">g</span>
                  </div>
              </div>

              <!-- Allocation Config Card -->
              <div class="bg-white dark:bg-slate-800 p-6 rounded-xl shadow-md border border-slate-200 dark:border-slate-700 flex-1 flex flex-col">
                  <div class="flex justify-between items-center mb-4">
                      <div class="flex flex-col">
                          <h3 class="text-lg font-bold text-slate-700 dark:text-slate-200 flex items-center">
                              <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5 mr-2 text-purple-500" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M11 3.055A9.001 9.001 0 1020.945 13H11V3.055z" /><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M20.488 9H15V3.512A9.025 9.025 0 0120.488 9z" /></svg>
                              2. 配比與分裝規格
                          </h3>
                          <!-- Ratio Usage Indicator -->
                          <div class="text-xs font-medium mt-1 flex items-center" 
                               [class.text-green-600]="currentTotalRatio() < 10"
                               [class.text-amber-500]="currentTotalRatio() === 10"
                               [class.dark:text-green-400]="currentTotalRatio() < 10"
                               [class.dark:text-amber-400]="currentTotalRatio() === 10">
                              使用份數: <span class="text-base font-bold ml-1">{{ currentTotalRatio() }}</span> / 10
                              @if (currentTotalRatio() === 10) {
                                  <span class="ml-2 text-[10px] bg-amber-100 text-amber-700 px-1.5 rounded dark:bg-amber-900 dark:text-amber-300">已滿</span>
                              }
                          </div>
                      </div>
                      
                      <div class="flex space-x-2">
                          <button (click)="setPreset('721')" class="text-xs bg-purple-50 text-purple-600 px-2 py-1 rounded hover:bg-purple-100 dark:bg-purple-900/30 dark:text-purple-300 transition-colors border border-purple-200 dark:border-purple-800">7:2:1</button>
                          <button (click)="setPreset('equal')" class="text-xs bg-slate-100 text-slate-600 px-2 py-1 rounded hover:bg-slate-200 dark:bg-slate-700 dark:text-slate-300 transition-colors border border-slate-200 dark:border-slate-600">均分</button>
                      </div>
                  </div>

                  <div class="space-y-4 overflow-y-auto pr-2 max-h-[500px]">
                      @for (brand of brandsConfig(); track brand.id; let brandIdx = $index) {
                          <div class="p-4 bg-slate-50 dark:bg-slate-700/50 rounded-lg border border-slate-200 dark:border-slate-600 relative group transition-all hover:shadow-sm">
                              
                              <!-- Header Row -->
                              <div class="flex items-center space-x-3 mb-3">
                                  <button (click)="removeBrand(brandIdx)" class="text-slate-300 hover:text-red-500 transition-colors -ml-1" title="移除品牌">
                                      <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clip-rule="evenodd" /></svg>
                                  </button>
                                  
                                  <div class="flex-1">
                                      <input type="text" [ngModel]="brand.name" (ngModelChange)="updateBrandName(brandIdx, $event)" 
                                             class="w-full text-sm font-bold bg-transparent border-none focus:ring-0 p-0 text-slate-800 dark:text-white placeholder-slate-400"
                                             placeholder="輸入品牌名稱...">
                                  </div>

                                  <div class="flex items-center">
                                      <span class="text-xs text-slate-400 mr-2">份數:</span>
                                      <input type="number" 
                                             [ngModel]="brand.ratio" 
                                             (ngModelChange)="updateBrandRatio(brandIdx, $event)" 
                                             min="0"
                                             max="10"
                                             class="w-12 text-sm p-1 font-bold text-center border rounded bg-white dark:bg-slate-800 focus:ring-purple-500 transition-colors"
                                             [class.border-purple-300]="brand.ratio > 0"
                                             [class.dark:border-purple-600]="brand.ratio > 0"
                                             [class.border-slate-300]="brand.ratio === 0"
                                             [class.text-purple-700]="brand.ratio > 0"
                                             [class.dark:text-purple-300]="brand.ratio > 0"
                                             [class.text-slate-400]="brand.ratio === 0">
                                  </div>
                              </div>

                              <!-- Presets Row (Checkboxes) -->
                              <div>
                                  <div class="flex justify-between items-center mb-1">
                                      <label class="text-[10px] text-slate-400">啟用規格 (勾選要計算的包裝)</label>
                                  </div>
                                  <div class="grid grid-cols-3 gap-2">
                                      @for (preset of brand.presets; track $index; let presetIdx = $index) {
                                          <div class="flex items-center bg-white dark:bg-slate-800 border rounded p-1.5 transition-all"
                                               [class.border-sky-500]="preset.enabled"
                                               [class.ring-1]="preset.enabled"
                                               [class.ring-sky-500]="preset.enabled"
                                               [class.border-slate-300]="!preset.enabled"
                                               [class.dark:border-slate-600]="!preset.enabled"
                                               [class.opacity-60]="!preset.enabled">
                                              
                                              <!-- Checkbox -->
                                              <input type="checkbox" 
                                                     [checked]="preset.enabled" 
                                                     (change)="togglePreset(brandIdx, presetIdx)"
                                                     class="h-4 w-4 text-sky-600 focus:ring-sky-500 border-gray-300 rounded cursor-pointer mr-2">
                                              
                                              <!-- Size Input -->
                                              <div class="flex-1 relative">
                                                  <input type="number" 
                                                         [ngModel]="preset.size" 
                                                         (ngModelChange)="updatePresetSize(brandIdx, presetIdx, $event)"
                                                         class="w-full text-center text-xs font-bold bg-transparent border-none p-0 focus:ring-0 text-slate-700 dark:text-slate-300"
                                                         placeholder="0">
                                                  <span class="absolute -right-1 top-1/2 -translate-y-1/2 text-[9px] text-slate-400 pointer-events-none">g</span>
                                              </div>
                                          </div>
                                      }
                                  </div>
                              </div>

                          </div>
                      }
                  </div>
                  
                  <button (click)="addBrand()" 
                          [disabled]="currentTotalRatio() >= MAX_RATIO"
                          class="mt-4 w-full py-2 border-2 border-dashed rounded-lg transition-colors flex items-center justify-center disabled:opacity-50 disabled:cursor-not-allowed"
                          [class.border-slate-300]="currentTotalRatio() < MAX_RATIO"
                          [class.dark:border-slate-600]="currentTotalRatio() < MAX_RATIO"
                          [class.text-slate-500]="currentTotalRatio() < MAX_RATIO"
                          [class.hover:border-sky-500]="currentTotalRatio() < MAX_RATIO"
                          [class.hover:text-sky-500]="currentTotalRatio() < MAX_RATIO"
                          [class.border-red-200]="currentTotalRatio() >= MAX_RATIO"
                          [class.bg-red-50]="currentTotalRatio() >= MAX_RATIO"
                          [class.text-red-400]="currentTotalRatio() >= MAX_RATIO"
                          [class.dark:bg-red-900/20]="currentTotalRatio() >= MAX_RATIO"
                          [class.dark:border-red-800]="currentTotalRatio() >= MAX_RATIO">
                      
                      @if (currentTotalRatio() >= MAX_RATIO) {
                          <span class="font-bold">配額已滿 (10/10)</span>
                      } @else {
                          <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5 mr-1" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4" /></svg>
                          增加品牌 (剩餘: {{ remainingRatio() }})
                      }
                  </button>
              </div>
          </div>

          <!-- Center Action Button (Mobile) or Arrow (Desktop) -->
          <div class="lg:col-span-1 flex items-center justify-center py-4 lg:py-0">
              <button (click)="calculateDistribution()" 
                      class="bg-gradient-to-r from-sky-500 to-blue-600 hover:from-sky-600 hover:to-blue-700 text-white rounded-full p-4 shadow-lg transform transition-transform active:scale-95 group">
                  <svg xmlns="http://www.w3.org/2000/svg" class="h-8 w-8 group-hover:rotate-12 transition-transform" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7" />
                  </svg>
                  <span class="sr-only">開始計算</span>
              </button>
          </div>

          <!-- Right Panel: Results & Visualization -->
          <div class="lg:col-span-6 flex flex-col space-y-6">
              
              <div class="flex justify-between items-center">
                  <h2 class="text-xl font-bold text-slate-800 dark:text-white">計算結果</h2>
                  @if (!isCalculated()) {
                      <span class="text-xs text-amber-500 font-bold animate-pulse">設定已變更，請點擊箭頭按鈕重新計算</span>
                  }
              </div>

              <!-- Result Cards -->
              <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
                  @for (res of results(); track res.id) {
                      <div class="bg-white dark:bg-slate-800 rounded-xl shadow-md border-l-4 overflow-hidden relative transition-all duration-300 flex flex-col"
                           [class.border-l-purple-500]="res.ratio >= 5"
                           [class.border-l-sky-500]="res.ratio < 5 && res.ratio > 1"
                           [class.border-l-amber-500]="res.ratio <= 1 && res.ratio > 0"
                           [class.border-l-slate-300]="res.ratio === 0"
                           [class.opacity-60]="res.ratio === 0">
                          
                          <div class="p-5 flex-1 flex flex-col">
                              <!-- Header -->
                              <div class="flex justify-between items-start mb-3">
                                  <div>
                                      <h4 class="font-bold text-lg text-slate-800 dark:text-white">{{ res.name }}</h4>
                                      <p class="text-xs text-slate-500">
                                          配比 {{ res.ratio }} / 10 
                                          @if (res.ratio > 0) {
                                              ({{ (res.ratio / currentTotalRatio() * 100) | number:'1.0-1' }}%)
                                          }
                                      </p>
                                  </div>
                                  <div class="text-right">
                                      <div class="text-xs text-slate-400 mb-1">理論配額</div>
                                      <span class="font-mono font-bold text-slate-700 dark:text-slate-300">{{ res.totalAllocatedWeight | number:'1.0-0' }}g</span>
                                  </div>
                              </div>
                              
                              <!-- Breakdown List -->
                              <div class="flex-1 space-y-2 mb-3 bg-slate-50 dark:bg-slate-700/30 rounded p-2">
                                  @for (p of getActivePresets(res.presets); track $index) {
                                      <div class="flex justify-between items-center text-sm border-b border-slate-200 dark:border-slate-600 last:border-0 pb-1 last:pb-0">
                                          <div class="flex items-center">
                                              <span class="w-2 h-2 rounded-full bg-sky-400 mr-2"></span>
                                              <span class="font-medium text-slate-700 dark:text-slate-300">{{ p.size }}g</span>
                                          </div>
                                          <div class="flex items-center space-x-2">
                                              <span class="text-xs text-slate-400">x</span>
                                              <span class="font-bold text-lg text-slate-900 dark:text-white">{{ p.calculatedCount }}</span>
                                              <span class="text-xs text-slate-500">包</span>
                                          </div>
                                      </div>
                                  }
                                  @if (getActivePresets(res.presets).length === 0 && res.ratio > 0) {
                                      <div class="text-center text-xs text-red-400 py-2">未勾選任何規格</div>
                                  }
                              </div>

                              <!-- Footer -->
                              <div class="flex justify-between items-center text-xs pt-2 border-t border-slate-100 dark:border-slate-700 mt-auto">
                                  <div class="text-slate-500">
                                      實用: <span class="font-mono text-slate-700 dark:text-slate-300">{{ res.totalUsedWeight | number }}g</span>
                                  </div>
                                  <div class="flex items-center">
                                      <span class="text-rose-500 font-bold bg-rose-50 dark:bg-rose-900/20 px-1.5 py-0.5 rounded">餘 {{ res.remainder | number:'1.0-1' }}g</span>
                                  </div>
                              </div>
                          </div>
                      </div>
                  }
              </div>

              <!-- Summary Card -->
              <div class="bg-slate-900 text-white p-6 rounded-xl shadow-lg flex flex-col md:flex-row items-center justify-between mt-auto">
                  <div class="mb-4 md:mb-0">
                      <h3 class="text-slate-400 text-sm font-bold uppercase tracking-wider mb-1">總結算 (Global Summary)</h3>
                      <div class="flex space-x-6">
                          <div>
                              <div class="text-2xl font-bold text-white">{{ globalUsed() | number }}<span class="text-sm text-slate-400">g</span></div>
                              <div class="text-xs text-slate-400">總產出重量</div>
                          </div>
                          <div>
                              <div class="text-2xl font-bold text-amber-400">{{ globalRemainder() | number:'1.0-1' }}<span class="text-sm text-amber-400/70">g</span></div>
                              <div class="text-xs text-amber-400/70">總庫存剩餘</div>
                          </div>
                      </div>
                  </div>
                  
                  <!-- Visual Pie Chart Representation -->
                  <div class="flex items-center space-x-4">
                      <div class="w-32 h-4 bg-slate-800 rounded-full overflow-hidden flex">
                          @for (res of results(); track res.id) {
                              <div class="h-full border-r border-slate-900/50 last:border-0 transition-all duration-500" 
                                   [class.bg-purple-500]="res.ratio >= 5"
                                   [class.bg-sky-500]="res.ratio < 5 && res.ratio > 1"
                                   [class.bg-amber-500]="res.ratio <= 1 && res.ratio > 0"
                                   [style.width.%]="(res.totalUsedWeight / totalStock()) * 100"
                                   [title]="res.name"></div>
                          }
                          <!-- Remainder Bar -->
                          <div class="h-full bg-slate-600" [style.width.%]="(globalRemainder() / totalStock()) * 100" title="餘數"></div>
                      </div>
                      <div class="text-xs text-slate-400">
                          可視化配比
                      </div>
                  </div>
              </div>

          </div>
      </div>
  </div>
</div>
  `
})
export class InventoryAllocatorComponent {
  // Inputs
  totalStock = signal<number>(3000); 
  readonly MAX_RATIO = 10; 
  
  // Configuration State (Input)
  brandsConfig = signal<AllocationBrand[]>([
    { 
        id: '1', name: '春哥好物', ratio: 7, 
        presets: [
            { size: 100, enabled: true, calculatedCount: 0, usedWeight: 0 },
            { size: 200, enabled: true, calculatedCount: 0, usedWeight: 0 },
            { size: 500, enabled: false, calculatedCount: 0, usedWeight: 0 }
        ],
        totalAllocatedWeight: 0, totalUsedWeight: 0, remainder: 0
    },
    { 
        id: '2', name: '品牌 B', ratio: 2, 
        presets: [
            { size: 150, enabled: true, calculatedCount: 0, usedWeight: 0 },
            { size: 300, enabled: false, calculatedCount: 0, usedWeight: 0 },
            { size: 600, enabled: false, calculatedCount: 0, usedWeight: 0 }
        ],
        totalAllocatedWeight: 0, totalUsedWeight: 0, remainder: 0
    },
    { 
        id: '3', name: '品牌 C', ratio: 1, 
        presets: [
            { size: 200, enabled: false, calculatedCount: 0, usedWeight: 0 },
            { size: 400, enabled: true, calculatedCount: 0, usedWeight: 0 },
            { size: 1000, enabled: false, calculatedCount: 0, usedWeight: 0 }
        ],
        totalAllocatedWeight: 0, totalUsedWeight: 0, remainder: 0
    },
  ]);

  // Calculated Results (Output) - Separated from config to allow "Click to Calculate"
  results = signal<AllocationBrand[]>([]);
  globalRemainder = signal(0);
  globalUsed = signal(0);
  isCalculated = signal(false);

  // Helper Computeds for UI
  currentTotalRatio = computed(() => this.brandsConfig().reduce((sum, b) => sum + b.ratio, 0));
  remainingRatio = computed(() => this.MAX_RATIO - this.currentTotalRatio());

  constructor() {
      // Initial calculation
      this.calculateDistribution();
  }

  // Template Helper to avoid arrow functions in HTML
  getActivePresets(presets: AllocationPreset[]): AllocationPreset[] {
      return presets.filter(p => p.enabled && p.size > 0);
  }

  addBrand() {
    if (this.currentTotalRatio() >= this.MAX_RATIO) {
        alert('配比總和已達上限 (10)，無法新增品牌。');
        return;
    }

    this.brandsConfig.update(list => [
      ...list, 
      { 
        id: Date.now().toString(), 
        name: `新品牌 ${list.length + 1}`, 
        ratio: 1, 
        presets: [
            { size: 100, enabled: true, calculatedCount: 0, usedWeight: 0 },
            { size: 300, enabled: false, calculatedCount: 0, usedWeight: 0 },
            { size: 500, enabled: false, calculatedCount: 0, usedWeight: 0 }
        ],
        totalAllocatedWeight: 0, totalUsedWeight: 0, remainder: 0
      }
    ]);
    // Note: We do NOT auto-calculate here, user must press button
    this.isCalculated.set(false);
  }

  removeBrand(index: number) {
    this.brandsConfig.update(list => list.filter((_, i) => i !== index));
    this.isCalculated.set(false);
  }

  updateBrandName(index: number, name: string) {
      this.brandsConfig.update(list => {
          const newList = [...list];
          newList[index] = { ...newList[index], name };
          return newList;
      });
  }

  updateBrandRatio(index: number, val: any) {
      const numVal = parseInt(val, 10);
      if (isNaN(numVal) || numVal < 0) return;

      this.brandsConfig.update(list => {
          const newList = [...list];
          // Check limits
          const otherBrandsTotal = list.reduce((sum, b, i) => (i === index ? sum : sum + b.ratio), 0);
          let validRatio = numVal;
          if (otherBrandsTotal + numVal > this.MAX_RATIO) {
              validRatio = this.MAX_RATIO - otherBrandsTotal;
          }
          
          newList[index] = { ...newList[index], ratio: validRatio };
          return newList;
      });
      this.isCalculated.set(false);
  }

  updatePresetSize(brandIndex: number, presetIndex: number, val: any) {
      const size = parseInt(val, 10);
      if (isNaN(size) || size < 0) return;
      
      this.brandsConfig.update(list => {
          const newList = [...list];
          const newPresets = [...newList[brandIndex].presets];
          newPresets[presetIndex] = { ...newPresets[presetIndex], size };
          newList[brandIndex] = { ...newList[brandIndex], presets: newPresets };
          return newList;
      });
      this.isCalculated.set(false);
  }

  togglePreset(brandIndex: number, presetIndex: number) {
      this.brandsConfig.update(list => {
          const newList = [...list];
          const newPresets = [...newList[brandIndex].presets];
          newPresets[presetIndex] = { 
              ...newPresets[presetIndex], 
              enabled: !newPresets[presetIndex].enabled 
          };
          newList[brandIndex] = { ...newList[brandIndex], presets: newPresets };
          return newList;
      });
      this.isCalculated.set(false);
  }

  setPreset(type: '721' | 'equal') {
      if (type === '721') {
          // Ensure at least 3 brands
          if (this.brandsConfig().length < 3) {
             alert('請先新增至至少 3 個品牌');
             return;
          }
          this.brandsConfig.update(list => {
              const newList = [...list];
              newList[0] = { ...newList[0], ratio: 7 };
              newList[1] = { ...newList[1], ratio: 2 };
              newList[2] = { ...newList[2], ratio: 1 };
              for(let i = 3; i < newList.length; i++) newList[i] = { ...newList[i], ratio: 0 };
              return newList;
          });

      } else if (type === 'equal') {
          this.brandsConfig.update(list => {
              let available = this.MAX_RATIO;
              return list.map(b => {
                  if (available > 0) {
                      available--;
                      return { ...b, ratio: 1 };
                  } else {
                      return { ...b, ratio: 0 };
                  }
              });
          });
      }
      this.isCalculated.set(false);
  }

  // --- Core Calculation Logic ---
  calculateDistribution() {
      const total = this.totalStock();
      const config = this.brandsConfig();
      const totalRatio = config.reduce((sum, b) => sum + b.ratio, 0);
      
      let grandTotalUsed = 0;

      const calculated = config.map(brand => {
          // 1. Calculate Theoretical Share
          // Use precision for internal calc, but logic is integer/gram based.
          const share = totalRatio > 0 ? (total * brand.ratio) / totalRatio : 0;
          
          const enabledPresets = brand.presets.filter(p => p.enabled && p.size > 0);
          const splitCount = enabledPresets.length;
          
          // Result objects (Mutable for calculation passes)
          let resultPresets = brand.presets.map(p => ({ 
              ...p, 
              calculatedCount: 0, 
              usedWeight: 0 
          }));
          
          let brandUsed = 0;

          if (splitCount > 0) {
              // --- Stage 1: Fair Distribution (Even Split) ---
              // Each enabled preset gets an equal slice of the pie initially.
              const weightPerPreset = share / splitCount;
              
              resultPresets.forEach((p, idx) => {
                  if (p.enabled && p.size > 0) {
                      const count = Math.floor(weightPerPreset / p.size);
                      p.calculatedCount = count;
                      p.usedWeight = count * p.size;
                      brandUsed += p.usedWeight;
                  }
              });

              // --- Stage 2: Smart Fill (Greedy Remainder) ---
              // Try to fill the remaining quota using ANY enabled preset that fits.
              let remainder = share - brandUsed;
              
              // Sort indices by size DESCENDING to prioritize filling with larger packs first (efficiency)
              const sortedIndices = resultPresets
                  .map((p, index) => ({ index, size: p.size, enabled: p.enabled }))
                  .filter(p => p.enabled && p.size > 0)
                  .sort((a, b) => b.size - a.size); // Descending

              let madeProgress = true;
              let safetyLimit = 1000; // Prevent infinite loops

              while (madeProgress && remainder > 0 && safetyLimit > 0) {
                  madeProgress = false;
                  
                  // Iterate through available sizes to find the "Best Fit" (Largest First)
                  for (const item of sortedIndices) {
                      // Allow slight floating point tolerance (0.01)
                      if (item.size <= remainder + 0.01) {
                          // Found a pack that fits! Add it.
                          resultPresets[item.index].calculatedCount++;
                          resultPresets[item.index].usedWeight += item.size;
                          brandUsed += item.size;
                          remainder -= item.size;
                          
                          madeProgress = true;
                          // Restart inner loop to try fitting the largest possible size again
                          // (e.g. if we have 500g and 100g, and remainder is 600g, we want 500+100, not 6x100)
                          break; 
                      }
                  }
                  safetyLimit--;
              }
          }

          grandTotalUsed += brandUsed;

          return {
              ...brand,
              presets: resultPresets,
              totalAllocatedWeight: share,
              totalUsedWeight: brandUsed,
              remainder: share - brandUsed
          };
      });

      this.results.set(calculated);
      this.globalUsed.set(grandTotalUsed);
      this.globalRemainder.set(total - grandTotalUsed);
      this.isCalculated.set(true);
  }
}
