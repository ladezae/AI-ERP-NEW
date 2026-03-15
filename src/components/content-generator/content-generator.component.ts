/**
 * 自動圖文工具
 * 功能：上傳 JPG → 縮圖 1000x1000 → 浮水印/壓 LOGO → 上傳到通路
 *       輸入商品名 → 選字數 → AI 產文案 → 上傳到通路
 */
import { ChangeDetectionStrategy, Component, computed, inject, OnInit, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { OllamaService } from '../../services/ollama.service';
import { Channel, ChannelProduct } from '../../models/erp.models';
import { collection, doc, getDocs, updateDoc, writeBatch } from 'firebase/firestore';
import { db } from '../../firebase.config';

@Component({
  selector: 'app-content-generator',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CommonModule],
  templateUrl: './content-generator.component.html'
})
export class ContentGeneratorComponent implements OnInit {
  ollamaService = inject(OllamaService);

  // ─── 圖片相關 ───
  /** 上傳的原始圖片 (base64) */
  originalImage = signal<string>('');
  /** 加工後的預覽圖 (base64) */
  processedImage = signal<string>('');
  /** 浮水印文字 */
  watermarkText = signal('一吉水果乾');
  /** 是否啟用浮水印 */
  enableWatermark = signal(false);
  /** 浮水印位置（九宮格） */
  watermarkPosition = signal<string>('center');
  /** 是否啟用 LOGO */
  enableLogo = signal(false);
  /** LOGO 圖片 (base64) */
  logoImage = signal<string>(localStorage.getItem('erp_logo_image') || '');
  /** LOGO 位置（九宮格） */
  logoPosition = signal<string>('bottom-right');
  /** LOGO 尺寸（px） */
  logoSize = signal<number>(120);
  /** LOGO 尺寸選項 */
  logoSizeOptions = [60, 80, 100, 120, 150, 200];
  /** 圖片處理中 */
  isProcessing = signal(false);

  /** 九宮格位置對照表 */
  positionLabels: Record<string, string> = {
    'top-left': '左上', 'top-center': '上中', 'top-right': '右上',
    'center-left': '左中', 'center': '正中', 'center-right': '右中',
    'bottom-left': '左下', 'bottom-center': '下中', 'bottom-right': '右下'
  };
  /** 九宮格位置 key 列表 */
  positionKeys = [
    'top-left', 'top-center', 'top-right',
    'center-left', 'center', 'center-right',
    'bottom-left', 'bottom-center', 'bottom-right'
  ];

  /** 圖片欄位定義 */
  imageFieldDefs = [
    { key: 'imageUrl', label: '主圖', desc: '商品主圖（單張，會覆蓋）' },
    { key: 'images', label: '附加圖', desc: '附加圖片（多張，逐張新增）' }
  ];
  /** 文案欄位定義 */
  textFieldDefs = [
    { key: 'description', label: '長文案', desc: '商品詳細描述' },
    { key: 'intro', label: '短簡介', desc: '商品簡介（短版）' }
  ];

  /** 已啟用的欄位數量 */
  activeFieldCount = computed(() => {
    const imgCount = Object.values(this.imageFields()).filter(v => v.enabled).length;
    const txtCount = Object.values(this.textFields()).filter(v => v.enabled).length;
    return imgCount + txtCount;
  });

  /** 圖片加工提示詞（彙整所有設定） */
  imagePrompt = computed(() => {
    const parts: string[] = ['圖片 1:1 (1000×1000)'];
    if (this.enableWatermark()) {
      parts.push(`浮水印「${this.watermarkText()}」→ ${this.positionLabels[this.watermarkPosition()]}`);
    }
    if (this.enableLogo()) {
      parts.push(`LOGO ${this.logoSize()}px → ${this.positionLabels[this.logoPosition()]}`);
    }
    return parts.join(' ／ ');
  });

  /** Prompt 預覽：圖片加工（依各欄位設定彙整） */
  imagePromptPreview = computed(() => {
    const fields = this.imageFields();
    const lines: string[] = [];
    for (const fd of this.imageFieldDefs) {
      const f = fields[fd.key];
      if (!f.enabled) continue;
      const ops: string[] = ['resize 1:1 (1000×1000)'];
      if (f.removeBg) ops.push('去背');
      if (f.addBg) ops.push(`去背 + 加背景「${f.bgPrompt || '(未填)'}」`);
      if (f.purePrompt) ops.push(`純提示詞「${f.purePromptText || '(未填)'}」`);
      if (f.watermark) ops.push(`浮水印「${this.watermarkText()}」→ ${this.positionLabels[this.watermarkPosition()]}`);
      if (f.logo) ops.push(`LOGO ${this.logoSize()}px → ${this.positionLabels[this.logoPosition()]}`);
      lines.push(`【${fd.label}】${ops.join(' → ')}`);
    }
    return lines.length ? lines : ['（未啟用任何圖片欄位）'];
  });

