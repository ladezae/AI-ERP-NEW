
import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { DataService } from '../../services/data.service';
import { Product } from '../../models/erp.models';
import { SafeHtmlPipe } from '../../pipes/safe-html.pipe';

@Component({
  selector: 'app-mobile-quote',
  standalone: true,
  imports: [CommonModule, SafeHtmlPipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './mobile-quote.component.html',
  styles: [`
    :host {
      display: block;
      height: 100%;
      @apply bg-slate-50 dark:bg-slate-900 transition-colors duration-300;
    }
    .no-scrollbar::-webkit-scrollbar { display: none; }
    .no-scrollbar { -ms-overflow-style: none; scrollbar-width: none; }

    .filter-btn-sm {
      transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
      @apply flex-shrink-0 px-3 py-1.5 rounded-lg border text-[11px] font-bold shadow-sm;
    }
    
    .tag-btn {
      transition: all 0.2s ease;
      @apply px-2.5 py-1 rounded-md text-[10px] font-extrabold uppercase tracking-wider border;
    }

    /* Comfortable palette based on ERP primary colors */
    .btn-cat { @apply border-slate-200 bg-white text-slate-500 dark:bg-slate-800 dark:border-slate-700 dark:text-slate-400; }
    .btn-cat-active { @apply bg-sky-600 text-white border-sky-600 shadow-md; }
    
    .btn-kp { @apply border-slate-200 bg-white text-slate-400 dark:bg-slate-800 dark:border-slate-700; }
    .btn-kp-active { 
      @apply bg-indigo-50 text-indigo-600 border-indigo-200 shadow-sm;
      @apply dark:bg-indigo-900/30 dark:text-indigo-300 dark:border-indigo-800;
    }

    .product-card {
      @apply bg-white dark:bg-slate-800 rounded-2xl shadow-sm border border-slate-100 dark:border-slate-700 overflow-hidden transition-all;
    }
    .product-card:active {
      @apply scale-[0.98] bg-slate-50 dark:bg-slate-700;
    }
  `]
})
export class MobileQuoteComponent {
  private dataService = inject(DataService);

  // Filter Options
  keyProductTypes = [
    { label: '熱賣', value: 'A' },
    { label: '推薦', value: 'B' },
    { label: '特色', value: 'C' }
  ];

  // Filter States (Default null/false)
  selectedCategory = signal<string | null>(null);
  selectedKeyProduct = signal<string | null>(null);
  selectedSugar = signal<boolean | null>(null);
  searchQuery = signal<string>('');

  // Expanded State
  expandedProductIds = signal<Set<string>>(new Set());

  // Derived Data
  products = this.dataService.products;

  // Dynamically derive categories from products
  categories = computed(() => {
    const cats = new Set<string>();
    this.products().forEach(p => {
      if (p.category) cats.add(p.category);
    });
    return Array.from(cats).sort();
  });

  filteredProducts = computed(() => {
    let list = this.products();
    const query = this.searchQuery().toLowerCase().trim();

    if (query) {
      list = list.filter(p => 
        (p.name?.toLowerCase() || '').includes(query) || 
        (p.supplierCode?.toLowerCase() || '').includes(query) ||
        (p.id?.toLowerCase() || '').includes(query)
      );
    }

    const cat = this.selectedCategory();
    if (cat) {
      list = list.filter(p => p.category === cat);
    }

    const kp = this.selectedKeyProduct();
    if (kp) {
      list = list.filter(p => p.keyProduct === kp);
    }

    const sugar = this.selectedSugar();
    if (sugar !== null) {
      list = list.filter(p => p.sugar === sugar);
    }

    return list;
  });

  // Toggle Methods
  onSearch(event: Event) {
    const input = event.target as HTMLInputElement;
    this.searchQuery.set(input.value);
  }

  toggleCategory(cat: string) {
    this.selectedCategory.update(current => current === cat ? null : cat);
  }

  toggleKeyProduct(type: string) {
    this.selectedKeyProduct.update(current => current === type ? null : type);
  }

  toggleSugar(val: boolean) {
    this.selectedSugar.update(current => current === val ? null : val);
  }

  toggleExpand(id: string) {
    this.expandedProductIds.update(prev => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }

  resetFilters() {
    this.selectedCategory.set(null);
    this.selectedKeyProduct.set(null);
    this.selectedSugar.set(null);
    this.searchQuery.set('');
  }
}
