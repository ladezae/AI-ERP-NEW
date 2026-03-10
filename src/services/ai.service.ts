import { Injectable, signal, OnDestroy } from '@angular/core';
import { doc, onSnapshot, getDoc, updateDoc } from 'firebase/firestore';
import { db } from '../firebase.config';

export type AiRole = string;

@Injectable({
  providedIn: 'root'
})
export class AiService implements OnDestroy {
  private unsubscribeConfig: any = null;
  private firestore = db;
  private readonly GROQ_ENDPOINT = 'https://api.groq.com/openai/v1/chat/completions';
  private readonly GROQ_MODEL = 'meta-llama/llama-4-scout-17b-16e-instruct';

  sharedKey = signal<string>('');
  researchResult = signal<{ text: string; sources: any[] }>({ text: '', sources: [] });
  knowledgeBase = signal<string[]>([]);
  currentSystemInstruction = signal<string>('');
  currentRole = signal<AiRole>('default');

  constructor() {
    this.subscribeToConfigurationChanges();
    this.fetchSharedKey();
  }

  setRole(role: AiRole): void {
    this.currentRole.set(role);
  }

  // --- 【1. 萬用通訊核心】 ---
  async sendMessage(prompt: string, image?: string, context?: any): Promise<string> {
    const apiKey = await this.getGroqApiKey();
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
    const key = this.sharedKey() || await this.fetchSharedKey();
    if (!key) {
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
      console.error('[AiService] parseLogisticsImage JSON parse failed:', response);
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
    return this.sendMessage("請分析以下商業數據並提供洞察", undefined, context);
  }

  // --- 【3. 訓練與系統設定】 ---
  async generateSystemInstruction(direction: string): Promise<string> {
    const text = await this.sendMessage(`請幫我生成一段 AI 系統指令，方向為：${direction}`);
    this.currentSystemInstruction.set(text);
    return text;
  }

  async updateConfiguration(systemInstruction: string, keywords?: string[]): Promise<void> {
    const docRef = doc(this.firestore, 'systemConfig', 'gemini');
    await updateDoc(docRef, { systemInstruction, keywords: keywords || [] });
  }

  // --- 【4. 基礎管理與同步】 ---

  getStoredKey(): string | null {
    const key = this.sharedKey();
    return key && key.trim().length > 0 ? key.trim() : null;
  }

  saveKeyToStorage(key: string): boolean {
    try {
      this.sharedKey.set(key.trim());
      return true;
    } catch (e) {
      return false;
    }
  }

  clearStoredKey(): void {
    this.sharedKey.set('');
  }

  async ensureApiKey(): Promise<boolean> {
    if (this.sharedKey() && this.sharedKey().trim().length > 0) {
      return true;
    }
    const key = await this.fetchSharedKey();
    return !!(key && key.trim().length > 0);
  }

  private subscribeToConfigurationChanges() {
    this.unsubscribeConfig = onSnapshot(doc(this.firestore, 'systemConfig', 'gemini'), (snap) => {
      if (snap.exists()) {
        const data = snap.data();
        if (data['apiKey']) this.sharedKey.set(data['apiKey'].trim());
        if (data['keywords']) this.knowledgeBase.set(data['keywords']);
        if (data['systemInstruction']) this.currentSystemInstruction.set(data['systemInstruction']);
        if (data['role']) this.currentRole.set(data['role']);
      }
    });
  }

  async fetchSharedKey(): Promise<string | null> {
    try {
      const snap = await getDoc(doc(this.firestore, 'systemConfig', 'gemini'));
      if (snap.exists() && snap.data()['apiKey']) {
        const key = snap.data()['apiKey'].trim();
        this.sharedKey.set(key);
        return key;
      }
    } catch (e) {
      console.error('[AiService] fetchSharedKey failed:', e);
    }
    return null;
  }

  private async getGroqApiKey(): Promise<string> {
    const key = this.sharedKey() || await this.fetchSharedKey();
    if (!key || !key.trim()) {
      throw new Error('API Key 缺失，請至系統設定配置 Groq API Key。');
    }
    return key.trim();
  }

  ngOnDestroy() {
    if (this.unsubscribeConfig) this.unsubscribeConfig();
  }
}
