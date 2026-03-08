import { Injectable, signal, OnDestroy, inject } from '@angular/core';
import { doc, onSnapshot, Unsubscribe, getDoc } from 'firebase/firestore';
import { db } from '../firebase.config';
import { DataService } from './data.service';
import { GoogleGenerativeAI } from "@google/generative-ai";

@Injectable({
  providedIn: 'root'
})
export class AiService implements OnDestroy {
  private unsubscribeConfig: Unsubscribe | null = null;
  private firestore = db;
  private dataService = inject(DataService);
  
  sharedKey = signal<string>('');
  researchResult = signal<{ text: string; sources: any[] }>({ text: '', sources: [] });

  constructor() {
    this.subscribeToConfigurationChanges();
    this.fetchSharedKey();
  }

  // 【新增：解決 FinanceComponent 報錯】
  async sendMessage(prompt: string): Promise<string> {
    try {
      const genAI = await this.getGenAIInstance();
      const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash" });
      const result = await model.generateContent(prompt);
      return result.response.text();
    } catch (error) {
      console.error("AI 對話失敗", error);
      throw error;
    }
  }

  // 【新增：解決 SmartImportComponent 報錯】
  async parseUnstructuredData(text: string, schema: any): Promise<any> {
    try {
      const genAI = await this.getGenAIInstance();
      const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash" });
      const prompt = `請根據以下結構解析文字並回傳純 JSON：\n結構: ${JSON.stringify(schema)}\n內容: ${text}`;
      const result = await model.generateContent(prompt);
      return JSON.parse(result.response.text().replace(/```json|```/g, '').trim());
    } catch (error) {
      console.error("資料解析失敗", error);
      throw error;
    }
  }

  // 【保留：解決 SuppliersComponent 報錯】
  async performWebSearch(query: string): Promise<any> {
    try {
      const genAI = await this.getGenAIInstance();
      const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash" });
      const result = await model.generateContent(query);
      const text = result.response.text();
      this.researchResult.set({ text: text, sources: [] });
      return text;
    } catch (error) { throw error; }
  }

  // 【核心功能：物流辨識】
  async parseLogisticsImage(imageBase64: string, providerOptions: string[] = []): Promise<any> {
    try {
      const genAI = await this.getGenAIInstance();
      const compressed = await this.compressImage(imageBase64);
      const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash" });
      const result = await model.generateContent([
        "辨識台灣物流單據並回傳 JSON (provider, trackingNumber)。",
        { inlineData: { mimeType: "image/jpeg", data: compressed.split(',')[1] } }
      ]);
      return JSON.parse(result.response.text().replace(/```json|```/g, '').trim());
    } catch (error) { throw error; }
  }

  // 其他管理方法 ...
  getStoredKey(): string | null { return localStorage.getItem('gemini_api_key'); }
  async ensureApiKey(): Promise<boolean> { 
    const key = this.getStoredKey() || await this.fetchSharedKey();
    return !!(key && key.trim().length > 0);
  }
  saveKeyToStorage(key: string): boolean {
    try { localStorage.setItem('gemini_api_key', key.trim()); return true; }
    catch (e) { return false; }
  }
  clearStoredKey(): void { localStorage.removeItem('gemini_api_key'); }

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
      img.onerror = () => res(base64);
    });
  }

  private subscribeToConfigurationChanges() {
    if (!this.firestore) return;
    onSnapshot(doc(this.firestore, 'systemConfig', 'gemini'), (snap) => {
      if (snap.exists() && snap.data()['apiKey']) this.sharedKey.set(snap.data()['apiKey'].trim());
    });
  }

  async fetchSharedKey(): Promise<string | null> {
    try {
      if (!this.firestore) return null;
      const snap = await getDoc(doc(this.firestore, 'systemConfig', 'gemini'));
      if (snap.exists() && snap.data()['apiKey']) {
        const key = snap.data()['apiKey'].trim();
        this.sharedKey.set(key);
        return key;
      }
      return null;
    } catch (e) { return null; }
  }

  private async getGenAIInstance() { 
    const key = this.getStoredKey() || await this.fetchSharedKey();
    if (!key) throw new Error("API Key缺失");
    return new GoogleGenerativeAI(key);
  }

  ngOnDestroy() { if (this.unsubscribeConfig) this.unsubscribeConfig(); }
}
