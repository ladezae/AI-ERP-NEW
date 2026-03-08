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

  // 【修復 1】：新增 ensureApiKey 方法
  async ensureApiKey(): Promise<boolean> {
    const key = localStorage.getItem('gemini_api_key') || await this.fetchSharedKey();
    return !!(key && key.trim().length > 0);
  }

  // 【修復 2】：補回儲存與清除方法
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

  // 【核心功能】：物流辨識實作
  async parseLogisticsImage(imageBase64: string, providerOptions: string[] = []): Promise<any> {
    try {
      const genAI = await this.getGenAIInstance();
      const compressedBase64 = await this.compressImage(imageBase64);
      const base64Data = compressedBase64.split(',')[1] || compressedBase64;

      const model = genAI.getGenerativeModel({ 
        model: "gemini-2.0-flash",
        systemInstruction: "你是一個台灣物流單據 OCR 專家，請回傳純 JSON 格式，包含 provider 和 trackingNumber。" 
      });

      const result = await model.generateContent([
        "辨識圖中物流商與單號。",
        { inlineData: { mimeType: "image/jpeg", data: base64Data } }
      ]);

      const text = result.response.text();
      return JSON.parse(text.replace(/```json|```/g, '').trim());
    } catch (error) {
      console.error("AI 辨識失敗", error);
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
        this.keySource.set('server');
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
    let apiKey = localStorage.getItem('gemini_api_key') || await this.fetchSharedKey();
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
