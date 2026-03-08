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

  // 【核心修復 1】：補齊缺失的 saveKeyToStorage 方法
  saveKeyToStorage(key: string): boolean {
    try {
      if (!key) return false;
      localStorage.setItem('gemini_api_key', key.trim());
      console.log('🔑 [AI ERP] API Key 已儲存至本地瀏覽器。');
      return true;
    } catch (e) {
      console.error('儲存 Key 失敗', e);
      return false;
    }
  }

  // 【核心修復 2】：補齊缺失的 clearStoredKey 方法
  clearStoredKey(): void {
    localStorage.removeItem('gemini_api_key');
    console.log('🗑️ [AI ERP] 本地 Key 已清除。');
  }

  // 【核心修復 3】：補齊圖片壓縮方法，避免之前的編譯錯誤
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
      } catch (e) {
        return null;
      }
    })();
    return this.sharedKeyPromise;
  }

  // 確保 getGenAIInstance 與 parseLogisticsImage 邏輯正確
  private async getGenAIInstance(): Promise<GoogleGenerativeAI> {
    let apiKey = localStorage.getItem('gemini_api_key') || await this.fetchSharedKey();
    if (!apiKey) {
      const win = window as any;
      apiKey = win.GEMINI_API_KEY || win.API_KEY;
    }
    if (!apiKey) throw new Error("找不到 API Key");
    return new GoogleGenerativeAI(apiKey.trim());
  }

  ngOnDestroy() {
    if (this.unsubscribeConfig) this.unsubscribeConfig();
  }
}
