
// Force re-compilation
import { ChangeDetectionStrategy, Component, signal, effect, inject, computed } from '@angular/core';
import { CommonModule, DOCUMENT } from '@angular/common';
import { SidebarComponent } from '../components/sidebar/sidebar.component';
import { BottomNavComponent } from '../components/bottom-nav/bottom-nav.component';
import { DashboardComponent } from '../components/dashboard/dashboard.component';
import { ProductsComponent } from '../components/products/products.component';
import { SuppliersComponent } from '../components/suppliers/suppliers.component';
import { CustomersComponent } from '../components/customers/customers.component';
import { PurchasesComponent } from '../components/purchases/purchases.component';
import { AiAssistantComponent } from '../components/ai-assistant/ai-assistant.component';
import { SystemComponent } from '../components/system/system.component';
import { OrdersComponent } from '../components/orders/orders.component';
import { ShippingComponent } from '../components/shipping/shipping.component';
import { CompanyProfileComponent } from '../components/company-profile/company-profile.component';
import { BrandManagementComponent } from '../components/brand-management/brand-management.component';
import { EmployeesComponent } from '../components/employees/employees.component';
import { SmartImportComponent } from '../components/smart-import/smart-import.component';
import { AiTrainingComponent } from '../components/ai-training/ai-training.component';
import { ManufacturingComponent } from '../components/manufacturing/manufacturing.component';
import { DefinitionsComponent } from '../components/definitions/definitions.component';
import { InventoryAllocatorComponent } from '../components/inventory-allocator/inventory-allocator.component';
import { NotebookComponent } from '../components/notebook/notebook.component';
import { FinanceComponent } from '../components/finance/finance.component';
import { TasksComponent } from '../components/tasks/tasks.component';
import { MobileLayoutComponent } from '../components/mobile-layout/mobile-layout.component';
import { PettyCashComponent } from '../components/petty-cash/petty-cash.component';
import { ReportsComponent } from '../components/reports/reports.component';
import { PriceCalculatorComponent } from '../components/price-calculator/price-calculator.component';
import { LoginComponent } from '../components/login/login.component';
import { MobileQuoteComponent } from '../components/mobile-quote/mobile-quote.component';
import { DataService } from '../services/data.service';
import { ScreenService } from '../services/screen.service';
import { ViewType } from '../models/erp.models';
import { Router, RouterOutlet } from '@angular/router';

import { ExternalPortalComponent } from '../components/external-portal/external-portal.component';
import { ChannelsComponent } from '../components/channels/channels.component';

