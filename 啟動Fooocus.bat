@echo off
chcp 65001 >nul
set PYTHONUTF8=1
echo 正在啟動 Fooocus 修圖工具...
cd /d D:\AI_Tools\Fooocus
call fooocus_env\Scripts\activate.bat
python entry_with_update.py
pause
