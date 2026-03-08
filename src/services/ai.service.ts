import { Injectable, signal, OnDestroy } from '@angular/core';
import { doc, onSnapshot, Unsubscribe, getDoc, updateDoc } from 'firebase/firestore';
import { db } from '../firebase.config';
import { GoogleGenerativeAI } from "@google/generative-ai";

@Injectable({
  providedIn: 'root'
})
export class AiService implements OnDestroy {
  private unsubscribeConfig: Unsubscribe | null = null;
  private firestore = db;
  
  sharedKey = signal<string>('');
  researchResult = signal<{ text: string; sources: any[] }>({ text: '', sources: [] });
  knowledgeBase = signal<string[]>([]);
  // 【新增：解決 AiTrainingComponent 第 40 行報錯】
  currentSystemInstruction = signal<string>('');

  constructor() {
    this.subscribeToConfigurationChanges();
    this.fetchSharedKey();
  }

  // --- 【AI 訓練功能】 ---
  async generateSystemInstruction(direction: string): Promise<string> {
    const genAI = await this.getGenAIInstance();
    const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash" });
    const result = await model.generateContent(`生成系統指令：${direction}`);
    const text = result.response.text();
    this.currentSystemInstruction.set(text); // 同步更新狀態
    return text;
  }

  async updateConfiguration(systemInstruction: string, keywords?: string[]): Promise<void> {
    const docRef = doc(this.firestore, 'systemConfig', 'gemini');
    await updateDoc(docRef, { 
      systemInstruction, 
      keywords: keywords || [] 
    });
  }

  // --- 【管理功能】 修復 SystemComponent ---
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

  // --- 【業務功能】 修復 SmartImport/Suppliers/Finance/Dashboard ---
  async parseUnstructuredData(text: string, schema: any): Promise<any> {
    const genAI = await this.getGenAIInstance();
    const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash" });
    const result = await model.generateContent(`解析 JSON: ${text}`);
    return JSON.parse(result.response.text().replace(/```json|```/g, '').trim());
  }

  async performWebSearch(query: string): Promise<any> {
    const genAI = await this.getGenAIInstance();
    const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash" });
    const result = await model.generateContent(query);
    this.researchResult.set({ text: result.response.text(), sources: [] });
    return result.response.text();
  }

  async sendMessage(prompt: string): Promise<string> {
    const genAI = await this.getGenAIInstance();
    const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash" });
    return (await model.generateContent(prompt)).response.text();
  }

  async generateBusinessInsight(context: any): Promise<string> {
    const genAI = await this.getGenAIInstance();
    const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash" });
    return (await model.generateContent(JSON.stringify(context))).response.text();
  }

  async generateFormulaFromLogic(logic: string, category?: string, image?: string): Promise<string> {
    const genAI = await this.getGenAIInstance();
    const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash" });
    return (await model.generateContent(logic)).response.text();
  }

  async parseLogisticsImage(imageBase64: string, providerOptions: string[] = []): Promise<any> {
    const genAI = await this.getGenAIInstance();
    const compressed = await this.compressImage(imageBase64);
    const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash" });
    const result = await model.generateContent(["辨識單據", { inlineData: { mimeType: "image/jpeg", data: compressed.split(',')[1] } }]);
    return JSON.parse(result.response.text().replace(/```json|```/g, '').trim());
  }

  // --- 【輔助方法】 ---
  private async compressImage(base64: string): Promise<string> {
    return new Promise((res) => {
      const img = new Image(); img.src = base64;
      img.onload = () => {
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');
        canvas.width = 1024; canvas.height = (img.height / img.width) * 1024;
        ctx?.drawImage(img, 0, 0, canvas.width, canvas.height);
        res(canvas.toDataURL('image/jpeg', 0.8));
      };
    });
  }

  private subscribeToConfigurationChanges() {
    this.unsubscribeConfig = onSnapshot(doc(this.firestore, 'systemConfig', 'gemini'), (snap) => {
      if (snap.exists()) {
        const data = snap.data();
        if (data['apiKey']) this.sharedKey.set(data['apiKey'].trim());
        if (data['keywords']) this.knowledgeBase.set(data['keywords']);
        if (data['systemInstruction']) this.currentSystemInstruction.set(data['systemInstruction']);
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
