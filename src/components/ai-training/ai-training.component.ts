/**
 * AI 訓練中心元件（重構版）
 *
 * 功能：
 * 1. 角色設定（Persona）— 主管指令 → AI 自動生成 System Instruction
 * 2. 知識庫管理 — 文件支援【僅限內部】標記，外部客服自動過濾
 * 3. 預建範本 — 依主題分類的一吉水果乾專用知識庫範本
 * 4. 測試場 — 可切換內部/外部角色測試 AI 回應
 */
import {
  ChangeDetectionStrategy, Component, inject, signal, effect
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { AiService } from '../../services/ai.service';
import { AiTrainingService, AiRole, KnowledgeDoc } from '../../services/ai-training.service';

/** 預建範本定義 */
interface KnowledgeTemplate {
  id: string;
  name: string;
  description: string;
  isInternal: boolean;
  content: string;
}

@Component({
  selector: 'app-ai-training',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CommonModule, FormsModule],
  templateUrl: './ai-training.component.html'
})
export class AiTrainingComponent {
  private aiService = inject(AiService);
  private trainingService = inject(AiTrainingService);

  // === 訓練資料 ===
  systemInstruction = signal<string>('');
  knowledgeDocs = signal<KnowledgeDoc[]>([]);

  // === 主管指令模式 ===
  executiveDirective = signal('');
  isConvertingDirective = signal(false);

  // === UI 狀態 ===
  activeTab = signal<'persona' | 'knowledge'>('persona');
  newDocContent = signal('');
  newDocName = signal('');
  newDocIsInternal = signal(false);
  isSaved = signal(false);
  isSaving = signal(false);
  showTemplateMenu = signal(false);

  // === 測試場 ===
  testMessage = signal('');
  testResponse = signal('');
  isTesting = signal(false);
  testRole = signal<AiRole>('internal');

