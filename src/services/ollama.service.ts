/**
 * Ollama 本地 AI 服務
 * 連線本地 Ollama (Qwen2.5:7b) 產生短版商品文案
 */
import { Injectable, signal } from '@angular/core';

@Injectable({
  providedIn: 'root'
})
export class OllamaService {
  /** Ollama API 位址 */
  private readonly OLLAMA_ENDPOINT = 'http://localhost:11434';
  /** 預設模型 */
  private readonly DEFAULT_MODEL = 'qwen2.5:7b';

  /** 連線狀態 */
  connectionStatus = signal<'idle' | 'connecting' | 'connected' | 'error'>('idle');
  /** 錯誤訊息 */
  lastError = signal<string>('');
  /** 是否正在生成 */
  isGenerating = signal(false);

  /**
   * 檢查 Ollama 是否在線
   */
  async checkConnection(): Promise<boolean> {
    this.connectionStatus.set('connecting');
    try {
      const res = await fetch(`${this.OLLAMA_ENDPOINT}/api/tags`, {
        method: 'GET',
        signal: AbortSignal.timeout(5000)
      });
      if (res.ok) {
        this.connectionStatus.set('connected');
        return true;
      }
      this.connectionStatus.set('error');
      this.lastError.set('Ollama 回應異常');
      return false;
    } catch {
      this.connectionStatus.set('error');
      this.lastError.set('無法連線 Ollama，請確認已啟動');
      return false;
    }
  }

  /**
   * 產生指定字數的商品文案
   * @param productName 商品名稱
   * @param charLimit 目標字數 (10/20/30/50)
   */
  async generateCopy(productName: string, charLimit: number): Promise<string> {
    this.isGenerating.set(true);
    try {
      const prompt = `你是台灣水果乾品牌「一吉」的電商文案寫手。
請根據商品名稱撰寫一段商品文案。

商品名稱：${productName}

要求：
1. 繁體中文
2. 字數嚴格控制在 ${charLimit} 字以內（含標點）
3. 突出口感、健康、天然等賣點
4. 適合電商平台使用
5. 只回覆文案本身，不要加引號或其他說明`;

      const res = await fetch(`${this.OLLAMA_ENDPOINT}/api/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: this.DEFAULT_MODEL,
          prompt,
          stream: false,
          options: { temperature: 0.7, num_predict: 256 }
        })
      });
      if (!res.ok) throw new Error(`Ollama 錯誤: ${res.status}`);
      const data = await res.json();
      return (data.response || '').trim();
    } catch (e: any) {
      this.lastError.set(e.message || '生成失敗');
      throw e;
    } finally {
      this.isGenerating.set(false);
    }
  }
}
