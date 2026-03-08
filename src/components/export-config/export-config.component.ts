
import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { CommonModule, DecimalPipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { DataService } from '../../services/data.service';
import { ExportTemplate, TemplateSection, SectionType } from '../../models/erp.models';

@Component({
  selector: 'app-export-config',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CommonModule, FormsModule, DecimalPipe],
  providers: [DecimalPipe],
  templateUrl: './export-config.component.html',
  styles: [`
    .preview-a4 {
      width: 210mm;
      min-height: 297mm;
      background: white;
      box-shadow: 0 0 10px rgba(0,0,0,0.1);
      padding: 15mm;
      font-family: "Microsoft JhengHei", "Heiti TC", sans-serif;
      transform-origin: top center;
      transition: transform 0.2s;
    }
    .preview-section {
      border: 1px dashed transparent;
      transition: all 0.2s;
    }
    .preview-section:hover {
      border-color: #3b82f6; /* blue-500 */
      background-color: rgba(59, 130, 246, 0.05);
      cursor: pointer;
    }
    /* Draggable styles */
    .draggable-source {
      opacity: 0.5;
    }
  `]
})
export class ExportConfigComponent {
  private dataService = inject(DataService);
  exportTemplates = this.dataService.exportTemplates;

  // Modal & Edit State
  showModal = signal(false);
  isEditMode = signal(false);
  currentTemplate = signal<ExportTemplate | null>(null);
  
  // Designer UI State
  activeSectionId = signal<string | null>(null);
  previewScale = signal(0.7);
  sidebarTab = signal<'layout' | 'global'>('layout');
  draggedSectionIndex = signal<number | null>(null);

  // Constants
  readonly sectionTypes: {type: SectionType, label: string, icon: string}[] = [
    { type: 'company_header', label: '公司抬頭 (Header)', icon: 'M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4' },
    { type: 'document_title', label: '單據標題', icon: 'M4 6h16M4 12h16M4 18h7' },
    { type: 'customer_info', label: '客戶資料 (Bill To)', icon: 'M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z' },
    { type: 'items_table', label: '商品明細表', icon: 'M3 10h18M3 14h18m-9-4v8m-7 0h14a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z' },
    { type: 'cod_amount', label: '代收金額 (COD)', icon: 'M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z' },
    { type: 'custom_text', label: '自訂文字/備註', icon: 'M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z' },
    { type: 'signatures', label: '簽核欄位', icon: 'M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z' },
    { type: 'gap', label: '空白間隔', icon: 'M8 9l4-4 4 4m0 6l-4 4-4-4' },
  ];

  // Available Columns for Item Table
  readonly availableColumns = [
      { key: 'id', label: '品號 (ID)' },
      { key: 'name', label: '品名 (Name)' },
      { key: 'unit', label: '單位 (Unit)' },
      { key: 'qty', label: '數量 (Qty)' },
      { key: 'price', label: '單價 (Price)' },
      { key: 'total', label: '金額 (Total)' },
      { key: 'note', label: '備註 (Note)' }
  ];

  // Mock Data for Preview
  previewData = signal({
      isReal: false,
      company: {
          name: '公司大平台股份有限公司',
          taxId: '12345678',
          phone: '02-1234-5678',
          fax: '02-1234-5679',
          address: '台北市信義區信義路五段7號',
          brandName: '美味食品'
      },
      brandLogoUrl: 'https://picsum.photos/100/100',
      customer: {
          name: '測試客戶',
          fullName: '測試客戶有限公司',
          id: 'CUST-001',
          taxId: '87654321', 
          contact: '王小明',
          phone: '0912-345-678',
          address: '台中市西屯區台灣大道三段'
      },
      document: {
          id: 'ORD-20240520-001',
          date: '2024-05-20'
      },
      items: [
          { id: 'P-001', name: '愛文芒果乾 (150g)', unit: '包', qty: 50, price: 150, total: 7500, note: '' },
          { id: 'P-002', name: '綜合堅果隨手包', unit: '箱', qty: 10, price: 1200, total: 12000, note: '效期需半年以上' },
          { id: 'FEE-DLV-HM', name: '運費(黑貓)', unit: '次', qty: 1, price: 150, total: 150, note: '黑貓' }
      ],
      totals: {
          subtotal: 19650,
          tax: 983,
          total: 20633,
          codAmount: 20663
      },
      specialRequests: '請週一至週五上班時間配送。\n到達前請先電話聯繫。'
  });

  constructor() {}

  // --- CRUD Actions ---

