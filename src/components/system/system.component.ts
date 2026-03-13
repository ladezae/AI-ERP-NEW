import {
    ChangeDetectionStrategy, Component,
    computed, inject, signal,
    ElementRef, ViewChild, effect
  } from '@angular/core';
  import { CommonModule, DecimalPipe } from '@angular/common';
  import { FormsModule } from '@angular/forms';
  import { DataService, BackupSnapshot } from '../../services/data.service';
  import { ShippingTemplate, CommunicationTemplate, SchemaModel } from '../../models/erp.models';
  import { AiService } from '../../services/ai.service';
  import { OrderService } from '../../services/order.service';
  import { ImageService } from '../../services/image.service';
  import { ExportConfigComponent } from '../export-config/export-config.component';
  
  type SystemTab = 'appearance' | 'print-layout' | 'templates' | 'ocr' | 'schema' | 'settings' | 'logs' | 'data-management' | 'ai-cost' | 'external-portal';
  
  @Component({
    selector: 'app-system',
    standalone: true,
    changeDetection: ChangeDetectionStrategy.OnPush,
imports: [CommonModule, FormsModule, ExportConfigComponent],
    templateUrl: './system.component.html'
  })
  export class SystemComponent {
    private dataService = inject(DataService);
  
    public aiService = inject(AiService);
    private orderService = inject(OrderService);
    private imageService = inject(ImageService);
  
    activeTab = signal<SystemTab>('appearance');
    activeSchemaName = signal<string>('Product');
    schemaSearchTerm = signal<string>('');
  
    // Settings Signals
    currentTheme = computed(() => this.dataService.systemSettings().theme);
    currentFontSize = computed(() => this.dataService.systemSettings().fontSizeLevel);
  
    // OCR Signals
    shippingTemplates = this.dataService.shippingTemplates;
    currentTemplate = signal<ShippingTemplate | null>(null);
    isEditingTemplate = signal(false);
  
    // OCR Training State
    isTraining = signal(false);
    trainingResult = signal<{ provider: string; trackingId: string; trackingUrl: string } | null>(null);
  
    // ROI Drawing State
    @ViewChild('imageContainer') imageContainer!: ElementRef<HTMLDivElement>;
    isDrawing = signal(false);
    startPoint = { x: 0, y: 0 };
    drawBox = signal<{ x: number; y: number; w: number; h: number } | null>(null);
  
    // Communication Templates Signals
    commTemplates = this.dataService.communicationTemplates;
    currentCommTemplate = signal<CommunicationTemplate | null>(null);
    isEditingCommTemplate = signal(false);
  
    // Data Management Signals
    isRestoring = signal(false);
    isSyncing = signal(false);
  
    // Snapshot State
    localSnapshots = signal<BackupSnapshot[]>([]);
    isCreatingSnapshot = signal(false);
  
    // NEW: Firebase Config Input
    firebaseConfigInput = signal('');
  
    // Schema Management State
    showHistoryModal = signal(false);
    isRestoringSchema = signal(false);
  
    // Template History State (NEW)
    showTemplateHistoryModal = signal(false);
    isRestoringTemplates = signal(false);
  
    // AI Cost Logic
    aiUsageLogs = this.dataService.aiUsageLogs;
    aiPricing = computed(() => this.dataService.systemSettings().aiPricing ?? { inputRate: 0.075, outputRate: 0.30 });
  
    // AI Cost Computed
    aiCostStats = computed(() => {
      const logs = this.aiUsageLogs();
      const pricing = this.aiPricing();
  
      const now = new Date();
      const currentMonthPrefix = `${now.getFullYear()}-${(now.getMonth() + 1).toString().padStart(2, '0')}`;
  
      const monthlyLogs = logs.filter(l => l.timestamp.startsWith(currentMonthPrefix));
  
      let totalInput = 0;
      let totalOutput = 0;
  
      monthlyLogs.forEach(l => {
        totalInput += l.inputTokens;
        totalOutput += l.outputTokens;
      });
  
      const inputCost = (totalInput / 1000000) * pricing.inputRate;
      const outputCost = (totalOutput / 1000000) * pricing.outputRate;
      const totalCost = inputCost + outputCost;
  
      // Group by context
      const contextStats: Record<string, { count: number; cost: number }> = {};
      monthlyLogs.forEach(l => {
        if (!contextStats[l.context]) contextStats[l.context] = { count: 0, cost: 0 };
        const iCost = (l.inputTokens / 1000000) * pricing.inputRate;
        const oCost = (l.outputTokens / 1000000) * pricing.outputRate;
        contextStats[l.context].count++;
        contextStats[l.context].cost += (iCost + oCost);
      });
  
      return {
        totalInput,
        totalOutput,
        totalCostUSD: totalCost,
        totalCostTWD: totalCost * 32,
        contextStats
      };
    });
  
    public ds = this.dataService;
  
    readonly TEMPLATE_VARIABLES = {
      purchase: [
        { key: 'purchaseId', label: '採購單號' },
        { key: 'purchaseDate', label: '採購日期' },
        { key: 'supplierName', label: '供應商' },
        { key: 'items', label: '品項明細' },
        { key: 'deliveryDate', label: '交貨日期' },
        { key: 'purchaser', label: '採購人員' },
        { key: 'companyName', label: '公司名稱' },
        { key: 'note', label: '備註' }
      ],
      order: [
        { key: 'orderId', label: '訂單編號' },
        { key: 'customerName', label: '客戶名稱' },
        { key: 'items', label: '品項明細' },
        { key: 'totalAmount', label: '總金額' },
        { key: 'codAmount', label: '貨到付款' },
        { key: 'receiverName', label: '收件人' },
        { key: 'receiverPhone', label: '聯絡電話' },
        { key: 'receiverAddress', label: '收件地址' },
        { key: 'logistics', label: '物流商' },
        { key: 'trackingId', label: '追蹤碼' },
        { key: 'trackingUrl', label: '追蹤連結' },
        { key: 'shippingDate', label: '出貨日期（出貨日）' },
        { key: 'companyName', label: '公司名稱' },
        { key: 'outstandingQuantity', label: '未出數量' },
        { key: 'outstandingItems', label: '未出品項(明細)' }
      ]
    };
  
    readonly logisticsOptions = ['黑貓', '大榮'];
  
    // Using schemas from DataService instead of hardcoded array
    schemas = computed(() => {
      return this.dataService.systemSchemas().sort((a, b) => a.chineseName.localeCompare(b.chineseName));
    });
  
    activeSchema = computed(() => {
      const name = this.activeSchemaName();
      return this.schemas().find(s => s.name === name);
    });
  
    filteredSchemaFields = computed(() => {
      const schema = this.activeSchema();
      if (!schema) return [];
  
      const term = this.schemaSearchTerm().toLowerCase().trim();
      if (!term) return schema.fields;
  
      return schema.fields.filter(f =>
        f.name.toLowerCase().includes(term) ||
        f.chineseName.toLowerCase().includes(term) ||
        f.description.toLowerCase().includes(term) ||
        f.type.toLowerCase().includes(term)
      );
    });
  
    constructor() {
      // Load saved config to input if exists
      const saved = localStorage.getItem('erp_custom_firebase_config');
      if (saved) {
        this.firebaseConfigInput.set(JSON.stringify(JSON.parse(saved), null, 2));
      }
  
      // Load Snapshots
      this.refreshSnapshots();
  
      // Load Manual API Key
      this.manualApiKey.set(this.aiService.getStoredKey());
      this.isKeySaved.set(!this.aiService.getStoredKey());
    }
  
    refreshSnapshots() {
      this.localSnapshots.set(this.dataService.listLocalSnapshots());
    }
  
    setTheme(theme: 'light' | 'medium' | 'dark') {
      this.dataService.updateSettings({ theme });
    }
  
    setFontSize(level: number) {
      this.dataService.updateSettings({ fontSizeLevel: level as any });
    }
  
    setActiveTab(tab: SystemTab) {
      this.activeTab.set(tab);
      if (tab === 'data-management') {
        this.refreshSnapshots();
      }
    }
  
    goToSettings() {
      this.setActiveTab('settings');
      const main = document.querySelector('main');
      if (main) main.scrollTop = 0;
    }
  
    selectSchema(name: string) {
      this.activeSchemaName.set(name);
      this.schemaSearchTerm.set('');
    }
  
    onSchemaSearchTermChange(event: Event) {
      this.schemaSearchTerm.set((event.target as HTMLInputElement).value);
    }
  
    updateDescription(schemaName: string, fieldName: string, event: Event) {
      // In a real app, this would dispatch an update to DataService
      console.log(`Updated ${schemaName}.${fieldName} description to: ${(event.target as HTMLInputElement).value}`);
    }
  
    getTypeClass(type: string): string {
      switch (type) {
        case 'string': return 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300';
        case 'number': return 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300';
        case 'boolean': return 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-300';
        default: return 'bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-300';
      }
    }
  
    // --- Schema History Logic ---
    openHistoryModal() {
      this.showHistoryModal.set(true);
    }
  
    closeHistoryModal() {
      this.showHistoryModal.set(false);
    }
  
    restoreVersion(versionId: string) {
      if (!confirm('還原後將覆蓋目前資料，確定要還原嗎？')) return;
  
      this.isRestoringSchema.set(true);
  
      // Simulate restore process
      setTimeout(() => {
        if (versionId === 'v_3days' || versionId === 'v_init') {
          // Restore to Default (Factory Reset logic)
          this.dataService.resetSchemasToDefault();
          alert('還原後將重新載入頁面');
        } else {
          alert(`已還原至版本 (${versionId})，還原後將重新載入頁面`);
        }
        this.isRestoringSchema.set(false);
        this.closeHistoryModal();
      }, 1000);
    }
  
    // --- Template History Logic (NEW) ---
    openTemplateHistoryModal() {
      this.showTemplateHistoryModal.set(true);
    }
  
    closeTemplateHistoryModal() {
      this.showTemplateHistoryModal.set(false);
    }
  
    restoreTemplateVersion(versionId: string) {
      if (!confirm('還原後將覆蓋目前資料，確定繼續嗎？')) return;
  
      this.isRestoringTemplates.set(true);
  
      setTimeout(() => {
        if (versionId === 't_3days') {
          this.dataService.loadMockData(); // Re-seeds mock data which acts as a restore
          alert('已還原至 3 天前備份，還原後將重新載入頁面');
        } else if (versionId === 't_default') {
          // Clear templates and reload defaults
          this.dataService.loadMockData();
          alert('出廠設定已還原，還原後將重新載入頁面');
        } else {
          alert(`已還原至版本 (${versionId})，還原後將重新載入頁面`);
        }
        this.isRestoringTemplates.set(false);
        this.closeTemplateHistoryModal();
      }, 1500);
    }
  
    // --- Other Settings Logic ---
  
    updateAiPricing(key: 'inputRate' | 'outputRate', event: Event) {
      const val = parseFloat((event.target as HTMLInputElement).value);
      if (isNaN(val)) return;
  
      const current = this.aiPricing();
      this.dataService.updateSettings({
        aiPricing: {
          ...current,
          [key]: val
        }
      });
    }
  
    updateAiQuota(event: Event) {
      const val = parseInt((event.target as HTMLInputElement).value, 10);
      if (isNaN(val)) return;
      this.dataService.updateSettings({ aiMonthlyQuota: val });
    }
  
    clearAiLogs() {
      if (confirm('確定要清除 AI 使用紀錄？')) {
        this.dataService.clearAiUsageLogs();
        alert('已清除');
      }
    }
  
    // --- Snapshot Management ---
    createSnapshot() {
      this.isCreatingSnapshot.set(true);
      // Small delay for UI
      setTimeout(() => {
        const success = this.dataService.createLocalSnapshot('manual');
        this.isCreatingSnapshot.set(false);
        if (success) {
          this.refreshSnapshots();
          alert('快照建立成功');
        }
      }, 500);
    }
  
    restoreSnapshot(snap: BackupSnapshot) {
      if (confirm(`確定要還原至「${snap.dateStr}」的快照？\n還原後將覆蓋目前本機資料。`)) {
        const success = this.dataService.restoreLocalSnapshot(snap.key);
        if (success) {
          alert('還原後請重新整理頁面');
          window.location.reload();
        } else {
          alert('還原失敗');
        }
      }
    }
  
    deleteSnapshot(snap: BackupSnapshot) {
      if (confirm('確定要刪除此快照？')) {
        this.dataService.deleteLocalSnapshot(snap.key);
        this.refreshSnapshots();
        alert('已刪除');
      }
    }
  
    toggleAutoBackup(event: Event) {
      const checked = (event.target as HTMLInputElement).checked;
      this.dataService.updateSettings({ autoBackup: checked });
      // Trigger side effect manually or rely on service interval reset
      this.dataService.initAutoBackup();
    }
  
    updateBackupInterval(event: Event) {
      const val = parseInt((event.target as HTMLInputElement).value, 10);
      if (!isNaN(val) && val > 0) {
        this.dataService.updateSettings({ autoBackupInterval: val });
        this.dataService.initAutoBackup();
      }
    }
  
    // --- OCR Template Logic ...
    createNewTemplate() {
      const newTpl: ShippingTemplate = {
        id: `OCR-${Date.now()}`,
        name: '出貨單範本',
        logistics: '黑貓',
        imageUrl: '',
        roi: { x: 10, y: 10, width: 30, height: 10 },
        lastUpdated: new Date().toISOString(),
        trackingUrlPattern: ''
      };
      this.currentTemplate.set(newTpl);
      this.isEditingTemplate.set(true);
      this.trainingResult.set(null);
    }
  
    editTemplate(tpl: ShippingTemplate) {
      this.currentTemplate.set(JSON.parse(JSON.stringify(tpl)));
      this.isEditingTemplate.set(true);
      this.trainingResult.set(null);
    }
  
    cancelEditTemplate() {
      this.isEditingTemplate.set(false);
      this.currentTemplate.set(null);
    }
  
    saveTemplate() {
      const tpl = this.currentTemplate();
      if (tpl) {
        const exists = this.shippingTemplates().some(t => t.id === tpl.id);
        if (exists) {
          this.dataService.updateShippingTemplate(tpl);
        } else {
          this.dataService.addShippingTemplate(tpl);
        }
        this.isEditingTemplate.set(false);
      }
    }
  
    deleteTemplate(id: string) {
      if (confirm('確定要刪除此範本？')) {
        this.dataService.deleteShippingTemplate(id);
      }
    }
  
    async onOcrImageUpload(event: Event) {
      const input = event.target as HTMLInputElement;
      if (input.files && input.files[0]) {
        const file = input.files[0];
        try {
          const base64 = await this.imageService.compressImage(file);
          this.currentTemplate.update(t => t ? { ...t, imageUrl: base64 } : null);
        } catch(e) { console.error(e); }
      }
    }
  
    // ROI Drawing...
    startDrawing(event: MouseEvent) {
      if (!this.imageContainer) return;
      const rect = this.imageContainer.nativeElement.getBoundingClientRect();
      const x = event.clientX - rect.left;
      const y = event.clientY - rect.top;
      const xPct = (x / rect.width) * 100;
      const yPct = (y / rect.height) * 100;
      this.isDrawing.set(true);
      this.startPoint = { x: xPct, y: yPct };
      this.drawBox.set({ x: xPct, y: yPct, w: 0, h: 0 });
    }
  
    drawing(event: MouseEvent) {
      if (!this.isDrawing() || !this.imageContainer) return;
      const rect = this.imageContainer.nativeElement.getBoundingClientRect();
      const x = event.clientX - rect.left;
      const y = event.clientY - rect.top;
      const xPct = (x / rect.width) * 100;
      const yPct = (y / rect.height) * 100;
      const w = Math.abs(xPct - this.startPoint.x);
      const h = Math.abs(yPct - this.startPoint.y);
      const left = Math.min(xPct, this.startPoint.x);
      const top = Math.min(yPct, this.startPoint.y);
      this.drawBox.set({ x: left, y: top, w, h });
    }
  
    stopDrawing() {
      if (this.isDrawing()) {
        this.isDrawing.set(false);
        const box = this.drawBox();
        if (box && box.w > 1 && box.h > 1) {
          this.currentTemplate.update(t => t ? {
            ...t,
            roi: { x: box.x, y: box.y, width: box.w, height: box.h }
          } : null);
        }
        this.drawBox.set(null);
      }
    }
  
    async trainAiRecognition() {
      const tpl = this.currentTemplate();
      if (!tpl || !tpl.imageUrl) return;
  
      // Check for API Key first
      const hasKey = await this.aiService.ensureApiKey();
      if (!hasKey) {
        if (!window.aistudio) {
          alert('Gemini API 金鑰未設定，請先設定 API 金鑰，或使用 AI Studio');
        }
        return;
      }
  
      this.isTraining.set(true);
      try {
        const result = await this.aiService.parseLogisticsImage(tpl.imageUrl, [tpl.logistics]);
  
        // --- NEW: Integration Demo ---
        console.log('[AI ERP PIXEL] 辨識完成 OrderService...', result);
  
        // --- NEW: Integration Demo ---
        this.trainingResult.set(result);
  
        alert(`辨識成功\n辨識結果\n追蹤碼: ${result.trackingId}\n提供者: ${result.provider}`);
      } catch (error: any) {
        // If the error is about API key, prompt user to select one
        if (error.message && error.message.includes('API key must be set')) {
          if (window.aistudio) {
            if (confirm('Gemini API 金鑰未設定，是否開啟 AI Studio 選擇金鑰？')) {
              await window.aistudio.openSelectKey();
            }
          } else {
            alert('Gemini API 金鑰未設定/錯誤，AI Studio，請先設定 API 金鑰');
          }
        } else {
          alert('錯誤：' + error.message);
        }
      } finally {
        this.isTraining.set(false);
      }
    }
  
    // --- Comm Templates Logic ...
    createNewCommTemplate() {
      const newTpl: CommunicationTemplate = {
        id: `COMM-${Date.now()}`,
        name: '通訊範本',
        type: 'order',
        logistics: '',
        content: '親愛的 {{customerName}}，您的訂單 {{orderId}} 已出貨。',
        isSystemDefault: false
      };
      this.currentCommTemplate.set(newTpl);
      this.isEditingCommTemplate.set(true);
    }
  
    editCommTemplate(tpl: CommunicationTemplate) {
      this.currentCommTemplate.set(JSON.parse(JSON.stringify(tpl)));
      this.isEditingCommTemplate.set(true);
    }
  
    cancelEditCommTemplate() {
      this.isEditingCommTemplate.set(false);
      this.currentCommTemplate.set(null);
    }
  
    saveCommTemplate() {
      const tpl = this.currentCommTemplate();
      if (tpl) {
        const exists = this.commTemplates().some(t => t.id === tpl.id);
        if (exists) {
          this.dataService.updateCommunicationTemplate(tpl);
        } else {
          this.dataService.addCommunicationTemplate(tpl);
        }
        this.isEditingCommTemplate.set(false);
      }
    }
  
    deleteCommTemplate(id: string) {
      if (confirm('確定要刪除此範本？')) {
        this.dataService.deleteCommunicationTemplate(id);
      }
    }
  
    insertVariable(key: string) {
      const field = document.getElementById('commContent') as HTMLTextAreaElement;
      if (field && this.currentCommTemplate()) {
        const start = field.selectionStart;
        const end = field.selectionEnd;
        const text = this.currentCommTemplate()!.content;
        const insert = `{{${key}}}`;
        const newText = text.substring(0, start) + insert + text.substring(end);
        this.currentCommTemplate.update(t => t ? { ...t, content: newText } : null);
        setTimeout(() => {
          field.focus();
          field.setSelectionRange(start + insert.length, start + insert.length);
        });
      }
    }
  
    // --- Data Management ...
    downloadBackup() {
      const json = this.dataService.getAllDataAsJson();
      const blob = new Blob([json], { type: 'application/json' });
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `erp_backup_${new Date().toISOString().split('T')[0]}.json`;
      a.click();
      window.URL.revokeObjectURL(url);
    }
  
    async uploadBackup(event: Event) {
      const input = event.target as HTMLInputElement;
      if (!input.files || input.files.length === 0) return;
      if (!confirm('匯入將覆蓋目前本機資料，確定繼續？')) {
        input.value = '';
        return;
      }
      this.isRestoring.set(true);
      const file = input.files[0];
      const reader = new FileReader();
      reader.onload = async (e) => {
        try {
          const json = e.target?.result as string;
          const data = JSON.parse(json);
          await this.dataService.restoreFullBackup(data);
          alert('匯入成功，還原後請重新整理頁面');
          window.location.reload();
        } catch (err) {
          console.error(err);
          alert('匯入失敗：檔案格式不正確');
        } finally {
          this.isRestoring.set(false);
          input.value = '';
        }
      };
      reader.readAsText(file);
    }
  
    async triggerCloudSync() {
      if (!confirm('確定要強制同步至雲端嗎？\n(Firebase 需已連線)')) return;
      this.isSyncing.set(true);
      try {
        await this.dataService.syncLocalToCloud();
        alert('同步成功');
        this.refreshSnapshots();
      } catch (err: any) {
        console.error(err);
        alert('上傳失敗：' + (err.message ?? '未知錯誤'));
      } finally {
        this.isSyncing.set(false);
      }
    }
  
    async triggerCloudPull() {
      if (!confirm('確定要從雲端下載資料嗎？\n(Firebase 需已連線，會覆蓋本機資料)')) return;
      this.isSyncing.set(true);
      try {
        await this.dataService.syncCloudToLocal();
        alert('同步成功，還原後請重新整理頁面');
        this.refreshSnapshots();
      } catch (err: any) {
        console.error(err);
        alert('上傳失敗：' + (err.message ?? '未知錯誤'));
      } finally {
        this.isSyncing.set(false);
      }
    }
  
    manualApiKey = signal('');
    isKeySaved = signal(false);
  
    saveManualKey() {
      const key = this.manualApiKey();
      if (!key.trim()) {
        alert('請輸入 API 金鑰');
        return;
      }
      const success = this.aiService.saveKeyToStorage(key);
      if (success) {
        this.isKeySaved.set(true);
        alert('金鑰已儲存，AI 功能已就緒，AI 費用');
      } else {
        alert('儲存失敗');
      }
    }
  
    clearManualKey() {
      this.aiService.clearStoredKey();
      this.manualApiKey.set('');
      this.isKeySaved.set(false);
      alert('金鑰已清除');
    }
  
    async openApiKeyDialog() {
      if (window.aistudio) {
        await window.aistudio.openSelectKey();
      } else {
        alert('請使用手動輸入 API 金鑰，AI Studio 需要 Chrome 擴充功能，前往 AI Studio 取得 API 金鑰\n金鑰僅存於本機，不會上傳');
      }
    }
  
    saveFirebaseConfig() {
      try {
        this.dataService.saveFirebaseConfig(this.firebaseConfigInput());
      } catch (e: any) {
        alert(e.message);
      }
    }
  
    // Mock Schema History (readonly)
    readonly schemaHistory = [
      { id: 'v_current', label: '目前版本 (Current)', date: 'Now', description: '目前使用中', isDefault: false },
      { id: 'v_auto_1', label: '自動儲存 (Auto-Save)', date: '2024-05-23 10:00', description: '昨日備份', isDefault: false },
      { id: 'v_3days', label: '3 天前 (3 Days Ago)', date: '2024-05-20 09:15', description: '穩定快照/備份', isDefault: true },
      { id: 'v_init', label: '出廠預設 (Factory Default)', date: 'Initial Setup', description: '出廠設定', isDefault: true }
    ];
  
    // Mock Template History (readonly) (NEW)
    readonly templateHistory = [
      { id: 't_current', label: '目前版本 (Current)', date: 'Now', description: '目前使用中', isDefault: false },
      { id: 't_backup_1', label: '昨日備份', date: 'Yesterday 18:00', description: '自動備份 #1024', isDefault: false },
      { id: 't_3days', label: '3 天前 (3 Days Ago)', date: '2024-05-20 09:00', description: '備份 #1024', isDefault: true },
      { id: 't_default', label: '出廠設定 (Factory)', date: 'Factory', description: '出廠預設', isDefault: true }
    ];
  }
