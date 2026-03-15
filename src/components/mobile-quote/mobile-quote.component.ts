
import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { DataService } from '../../services/data.service';
import { Product } from '../../models/erp.models';

@Component({
  selector: 'app-mobile-quote',
  standalone: true,
  imports: [CommonModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './mobile-quote.component.html',
})
export class MobileQuoteComponent {
  private dataService = inject(DataService);

  // Filter Options
  keyProductTypes = [
    { label: '全部', value: null },
    { label: '熱賣', value: 'A' },
    { label: '推薦', value: 'B' },
    { label: '特色', value: 'C' }
  ];

  // Filter States (Default: 水果乾, 熱賣, 有糖)
  selectedCategory = signal<string | null>('水果乾');
  selectedKeyProduct = signal<string | null>('A');
  selectedSugar = signal<boolean | null>(true);
  searchQuery = signal<string>('');

  // Expanded State
  expandedProductIds = signal<Set<string>>(new Set());

  // Derived Data
  products = this.dataService.products;

  private readonly HIDDEN_CATEGORIES = ['代工', '其他', '包材', '成品', '樣品', '折讓', '費用'];

  // Dynamically derive categories from products
  categories = computed(() => {
    const cats = new Set<string>();
    this.products().forEach(p => {
      if (p.category && !this.HIDDEN_CATEGORIES.includes(p.category)) {
        cats.add(p.category);
      }
    });
    return Array.from(cats).sort();
  });

  filteredProducts = computed(() => {
    let list = this.products().filter(p => 
      !this.HIDDEN_CATEGORIES.includes(p.category) && !p.isDiscontinued
    );
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

    list = list.map(p => ({
      ...p,
      imageUrl: (p.imageUrl && !p.imageUrl.includes('picsum')) ? p.imageUrl : ''
    }));

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

  toggleKeyProduct(type: string | null) {
    this.selectedKeyProduct.update(current => current === type ? null : type);
  }

  toggleSugar(val: boolean | null) {
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

  onImgError(event: Event) {
    const img = event.target as HTMLImageElement;
    if (!img.src.includes('temp.jpg')) {
      img.src = 'assets/temp.jpg';
    }
  }

  resetFilters() {
    this.selectedCategory.set(null);
    this.selectedKeyProduct.set(null);
    this.selectedSugar.set(null);
    this.searchQuery.set('');
  }
}