  // === 預建範本（一吉水果乾專用） ===
  templates: KnowledgeTemplate[] = [
    {
      id: 'pricing',
      name: '價格與訂單規則',
      description: '報價、運費、折扣、付款條件',
      isInternal: false,
      content: `### 價格與訂單規則

1. **報價規則**
   - 所有報價均為「未稅」價格，除非特別註明「含稅」
   - 含稅價 = 未稅價 × 1.05（營業稅 5%）
   - 客戶詢問價格時，預設回覆含稅價

2. **運費規則**
   - 訂單金額未滿 $3,000 → 加收運費 $150（黑貓宅急便）
   - 訂單金額 $3,000 以上 → 免運費
   - 外島地區一律加收 $100 運費

3. **付款方式**
   - 現金 / 銀行轉帳 / 貨到付款（+$30 手續費）

4. **最低訂購量**
   - 零售：無最低限制
   - 批發：單品 10 包起`
    },
    {
      id: 'pricing-internal',
      name: '成本與毛利規則',
      description: '【僅限內部】成本結構、毛利底線、議價空間',
      isInternal: true,
      content: `### 【僅限內部】成本與毛利規則

1. **毛利底線**
   - 一般商品：最低毛利 15%
   - 促銷商品：最低毛利 8%（需主管審核）
   - 計算公式：毛利率 = (售價 - 成本) / 售價 × 100%

2. **議價空間**
   - VIP 客戶：可直接給予定價 95 折
   - 一般客戶量大（>100包）：可下調 5%，需主管核准
   - 一般客戶量特大（>500包）：可申請專案價，填寫「專案申請單」

3. **成本注意事項**
   - 代工費用依配方複雜度不同，通常佔售價 25-40%
   - 原料成本波動時需即時更新系統定價
   - 絕對不可向客戶透露成本與毛利數字`
    },
    {
      id: 'products',
      name: '商品知識與術語',
      description: '品項分類、品質等級、專有名詞',
      isInternal: false,
      content: `### 商品知識與術語對照

**品質等級**
| 內部術語 | 正式名稱 | 說明 |
|---------|---------|------|
| A 貨 | 一級品 | 品質最優，外觀完整無瑕疵 |
| B 貨 | 二級福利品 | 外觀微損（碎裂、色差），口味正常 |

**主要品項分類**
- 芒果乾系列：愛文芒果乾、金煌芒果乾（有糖/無糖）
- 鳳梨乾系列：金鑽鳳梨乾、土鳳梨乾
- 綜合系列：綜合水果乾禮盒、堅果水果乾混合包
- 其他：芭樂乾、蓮霧乾、番茄乾等季節限定

**保存方式**
- 常溫保存：未開封 12 個月
- 開封後建議冷藏，14 天內食用完畢
- 避免陽光直射與潮濕環境`
    },
    {
      id: 'logistics',
      name: '出貨與物流規則',
      description: '出貨時程、物流商、配送範圍',
      isInternal: false,
      content: `### 出貨與物流規則

1. **出貨時程**
   - 每日下午 3 點前確認的訂單 → 原則上當日出貨
   - 下午 3 點後的訂單 → 隔日出貨
   - 週末/國定假日不出貨，順延至下個工作日

2. **物流商**
   - 黑貓宅急便：一般常溫配送（1-2 天到貨）
   - 大榮貨運：大量批發貨物
   - 追蹤方式：出貨後系統自動提供追蹤碼

3. **配送範圍**
   - 本島全區配送
   - 外島配送需加收運費，時程約 3-5 天

4. **退換貨**
   - 商品瑕疵（發霉、異味）→ 免費換貨 + 補償
   - 收貨後 7 天內可申請退換
   - 買家個人因素退貨 → 運費自付`
    },
    {
      id: 'supplier-internal',
      name: '供應商與代工資訊',
      description: '【僅限內部】供應商清單、代工流程、交期',
      isInternal: true,
      content: `### 【僅限內部】供應商與代工資訊

1. **代工流程**
   - 下單 → 確認配方 → 排產 → 生產 → 品檢 → 入庫
   - 標準交期：14 個工作天
   - 急單交期：7 個工作天（需加收 15% 急件費）

2. **庫存管理**
   - 安全庫存低於設定值 → 系統自動提醒
   - 暢銷品建議維持 2 週安全庫存量
   - 季節限定品項提前 1 個月備料

3. **品質控管**
   - 每批代工品需過磅抽樣、口味測試
   - 不合格批次整批退回，不計入庫存`
    },
    {
      id: 'faq',
      name: '客服常見問答',
      description: '客戶常問的問題與標準回覆',
      isInternal: false,
      content: `### 客服常見問答（FAQ）

**Q: 你們的水果乾有加防腐劑嗎？**
A: 我們的水果乾採用低溫烘乾技術，不添加防腐劑、人工色素或香料。保存期限為未開封 12 個月。

**Q: 可以開發票嗎？**
A: 可以！請在下單時提供統一編號和抬頭，我們會隨貨附上電子發票。

**Q: 有提供試吃嗎？**
A: 批發客戶首次訂購可申請免費試吃包（限 2 品項），請聯繫業務專員。

**Q: 可以客製化包裝嗎？**
A: 可以！批量 500 包以上可客製外包裝（Logo、文案），設計稿確認後約 3 週出貨。

**Q: 你們在哪裡？可以自取嗎？**
A: 我們的倉庫在桃園（統倉），歡迎自取，請提前一天預約。

**Q: 運送過程會壞掉嗎？**
A: 我們使用防壓包裝 + 黑貓常溫配送，品質有保障。如收到有損壞請拍照聯繫我們，免費補寄。`
    },
    {
      id: 'prohibited',
      name: '禁止事項與合規',
      description: '客服與 AI 不可做的事',
      isInternal: false,
      content: `### AI 行為準則與禁止事項

**禁止事項**
- ❌ 不可承諾超出公司政策的折扣或贈品
- ❌ 不可透露成本、毛利、供應商資訊給外部人員
- ❌ 不可替客戶做退款決定（需轉交主管處理）
- ❌ 不可提供競爭對手的負面評論
- ❌ 不可保證特定到貨日期（只能說「預計」）

**應對原則**
- 遇到無法回答的問題 → 「這個部分我需要確認一下，稍後回覆您」
- 客戶情緒激動 → 先同理、再解決：「非常抱歉造成您的不便，讓我來幫您處理」
- 涉及法律問題 → 「建議您參考消費者保護法相關規定，或聯繫我們的客服主管」
- 客戶殺價超出底線 → 「目前這已經是我們能提供的最優惠價格了，如果量大的話我可以幫您申請專案價」`
    }
  ];

  constructor() {
    // 從 Service 同步資料（Firestore 即時更新）
    effect(() => {
      this.systemInstruction.set(this.trainingService.systemInstruction());
      this.parseKnowledgeBase(this.trainingService.knowledgeBase());
    });
  }

  // --- 【知識庫解析】 ---

  /**
   * 將 Firestore 字串陣列解析為結構化知識文件
   * 格式：[文件: NAME]\nCONTENT 或 [文件: NAME][內部]\nCONTENT
   */
  private parseKnowledgeBase(kb: string[]) {
    const docs: KnowledgeDoc[] = kb.map((fullContent, index) => {
      let name = `知識文件 ${index + 1}`;
      let content = fullContent;
      let isInternal = false;

      // 解析含內部標記的格式：[文件: NAME][內部]\nCONTENT
      const matchInternal = fullContent.match(/^\[文件: (.*?)\]\[內部\]\n([\s\S]*)$/);
      if (matchInternal) {
        name = matchInternal[1];
        content = matchInternal[2];
        isInternal = true;
      } else {
        // 一般格式：[文件: NAME]\nCONTENT
        const match = fullContent.match(/^\[文件: (.*?)\]\n([\s\S]*)$/);
        if (match) {
          name = match[1];
          content = match[2];
        }
        // 檢查內容是否包含【僅限內部】標記
        if (content.includes('【僅限內部】')) {
          isInternal = true;
        }
      }

      return { id: `doc-${index}-${Date.now()}`, name, content, isInternal };
    });
    this.knowledgeDocs.set(docs);
  }

