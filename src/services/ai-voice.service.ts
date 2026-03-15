/**
 * AI 即時語音對話服務
 *
 * 使用 OpenAI Realtime API（GPT-4o）實現即時語音對話。
 * 一體式設計：AI 引擎同時處理 STT + 推理 + TTS，延遲最低。
 *
 * 架構：
 * - 麥克風音訊 → PCM16 24kHz → WebSocket → OpenAI GPT-4o → PCM16 音訊回傳 → 喇叭播放
 * - 透過 AiTrainingService 取得三層 prompt（人設 + 知識庫 + 即時數據）
 *
 * 音訊格式：輸入/輸出皆 PCM16 24kHz mono
 */
import { Injectable, inject, signal, OnDestroy } from '@angular/core';
import { AiConfigService } from './ai-config.service';
import { AiTrainingService, AiRole } from './ai-training.service';

// === 型別定義 ===

export type VoiceSessionState = 'disconnected' | 'connecting' | 'connected' | 'listening' | 'speaking' | 'error';

/** 語音事件回呼 */
export interface VoiceCallbacks {
  /** 連線狀態變更 */
  onStateChange?: (state: VoiceSessionState) => void;
  /** 使用者語音轉文字（Whisper 即時轉錄） */
  onTranscript?: (text: string, isFinal: boolean) => void;
  /** AI 回覆的文字內容 */
  onTextResponse?: (text: string) => void;
  /** AI 回覆的音訊資料 */
  onAudioResponse?: (audioData: ArrayBuffer) => void;
  /** AI 被使用者打斷 */
  onInterrupted?: () => void;
  /** 錯誤 */
  onError?: (error: string) => void;
}

// === 音訊常數 ===
const SAMPLE_RATE = 24000;   // OpenAI Realtime 統一 24kHz
const AUDIO_CHANNELS = 1;    // mono

@Injectable({
  providedIn: 'root'
})
export class AiVoiceService implements OnDestroy {
  private configService = inject(AiConfigService);
  private trainingService = inject(AiTrainingService);

  // === 狀態 Signals ===
  sessionState = signal<VoiceSessionState>('disconnected');
  isSessionActive = signal<boolean>(false);

  // === WebSocket ===
  private ws: WebSocket | null = null;
  private callbacks: VoiceCallbacks = {};

  // === 音訊處理 ===
  private audioContext: AudioContext | null = null;
  private mediaStream: MediaStream | null = null;
  private mediaStreamSource: MediaStreamAudioSourceNode | null = null;
  private scriptProcessor: ScriptProcessorNode | null = null;
  private playbackQueue: ArrayBuffer[] = [];
  private isPlayingAudio = false;

  // === OpenAI Realtime 設定 ===
  private readonly WS_URL = 'wss://api.openai.com/v1/realtime';
  private readonly MODEL = 'gpt-4o-mini-realtime-preview';
  private readonly VOICE = 'alloy'; // 可選：alloy, echo, fable, onyx, nova, shimmer

  // --- 【Session 管理】 ---

  /**
   * 開始語音對話 session
   * @param role 角色（internal / external）— 決定 AI 能看到哪些數據
   * @param callbacks 事件回呼
   */
  async startSession(role: AiRole, callbacks: VoiceCallbacks = {}): Promise<void> {
    if (this.isSessionActive()) {
      console.warn('[AiVoiceService] Session 已在執行中');
      return;
    }

    this.callbacks = callbacks;
    this.updateState('connecting');

    try {
      // 1. 取得麥克風權限
      await this.initAudio();

      // 2. 建構 system prompt（三層：人設 + 知識庫 + 即時數據）
      const systemPrompt = this.trainingService.buildSystemPrompt(role);

      // 3. 建立 WebSocket 連線
      await this.connect(systemPrompt);
    } catch (error: any) {
      this.updateState('error');
      this.callbacks.onError?.(error.message || '語音連線失敗');
      await this.stopSession();
    }
  }

  /** 結束語音對話 session */
  async stopSession(): Promise<void> {
    // 關閉 WebSocket
    if (this.ws) {
      if (this.ws.readyState === WebSocket.OPEN) {
        this.ws.close(1000, '使用者結束語音對話');
      }
      this.ws = null;
    }

    // 釋放音訊資源
    this.destroyAudio();

    // 重設狀態
    this.playbackQueue = [];
    this.isPlayingAudio = false;
    this.isSessionActive.set(false);
    this.updateState('disconnected');
  }

