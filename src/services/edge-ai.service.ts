
import { Injectable, signal } from '@angular/core';

declare global {
  interface Window {
    ai?: {
      languageModel?: {
        create(options?: any): Promise<any>;
        capabilities(): Promise<any>;
      };
    };
  }
}

@Injectable({
  providedIn: 'root'
})
export class EdgeAiService {
  isAvailable = signal(false);
  model: any = null;

  constructor() {
    this.checkAvailability();
  }

  async checkAvailability() {
    if (typeof window !== 'undefined' && window.ai?.languageModel) {
      try {
        const capabilities = await window.ai.languageModel.capabilities();
        if (capabilities.available === 'readily') {
          this.isAvailable.set(true);
        } else if (capabilities.available === 'after-download') {
          console.log('Gemini Nano needs to be downloaded...');
          // In a real app, we might trigger download or notify user
          this.isAvailable.set(false);
        }
      } catch (e) {
        console.warn('Error checking Gemini Nano capabilities', e);
        this.isAvailable.set(false);
      }
    }
  }

  async generateText(prompt: string): Promise<string> {
    if (!this.isAvailable()) {
      return '';
    }

    try {
      if (!this.model) {
        this.model = await window.ai!.languageModel!.create({
          systemPrompt: '你是一位專業的電商文案助手，擅長用簡短、吸引人的繁體中文介紹商品。'
        });
      }

      const result = await this.model.prompt(prompt);
      return result;
    } catch (e) {
      console.error('Edge AI Generation Error:', e);
      return '';
    }
  }

  async summarizeProduct(productName: string, notes: string): Promise<string> {
    if (!this.isAvailable()) return notes;
    
    const prompt = `請用簡短的一句話介紹這個商品，適合展示給客戶看：
    商品名稱：${productName}
    描述：${notes}`;
    
    return this.generateText(prompt);
  }
}
