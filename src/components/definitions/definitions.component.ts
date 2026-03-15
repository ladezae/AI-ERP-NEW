
import { ChangeDetectionStrategy, Component, computed, inject, signal, ElementRef, ViewChild, effect } from '@angular/core';
import { CommonModule, DecimalPipe } from '@angular/common';
import { ReactiveFormsModule, FormsModule, FormBuilder, FormGroup, Validators } from '@angular/forms';
import { DataService } from '../../services/data.service';
import { AiService } from '../../services/ai.service';
import { ImageService } from '../../services/image.service'; // Inject ImageService
import { MetricDefinition } from '../../models/erp.models';
import { TaiwanDatePipe } from '../../pipes/taiwan-date.pipe';
import * as d3 from 'd3';

// Graph Interfaces
interface SystemNode extends d3.SimulationNodeDatum {
  id: string;
  label: string;
  type: 'entity' | 'metric';
  group: string;
  r: number;
  color: string;
  x?: number;
  y?: number;
  fx?: number | null;
  fy?: number | null;
}

interface SystemLink extends d3.SimulationLinkDatum<SystemNode> {
  source: string | SystemNode;
  target: string | SystemNode;
  type: 'relation' | 'calc';
  dashed?: boolean;
}

@Component({
  selector: 'app-definitions',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CommonModule, ReactiveFormsModule, FormsModule, TaiwanDatePipe],
  providers: [DecimalPipe],
  templateUrl: './definitions.component.html',
  styles: [`
    :host { display: block; height: 100%; overflow: hidden; }
    .node text { pointer-events: none; text-shadow: 0 1px 0 #fff, 1px 0 0 #fff, 0 -1px 0 #fff, -1px 0 0 #fff; }
    .dark .node text { text-shadow: 0 1px 0 #000, 1px 0 0 #000, 0 -1px 0 #000, -1px 0 0 #000; }
  `]
})
export class DefinitionsComponent {
  private dataService = inject(DataService);
  private aiService = inject(AiService);
  private imageService = inject(ImageService); // Inject ImageService
  private fb = inject(FormBuilder);

  definitions = this.dataService.metricDefinitions;
  
  // Computed values map
  calculatedValues = computed(() => {
      const defs = this.definitions();
      const results: Record<string, string | number> = {};
      defs.forEach(def => {
          results[def.id] = this.dataService.evaluateFormula(def.formula);
      });
      return results;
  });

  searchTerm = signal('');
  selectedCategoryFilter = signal('all');

  // View Mode
  viewMode = signal<'list' | 'graph'>('list');
  @ViewChild('graphContainer') graphContainer!: ElementRef<HTMLDivElement>;

  // Modal State
  showModal = signal(false);
  isEditMode = signal(false); 
  isProcessing = signal(false); // AI Loading
  testResult = signal<string | number | null>(null); // Preview Result
  
  defForm!: FormGroup;

  readonly categories = [
    { id: 'Finance', label: '財務 (Finance)', icon: 'currency-dollar', color: 'emerald' },
    { id: 'Order', label: '訂單 (Order)', icon: 'shopping-bag', color: 'blue' },
    { id: 'Product', label: '商品 (Product)', icon: 'cube', color: 'rose' },
    { id: 'Inventory', label: '庫存 (Inventory)', icon: 'archive-box', color: 'amber' },
    { id: 'PurchaseOrder', label: '採購 (Purchase)', icon: 'truck', color: 'orange' },
    { id: 'ShippingOrder', label: '出貨 (Shipping)', icon: 'paper-airplane', color: 'sky' },
    { id: 'Manufacturing', label: '代工 (Mfg)', icon: 'cog', color: 'purple' },
    { id: 'Customer', label: '客戶 (Customer)', icon: 'users', color: 'indigo' },
    { id: 'Supplier', label: '供應商 (Supplier)', icon: 'office-building', color: 'slate' },
    { id: 'Employee', label: '員工 (HR)', icon: 'id-card', color: 'teal' },
    { id: 'Other', label: '其他 (Other)', icon: 'chart-pie', color: 'gray' }
  ];

  constructor() {
    this.initForm();

    // Effect to render graph when switching to graph mode
    effect(() => {
        if (this.viewMode() === 'graph') {
            // Wait for DOM
            setTimeout(() => this.renderSystemGraph(), 50);
        }
    });
  }

  initForm() {
    this.defForm = this.fb.group({
      id: [''],
      fieldEn: ['tempKey'], // Hidden field, auto-generated or managed
      fieldTw: ['', Validators.required], // Task Name
      category: ['Order', Validators.required],
      formula: ['', Validators.required], 
      logicDescription: ['', Validators.required],
      showOnDashboard: [true], 
      isLocked: [false],
      referenceImageUrl: [''] // Added reference image URL field
    });

    // Auto-calculate test result when formula changes manually
    this.defForm.get('formula')?.valueChanges.subscribe(f => {
        if(f) {
           const res = this.dataService.evaluateFormula(f);
           this.testResult.set(res);
        }
    });
  }

