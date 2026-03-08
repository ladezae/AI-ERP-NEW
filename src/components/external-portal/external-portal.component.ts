
import { Component, computed, inject, signal, effect } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { DataService } from '../../services/data.service';
import { EdgeAiService } from '../../services/edge-ai.service';
import { Product } from '../../models/erp.models';
import { MatIconModule } from '@angular/material/icon';

@Component({
  selector: 'app-external-portal',
  standalone: true,
  imports: [CommonModule, FormsModule, MatIconModule],
  template: `
    <div class="min-h-screen bg-gray-50 dark:bg-slate-900 font-sans">
      <!-- Header -->
      <header class="bg-white dark:bg-slate-800 shadow-sm sticky top-0 z-20">
        <div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
          <div class="flex items-center gap-3">
            <div class="w-10 h-10 bg-indigo-600 rounded-lg flex items-center justify-center text-white font-bold text-xl">
              E
            </div>
            <h1 class="text-xl font-bold text-slate-800 dark:text-white hidden sm:block">
              客戶專屬入口
            </h1>
            @if (edgeAi.isAvailable()) {
              <span class="px-2 py-0.5 rounded-full bg-gradient-to-r from-blue-500 to-purple-500 text-white text-[10px] font-bold tracking-wider uppercase shadow-sm">
                AI Enhanced
              </span>
            }
          </div>

          <div class="flex items-center gap-4">
            <!-- Search -->
            <div class="relative hidden sm:block">
              <input 
                type="text" 
                [(ngModel)]="searchQuery"
                placeholder="搜尋商品..." 
                class="w-64 pl-10 pr-4 py-2 rounded-full bg-gray-100 dark:bg-slate-700 border-none focus:ring-2 focus:ring-indigo-500 text-sm"
              >
              <mat-icon class="absolute left-3 top-2 text-gray-400 text-sm">search</mat-icon>
            </div>

            <!-- Voice Search Button -->
            <button (click)="toggleVoiceSearch()" 
                    [class.bg-red-500]="isListening()"
                    [class.animate-pulse]="isListening()"
                    class="p-2 rounded-full bg-gray-100 dark:bg-slate-700 hover:bg-gray-200 dark:hover:bg-slate-600 transition-colors">
              <mat-icon [class.text-white]="isListening()" class="text-gray-600 dark:text-gray-300">mic</mat-icon>
            </button>

            <!-- Cart / Profile -->
            <button class="p-2 rounded-full bg-gray-100 dark:bg-slate-700 hover:bg-gray-200 dark:hover:bg-slate-600 transition-colors relative">
              <mat-icon class="text-gray-600 dark:text-gray-300">shopping_cart</mat-icon>
              @if (cartCount() > 0) {
                <span class="absolute -top-1 -right-1 w-5 h-5 bg-red-500 text-white text-xs rounded-full flex items-center justify-center font-bold">
                  {{ cartCount() }}
                </span>
              }
            </button>
          </div>
        </div>
      </header>

      <!-- Mobile Search (Visible only on small screens) -->
      <div class="sm:hidden p-4 bg-white dark:bg-slate-800 border-b border-gray-200 dark:border-slate-700">
        <div class="relative">
          <input 
            type="text" 
            [(ngModel)]="searchQuery"
            placeholder="搜尋商品..." 
            class="w-full pl-10 pr-4 py-2 rounded-lg bg-gray-100 dark:bg-slate-700 border-none focus:ring-2 focus:ring-indigo-500 text-sm"
          >
          <mat-icon class="absolute left-3 top-2 text-gray-400 text-sm">search</mat-icon>
        </div>
      </div>

      <!-- Main Content -->
      <main class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        
        <!-- Welcome Banner -->
        <div class="bg-gradient-to-r from-indigo-600 to-purple-600 rounded-2xl p-6 sm:p-10 mb-8 text-white shadow-lg relative overflow-hidden">
          <div class="relative z-10">
            <h2 class="text-2xl sm:text-3xl font-bold mb-2">歡迎回來，{{ customerName() }}</h2>
            <p class="text-indigo-100 text-sm sm:text-base max-w-2xl">
              這是您的專屬報價平台。所有價格皆已根據您的會員等級 ({{ customerLevel() }}) 進行優惠調整。
              即時庫存，隨時下單。
            </p>
          </div>
          <!-- Decorative Circles -->
          <div class="absolute top-0 right-0 -mt-10 -mr-10 w-40 h-40 bg-white opacity-10 rounded-full"></div>
          <div class="absolute bottom-0 left-0 -mb-10 -ml-10 w-40 h-40 bg-white opacity-10 rounded-full"></div>
        </div>

        <!-- Filters -->
        <div class="flex flex-wrap gap-2 mb-6">
          <button 
            *ngFor="let cat of categories()"
            (click)="selectedCategory.set(cat)"
            [class.bg-indigo-600]="selectedCategory() === cat"
            [class.text-white]="selectedCategory() === cat"
            [class.bg-white]="selectedCategory() !== cat"
            [class.text-gray-600]="selectedCategory() !== cat"
            class="px-4 py-2 rounded-full text-sm font-medium shadow-sm border border-gray-200 dark:border-slate-700 dark:bg-slate-800 dark:text-gray-300 transition-all hover:shadow-md"
          >
            {{ cat }}
          </button>
        </div>

        <!-- Product Grid -->
        <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
          @for (product of filteredProducts(); track product.id) {
            <div class="bg-white dark:bg-slate-800 rounded-xl shadow-sm hover:shadow-xl transition-all duration-300 border border-gray-100 dark:border-slate-700 overflow-hidden group flex flex-col h-full">
              <!-- Image -->
              <div class="aspect-square relative overflow-hidden bg-gray-100 dark:bg-slate-700">
                <img [src]="product.imageUrl || 'https://via.placeholder.com/300'" 
                     [alt]="product.name"
                     class="w-full h-full object-cover transform group-hover:scale-110 transition-transform duration-500">
                
                @if (product.stock <= 0) {
                  <div class="absolute inset-0 bg-black/50 flex items-center justify-center">
                    <span class="bg-red-500 text-white px-3 py-1 rounded-full text-xs font-bold uppercase tracking-wider">
                      補貨中
                    </span>
                  </div>
                } @else if (product.stock < 10) {
                   <div class="absolute top-2 right-2">
                    <span class="bg-amber-500 text-white px-2 py-1 rounded-md text-xs font-bold shadow-sm">
                      僅剩 {{ product.stock }} {{ product.unit }}
                    </span>
                  </div>
                }
              </div>

              <!-- Content -->
              <div class="p-5 flex-1 flex flex-col">
                <div class="mb-2">
                  <span class="text-xs font-medium text-indigo-600 dark:text-indigo-400 bg-indigo-50 dark:bg-indigo-900/30 px-2 py-1 rounded-md">
                    {{ product.category }}
                  </span>
                </div>
                <h3 class="text-lg font-bold text-slate-800 dark:text-white mb-1 line-clamp-2 group-hover:text-indigo-600 dark:group-hover:text-indigo-400 transition-colors">
                  {{ product.name }}
                </h3>
                
                <!-- AI Summary or Standard Notes -->
                <p class="text-sm text-gray-500 dark:text-gray-400 mb-4 line-clamp-2 flex-1">
                  {{ product.aiSummary || product.notes || '暫無描述' }}
                </p>

                <!-- Price & Action -->
                <div class="flex items-end justify-between mt-auto pt-4 border-t border-gray-100 dark:border-slate-700">
                  <div>
                    <p class="text-xs text-gray-400 mb-0.5">會員價</p>
                    <div class="flex items-baseline gap-1">
                      <span class="text-2xl font-bold text-indigo-600 dark:text-indigo-400">
                        {{ product.priceAfterTax | currency:'TWD':'symbol':'1.0-0' }}
                      </span>
                      <span class="text-sm text-gray-500">/ {{ product.unit }}</span>
                    </div>
                  </div>
                  
                  <button (click)="addToCart(product)" 
                          [disabled]="product.stock <= 0"
                          class="w-10 h-10 rounded-full bg-gray-100 dark:bg-slate-700 hover:bg-indigo-600 hover:text-white dark:hover:bg-indigo-500 text-gray-600 dark:text-gray-300 flex items-center justify-center transition-all disabled:opacity-50 disabled:cursor-not-allowed">
                    <mat-icon>add</mat-icon>
                  </button>
                </div>
              </div>
            </div>
          } @empty {
            <div class="col-span-full py-20 text-center">
              <div class="w-20 h-20 bg-gray-100 dark:bg-slate-800 rounded-full flex items-center justify-center mx-auto mb-4">
                <mat-icon class="text-4xl text-gray-400">search_off</mat-icon>
              </div>
              <h3 class="text-lg font-medium text-gray-900 dark:text-white">找不到相關商品</h3>
              <p class="text-gray-500 mt-1">請嘗試其他關鍵字或分類</p>
            </div>
          }
        </div>
      </main>
    </div>
  `
})
export class ExternalPortalComponent {
  dataService = inject(DataService);
  edgeAi = inject(EdgeAiService);
  
