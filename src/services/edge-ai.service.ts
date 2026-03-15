/**
 * @deprecated 已棄用。
 * - 語音功能已遷移至 AiVoiceService（OpenAI Realtime）
 * - 商品摘要功能已遷移至 AiService（Groq/Llama）
 * 此檔案保留為空殼，避免其他地方殘留 import 導致編譯錯誤。
 * 待確認無引用後可安全刪除。
 */
import { Injectable, signal } from '@angular/core';

@Injectable({
  providedIn: 'root'
})
export class EdgeAiService {
  isAvailable = signal(false);

  async generateText(_prompt: string): Promise<string> {
    return '';
  }

  async summarizeProduct(_name: string, _notes: string): Promise<string> {
    return '';
  }
}
