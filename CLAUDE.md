你是 AI ERP 高手，幫我解決系統問題，給予建議。所有程式碼註解與 commit message 請用繁體中文。

# AI-ERP-NEW 技術備忘

## 專案概述
一吉水果乾批發零售的 ERP 系統，整合 AI 助手（Gemini）、多通路管理、財務、庫存、訂單、出貨、採購、代工等功能。前端為 Angular SPA，後端為 Express 靜態檔案伺服器，資料庫使用 Firebase Firestore。

## 技術棧
- **前端框架**: Angular 21 (Standalone Components, Signals, OnPush)
- **UI 元件庫**: Angular Material 21 + Tailwind CSS
- **語言**: TypeScript 5.8, ES2022
- **建構工具**: Vite (透過 @angular/build)
- **後端**: Express 5 (server.js) — 僅提供靜態檔案 + 少量 API endpoint
- **資料庫**: Firebase Firestore (直接從前端連線，無後端 ORM)
- **AI**: Google Gemini (@google/generative-ai)，API Key 可透過 server.js 的 `/api/config/gemini-key` 取得
- **PDF/Excel**: jspdf + html2canvas (PDF 匯出), xlsx (Excel 匯出)
- **圖表**: D3.js 7.9
- **容器化**: Docker (Node 20-slim)
- **部署**: Google Cloud Run (透過 Cloud Build)
- **版本控制**: GitHub (git@github.com:ladezae/AI-ERP-NEW.git), 單一 main 分支

## 專案結構
```
AI-ERP-NEW/
├── server.js              # Express 伺服器 (靜態檔案 + API)
├── Dockerfile             # Cloud Run 部署用
├── src/
│   ├── app/
│   │   ├── app.component.ts   # 主元件 (含所有模組切換邏輯)
│   │   ├── app.routes.ts      # 路由 (目前僅 mobile-quote)
│   │   └── app.config.ts
│   ├── components/        # 所有功能模組元件
│   │   ├── dashboard/     # 儀表板
│   │   ├── products/      # 商品管理
│   │   ├── orders/        # 訂單管理
│   │   ├── purchases/     # 採購管理
│   │   ├── shipping/      # 出貨管理
│   │   ├── manufacturing/ # 代工管理
│   │   ├── customers/     # 客戶管理
│   │   ├── suppliers/     # 供應商管理
│   │   ├── finance/       # 財務 (發票管理)
│   │   ├── petty-cash/    # 零用金
│   │   ├── inventory-allocator/ # 庫存分配
│   │   ├── price-calculator/    # 定價計算
│   │   ├── channels/      # 通路管理
│   │   ├── employees/     # 員工 & 權限
│   │   ├── brand-management/    # 品牌管理
│   │   ├── reports/       # 報表
│   │   ├── ai-assistant/  # AI 聊天助手
│   │   ├── ai-training/   # AI 訓練
│   │   ├── smart-import/  # 智慧匯入
│   │   ├── tasks/         # 任務中心
│   │   ├── notebook/      # 筆記本
│   │   ├── export-config/ # 列印範本設定
│   │   ├── definitions/   # 資料字典
│   │   ├── system/        # 系統設定
│   │   ├── company-profile/# 公司資料
│   │   ├── login/         # 登入
│   │   ├── mobile-quote/  # 手機報價 (免登入)
│   │   ├── mobile-layout/ # 手機版面設定
│   │   ├── external-portal/ # 外部入口
│   │   ├── sidebar/       # 側邊欄
│   │   └── bottom-nav/    # 底部導覽 (手機版)
│   ├── services/
│   │   ├── data.service.ts    # 核心資料服務 (Firestore CRUD, Signals)
│   │   ├── ai.service.ts      # Gemini AI 服務
│   │   ├── edge-ai.service.ts # Edge AI 服務
│   │   ├── order.service.ts   # 訂單相關邏輯
│   │   ├── excel.service.ts   # Excel 匯出
│   │   ├── pdf.service.ts     # PDF 匯出
│   │   ├── print.service.ts   # 列印服務
│   │   ├── image.service.ts   # 圖片處理
│   │   └── screen.service.ts  # 螢幕/RWD 偵測
│   ├── models/
│   │   └── erp.models.ts # 所有 TypeScript 介面定義
│   ├── pipes/             # taiwan-date, safe-html
│   ├── directives/        # resizable directive
│   └── utils/             # date.utils.ts
├── yiji-website/          # 一吉前台網站 (Next.js, 獨立子專案)
└── scripts/
    └── migrate-order-subtotal.js  # 資料遷移腳本
```

## Firebase 設定
- Project ID: `new-angular-298fe`
- 前端直接連線 Firestore，設定在 `src/firebase.config.ts`
- 支援 LocalStorage 自訂 Firebase config (`erp_custom_firebase_config`)
- 若 Firebase 初始化失敗，系統會進入 Mock Mode

## 重要 Collections (Firestore)
products, orders, shippingOrders, purchaseOrders, customers, suppliers, employees, roles, companies, brands, invoices, pettyCashTransactions, tasks, notes, pricingCalculations, shippingTemplates, communicationTemplates, exportTemplates, mobilePages, specDefinitions, aiUsageLogs, systemSettings, metricDefinitions, schemas, channels, {channelId}_products, {channelId}_orders, {channelId}_inventory

