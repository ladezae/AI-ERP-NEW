
import { Injectable, signal, OnDestroy, inject } from '@angular/core';
import { doc, setDoc, onSnapshot, Unsubscribe, getDoc } from 'firebase/firestore';
import { db } from '../firebase.config';
import { DataService } from './data.service';
import { GoogleGenAI, Type, GenerateContentResponse } from "@google/genai";

export type AiRole = 'internal' | 'external';

@Injectable({
  providedIn: 'root'
})
export class AiService implements OnDestroy {
  private unsubscribeConfig: Unsubscribe | null = null;
  private firestore = db;
  
  // Inject DataService to log usage
  private dataService = inject(DataService);
  
  // 目前的角色狀態
  currentRole = signal<AiRole>('internal');

  // --- AI Configuration State ---
  // 1. 內部特助 Persona (Default)
  private readonly internalInstruction = `您是「公司大平台」的專屬內部 AI 智慧特助。
  - 對象：您正在與公司內部的管理員或員工對話。
  - 核心指令：
    1. **口語化與語助詞**：請大量使用自然的台灣口語和語助詞（例如：「喔」、「呀」、「呢」、「吧」、「對了」）。
    2. **數據權限**：您可以存取並分析所有內部數據（包含成本、毛利、供應商資訊）。
    3. **任務**：協助查庫存、分析營收、追蹤採購單、撰寫內部信件。
    4. **情感**：像個活潑好相處的同事，如果是好消息請開心，壞消息請擔憂。
  - 業務規則：
    1. 遇到庫存不足，請主動建議採購。
    2. 可以揭露商品的「成本」與「供應商」資訊。
  `;

  // 2. 外部客服 Persona
  private readonly externalInstruction = `您是「公司大平台」的專業線上客服專員 (Customer Service Agent)。
  - 對象：您正在與外部客戶或潛在買家對話。
  - 核心指令：
    1. **語氣專業禮貌**：請使用敬語（例如：「您好」、「很高興為您服務」、「請稍等」），語氣親切但保持專業距離，不要太隨便。
    2. **數據隱私 (非常重要)**：您 **嚴格禁止** 透露商品的「成本」、「供應商資訊」、「內部庫存精確數量」（只能說「有現貨」或「缺貨中」）。
    3. **任務**：協助介紹商品特色、查詢訂單出貨狀態（需提供單號）、引導下單。
    4. **應對**：如果客戶詢問無法回答的問題（如內部機密），請委婉告知「這部分我需要請專人與您聯繫」。
  `;

  // Signals for dynamic configuration
  currentSystemInstruction = signal<string>(
      localStorage.getItem('erp_ai_instruction') || this.internalInstruction
  );
  
  knowledgeBase = signal<string[]>(
      JSON.parse(localStorage.getItem('erp_ai_knowledge') || '[]')
  );

  sharedKey = signal<string>('');
  keySource = signal<'none' | 'local' | 'server' | 'platform'>('none');
  private sharedKeyPromise: Promise<void> | null = null;

  constructor() {
    // Start Real-time Sync with Cloud Database
    this.subscribeToConfigurationChanges();
    this.fetchSharedKey();
  }

  private async fetchSharedKey() {
      if (this.sharedKeyPromise) return this.sharedKeyPromise;
      
      this.sharedKeyPromise = (async () => {
          try {
              if (!this.firestore) return;
              const docRef = doc(this.firestore, 'systemConfig', 'gemini');
              const docSnap = await getDoc(docRef);
              if (docSnap.exists() && docSnap.data()['apiKey']) {
                  this.sharedKey.set(docSnap.data()['apiKey']);
                  this.keySource.set('server');
                  console.log('🤖 Shared System Key loaded from Firestore.');
              }
          } catch (e) {
              console.warn('Could not fetch shared key from Firestore.');
          }
      })();
      
      return this.sharedKeyPromise;
  }

  private readonly STORAGE_KEY = 'gemini_api_key';