  // --- 【Tab 切換】 ---

  setActiveTab(tab: 'persona' | 'knowledge') {
    this.activeTab.set(tab);
  }

  // --- 【主管指令轉換】 ---

  async convertDirective() {
    if (!this.executiveDirective().trim()) return;

    this.isConvertingDirective.set(true);
    try {
      const structuredPrompt = await this.aiService.generateSystemInstruction(
        this.executiveDirective()
      );
      this.systemInstruction.set(structuredPrompt);
      this.executiveDirective.set('');
    } catch (e) {
      alert('轉換指令失敗，請稍後再試。');
    } finally {
      this.isConvertingDirective.set(false);
    }
  }

  // --- 【知識庫管理】 ---

  /** 切換範本選單 */
  toggleTemplateMenu() {
    this.showTemplateMenu.update(v => !v);
  }

  /** 載入預建範本 */
  loadTemplate(template: KnowledgeTemplate) {
    this.newDocName.set(template.name);
    this.newDocContent.set(template.content);
    this.newDocIsInternal.set(template.isInternal);
    this.showTemplateMenu.set(false);
  }

  /** 一鍵載入所有範本 */
  loadAllTemplates() {
    const existingNames = new Set(this.knowledgeDocs().map(d => d.name));
    const newDocs = this.templates
      .filter(t => !existingNames.has(t.name))
      .map(t => ({
        id: `doc-${Date.now()}-${t.id}`,
        name: t.name,
        content: t.content,
        isInternal: t.isInternal
      }));

    if (newDocs.length === 0) {
      alert('所有範本都已載入！');
      return;
    }

    this.knowledgeDocs.update(docs => [...docs, ...newDocs]);
    this.showTemplateMenu.set(false);
    this.isSaved.set(false);
  }

  /** 新增知識文件 */
  addKnowledgeDoc() {
    if (!this.newDocContent().trim()) return;

    const name = this.newDocName().trim() || `知識文件 ${this.knowledgeDocs().length + 1}`;
    const newDoc: KnowledgeDoc = {
      id: `doc-${Date.now()}`,
      name,
      content: this.newDocContent(),
      isInternal: this.newDocIsInternal()
    };

    this.knowledgeDocs.update(docs => [...docs, newDoc]);
    this.newDocContent.set('');
    this.newDocName.set('');
    this.newDocIsInternal.set(false);
    this.isSaved.set(false);
  }

  /** 刪除知識文件 */
  removeDoc(id: string) {
    this.knowledgeDocs.update(docs => docs.filter(d => d.id !== id));
    this.isSaved.set(false);
  }

  /** 切換文件的內部/外部標記 */
  toggleDocInternal(id: string) {
    this.knowledgeDocs.update(docs =>
      docs.map(d => d.id === id ? { ...d, isInternal: !d.isInternal } : d)
    );
    this.isSaved.set(false);
  }

  /** 檔案上傳 */
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
      input.value = '';
    }
  }

  // --- 【儲存】 ---

  async saveConfiguration() {
    this.isSaving.set(true);

    // 序列化：內部文件加上 [內部] 標記，讓 buildSystemPrompt 可以過濾
    const kbStrings = this.knowledgeDocs().map(d => {
      const internalTag = d.isInternal ? '[內部]' : '';
      return `[文件: ${d.name}]${internalTag}\n${d.content}`;
    });

    try {
      await this.trainingService.updateConfiguration(this.systemInstruction(), kbStrings);
      this.isSaved.set(true);
      setTimeout(() => this.isSaved.set(false), 3000);
    } catch (e) {
      alert('儲存失敗，請檢查網路連線。');
    } finally {
      this.isSaving.set(false);
    }
  }

  // --- 【測試場】 ---

  /** 切換測試角色 */
  setTestRole(role: AiRole) {
    this.testRole.set(role);
  }

  /** 執行測試 */
  async runTest() {
    if (!this.testMessage().trim()) return;

    this.isTesting.set(true);
    this.testResponse.set('');

    // 先儲存設定
    await this.saveConfiguration();

    try {
      // 根據測試角色取得對應的 system prompt
      const context = this.trainingService.buildSystemPrompt(this.testRole());
      const response = await this.aiService.sendMessage(this.testMessage(), undefined, context);
      this.testResponse.set(response);
    } catch (e) {
      this.testResponse.set('測試失敗，請檢查 API Key 設定。');
    } finally {
      this.isTesting.set(false);
    }
  }

  // --- 【統計】 ---

  get internalDocCount(): number {
    return this.knowledgeDocs().filter(d => d.isInternal).length;
  }

  get publicDocCount(): number {
    return this.knowledgeDocs().filter(d => !d.isInternal).length;
  }
}
