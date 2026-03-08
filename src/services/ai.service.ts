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

  // 【新增：解決 AiTrainingComponent 報錯】
  async updateConfiguration(systemInstruction: string): Promise<void> {
    try {
      const docRef = doc(this.firestore, 'systemConfig', 'gemini');
      await updateDoc(docRef, { systemInstruction });
    } catch (error) { throw error; }
  }

  // 【新增：解決 DefinitionsComponent 報錯】
  // 調整為可接收多個參數以解決 TS2554
  async generateFormulaFromLogic(logic: string, category?: string, image?: string): Promise<string> {
    try {
      const genAI = await this.getGenAIInstance();
      const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash" });
      const prompt = `邏輯: ${logic}${category ? `，類別: ${category}` : ''}`;
      const result = await model.generateContent(prompt);
      return result.response.text();
    } catch (error) { throw error; }
  }

  // 【補齊：其他所有組件所需方法】
  async generateBusinessInsight(context: any): Promise<string> {
    const genAI = await this.getGenAIInstance();
    const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash" });
    const result = await model.generateContent(JSON.stringify(context));
    return result.response.text();
  }

  async sendMessage(prompt: string): Promise<string> {
    const genAI = await this.getGenAIInstance();
    const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash" });
    const result = await model.generateContent(prompt);
    return result.response.text();
  }

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
    const text = result.response.text();
    this.researchResult.set({ text, sources: [] });
    return text;
  }

  async parseLogisticsImage(imageBase64: string, providerOptions: string[] = []): Promise<any> {
    const genAI = await this.getGenAIInstance();
    const compressed = await this.compressImage(imageBase64);
    const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash" });
    const result = await model.generateContent(["辨識單據", { inlineData: { mimeType: "image/jpeg", data: compressed.split(',')[1] } }]);
    return JSON.parse(result.response.text().replace(/```json|```/g, '').trim());
  }

  // 基礎管理方法
  getStoredKey(): string | null { return localStorage.getItem('gemini_api_key'); }
  async ensureApiKey(): Promise<boolean> { 
    const key = this.getStoredKey() || await this.fetchSharedKey();
    return !!(key && key.trim().length > 0);
  }

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
    onSnapshot(doc(this.firestore, 'systemConfig', 'gemini'), (snap) => {
      if (snap.exists() && snap.data()['apiKey']) this.sharedKey.set(snap.data()['apiKey'].trim());
    });
  }

  async fetchSharedKey(): Promise<string | null> {
    const snap = await getDoc(doc(this.firestore, 'systemConfig', 'gemini'));
    if (snap.exists() && snap.data()['apiKey']) {
      this.sharedKey.set(snap.data()['apiKey'].trim());
      return snap.data()['apiKey'].trim();
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