  /** 在語音 session 中穿插文字訊息 */
  sendTextMessage(text: string): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      console.warn('[AiVoiceService] WebSocket 未連線，無法發送文字');
      return;
    }

    this.ws.send(JSON.stringify({
      type: 'conversation.item.create',
      item: {
        type: 'message',
        role: 'user',
        content: [{ type: 'input_text', text }]
      }
    }));
    this.ws.send(JSON.stringify({ type: 'response.create' }));
  }

  // --- 【WebSocket 連線】 ---

  private async connect(systemPrompt: string): Promise<void> {
    const apiKey = await this.configService.getOpenaiKey();
    const url = `${this.WS_URL}?model=${this.MODEL}`;

    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(url, [
        'realtime',
        `openai-insecure-api-key.${apiKey}`,
        'openai-beta.realtime-v1'
      ]);

      this.ws.onopen = () => {
        // 連線成功後立即發送 session 設定
        const sessionConfig = {
          type: 'session.update',
          session: {
            modalities: ['text', 'audio'],
            instructions: systemPrompt,
            voice: this.VOICE,
            input_audio_format: 'pcm16',
            output_audio_format: 'pcm16',
            input_audio_transcription: {
              model: 'whisper-1'
            },
            turn_detection: {
              type: 'server_vad',    // 伺服器端語音活動偵測
              threshold: 0.5,         // VAD 靈敏度
              prefix_padding_ms: 300, // 語音前保留毫秒
              silence_duration_ms: 500 // 靜默多久判定說完
            }
          }
        };

        this.ws!.send(JSON.stringify(sessionConfig));
      };

      this.ws.onmessage = (event: MessageEvent) => {
        try {
          const data = JSON.parse(event.data);
          this.handleMessage(data, resolve);
        } catch (e) {
          console.error('[AiVoiceService] 訊息解析失敗:', e);
        }
      };

      this.ws.onerror = (error) => {
        console.error('[AiVoiceService] WebSocket 錯誤:', error);
        reject(new Error('OpenAI Realtime 連線失敗，請檢查 API Key'));
      };

      this.ws.onclose = (event) => {
        console.log('[AiVoiceService] WebSocket 關閉:', event.code, event.reason);
        if (this.isSessionActive()) {
          this.stopSession();
          this.callbacks.onError?.('語音連線已中斷');
        }
      };
    });
  }

  // --- 【訊息處理】 ---

  private handleMessage(data: any, onReady?: (value: void) => void): void {
    switch (data.type) {
      // === Session 就緒 ===
      case 'session.created':
      case 'session.updated':
        this.updateState('connected');
        this.isSessionActive.set(true);
        this.startMicrophoneCapture();
        onReady?.();
        break;

      // === AI 回覆音訊（串流，逐片段） ===
      case 'response.audio.delta':
        this.updateState('speaking');
        if (data.delta) {
          const audioBytes = this.base64ToArrayBuffer(data.delta);
          this.callbacks.onAudioResponse?.(audioBytes);
          this.enqueueAudio(audioBytes);
        }
        break;

      // === AI 回覆音訊結束 ===
      case 'response.audio.done':
        // 等播放佇列播完再切回 listening
        this.waitForPlaybackDone().then(() => {
          if (this.sessionState() === 'speaking') {
            this.updateState('listening');
          }
        });
        break;

      // === AI 回覆的文字 transcript（逐字串流） ===
      case 'response.audio_transcript.delta':
        if (data.delta) {
          this.callbacks.onTextResponse?.(data.delta);
        }
        break;

      // === 使用者語音轉文字完成 ===
      case 'conversation.item.input_audio_transcription.completed':
        if (data.transcript) {
          this.callbacks.onTranscript?.(data.transcript, true);
        }
        break;

      // === 使用者開始說話（打斷 AI） ===
      case 'input_audio_buffer.speech_started':
        this.stopPlayback();
        this.callbacks.onInterrupted?.();
        this.updateState('listening');
        break;

      // === 錯誤 ===
      case 'error':
        console.error('[AiVoiceService] OpenAI 錯誤:', data.error);
        this.callbacks.onError?.(data.error?.message || 'OpenAI Realtime 發生錯誤');
        break;
    }
  }

  // --- 【麥克風音訊擷取】 ---

  private async initAudio(): Promise<void> {
    this.audioContext = new AudioContext({ sampleRate: SAMPLE_RATE });

    this.mediaStream = await navigator.mediaDevices.getUserMedia({
      audio: {
        channelCount: AUDIO_CHANNELS,
        sampleRate: SAMPLE_RATE,
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true
      }
    });
  }

  private startMicrophoneCapture(): void {
    if (!this.audioContext || !this.mediaStream) return;

    this.mediaStreamSource = this.audioContext.createMediaStreamSource(this.mediaStream);

    // 使用 ScriptProcessorNode 擷取原始 PCM 資料
    // 注意：未來可改用 AudioWorklet 以獲得更好的效能
    const bufferSize = 4096;
    this.scriptProcessor = this.audioContext.createScriptProcessor(bufferSize, AUDIO_CHANNELS, AUDIO_CHANNELS);

    this.scriptProcessor.onaudioprocess = (event: AudioProcessingEvent) => {
      if (!this.isSessionActive() || !this.ws || this.ws.readyState !== WebSocket.OPEN) return;

      const inputData = event.inputBuffer.getChannelData(0);
      const pcm16 = this.float32ToPcm16(inputData);
      const base64Audio = this.arrayBufferToBase64(pcm16.buffer);

      this.ws.send(JSON.stringify({
        type: 'input_audio_buffer.append',
        audio: base64Audio
      }));
    };

    this.mediaStreamSource.connect(this.scriptProcessor);
    this.scriptProcessor.connect(this.audioContext.destination);

    this.updateState('listening');
  }

  private destroyAudio(): void {
    this.stopPlayback();

    if (this.scriptProcessor) {
      this.scriptProcessor.disconnect();
      this.scriptProcessor = null;
    }
    if (this.mediaStreamSource) {
      this.mediaStreamSource.disconnect();
      this.mediaStreamSource = null;
    }
    if (this.mediaStream) {
      this.mediaStream.getTracks().forEach(track => track.stop());
      this.mediaStream = null;
    }
    if (this.audioContext && this.audioContext.state !== 'closed') {
      this.audioContext.close();
      this.audioContext = null;
    }
  }

  // --- 【音訊播放】 ---

  private enqueueAudio(pcm16Data: ArrayBuffer): void {
    this.playbackQueue.push(pcm16Data);
    if (!this.isPlayingAudio) {
      this.playNextAudio();
    }
  }

  private async playNextAudio(): Promise<void> {
    if (this.playbackQueue.length === 0) {
      this.isPlayingAudio = false;
      return;
    }

    this.isPlayingAudio = true;
    const pcm16Data = this.playbackQueue.shift()!;

    const playbackCtx = new AudioContext({ sampleRate: SAMPLE_RATE });
    const int16Array = new Int16Array(pcm16Data);
    const float32Array = this.pcm16ToFloat32(int16Array);

    const audioBuffer = playbackCtx.createBuffer(AUDIO_CHANNELS, float32Array.length, SAMPLE_RATE);
    audioBuffer.getChannelData(0).set(float32Array);

    const source = playbackCtx.createBufferSource();
    source.buffer = audioBuffer;
    source.connect(playbackCtx.destination);

    source.onended = () => {
      playbackCtx.close();
      this.playNextAudio();
    };

    source.start();
  }

  private stopPlayback(): void {
    this.playbackQueue = [];
    this.isPlayingAudio = false;
  }

  /** 等待播放佇列清空 */
  private waitForPlaybackDone(): Promise<void> {
    return new Promise((resolve) => {
      const check = () => {
        if (!this.isPlayingAudio && this.playbackQueue.length === 0) {
          resolve();
        } else {
          setTimeout(check, 100);
        }
      };
      check();
    });
  }

  // --- 【工具方法】 ---

  /** Float32 (-1.0 ~ 1.0) 轉 PCM16 (Int16) */
  private float32ToPcm16(float32Array: Float32Array): Int16Array {
    const pcm16 = new Int16Array(float32Array.length);
    for (let i = 0; i < float32Array.length; i++) {
      const sample = Math.max(-1, Math.min(1, float32Array[i]));
      pcm16[i] = sample < 0 ? sample * 0x8000 : sample * 0x7FFF;
    }
    return pcm16;
  }

  /** PCM16 (Int16) 轉 Float32 (-1.0 ~ 1.0) */
  private pcm16ToFloat32(int16Array: Int16Array): Float32Array {
    const float32 = new Float32Array(int16Array.length);
    for (let i = 0; i < int16Array.length; i++) {
      float32[i] = int16Array[i] / (int16Array[i] < 0 ? 0x8000 : 0x7FFF);
    }
    return float32;
  }

  /** ArrayBuffer 轉 Base64 */
  private arrayBufferToBase64(buffer: ArrayBuffer): string {
    const bytes = new Uint8Array(buffer);
    let binary = '';
    for (let i = 0; i < bytes.length; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary);
  }

  /** Base64 轉 ArrayBuffer */
  private base64ToArrayBuffer(base64: string): ArrayBuffer {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    return bytes.buffer;
  }

  /** 更新狀態並通知回呼 */
  private updateState(state: VoiceSessionState): void {
    this.sessionState.set(state);
    this.callbacks.onStateChange?.(state);
  }

  ngOnDestroy(): void {
    this.stopSession();
  }
}