  /**
   * Check if API Key is available, if not, prompt user to select one
   */
  async ensureApiKey(): Promise<boolean> {
    if (typeof window === 'undefined') return false;
    
    // 1. Check for keys in localStorage (Permanent fallback)
    const savedKey = localStorage.getItem(this.STORAGE_KEY);
    if (savedKey && savedKey.trim() !== '') {
      this.keySource.set('local');
      return true;
    }

    // 2. Check for Shared Key from Server (Wait if not loaded)
    if (!this.sharedKey()) {
        await this.fetchSharedKey();
    }
    
    if (this.sharedKey() && this.sharedKey().trim() !== '') {
      this.keySource.set('server');
      return true;
    }

    // 3. Check for keys in all possible global and environment locations
    const win = window as any;
    let envKey = '';
    try {
      envKey = win.GEMINI_API_KEY || 
               win.API_KEY || 
               win.process?.env?.GEMINI_API_KEY || 
               win.process?.env?.API_KEY ||
               (typeof GEMINI_API_KEY !== 'undefined' ? GEMINI_API_KEY : '');
    } catch (e) {}
    
    if (envKey && envKey.trim() !== '') {
      this.keySource.set('platform');
      return true; 
    }
    
    // 4. Fallback to platform selection mechanism if available
    if (window.aistudio) {
      const hasKey = await window.aistudio.hasSelectedApiKey();
      if (hasKey) {
          this.keySource.set('platform');
          return true;
      }
      
      if (confirm('偵測到尚未設定 Gemini API Key。\n\n使用 AI 辨識功能需要先在系統中選取一個有效的 API Key。\n\n是否現在開啟設定視窗？')) {
        await window.aistudio.openSelectKey();
        return true; 
      }
    }
    
    this.keySource.set('none');
    return false;
  }

  saveKeyToStorage(key: string): boolean {
    try {
        if (key && key.trim() !== '') {
            localStorage.setItem(this.STORAGE_KEY, key.trim());
            this.keySource.set('local');
            return true;
        }
        return false;
    } catch (e) {
        console.error('儲存金鑰失敗', e);
        return false;
    }
  }

  getStoredKey(): string {
    return localStorage.getItem(this.STORAGE_KEY) || '';
  }

  clearStoredKey() {
    localStorage.removeItem(this.STORAGE_KEY);
  }

  private getGenAI() {
    // 1. 嘗試從各種來源獲取 Key
    let apiKey = localStorage.getItem(this.STORAGE_KEY);
    
    if (!apiKey || apiKey.trim() === '') {
        apiKey = this.sharedKey();
    }
    
    if (!apiKey || apiKey.trim() === '') {
      try {
        const win = window as any;
        apiKey = win.GEMINI_API_KEY || 
                 win.API_KEY || 
                 win.process?.env?.GEMINI_API_KEY || 
                 win.process?.env?.API_KEY || 
                 (typeof GEMINI_API_KEY !== 'undefined' ? GEMINI_API_KEY : '');
      } catch (e) {}
    }

    // 2. 關鍵修正：增加明確的錯誤檢查與防禦機制
    if (!apiKey || apiKey.trim() === '' || apiKey === 'undefined') {
        const errorMsg = "[AI ERP] 找不到有效的 API Key。請至「系統設定」填寫金鑰，或確保後端 API 正常運作。";
        console.error(errorMsg);
        
        // 如果是在開發環境，可以跳出提醒
        if (typeof window !== 'undefined') {
            alert('偵測到 API Key 缺失，請先設定 Gemini API Key 以啟動掃描功能。');
        }
        
        throw new Error("API key must be set when using the Gemini API.");
    }

    // 3. 確保回傳正確實例
    return new GoogleGenAI({ apiKey: apiKey.trim() });
  }

