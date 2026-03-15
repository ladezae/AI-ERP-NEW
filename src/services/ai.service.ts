/**
 * AI 文字服務（重構版）
 *
 * 負責所有文字類 AI 任務：對話、OCR、公式生成、資料解析等。
 * 底層使用 Groq API + Llama 模型。
 *
 * 重構說明：
 * - API Key 管理已委託給 AiConfigService
 * - 知識庫/人設管理已委託給 AiTrainingService
 * - 本 Service 保留原有對外 API（sendMessage、parseLogisticsImage 等）
 *   以維持 19 個現有元件的相容性
 */
import { Injectable, signal, inject } from '@angular/core';
import { AiConfigService } from './ai-config.service';
import { AiTrainingService, AiRole } from './ai-training.service';

// 重新匯出 AiRole，讓現有 import { AiRole } from ai.service 的元件不用改
export type { AiRole } from './ai-training.service';

@Injectable({
  providedIn: 'root'
})
export class AiService {
  private configService = inject(AiConfigService);
  private trainingService = inject(AiTrainingService);

  private readonly GROQ_ENDPOINT = 'https://api.groq.com/openai/v1/chat/completions';
  private readonly GROQ_MODEL = 'meta-llama/llama-4-scout-17b-16e-instruct';

  // === 向下相容的 Signals（委託給子 Service） ===
  get sharedKey() { return this.configService.groqKey; }
  get knowledgeBase() { return this.trainingService.knowledgeBase; }
  get currentSystemInstruction() { return this.trainingService.systemInstruction; }
  get currentRole() { return this.trainingService.currentRole; }

  researchResult = signal<{ text: string; sources: any[] }>({ text: '', sources: [] });

  // === 向下相容方法 ===

  setRole(role: AiRole): void {
    this.trainingService.setRole(role);
  }

  // --- 【1. 萬用通訊核心】 ---
  async sendMessage(prompt: string, image?: string, context?: any): Promise<string> {
    const apiKey = await this.configService.getGroqKey();
    const finalPrompt = context
      ? `上下文環境: ${JSON.stringify(context)}\n\n使用者問題: ${prompt}`
      : prompt;

    const userContent: any[] = [];

    if (image && image.includes('base64,')) {
      const [header, base64Data] = image.split(',');
      const mimeMatch = header.match(/data:(.*);base64/);
      const mimeType = mimeMatch ? mimeMatch[1] : 'image/jpeg';
      userContent.push({
        type: 'image_url',
        image_url: { url: `data:${mimeType};base64,${base64Data}` }
      });
    }

    userContent.push({ type: 'text', text: finalPrompt });

    const response = await fetch(this.GROQ_ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: this.GROQ_MODEL,
        max_tokens: 2000,
        messages: [{ role: 'user', content: userContent }]
      })
    });

    if (!response.ok) {
      const errorBody = await response.text();
      throw new Error(`Groq API error ${response.status}: ${errorBody}`);
    }

    const data = await response.json();
    const content = data?.choices?.[0]?.message?.content;
    if (Array.isArray(content)) {
      return content.map((part: any) => part?.text ?? '').join('');
    }
    return content ?? '';
  }

  // --- 【2. 業務專屬方法】 ---

  async parseLogisticsImage(imageBase64: string, logisticsOptions?: string[]): Promise<{
    provider: string;
    trackingId: string;
    trackingUrl: string;
  }> {
    const hasKey = await this.configService.ensureGroqKey();
    if (!hasKey) {
      throw new Error('API Key 未設定，請至系統設定配置 Groq API Key');
    }

    const optionsStr = logisticsOptions ? logisticsOptions.join('、') : '黑貓、大榮';

    const prompt = `你是台灣物流單據辨識專家。請仔細分析這張圖片。

## 物流商判斷規則
- 黑貓：圖片出現「黑貓」「宅急便」「T-CAT」「t-cat」「9075」開頭單號
- 大榮：圖片出現「大榮」「DHC」「台灣宅配通」或非9075開頭的單號

## 追蹤單號規則
- 只擷取數字和連字號，例如：9075-8324-3302
- 不要包含空格或其他字元

可用物流商選項：${optionsStr}

請只回傳以下 JSON 格式，不要有任何其他文字或 markdown：
{"provider":"物流商名稱","trackingId":"追蹤單號"}`;

    const response = await this.sendMessage(prompt, imageBase64);

    try {
      const cleaned = response.replace(/```json|```/g, '').trim();
      const result = JSON.parse(cleaned);
      return {
        provider: result.provider || '',
        trackingId: result.trackingId || '',
        trackingUrl: ''
      };
    } catch (e) {
      console.error('[AiService] parseLogisticsImage JSON 解析失敗:', response);
      return { provider: '', trackingId: '未辨識', trackingUrl: '' };
    }
  }

  async generateFormulaFromLogic(logic: string, category?: string, image?: string): Promise<string> {
    return this.sendMessage(`邏輯需求: ${logic}${category ? `, 應用類別: ${category}` : ''}`, image);
  }

  async parseUnstructuredData(text: string, schema?: any): Promise<any> {
    const prompt = schema
      ? `請依據此 schema 解析文字: ${JSON.stringify(schema)}\n內容: ${text}`
      : `請將此文字解析為 JSON: ${text}`;
    const response = await this.sendMessage(prompt);
    return JSON.parse(response.replace(/```json|```/g, '').trim());
  }

  async performWebSearch(query: string): Promise<any> {
    const text = await this.sendMessage(`請搜尋並整理資訊: ${query}`);
    this.researchResult.set({ text, sources: [] });
    return text;
  }

  async generateBusinessInsight(context: any): Promise<string> {
    return this.sendMessage('請分析以下商業數據並提供洞察', undefined, context);
  }

  // --- 【3. 訓練與系統設定（委託給 AiTrainingService）】 ---

  async generateSystemInstruction(direction: string): Promise<string> {
    const text = await this.sendMessage(`請幫我生成一段 AI 系統指令，方向為：${direction}`);
    this.trainingService.systemInstruction.set(text);
    return text;
  }

  async updateConfiguration(systemInstruction: string, keywords?: string[]): Promise<void> {
    return this.trainingService.updateConfiguration(systemInstruction, keywords);
  }

  // --- 【4. 向下相容方法（委託給 AiConfigService）】 ---

  getStoredKey(): string | null {
    const key = this.configService.groqKey();
    return key && key.trim().length > 0 ? key.trim() : null;
  }

  saveKeyToStorage(key: string): boolean {
    try {
      this.configService.groqKey.set(key.trim());
      return true;
    } catch (e) {
      return false;
    }
  }

  clearStoredKey(): void {
    this.configService.groqKey.set('');
  }

  async ensureApiKey(): Promise<boolean> {
    return this.configService.ensureGroqKey();
  }
}
