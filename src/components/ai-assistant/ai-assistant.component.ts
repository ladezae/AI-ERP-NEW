/**
 * AI 助手元件（重構版）
 *
 * 支援兩種模式：
 * 1. 文字模式 — 傳統聊天介面，使用 AiService (Groq/Llama)
 * 2. 語音模式 — 即時語音對話，使用 AiVoiceService (OpenAI Realtime)
 *
 * 保留功能：
 * - 內部/外部角色切換
 * - 圖片上傳分析（文字模式）
 * - 對話歷史紀錄
 */
import {
  ChangeDetectionStrategy, Component, ElementRef, NgZone,
  OnDestroy, ViewChild, WritableSignal, computed, effect,
  signal, inject
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { SafeHtmlPipe } from '../../pipes/safe-html.pipe';
import { AiService, AiRole } from '../../services/ai.service';
import { AiVoiceService, VoiceSessionState } from '../../services/ai-voice.service';
import { AiTrainingService } from '../../services/ai-training.service';
import { DataService } from '../../services/data.service';
import { ChatMessage } from '../../models/erp.models';

@Component({
  selector: 'app-ai-assistant',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CommonModule, FormsModule, SafeHtmlPipe],
  styles: [`
    @keyframes slide-up {
      from { opacity: 0; transform: translateY(20px) scale(0.95); }
      to { opacity: 1; transform: translateY(0) scale(1); }
    }
    .chat-window-anim {
      animation: slide-up 0.4s cubic-bezier(0.16, 1, 0.3, 1) forwards;
    }
    @keyframes pulse-ring {
      0% { transform: scale(1); opacity: 0.5; }
      100% { transform: scale(1.6); opacity: 0; }
    }
    .pulse-ring {
      animation: pulse-ring 1.5s ease-out infinite;
    }
    @keyframes voice-bar {
      0%, 100% { height: 8px; }
      50% { height: 24px; }
    }
  `],
  templateUrl: './ai-assistant.component.html'
})
export class AiAssistantComponent implements OnDestroy {
  @ViewChild('messageContainer') private messageContainer!: ElementRef;
  @ViewChild('fileInput') private fileInput!: ElementRef;

  // === 注入 Services ===
  aiService = inject(AiService);
  voiceService = inject(AiVoiceService);
  private trainingService = inject(AiTrainingService);
  private dataService = inject(DataService);
  private zone = inject(NgZone);

  // === UI 狀態 ===
  isOpen = signal(false);
  isVoiceMode = signal(false);

  // === 文字模式 ===
  messages: WritableSignal<ChatMessage[]> = signal([]);
  userInput = signal('');
  isLoading = signal(false);
  selectedImage = signal<string | null>(null);

  // === 語音模式 ===
  voiceState = signal<VoiceSessionState>('disconnected');
  voiceTranscript = signal<string>('');       // 使用者說的話（即時轉錄）
  voiceResponseText = signal<string>('');     // AI 回覆文字（累積串流）
  private voiceResponseBuffer = '';            // 用於累積串流文字片段

  // === 角色 ===
  currentRole = computed(() => this.trainingService.currentRole());

  constructor() {
    // 從 DataService 載入歷史訊息
    this.messages.set(this.dataService.chatHistory());

    // 同步 DataService 歷史訊息
    effect(() => {
      const history = this.dataService.chatHistory();
      this.zone.run(() => {
        this.messages.set(history);
      });
    });

    // 自動捲動到最新訊息
    effect(() => {
      if (this.messages().length > 0 && this.isOpen() && !this.isVoiceMode()) {
        this.scrollToBottom();
      }
    });
  }

  // --- 【視窗控制】 ---

  toggleChat(): void {
    this.isOpen.update(open => !open);
    if (!this.isOpen()) {
      // 關閉視窗時停止語音
      if (this.voiceService.isSessionActive()) {
        this.voiceService.stopSession();
      }
    } else if (this.messages().length === 0) {
      this.addMessage('ai', '您好！我是您的 ERP 智能助理\n有什麼我可以幫您的嗎？');
    }
  }

  // --- 【模式切換】 ---

  async toggleVoiceMode(): Promise<void> {
    this.isVoiceMode.update(v => !v);

    if (this.isVoiceMode()) {
      // 進入語音模式：啟動即時語音 session
      await this.startVoiceSession();
    } else {
      // 離開語音模式：停止語音 session
      await this.voiceService.stopSession();
      this.resetVoiceState();
    }
  }

  // --- 【角色切換】 ---

  toggleRole(role: AiRole): void {
    this.trainingService.setRole(role);

    if (role === 'internal') {
      this.addMessage('ai', '已切換為【內部特助模式】。我可以存取所有成本與供應商數據。');
    } else {
      this.addMessage('ai', '已切換為【外部客服模式】。我是客服專員，很高興為您服務！(已遮蔽敏感數據)');
    }

    // 如果語音 session 正在執行，需要重新建立（因為 system prompt 會不同）
    if (this.voiceService.isSessionActive()) {
      this.restartVoiceSession();
    }
  }