## 架構特點
- **Standalone Components**: 所有元件皆為 standalone，無 NgModule
- **Signals**: 使用 Angular Signals 做狀態管理 (非 RxJS Subject)
- **OnPush**: 主元件使用 ChangeDetectionStrategy.OnPush
- **SPA 切換**: 大部分頁面透過 ViewType signal 切換，非 Router
- **登入保護**: 需登入才能使用，mobile-quote 例外（免登入）
- **RWD**: 支援桌面與手機版面，手機版有底部導覽

## 部署流程
1. `npm run build` (Angular 編譯到 dist/)
2. Docker build (Node 20-slim)
3. 推送到 GitHub → 觸發 Google Cloud Build
4. 部署到 Google Cloud Run (PORT 由環境變數決定，預設 8080)

## 物流商選項
系統目前統一使用：黑貓、大榮

## 開發指令
- `npm run dev` — 本地開發 (Express server)
- `npm run build` — 編譯 Angular
- `npm run lint` — TypeScript 型別檢查
- `npm run preview` — Production 模式預覽

## 注意事項
- commit message 和程式碼註解使用繁體中文
- 物流商欄位已統一為 `logistics`（部分舊欄位 `shipLogistics` 保留相容）
- 價格計算支援兩種模式：`fixed_weight` 和 `fixed_price`
- 發票管理支援多公司主體 (`ownerCompanyId`)
- 零用金經手人為固定名單：Gerald / Sandy / 梓楹

## 已完成功能記錄

### yiji-website 前台 (yiji-website/)
- **部署平台**: Vercel，網址 `yiji-website.vercel.app`
- **連動**: 連結 GitHub，`git push` 自動觸發 Vercel 重新部署
- **框架**: Next.js 14 (App Router)，共用同一個 Firebase Firestore
- 已解決問題：
  - `.next` 快取誤入 git → `.gitignore` 處理
  - TypeScript 型別錯誤 → `next.config.js` 設定 `ignoreBuildErrors: true`
  - 商品詳情頁靜態預渲染失敗 → 移除 `generateStaticParams`，改用 `export const dynamic = 'force-dynamic'`
  - 商品列表頁 `useSearchParams` 缺少 Suspense boundary → 加上 `<Suspense>` 包裝

### 通路管理 (channels.component)
- 通路商品改為單一表格 + 篩選（合併原本分頁顯示）
- 通路商品編輯 Modal 升級：支援圖片上傳、價格參考、所有 checkbox 欄位
- `Channel` model 新增 `adminUrl?: string`（後台管理網址）
- 通路設定 tab 新增可內嵌編輯的「前台網址」與「後台管理網址」，填入後顯示為可點擊超連結

### ERP 商品管理 (products.component)
- 商品表格新增分頁功能（預設 10 筆/頁）

### App 層級修正 (app.component)
- 修正登入後頁面自動捲動至底部的問題（iOS Safari keyboard dismiss scroll 殘留）
  → 偵測 currentUser 切換時，在下一個 tick 重設所有捲動容器位置

### 訂單管理修正 (orders.component)
- 修正訂單列表完全空白的問題：template 中 `@if (isVisualMode())` 參照了未定義的 signal，導致 `@if`/`@else` 整個區塊（含表格）無法渲染。補回 `isVisualMode = signal(false)` 修復
- 修正 `actionRequiredCount`（應處理 badge 數字）與 `groupedOrders`（實際列表）狀態聚合邏輯不一致：`actionRequiredCount` 未排除費用項目（FEE- 開頭）的狀態，導致 badge 數字虛高。已統一與 `groupedOrders` 相同的排除邏輯
- 修正步驟 5（代工選擇）備註欄位文字重疊：`<mat-icon>sticky_note_2</mat-icon>` 未引入 `MatIconModule`，文字被當純文字渲染。改用 SVG 圖示取代

## 本地 AI 工作站（免費方案）

### 硬體環境
- GPU: RTX 3060 Ti (8GB VRAM)
- RAM: 16GB
- OS: Windows
- 顯存管理原則：8GB VRAM 一次只能跑一個任務，先文案 → 釋放顯存 → 再修圖

### 免費 AI 工具鏈

| 工具 | 用途 | 備註 |
|---|---|---|
| **Ollama** | 本地 LLM 執行引擎 | ollama.com，免費開源 |
| **Qwen2.5:7b** | 電商文案（標題/貼文/商品描述） | `ollama pull qwen2.5:7b`，約 4.7GB，中文優秀 |
| **Page Assist** | 瀏覽器 AI 對話介面 | Chrome 插件，連接 `localhost:11434`，已設定一吉品牌 Prompt |
| **Fooocus 2.5.5** | AI 圖片生成/修改（去背/換背景/局部重繪） | `D:\AI_Tools\Fooocus`，內建 SDXL 模型，開 `127.0.0.1:7865` |

### 自動化腳本（放桌面）
- **`啟動Fooocus.bat`** → 一鍵啟動修圖工具
- **`AI工作流切換.bat`** → 選單式管理（1.文案 / 2.修圖 / 3.查顯存 / 4.全部關閉）

### 安裝注意事項
- Fooocus 使用 Python 3.12 虛擬環境（`py -3.12`），因 PyTorch 不支援 3.14
- Windows 繁體中文環境需設定 `$env:PYTHONUTF8=1` 或 `set PYTHONUTF8=1` 避免編碼錯誤
- Ollama API: `http://localhost:11434`（可供 ERP 系統 ai.service.ts 串接）
