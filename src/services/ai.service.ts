import { Injectable, signal, OnDestroy, inject } from '@angular/core';
import { doc, setDoc, onSnapshot, Unsubscribe, getDoc } from 'firebase/firestore';
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

  currentSystemInstruction = signal<string>(localStorage.getItem('erp_ai_instruction') || '');
  knowledgeBase = signal<string[]>(JSON.parse(localStorage.getItem('erp_ai_knowledge') || '[]'));

  constructor() {
    this.subscribeToConfigurationChanges();
    this.fetchSharedKey();
  }

  // 【修正 1】：補齊缺失的訂閱方法，避免 TS2339 錯誤
  private subscribeToConfigurationChanges() {
    if (!this.firestore) return;
    const docRef = doc(this.firestore, 'systemConfig', 'gemini');
    this.unsubscribeConfig = onSnapshot(docRef, (docSnap) => {
      if (docSnap.exists() && docSnap.data()['apiKey']) {
        const key = docSnap.data()['apiKey'].trim();
        this.sharedKey.set(key);
        this.keySource.set('server');
        console.log('🤖 [AI ERP] Firestore Key updated via Snapshot.');
      }
    });
  }

  // 【修正 2】：補齊圖片壓縮方法，解決 TS2339 錯誤
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
        resolve(canvas.toDataURL('image/jpeg', 0.7));
      };
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
          this.keySource.set('server');
          return key;
        }
        return null;
      } catch (e) {
        console.warn('[AI ERP] Firestore Key 讀取失敗', e);
        return null;
      }
    })();

    return this.sharedKeyPromise;
  }

  private async getGenAIInstance(): Promise<GoogleGenerativeAI> {
    let apiKey = localStorage.getItem('gemini_api_key');
    if (!apiKey) {
      apiKey = await this.fetchSharedKey();
    }
    if (!apiKey || apiKey === 'undefined') {
      const win = window as any;
      apiKey = win.GEMINI_API_KEY || win.API_KEY;
    }
    if (!apiKey || apiKey.trim() === '') {
      throw new Error("找不到有效的 API Key");
    }
    return new GoogleGenerativeAI(apiKey.trim());
  }

  async parseLogisticsImage(imageBase64: string, providerOptions: string[]): Promise<any> {
    try {
      const genAI = await this.getGenAIInstance();
      const compressedBase64 = await this.compressImage(imageBase64);
      const base64Data = compressedBase64.split(',')[1] || compressedBase64;

      const model = genAI.getGenerativeModel({ 
        model: "gemini-2.0-flash",
        systemInstruction: "你是一個專精於台灣物流單據的 OCR 專家，請回傳 JSON 格式。" 
      });

      const result = await model.generateContent([
        "請從圖片中精準擷取物流商與單號。",
        { inlineData: { mimeType: "image/jpeg", data: base64Data } }
      ]);

      const response = await result.response;
      return JSON.parse(response.text().replace(/```json|```/g, '').trim());
    } catch (error: any) {
      console.error("[AI ERP PIXEL] 辨識失敗:", error);
      throw error;
    }
  }

  ngOnDestroy() {
    if (this.unsubscribeConfig) this.unsubscribeConfig();
  }
}
