# 本地 AI 工作站安裝指南

> 適用硬體：RTX 3060 Ti (8GB VRAM) / 16GB RAM / Windows 10/11
> 目標：免費建立電商文案 + 商品修圖的本地 AI 工作流

---

## 第一部分：Ollama — 本地 LLM 執行環境

### 1.1 下載與安裝

1. 前往 [Ollama 官網](https://ollama.com/download) 下載 Windows 版安裝檔
2. 執行安裝檔，按照提示完成安裝（一路 Next 即可）
3. 安裝完成後，Ollama 會自動在系統列（System Tray）出現圖示

### 1.2 驗證安裝

開啟 **PowerShell** 或 **CMD**，輸入：

```powershell
ollama --version
```

看到版本號即安裝成功。

### 1.3 設定環境變數（選用但建議）

如果你希望其他裝置（例如手機）也能連到這台電腦的 Ollama，或是未來要讓 ERP 系統串接：

1. 開啟「系統環境變數」（搜尋「環境變數」）
2. 在「系統變數」中新增：

| 變數名稱 | 值 | 用途 |
|---|---|---|
| `OLLAMA_HOST` | `0.0.0.0` | 允許外部連線（預設只有 localhost） |
| `OLLAMA_MODELS` | `D:\AI_Tools\ollama_models` | 自訂模型存放路徑（避免 C 槽空間不足） |

3. 設定完成後**重新啟動 Ollama**（在系統列右鍵 → Quit → 重新開啟）

---

## 第二部分：下載 LLM 模型

### 2.1 推薦模型

| 模型 | 大小 | 用途 | 特點 |
|---|---|---|---|
| `deepseek-r1:8b` | ~5GB | 推理型文案 | 邏輯強，適合長文案、比較分析 |
| `qwen2.5:7b` | ~4.7GB | 快速文案 | 中文優秀，回應快，適合短標題/貼文 |

### 2.2 下載模型

開啟 PowerShell，執行：

```powershell
# 下載 DeepSeek（推理型，適合深度文案）
ollama pull deepseek-r1:8b

# 下載 Qwen2.5（快速型，適合日常短文案）
ollama pull qwen2.5:7b
```

每個模型約 5GB，下載時間取決於網速，耐心等待。

### 2.3 測試模型

```powershell
# 快速測試
ollama run qwen2.5:7b "請幫我寫一段芒果乾的電商商品描述，50字以內"
```

看到中文回覆就代表一切正常！輸入 `/bye` 離開對話。

### 2.4 常用管理指令

```powershell
# 查看已下載的模型
ollama list

# 查看目前正在佔用顯存的模型
ollama ps

# 卸載模型、釋放顯存（重要！切換到修圖前必做）
ollama stop deepseek-r1:8b
ollama stop qwen2.5:7b

# 刪除不需要的模型
ollama rm 模型名稱
```

---

## 第三部分：Page Assist — 瀏覽器 AI 對話介面

### 3.1 安裝插件

1. 開啟 Chrome，前往 [Chrome Web Store 搜尋 Page Assist](https://chromewebstore.google.com/detail/page-assist/jfgfiigpkhlkbnfnbobbkinehhfdhndo)
2. 點擊「加到 Chrome」安裝
3. 安裝完成後，瀏覽器右上角會出現 Page Assist 圖示

### 3.2 連接 Ollama

1. 點擊 Page Assist 圖示 → 進入設定（齒輪圖示）
2. 設定 API 位址為：`http://localhost:11434`
3. 選擇模型：從下拉選單選擇 `qwen2.5:7b` 或 `deepseek-r1:8b`
4. 儲存設定

### 3.3 建立電商文案 Prompt 範本

在 Page Assist 的「System Prompt」中貼上以下範本：

```
你是一位專業的台灣電商文案師，專門撰寫水果乾與零食的銷售文案。

寫作風格要求：
- 使用繁體中文
- 語氣親切活潑，帶有台灣在地感
- 強調健康、天然、無添加等賣點
- 適當使用 emoji 增加吸引力
- 文案需包含：吸睛標題 + 商品描述 + 行動呼籲（CTA）

品牌資訊：
- 品牌名稱：一吉
- 主要產品：各式水果乾、堅果
- 品牌定位：天然健康、批發零售
```

### 3.4 使用方式

1. 確認 Ollama 正在執行（系統列有圖示）
2. 點擊 Page Assist 圖示，開啟側邊欄對話
3. 直接輸入需求，例如：
   - 「幫我寫芒果乾的蝦皮商品標題，要 5 個版本」
   - 「寫一篇 FB 貼文推廣中秋禮盒組合」
   - 「把這段商品描述改得更吸引人：（貼上原文）」

---

## 第四部分：Fooocus — AI 圖片修改工具

### 4.1 前置需求

確認已安裝：
- **Python 3.10+**（[下載連結](https://www.python.org/downloads/)，安裝時勾選「Add to PATH」）
- **Git**（[下載連結](https://git-scm.com/download/win)）

驗證：

```powershell
python --version
git --version
```

### 4.2 下載 Fooocus

```powershell
# 建議放在 D 槽的 AI_Tools 資料夾
cd D:\
mkdir AI_Tools
cd AI_Tools

# 下載 Fooocus
git clone https://github.com/lllyasviel/Fooocus.git
cd Fooocus
```

### 4.3 安裝依賴

```powershell
# 建立虛擬環境（避免污染系統 Python）
python -m venv fooocus_env
.\fooocus_env\Scripts\activate

# 安裝 PyTorch（CUDA 版本，支援 GPU 加速）
pip install torch torchvision --index-url https://download.pytorch.org/whl/cu121

# 安裝 Fooocus 依賴
pip install -r requirements_versions.txt
```

> 安裝過程約需 10-20 分鐘，會下載約 2-3GB 的 PyTorch 套件。

### 4.4 首次啟動

```powershell
# 確保在 Fooocus 資料夾 + 虛擬環境中
python entry_with_update.py
```

首次啟動會自動下載 SDXL 模型（約 6GB），完成後瀏覽器會自動開啟 `http://localhost:7865`。

### 4.5 電商修圖常用功能

| 功能 | 路徑 | 用途 |
|---|---|---|
| **Inpaint（局部重繪）** | 進階 → Inpaint | 換背景、移除雜物、修改商品細節 |
| **Upscale（放大）** | 進階 → Upscale | 提升商品圖解析度 |
| **Image Prompt** | 進階 → Image Prompt | 以參考圖生成風格一致的新圖 |

### 4.6 日後快速啟動

建立一個 `啟動Fooocus.bat` 檔案放在桌面：

```bat
@echo off
cd /d D:\AI_Tools\Fooocus
call fooocus_env\Scripts\activate.bat
python entry_with_update.py
pause
```

雙擊即可啟動。

---

## 第五部分：顯存管理與工作流切換

### 5.1 核心原則

你的 RTX 3060 Ti 有 **8GB 顯存**，文案模型和修圖模型各需約 5-8GB，**不能同時執行**。
必須遵循：**先文字 → 釋放顯存 → 再圖片**。

### 5.2 一鍵切換腳本

建立 `AI工作流切換.bat` 放在桌面：

```bat
@echo off
chcp 65001 >nul
echo ========================================
echo    一吉 AI 工作站 - 工作流管理器
echo ========================================
echo.
echo [1] 啟動文案模式（Ollama + Qwen2.5）
echo [2] 啟動修圖模式（Fooocus）
echo [3] 檢查顯存狀態
echo [4] 全部關閉（釋放所有資源）
echo.
set /p choice=請輸入選項 (1-4):

if "%choice%"=="1" goto COPYWRITING
if "%choice%"=="2" goto IMAGE
if "%choice%"=="3" goto CHECK
if "%choice%"=="4" goto CLEANUP
goto END

:COPYWRITING
echo.
echo [步驟 1] 關閉 Fooocus（如果有在執行）...
taskkill /f /im python.exe 2>nul
timeout /t 3 /nobreak >nul
echo [步驟 2] 啟動 Ollama 並載入 Qwen2.5...
ollama run qwen2.5:7b "你好，文案模式已就緒"
goto END

:IMAGE
echo.
echo [步驟 1] 卸載所有 Ollama 模型...
ollama stop qwen2.5:7b 2>nul
ollama stop deepseek-r1:8b 2>nul
timeout /t 5 /nobreak >nul
echo [步驟 2] 確認顯存已釋放...
nvidia-smi
echo.
echo [步驟 3] 啟動 Fooocus...
cd /d D:\AI_Tools\Fooocus
call fooocus_env\Scripts\activate.bat
python entry_with_update.py
goto END

:CHECK
echo.
nvidia-smi
echo.
echo --- Ollama 模型狀態 ---
ollama ps
goto END

:CLEANUP
echo.
echo 正在關閉所有 AI 服務...
ollama stop qwen2.5:7b 2>nul
ollama stop deepseek-r1:8b 2>nul
taskkill /f /im python.exe 2>nul
echo 完成！所有資源已釋放。
nvidia-smi
goto END

:END
echo.
pause
```

### 5.3 檢查顯存指令

隨時可以在 PowerShell 執行：

```powershell
# 查看 GPU 顯存使用量
nvidia-smi

# 只看記憶體摘要
nvidia-smi --query-gpu=memory.used,memory.free,memory.total --format=csv
```

---

## 第六部分：資料夾結構建議

```
D:\AI_Tools\
├── ollama_models\          ← Ollama 模型存放（透過環境變數指定）
├── Fooocus\                ← Fooocus 主程式
│   ├── fooocus_env\        ← Python 虛擬環境
│   ├── models\             ← SD 模型
│   └── outputs\            ← 修圖產出
├── prompts\                ← 常用 Prompt 範本
│   ├── 商品文案範本.txt
│   ├── FB貼文範本.txt
│   └── 蝦皮標題範本.txt
└── outputs\                ← 文案產出備份
```

---

## 快速參考卡

| 動作 | 指令 / 操作 |
|---|---|
| 啟動 Ollama | 系統列自動啟動，或執行 `ollama serve` |
| 寫文案 | Page Assist 側邊欄對話 |
| 查看顯存 | `nvidia-smi` |
| 釋放顯存 | `ollama stop 模型名稱` |
| 啟動 Fooocus | 雙擊桌面 `啟動Fooocus.bat` |
| 一鍵切換 | 雙擊桌面 `AI工作流切換.bat` |

---

## 故障排除

### Ollama 無法啟動
- 確認 NVIDIA 驅動程式是最新版（[下載](https://www.nvidia.com/download/index.aspx)）
- 執行 `nvidia-smi` 確認 GPU 被正確偵測

### Fooocus 啟動後黑屏或報錯
- 確認已用 CUDA 版 PyTorch（非 CPU 版）
- 確認顯存已完全釋放（`nvidia-smi` 顯示接近 0MB 使用）
- 嘗試加入參數：`python entry_with_update.py --always-gpu`

### 中文文案品質不佳
- 嘗試換模型：`deepseek-r1:8b` 邏輯較強，`qwen2.5:7b` 中文較自然
- 優化 System Prompt，加入更多品牌語氣範例
- 提供幾個好文案作為 few-shot 範例

### 顯存不足 (CUDA out of memory)
- 執行 `ollama ps` 確認沒有殘留模型
- 關閉 Chrome 的硬體加速（設定 → 系統 → 關閉「使用硬體加速」）
- 重啟電腦後再試
