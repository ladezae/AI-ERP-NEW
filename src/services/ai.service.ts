import { Injectable, signal, OnDestroy, inject } from '@angular/core';
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

  constructor() {
    this.subscribeToConfigurationChanges();
    this.fetchSharedKey();
  }

  // --- 【1. 基礎管理功能】 修復 SystemComponent 報錯 ---
  getStoredKey(): string | null { 
    return localStorage.getItem('gemini_api_key'); 
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

  async ensureApiKey(): Promise<boolean> { 
    const key = this.getStoredKey() || await this.fetchSharedKey();
    return !!(key && key.trim().length > 0);
  }

  // --- 【2. 核心 AI 方法】 修復各組件缺失方法 ---
  async updateConfiguration(systemInstruction: string): Promise<void> {
    const docRef = doc(this.firestore, 'systemConfig', 'gemini');
    await updateDoc(docRef, { systemInstruction });
  }

  async generateFormulaFromLogic(logic: string, category?: string, image?: string): Promise<string> {
    const genAI = await this.getGenAIInstance();
    const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash" });
    const result = await model.generateContent(`邏輯: ${logic}, 類別: ${category}`);
    return result.response.text();
  }

  async sendMessage(prompt: string): Promise<string> {
    const genAI = await this.getGenAIInstance();
    const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash" });
    const result = await model.generateContent(prompt);
    return result.response.text();
  }

  async parseLogisticsImage(imageBase64: string, providerOptions: string[] = []): Promise<any> {
    const genAI = await this.getGenAIInstance();
    const compressed = await this.compressImage(imageBase64);
    const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash" });
    const result = await model.generateContent(["辨識單據", { inlineData: { mimeType: "image/jpeg", data: compressed.split(',')[1] } }]);
    return JSON.parse(result.response.text().replace(/```json|```/g, '').trim());
  }

  // --- 【3. 輔助與監聽邏輯】 ---
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
      if (snap.exists() && snap.data()['apiKey']) this.sharedKey.set(snap.data()['apiKey'].trim());
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
