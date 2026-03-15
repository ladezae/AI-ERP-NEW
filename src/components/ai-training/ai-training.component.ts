
import { ChangeDetectionStrategy, Component, inject, signal, effect } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { AiService } from '../../services/ai.service';

@Component({
  selector: 'app-ai-training',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CommonModule, FormsModule],
  templateUrl: './ai-training.component.html'
})
export class AiTrainingComponent {
  private aiService = inject(AiService);

  // State
  systemInstruction = signal<string>('');
  knowledgeDocs = signal<{id: string, content: string, name: string}[]>([]);
  
  // Executive Mode State
  executiveDirective = signal('');
  isConvertingDirective = signal(false);
  
  // UI State
  activeTab = signal<'persona' | 'knowledge'>('persona');
  newDocContent = signal('');
  newDocName = signal('');
  isSaved = signal(false);
  isSaving = signal(false); // Added loading state for saving

  // Test Chat
  testMessage = signal('');
  testResponse = signal('');
  isTesting = signal(false);

  constructor() {
    // Watch for changes in service state (e.g., when DB data loads)
    effect(() => {
        this.systemInstruction.set(this.aiService.currentSystemInstruction());
        this.parseKnowledgeBase(this.aiService.knowledgeBase());
    });
  }

  private parseKnowledgeBase(kb: string[]) {
    const docs = kb.map((fullContent, index) => {
        let name = `知識文件 ${index + 1}`;
        let content = fullContent;

        // Try to extract name from format: "[文件: DOC_NAME]\nREAL_CONTENT"
        const match = fullContent.match(/^\[文件: (.*?)\]\n([\s\S]*)$/);
        if (match) {
            name = match[1];
            content = match[2];
        }

        return {
            id: `doc-${index}-${Date.now()}`, // Unique ID
            name: name,
            content: content
        };
    });
    this.knowledgeDocs.set(docs);
  }

  setActiveTab(tab: 'persona' | 'knowledge') {
    this.activeTab.set(tab);
  }

  // --- Executive Directive Logic ---
  async convertDirective() {
      if (!this.executiveDirective().trim()) return;
      
      this.isConvertingDirective.set(true);
      try {
          const structuredPrompt = await this.aiService.generateSystemInstruction(this.executiveDirective());
          // Replace current instruction
          this.systemInstruction.set(structuredPrompt);
          this.executiveDirective.set(''); // Clear input
      } catch (e) {
          alert('轉換指令失敗，請稍後再試。');
      } finally {
          this.isConvertingDirective.set(false);
      }
  }

  // --- Knowledge Base Logic ---

  loadStandardTemplate() {
    this.newDocName.set('標準業務邏輯與術語定義');
    this.newDocContent.set(`### [企業核心業務規則]
1. **價格政策**：
   - 所有報價均為「未稅」價格，除非特別註明「含稅」。
   - VIP 客戶享有定價 95 折優惠 (需在訂單備註註記)。
   - 訂單金額未滿 $3,000 需加收運費 $150 (黑貓)。

2. **庫存與出貨**：
   - 若庫存低於「安全庫存」，請在回答時主動提示「庫存緊張」。
   - 每日下午 3 點前確認的訂單，原則上當日出貨。
   - 代工單 (Manufacturing) 標準交期為 14 個工作天。

### [專有名詞對照表] (Terminology Mapping)
| 內部術語 | 正式名稱 | 備註 |
| :--- | :--- | :--- |
| A貨 | 一級品 | 品質最優，無瑕疵 |
| B貨 | 二級福利品 | 外觀微損，功能正常 |
| 統倉 | 桃園總物流中心 | 主要發貨地 |
| 轉單 | 直送訂單 | 供應商直接發貨給客戶 |

### [標準回應範例 (Few-Shot Examples)]
**User**: "幫我查一下愛文芒果乾還有沒有貨？"
**AI**: "好的！經查詢「愛文芒果乾 (P-001)」目前庫存充足，還有 500 包。另外提醒您，這款商品近期銷量較大，建議可以多備一些安全庫存喔！"

**User**: "客戶想殺價，能不能算便宜一點？"
**AI**: "關於議價部分：我們的標準毛利底線是 15%。如果是 VIP 客戶，您可以直接給予 95 折優惠；如果是一般客戶且量大，請引導其填寫「專案申請單」由主管審核。"`);
  }

  addKnowledgeDoc() {
    if (!this.newDocContent().trim()) return;

    const name = this.newDocName().trim() || `知識文件 ${this.knowledgeDocs().length + 1}`;
    const newDoc = {
        id: `doc-${Date.now()}`,
        name: name,
        content: this.newDocContent()
    };

    this.knowledgeDocs.update(docs => [...docs, newDoc]);
    
    // Reset inputs
    this.newDocContent.set('');
    this.newDocName.set('');
    this.isSaved.set(false);
  }

  removeDoc(id: string) {
    this.knowledgeDocs.update(docs => docs.filter(d => d.id !== id));
    this.isSaved.set(false);
  }

  onFileUpload(event: Event) {
    const input = event.target as HTMLInputElement;
    if (input.files && input.files[0]) {
        const file = input.files[0];
        const reader = new FileReader();
        reader.onload = (e) => {
            const content = e.target?.result as string;
            this.newDocName.set(file.name);
            this.newDocContent.set(content);
        };
        reader.readAsText(file);
        input.value = ''; // reset
    }
  }

  // --- Save & Apply ---

  async saveConfiguration() {
      this.isSaving.set(true);
      // Format content to include the name so we can restore it later
      const kbStrings = this.knowledgeDocs().map(d => `[文件: ${d.name}]\n${d.content}`);
      
      try {
          await this.aiService.updateConfiguration(this.systemInstruction(), kbStrings);
          this.isSaved.set(true);
          
          // Auto hide success message
          setTimeout(() => this.isSaved.set(false), 3000);
      } catch(e) {
          alert('儲存失敗，請檢查網路連線。');
      } finally {
          this.isSaving.set(false);
      }
  }

  // --- Test Playground ---

  async runTest() {
      if (!this.testMessage().trim()) return;
      
      this.isTesting.set(true);
      this.testResponse.set('');
      
      // Force save locally/remote before testing so user sees what they configured
      await this.saveConfiguration();

      try {
          const response = await this.aiService.sendMessage(this.testMessage());
          this.testResponse.set(response);
      } catch (e) {
          this.testResponse.set("測試失敗，請檢查設定。");
      } finally {
          this.isTesting.set(false);
      }
  }
}
