import { Injectable, signal, OnDestroy } from '@angular/core';
import { doc, onSnapshot, getDoc, updateDoc } from 'firebase/firestore';
import { db } from '../firebase.config';
import { GoogleGenerativeAI } from "@google/generative-ai";

@Injectable({
  providedIn: 'root'
})
export class AiService implements OnDestroy {
  private unsubscribeConfig: any = null;
  private firestore = db;
  
  // 狀態管理 Signals
  sharedKey = signal<string>('');
  researchResult = signal<{ text: string; sources: any[] }>({ text: '', sources: [] });
  knowledgeBase = signal<string[]>([]);
  currentSystemInstruction = signal<string>('');
  // 【新增：修復 AiAssistantComponent 報錯】
  currentRole = signal<string>('default');

  constructor() {
    this.subscribeToConfigurationChanges();
    this.fetchSharedKey();
  }

  // --- 【1. 通訊與業務功能】 ---
  // 調整參數為可選，以相容助理組件 (3個參數) 與財務組件 (1個參數)
  async sendMessage(prompt: string, image?: string, context?: any): Promise<string> {
    const genAI = await this.getGenAIInstance();
    const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash" });
    const finalPrompt = context ? `${JSON.stringify(context)}\n\n問題: ${prompt}` : prompt;
    
    if (image) {
      const result = await model.generateContent([finalPrompt, { inlineData: { mimeType: "image/jpeg", data: image.split(',')[1] } }]);
      return result.response.text();
    }
    const result = await model.generateContent(finalPrompt);
    return result.response.text();
  }

  // 相容 DefinitionsComponent 的多參數呼叫
  async generateFormulaFromLogic(logic: string, category?: string, image?: string): Promise<string> {
    return this.sendMessage(`邏輯: ${logic}${category ? `, 類別: ${category}` : ''}`, image);
  }

  async parseUnstructuredData(text: string, schema: any): Promise<any> {
    const response = await this.sendMessage(`解析 JSON: ${text}`);
    return JSON.parse(response.replace(/```json|```/g, '').trim());
  }

  async performWebSearch(query: string): Promise<any> {
    const text = await this.sendMessage(`搜尋: ${query}`);
    this.researchResult.set({ text, sources: [] });
    return text;
  }

  async parseLogisticsImage(imageBase64: string): Promise<any> {
    const response = await this.sendMessage("辨識單據內容並轉為 JSON", imageBase64);
    return JSON.parse(response.replace(/```json|```/g, '').trim());
  }

  // --- 【2. 訓練與設定功能】 ---
  async generateSystemInstruction(direction: string): Promise<string> {
    const text = await this.sendMessage(`生成 AI 系統指令：${direction}`);
    this.currentSystemInstruction.set(text);
    return text;
  }

  async updateConfiguration(systemInstruction: string, keywords?: string[]): Promise<void> {
    const docRef = doc(this.firestore, 'systemConfig', 'gemini');
    await updateDoc(docRef, { systemInstruction, keywords: keywords || [] });
  }

  // --- 【3. 基礎管理功能】 ---
  getStoredKey(): string | null { return localStorage.getItem('gemini_api_key'); }
  saveKeyToStorage(key: string): boolean {
    try { localStorage.setItem('gemini_api_key', key.trim()); return true; }
    catch (e) { return false; }
  }
  clearStoredKey(): void { localStorage.removeItem('gemini_api_key'); }
  async ensureApiKey(): Promise<boolean> { 
    const key = this.getStoredKey() || await this.fetchSharedKey();
    return !!(key && key.trim().length > 0);
  }

  // --- 【4. 資料同步邏輯】 ---
  private subscribeToConfigurationChanges() {
    this.unsubscribeConfig = onSnapshot(doc(this.firestore, 'systemConfig', 'gemini'), (snap) => {
      if (snap.exists()) {
        const data = snap.data();
        if (data['apiKey']) this.sharedKey.set(data['apiKey'].trim());
        if (data['keywords']) this.knowledgeBase.set(data['keywords']);
        if (data['systemInstruction']) this.currentSystemInstruction.set(data['systemInstruction']);
        if (data['role']) this.currentRole.set(data['role']); // 同步角色設定
      }
    });
  }

  async fetchSharedKey(): Promise<string | null> {
    const snap = await getDoc(doc(this.firestore, 'systemConfig', 'gemini'));
    if (snap.exists() && snap.data()['apiKey']) {
      const key = snap.data()['apiKey'].trim();
      this.sharedKey.set(key);
      return key;
    }
    return null;
  }

  private async getGenAIInstance() { 
    const key = this.getStoredKey() || await this.fetchSharedKey();
    if (!key) throw new Error("API Key缺失");
    return new GoogleGenerativeAI(key);
  }

  ngOnDestroy() { if (this.unsubscribeConfig) this.unsubscribeConfig(); }
}
