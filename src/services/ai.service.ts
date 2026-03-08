import { Injectable, signal, OnDestroy } from '@angular/core';
import { doc, onSnapshot, getDoc, updateDoc } from 'firebase/firestore';
import { db } from '../firebase.config';
import { GoogleGenerativeAI } from "@google/generative-ai";

export type AiRole = string;

@Injectable({
  providedIn: 'root'
})
export class AiService implements OnDestroy {
  private unsubscribeConfig: any = null;
  private firestore = db;
  
  // --- 【狀態管理 Signals】 ---
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
    const genAI = await this.getGenAIInstance();
    const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash" });
    const finalPrompt = context ? `上下文環境: ${JSON.stringify(context)}\n\n使用者問題: ${prompt}` : prompt;
    
    if (image && image.includes('base64,')) {
      const result = await model.generateContent([
        finalPrompt, 
        { inlineData: { mimeType: "image/jpeg", data: image.split(',')[1] } }
      ]);
      return result.response.text();
    }
    
    const result = await model.generateContent(finalPrompt);
    return result.response.text();
  }

  // --- 【2. 業務專屬方法】 ---
  async parseLogisticsImage(imageBase64: string, options?: any): Promise<any> {
    const prompt = options ? `辨識此物流單據，參考選項: ${JSON.stringify(options)}` : "請辨識此物流單據內容並轉為 JSON 格式";
    const response = await this.sendMessage(prompt, imageBase64);
    return JSON.parse(response.replace(/```json|```/g, '').trim());
  }

  async generateFormulaFromLogic(logic: string, category?: string, image?: string): Promise<string> {
    return this.sendMessage(`邏輯需求: ${logic}${category ? `, 應用類別: ${category}` : ''}`, image);
  }

  async parseUnstructuredData(text: string, schema?: any): Promise<any> {
    const prompt = schema ? `請依據此 schema 解析文字: ${JSON.stringify(schema)}\n內容: ${text}` : `請將此文字解析為 JSON: ${text}`;
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
    return localStorage.getItem('gemini_api_key'); 
  }
  
  saveKeyToStorage(key: string): boolean {
    try { 
      localStorage.setItem('gemini_api_key', key.trim()); 
      return true; 
    } catch (e) { 
      return false; 
    }
  }
  
  clearStoredKey(): void { 
    localStorage.removeItem('gemini_api_key'); 
  }
  
  async ensureApiKey(): Promise<boolean> { 
    const key = this.getStoredKey() || await this.fetchSharedKey();
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
    if (!key) throw new Error("API Key缺失，請先配置。");
    return new GoogleGenerativeAI(key);
  }

  ngOnDestroy() { 
    if (this.unsubscribeConfig) this.unsubscribeConfig(); 
  }
}
