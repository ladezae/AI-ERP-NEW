import { ChangeDetectionStrategy, ChangeDetectorRef, Component, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import {
  collection, getDocs, doc, getDoc, setDoc, updateDoc, deleteDoc, addDoc
} from 'firebase/firestore';
import { db } from '../../firebase.config';
import {
  Channel, ChannelType, ChannelProduct, ChannelOrderSummary, Product, ProductCodeMapping
} from '../../models/erp.models';

type ChannelView = 'overview' | 'products' | 'orders' | 'settings';
type TopView = 'channels' | 'codes';
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
  topView: TopView = 'channels'; // 頂層 Tab：通路列表 / 品號對照表

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

  // 通路已匯入商品分頁
  channelProductPage = 1;
  readonly channelProductPageSize = 10;

  get channelProductTotalPages(): number {
    return Math.ceil(this.channelProducts.length / this.channelProductPageSize);
  }

  get pagedChannelProducts(): ChannelProduct[] {
    const start = (this.channelProductPage - 1) * this.channelProductPageSize;
    return this.channelProducts.slice(start, start + this.channelProductPageSize);
  }

  channelProductPageRange(): number[] {
    const total = this.channelProductTotalPages;
    const cur = this.channelProductPage;
    // 顯示最多 5 個頁碼，當前頁居中
    const range: number[] = [];
    let start = Math.max(1, cur - 2);
    let end = Math.min(total, start + 4);
    if (end - start < 4) start = Math.max(1, end - 4);
    for (let i = start; i <= end; i++) range.push(i);
    return range;
  }

  // 新增通路
  showAddChannelModal = false;
  newChannel: Partial<Channel> = {
    types: [],
    visible: true,
  };

  // 訂單匯總
  orderSummaries: ChannelOrderSummary[] = [];

  loading = true;

  // ── 篩選條件 ─────────────────────────────────────────────────────────────
  searchQuery = '';
  filterSupplier = '';
  filterControl: '' | 'true' | 'false' = '';
  filterSalesStatus: 'selling' | 'discontinued' | '' = 'selling'; // 預設：銷售中
  sortField: 'default' | 'name' | 'category' | 'price' = 'default';
  sortAsc = true;

  /** 預設顯示的商品分類（進入管理頁即自動套用） */
  readonly PRESET_CATEGORIES = ['水果乾', '水果凍乾', '沖泡類', '蔬果脆片', '蜜餞', '零食'];

  /** 目前已選取的分類集合；空集合 = 全部分類 */
  filterCategories: Set<string> = new Set(this.PRESET_CATEGORIES);

  toggleFilterCategory(cat: string) {
    if (this.filterCategories.has(cat)) {
      this.filterCategories.delete(cat);
    } else {
      this.filterCategories.add(cat);
    }
    // 觸發 Angular 髒檢查
    this.filterCategories = new Set(this.filterCategories);
  }

  /** 清除所有分類篩選（等同「全部分類」） */
  clearCategoryFilter() {
    this.filterCategories = new Set();
  }

  /** 重設回預設 6 類 */
  resetCategoryFilter() {
    this.filterCategories = new Set(this.PRESET_CATEGORIES);
  }

  get isAllCategorySelected(): boolean {
    return this.filterCategories.size === 0;
  }

  /** 動態供應商選項（從 ERP 商品取得唯一值） */
  get supplierOptions(): string[] {
    return [...new Set(this.erpProducts.map(p => p.supplierName).filter(Boolean))].sort();
  }

  /** 動態分類選項（從 ERP 商品取得唯一值，合併預設 + 其他） */
  get categoryOptions(): string[] {
    const fromErp = [...new Set(this.erpProducts.map(p => p.category).filter(Boolean))];
    // 預設 6 類優先排前，其餘補在後
    const extras = fromErp.filter(c => !this.PRESET_CATEGORIES.includes(c)).sort();
    return [...this.PRESET_CATEGORIES.filter(c => fromErp.includes(c)), ...extras];
  }

  readonly CHANNEL_TYPE_LABELS: Record<ChannelType, string> = {
    wholesale: '批發',
    retail: '零售',
    other: '其他',
  };

  // ── 品號對照表 ────────────────────────────────────────────────────────────
  codeMappings: ProductCodeMapping[] = [];
  codeMappingLoading = false;
  showAddMappingModal = false;
  batchCreating = false;
  deletingMappingId: string | null = null;
  codeSearchQuery = '';

  // 批次建立品號的表單
  batchForm: {
    channelId: string;     // 歸屬品牌通路
    prefix: string;
    erpCategory: string;   // 選擇的 ERP 分類名稱（如「水果乾」）
    categoryCode: string;  // 對應的 2 碼分類碼（手輸）
  } = { channelId: '', prefix: '', erpCategory: '', categoryCode: '' };

  // 品號對照表 — 通路篩選
  codeFilterChannelId = '';

  /** 批次建立時：該分類下銷售中的商品（不含已有品號的） */
  get batchPreviewProducts(): Product[] {
    const p = this.batchForm.prefix.toUpperCase().slice(0, 3);
    const c = this.batchForm.categoryCode.toUpperCase().slice(0, 2);
    if (!p || p.length < 3 || !c || c.length < 2 || !this.batchForm.erpCategory) return [];

    // 取得該分類銷售中的商品
    const inCategory = this.erpProducts.filter(
      pr => pr.category === this.batchForm.erpCategory && !pr.isDiscontinued
    );

    // 排除已有 prefix+categoryCode 對應記錄的（用 erpProductId 比對）
    const alreadyMapped = new Set(
      this.codeMappings
        .filter(m => m.prefix === p && m.categoryCode === c)
        .map(m => m.erpProductId)
    );

    return inCategory.filter(pr => !alreadyMapped.has(pr.id));
  }

  /** 計算下一個可用流水號（同前綴+分類碼下最大值+1，已用過的不再重複） */
  getNextSerial(prefix: string, categoryCode: string): number {
    const existing = this.codeMappings.filter(
      m => m.prefix === prefix && m.categoryCode === categoryCode
    );
    if (existing.length === 0) return 1;
    return Math.max(...existing.map(m => m.serial)) + 1;
  }

  /** 篩選後的品號對照清單（支援通路 + 關鍵字） */
  get filteredCodeMappings(): ProductCodeMapping[] {
    let list = this.codeMappings;

    // 通路篩選
    if (this.codeFilterChannelId) {
      list = list.filter(m => m.channelId === this.codeFilterChannelId);
    }

    // 關鍵字搜尋
    if (this.codeSearchQuery) {
      const q = this.codeSearchQuery.toLowerCase();
      list = list.filter(m =>
        m.externalCode.toLowerCase().includes(q) ||
        m.erpProductId.toLowerCase().includes(q) ||
        m.erpProductName.toLowerCase().includes(q) ||
        (m.note || '').toLowerCase().includes(q) ||
        m.channelName.toLowerCase().includes(q)
      );
    }

    return list;
  }

  async loadCodeMappings() {
    this.codeMappingLoading = true;
    try {
      const snap = await getDocs(collection(db, 'productCodeMappings'));
      this.codeMappings = snap.docs
        .map(d => ({ id: d.id, ...d.data() } as ProductCodeMapping))
        .sort((a, b) => a.externalCode.localeCompare(b.externalCode));
    } catch (e) {
      console.error('載入品號對照表失敗', e);
    } finally {
      this.codeMappingLoading = false;
      this.cdr.markForCheck();
    }
  }

  /** 批次建立品號：將 batchPreviewProducts 全部配予流水號 */
  async createBatchCodeMappings() {
    const p = this.batchForm.prefix.toUpperCase().slice(0, 3);
    const c = this.batchForm.categoryCode.toUpperCase().slice(0, 2);
    const chId = this.batchForm.channelId;
    const products = this.batchPreviewProducts;
    if (!p || !c || !chId || products.length === 0) return;

    // 取得通路名稱快照
    const chName = this.channels.find(ch => ch.id === chId)?.name || chId;

    this.batchCreating = true;
    let serial = this.getNextSerial(p, c);
    const now = new Date().toISOString();
    const created: ProductCodeMapping[] = [];

    try {
      for (const pr of products) {
        const externalCode = `${p}-${c}-${String(serial).padStart(3, '0')}`;
        const mapping: Omit<ProductCodeMapping, 'id'> = {
          channelId: chId,
          channelName: chName,
          externalCode,
          prefix: p,
          categoryCode: c,
          serial,
          erpProductId: pr.id,
          erpProductName: pr.name,
          note: '',
          createdAt: now,
          updatedAt: now,
        };
        const ref = await addDoc(collection(db, 'productCodeMappings'), mapping);
        created.push({ id: ref.id, ...mapping });
        serial++;
      }
      this.codeMappings = [...this.codeMappings, ...created]
        .sort((a, b) => a.externalCode.localeCompare(b.externalCode));
      this.showAddMappingModal = false;
      this.batchForm = { channelId: '', prefix: '', erpCategory: '', categoryCode: '' };
    } catch (e) {
      console.error('批次建立品號失敗', e);
    } finally {
      this.batchCreating = false;
      this.cdr.markForCheck();
    }
  }

  async deleteCodeMapping(mapping: ProductCodeMapping) {
    if (!confirm(`確定刪除品號 ${mapping.externalCode}？此操作無法還原。`)) return;
    this.deletingMappingId = mapping.id;
    try {
      await deleteDoc(doc(db, 'productCodeMappings', mapping.id));
      this.codeMappings = this.codeMappings.filter(m => m.id !== mapping.id);
    } catch (e) {
      console.error('刪除品號失敗', e);
    } finally {
      this.deletingMappingId = null;
      this.cdr.markForCheck();
    }
  }

  ngOnInit() {
    this.loadChannels();
    this.loadErpProducts();
    this.loadCodeMappings();
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
    this.channelProductPage = 1; // 重設分頁
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

  // ── 篩選 + 排序 ───────────────────────────────────────────────────────────
  get filteredErpProducts(): Product[] {
    let products = this.erpProducts;

    // 銷售狀態
    if (this.filterSalesStatus === 'selling') {
      products = products.filter(p => !p.isDiscontinued);
    } else if (this.filterSalesStatus === 'discontinued') {
      products = products.filter(p => p.isDiscontinued);
    }

    // 供應商
    if (this.filterSupplier) {
      products = products.filter(p => p.supplierName === this.filterSupplier);
    }

    // 商品分類（多選）；空集合代表全部
    if (this.filterCategories.size > 0) {
      products = products.filter(p => this.filterCategories.has(p.category));
    }

    // 控管狀態
    if (this.filterControl !== '') {
      const ctrl = this.filterControl === 'true';
      products = products.filter(p => p.controlStatus === ctrl);
    }

    // 關鍵字搜尋（名稱 / ID）
    if (this.searchQuery) {
      const q = this.searchQuery.toLowerCase();
      products = products.filter(p =>
        p.name.toLowerCase().includes(q) ||
        p.category.toLowerCase().includes(q) ||
        p.id.toLowerCase().includes(q) ||
        (p.supplierName || '').toLowerCase().includes(q)
      );
    }

    // 排序
    const sorted = [...products];
    sorted.sort((a, b) => {
      let cmp = 0;
      if (this.sortField === 'name') cmp = a.name.localeCompare(b.name, 'zh-Hant');
      else if (this.sortField === 'category') cmp = a.category.localeCompare(b.category, 'zh-Hant');
      else if (this.sortField === 'price') cmp = (a.priceBeforeTax || 0) - (b.priceBeforeTax || 0);
      else cmp = a.name.localeCompare(b.name, 'zh-Hant'); // 預設排序
      return this.sortAsc ? cmp : -cmp;
    });

    return sorted;
  }

  toggleSort(field: typeof this.sortField) {
    if (this.sortField === field) {
      this.sortAsc = !this.sortAsc;
    } else {
      this.sortField = field;
      this.sortAsc = true;
    }
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