  /** Prompt 預覽：文案生成（模擬送出的 prompt） */
  copyPromptPreview = computed(() => {
    const txtFields = this.textFields();
    const lines: string[] = [];
    for (const fd of this.textFieldDefs) {
      const f = txtFields[fd.key];
      if (!f.enabled) continue;
      lines.push(`【${fd.label}】${f.charLimit} 字以內 · 禁療效用語 · Ollama qwen2.5:7b`);
    }
    return lines.length ? lines : ['（未啟用任何文案欄位）'];
  });

  // ─── 文案相關 ───
  /** 商品名稱 */
  productName = signal('');
  /** 選擇的字數限制 */
  charLimit = signal<number>(20);
  /** 字數選項 */
  charOptions = [10, 20, 30, 50];
  /** 生成的文案結果（各字數版本） */
  generatedCopies = signal<Record<number, string>>({});

  // ─── 通路相關 ───
  /** 可用通路列表 */
  channels = signal<Channel[]>([]);
  /** 選定的通路 */
  selectedChannelId = signal<string>('');
  /** 通路商品列表 */
  channelProducts = signal<ChannelProduct[]>([]);
  /** 選定的通路商品（__ALL__ = 全部商品） */
  selectedProductId = signal<string>('__ALL__');
  /** 圖片欄位設定（主圖禁止任何加工；附加圖支援浮水印/LOGO/去背/加背景/純提示詞） */
  imageFields = signal<Record<string, {
    enabled: boolean;
    watermark: boolean;
    logo: boolean;
    removeBg: boolean;        // 去背
    addBg: boolean;           // 去背 + 加上 AI 背景
    bgPrompt: string;         // 背景提示詞（addBg 用）
    purePrompt: boolean;      // 純提示詞（不需原圖，AI 生成）
    purePromptText: string;   // 純提示詞文字
  }>>({
    imageUrl: { enabled: true, watermark: false, logo: false, removeBg: false, addBg: false, bgPrompt: '', purePrompt: false, purePromptText: '' },
    images:   { enabled: false, watermark: false, logo: false, removeBg: false, addBg: false, bgPrompt: '', purePrompt: false, purePromptText: '' }
  });
  /** 文案欄位設定（各自帶字數選擇） */
  textFields = signal<Record<string, { enabled: boolean; charLimit: number }>>({
    description: { enabled: true, charLimit: 30 },
    intro:       { enabled: false, charLimit: 20 }
  });
  /** 上傳中 */
  isUploading = signal(false);
  /** 上傳結果訊息 */
  uploadMessage = signal('');
  /** 清空中 */
  isResetting = signal(false);

  // ─── 資料夾產出 ───
  /** 資料夾產出中 */
  isScaffolding = signal(false);
  /** 資料夾產出結果 */
  scaffoldResult = signal<{
    success: boolean;
    basePath: string;
    created: string[];
    skipped: string[];
    totalProducts: number;
    timestamp?: string;
  } | null>(null);
  /** 資料夾狀態（各商品有幾張圖） */
  folderStatus = signal<{ name: string; imageCount: number; files: string[] }[]>([]);

  // ─── 批次進度管理 ───
  /** 批次階段 */
  batchPhase = signal<'idle' | 'images' | 'texts' | 'done'>('idle');
  /** 批次是否執行中 */
  batchRunning = signal(false);
  /** 暫停旗標（使用者按暫停後設為 true，迴圈會在下一個商品前停下） */
  batchPaused = signal(false);
  /** 目前處理中的商品 ID */
  batchCurrentProductId = signal<string>('');
  /** 批次進度：已處理數 */
  batchProcessed = signal(0);
  /** 批次進度：總數 */
  batchTotal = signal(0);
  /** 批次日誌（最近的訊息） */
  batchLog = signal<string[]>([]);

  /** 選定的通路物件 */
  selectedChannel = computed(() =>
    this.channels().find(c => c.id === this.selectedChannelId()) || null
  );

  /** 圖文狀態統計 */
  statusStats = computed(() => {
    const products = this.channelProducts();
    let done = 0, partial = 0, empty = 0;
    for (const cp of products) {
      const status = this.getProductStatus(cp);
      if (status === 'done') done++;
      else if (status === 'partial') partial++;
      else empty++;
    }
    return { done, partial, empty };
  });

  /** 判斷單一商品的圖文完成狀態 */
  getProductStatus(cp: ChannelProduct): 'done' | 'partial' | 'empty' {
    const hasImage = !!cp.imageUrl;
    const hasText = !!(cp.description || cp.intro);
    if (hasImage && hasText) return 'done';
    if (hasImage || hasText) return 'partial';
    return 'empty';
  }

  ngOnInit(): void {
    this.ollamaService.checkConnection();
    this.loadChannels();
  }

