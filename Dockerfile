FROM node:20-slim
WORKDIR /app

# 1. 先處理套件安裝，利用 Docker 快取機制加速
COPY package*.json ./
RUN npm install --force

# 2. 複製所有檔案（包含你剛剛修改的 server.js）
COPY . .

# 3. 執行 Angular 編譯
RUN npm run build

# 💡 重要：檢查 server.js 是否真的被更新了 (可選，除錯用)
# RUN grep -n "\/\*" server.js || echo "No old slash pattern found"

# 4. Cloud Run 會自動分配 PORT，這裡 EXPOSE 8080 是標誌性的
EXPOSE 8080

# 5. 確保執行的是根目錄下、你剛才修改過的那個 server.js
CMD ["node", "server.js"]
