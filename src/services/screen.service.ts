
import { Injectable, signal, computed, inject, DestroyRef } from '@angular/core';

@Injectable({
  providedIn: 'root'
})
export class ScreenService {
  // 視窗寬度訊號
  width = signal(typeof window !== 'undefined' ? window.innerWidth : 1200);

  // 斷點判斷 (Mobile < 768px)
  isMobile = computed(() => this.width() < 768);
  
  // 斷點判斷 (Tablet < 1024px)
  isTablet = computed(() => this.width() < 1024);

  private destroyRef = inject(DestroyRef);

  constructor() {
    if (typeof window === 'undefined') return;

    const onResize = () => {
      this.width.set(window.innerWidth);
    };

    window.addEventListener('resize', onResize);
    
    // Angular Cleanup Mechanism
    this.destroyRef.onDestroy(() => {
      window.removeEventListener('resize', onResize);
    });
  }
}
