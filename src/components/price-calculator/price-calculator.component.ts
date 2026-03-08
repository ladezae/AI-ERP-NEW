
import { ChangeDetectionStrategy, Component, computed, inject, signal, effect } from '@angular/core';
import { CommonModule, DecimalPipe } from '@angular/common';
import { ReactiveFormsModule, FormBuilder, FormGroup, Validators, FormsModule } from '@angular/forms';
import { DataService } from '../../services/data.service';
import { PricingCalculation, Product, PricingScenario, SpecDefinition } from '../../models/erp.models';

@Component({
  selector: 'app-price-calculator',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CommonModule, ReactiveFormsModule, FormsModule],
  providers: [DecimalPipe],
  templateUrl: './price-calculator.component.html'
})
export class PriceCalculatorComponent {
  private dataService = inject(DataService);
  private fb = inject(FormBuilder);

  // Data
  products = this.dataService.products;
  suppliers = this.dataService.suppliers;
  pricingCalculations = this.dataService.pricingCalculations;

  // State
  calcForm!: FormGroup;
  specForm!: FormGroup; // Form for adding new spec definitions
  
  selectedProductId = signal('');
  savedList = computed(() => this.pricingCalculations().sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()));
  
  // Filters
  filterSupplier = signal('');
  productSearchTerm = signal('');

  // Scenario State
  currentScenarios = signal<PricingScenario[]>([]);
  activeScenarioId = signal<string>('');
  
  // Spec Definitions State (Now Global via DataService)
  specDefinitions = this.dataService.specDefinitions;
  
  readonly DEFAULT_SCENARIOS = [
    { id: 'springShopee', name: "春哥好物蝦皮" }, 
    { id: 'springWebsite', name: "春哥好物官網" }, 
    { id: '8fruitesWebsite', name: "水果八官網零售" }, 
    { id: '8fruitesPlan3', name: "水果八方案三" }, 
    { id: 'yummy99Shopee', name: "愛吃99蝦皮" }
  ];
  
  // Computed Results for UI Display
  results = signal<{
      costAfterLoss: number;
      rawMaterialCost: number;
      packingTotalCost: number;
      commissionCost: number;
      marketingAdCost: number;
      nonRawMaterialCost: number;
      suggestedPrice: number;
      suggestedWeight: number;
      targetMarginAmountA: number;
      resultMarginRateB: number;
      resultMarginAmountB: number;
      cpValue: number;
      taxCost: number;
      isProfitable: boolean;
  }>({
      costAfterLoss: 0,
      rawMaterialCost: 0,
      packingTotalCost: 0,
      commissionCost: 0,
      marketingAdCost: 0,
      nonRawMaterialCost: 0,
      suggestedPrice: 0,
      suggestedWeight: 0,
      targetMarginAmountA: 0,
      resultMarginRateB: 0,
      resultMarginAmountB: 0,
      cpValue: 0,
      taxCost: 0,
      isProfitable: false
  });

  filteredProductOptions = computed(() => {
      const termSup = this.filterSupplier();
      const termSearch = this.productSearchTerm().toLowerCase().trim();
      
      return this.products().filter(p => {
          const matchSup = !termSup || p.supplierCode === termSup;
          const matchSearch = !termSearch || 
                              p.name.toLowerCase().includes(termSearch) || 
                              p.id.toLowerCase().includes(termSearch);
          
          // Exclude products where purchasingStatus is false (stopped purchasing)
          const isPurchasing = p.purchasingStatus !== false;

          return matchSup && matchSearch && isPurchasing;
      });
  });

  constructor() {
      this.initForm();
      this.initSpecForm();
      
      this.calcForm.valueChanges.subscribe(() => {
          this.calculate();
          this.updateCurrentScenarioState();
      });
  }

  initForm() {
      this.calcForm = this.fb.group({
          id: [''],
          productId: ['', Validators.required],
          productName: [''], 
          
          // Global Settings
          lossRate: [5, [Validators.min(0)]],
          purchaseUnit: [600, Validators.required],
          basePriceSource: ['costAfterTax'],
          
          // Shopee Fixed Prices
          priceASingle: [0],
          priceBShare: [0],
          priceCM: [0],
          priceDL: [0],
          priceEXL: [0],
          priceFParty: [0],
          
          // Scenario Fields
          scenarioName: [''], 
          calculationMode: ['fixed_price'], 
          
          // Specification
          specName: [''], 
          adjustedWeight: [150, [Validators.min(0)]], // Final Weight

          // Cost Structure
          packingLaborCost: [5, [Validators.min(0)]],
          packingMaterialCost: [3, [Validators.min(0)]],
          boxCost: [2, [Validators.min(0)]],
          
          // Channel / Fees
          taxRate: [8, [Validators.min(0)]], 
          platformCommissionRate: [5, [Validators.min(0)]], 
          marketingAdRate: [0, [Validators.min(0)]], 
          
          // Target
          targetMarginRateA: [30, [Validators.min(0), Validators.max(100)]], 
          
          // Pricing
          decidedPrice: [199, [Validators.min(0)]], // Target Price for calculation
          actualPrice: [199, [Validators.min(0)]], // Final Price for result
          marketPrice: [0], // Reference
      });
  }
  
  initSpecForm() {
      this.specForm = this.fb.group({
          specName: ['', Validators.required],
          // weight removed from form requirement
          targetPrice: [199, Validators.required], // decidedPrice
          marketPrice: [0],
          actualPrice: [199, Validators.required]
      });
  }
  
  onSupplierFilterChange(event: Event) {
      this.filterSupplier.set((event.target as HTMLSelectElement).value);
  }
  
  onProductSearchChange(event: Event) {
      this.productSearchTerm.set((event.target as HTMLInputElement).value);
  }

  // --- Scenario Management ---

  createDefaultScenarios(): PricingScenario[] {
      return this.DEFAULT_SCENARIOS.map(item => ({
          id: item.id,
          name: item.name,
          calculationMode: 'fixed_price',
          packageSpec: 'Custom',
          specName: '',
          adjustedWeight: 150,
          packingLaborCost: 5,
          packingMaterialCost: 3,
          boxCost: 2,
          taxRate: item.name.includes('蝦皮') ? 8 : 5, 
          platformCommissionRate: item.name.includes('蝦皮') ? 12 : 0, 
          marketingAdRate: 0,
          targetMarginRateA: 30,
          decidedPrice: 199,
          actualPrice: 199,
          marketPrice: 0
      }));
  }
  
  addCustomScenario() {
      const activeId = this.activeScenarioId();
      const currentScenario = this.currentScenarios().find(s => s.id === activeId);
      
      const promptName = currentScenario ? `${currentScenario.name} (複製)` : '新情境';
      const name = prompt('請輸入新情境名稱:', promptName);
      
      if (!name) return;
      
      let baseData: any = {};
      
      if (currentScenario) {
          baseData = JSON.parse(JSON.stringify(currentScenario));
          delete baseData.id;
          delete baseData.name;
      } else {
          baseData = {
              calculationMode: 'fixed_price',
              adjustedWeight: 150,
              packingLaborCost: 5,
              packingMaterialCost: 3,
              boxCost: 2,
              taxRate: 5,
              platformCommissionRate: 0,
              marketingAdRate: 0,
              targetMarginRateA: 30,
              decidedPrice: 199,
              actualPrice: 199,
              marketPrice: 0
          };
      }

      const newScenario: PricingScenario = {
          id: `SC-${Date.now()}`,
          name: name,
          packageSpec: 'Custom',
          specName: baseData.specName || '',
          ...baseData
      };
      
      this.currentScenarios.update(s => [...s, newScenario]);
      this.setActiveTab(newScenario.id);
  }
  
  renameScenario(id: string) {
      const scenario = this.currentScenarios().find(s => s.id === id);
      if (!scenario) return;
      
      const newName = prompt('修改情境名稱:', scenario.name);
      if (newName && newName.trim() !== '') {
          this.currentScenarios.update(list => list.map(s => s.id === id ? { ...s, name: newName.trim() } : s));
          if (this.activeScenarioId() === id) {
              this.calcForm.patchValue({ scenarioName: newName.trim() });
          }
      }
  }

  removeScenario(id: string, event: Event) {
      event.stopPropagation();
      if (this.currentScenarios().length <= 1) {
          alert('至少需要保留一個情境');
          return;
      }
      if (confirm('確定要刪除此情境嗎？')) {
          this.currentScenarios.update(s => s.filter(x => x.id !== id));
          if (this.activeScenarioId() === id) {
              this.setActiveTab(this.currentScenarios()[0].id);
          }
      }
  }

  setActiveTab(scenarioId: string) {
      const target = this.currentScenarios().find(s => s.id === scenarioId);
      if (!target) return;

      this.activeScenarioId.set(scenarioId);

      // Use emitEvent: false to prevent circular update loop (UI -> State -> UI)
      this.calcForm.patchValue({
          scenarioName: target.name,
          calculationMode: target.calculationMode || 'fixed_price',
          specName: target.specName || '',
          adjustedWeight: target.adjustedWeight,
          packingLaborCost: target.packingLaborCost,
          packingMaterialCost: target.packingMaterialCost,
          boxCost: target.boxCost,
          taxRate: target.taxRate,
          platformCommissionRate: target.platformCommissionRate,
          marketingAdRate: target.marketingAdRate ?? 0, 
          targetMarginRateA: target.targetMarginRateA,
          decidedPrice: target.decidedPrice,
          actualPrice: target.actualPrice ?? target.decidedPrice,
          marketPrice: target.marketPrice ?? 0
      }, { emitEvent: false });
      
      // Manually trigger calculation for the UI to update visual numbers without dirtying state
      this.calculate();
  }

  updateCurrentScenarioState() {
      const activeId = this.activeScenarioId();
      if (!activeId) return;

      const val = this.calcForm.getRawValue();
      const res = this.results();
      
      this.currentScenarios.update(scenarios => {
          return scenarios.map(s => {
              if (s.id === activeId) {
                  return {
                      ...s,
                      calculationMode: val.calculationMode,
                      packageSpec: 'Custom',
                      specName: val.specName,
                      adjustedWeight: val.adjustedWeight,
                      packingLaborCost: val.packingLaborCost,
                      packingMaterialCost: val.packingMaterialCost,
                      boxCost: val.boxCost,
                      taxRate: val.taxRate,
                      platformCommissionRate: val.platformCommissionRate,
                      marketingAdRate: val.marketingAdRate,
                      targetMarginRateA: val.targetMarginRateA,
                      decidedPrice: val.decidedPrice,
                      actualPrice: val.actualPrice,
                      marketPrice: val.marketPrice,
                      suggestedWeight: res.suggestedWeight,
                      rawMaterialCost: res.rawMaterialCost,
                      taxCost: res.taxCost,
                      commissionCost: res.commissionCost,
                      packingTotalCost: res.packingTotalCost
                  };
              }
              return s;
          });
      });
  }
  
  // --- Spec Definition Management (Global) ---
  
  addSpecDefinition() {
      if (this.specForm.invalid) return;
      const val = this.specForm.value;
      
      const newSpec: SpecDefinition = {
          id: `SPEC-${Date.now()}`,
          specName: val.specName,
          weight: 0, // Removed weight setting as requested
          targetPrice: val.targetPrice,
          marketPrice: val.marketPrice,
          actualPrice: val.actualPrice
      };
      
      this.dataService.addSpecDefinition(newSpec); // Call global service
      this.specForm.reset({
          targetPrice: 199, actualPrice: 199, marketPrice: 0
      });
  }
  
  removeSpecDefinition(id: string) {
      this.dataService.deleteSpecDefinition(id); // Call global service
  }
  
  applySpecDefinition(spec: SpecDefinition) {
      // Patch current active scenario form values
      this.calcForm.patchValue({
          specName: spec.specName,
          // adjustedWeight: spec.weight, // Do NOT update weight
          decidedPrice: spec.targetPrice, // Target Price
          marketPrice: spec.marketPrice,
          actualPrice: spec.actualPrice
      });
  }

  onSpecNameChange(event: Event) {
      const name = (event.target as HTMLSelectElement).value;
      const spec = this.specDefinitions().find(s => s.specName === name);
      if (spec) {
          this.applySpecDefinition(spec);
      }
  }

  // --- Main Actions ---

  onProductChange(event: Event) {
      const pId = (event.target as HTMLSelectElement).value;
      if (!pId) return;

      this.selectedProductId.set(pId);
      
      // 1. Try to find existing saved calculation (Latest)
      // ONE FILE PER PRODUCT: Look for exact match
      const existingCalc = this.pricingCalculations().find(c => c.productId === pId);
      
      if (existingCalc) {
          this.loadCalculation(existingCalc);
      } else {
          // 2. Fallback to fresh defaults
          const product = this.products().find(p => p.id === pId);
          const defaults = this.createDefaultScenarios();
          this.currentScenarios.set(defaults);
          // REMOVED: this.specDefinitions.set([]); // Global specs should persist
          
          if (product) {
              this.calcForm.patchValue({
                  id: '', // New record indicator
                  productId: product.id,
                  productName: product.name,
                  lossRate: 5,
                  purchaseUnit: 600,
                  basePriceSource: 'costAfterTax',
                  // Reset fixed prices
                  priceASingle: 0,
                  priceBShare: 0,
                  priceCM: 0,
                  priceDL: 0,
                  priceEXL: 0,
                  priceFParty: 0
              }, { emitEvent: false }); // Do not trigger recalc yet
              
              // Set active tab which will trigger calc
              this.setActiveTab(defaults[0].id);
          }
      }
  }

  setCalculationMode(mode: 'fixed_price' | 'fixed_weight') {
      this.calcForm.patchValue({ calculationMode: mode });
  }

  calculate() {
      const val = this.calcForm.getRawValue();
      const product = this.products().find(p => p.id === val.productId);
      const mode = val.calculationMode || 'fixed_price';
      
      const sourceKey = val.basePriceSource || 'costAfterTax';
      let baseCost = 0;
      if (product) {
          baseCost = Number((product as any)[sourceKey]) || 0;
      }
      
      // 1. Costs
      const costAfterLoss = baseCost * (1 + (val.lossRate / 100));
      const unitWeight = Number(val.purchaseUnit) || 600;
      const costPerGram = unitWeight > 0 ? (costAfterLoss / unitWeight) : 0;
      const packingTotal = Number(val.packingLaborCost) + Number(val.packingMaterialCost) + Number(val.boxCost);

      // --- Mode Specific Logic ---
      let suggestedPrice = 0;
      let suggestedWeight = 0;
      
      if (mode === 'fixed_price') {
          // Fixed Price -> Calc Weight
          const price = Number(val.decidedPrice) || 0;
          const targetMarginRate = val.targetMarginRateA / 100;
          
          const maxAllowedTotalCost = price * (1 - targetMarginRate);
          const feesRate = (val.taxRate / 100) + (val.platformCommissionRate / 100) + (val.marketingAdRate / 100);
          const feeCost = price * feesRate;
          
          const nonRawMaterialCost = packingTotal + feeCost;
          const availableForRaw = maxAllowedTotalCost - nonRawMaterialCost;
          
          if (costPerGram > 0 && availableForRaw > 0) {
              suggestedWeight = Math.floor(availableForRaw / costPerGram);
          }
          suggestedPrice = price;
      } else {
          // Fixed Weight -> Calc Price
          const rawCost = val.adjustedWeight * costPerGram;
          const feesRate = (val.taxRate / 100) + (val.platformCommissionRate / 100) + (val.marketingAdRate / 100);
          const targetMarginRate = val.targetMarginRateA / 100;
          
          const denominator = 1 - targetMarginRate - feesRate;
          
          if (denominator > 0) {
              suggestedPrice = (rawCost + packingTotal) / denominator;
          }
          suggestedPrice = Math.ceil(suggestedPrice);
          suggestedWeight = val.adjustedWeight;
      }

      // --- Final Results (Using Adjusted/Actual values) ---
      const finalPrice = Number(val.actualPrice) > 0 ? Number(val.actualPrice) : (Number(val.decidedPrice) || 0);
      const finalWeight = Number(val.adjustedWeight) || 0;

      const actualRawCost = finalWeight * costPerGram;
      const taxCost = finalPrice * (val.taxRate / 100);
      const commissionCost = finalPrice * (val.platformCommissionRate / 100);
      const marketingAdCost = finalPrice * (val.marketingAdRate / 100);
      
      const nonRawMaterialCost = packingTotal + taxCost + commissionCost + marketingAdCost;
      const totalCostB = actualRawCost + nonRawMaterialCost;
      
      const profitB = finalPrice - totalCostB;
      const marginRateB = finalPrice > 0 ? (profitB / finalPrice) * 100 : 0;
      
      const isProfitable = marginRateB >= val.targetMarginRateA;
      const cpValue = finalPrice > 0 ? (finalWeight / finalPrice) : 0;

      this.results.set({
          costAfterLoss,
          rawMaterialCost: actualRawCost,
          packingTotalCost: packingTotal,
          commissionCost,
          marketingAdCost,
          nonRawMaterialCost,
          suggestedPrice,
          suggestedWeight,
          targetMarginAmountA: 0,
          resultMarginRateB: marginRateB,
          resultMarginAmountB: profitB,
          cpValue,
          taxCost,
          isProfitable
      });
  }

  saveCalculation() {
      if (this.calcForm.invalid) {
          alert('請填寫完整資訊');
          return;
      }
      const formVal = this.calcForm.getRawValue();
      
      // ONE FILE PER PRODUCT Logic
      // Check if there is already a calculation for this product
      const existing = this.pricingCalculations().find(c => c.productId === formVal.productId);
      
      const id = existing ? existing.id : (formVal.id || `PRC-${Date.now()}`);
      
      const data: PricingCalculation = {
          id: id,
          productId: formVal.productId,
          productName: formVal.productName,
          updatedAt: new Date().toISOString(),
          lossRate: formVal.lossRate,
          purchaseUnit: formVal.purchaseUnit,
          basePriceSource: formVal.basePriceSource,
          scenarios: this.currentScenarios(),
          specDefinitions: this.specDefinitions(), // Saving global specs as a snapshot is optional but harmless
          // Save the 6 fixed prices
          priceASingle: formVal.priceASingle,
          priceBShare: formVal.priceBShare,
          priceCM: formVal.priceCM,
          priceDL: formVal.priceDL,
          priceEXL: formVal.priceEXL,
          priceFParty: formVal.priceFParty
      };

      if (existing) {
          this.dataService.updatePricingCalculation(data);
          // Ensure form ID matches
          if (this.calcForm.value.id !== id) {
              this.calcForm.patchValue({ id: id }, {emitEvent: false});
          }
      } else {
          this.dataService.addPricingCalculation(data);
          this.calcForm.patchValue({ id: id }, {emitEvent: false});
      }
      
      alert('已儲存試算結果！');
  }

  loadCalculation(calc: PricingCalculation) {
      // Patch global fields first
      this.calcForm.patchValue({
          id: calc.id,
          productId: calc.productId,
          productName: calc.productName,
          lossRate: calc.lossRate,
          purchaseUnit: calc.purchaseUnit,
          basePriceSource: calc.basePriceSource || 'costAfterTax',
          // Patch fixed prices
          priceASingle: calc.priceASingle || 0,
          priceBShare: calc.priceBShare || 0,
          priceCM: calc.priceCM || 0,
          priceDL: calc.priceDL || 0,
          priceEXL: calc.priceEXL || 0,
          priceFParty: calc.priceFParty || 0
      }, { emitEvent: false }); // Prevent premature state update
      
      this.selectedProductId.set(calc.productId);
      
      // DO NOT Overwrite global specDefinitions with stored snapshot.
      // Global definitions should remain from DataService.
      
      if (calc.scenarios && calc.scenarios.length > 0) {
          this.currentScenarios.set(JSON.parse(JSON.stringify(calc.scenarios)));
      } else {
          // Fallback legacy loading
          const defaults = this.createDefaultScenarios();
          this.currentScenarios.set(defaults);
      }
      
      // Load first scenario as active tab
      this.setActiveTab(this.currentScenarios()[0].id);
  }

  deleteCalculation(id: string, event: Event) {
      event.stopPropagation();
      if (confirm('確定要刪除此試算紀錄嗎？')) {
          this.dataService.deletePricingCalculation(id);
          if (this.calcForm.value.id === id) {
              this.calcForm.patchValue({ id: '' });
              this.currentScenarios.set([]);
              // REMOVED: this.specDefinitions.set([]); 
          }
      }
  }

  getProductBaseCost(): number {
      const p = this.products().find(x => x.id === this.selectedProductId());
      if (!p) return 0;
      const source = this.calcForm.get('basePriceSource')?.value || 'costAfterTax';
      return Number((p as any)[source]) || 0;
  }
}