  /** 從 Firestore 載入通路列表 */
  private async loadChannels(): Promise<void> {
    try {
      const snap = await getDocs(collection(db, 'channels'));
      this.channels.set(snap.docs.map(d => ({ id: d.id, ...d.data() } as Channel)));
    } catch (err) {
      console.error('載入通路失敗:', err);
    }
  }

  // ══════════════════════════════════════════
  //  圖片處理
  // ══════════════════════════════════════════

  /** 使用者上傳 JPG */
  onImageUpload(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      alert('請上傳圖片檔案');
      return;
    }
    const reader = new FileReader();
    reader.onload = (e: any) => {
      this.originalImage.set(e.target.result);
      this.processImage();
    };
    reader.readAsDataURL(file);
  }

  /** 上傳 LOGO 圖片 */
  onLogoUpload(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (e: any) => {
      this.logoImage.set(e.target.result);
      localStorage.setItem('erp_logo_image', e.target.result);
      if (this.originalImage()) this.processImage();
    };
    reader.readAsDataURL(file);
  }

  /** 核心：圖片加工（縮圖 1000x1000 + 浮水印 + LOGO） */
  async processImage(): Promise<void> {
    const src = this.originalImage();
    if (!src) return;

    this.isProcessing.set(true);

    try {
      const img = await this.loadImage(src);
      const canvas = document.createElement('canvas');
      const SIZE = 1000;
      canvas.width = SIZE;
      canvas.height = SIZE;
      const ctx = canvas.getContext('2d')!;

      // 白底
      ctx.fillStyle = '#FFFFFF';
      ctx.fillRect(0, 0, SIZE, SIZE);

      // 等比縮放置中（cover 模式裁切為正方形）
      const scale = Math.max(SIZE / img.width, SIZE / img.height);
      const sw = SIZE / scale;
      const sh = SIZE / scale;
      const sx = (img.width - sw) / 2;
      const sy = (img.height - sh) / 2;
      ctx.drawImage(img, sx, sy, sw, sh, 0, 0, SIZE, SIZE);

      // 浮水印（依位置設定）
      if (this.enableWatermark()) {
        const text = this.watermarkText() || '一吉水果乾';
        const pos = this.watermarkPosition();
        ctx.save();
        ctx.globalAlpha = 0.25;
        ctx.fillStyle = '#FFFFFF';
        ctx.font = 'bold 48px "Microsoft JhengHei", sans-serif';

        if (pos === 'center') {
          // 正中 → 斜向重複滿版浮水印
          ctx.textAlign = 'center';
          ctx.translate(SIZE / 2, SIZE / 2);
          ctx.rotate(-Math.PI / 6);
          for (let y = -SIZE; y < SIZE; y += 150) {
            for (let x = -SIZE; x < SIZE; x += 400) {
              ctx.fillText(text, x, y);
            }
          }
        } else {
          // 單點浮水印
          const coord = this.getPositionCoord(pos, SIZE, 30);
          ctx.textAlign = pos.includes('left') ? 'left' : pos.includes('right') ? 'right' : 'center';
          ctx.textBaseline = pos.includes('top') ? 'top' : pos.includes('bottom') ? 'bottom' : 'middle';
          ctx.fillText(text, coord.x, coord.y);
        }
        ctx.restore();
      }

      // 壓 LOGO（依位置設定）
      if (this.enableLogo() && this.logoImage()) {
        const logoImg = await this.loadImage(this.logoImage());
        const targetSize = this.logoSize();
        const margin = 30;
        const logoScale = Math.min(targetSize / logoImg.width, targetSize / logoImg.height);
        const lw = logoImg.width * logoScale;
        const lh = logoImg.height * logoScale;
        const pos = this.logoPosition();
        const coord = this.getPositionCoord(pos, SIZE, margin);
        // 調整座標使圖片對齊到位置點
        const lx = pos.includes('left') ? coord.x : pos.includes('right') ? coord.x - lw : coord.x - lw / 2;
        const ly = pos.includes('top') ? coord.y : pos.includes('bottom') ? coord.y - lh : coord.y - lh / 2;
        ctx.drawImage(logoImg, lx, ly, lw, lh);
      }

      this.processedImage.set(canvas.toDataURL('image/jpeg', 0.9));
    } catch (err) {
      console.error('圖片加工失敗:', err);
      alert('圖片加工失敗，請重試');
    } finally {
      this.isProcessing.set(false);
    }
  }

  /** 載入圖片為 HTMLImageElement */
  private loadImage(src: string): Promise<HTMLImageElement> {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = reject;
      img.src = src;
    });
  }

  /** 開關變更時重新加工 */
  toggleWatermark(): void {
    this.enableWatermark.update(v => !v);
    if (this.originalImage()) this.processImage();
  }

  toggleLogo(): void {
    this.enableLogo.update(v => !v);
    if (this.originalImage()) this.processImage();
  }

  onWatermarkTextChange(text: string): void {
    this.watermarkText.set(text);
    if (this.originalImage() && this.enableWatermark()) this.processImage();
  }

  onWatermarkPositionChange(pos: string): void {
    this.watermarkPosition.set(pos);
    if (this.originalImage() && this.enableWatermark()) this.processImage();
  }

  onLogoPositionChange(pos: string): void {
    this.logoPosition.set(pos);
    if (this.originalImage() && this.enableLogo()) this.processImage();
  }

  onLogoSizeChange(size: number): void {
    this.logoSize.set(size);
    if (this.originalImage() && this.enableLogo()) this.processImage();
  }

  /** 切換圖片欄位啟用 */
  toggleImageField(key: string): void {
    this.imageFields.update(prev => ({
      ...prev, [key]: { ...prev[key], enabled: !prev[key].enabled }
    }));
  }
  /** 切換圖片欄位子選項（watermark / logo / removeBg / addBg / purePrompt） */
  toggleImageFieldOption(key: string, option: 'watermark' | 'logo' | 'removeBg' | 'addBg' | 'purePrompt'): void {
    this.imageFields.update(prev => {
      const field = { ...prev[key], [option]: !prev[key][option] };
      // 互斥：去背/加背景/純提示詞三擇一
      if (option === 'removeBg' && field.removeBg) {
        field.addBg = false;
        field.purePrompt = false;
      } else if (option === 'addBg' && field.addBg) {
        field.removeBg = false;
        field.purePrompt = false;
      } else if (option === 'purePrompt' && field.purePrompt) {
        field.removeBg = false;
        field.addBg = false;
      }
      return { ...prev, [key]: field };
    });
  }
  /** 設定背景提示詞 */
  setImageFieldBgPrompt(key: string, prompt: string): void {
    this.imageFields.update(prev => ({
      ...prev, [key]: { ...prev[key], bgPrompt: prompt }
    }));
  }
  /** 設定純提示詞文字 */
  setImageFieldPurePrompt(key: string, text: string): void {
    this.imageFields.update(prev => ({
      ...prev, [key]: { ...prev[key], purePromptText: text }
    }));
  }
  /** 切換文案欄位啟用 */
  toggleTextField(key: string): void {
    this.textFields.update(prev => ({
      ...prev, [key]: { ...prev[key], enabled: !prev[key].enabled }
    }));
  }
  /** 更新文案欄位字數 */
  setTextFieldCharLimit(key: string, limit: number): void {
    this.textFields.update(prev => ({
      ...prev, [key]: { ...prev[key], charLimit: limit }
    }));
  }

  /** 根據九宮格位置算出畫布座標 */
  private getPositionCoord(pos: string, size: number, margin: number): { x: number; y: number } {
    let x = size / 2, y = size / 2;
    if (pos.includes('left')) x = margin;
    if (pos.includes('right')) x = size - margin;
    if (pos.includes('top')) y = margin;
    if (pos.includes('bottom')) y = size - margin;
    return { x, y };
  }

  // ══════════════════════════════════════════
  //  文案生成
  // ══════════════════════════════════════════

  /** 產生單一字數版本的文案 */
  async generateSingleCopy(limit: number): Promise<void> {
    const name = this.productName().trim();
    if (!name) { alert('請輸入商品名稱'); return; }

    try {
      const text = await this.ollamaService.generateCopy(name, limit);
      this.generatedCopies.update(prev => ({ ...prev, [limit]: text }));
    } catch {
      alert('文案生成失敗，請確認 Ollama 已啟動');
    }
  }

  /** 一次產生所有字數版本 */
  async generateAllCopies(): Promise<void> {
    const name = this.productName().trim();
    if (!name) { alert('請輸入商品名稱'); return; }

    for (const limit of this.charOptions) {
      try {
        const text = await this.ollamaService.generateCopy(name, limit);
        this.generatedCopies.update(prev => ({ ...prev, [limit]: text }));
      } catch {
        // 繼續下一個
      }
    }
  }

  /** 複製文案到剪貼簿 */
  async copyCopyText(text: string): Promise<void> {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const ta = document.createElement('textarea');
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
    }
  }

  // ══════════════════════════════════════════
  //  通路上傳
  // ══════════════════════════════════════════

  /** 選擇通路後載入商品 */
  async onChannelChange(channelId: string): Promise<void> {
    this.selectedChannelId.set(channelId);
    this.selectedProductId.set('__ALL__');
    this.channelProducts.set([]);

    const channel = this.channels().find(c => c.id === channelId);
    if (!channel) return;

    try {
      const snap = await getDocs(collection(db, channel.productCollection));
      const products = snap.docs.map((d: any) => ({ ...d.data(), id: d.id } as ChannelProduct));
      this.channelProducts.set(products.filter(p => p.visible !== false));
      // 同步載入本機資料夾狀態
      await this.loadFolderStatus();
    } catch (err) {
      console.error('載入通路商品失敗:', err);
    }
  }

  /** 上傳圖片到通路商品（依各欄位設定決定寫入與加工方式） */
  async uploadImage(): Promise<void> {
    const channel = this.selectedChannel();
    const productId = this.selectedProductId();
    const imgSrc = this.originalImage();
    const fields = this.imageFields();
    const enabledKeys = Object.entries(fields).filter(([, v]) => v.enabled).map(([k]) => k);

    if (!channel || !productId || !imgSrc) {
      alert('請選擇通路、商品，並上傳圖片');
      return;
    }
    if (!enabledKeys.length) {
      alert('請至少開啟一個圖片欄位');
      return;
    }

    this.isUploading.set(true);
    this.uploadMessage.set('');

    try {
      const ref = doc(db, channel.productCollection, productId);
      const updateData: Record<string, any> = {};

      for (const key of enabledKeys) {
        const setting = fields[key];
        let image: string;
        // 主圖與附加圖都走完整加工流程
        image = await this.buildImageAdvanced(imgSrc, setting);
        if (key === 'imageUrl') {
          updateData['imageUrl'] = image;
        } else {
          const product = this.channelProducts().find(p => p.id === productId);
          const currentImages = product?.images || [];
          updateData['images'] = [...currentImages, image];
        }
      }

      await updateDoc(ref, updateData);
      const names = enabledKeys.map(k => k === 'imageUrl' ? '主圖' : '附加圖').join('、');
      this.uploadMessage.set(`${names} 上傳成功！`);
    } catch (err: any) {
      this.uploadMessage.set('上傳失敗：' + (err.message || '未知錯誤'));
    } finally {
      this.isUploading.set(false);
    }
  }

  /** 依設定產生加工後圖片 */
  private async buildImage(src: string, applyWatermark: boolean, applyLogo: boolean): Promise<string> {
    const img = await this.loadImage(src);
    const canvas = document.createElement('canvas');
    const SIZE = 1000;
    canvas.width = SIZE;
    canvas.height = SIZE;
    const ctx = canvas.getContext('2d')!;

    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(0, 0, SIZE, SIZE);

    const scale = Math.max(SIZE / img.width, SIZE / img.height);
    const sw = SIZE / scale, sh = SIZE / scale;
    const sx = (img.width - sw) / 2, sy = (img.height - sh) / 2;
    ctx.drawImage(img, sx, sy, sw, sh, 0, 0, SIZE, SIZE);

    if (applyWatermark) {
      const text = this.watermarkText() || '一吉水果乾';
      const pos = this.watermarkPosition();
      ctx.save();
      ctx.globalAlpha = 0.25;
      ctx.fillStyle = '#FFFFFF';
      ctx.font = 'bold 48px "Microsoft JhengHei", sans-serif';
      if (pos === 'center') {
        ctx.textAlign = 'center';
        ctx.translate(SIZE / 2, SIZE / 2);
        ctx.rotate(-Math.PI / 6);
        for (let y = -SIZE; y < SIZE; y += 150) {
          for (let x = -SIZE; x < SIZE; x += 400) {
            ctx.fillText(text, x, y);
          }
        }
      } else {
        const coord = this.getPositionCoord(pos, SIZE, 30);
        ctx.textAlign = pos.includes('left') ? 'left' : pos.includes('right') ? 'right' : 'center';
        ctx.textBaseline = pos.includes('top') ? 'top' : pos.includes('bottom') ? 'bottom' : 'middle';
        ctx.fillText(text, coord.x, coord.y);
      }
      ctx.restore();
    }

    if (applyLogo && this.logoImage()) {
      const logoImg = await this.loadImage(this.logoImage());
      const targetSize = this.logoSize();
      const margin = 30;
      const logoScale = Math.min(targetSize / logoImg.width, targetSize / logoImg.height);
      const lw = logoImg.width * logoScale, lh = logoImg.height * logoScale;
      const pos = this.logoPosition();
      const coord = this.getPositionCoord(pos, SIZE, margin);
      const lx = pos.includes('left') ? coord.x : pos.includes('right') ? coord.x - lw : coord.x - lw / 2;
      const ly = pos.includes('top') ? coord.y : pos.includes('bottom') ? coord.y - lh : coord.y - lh / 2;
      ctx.drawImage(logoImg, lx, ly, lw, lh);
    }

    return canvas.toDataURL('image/jpeg', 0.9);
  }

  /**
   * 進階圖片加工（附加圖專用）
   * 支援：去背 → 加背景 → 純提示詞 → 浮水印 → LOGO
   */
  private async buildImageAdvanced(src: string, setting: {
    watermark: boolean; logo: boolean;
    removeBg: boolean; addBg: boolean; bgPrompt: string;
    purePrompt: boolean; purePromptText: string;
  }): Promise<string> {
    let imgSrc = src;

    // 純提示詞模式：完全不用原圖，由 AI 生成
    if (setting.purePrompt && setting.purePromptText.trim()) {
      imgSrc = await this.callGenerateImage(setting.purePromptText.trim());
    }
    // 去背 + 加背景：先去背再用提示詞生成背景
    else if (setting.addBg) {
      const noBgSrc = await this.callRemoveBg(imgSrc);
      if (setting.bgPrompt.trim()) {
        imgSrc = await this.callAddBackground(noBgSrc, setting.bgPrompt.trim());
      } else {
        imgSrc = noBgSrc;
      }
    }
    // 純去背
    else if (setting.removeBg) {
      imgSrc = await this.callRemoveBg(imgSrc);
    }

    // 最後做 resize + 浮水印 + LOGO
    return this.buildImage(imgSrc, setting.watermark, setting.logo);
  }

  /** 呼叫 server 去背 API */
  private async callRemoveBg(dataUrl: string): Promise<string> {
    const res = await fetch('/api/image/remove-bg', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ image: dataUrl })
    });
    if (!res.ok) throw new Error(`去背失敗: ${res.statusText}`);
    const data = await res.json();
    return data.image;
  }

  /** 呼叫 server 去背 + 加背景 API */
  private async callAddBackground(dataUrl: string, prompt: string): Promise<string> {
    const res = await fetch('/api/image/add-background', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ image: dataUrl, prompt })
    });
    if (!res.ok) throw new Error(`加背景失敗: ${res.statusText}`);
    const data = await res.json();
    return data.image;
  }

  /** 呼叫 server 純提示詞生成圖片 API */
  private async callGenerateImage(prompt: string): Promise<string> {
    const res = await fetch('/api/image/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt })
    });
    if (!res.ok) throw new Error(`圖片生成失敗: ${res.statusText}`);
    const data = await res.json();
    return data.image;
  }

  /** 上傳文案到通路商品（依各欄位設定決定字數與寫入） */
  async uploadCopy(): Promise<void> {
    const channel = this.selectedChannel();
    const productId = this.selectedProductId();
    const txtFields = this.textFields();
    const copies = this.generatedCopies();
    const enabledEntries = Object.entries(txtFields).filter(([, v]) => v.enabled);

    if (!channel || !productId) {
      alert('請選擇通路與商品');
      return;
    }
    if (!enabledEntries.length) {
      alert('請至少開啟一個文案欄位');
      return;
    }

    this.isUploading.set(true);
    this.uploadMessage.set('');

    try {
      const ref = doc(db, channel.productCollection, productId);
      const updateData: Record<string, any> = {};

      for (const [key, setting] of enabledEntries) {
        const text = copies[setting.charLimit] || '';
        if (!text) {
          alert(`請先生成 ${setting.charLimit} 字的文案`);
          this.isUploading.set(false);
          return;
        }
        updateData[key] = text;
      }

      await updateDoc(ref, updateData);
      const names = enabledEntries.map(([k]) => k === 'description' ? '長文案' : '短簡介').join('、');
      this.uploadMessage.set(`${names} 上傳成功！`);
    } catch (err: any) {
      this.uploadMessage.set('上傳失敗：' + (err.message || '未知錯誤'));
    } finally {
      this.isUploading.set(false);
    }
  }

  // ══════════════════════════════════════════
  //  清空圖文資料
  // ══════════════════════════════════════════

  /** 清空目前通路所有商品的圖文欄位（imageUrl, images, description, intro） */
  async resetAllProductContent(): Promise<void> {
    const channel = this.selectedChannel();
    const products = this.channelProducts();
    if (!channel || !products.length) {
      alert('請先選擇通路');
      return;
    }

    const confirmed = confirm(
      `確定要清空「${channel.name}」全部 ${products.length} 個商品的圖文資料？\n\n` +
      '將清除：主圖、附加圖、簡介、文案\n此操作無法復原！'
    );
    if (!confirmed) return;

    this.isResetting.set(true);
    this.uploadMessage.set('');

    try {
      // Firestore writeBatch 上限 500 筆，分批處理
      const BATCH_SIZE = 500;
      for (let i = 0; i < products.length; i += BATCH_SIZE) {
        const batch = writeBatch(db);
        const slice = products.slice(i, i + BATCH_SIZE);
        for (const cp of slice) {
          const ref = doc(db, channel.productCollection, cp.id);
          batch.update(ref, {
            imageUrl: '',
            images: [],
            description: '',
            intro: ''
          });
        }
        await batch.commit();
      }

      this.uploadMessage.set(`已清空 ${products.length} 個商品的圖文資料`);

      // 重新載入商品以更新狀態表
      await this.onChannelChange(channel.id!);
    } catch (err: any) {
      this.uploadMessage.set('清空失敗：' + (err.message || '未知錯誤'));
    } finally {
      this.isResetting.set(false);
    }
  }

  // ══════════════════════════════════════════
  //  資料夾產出
  // ══════════════════════════════════════════

  /** 產出商品資料夾 + _mapping.json */
  async scaffoldFolders(): Promise<void> {
    const channel = this.selectedChannel();
    const products = this.channelProducts();
    if (!channel || !products.length) {
      alert('請先選擇通路');
      return;
    }

    this.isScaffolding.set(true);
    this.scaffoldResult.set(null);

    try {
      const res = await fetch('/api/scaffold-folders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          channelName: channel.name,
          products: products.map(p => ({ id: p.id, name: p.name }))
        })
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || '伺服器錯誤');
      }

      const data = await res.json();
      this.scaffoldResult.set({
        ...data,
        timestamp: new Date().toISOString()
      });

      // 產出完畢後載入資料夾狀態
      await this.loadFolderStatus();
    } catch (err: any) {
      alert('產出資料夾失敗：' + (err.message || '未知錯誤'));
    } finally {
      this.isScaffolding.set(false);
    }
  }

  /** 從 server 取得資料夾狀態 */
  async loadFolderStatus(): Promise<void> {
    const channel = this.selectedChannel();
    if (!channel) return;

    try {
      const res = await fetch(`/api/folder-status/${encodeURIComponent(channel.name)}`);
      const data = await res.json();
      if (data.exists) {
        this.folderStatus.set(data.folders || []);
      } else {
        this.folderStatus.set([]);
      }
    } catch {
      this.folderStatus.set([]);
    }
  }

  // ══════════════════════════════════════════
  //  批次處理
  // ══════════════════════════════════════════

  /** 批次日誌輔助 */
  private addLog(msg: string): void {
    this.batchLog.update(prev => [...prev.slice(-49), msg]);
  }

  /** 取得需要處理的商品清單（跳過已完成的） */
  private getImagePendingProducts(): ChannelProduct[] {
    const fields = this.imageFields();
    return this.channelProducts().filter(cp => {
      if (fields['imageUrl'].enabled && !cp.imageUrl) return true;
      if (fields['images'].enabled && (!cp.images || cp.images.length === 0)) return true;
      return false;
    });
  }

  private getTextPendingProducts(): ChannelProduct[] {
    const fields = this.textFields();
    return this.channelProducts().filter(cp => {
      if (fields['description'].enabled && !cp.description) return true;
      if (fields['intro'].enabled && !cp.intro) return true;
      return false;
    });
  }

  /** 從 server 讀取指定商品的資料夾圖片 */
  private async fetchProductImages(channelName: string, productName: string): Promise<{ filename: string; dataUrl: string }[]> {
    const safeName = productName.replace(/[<>:"/\\|?*]/g, '_').trim();
    const res = await fetch(`/api/product-images/${encodeURIComponent(channelName)}/${encodeURIComponent(safeName)}`);
    const data = await res.json();
    return data.images || [];
  }

  /** 開始批次圖片（從 D:\AI_Products 資料夾讀取各商品圖片） */
  async startBatchImages(): Promise<void> {
    const channel = this.selectedChannel();
    if (!channel) { alert('請先選擇通路'); return; }

    const pending = this.getImagePendingProducts();
    if (!pending.length) {
      this.addLog('所有商品圖片已完成，跳到文案階段');
      this.batchPhase.set('texts');
      return;
    }

    this.batchPhase.set('images');
    this.batchRunning.set(true);
    this.batchPaused.set(false);
    this.batchProcessed.set(0);
    this.batchTotal.set(pending.length);
    this.batchLog.set([`開始批次圖片 (${pending.length} 個待處理)`]);

    const fields = this.imageFields();

    for (let i = 0; i < pending.length; i++) {
      // 檢查暫停
      if (this.batchPaused()) {
        this.addLog(`已暫停，完成 ${i}/${pending.length}`);
        this.batchRunning.set(false);
        return;
      }

      const cp = pending[i];
      this.batchCurrentProductId.set(cp.id);
      this.addLog(`[${i + 1}/${pending.length}] 處理圖片：${cp.name}`);

      try {
        // 從本機資料夾讀取圖片
        const folderImages = await this.fetchProductImages(channel.name, cp.name);
        if (!folderImages.length) {
          this.addLog(`⚠ ${cp.name}：資料夾無圖片，跳過`);
          this.batchProcessed.set(i + 1);
          continue;
        }

        const ref = doc(db, channel.productCollection, cp.id);
        const updateData: Record<string, any> = {};

        // 主圖：取第一張，走完整加工流程
        if (fields['imageUrl'].enabled && !cp.imageUrl) {
          const imgSetting = fields['imageUrl'];
          if (imgSetting.purePrompt && imgSetting.purePromptText.trim()) {
            updateData['imageUrl'] = await this.buildImageAdvanced('', imgSetting);
            this.addLog(`  → 主圖：AI 純提示詞生成`);
          } else {
            updateData['imageUrl'] = await this.buildImageAdvanced(folderImages[0].dataUrl, imgSetting);
            const mode = imgSetting.removeBg ? '(去背)' : imgSetting.addBg ? '(去背+加背景)' : '';
            this.addLog(`  → 主圖：${folderImages[0].filename} ${mode}`);
          }
        }

        // 附加圖：主圖用第一張，附加圖用剩餘的（若只有一張則也用第一張）
        if (fields['images'].enabled && (!cp.images || cp.images.length === 0)) {
          const imgSetting = fields['images'];
          // 純提示詞模式：不需要資料夾圖片
          if (imgSetting.purePrompt && imgSetting.purePromptText.trim()) {
            const generated = await this.buildImageAdvanced('', imgSetting);
            updateData['images'] = [generated];
            this.addLog(`  → 附加圖：AI 純提示詞生成 1 張`);
          } else {
            const extraImages = folderImages.length > 1 ? folderImages.slice(1) : folderImages;
            const processed: string[] = [];
            for (const img of extraImages) {
              processed.push(await this.buildImageAdvanced(img.dataUrl, imgSetting));
            }
            updateData['images'] = processed;
            const mode = imgSetting.removeBg ? '(去背)' : imgSetting.addBg ? '(去背+加背景)' : '';
            this.addLog(`  → 附加圖：${extraImages.length} 張 ${mode}`);
          }
        }

        if (Object.keys(updateData).length) {
          await updateDoc(ref, updateData);
          this.addLog(`✓ ${cp.name}：圖片上傳完成`);
        }
      } catch (err: any) {
        this.addLog(`✗ ${cp.name}：失敗 - ${err.message || '未知錯誤'}`);
      }

      this.batchProcessed.set(i + 1);
    }

    // 圖片全部完成，重新載入商品狀態
    await this.onChannelChange(channel.id!);
    this.batchCurrentProductId.set('');
    this.batchRunning.set(false);
    this.addLog('圖片批次完成！可以開始文案階段');
    this.batchPhase.set('texts');
  }

  /** 開始批次文案 */
  async startBatchTexts(): Promise<void> {
    const channel = this.selectedChannel();
    if (!channel) { alert('請先選擇通路'); return; }

    if (this.ollamaService.connectionStatus() !== 'connected') {
      alert('請先啟動 Ollama 並確認連線');
      return;
    }

    const pending = this.getTextPendingProducts();
    if (!pending.length) {
      this.addLog('所有商品文案已完成');
      this.batchPhase.set('done');
      return;
    }

    this.batchPhase.set('texts');
    this.batchRunning.set(true);
    this.batchPaused.set(false);
    this.batchProcessed.set(0);
    this.batchTotal.set(pending.length);
    this.addLog(`開始批次文案 (${pending.length} 個待處理)`);

    const txtFields = this.textFields();

    for (let i = 0; i < pending.length; i++) {
      if (this.batchPaused()) {
        this.addLog(`已暫停，完成 ${i}/${pending.length}`);
        this.batchRunning.set(false);
        return;
      }

      const cp = pending[i];
      this.batchCurrentProductId.set(cp.id);
      this.addLog(`[${i + 1}/${pending.length}] 生成文案：${cp.name}`);

      try {
        const ref = doc(db, channel.productCollection, cp.id);
        const updateData: Record<string, any> = {};

        if (txtFields['description'].enabled && !cp.description) {
          const text = await this.ollamaService.generateCopy(cp.name, txtFields['description'].charLimit);
          updateData['description'] = text;
          this.addLog(`  → 長文案 (${txtFields['description'].charLimit}字)：${text}`);
        }
        if (txtFields['intro'].enabled && !cp.intro) {
          const text = await this.ollamaService.generateCopy(cp.name, txtFields['intro'].charLimit);
          updateData['intro'] = text;
          this.addLog(`  → 短簡介 (${txtFields['intro'].charLimit}字)：${text}`);
        }

        if (Object.keys(updateData).length) {
          await updateDoc(ref, updateData);
          this.addLog(`✓ ${cp.name}：文案上傳完成`);
        }
      } catch (err: any) {
        this.addLog(`✗ ${cp.name}：失敗 - ${err.message || '未知錯誤'}`);
      }

      this.batchProcessed.set(i + 1);
    }

    await this.onChannelChange(channel.id!);
    this.batchCurrentProductId.set('');
    this.batchRunning.set(false);
    this.addLog('文案批次完成！全部作業結束');
    this.batchPhase.set('done');
  }

  /** 暫停批次 */
  pauseBatch(): void {
    this.batchPaused.set(true);
    this.addLog('暫停中…等待目前商品處理完畢');
  }

  /** 重設批次（回到 idle） */
  resetBatch(): void {
    this.batchPhase.set('idle');
    this.batchRunning.set(false);
    this.batchPaused.set(false);
    this.batchCurrentProductId.set('');
    this.batchProcessed.set(0);
    this.batchTotal.set(0);
    this.batchLog.set([]);
  }
}
