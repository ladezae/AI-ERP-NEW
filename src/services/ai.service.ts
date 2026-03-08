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
  
  // 狀態管理信號
  sharedKey = signal<string>('');
  researchResult = signal<{ text: string; sources: any[] }>({ text: '', sources: [] });
  knowledgeBase = signal<string[]>([]);
  currentSystemInstruction = signal<string>('');
  currentRole = signal<string>('default');

  constructor() {
    this.subscribeToConfigurationChanges();
    this.fetchSharedKey();
  }

  // --- 【1. 多功能通訊接口】 ---
  // 核心發送方法：支援純文字或圖文混和，相容多種呼叫方式
  async sendMessage(prompt: string, image?: string, context?: any): Promise<string> {
    const genAI = await this.getGenAIInstance();
    const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash" });
    const finalPrompt = context ? `上下文: ${JSON.stringify(context)}\n\n指令: ${prompt}` : prompt;
    
    if (image && image.includes('base64,')) {
      const result = await model.generateContent([finalPrompt, { inlineData: { mimeType: "image/jpeg", data: image.split(',')[1] } }]);
      return result.response.text();
    }
    const result = await model.generateContent(finalPrompt);
    return result.response.text();
  }

  // 物流辨識：支援 2 個參數以解決 TS2554 報錯
  async parseLogisticsImage(imageBase64: string, options?: any): Promise<any> {
    const prompt = options ? `辨識此單據，參考選項: ${JSON.stringify(options)}` : "辨識單據內容並轉為 JSON";
    const response = await this.sendMessage(prompt, imageBase64);
    return JSON.parse(response.replace(/```json|```/g, '').trim());
  }

  // 業務邏輯生成：支援 3 個參數以相容 Definitions 組件
  async generateFormulaFromLogic(logic: string, category?: string, image?: string): Promise<string> {
    return this.sendMessage(`邏輯: ${logic}${category ? `, 類別: ${category}` : ''}`, image);
  }

  async parseUnstructuredData(text: string, schema?: any): Promise<any> {
    const response = await this.sendMessage(`依據架構解析 JSON: ${text}`);
    return JSON.parse(response.replace(/```json|```/g, '').trim());
  }

  async performWebSearch(query: string): Promise<any> {
    const text = await this.sendMessage(`搜尋供應商資訊: ${query}`);
    this.researchResult.set({ text, sources: [] });
    return text;
  }

  // --- 【2. 訓練與設定功能】 ---
  async generateSystemInstruction(direction: string): Promise<string> {
    const text = await this.sendMessage(`生成系統指令：${direction}`);
    this.currentSystemInstruction.set(text);
    return text;
  }

  async updateConfiguration(systemInstruction: string, keywords?: string[]): Promise<void> {
    const docRef = doc(this.firestore, 'systemConfig', 'gemini');
    await updateDoc(docRef, { systemInstruction, keywords: keywords || [] });
  }

  // --- 【3. 基礎設施與同步】 ---
  getStoredKey(): string | null { return localStorage.getItem('gemini_api_key'); }
  saveKeyToStorage(key: string): boolean {
    try { localStorage.setItem('gemini_api_key', key.trim()); return true; }
    catch (e) { return false; }
  }
  clearStoredKey(): void { localStorage.removeItem('gemini_api_key'); }

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