  filteredDefinitions = computed(() => {
    const term = this.searchTerm().toLowerCase();
    const cat = this.selectedCategoryFilter();
    
    return this.definitions().filter(d => {
      const matchSearch = d.fieldTw.toLowerCase().includes(term) || d.logicDescription.toLowerCase().includes(term);
      const matchCat = cat === 'all' || d.category === cat;
      return matchSearch && matchCat;
    }).sort((a, b) => new Date(b.lastUpdated).getTime() - new Date(a.lastUpdated).getTime());
  });

  onSearchTermChange(event: Event): void {
      const value = (event.target as HTMLInputElement).value;
      this.searchTerm.set(value);
  }

  setCategoryFilter(cat: string) {
      this.selectedCategoryFilter.set(cat);
  }
  
  setViewMode(mode: 'list' | 'graph') {
      this.viewMode.set(mode);
  }

  toggleDashboard(def: MetricDefinition, event: Event) {
      event.stopPropagation();
      const isChecked = (event.target as HTMLInputElement).checked;
      const updated = { ...def, showOnDashboard: isChecked, lastUpdated: new Date().toISOString() };
      this.dataService.updateMetricDefinition(updated);
  }

  // --- Modal Actions ---

  private generateNextId(): string {
    const defs = this.definitions();
    let maxId = 0;
    defs.forEach(d => {
      const match = d.id.match(/^MET-(\d+)$/);
      if (match) {
        const num = parseInt(match[1], 10);
        if (num > maxId) maxId = num;
      }
    });
    return `MET-${(maxId + 1).toString().padStart(3, '0')}`;
  }

  openAddModal() {
    this.isEditMode.set(false);
    this.initForm();
    const nextId = this.generateNextId();
    this.defForm.patchValue({ 
        id: nextId, 
        showOnDashboard: true, 
        isLocked: false,
        fieldEn: `metric_${Date.now()}` // Temporary unique key
    });
    this.defForm.get('id')?.disable();
    this.testResult.set(null);
    this.showModal.set(true);
  }

  openEditModal(def: MetricDefinition) {
    this.isEditMode.set(true);
    this.initForm();
    this.defForm.patchValue(def);
    this.defForm.get('id')?.disable();
    this.testResult.set(this.calculatedValues()[def.id]);
    this.showModal.set(true);
  }

  closeModal() {
    this.showModal.set(false);
  }

  // --- Image Handling ---

  async onFileSelected(event: Event) {
      const input = event.target as HTMLInputElement;
      if (input.files && input.files[0]) {
          const file = input.files[0];
          try {
              const base64 = await this.imageService.compressImage(file);
              this.defForm.patchValue({ referenceImageUrl: base64 });
          } catch(e) {
              console.error('Image upload failed', e);
              alert('圖片處理失敗');
          } finally {
              input.value = ''; // Reset input
          }
      }
  }

  async onPaste(event: ClipboardEvent) {
      const items = event.clipboardData?.items;
      if (!items) return;

      for (let i = 0; i < items.length; i++) {
          if (items[i].type.indexOf('image') !== -1) {
              event.preventDefault();
              const blob = items[i].getAsFile();
              if (blob) {
                  try {
                      const base64 = await this.imageService.compressImage(blob);
                      this.defForm.patchValue({ referenceImageUrl: base64 });
                  } catch(e) {
                      console.error('Paste failed', e);
                      alert('圖片貼上失敗');
                  }
              }
              break;
          }
      }
  }

  removeImage() {
      this.defForm.patchValue({ referenceImageUrl: '' });
  }
  
  // --- AI Logic ---
  async executeAiGeneration() {
      const logic = this.defForm.get('logicDescription')?.value;
      const category = this.defForm.get('category')?.value;
      const imageBase64 = this.defForm.get('referenceImageUrl')?.value;

      if (!logic && !imageBase64) {
          alert('請先輸入「任務邏輯需求」或上傳圖片，才能讓 AI 進行運算設計。');
          return;
      }

      this.isProcessing.set(true);
      try {
          const formula = await this.aiService.generateFormulaFromLogic(logic || 'Analyze the provided image context.', category, imageBase64);
          if (formula) {
              this.defForm.patchValue({ formula });
              // Also test immediately
              const res = this.dataService.evaluateFormula(formula);
              this.testResult.set(res);
          } else {
              alert('AI 無法理解您的需求，請嘗試更具體的描述。');
          }
      } catch (e) {
          console.error(e);
          alert('連線失敗。');
      } finally {
          this.isProcessing.set(false);
      }
  }

