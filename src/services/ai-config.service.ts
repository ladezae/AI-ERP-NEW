/**
 * AI 設定管理服務
 *
 * 負責統一管理所有 AI 引擎的 API Key，
 * 以及 Firestore systemConfig 的即時同步。
 *
 * 支援的引擎：Groq、Gemini、OpenAI
 */
import { Injectable, signal, OnDestroy } from '@angular/core';
import { doc, onSnapshot, getDoc, updateDoc, setDoc } from 'firebase/firestore';
import { db } from '../firebase.config';

/** API Key 設定結構 */
export interface AiApiKeys {
  groq: string;
  gemini: string;
  openai: string;
}

/** Firestore systemConfig/ai 文件結構 */
export interface AiSystemConfig {
  apiKeys: AiApiKeys;
  defaultVoiceEngine: 'gemini' | 'openai';
  systemInstruction: string;
  knowledgeBase: string[];
  role: string;
}

@Injectable({
  providedIn: 'root'
})
export class AiConfigService implements OnDestroy {
  private firestore = db;
  private unsubscribe: any = null;

  /** Firestore 文件路徑 */
  private readonly CONFIG_PATH = 'systemConfig';
  private readonly CONFIG_DOC = 'gemini'; // 沿用現有的 document ID，避免遷移

  // === API Keys ===
  groqKey = signal<string>('');
  geminiKey = signal<string>('');
  openaiKey = signal<string>('');

  // === 預設語音引擎 ===
  defaultVoiceEngine = signal<'gemini' | 'openai'>('gemini');

  // === 連線狀態 ===
  isConnected = signal<boolean>(false);

  constructor() {
    this.subscribeToConfig();
    this.fetchKeys();
  }

  // --- 【取得 API Key】 ---

  /** 取得 Groq API Key（供 ai-text.service 使用） */
  async getGroqKey(): Promise<string> {
    const key = this.groqKey();
    if (key && key.trim()) return key.trim();

    // 嘗試從 Firestore 重新拉取
    await this.fetchKeys();
    const refreshed = this.groqKey();
    if (!refreshed || !refreshed.trim()) {
      throw new Error('Groq API Key 缺失，請至系統設定配置。');
    }
    return refreshed.trim();
  }

  /** 取得 Gemini API Key（供 ai-voice.service 使用） */
  async getGeminiKey(): Promise<string> {
    const key = this.geminiKey();
    if (key && key.trim()) return key.trim();

    await this.fetchKeys();
    const refreshed = this.geminiKey();
    if (!refreshed || !refreshed.trim()) {
      throw new Error('Gemini API Key 缺失，請至系統設定配置。');
    }
    return refreshed.trim();
  }

  /** 取得 OpenAI API Key（供 ai-voice.service 使用） */
  async getOpenaiKey(): Promise<string> {
    const key = this.openaiKey();
    if (key && key.trim()) return key.trim();

    await this.fetchKeys();
    const refreshed = this.openaiKey();
    if (!refreshed || !refreshed.trim()) {
      throw new Error('OpenAI API Key 缺失，請至系統設定配置。');
    }
    return refreshed.trim();
  }

  // --- 【儲存 API Key】 ---

  /** 儲存單一引擎的 API Key 到 Firestore */
  async saveKey(engine: keyof AiApiKeys, key: string): Promise<void> {
    const fieldMap: Record<keyof AiApiKeys, string> = {
      groq: 'apiKey',        // 沿用現有欄位名稱
      gemini: 'geminiApiKey',
      openai: 'openaiApiKey'
    };

    const docRef = doc(this.firestore, this.CONFIG_PATH, this.CONFIG_DOC);
    await updateDoc(docRef, { [fieldMap[engine]]: key.trim() });
  }

  /** 儲存預設語音引擎設定 */
  async saveDefaultVoiceEngine(engine: 'gemini' | 'openai'): Promise<void> {
    const docRef = doc(this.firestore, this.CONFIG_PATH, this.CONFIG_DOC);
    await updateDoc(docRef, { defaultVoiceEngine: engine });
  }

  // --- 【驗證】 ---

  /** 檢查指定引擎的 Key 是否已設定 */
  hasKey(engine: keyof AiApiKeys): boolean {
    const keyMap: Record<keyof AiApiKeys, () => string> = {
      groq: () => this.groqKey(),
      gemini: () => this.geminiKey(),
      openai: () => this.openaiKey()
    };
    const key = keyMap[engine]();
    return !!(key && key.trim().length > 0);
  }

  /** 確保 Groq Key 存在（向下相容，給現有元件用） */
  async ensureGroqKey(): Promise<boolean> {
    if (this.hasKey('groq')) return true;
    await this.fetchKeys();
    return this.hasKey('groq');
  }

  // --- 【內部方法】 ---

  /** 從 Firestore 拉取所有設定 */
  private async fetchKeys(): Promise<void> {
    try {
      const snap = await getDoc(doc(this.firestore, this.CONFIG_PATH, this.CONFIG_DOC));
      if (snap.exists()) {
        const data = snap.data();
        this.applyConfig(data);
        this.isConnected.set(true);
      }
    } catch (e) {
      console.error('[AiConfigService] fetchKeys 失敗:', e);
      this.isConnected.set(false);
    }
  }

  /** 即時監聽 Firestore 設定變更 */
  private subscribeToConfig(): void {
    this.unsubscribe = onSnapshot(
      doc(this.firestore, this.CONFIG_PATH, this.CONFIG_DOC),
      (snap) => {
        if (snap.exists()) {
          this.applyConfig(snap.data());
          this.isConnected.set(true);
        }
      },
      (error) => {
        console.error('[AiConfigService] 監聽失敗:', error);
        this.isConnected.set(false);
      }
    );
  }

  /** 將 Firestore 資料套用到 signals */
  private applyConfig(data: any): void {
    // Groq Key（沿用現有欄位 'apiKey'）
    if (data['apiKey']) {
      this.groqKey.set(data['apiKey'].trim());
    }
    // Gemini Key
    if (data['geminiApiKey']) {
      this.geminiKey.set(data['geminiApiKey'].trim());
    }
    // OpenAI Key
    if (data['openaiApiKey']) {
      this.openaiKey.set(data['openaiApiKey'].trim());
    }
    // 預設語音引擎
    if (data['defaultVoiceEngine']) {
      this.defaultVoiceEngine.set(data['defaultVoiceEngine']);
    }
  }

  ngOnDestroy(): void {
    if (this.unsubscribe) this.unsubscribe();
  }
}
