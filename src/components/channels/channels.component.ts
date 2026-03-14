import { ChangeDetectionStrategy, ChangeDetectorRef, Component, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import {
  collection, getDocs, doc, getDoc, setDoc, updateDoc
} from 'firebase/firestore';
import { db } from '../../firebase.config';
import {
  Channel, ChannelType, ChannelProduct, ChannelOrderSummary, Product
} from '../../models/erp.models';

type ChannelView = 'overview' | 'products' | 'orders' | 'settings';
type PriceAdjustMode = 'fixed' | 'percent';

@Component({
  selector: 'app-channels',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.Default,
  imports: [CommonModule, FormsModule],
  templateUrl: './channels.component.html',
})
export class ChannelsComponent implements OnInit {

  private cdr = inject(ChangeDetectorRef);

  // ── 狀態 ──────────────────────────────────────────────────────────────────
  channels: Channel[] = [];
  selectedChannel: Channel | null = null;
  activeView: ChannelView = 'overview';

  // 商品匯入
  erpProducts: Product[] = [];
  channelProducts: ChannelProduct[] = [];

  // ── 價格調整 ──────────────────────────────────────────────────────────────
  priceAdjustMode: PriceAdjustMode = 'fixed';
  priceAdjustValue: number = 0;
  priceAdjusting = false;

  /** 根據 ERP priceBeforeTax 計算調整後售價 */
  calcAdjustedPrice(priceBeforeTax: number): number {
    if (this.priceAdjustMode === 'fixed') {
      return Math.max(0, priceBeforeTax + this.priceAdjustValue);
    } else {
      // 百分比，四捨五入到十位數
      const raw = priceBeforeTax * (1 + this.priceAdjustValue / 100);
      return Math.max(0, Math.round(raw / 10) * 10);
    }
  }

  /** 取得對應 ERP product 的 priceBeforeTax（從 erpProducts 查找） */
  getErpPrice(channelProduct: ChannelProduct): number {
    const erp = this.erpProducts.find(p => p.id === channelProduct.id);
    return erp?.priceBeforeTax ?? 0;
  }

  /** 套用價格調整到所有已匯入通路商品並寫入 Firebase */
  async applyPriceAdjustment() {
    if (!this.selectedChannel || this.channelProducts.length === 0) return;
    this.priceAdjusting = true;
    try {
      for (const cp of this.channelProducts) {
        const erpPrice = this.getErpPrice(cp);
        const newPrice = this.calcAdjustedPrice(erpPrice);
        const ref = doc(db, this.selectedChannel.productCollection, cp.id);
        await updateDoc(ref, { price: newPrice });
        cp.price = newPrice;
      }
    } finally {
      this.priceAdjusting = false;
      this.cdr.markForCheck();
    }
  }
  selectedProductIds = new Set<string>();
  importLoading = false;
  importProgress = 0;

  // 新增通路
  showAddChannelModal = false;
  newChannel: Partial<Channel> = {
    types: [],
    visible: true,
  };

  // 訂單匯總
  orderSummaries: ChannelOrderSummary[] = [];

  loading = true;
  searchQuery = '';

  readonly CHANNEL_TYPE_LABELS: Record<ChannelType, string> = {
    wholesale: '批發',
    retail: '零售',
    other: '其他',
  };

  ngOnInit() {
    this.loadChannels();
    this.loadErpProducts();
  }

  // ── 載入通路列表 ──────────────────────────────────────────────────────────
  async loadChannels() {
    this.loading = true;
    try {
      const snap = await getDocs(collection(db, 'channels'));
      this.channels = snap.docs.map(d => ({ id: d.id, ...d.data() } as Channel));
    } catch (e) {
      console.error('載入通路失敗', e);
    } finally {
      this.loading = false;
      this.cdr.markForCheck();
    }
  }

  // ── 載入 ERP 商品 ─────────────────────────────────────────────────────────
  async loadErpProducts() {
    try {
      const snap = await getDocs(collection(db, 'products'));
      this.erpProducts = snap.docs
        .map(d => ({ id: d.id, ...d.data() } as Product))
        .filter(p => !p.isDiscontinued)
        .sort((a, b) => a.name.localeCompare(b.name));
    } catch (e) {
      console.error('載入 ERP 商品失敗', e);
    } finally {
      this.cdr.markForCheck();
    }
  }

  // ── 選取通路，進入管理 ────────────────────────────────────────────────────
  async selectChannel(channel: Channel) {
    this.selectedChannel = channel;
    this.activeView = 'products';
    this.selectedProductIds.clear();
    await this.loadChannelProducts(channel);
    await this.loadOrderSummary(channel);
    this.cdr.markForCheck();
  }

  // ── 載入通路已上架商品 ────────────────────────────────────────────────────
  async loadChannelProducts(channel: Channel) {
    try {
      const snap = await getDocs(collection(db, channel.productCollection));
      this.channelProducts = snap.docs.map(d => ({ id: d.id, ...d.data() } as ChannelProduct));
    } catch (e) {
      this.channelProducts = [];
    } finally {
      this.cdr.markForCheck();
    }
  }

  // ── 載入訂單匯總 ──────────────────────────────────────────────────────────
  async loadOrderSummary(channel: Channel) {
    try {
      const snap = await getDocs(collection(db, channel.orderCollection));
      const orders = snap.docs.map(d => d.data());
      this.orderSummaries = [{
        channelId: channel.id,
        channelName: channel.name,
        totalOrders: orders.length,
        pendingOrders: orders.filter((o: any) => o.status === 'pending').length,
        shippedOrders: orders.filter((o: any) => o.status === 'shipped').length,
        totalRevenue: orders.reduce((sum: number, o: any) => sum + (o.totalAmount || 0), 0),
        updatedAt: new Date().toISOString(),
      }];
    } catch (e) {
      this.orderSummaries = [];
    } finally {
      this.cdr.markForCheck();
    }
  }

  // ── 判斷商品是否已在通路上架 ─────────────────────────────────────────────
  isProductInChannel(productId: string): boolean {
    return this.channelProducts.some(p => p.id === productId);
  }

  // ── 全選 / 取消全選 ───────────────────────────────────────────────────────
  toggleSelectAll() {
    if (this.selectedProductIds.size === this.filteredErpProducts.length) {
      this.selectedProductIds.clear();
    } else {
      this.filteredErpProducts.forEach(p => this.selectedProductIds.add(p.id));
    }
  }

  toggleProduct(productId: string) {
    if (this.selectedProductIds.has(productId)) {
      this.selectedProductIds.delete(productId);
    } else {
      this.selectedProductIds.add(productId);
    }
  }

  // ── 一鍵推送選取商品到通路 collection ────────────────────────────────────
  async importSelected() {
    if (!this.selectedChannel || this.selectedProductIds.size === 0) return;
    this.importLoading = true;
    this.importProgress = 0;

    const selected = this.erpProducts.filter(p => this.selectedProductIds.has(p.id));
    const now = new Date().toISOString();
    let done = 0;

    for (const product of selected) {
      const channelProduct: ChannelProduct = {
        id: product.id,
        productRef: product.id,
        channelId: this.selectedChannel.id,
        // 通路專屬（初始空白，等 AI 工具產生）
        imageUrl: product.imageUrl || '',
        images: [],
        description: '',
        price: (product as any).recommendedPrice || (product as any).priceAfterTax || 0,
        visible: false,                  // 預設不上架，等圖文準備好再開啟
        // 從 ERP 複製的快照
        name: product.name,
        category: product.category,
        origin: product.origin || '',
        unit: product.unit,
        moq: product.moq || 1,
        sugar: (product as any).sugar || false,
        shelfLife: (product as any).shelfLife || '',
        highlightNote: (product as any).highlightNote || '',
        expiryNote: (product as any).expiryNote || '',
        nutritionLabelUrl: (product as any).nutritionLabelUrl || '',
        isDiscontinued: product.isDiscontinued,
        syncedAt: now,
        createdAt: now,
      };

      // 寫入通路專屬 collection
      await setDoc(
        doc(db, this.selectedChannel.productCollection, product.id),
        channelProduct
      );

      // 同步更新 ERP product 的 channelRefs
      const erpRef = doc(db, 'products', product.id);
      const existing = (await getDoc(erpRef)).data() as Product | undefined;
      const refs = new Set((existing as any)?.channelRefs || []);
      refs.add(this.selectedChannel.id);
      await updateDoc(erpRef, { channelRefs: Array.from(refs) });

      done++;
      this.importProgress = Math.round((done / selected.length) * 100);
    }

    await this.loadChannelProducts(this.selectedChannel);
    this.selectedProductIds.clear();
    this.importLoading = false;
    this.importProgress = 0;
    this.cdr.markForCheck();
  }

  // ── 切換通路商品上架狀態 ──────────────────────────────────────────────────
  async toggleChannelProductVisibility(product: ChannelProduct) {
    if (!this.selectedChannel) return;
    const ref = doc(db, this.selectedChannel.productCollection, product.id);
    await updateDoc(ref, { visible: !product.visible });
    product.visible = !product.visible;
    this.cdr.markForCheck();
  }

  // ── 新增通路 ──────────────────────────────────────────────────────────────
  async createChannel() {
    if (!this.newChannel.name || !this.newChannel.id) return;
    const id = this.newChannel.id;
    const channel: Channel = {
      id,
      name: this.newChannel.name!,
      types: this.newChannel.types || [],
      websiteUrl: this.newChannel.websiteUrl || '',
      productCollection: `${id}_products`,
      orderCollection: `${id}_orders`,
      inventoryCollection: `${id}_inventory`,
      description: this.newChannel.description || '',
      logoUrl: '',
      visible: true,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    await setDoc(doc(db, 'channels', id), channel);
    this.channels.push(channel);
    this.showAddChannelModal = false;
    this.newChannel = { types: [], visible: true };
    this.cdr.markForCheck();
  }

  toggleNewChannelType(type: ChannelType) {
    const types = this.newChannel.types || [];
    const idx = types.indexOf(type);
    if (idx >= 0) types.splice(idx, 1);
    else types.push(type);
    this.newChannel.types = [...types];
  }

  // ── 篩選 ──────────────────────────────────────────────────────────────────
  get filteredErpProducts(): Product[] {
    if (!this.searchQuery) return this.erpProducts;
    const q = this.searchQuery.toLowerCase();
    return this.erpProducts.filter(p =>
      p.name.toLowerCase().includes(q) || p.category.toLowerCase().includes(q)
    );
  }

  get channelTypeLabel(): (types: ChannelType[]) => string {
    return (types) => types.map(t => this.CHANNEL_TYPE_LABELS[t]).join('・');
  }

  backToOverview() {
    this.selectedChannel = null;
    this.activeView = 'overview';
    this.channelProducts = [];
    this.orderSummaries = [];
  }
}
