
// Force re-compilation to fix dynamic import error
import { ChangeDetectionStrategy, Component, ElementRef, NgZone, OnDestroy, ViewChild, WritableSignal, computed, effect, signal, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { SafeHtmlPipe } from '../../pipes/safe-html.pipe';
import { AiService, AiRole } from '../../services/ai.service';
import { DataService } from '../../services/data.service';
import { ChatMessage } from '../../models/erp.models';

// Helper to get SpeechRecognition safely
function getSpeechRecognition() {
  if (typeof window === 'undefined') return null;
  return (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
}

const SpeechRecognition = getSpeechRecognition();

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
    .voice-wave {
      animation: wave 1.5s infinite ease-in-out;
    }
    @keyframes wave {
      0%, 100% { transform: scale(1); opacity: 0.5; }
      50% { transform: scale(1.1); opacity: 0.2; }
    }
  `],
  templateUrl: './ai-assistant.component.html'
})
export class AiAssistantComponent implements OnDestroy {
  @ViewChild('messageContainer') private messageContainer!: ElementRef;
  @ViewChild('fileInput') private fileInput!: ElementRef;

  aiService = inject(AiService);
  private dataService = inject(DataService);
  private zone = inject(NgZone);

  isOpen = signal(false);
  isVoiceMode = signal(false); 
  
  messages: WritableSignal<ChatMessage[]> = signal([]);
  userInput = signal('');
  
  isLoading = signal(false);
  isListening = signal(false);
  isSpeaking = signal(false); 
  
  selectedImage = signal<string | null>(null);

  private recognition: any | null = null;
  private synth: SpeechSynthesis | null = typeof window !== 'undefined' ? window.speechSynthesis : null;
  private currentUtterance: SpeechSynthesisUtterance | null = null;
  private availableVoices: SpeechSynthesisVoice[] = [];
  
  hasSpeechRecognition = computed(() => !!SpeechRecognition);

  constructor() {
    // Initialize messages from persisted DataService history
    this.messages.set(this.dataService.chatHistory());

    if (this.hasSpeechRecognition()) {
      this.recognition = new SpeechRecognition();
      this.recognition.continuous = false;
      this.recognition.lang = 'zh-TW';
      this.recognition.interimResults = false;
      this.recognition.maxAlternatives = 1;

      this.recognition.onstart = () => {
        this.zone.run(() => {
          this.isListening.set(true);
          this.stopSpeaking();
        });
      };

      this.recognition.onresult = (event: any) => {
        const transcript = event.results[0][0].transcript;
        this.zone.run(() => {
          this.userInput.set(transcript);
          if (this.isVoiceMode()) {
            setTimeout(() => this.sendMessage(), 800); 
          }
        });
      };

      this.recognition.onspeechend = () => {
         this.zone.run(() => this.isListening.set(false));
      };
      
      this.recognition.onend = () => {
        this.zone.run(() => this.isListening.set(false));
      };
      
      this.recognition.onerror = (event: any) => {
         console.error('Speech recognition error:', event.error);
         this.zone.run(() => this.isListening.set(false));
      };
    }
    
    this.loadVoices();
    if (this.synth) {
       this.synth.onvoiceschanged = () => {
         this.loadVoices();
       };
    }
    
    // Auto-scroll effect
    effect(() => {
        if(this.messages().length > 0 && this.isOpen() && !this.isVoiceMode()) {
            this.scrollToBottom();
        }
    });

    // Sync messages from DataService
    effect(() => {
      const history = this.dataService.chatHistory();
      this.zone.run(() => {
        this.messages.set(history);
      });
    });
  }

  loadVoices() {
    if (!this.synth) return;
    setTimeout(() => {
        this.availableVoices = this.synth.getVoices();
    }, 100);
  }

  toggleChat(): void {
    this.isOpen.update(open => !open);
    if (!this.isOpen()) {
      this.stopSpeaking();
      this.stopListening();
    } else if (this.messages().length === 0) {
      this.addMessage('ai', "您好！我是您的 Gemini ERP 智能助理 😊\n有什麼我可以幫您的嗎？您可以問我庫存狀況，或者上傳照片讓我看看喔！");
    }
  }
  
  toggleVoiceMode(): void {
    this.isVoiceMode.update(v => !v);
    if (this.isVoiceMode()) {
      this.stopSpeaking();
    } else {
      this.stopListening();
      this.stopSpeaking();
    }
  }

  toggleRole(role: AiRole): void {
      this.aiService.setRole(role);
      // Don't clear history on role toggle, just announce change
      if (role === 'internal') {
          this.addMessage('ai', '已切換為【內部特助模式】。我可以存取所有成本與供應商數據。');
      } else {
          this.addMessage('ai', '已切換為【外部客服模式】。我是客服專員，很高興為您服務！(已遮蔽敏感數據)');
      }
  }

  private getSystemContext(): string {
    const role = this.aiService.currentRole();
    const products = this.dataService.products();
    const metrics = this.dataService.businessMetrics(); 
    
    // NEW: Inject Calculated Values Directly
    const definitions = this.dataService.metricDefinitions();
    // Only calculate unlocked/safe definitions or all if internal
    const calculatedStats = definitions.map(def => {
        const val = this.dataService.evaluateFormula(def.formula);
        return `- ${def.fieldTw} (${def.fieldEn}): ${val}`;
    }).join('\n');

    // 共同數據：公開產品資訊
    const publicProducts = products.map(p => ({
        name: p.name,
        category: p.category,
        price: p.priceAfterTax,
        stockStatus: role === 'internal' ? p.stock : (p.stock > 0 ? '有現貨' : '缺貨'), 
        sugar: p.sugar ? '有糖' : '無糖'
    }));

    if (role === 'external') {
        // --- 外部客服 Context ---
        return `
        【系統公開數據快照 (客戶視角)】
        - 商品列表: ${JSON.stringify(publicProducts)}
        
        (注意：您是外部客服，請勿透露具體庫存數量，僅告知有或無。若客戶詢問敏感數據，請婉拒。)
        `;
    } else {
        // --- 內部特助 Context ---
        const internalProducts = products.map(p => ({
            id: p.id,
            name: p.name,
            stock: p.stock,
            safety: p.safetyStock,
            transit: p.transitQuantity, // Added transit quantity
            cost: p.costBeforeTax,
            supplier: p.supplierName,
            sugar: p.sugar ? '有糖' : '無糖'
        }));

        return `
        【📊 即時計算指標 (Defined Metrics)】
        ${calculatedStats}

        【📊 戰情中心數據 (Cheat Sheet - Snapshot)】
        * 本月營收: $${metrics.revenue.currentMonth} (年度累計: $${metrics.revenue.totalYear})
        * 訂單狀態: 今日新增 ${metrics.orders.todayCount} 筆, 處理中 ${metrics.orders.pendingCount} 筆
        * 庫存警示: ⚠️ ${metrics.inventory.lowStockCount} 項商品低於安全水位, ⛔ ${metrics.inventory.outOfStockCount} 項缺貨
        * 生產進度: 進行中代工單 ${metrics.manufacturing.activeOrders} 筆
        * 數據更新時間: ${metrics.lastUpdated}

        【系統內部數據詳情 (管理員視角)】
        - 商品完整列表: ${JSON.stringify(internalProducts)}
        
        (注意：您是內部特助，請優先參考【即時計算指標】的數值回答問題，這些是經過系統公式精確計算的結果。)
        `;
    }
  }

  async sendMessage() {
    const text = this.userInput().trim();
    if (!text && !this.selectedImage()) return;

    // Check for API Key first
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
        
        if (this.isVoiceMode()) {
            this.speakResponse(response);
        }

    } catch (err) {
        this.addMessage('ai', '抱歉，我現在有點忙不過來，請稍後再試。');
    } finally {
        this.isLoading.set(false);
    }
  }

  addMessage(sender: 'user' | 'ai', text: string, image?: string) {
    const newMsg: ChatMessage = { sender, text, image, timestamp: new Date().toISOString() };
    this.messages.update(msgs => [...msgs, newMsg]);
    // Save to persistence
    this.dataService.updateChatHistory(this.messages());
  }

  clearHistory() {
      if (confirm('確定要清除所有對話紀錄嗎？')) {
          this.dataService.clearChatHistory();
          // Re-add welcome message
          this.addMessage('ai', "紀錄已清除。我是您的 Gemini ERP 智能助理，有什麼可以幫您的嗎？");
      }
  }

  private scrollToBottom() {
    setTimeout(() => {
      if (this.messageContainer) {
        const el = this.messageContainer.nativeElement;
        el.scrollTop = el.scrollHeight;
      }
    }, 100);
  }

  triggerImageUpload() {
    this.fileInput.nativeElement.click();
  }

  onFileSelected(event: Event) {
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

  removeImage() {
    this.selectedImage.set(null);
  }

  ngOnDestroy() {
    this.stopSpeaking();
    this.stopListening();
  }

  speakResponse(text: string) {
    if (!this.synth) return;
    this.stopSpeaking();
    this.isSpeaking.set(true);

    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = 'zh-TW';
    
    const voice = this.availableVoices.find(v => v.lang.includes('TW') || v.lang.includes('zh'));
    if (voice) utterance.voice = voice;

    utterance.onend = () => {
      this.zone.run(() => this.isSpeaking.set(false));
    };
    
    utterance.onerror = () => {
        this.zone.run(() => this.isSpeaking.set(false));
    };

    this.currentUtterance = utterance;
    this.synth.speak(utterance);
  }

  stopSpeaking() {
    if (this.synth) {
      this.synth.cancel();
      this.isSpeaking.set(false);
      this.currentUtterance = null;
    }
  }

  toggleListening() {
    if (!this.recognition) {
        alert('您的瀏覽器不支援語音識別。');
        return;
    }

    if (this.isListening()) {
        this.stopListening();
    } else {
        try {
            this.recognition.start();
        } catch(e) {
            console.error(e);
        }
    }
  }

  stopListening() {
      if (this.recognition) {
          this.recognition.stop();
      }
      this.isListening.set(false);
  }
}
