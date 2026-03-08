import { Injectable, signal, OnDestroy, inject } from '@angular/core';
import { doc, setDoc, onSnapshot, Unsubscribe, getDoc } from 'firebase/firestore';
import { db } from '../firebase.config';
import { DataService } from './data.service';
import { GoogleGenerativeAI } from "@google/generative-ai"; // 修正導入名稱

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
  
  // 關鍵修復：使用單一 Promise 鎖定，確保全域只有一個載入任務
  private sharedKeyPromise: Promise<string | null> | null = null;

  private readonly internalInstruction = `您是「公司大平台」的專屬內部 AI 智慧特助... (保持原樣)`;
  private readonly externalInstruction = `您是「公司大平台」的專業線上客服專員... (保持原樣)`;

  currentSystemInstruction = signal<string>(localStorage.getItem('erp_ai_instruction') || '');
  knowledgeBase = signal<string[]>(JSON.parse(localStorage.getItem('erp_ai_knowledge') || '[]'));

  constructor() {
    this.subscribeToConfigurationChanges();
    // 初始化即開始載入，但不阻塞 constructor
    this.fetchSharedKey();
  }

  // 【核心修復 1】：標準化 Key 獲取邏輯，確保回傳 Promise<string>
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
          console.log('🤖 [AI ERP] Shared System Key loaded from Firestore.');
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

  // 【核心修復 2】：同步取得 GenAI 實例，強制檢查 Key
  private async getGenAIInstance(): Promise<GoogleGenerativeAI> {
    // 優先序：LocalStorage > Firestore SharedKey > Platform/Env
    let apiKey = localStorage.getItem('gemini_api_key');

    if (!apiKey) {
      apiKey = await this.fetchSharedKey();
    }

    if (!apiKey || apiKey === 'undefined') {
      // 最後防線：檢查 window 全域變數
      const win = window as any;
      apiKey = win.GEMINI_API_KEY || win.API_KEY;
    }

    if (!apiKey || apiKey.trim() === '') {
      const errorMsg = "找不到有效的 API Key，請檢查 Firestore 路徑 systemConfig/gemini";
      alert(errorMsg);
      throw new Error(errorMsg);
    }

    return new GoogleGenerativeAI(apiKey.trim());
  }

  // 【核心修復 3】：物流辨識主體
  async parseLogisticsImage(imageBase64: string, providerOptions: string[]): Promise<any> {
    console.log("[AI ERP PIXEL] 執行辨識！正在進行圖片壓縮...");
    
    try {
      // 1. 強制等待 Key 與實例準備就緒
      const genAI = await this.getGenAIInstance();
      
      // 2. 圖片壓縮邏輯
      const compressedBase64 = await this.compressImage(imageBase64);
      const base64Data = compressedBase64.split(',')[1] || compressedBase64;

      // 3. 取得模型 (確保使用正確的 SDK 呼叫方式)
      const model = genAI.getGenerativeModel({ 
        model: "gemini-2.0-flash", // 建議使用穩定版名稱
        systemInstruction: "你是一個專精於台灣物流單據的 OCR 專家..." 
      });

      const prompt = "請從圖片中精準擷取物流商與單號。";
      
      const result = await model.generateContent([
        prompt,
        { inlineData: { mimeType: "image/jpeg", data: base64Data } }
      ]);

      const response = await result.response;
      const text = response.text();
      
      // 解析 JSON 並處理
      const parsed = JSON.parse(text.replace(/```json|```/g, '').trim());
      console.log("[AI ERP PIXEL] 辨識成功:", parsed);
      
      return parsed;

    } catch (error: any) {
      console.error("[AI ERP PIXEL] 辨識過程發生致命錯誤:", error);
      throw error;
    }
  }

  // ... 壓縮圖片與其餘方法保持原樣 ...
  
  ngOnDestroy() {
    if (this.unsubscribeConfig) this.unsubscribeConfig();
  }
}
