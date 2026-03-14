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
  /** 是否啟用 LOGO */
  enableLogo = signal(false);
  /** LOGO 圖片 (base64) */
  logoImage = signal<string>(localStorage.getItem('erp_logo_image') || '');
  /** 圖片處理中 */
  isProcessing = signal(false);

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
  /** 上傳目標欄位（圖片） */
  imageTargetField = signal<'imageUrl' | 'images'>('imageUrl');
  /** 上傳目標欄位（文案） */
  copyTargetField = signal<'description' | 'intro'>('description');
  /** 上傳中 */
  isUploading = signal(false);
  /** 上傳結果訊息 */
  uploadMessage = signal('');
  /** 清空中 */
  isResetting = signal(false);

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

      // 浮水印
      if (this.enableWatermark()) {
        const text = this.watermarkText() || '一吉水果乾';
        ctx.save();
        ctx.globalAlpha = 0.25;
        ctx.fillStyle = '#FFFFFF';
        ctx.font = 'bold 48px "Microsoft JhengHei", sans-serif';
        ctx.textAlign = 'center';
        // 斜向重複浮水印
        ctx.translate(SIZE / 2, SIZE / 2);
        ctx.rotate(-Math.PI / 6);
        for (let y = -SIZE; y < SIZE; y += 150) {
          for (let x = -SIZE; x < SIZE; x += 400) {
            ctx.fillText(text, x, y);
          }
        }
        ctx.restore();
      }

      // 壓 LOGO（右下角）
      if (this.enableLogo() && this.logoImage()) {
        const logoImg = await this.loadImage(this.logoImage());
        const logoSize = 120;
        const margin = 30;
        // 等比例縮放 LOGO
        const logoScale = Math.min(logoSize / logoImg.width, logoSize / logoImg.height);
        const lw = logoImg.width * logoScale;
        const lh = logoImg.height * logoScale;
        ctx.drawImage(logoImg, SIZE - lw - margin, SIZE - lh - margin, lw, lh);
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
    } catch (err) {
      console.error('載入通路商品失敗:', err);
    }
  }

  /** 上傳圖片到通路商品 */
  async uploadImage(): Promise<void> {
    const channel = this.selectedChannel();
    const productId = this.selectedProductId();
    const image = this.processedImage();
    if (!channel || !productId || !image) {
      alert('請選擇通路、商品，並完成圖片加工');
      return;
    }

    this.isUploading.set(true);
    this.uploadMessage.set('');

    try {
      const ref = doc(db, channel.productCollection, productId);
      const field = this.imageTargetField();

      if (field === 'imageUrl') {
        await updateDoc(ref, { imageUrl: image });
      } else {
        // 附加到 images 陣列
        const product = this.channelProducts().find(p => p.id === productId);
        const currentImages = product?.images || [];
        await updateDoc(ref, { images: [...currentImages, image] });
      }
      this.uploadMessage.set('圖片上傳成功！');
    } catch (err: any) {
      this.uploadMessage.set('上傳失敗：' + (err.message || '未知錯誤'));
    } finally {
      this.isUploading.set(false);
    }
  }

  /** 上傳文案到通路商品 */
  async uploadCopy(): Promise<void> {
    const channel = this.selectedChannel();
    const productId = this.selectedProductId();
    const limit = this.charLimit();
    const text = this.generatedCopies()[limit];
    if (!channel || !productId || !text) {
      alert('請選擇通路、商品，並先生成文案');
      return;
    }

    this.isUploading.set(true);
    this.uploadMessage.set('');

    try {
      const ref = doc(db, channel.productCollection, productId);
      const field = this.copyTargetField();
      await updateDoc(ref, { [field]: text });
      this.uploadMessage.set('文案上傳成功！');
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
}