  openAddModal() {
      this.isEditMode.set(false);
      this.currentTemplate.set({
          id: 'TPL-' + Date.now(),
          name: '新版型',
          type: 'order',
          title: '訂購單',
          showPrice: true,
          sections: [
              { id: 's1', type: 'company_header', visible: true, order: 1 },
              { id: 's2', type: 'customer_info', visible: true, order: 2 },
              { id: 's3', type: 'items_table', visible: true, order: 3 },
              { id: 's4', type: 'custom_text', visible: true, order: 4, title: '備註', content: '感謝您的訂購！' },
              { id: 's5', type: 'signatures', visible: true, order: 5 }
          ]
      });
      this.activeSectionId.set(null);
      this.showModal.set(true);
  }

  openEditModal(tpl: ExportTemplate) {
      this.isEditMode.set(true);
      // Deep copy
      this.currentTemplate.set(JSON.parse(JSON.stringify(tpl)));
      this.activeSectionId.set(null);
      this.showModal.set(true);
  }

  closeModal() {
      this.showModal.set(false);
      this.currentTemplate.set(null);
  }

  saveTemplate() {
      const tpl = this.currentTemplate();
      if (!tpl) return;
      
      if (this.isEditMode()) {
          this.dataService.updateExportTemplate(tpl);
      } else {
          this.dataService.addExportTemplate(tpl);
      }
      this.closeModal();
  }

  deleteTemplate(id: string) {
      if (confirm('確定要刪除此版型嗎？')) {
          this.dataService.deleteExportTemplate(id);
      }
  }

  // --- Designer Actions ---

  addSection(type: SectionType) {
      const tpl = this.currentTemplate();
      if (!tpl) return;
      
      const newSection: TemplateSection = {
          id: 'sec-' + Date.now(),
          type: type,
          visible: true,
          order: tpl.sections.length + 1,
          height: type === 'gap' ? 10 : undefined,
          content: type === 'items_table' ? JSON.stringify(['id','name','unit','qty','price','total','note']) : ''
      };
      
      // Default titles
      if (type === 'custom_text') newSection.title = '自訂標題';
      
      tpl.sections.push(newSection);
      this.activeSectionId.set(newSection.id);
  }

  removeSection(id: string) {
      const tpl = this.currentTemplate();
      if (!tpl) return;
      tpl.sections = tpl.sections.filter(s => s.id !== id);
      if (this.activeSectionId() === id) this.activeSectionId.set(null);
  }

  setSidebarTab(tab: 'layout' | 'global') {
      this.sidebarTab.set(tab);
  }

  updateZoom(delta: number) {
      this.previewScale.update(s => Math.max(0.3, Math.min(1.5, s + delta)));
  }

  getSectionLabel(type: SectionType): string {
      return this.sectionTypes.find(t => t.type === type)?.label || type;
  }

  // --- Drag and Drop ---
  onDragStart(event: DragEvent, index: number) {
      this.draggedSectionIndex.set(index);
      event.dataTransfer?.setData('text/plain', index.toString());
      if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move';
  }

  onDragOver(event: DragEvent) {
      event.preventDefault();
      if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
  }

  onDrop(event: DragEvent, index: number) {
      event.preventDefault();
      const draggedIndex = this.draggedSectionIndex();
      if (draggedIndex === null || draggedIndex === index) return;

      const tpl = this.currentTemplate();
      if (!tpl) return;

      const sections = [...tpl.sections];
      const [draggedItem] = sections.splice(draggedIndex, 1);
      sections.splice(index, 0, draggedItem);
      
      // Reassign order
      sections.forEach((s, i) => s.order = i + 1);
      tpl.sections = sections;
      
      this.draggedSectionIndex.set(null);
  }

  // --- Column Toggling for Table Section ---
  isColumnSelected(key: string): boolean {
      const tpl = this.currentTemplate();
      if (!tpl) return true;
      const section = tpl.sections.find(s => s.type === 'items_table');
      if (!section || !section.content) return true; // Default all true if no config
      
      try {
          const selected = JSON.parse(section.content);
          return selected.includes(key);
      } catch { return true; }
  }

  toggleColumn(key: string) {
      const tpl = this.currentTemplate();
      if (!tpl) return;
      const section = tpl.sections.find(s => s.type === 'items_table');
      if (!section) return;

      let selected: string[] = [];
      try {
          selected = JSON.parse(section.content || '[]');
          if (!Array.isArray(selected) || selected.length === 0) {
              selected = this.availableColumns.map(c => c.key);
          }
      } catch {
          selected = this.availableColumns.map(c => c.key);
      }

      if (selected.includes(key)) {
          selected = selected.filter(k => k !== key);
      } else {
          // Maintain order
          const newSet = new Set(selected);
          newSet.add(key);
          // Re-sort based on availableColumns order
          selected = this.availableColumns.map(c => c.key).filter(k => newSet.has(k));
      }
      
      section.content = JSON.stringify(selected);
  }
  
  // --- Section Merge Helper ---
  shouldMergeBottom(section: TemplateSection): boolean {
      return false; 
  }
}
