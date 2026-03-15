/**
 * AI 訓練與知識庫管理服務
 *
 * 負責管理 AI 的人設指令（systemInstruction）、
 * 知識庫（knowledgeBase）、角色定義（role），
 * 並提供 buildSystemPrompt() 方法，
 * 讓語音引擎和文字引擎共用同一份訓練資料。
 *
 * 資料儲存於 Firestore systemConfig/gemini 文件。
 */
import { Injectable, signal, inject, OnDestroy } from '@angular/core';
import { doc, onSnapshot, updateDoc } from 'firebase/firestore';
import { db } from '../firebase.config';
import { DataService } from './data.service';

export type AiRole = 'internal' | 'external' | 'default';

/** 知識文件結構 */
export interface KnowledgeDoc {
  id: string;
  name: string;
  content: string;
  /** 標記為僅限內部使用（外部客服不可見） */
  isInternal: boolean;
}

@Injectable({
  providedIn: 'root'
})
export class AiTrainingService implements OnDestroy {
  private firestore = db;
  private dataService = inject(DataService);
  private unsubscribe: any = null;

  /** Firestore 文件路徑（沿用現有） */
  private readonly CONFIG_PATH = 'systemConfig';
  private readonly CONFIG_DOC = 'gemini';

  // === 訓練資料 Signals ===
  systemInstruction = signal<string>('');
  knowledgeBase = signal<string[]>([]);
  currentRole = signal<AiRole>('default');

  constructor() {
    this.subscribeToTrainingData();
  }

  // --- 【角色管理】 ---

  setRole(role: AiRole): void {
    this.currentRole.set(role);
  }

  // --- 【知識庫管理】 ---

  /** 更新系統指令和知識庫到 Firestore */
  async updateConfiguration(systemInstruction: string, keywords?: string[]): Promise<void> {
    const docRef = doc(this.firestore, this.CONFIG_PATH, this.CONFIG_DOC);
    await updateDoc(docRef, {
      systemInstruction,
      keywords: keywords || []
    });
  }

  // --- 【建構 System Prompt】 ---

  /**
   * 組合三層訓練資料為完整的 System Prompt
   *
   * 第一層：固定人設（systemInstruction）
   * 第二層：知識庫（knowledgeBase）
   * 第三層：即時數據（根據角色過濾）
   *
   * @param role 角色（internal / external）
   * @returns 完整的 system prompt 字串
   */
  buildSystemPrompt(role?: AiRole): string {
    const activeRole = role || this.currentRole();
    const parts: string[] = [];

    // === 第一層：固定人設 ===
    const instruction = this.systemInstruction();
    if (instruction && instruction.trim()) {
      parts.push(`【AI 人設指令】\n${instruction}`);
    }

    // === 第二層：知識庫（根據角色過濾【僅限內部】文件） ===
    const kb = this.knowledgeBase();
    if (kb.length > 0) {
      const filteredKb = kb.filter(docStr => {
        // 外部角色不可見標記為【僅限內部】的文件
        if (activeRole === 'external') {
          return !docStr.includes('【僅限內部】');
        }
        return true;
      });

      if (filteredKb.length > 0) {
        const kbText = filteredKb.map((docStr, i) => {
          // 嘗試解析 [文件: NAME]\nCONTENT 或 [文件: NAME][內部]\nCONTENT 格式
          const match = docStr.match(/^\[文件: (.*?)\](?:\[內部\])?\n([\s\S]*)$/);
          if (match) {
            return `--- ${match[1]} ---\n${match[2]}`;
          }
          return `--- 知識文件 ${i + 1} ---\n${docStr}`;
        }).join('\n\n');

        parts.push(`【知識庫】\n${kbText}`);
      }
    }

    // === 第三層：即時數據 ===
    const contextData = this.buildContextData(activeRole);
    parts.push(contextData);

    return parts.join('\n\n');
  }

  /**
   * 建構即時數據上下文（根據角色過濾敏感資訊）
   */
  private buildContextData(role: AiRole): string {
    const products = this.dataService.products();
    const metrics = this.dataService.businessMetrics();

    // 計算指標
    const definitions = this.dataService.metricDefinitions();
    const calculatedStats = definitions.map(def => {
      const val = this.dataService.evaluateFormula(def.formula);
      return `- ${def.fieldTw} (${def.fieldEn}): ${val}`;
    }).join('\n');

    if (role === 'external') {
      // --- 外部客服視角：隱藏敏感資訊 ---
      const publicProducts = products.map(p => ({
        name: p.name,
        category: p.category,
        price: p.priceAfterTax,
        stockStatus: p.stock > 0 ? '有現貨' : '缺貨',
        sugar: p.sugar ? '有糖' : '無糖'
      }));

      return `【系統公開數據快照（客戶視角）】
- 商品列表: ${JSON.stringify(publicProducts)}

⚠️ 注意：您是外部客服，請勿透露具體庫存數量，僅告知有或無。若客戶詢問敏感數據，請婉拒。`;
    }

    // --- 內部特助視角：完整數據 ---
    const internalProducts = products.map(p => ({
      id: p.id,
      name: p.name,
      stock: p.stock,
      safety: p.safetyStock,
      transit: p.transitQuantity,
      cost: p.costBeforeTax,
      supplier: p.supplierName,
      sugar: p.sugar ? '有糖' : '無糖'
    }));

    return `【📊 即時計算指標】
${calculatedStats}

【📊 戰情中心數據】
* 本月營收: $${metrics.revenue.currentMonth} (年度累計: $${metrics.revenue.totalYear})
* 訂單狀態: 今日新增 ${metrics.orders.todayCount} 筆, 處理中 ${metrics.orders.pendingCount} 筆
* 庫存警示: ⚠️ ${metrics.inventory.lowStockCount} 項商品低於安全水位, ⛔ ${metrics.inventory.outOfStockCount} 項缺貨
* 生產進度: 進行中代工單 ${metrics.manufacturing.activeOrders} 筆
* 數據更新時間: ${metrics.lastUpdated}

【系統內部數據詳情（管理員視角）】
- 商品完整列表: ${JSON.stringify(internalProducts)}

⚠️ 注意：請優先參考【即時計算指標】的數值回答問題，這些是經由系統公式精確計算的結果。`;
  }

  // --- 【Firestore 同步】 ---

  private subscribeToTrainingData(): void {
    this.unsubscribe = onSnapshot(
      doc(this.firestore, this.CONFIG_PATH, this.CONFIG_DOC),
      (snap) => {
        if (snap.exists()) {
          const data = snap.data();
          if (data['systemInstruction']) {
            this.systemInstruction.set(data['systemInstruction']);
          }
          if (data['keywords']) {
            this.knowledgeBase.set(data['keywords']);
          }
          if (data['role']) {
            this.currentRole.set(data['role'] as AiRole);
          }
        }
      },
      (error) => {
        console.error('[AiTrainingService] 監聽失敗:', error);
      }
    );
  }

  ngOnDestroy(): void {
    if (this.unsubscribe) this.unsubscribe();
  }
}