  onSubmit() {
    if (this.defForm.valid) {
      const formValue = this.defForm.getRawValue();
      const defData: MetricDefinition = { 
          ...formValue,
          lastUpdated: new Date().toISOString()
      };

      if (this.isEditMode()) {
          this.dataService.updateMetricDefinition(defData);
      } else {
          this.dataService.addMetricDefinition(defData);
      }
      this.closeModal();
    } else {
      this.defForm.markAllAsTouched();
    }
  }

  deleteDefinition(def: MetricDefinition, event: Event) {
      event.stopPropagation();
      if (def.isLocked) {
          alert('此為系統核心任務，無法刪除。');
          return;
      }
      if(confirm(`確定要刪除「${def.fieldTw}」這項任務嗎？`)) {
          this.dataService.deleteMetricDefinition(def.id);
      }
  }
  
  loadDefaults() {
      if(confirm('確定要載入預設的系統分析任務嗎？')) {
          this.dataService.initializeDefaultMetrics();
      }
  }

  // --- Visual Helpers ---
  getCategoryColor(cat: string): string {
      const found = this.categories.find(c => c.id === cat);
      return found ? found.color : 'gray';
  }
  
  getCategoryIcon(cat: string): string {
      const found = this.categories.find(c => c.id === cat);
      // Fallback paths for Heroicons outline
      const icons: Record<string, string> = {
          'currency-dollar': 'M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z',
          'shopping-bag': 'M16 11V7a4 4 0 00-8 0v4M5 9h14l1 12H4L5 9z',
          'cube': 'M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4',
          'archive-box': 'M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4', 
          'truck': 'M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4',
          'paper-airplane': 'M12 19l9 2-9-18-9 18 9-2zm0 0v-8',
          'cog': 'M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37.996.608 2.296.07 2.572-1.065z',
          'users': 'M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M15 21v-1a6 6 0 00-5.176-5.97',
          'office-building': 'M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4',
          'id-card': 'M10 6H5a2 2 0 00-2 2v9a2 2 0 002 2h14a2 2 0 002-2V8a2 2 0 00-2-2h-5m-4 0V5a2 2 0 114 0v1m-4 0a2 2 0 104 0m-5 8a2 2 0 100-4 2 2 0 000 4zm0 0c1.306 0 2.417.835 2.83 2M9 14a3.001 3.001 0 00-2.83 2M15 11h3m-3 4h2',
          'chart-pie': 'M11 3.055A9.001 9.001 0 1020.945 13H11V3.055z',
      };
      
      return icons[found?.icon || 'chart-pie'];
  }
  
  // --- System Graph Visualization ---
  
