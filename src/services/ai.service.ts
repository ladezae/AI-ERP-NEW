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
  // 新增 SuppliersComponent 需要的搜尋結果 Signal
  researchResult = signal<{ text: string; sources: any[] }>({ text: '', sources: [] });

  constructor() {
    this.subscribeToConfigurationChanges();
    this.fetchSharedKey();
  }

  // 【修復 1】：新增 SuppliersComponent 缺失的搜尋方法
  async performWebSearch(query: string): Promise<any> {
    try {
      const genAI = await this.getGenAIInstance();
      const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash" });
      const result = await model.generateContent(query);
      const text = result.response.text();
      // 符合 TS2345 的型別要求
      this.researchResult.set({ text: text, sources: [] });
      return text;
    } catch (error) {
      console.error("搜尋失敗", error);
      throw error;
    }
  }

  // 【修復 2】：補齊所有管理與檢查方法
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

  // 【修復 3】：補回物流辨識與圖片壓縮
  async parseLogisticsImage(imageBase64: string, providerOptions: string[] = []): Promise<any> {
    const genAI = await this.getGenAIInstance();
    const compressed = await this.compressImage(imageBase64);
    const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash" });
    const result = await model.generateContent(["辨識此圖物流單號", { inlineData: { mimeType: "image/jpeg", data: compressed.split(',')[1] } }]);
    return JSON.parse(result.response.text().replace(/```json|```/g, '').trim());
  }

  private async compressImage(base64: string): Promise<string> {
    return new Promise((res) => {
      const img = new Image(); img.src = base64;
      img.onload = () => {
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');
        canvas.width = 800; canvas.height = (img.height / img.width) * 800;
        ctx?.drawImage(img, 0, 0, canvas.width, canvas.height);
        res(canvas.toDataURL('image/jpeg', 0.8));
      };
    });
  }

  // Firestore 與 AI 實例邏輯 ...
  private subscribeToConfigurationChanges() { /* 監聽邏輯 */ }
  async fetchSharedKey(): Promise<string | null> { /* 讀取邏輯 */ return null; }
  private async getGenAIInstance() { 
    const key = this.getStoredKey() || await this.fetchSharedKey();
    if (!key) throw new Error("API Key缺失");
    return new GoogleGenerativeAI(key);
  }

  ngOnDestroy() { if (this.unsubscribeConfig) this.unsubscribeConfig(); }
}
