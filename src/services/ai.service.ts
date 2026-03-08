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
  // 供 SuppliersComponent 使用的搜尋結果 Signal
  researchResult = signal<{ text: string; sources: any[] }>({ text: '', sources: [] });

  constructor() {
    this.subscribeToConfigurationChanges();
    this.fetchSharedKey();
  }

  // 新增 SuppliersComponent 要求的搜尋方法
  async performWebSearch(query: string): Promise<any> {
    try {
      const genAI = await this.getGenAIInstance();
      const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash" });
      const result = await model.generateContent(query);
      const text = result.response.text();
      
      this.researchResult.set({ text: text, sources: [] });
      return text;
    } catch (error) {
      console.error("搜尋失敗", error);
      throw error;
    }
  }

  getStoredKey(): string | null { 
    return localStorage.getItem('gemini_api_key'); 
  }

  async ensureApiKey(): Promise<boolean> { 
    const key = this.getStoredKey() || await this.fetchSharedKey();
    return !!(key && key.trim().length > 0);
  }

  saveKeyToStorage(key: string): boolean {
    try { 
      localStorage.setItem('gemini_api_key', key.trim()); 
      return true; 
    } catch (e) { return false; }
  }

  clearStoredKey(): void { 
    localStorage.removeItem('gemini_api_key'); 
  }

  // 修正語法錯誤後的物流辨識方法
  async parseLogisticsImage(imageBase64: string, providerOptions: string[] = []): Promise<any> {
    try {
      const genAI = await this.getGenAIInstance();
      const compressed = await this.compressImage(imageBase64);
      const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash" });
      
      const result = await model.generateContent([
        "你是一個台灣物流單據 OCR 專家，請回傳純 JSON 格式，包含 provider 和 trackingNumber。",
        { inlineData: { mimeType: "image/jpeg", data: compressed.split(',')[1] } }
      ]);
      
      const text = result.response.text();
      return JSON.parse(text.replace(/```json|```/g, '').trim());
    } catch (error) {
      console.error("AI 辨識錯誤", error);
      throw error;
    }
  }

  private async compressImage(base64: string): Promise<string> {
    return new Promise((res) => {
      const img = new Image();
      img.src = base64;
      img.onload = () => {
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');
        const maxWidth = 1024;
        const scale = Math.min(1, maxWidth / img.width);
        canvas.width = img.width * scale;
        canvas.height = img.height * scale;
        ctx?.drawImage(img, 0, 0, canvas.width, canvas.height);
        res(canvas.toDataURL('image/jpeg', 0.8));
      };
      img.onerror = () => res(base64);
    });
  }

  private subscribeToConfigurationChanges() {
    if (!this.firestore) return;
    const docRef = doc(this.firestore, 'systemConfig', 'gemini');
    this.unsubscribeConfig = onSnapshot(docRef, (docSnap) => {
      if (docSnap.exists() && docSnap.data()['apiKey']) {
        this.sharedKey.set(docSnap.data()['apiKey'].trim());
      }
    });
  }

  async fetchSharedKey(): Promise<string | null> {
    try {
      if (!this.firestore) return null;
      const docRef = doc(this.firestore, 'systemConfig', 'gemini');
      const docSnap = await getDoc(docRef);
      if (docSnap.exists() && docSnap.data()['apiKey']) {
        const key = docSnap.data()['apiKey'].trim();
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

  ngOnDestroy() { 
    if (this.unsubscribeConfig) this.unsubscribeConfig(); 
  }
}