  // State
  searchQuery = signal('');
  selectedCategory = signal('全部');
  isListening = signal(false);
  cartCount = signal(0);
  
  // Mock Customer Context (In real app, this comes from auth)
  customerName = signal('貴賓客戶');
  customerLevel = signal('VIP'); // VIP, Gold, Silver, Standard

  // Categories
  categories = computed(() => {
    const products = this.dataService.products();
    const cats = new Set(products.map(p => p.category).filter(Boolean));
    return ['全部', ...Array.from(cats)];
  });

  // AI Summaries Cache
  private aiSummaries = new Map<string, string>();

  // Filtered & Mapped Products (Security Layer)
  filteredProducts = computed(() => {
    const query = this.searchQuery().toLowerCase();
    const category = this.selectedCategory();
    const level = this.customerLevel();
    
    const products = this.dataService.products()
      .filter(p => !p.isDiscontinued && p.controlStatus) // Only show active & controlled products
      .filter(p => {
        const matchesQuery = p.name.toLowerCase().includes(query) || 
                             (p.category && p.category.toLowerCase().includes(query));
        const matchesCategory = category === '全部' || p.category === category;
        return matchesQuery && matchesCategory;
      })
      .map(p => {
        // SECURITY: Map only safe fields. DO NOT return the full product object.
        // Pricing Logic based on Level
        let adjustedPrice = p.priceAfterTax;
        if (level === 'VIP') adjustedPrice *= 0.9;
        else if (level === 'Gold') adjustedPrice *= 0.95;
        
        return {
          id: p.id,
          name: p.name,
          category: p.category,
          imageUrl: p.imageUrl,
          priceAfterTax: Math.round(adjustedPrice), // Real-time updated from signal
          unit: p.unit,
          origin: p.origin,
          notes: p.notes,
          stock: p.externalStock || p.stock, // Prefer external stock if set
          isDiscontinued: p.isDiscontinued,
          aiSummary: this.aiSummaries.get(p.id) || '' 
        };
      });

    // Trigger AI summarization for visible products without summaries
    if (this.edgeAi.isAvailable()) {
      products.forEach(p => {
        if (!this.aiSummaries.has(p.id)) {
          this.edgeAi.summarizeProduct(p.name, p.notes || '').then(summary => {
            if (summary) {
              this.aiSummaries.set(p.id, summary);
              // Note: This won't trigger a re-render of computed immediately 
              // but will be available on next cycle or manual trigger.
              // In a real app, we might use a signal-based cache.
            }
          });
        }
      });
    }

    return products;
  });