@Component({
  selector: 'app-root',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    CommonModule,
    RouterOutlet,
    SidebarComponent,
    BottomNavComponent,
    DashboardComponent,
    ProductsComponent,
    SuppliersComponent,
    CustomersComponent,
    PurchasesComponent,
    AiAssistantComponent,
    SystemComponent,
    OrdersComponent,
    ManufacturingComponent,
    ShippingComponent,
    CompanyProfileComponent,
    BrandManagementComponent,
    EmployeesComponent,
    SmartImportComponent,
    AiTrainingComponent,
    DefinitionsComponent,
    InventoryAllocatorComponent,
    NotebookComponent,
    FinanceComponent,
    TasksComponent,
    MobileLayoutComponent,
    PettyCashComponent,
    ReportsComponent,
    PriceCalculatorComponent,
    LoginComponent,
    ExternalPortalComponent,
    MobileQuoteComponent,
    ChannelsComponent
  ],
  styles: [`:host { display: block; height: 100%; }`],
  template: `
    <div class="flex h-full bg-gray-100 dark:bg-slate-900 transition-colors duration-300"
         [class.bg-stone-100]="isMediumTheme()">
      
      @if (isMobileQuoteRoute()) {
        <div class="w-full h-full">
          <router-outlet></router-outlet>
        </div>
      }
      @else if (!dataService.currentUser()) {
        <app-login class="w-full h-full flex items-center justify-center"></app-login>
      }
      @else {
      <!-- Standalone Mobile Mode: Full Screen App Experience -->
      @if (currentView() === 'standalone-mobile') {
          <app-mobile-layout class="w-full h-full" [isStandalone]="true" (exitStandalone)="onNavigate('dashboard')"></app-mobile-layout>
      } 
      @else if (currentView() === 'external-portal') {
          <!-- External Portal Mode: No Sidebar, Full Screen -->
          <app-external-portal class="w-full h-full overflow-y-auto"></app-external-portal>
          
          <!-- Optional: Back to Admin Button (For Demo Purposes) -->
          <button (click)="onNavigate('dashboard')" class="fixed bottom-4 right-4 bg-slate-800 text-white p-2 rounded-full shadow-lg z-50 opacity-50 hover:opacity-100 transition-opacity text-xs">
             Admin
          </button>
      }
      @else {
          <!-- Standard Desktop/Responsive Layout -->
          
          <!-- Logic Split: Sidebar for Desktop, Nothing for Mobile (Nav is at bottom) -->
          @if (!screenService.isMobile()) {
             <app-sidebar (navigate)="onNavigate($event)"></app-sidebar>
          }

          <main class="flex-1 flex flex-col overflow-hidden relative" 
                [class.pb-16]="screenService.isMobile()"> <!-- Add padding for bottom nav on mobile -->
            
            <div class="flex-1 overflow-hidden bg-slate-50 dark:bg-slate-900 transition-colors duration-300 relative"
                 [class.bg-stone-50]="isMediumTheme()">
              @switch (currentView()) {
                @case ('dashboard') {
                  <app-dashboard (navigate)="onNavigate($event)"></app-dashboard>
                }
                @case ('reports') {
                  <app-reports></app-reports>
                }
                @case ('products') {
                  <app-products></app-products>
                }
                @case ('suppliers') {
                  <app-suppliers></app-suppliers>
                }
                @case ('customers') {
                  <app-customers></app-customers>
                }
                @case ('orders') {
                  <app-orders></app-orders>
                }
                @case ('manufacturing') {
                  <app-manufacturing></app-manufacturing>
                }
                @case ('shipping') {
                  <app-shipping></app-shipping>
                }
                @case ('purchases') {
                  <app-purchases></app-purchases>
                }
                @case ('finance') {
                  <app-finance></app-finance>
                }
                @case ('petty-cash') {
                  <app-petty-cash></app-petty-cash>
                }
                @case ('tasks') {
                  <app-tasks></app-tasks>
                }
                @case ('mobile-layout') {
                  <!-- Standard Builder View -->
                  <app-mobile-layout (launchStandalone)="onNavigate('standalone-mobile')"></app-mobile-layout>
                }
                @case ('employees') {
                  <app-employees></app-employees>
                }
                @case ('company') {
                  <app-company-profile></app-company-profile>
                }
                @case ('brand') {
                  <app-brand-management></app-brand-management>
                }
                @case ('channels') {
                  <app-channels></app-channels>
                }
                @case ('system') {
                  <app-system></app-system>
                }
                @case ('import') {
                  <app-smart-import></app-smart-import>
                }
                @case ('ai-training') {
                  <app-ai-training></app-ai-training>
                }
                @case ('definitions') {
                  <app-definitions></app-definitions>
                }
                @case ('allocator') {
                  <app-inventory-allocator></app-inventory-allocator>
                }
                @case ('notebook') {
                  <app-notebook></app-notebook>
                }
                @case ('price-calculator') {
                  <app-price-calculator></app-price-calculator>
                }
                @case ('mobile-quote') {
                  <app-mobile-quote></app-mobile-quote>
                }
              }
            </div>
          </main>
          
          <!-- Mobile Bottom Nav -->
          @if (screenService.isMobile()) {
             <app-bottom-nav (navigate)="onNavigate($event)"></app-bottom-nav>
          }
          
          <app-ai-assistant></app-ai-assistant>

          <!-- Global Alert Modal for Urgent POs -->
          @if (showPoAlert()) {
              <div class="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-[fadeIn_0.3s]">
                  <div class="bg-white dark:bg-slate-800 rounded-xl shadow-2xl max-w-sm w-full p-6 border-l-4 border-amber-500 relative transform transition-all scale-100">
                      <button (click)="closeAlert()" class="absolute top-3 right-3 text-slate-400 hover:text-slate-600 dark:hover:text-white transition-colors">
                          <svg xmlns="http://www.w3.org/2000/svg" class="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" /></svg>
                      </button>
                      <div class="flex items-center mb-4">
                          <div class="w-12 h-12 rounded-full bg-amber-100 dark:bg-amber-900/30 flex items-center justify-center text-amber-600 dark:text-amber-400 mr-4 animate-bounce">
                              <svg xmlns="http://www.w3.org/2000/svg" class="h-7 w-7" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" /></svg>
                          </div>
                          <div>
                              <h3 class="text-xl font-bold text-slate-800 dark:text-white">採購單通知</h3>
                              <p class="text-sm text-slate-500 dark:text-slate-400">有待處理事項</p>
                          </div>
                      </div>
                      <p class="text-slate-700 dark:text-slate-200 mb-6 leading-relaxed">
                          目前有 <span class="font-bold text-amber-600 text-lg mx-1">{{ dataService.urgentUniquePurchaseOrderCount() }}</span> 筆採購單需要您的關注。<br>
                          狀態包含：員工確認、審核通過、已下訂等。
                      </p>
                      <div class="flex space-x-3">
                          <button (click)="navigateToPurchases()" class="flex-1 bg-amber-500 hover:bg-amber-600 text-white py-2.5 rounded-lg font-bold shadow-md transition-colors flex items-center justify-center">
                              前往處理
                              <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4 ml-2" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M14 5l7 7m0 0l-7 7m7-7H3" /></svg>
                          </button>
                      </div>
                  </div>
              </div>
          }
      }
    }
    </div>
  `
})
export class AppComponent {
  public dataService = inject(DataService);
  public screenService = inject(ScreenService);
  private document = inject(DOCUMENT);
  private router = inject(Router);
  
