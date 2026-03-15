# 一吉水果乾批發 官網

## 快速開始

### 1. 安裝套件
```bash
npm install
```

### 2. 設定環境變數
```bash
cp .env.local.example .env.local
```
編輯 `.env.local`，填入：
- Firebase 專案設定（從 Firebase Console > 專案設定 > 你的應用程式）
- Anthropic API 金鑰（用於 AI 問答）
- 綠界 ECPay 商店資料
- 後台管理密碼

### 3. Firebase 設定

在 Firebase Console，確認以下設定：

**Firestore 集合：**
- `products`：商品資料（來自 ERP，網站唯讀）
- `website_orders`：官網訂單（網站新增）
- `website_sales_summary`：銷售數量紀錄（網站新增）

**Firestore 安全規則範例：**
```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    // 商品：公開可讀，禁止前端寫入
    match /products/{id} {
      allow read: if true;
      allow write: if false;
    }
    // 訂單：只允許新增，不允許前端讀取
    match /website_orders/{id} {
      allow create: if true;
      allow read, update, delete: if false;
    }
    // 銷售紀錄
    match /website_sales_summary/{id} {
      allow create: if true;
      allow read, update, delete: if false;
    }
  }
}
```

### 4. 啟動開發伺服器
```bash
npm run dev
```

前台：http://localhost:3000
後台：http://localhost:3000/admin

### 5. 建置部署
```bash
npm run build
npm run start
```

## 功能說明

| 功能 | 路徑 | 說明 |
|------|------|------|
| 首頁 | `/` | Hero、分類入口、精選商品、AI 問答、詢價說明 |
| 商品目錄 | `/products` | Firebase 讀取、分類篩選、搜尋 |
| 商品詳細 | `/products/[id]` | 規格、定價、加入樣品/訂購車 |
| 結帳 | `/checkout` | 樣品/正式訂單分流、貨到付款/綠界 |
| AI 問答 | 首頁區塊 | Claude API 商品智能問答 |
| 後台 | `/admin` | 訂單管理、出貨狀態、商品顯示控制 |

## Firebase 資料邊界

- **網站只讀**：`products` 集合的所有 ERP 欄位
- **網站只寫**：`website_orders`、`website_sales_summary`（全新集合）
- **後台可寫**：`products.visible_01`（顯示控制）、`website_orders`（訂單狀態）
- **完全不碰**：`stock`、`safetyStock`、`costBeforeTax`、`supplierCode` 等 ERP 核心欄位

## 部署建議

- **Vercel**（推薦）：連接 GitHub repo，自動部署
- **Firebase Hosting**：`npm run build && firebase deploy`