  constructor() {
    // Effect to trigger AI summarization if available
    effect(() => {
      if (this.edgeAi.isAvailable()) {
        // In a real app, we would batch this or do it on hover to save resources
        // For demo, we just log capability
        console.log('Edge AI is ready to summarize products');
      }
    });
  }

  toggleVoiceSearch() {
    if (typeof window === 'undefined' || !('webkitSpeechRecognition' in window)) {
      alert('您的瀏覽器不支援語音辨識');
      return;
    }

    if (this.isListening()) {
      this.isListening.set(false);
      // Stop logic handled by end event usually
      return;
    }

    this.isListening.set(true);
    const recognition = new (window as any).webkitSpeechRecognition();
    recognition.lang = 'zh-TW';
    recognition.continuous = false;
    recognition.interimResults = false;

    recognition.onresult = (event: any) => {
      const transcript = event.results[0][0].transcript;
      this.searchQuery.set(transcript);
      this.isListening.set(false);
    };

    recognition.onerror = () => {
      this.isListening.set(false);
    };

    recognition.onend = () => {
      this.isListening.set(false);
    };

    recognition.start();
  }

  addToCart(product: any) {
    this.cartCount.update(c => c + 1);
    // In a real app, add to cart service
    
    // Voice Feedback
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      const u = new SpeechSynthesisUtterance(`已將 ${product.name} 加入購物車`);
      u.lang = 'zh-TW';
      window.speechSynthesis.speak(u);
    }
  }
}
