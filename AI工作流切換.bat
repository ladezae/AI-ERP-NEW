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
echo [步驟 2] 載入 Qwen2.5 模型...
ollama run qwen2.5:7b "文案模式已就緒，請開啟 Page Assist 開始寫文案。"
goto END

:IMAGE
echo.
set PYTHONUTF8=1
echo [步驟 1] 卸載所有 Ollama 模型...
ollama stop qwen2.5:7b 2>nul
ollama stop deepseek-r1:8b 2>nul
timeout /t 5 /nobreak >nul
echo [步驟 2] 確認顯存狀態...
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
timeout /t 3 /nobreak >nul
echo 完成！所有資源已釋放。
nvidia-smi
goto END

:END
echo.
pause
