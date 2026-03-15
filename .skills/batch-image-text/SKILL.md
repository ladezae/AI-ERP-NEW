---
name: batch-image-text
description: "批次商品圖文處理工具：從 ERP 通路讀取商品清單自動建立 ID 資料夾，使用者放入 JPG 後批次縮圖 1000x1000、加浮水印/壓 LOGO，並用 Ollama AI 生成 10/20/30/50 字商品文案，最後上傳到指定通路欄位。當使用者提到「圖文」「批次上傳」「商品圖」「通路上架」「加浮水印」「壓LOGO」「生成文案」「建商品資料夾」時使用此 Skill。"
---

# 批次商品圖文處理工具

一吉水果乾 ERP 的批次圖文自動化工具，分兩個階段執行：

## 流程概覽

```
階段一：建立資料夾
  讀取通路商品清單 → 建立以「商品 ID」命名的空資料夾 + 對照表
  ↓ 使用者手動把 JPG 放進對應資料夾

階段二：批次加工上傳
  掃描資料夾 → 圖片縮圖 1000x1000 + 浮水印/LOGO → Ollama 產文案 → 上傳到 Firestore 通路
```

---

## 階段一：建立商品資料夾

### 確認參數

向使用者確認：
1. **目標通路** — 哪個通路？（可用 `--list-channels` 列出）
2. **輸出目錄** — 資料夾建在哪裡？（例如 `D:\商品圖\蝦皮\`）
3. **是否含下架商品** — 預設只建上架商品

### 執行腳本

```bash
python scripts/scaffold_folders.py \
  --channel-id "shopee" \
  --output "D:\商品圖\蝦皮"
```

腳本路徑：`C:\Users\ladez\AI-ERP-NEW\.skills\batch-image-text\scripts\scaffold_folders.py`

參數說明：
- `--channel-id`：通路 ID
- `--output`：輸出根目錄
- `--list-channels`：列出所有可用通路
- `--include-hidden`：包含下架商品

### 產出結果

```
D:\商品圖\蝦皮\
├── _商品對照表.txt         ← 商品名稱 ↔ ID 對照表
├── _mapping.json           ← 程式用的映射檔（資料夾名 → ID + 名稱）
├── 芒果乾（無加糖）\       ← 空的，等使用者放圖
├── 鳳梨乾\
├── 綜合水果乾禮盒\
└── ...
```

`_商品對照表.txt` 內容範例：
```
通路：蝦皮購物
共 25 個商品
======================================================================

資料夾名稱（商品名稱）                 商品 ID                   已有圖
----------------------------------------------------------------------
芒果乾（無加糖）                       prod_001                  ✓
鳳梨乾                                 prod_002
綜合水果乾禮盒                         prod_003                  ✓
```

建好後提醒使用者：「資料夾已建好，請把商品 JPG 放進對應商品名稱的資料夾裡，好了告訴我。」

---

## 階段二：批次加工上傳

使用者確認圖片已放好後，開始處理。

### 確認參數

1. **圖片根目錄** — 剛才建好的目錄（例如 `D:\商品圖\蝦皮\`）
2. **目標通路** — 同階段一的通路
3. **圖片加工選項**：
   - 浮水印文字？（預設：「一吉水果乾」，空白 = 不加）
   - LOGO 檔案路徑？（空白 = 不壓）
4. **文案字數** — 要生成哪些版本？（預設全部：10 / 20 / 30 / 50 字）
5. **圖片目標欄位** — `imageUrl`（主圖）或 `images`（附加圖）
6. **文案目標欄位** — `description`（長文案）或 `intro`（短簡介）

### Step 1: 圖片加工

```bash
python scripts/process_images.py \
  --input "D:\商品圖\蝦皮" \
  --output "D:\商品圖\蝦皮\_processed" \
  --size 1000 \
  --watermark "一吉水果乾" \
  --logo "D:\logo.png"
```

腳本路徑：`C:\Users\ladez\AI-ERP-NEW\.skills\batch-image-text\scripts\process_images.py`

腳本會自動偵測商品名稱資料夾結構：掃描每個子資料夾，取第一張圖加工，輸出為 `{商品名稱}.jpg`。同時讀取 `_mapping.json` 來對應商品 ID，確保上傳到正確的通路商品。

### Step 2: 文案生成

對每個有圖的商品，用 Ollama 生成文案。

先確認 Ollama 是否在線：
```bash
curl -s http://localhost:11434/api/tags
```

如果失敗，提示使用者執行 `ollama serve`。

對每個商品呼叫：
```bash
curl -s http://localhost:11434/api/generate -d '{
  "model": "qwen2.5:7b",
  "prompt": "你是台灣水果乾品牌「一吉」的電商文案寫手。\n請根據商品名稱撰寫一段商品文案。\n\n商品名稱：{商品名稱}\n\n要求：\n1. 繁體中文\n2. 字數嚴格控制在 {字數} 字以內（含標點）\n3. 突出口感、健康、天然等賣點\n4. 適合電商平台使用\n5. 只回覆文案本身",
  "stream": false,
  "options": {"temperature": 0.7, "num_predict": 256}
}'
```

商品名稱直接從資料夾名稱取得，或從 `_mapping.json` 讀取完整商品資訊。

### Step 3: 上傳到通路

```bash
python scripts/upload_to_channel.py \
  --channel-id "shopee" \
  --product-name "{商品名稱}" \
  --image "D:\商品圖\蝦皮\_processed\{product_id}.jpg" \
  --image-field "imageUrl" \
  --copy "{生成的文案}" \
  --copy-field "description"
```

腳本路徑：`C:\Users\ladez\AI-ERP-NEW\.skills\batch-image-text\scripts\upload_to_channel.py`

因為 `_mapping.json` 已包含商品 ID，上傳時可直接用 Firestore document ID 來更新，不需要用名稱比對，更精準。

### Step 4: 回報結果

輸出摘要表：

| 商品 ID | 商品名稱 | 圖片狀態 | 文案 | 上傳結果 |
|---------|---------|---------|------|---------|
| prod_001 | 芒果乾（無加糖） | 1000x1000 + 浮水印 + LOGO | 20字版 | ✓ 已上傳 |
| prod_002 | 鳳梨乾 | 無圖片 | — | ⏭ 跳過 |

---

## 依賴套件

使用者的 Windows 電腦需要安裝：
```powershell
pip install Pillow firebase-admin
```

Ollama 需要已安裝且啟動（`ollama serve`），模型需要已拉取（`ollama pull qwen2.5:7b`）。

## ERP 相關資訊

- Firebase Project ID: `new-angular-298fe`
- 通路列表集合: `channels`
- 通路商品集合命名: `{channel.productCollection}`（如 `shopee_products`）
- 圖片以 Base64 data URL 存入 Firestore（與 ERP 現有做法一致）
- ChannelProduct 欄位: `imageUrl`, `images`, `description`, `intro`, `name`, `visible`