  currentView = signal<ViewType>('dashboard');
  
  /** True when URL is /mobile-quote so router-outlet is shown instead of @switch layout */
  isMobileQuoteRoute(): boolean {
    return this.router.url.includes('/mobile-quote');
  }
  
  // Computed to help template apply medium theme classes
  isMediumTheme = signal(false);
  
  // Alert State
  showPoAlert = signal(false);
  private hasAlertedForSession = false; // Prevent annoying loops
  
  constructor() {
    // Sync currentView with dataService
    effect(() => {
        const view = this.dataService.currentView();
        if (this.currentView() !== view) {
            this.currentView.set(view);
        }
    });

    // 1. Deep Link / Hash Routing Check
    try {
        const hash = window.location.hash;
        if (hash === '#purchase-review') {
             // Directly open Mobile Layout in Purchase Review mode
             this.dataService.autoOpenMobileModule.set('purchase');
             this.currentView.set('standalone-mobile');
        } else if (hash === '#order-create') {
             // Open Orders Component and trigger Wizard
             this.dataService.autoStartOrderWizard.set(true);
             this.currentView.set('orders');
        } else if (hash === '#mobile-quote') {
             this.currentView.set('mobile-quote');
        }
    } catch(e) {
        console.error('Hash routing error', e);
    }

    // 登入後重設捲動位置（修正 iOS / 瀏覽器 scroll restoration 問題）
    let wasLoggedOut = !this.dataService.currentUser();
    effect(() => {
        const user = this.dataService.currentUser();
        if (user && wasLoggedOut) {
            wasLoggedOut = false;
            // 延遲一個 tick，確保 DOM 已渲染完成
            setTimeout(() => {
                // 重設 body / html（避免 iOS Safari 捲動殘留）
                document.documentElement.scrollTop = 0;
                document.body.scrollTop = 0;
                // 找到主要內容區的捲動容器並重設
                const scrollable = document.querySelector('main div') as HTMLElement | null;
                if (scrollable) scrollable.scrollTop = 0;
            }, 0);
        } else if (!user) {
            wasLoggedOut = true;
        }
    });

    // 2. Global Theme & Font Size Effect
    effect(() => {
        const settings = this.dataService.systemSettings();
        const doc = this.document.documentElement;
        const body = this.document.body;

        // 1. Font Size Control (1-7)
        const fontSizes = ['75%', '87.5%', '100%', '112.5%', '125%', '150%', '187.5%'];
        const lvl = Math.min(Math.max(settings.fontSizeLevel, 1), 7);
        doc.style.fontSize = fontSizes[lvl - 1];

        // 2. Theme Control
        this.isMediumTheme.set(settings.theme === 'medium');

        if (settings.theme === 'dark') {
            doc.classList.add('dark');
            body.classList.remove('theme-medium');
        } else if (settings.theme === 'medium') {
            doc.classList.remove('dark');
            body.classList.add('theme-medium');
        } else {
            doc.classList.remove('dark');
            body.classList.remove('theme-medium');
        }
    });

    // Urgent PO Notification Effect
    effect(() => {
        const urgentCount = this.dataService.urgentUniquePurchaseOrderCount();
        
        // Trigger only if count > 0 and we haven't alerted this session OR if count increased significantly (optional logic omitted for simplicity)
        // Here we do simple session check logic
        if (urgentCount > 0 && !this.hasAlertedForSession) {
            this.showPoAlert.set(true);
            this.playVoiceAlert(urgentCount);
            this.hasAlertedForSession = true; // Mark as alerted
        }
    });
  }

  onNavigate(view: ViewType): void {
    if (view === 'mobile-quote') {
      this.router.navigate(['/mobile-quote']);
      return;
    }
    this.currentView.set(view);
    this.dataService.currentView.set(view);
    // Clear hash when navigating away within the app to prevent stuck state on reload
    if (view !== 'standalone-mobile') {
        try {
            history.replaceState(null, '', window.location.pathname);
        } catch (e) {
            // Ignore history errors in blob/iframe environments or when running in restricted contexts
            // console.debug('History replaceState skipped:', e);
        }
    }
  }

  closeAlert() {
      this.showPoAlert.set(false);
  }

  navigateToPurchases() {
      this.showPoAlert.set(false);
      this.currentView.set('purchases');
  }

  private playVoiceAlert(count: number) {
      if ('speechSynthesis' in window) {
          const text = `系統通知：目前有 ${count} 筆採購單狀態更新，請盡速確認。`;
          const utterance = new SpeechSynthesisUtterance(text);
          utterance.lang = 'zh-TW';
          utterance.rate = 1;
          window.speechSynthesis.speak(utterance);
      }
  }
}