  // --- 【語音模式】 ---

  async startVoiceSession(): Promise<void> {
    this.voiceResponseBuffer = '';
    this.voiceTranscript.set('');
    this.voiceResponseText.set('');

    try {
      await this.voiceService.startSession(this.currentRole(), {
        onStateChange: (state) => {
          this.zone.run(() => {
            this.voiceState.set(state);
          });
        },

        onTranscript: (text, isFinal) => {
          this.zone.run(() => {
            this.voiceTranscript.set(text);
            if (isFinal) {
              // 使用者說完一句話，加入聊天記錄
              this.addMessage('user', text);
            }
          });
        },

        onTextResponse: (text) => {
          this.zone.run(() => {
            this.voiceResponseBuffer += text;
            this.voiceResponseText.set(this.voiceResponseBuffer);
          });
        },

        onInterrupted: () => {
          this.zone.run(() => {
            // AI 被打斷，保存已收到的回覆
            if (this.voiceResponseBuffer.trim()) {
              this.addMessage('ai', this.voiceResponseBuffer + '（被打斷）');
            }
            this.voiceResponseBuffer = '';
            this.voiceResponseText.set('');
          });
        },

        onError: (error) => {
          this.zone.run(() => {
            this.voiceState.set('error');
            console.error('[AiAssistant] 語音錯誤:', error);
          });
        }
      });
    } catch (e: any) {
      this.voiceState.set('error');
      console.error('[AiAssistant] 啟動語音失敗:', e);
    }
  }

  /** 停止語音 session 並回到語音待機 */
  async stopVoiceSession(): Promise<void> {
    // 保存未完成的回覆
    if (this.voiceResponseBuffer.trim()) {
      this.addMessage('ai', this.voiceResponseBuffer);
    }

    await this.voiceService.stopSession();
    this.resetVoiceState();
  }

  /** 重啟語音 session（角色切換時用） */
  private async restartVoiceSession(): Promise<void> {
    await this.voiceService.stopSession();
    this.resetVoiceState();
    await this.startVoiceSession();
  }

  private resetVoiceState(): void {
    this.voiceResponseBuffer = '';
    this.voiceTranscript.set('');
    this.voiceResponseText.set('');
    this.voiceState.set('disconnected');
  }

  // --- 【文字模式】 ---

  private getSystemContext(): string {
    return this.trainingService.buildSystemPrompt(this.currentRole());
  }

  async sendMessage(): Promise<void> {
    const text = this.userInput().trim();
    if (!text && !this.selectedImage()) return;

    // 檢查 API Key
    const hasKey = await this.aiService.ensureApiKey();
    if (!hasKey) return;

    this.addMessage('user', text, this.selectedImage() || undefined);
    const imageToSend = this.selectedImage();

    this.userInput.set('');
    this.selectedImage.set(null);
    this.isLoading.set(true);

    try {
      const context = this.getSystemContext();
      const response = await this.aiService.sendMessage(text, imageToSend || undefined, context);
      this.addMessage('ai', response);
    } catch (err) {
      this.addMessage('ai', '抱歉，我現在有點忙不過來，請稍後再試。');
    } finally {
      this.isLoading.set(false);
    }
  }

  // --- 【共用方法】 ---

  addMessage(sender: 'user' | 'ai', text: string, image?: string): void {
    const newMsg: ChatMessage = { sender, text, image, timestamp: new Date().toISOString() };
    this.messages.update(msgs => [...msgs, newMsg]);
    this.dataService.updateChatHistory(this.messages());
  }

  clearHistory(): void {
    if (confirm('確定要清除所有對話紀錄嗎？')) {
      this.dataService.clearChatHistory();
      this.addMessage('ai', '紀錄已清除。有什麼可以幫您的嗎？');
    }
  }

  private scrollToBottom(): void {
    setTimeout(() => {
      if (this.messageContainer) {
        const el = this.messageContainer.nativeElement;
        el.scrollTop = el.scrollHeight;
      }
    }, 100);
  }

  // --- 【圖片上傳】 ---

  triggerImageUpload(): void {
    this.fileInput.nativeElement.click();
  }

  onFileSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    if (input.files && input.files[0]) {
      const file = input.files[0];
      const reader = new FileReader();
      reader.onload = (e) => {
        this.selectedImage.set(e.target?.result as string);
      };
      reader.readAsDataURL(file);
    }
  }

  removeImage(): void {
    this.selectedImage.set(null);
  }

  // --- 【生命週期】 ---

  ngOnDestroy(): void {
    if (this.voiceService.isSessionActive()) {
      this.voiceService.stopSession();
    }
  }
}