  private renderSystemGraph() {
      if (!this.graphContainer) return;
      const element = this.graphContainer.nativeElement;
      d3.select(element).selectAll('*').remove();
      
      const width = element.clientWidth;
      const height = element.clientHeight;
      
      // 1. Define Static Entities (Database Schema Level)
      const entities: SystemNode[] = [
          { id: 'Product', label: '商品 (Product)', type: 'entity', group: 'core', r: 35, color: '#f43f5e' }, // Rose-500
          { id: 'Order', label: '訂單 (Order)', type: 'entity', group: 'core', r: 35, color: '#3b82f6' }, // Blue-500
          { id: 'PurchaseOrder', label: '採購 (Purchase)', type: 'entity', group: 'core', r: 35, color: '#f97316' }, // Orange-500
          { id: 'Customer', label: '客戶 (Customer)', type: 'entity', group: 'partner', r: 25, color: '#6366f1' }, // Indigo-500
          { id: 'Supplier', label: '供應商 (Supplier)', type: 'entity', group: 'partner', r: 25, color: '#64748b' }, // Slate-500
          { id: 'Employee', label: '員工 (HR)', type: 'entity', group: 'system', r: 20, color: '#14b8a6' }, // Teal-500
          { id: 'Invoice', label: '發票 (Finance)', type: 'entity', group: 'finance', r: 25, color: '#10b981' } // Emerald-500
      ];
      
      // 2. Define Dynamic Metrics (Calculations)
      const metrics: SystemNode[] = this.definitions().map(def => ({
          id: def.id,
          label: def.fieldTw,
          type: 'metric',
          group: def.category,
          r: 15,
          color: '#8b5cf6' // Violet-500
      }));
      
      const nodes = [...entities, ...metrics];
      
      // 3. Define Links
      const links: SystemLink[] = [];
      
      // 3a. Static Schema Relationships
      links.push(
          { source: 'Customer', target: 'Order', type: 'relation', dashed: false },
          { source: 'Supplier', target: 'PurchaseOrder', type: 'relation', dashed: false },
          { source: 'Product', target: 'Order', type: 'relation', dashed: false },
          { source: 'Product', target: 'PurchaseOrder', type: 'relation', dashed: false },
          { source: 'Order', target: 'Invoice', type: 'relation', dashed: true },
          { source: 'PurchaseOrder', target: 'Invoice', type: 'relation', dashed: true }
      );
      
      // 3b. Metric Dependencies (Parsing Formula)
      this.definitions().forEach(def => {
          const f = def.formula;
          if (f.includes('Order')) links.push({ source: 'Order', target: def.id, type: 'calc', dashed: true });
          if (f.includes('Product')) links.push({ source: 'Product', target: def.id, type: 'calc', dashed: true });
          if (f.includes('PurchaseOrder')) links.push({ source: 'PurchaseOrder', target: def.id, type: 'calc', dashed: true });
          if (f.includes('Customer')) links.push({ source: 'Customer', target: def.id, type: 'calc', dashed: true });
          if (f.includes('Supplier')) links.push({ source: 'Supplier', target: def.id, type: 'calc', dashed: true });
          if (f.includes('Employee')) links.push({ source: 'Employee', target: def.id, type: 'calc', dashed: true });
      });
      
      // 4. Force Simulation
      const simulation = d3.forceSimulation<SystemNode, SystemLink>(nodes)
          .force('link', d3.forceLink<SystemNode, SystemLink>(links).id(d => d.id).distance(120))
          .force('charge', d3.forceManyBody().strength(-400))
          .force('center', d3.forceCenter(width / 2, height / 2))
          .force('collide', d3.forceCollide().radius(d => d.r + 20).iterations(2));

      // 5. Drawing
      const svg = d3.select(element).append('svg')
          .attr('width', width)
          .attr('height', height)
          .call(d3.zoom<SVGSVGElement, unknown>().scaleExtent([0.1, 4]).on('zoom', (event) => g.attr('transform', event.transform)))
          .on("dblclick.zoom", null);
      
      const g = svg.append('g');
      
      // Define Arrow Markers
      svg.append('defs').selectAll('marker')
          .data(['arrow-rel', 'arrow-calc'])
          .join('marker')
          .attr('id', d => d)
          .attr('viewBox', '0 -5 10 10')
          .attr('refX', 28) // Offset to not overlap node
          .attr('refY', 0)
          .attr('markerWidth', 6)
          .attr('markerHeight', 6)
          .attr('orient', 'auto')
          .append('path')
          .attr('fill', d => d === 'arrow-rel' ? '#94a3b8' : '#c4b5fd')
          .attr('d', 'M0,-5L10,0L0,5');

      const link = g.append('g')
          .selectAll('line')
          .data(links)
          .join('line')
          .attr('stroke', d => d.type === 'relation' ? '#cbd5e1' : '#ddd6fe') // Slate-300 vs Violet-200
          .attr('stroke-width', d => d.type === 'relation' ? 2 : 1.5)
          .attr('stroke-dasharray', d => d.dashed ? '5,5' : '0')
          .attr('marker-end', d => d.type === 'relation' ? 'url(#arrow-rel)' : 'url(#arrow-calc)');

      const node = g.append('g')
          .selectAll('g')
          .data(nodes)
          .join('g')
          .call(d3.drag<SVGGElement, SystemNode>()
              .on('start', dragstarted)
              .on('drag', dragged)
              .on('end', dragended));

      // Node Circles (Entity = Rect-ish via CSS or shape, here just Circle for simplicity)
      node.append('circle')
          .attr('r', d => d.r)
          .attr('fill', d => d.color)
          .attr('stroke', '#fff')
          .attr('stroke-width', 2)
          .attr('class', 'shadow-lg'); // Use filters for shadow if needed, simplified here

      // Node Labels
      node.append('text')
          .text(d => d.label)
          .attr('dy', d => d.r + 15)
          .attr('text-anchor', 'middle')
          .attr('font-size', d => d.type === 'entity' ? '12px' : '10px')
          .attr('font-weight', d => d.type === 'entity' ? 'bold' : 'normal')
          .attr('fill', document.documentElement.classList.contains('dark') ? '#e2e8f0' : '#475569');

      // Tick
      simulation.on('tick', () => {
          link
              .attr('x1', d => (d.source as SystemNode).x!)
              .attr('y1', d => (d.source as SystemNode).y!)
              .attr('x2', d => (d.target as SystemNode).x!)
              .attr('y2', d => (d.target as SystemNode).y!);

          node.attr('transform', d => `translate(${d.x},${d.y})`);
      });

      function dragstarted(event: any) {
          if (!event.active) simulation.alphaTarget(0.3).restart();
          event.subject.fx = event.subject.x;
          event.subject.fy = event.subject.y;
      }

      function dragged(event: any) {
          event.subject.fx = event.x;
          event.subject.fy = event.y;
      }

      function dragended(event: any) {
          if (!event.active) simulation.alphaTarget(0);
          event.subject.fx = null;
          event.subject.fy = null;
      }
  }
}