  private async compressImage(base64Str: string, maxWidth = 1024): Promise<string> {
    if (typeof window === 'undefined') return base64Str;
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        let width = img.width;
        let height = img.height;

        if (width > maxWidth) {
          height = Math.round((height * maxWidth) / width);
          width = maxWidth;
        }

        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          resolve(base64Str);
          return;
        }
        ctx.drawImage(img, 0, 0, width, height);
        resolve(canvas.toDataURL('image/jpeg', 0.8));
      };
      img.onerror = reject;
      img.src = base64Str.startsWith('data:') ? base64Str : `data:image/jpeg;base64,${base64Str}`;
    });
  }

  ngOnDestroy() {
      if (this.unsubscribeConfig) {
          this.unsubscribeConfig();
      }
  }

  /**
   * Helper to log token usage to DataService
   */
  private logUsage(response: any, context: string) {
      // Check if usage metadata exists in the response
      if (response && response.usageMetadata) {
          const usage = response.usageMetadata;
          this.dataService.addAiUsageLog({
              id: `LOG-${Date.now()}-${Math.floor(Math.random()*1000)}`,
              timestamp: new Date().toISOString(),
              model: 'gemini-2.5-flash',
              inputTokens: usage.promptTokenCount || 0,
              outputTokens: usage.candidatesTokenCount || 0,
              totalTokens: usage.totalTokenCount || 0,
              context: context
          });
      }
  }

  /**
   * Real-time Sync from Firestore
   * This allows all users to share the same "Brain" instantly without refreshing.
   */
  private subscribeToConfigurationChanges() {
      if (!db) return; 

      try {
          const docRef = doc(db, 'settings', 'ai_config');
          // Use onSnapshot for real-time updates instead of getDoc
          this.unsubscribeConfig = onSnapshot(docRef, (docSnap) => {
              if (docSnap.exists()) {
                  const data = docSnap.data();
                  let hasChanges = false;

                  if (data['instruction'] && data['instruction'] !== this.currentSystemInstruction()) {
                      this.currentSystemInstruction.set(data['instruction']);
                      localStorage.setItem('erp_ai_instruction', data['instruction']); // Cache locally
                      hasChanges = true;
                  }
                  
                  if (data['knowledge'] && Array.isArray(data['knowledge'])) {
                      // Simple comparison to avoid unnecessary re-init
                      const newKbJson = JSON.stringify(data['knowledge']);
                      const oldKbJson = JSON.stringify(this.knowledgeBase());
                      
                      if (newKbJson !== oldKbJson) {
                          this.knowledgeBase.set(data['knowledge']);
                          localStorage.setItem('erp_ai_knowledge', newKbJson); // Cache locally
                          hasChanges = true;
                      }
                  }
                  
                  // Re-init chat if config changed remotely
                  if (hasChanges) {
                      console.log('🤖 AI Brain updated from Cloud.');
                      this.initializeChat();
                  }
              }
          }, (error) => {
              // Gracefully handle permission errors
              if (error.code === 'permission-denied') {
                  console.warn("AI Config Sync: Cloud permission denied. Using local configuration.");
              } else {
                  console.error("Error syncing AI config:", error);
              }
          });
      } catch (error) {
          console.error("Setup AI sync failed:", error);
      }
  }

  /**
   * Re-initialize chat with current system instruction
   */
  initializeChat(): void {
    // Legacy method kept for compatibility, but chat is now stateless via REST
    console.log('AI Chat initialized (Stateless REST mode)');
  }

  setRole(role: AiRole) {
      this.currentRole.set(role);
  }

  /**
   * Update the persona and knowledge base
   * Writes to Firestore so ALL users get the update.
   */
  async updateConfiguration(instruction: string, knowledge: string[]) {
      this.currentSystemInstruction.set(instruction);
      this.knowledgeBase.set(knowledge);
      
      // 1. Optimistic Update (Local)
      try {
          localStorage.setItem('erp_ai_instruction', instruction);
          localStorage.setItem('erp_ai_knowledge', JSON.stringify(knowledge));
      } catch (e) {
          console.error('Failed to save AI config to local storage', e);
      }

      // 2. Cloud Update (Firestore)
      if (db) {
          try {
              await setDoc(doc(db, 'settings', 'ai_config'), {
                  instruction: instruction,
                  knowledge: knowledge,
                  updatedAt: new Date().toISOString(),
                  updatedBy: 'UserAction' // Could verify user ID here
              });
          } catch (e: any) {
              if (e.code === 'permission-denied') {
                   console.warn('AI Config Save: Cloud permission denied. Settings saved locally only.');
              } else {
                   console.error('Failed to save AI config to Firestore', e);
              }
          }
      }

      if (this.currentRole() === 'internal') {
          this.initializeChat();
      }
  }

  async sendMessage(message: string, imageBase64?: string, contextData?: string): Promise<string> {
    try {
      const ai = this.getGenAI();
      const baseInstruction = this.currentRole() === 'internal' ? this.internalInstruction : this.externalInstruction;
      let finalInstruction = baseInstruction;
      if (this.currentRole() === 'internal' && this.currentSystemInstruction() !== this.internalInstruction) {
          finalInstruction = this.currentSystemInstruction();
      }

      // 1. Build Knowledge Base Context (RAG-lite)
      let knowledgeContext = '';
      const kb = this.knowledgeBase();
      if (kb.length > 0) {
          knowledgeContext = `\n[公司知識庫 (Shared Knowledge Base)]\n${kb.join('\n\n')}\n----------------`;
      }

      // 2. Build System Data Context
      let systemContext = '';
      if (contextData) {
        systemContext = `\n[系統即時數據]\n${contextData}\n----------------`;
      }

      // 3. Combine into full prompt
      const fullPromptText = `${knowledgeContext}${systemContext}\n\n[使用者訊息]\n${message}`;

      const parts: any[] = [{ text: fullPromptText }];

      // 4. Handle Image with Compression
      if (imageBase64) {
        const compressedBase64 = await this.compressImage(imageBase64);
        const base64Data = compressedBase64.split(',')[1] || compressedBase64;
        parts.push({
            inlineData: {
                mimeType: 'image/jpeg',
                data: base64Data
            }
        });
      }

      const response = await ai.models.generateContent({
        model: "gemini-2.5-flash",
        contents: [{ role: "user", parts }],
        config: { 
            systemInstruction: finalInstruction,
            temperature: 0.7, 
            topP: 0.95, 
            topK: 40 
        }
      });

      const responseText = response.text || '';
      
      // Log usage
      if (response.usageMetadata) {
          this.dataService.addAiUsageLog({
              id: `LOG-${Date.now()}`,
              timestamp: new Date().toISOString(),
              model: 'gemini-2.5-flash',
              inputTokens: response.usageMetadata.promptTokenCount || 0,
              outputTokens: response.usageMetadata.candidatesTokenCount || 0,
              totalTokens: response.usageMetadata.totalTokenCount || 0,
              context: 'Chat'
          });
      }

      return responseText;
    } catch (error: any) {
      console.error("Gemini SDK Chat Error:", error);
      return "抱歉，連線發生了一點問題，請再試一次。";
    }
  }

  async performWebSearch(query: string): Promise<{text: string, sources: any[]}> {
     try {
       const ai = this.getGenAI();
       const response = await ai.models.generateContent({
         model: "gemini-2.5-flash",
         contents: [{ role: "user", parts: [{ text: query }] }],
         config: {
           tools: [{ googleSearch: {} }]
         }
       });

       const text = response.text || '';
       const sources = response.candidates?.[0]?.groundingMetadata?.groundingChunks || [];
       
       return { text, sources };
     } catch (error) {
       console.error("Web Search Error:", error);
       throw new Error("搜尋功能暫時無法使用。");
     }
  }

  async generateBusinessInsight(systemContext: string): Promise<string> {
      const prompt = `
      請擔任一位資深營運長 (COO)，根據以下的 ERP 系統數據快照，產生一份簡短的「每日營運洞察報告」。
      
      數據快照：
      ${systemContext}

      請包含以下三個部分 (請用 markdown 格式)：
      1. 📊 **營運總結**：用一句話形容目前的狀況，語氣要精準有力。
      2. ⚠️ **風險警示**：指出庫存不足、訂單積壓或其他潛在問題。
      3. 💡 **行動建議**：具體的 2-3 個下一步建議。

      請保持語氣專業但不要太像機器人，要有給予團隊方向的感覺。
      `;

      try {
        const ai = this.getGenAI();
        const response = await ai.models.generateContent({
          model: "gemini-2.5-flash",
          contents: [{ role: "user", parts: [{ text: prompt }] }]
        });
        return response.text || '';
      } catch (error) {
        console.error("Insight Generation Error:", error);
        return "暫時無法產生洞察報告，請稍後再試。";
      }
  }

  async generateSystemInstruction(directive: string): Promise<string> {
      const prompt = `
      You are an expert AI Prompt Engineer. Your task is to convert high-level executive directives into a structured, professional 'System Instruction' for an AI assistant.

      **Executive's Directive:**
      "${directive}"

      **Task:**
      1. Analyze the tone, rules, and restrictions in the directive.
      2. Convert this into a clear, structured prompt using Markdown.
      3. Organize it into sections like [角色設定], [語氣風格], [核心規則], [限制].
      4. Ensure the output is ready to be pasted directly into an AI system configuration.
      5. Language: Traditional Chinese (繁體中文).

      **Example Output Format:**
      ### [角色設定]
      你是一位...

      ### [語氣風格]
      - ...

      ### [核心規則]
      1. ...
      `;

      try {
          const ai = this.getGenAI();
          const response = await ai.models.generateContent({
            model: "gemini-2.5-flash",
            contents: [{ role: "user", parts: [{ text: prompt }] }]
          });
          return response.text || '';
      } catch (error) {
          console.error("Prompt Generation Error:", error);
          throw new Error("無法轉換指令。");
      }
  }

  async parseUnstructuredData(unstructuredText: string, targetSchema: string): Promise<any[]> {
     const prompt = `
     You are a data parsing and mapping expert. Your task is to convert the following input text into a JSON array that strictly matches the provided schema.

     **Target Schema (TypeScript Interface):**
     ${targetSchema}

     **Input Text (Can be JSON, CSV, or natural language):**
     ${unstructuredText}

     **Instructions:**
     1. Analyze the input text.
     2. If the input is already a JSON array (e.g. from a file import), your task is to **MAP** the keys from the input JSON to the "Target Schema" keys. Rename keys and transform values as needed.
     3. If the input is unstructured text, extract entities and map them.
     4. Generate valid data for missing required fields if implied (e.g. generate a unique ID if one is missing but required, default 'status' to 'Active' or equivalent).
     5. Ignore data that does not fit the schema.
     6. Output ONLY a valid JSON array. 
     7. **IMPORTANT**: Do NOT output markdown code blocks (like \`\`\`json). Just return the raw JSON string starting with '[' and ending with ']'.
     `;

     try {
        const ai = this.getGenAI();
        const response = await ai.models.generateContent({
          model: "gemini-2.5-flash",
          contents: [{ role: "user", parts: [{ text: prompt }] }],
          config: { responseMimeType: 'application/json' }
        });
        let jsonStr = response.text || '[]';
        
        jsonStr = jsonStr.replace(/```json/g, '').replace(/```/g, '').trim();

        const firstBracket = jsonStr.indexOf('[');
        const lastBracket = jsonStr.lastIndexOf(']');

        if (firstBracket !== -1 && lastBracket !== -1 && lastBracket > firstBracket) {
            jsonStr = jsonStr.substring(firstBracket, lastBracket + 1);
        } else {
             const firstBrace = jsonStr.indexOf('{');
             const lastBrace = jsonStr.lastIndexOf('}');
             if (firstBrace !== -1 && lastBrace !== -1) {
                 jsonStr = `[${jsonStr.substring(firstBrace, lastBrace + 1)}]`;
             }
        }

        try {
            return JSON.parse(jsonStr);
        } catch (parseError) {
            console.error("JSON Parse failed. Raw string:", jsonStr);
            throw new Error("AI 回傳格式錯誤，無法解析為 JSON。");
        }

     } catch (error) {
         console.error("AI Parsing Error:", error);
         throw new Error("無法解析資料，請檢查格式或稍後再試。");
     }
  }

  async parseLogisticsImage(imageBase64: string, providerOptions: string[], roi?: {x: number, y: number, width: number, height: number}, urlPattern?: string): Promise<{provider: string, trackingId: string, trackingUrl: string}> {
    console.log("[AI ERP PIXEL] 執行辨識！正在進行圖片壓縮...");
    
    // 確保 sharedKey 已載入 (如果尚未載入則等待)
    if (!this.sharedKey()) {
        await this.fetchSharedKey();
    }

    try {
        const ai = this.getGenAI();
        // 1. 圖片壓縮
        const compressedBase64 = await this.compressImage(imageBase64);
        const base64Data = compressedBase64.split(',')[1] || compressedBase64;
        
        const systemInstruction = `你是一個專精於台灣物流 ERP 系統的 OCR 專家，負責辨識繁體中文物流單據。
        從圖片中精準擷取「物流商名稱」與「貨運單號」。
        
        Logistics Providers (白名單):
        - 黑貓
        - 大榮
        
        Rules:
        1. 輸出格式：必須嚴格僅回傳 JSON 格式，不得包含任何 Markdown 區塊標籤（如 \`\`\`json）。
        2. 單號處理：自動移除所有空格、連字號(-)或非英數字符。
        3. 容錯：若完全無法辨識單號，trackingId 請回傳 "未辨識"。
        
        Output Format:
        {"provider": "物流商名稱", "trackingId": "純英數單號"}`;

        let userPrompt = `請分析這張圖片。`;
        if (roi) {
            userPrompt += `\n注意重點區域 (ROI): 左 ${roi.x.toFixed(1)}%, 上 ${roi.y.toFixed(1)}%, 寬 ${roi.width.toFixed(1)}%, 高 ${roi.height.toFixed(1)}%。
            請重點觀測圖片中該指定區域內的文字與數字。`;
        }

        const response = await ai.models.generateContent({
          model: 'gemini-2.5-flash',
          contents: [{
            role: "user",
            parts: [
              { text: userPrompt },
              { inlineData: { mimeType: "image/jpeg", data: base64Data } }
            ]
          }],
          config: { 
            systemInstruction: systemInstruction,
            responseMimeType: "application/json",
            responseSchema: {
              type: Type.OBJECT,
              properties: {
                provider: { type: Type.STRING },
                trackingId: { type: Type.STRING }
              },
              required: ["provider", "trackingId"]
            }
          }
        });
        
        // Log usage
        if (response.usageMetadata) {
            this.dataService.addAiUsageLog({
                id: `LOG-${Date.now()}`,
                timestamp: new Date().toISOString(),
                model: 'gemini-2.5-flash',
                inputTokens: response.usageMetadata.promptTokenCount || 0,
                outputTokens: response.usageMetadata.candidatesTokenCount || 0,
                totalTokens: response.usageMetadata.totalTokenCount || 0,
                context: 'OCR'
            });
        }

        const responseText = response.text || '{}';
        console.log("[AI ERP PIXEL] 成功取得 AI 回應！", responseText);
        const parsed = JSON.parse(responseText);

        const TRACKING_URL_PATTERNS: Record<string, string> = {
          '黑貓': 'https://www.t-cat.com.tw/inquire/trace.aspx?no={trackingId}',
          '大榮': 'https://www.dayang.com.tw/TrackOrder?no={trackingId}',
          '新竹': 'https://www.hct.com.tw/search/TrackSearch.aspx?TBILL={trackingId}',
          '郵局': 'https://postserv.post.gov.tw/pstmail/main_mail.html?targetTxn=EB300W&Num={trackingId}',
          '順豐': 'https://www.sf-express.com/tw/tc/dynamic_function/waybill/#search/bill-number/{trackingId}',
        };

        // Robust matching: check if provider contains the key (e.g. "黑貓" matches "黑貓")
        const matchedKey = Object.keys(TRACKING_URL_PATTERNS).find(key => parsed.provider.includes(key));
        const pattern = urlPattern ?? (matchedKey ? TRACKING_URL_PATTERNS[matchedKey] : '') ?? '';
        const trackingUrl = pattern.replace('{trackingId}', parsed.trackingId);

        return {
          provider: parsed.provider,
          trackingId: parsed.trackingId,
          trackingUrl,
        };

    } catch (error: any) {
        console.error("[AI ERP PIXEL] Gemini SDK 致命錯誤:", error);
        const errorMsg = error.message || "AI 辨識發生錯誤";
        throw new Error(errorMsg);
    }
  }

  async generateFormulaFromLogic(logic: string, category: string, imageBase64?: string): Promise<string> {
      const prompt = `
      You are a formula generator for a specific ERP system. Convert the user's business logic description into a strict formula string.
      If an image is provided, analyze the image to understand the context (e.g., a report structure, specific field names shown in a screenshot) and map it to the system syntax.

      **System Syntax Rules:**
      1. **Source Collections**: Order, Product, PurchaseOrder, Supplier.
      2. **Aggregations**: 
         - \`Sum(Collection.Field)\` (e.g. Sum(Order.totalAmount))
         - \`Count(Collection)\` (e.g. Count(Product))
         - \`Count(Unique IdField)\` (Special: \`Count(Unique OrderId)\` or \`Count(Unique PoNumber)\`)
      3. **Filters**: 
         - use \`where\` keyword.
         - Operators: \`==\`, \`!=\`, \`<\`, \`>\`, \`in [...]\`
         - Logical: \`AND\`
      4. **Date Constants**: \`Current Month\`, \`Last Month\`
      5. **Specific Logic**:
         - For 'Revenue' (營收), usually \`Sum(Order.totalAmount)\`.
         - For 'Inventory Value' (庫存成本), only simple field sums supported.
         - Supports specific hardcoded logic like \`Product.stock < Product.safetyStock\`.

      **Examples:**
      - Input: "本月訂單總金額 (排除取消)"
      - Output: \`Sum(Order.totalAmount) where Order.status != "取消" AND Order.orderDate in Current Month\`
      
      - Input: "庫存不足的商品數量"
      - Output: \`Count(Product) where Product.stock < Product.safetyStock\`

      - Input: "進行中的代工訂單數"
      - Output: \`Count(Unique OrderId) where isManufacturingOrder == true AND status in ['處理中', '部份出貨']\`

      **User Input Logic:** "${logic}"
      **Category:** "${category}"

      **Response:** Return ONLY the formula string. No markdown, no quotes.
      `;

      try {
        const ai = this.getGenAI();
        let parts: any[] = [{ text: prompt }];

        if (imageBase64) {
            const compressedBase64 = await this.compressImage(imageBase64);
            const base64Data = compressedBase64.split(',')[1] || compressedBase64;
            parts.push({
                inlineData: {
                    mimeType: 'image/jpeg',
                    data: base64Data
                }
            });
        }

        const response = await ai.models.generateContent({
          model: "gemini-2.5-flash",
          contents: [{ role: "user", parts }]
        });
        return (response.text || '').trim();
      } catch (error) {
        console.error("Formula Gen Error:", error);
        return "";
      }
  }
}
