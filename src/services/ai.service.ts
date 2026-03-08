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

  // 【修復 1】：新增 SuppliersComponent 要求的搜尋方法
  async performWebSearch(query: string): Promise<any> {
    try {
      const genAI = await this.getGenAIInstance();
      const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash" });
      const result = await model.generateContent(query);
      const text = result.response.text();
      
      // 符合 TS2345 的型別要求，將結果存入 Signal
      this.researchResult.set({ text: text, sources: [] });
      return text;
    } catch (error) {
      console.error("搜尋失敗", error);
      throw error;
    }
  }

  // 【修復 2】：管理本地端 API Key 的存取
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

  // 【修復 3】：物流單據辨識與圖片預處理
  async parseLogisticsImage(imageBase64: string, providerOptions: string[] = []): Promise<any> {
    try {
      const genAI = await this.getGenAIInstance();
      const compressed = await this.compressImage(imageBase64);
      const model = genAI.getGenerativeModel({
