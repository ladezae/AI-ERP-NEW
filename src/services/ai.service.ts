import { Injectable, signal, OnDestroy, inject } from '@angular/core';
import { doc, onSnapshot, Unsubscribe, getDoc } from 'firebase/firestore';
import { db } from '../firebase.config';
import { DataService } from './data.service';
import { GoogleGenerativeAI } from "@google/generative-ai";

export type AiRole = 'internal' | 'external';

@Injectable({
  providedIn: 'root'
})
export class AiService implements OnDestroy {
  private unsubscribeConfig: Unsubscribe | null = null;
  private firestore = db;
  private dataService = inject(DataService);
  
  currentRole = signal<AiRole>('internal');
  sharedKey = signal<string>('');
  keySource = signal<'none' | 'local' | 'server' | 'platform'>('none');
  
  private sharedKeyPromise: Promise<string | null> | null = null;

  constructor() {
    this.subscribeToConfigurationChanges();
    this.fetchSharedKey();
  }

  // 【修復 1】：新增 SuppliersComponent 要求的搜尋方法
  async performWebSearch(query: string): Promise<string> {
    try {
      const genAI = await this.getGenAIInstance();
      const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash" });
      const result = await model.generateContent(`請搜尋並總結以下內容：${query}`);
      return result.response.text();
    } catch (error) {
      return "搜尋失敗，請檢查 API Key";
    }
  }

  // 【修復 2】：補齊所有基礎管理方法
  getStoredKey(): string | null {
    return localStorage.getItem('gemini_api_key');
  }

  async ensureApiKey(): Promise<boolean> {
    const key = this.getStoredKey() || await this.fetchSharedKey();
    return !!(key && key.trim().length > 0);
  }

  saveKeyToStorage(key: string): boolean {
    try {
      if (!key) return false;
      localStorage.setItem('gemini_api_key', key.trim());
      return true;
    } catch (e) { return false; }
  }

  clearStoredKey(): void {
    localStorage.removeItem('gemini_api_key');
  }

  // 【核心功能】：物流辨識實作
  async parseLogisticsImage(imageBase64: string, providerOptions: string[] = []): Promise<any> {
    try {
      const genAI = await this.getGenAIInstance();
      const compressedBase64 = await this.compressImage(imageBase64);
      const base64Data = compressedBase64.split(',')[1] || compressedBase64;

      const model = genAI.getGenerativeModel({ 
        model: "gemini-2.0-flash",
        systemInstruction: "你是一個台灣物流單據 OCR 專家，請回傳 JSON 格式。" 
      });

      const result = await model.generateContent([
        "辨識圖中物流商與單號。",
        { inlineData: { mimeType: "image/jpeg", data: base64Data } }
      ]);

      return JSON.parse(result.response.text().replace(/```json|```/g, '').trim());
    } catch (error) {
      throw error;
    }
  }

  private async compressImage(imageBase64: string): Promise<string> {
    return new Promise((resolve) => {
      const img = new Image();
      img.src = imageBase64;
      img.onload = () => {
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');
        const maxWidth = 1024;
        const scale = Math.min(1, maxWidth / img.width);
        canvas.width = img.width * scale;
        canvas.height = img.height * scale;
        ctx?.drawImage(img, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL('image/jpeg', 0.8));
      };
      img.onerror = () => resolve(imageBase64);
    });
  }

  private subscribeToConfigurationChanges() {
    if (!this.firestore) return;
    const docRef = doc(this.firestore, 'systemConfig', 'gemini');
    this.unsubscribeConfig = onSnapshot(docRef, (docSnap) => {
      if (docSnap.exists() && docSnap.data()['apiKey']) {
        const key = docSnap.data()['apiKey'].trim();
        this.sharedKey.set(key);
      }
    });
  }

  async fetchSharedKey(): Promise<string | null> {
    if (this.sharedKeyPromise) return this.sharedKeyPromise;
    this.sharedKeyPromise = (async () => {
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
    })();
    return this.sharedKeyPromise;
  }

  private async getGenAIInstance(): Promise<GoogleGenerativeAI> {
    let apiKey = this.getStoredKey() || await this.fetchSharedKey();
    if (!apiKey) {
      const win = window as any;
      apiKey = win.GEMINI_API_KEY || win.API_KEY;
    }
    if (!apiKey) throw new Error("API Key missing");
    return new GoogleGenerativeAI(apiKey.trim());
  }

  ngOnDestroy() {
    if (this.unsubscribeConfig) this.unsubscribeConfig();
  }
}
