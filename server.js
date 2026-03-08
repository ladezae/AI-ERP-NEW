import express from 'express';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import fs from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();
// 【修正 1】：讓 Cloud Run 決定 Port，如果沒有才用 3000
const port = process.env.PORT || 3000;

// Log the directory being served
const distPath = join(__dirname, 'dist');
console.log('Serving static files from:', distPath);

if (fs.existsSync(distPath)) {
  console.log('Dist directory contents:', fs.readdirSync(distPath));
} else {
  console.error('Dist directory does not exist!');
}

// Serve static files from the 'dist' directory
app.use(express.static(distPath));

app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept');
  next();
});

// Gemini API Key Endpoint
app.get('/api/config/gemini-key', (req, res) => {
  const key = process.env.GEMINI_API_KEY || process.env.API_KEY;
  if (!key) {
    return res.status(404).json({ error: 'No shared API key configured on server' });
  }
  res.json({ key });
});

// Mock ERP API Endpoint
app.get('/api/erp/test', (req, res) => {
  const apiKey = req.headers['x-api-key'];
  if (!apiKey) {
    return res.status(401).json({ error: 'Missing API Key' });
  }
  res.json({
    status: 'success',
    message: 'Connected to Mock ERP API',
    timestamp: new Date().toISOString(),
    data: {
      version: '1.0.0',
      environment: 'development'
    }
  });
});

// 【修正 2】：拿掉導致當機的斜線，改為標準的 '*' 萬用路由
app.get('*', (req, res) => {
  const indexPath = join(distPath, 'index.html');
  if (fs.existsSync(indexPath)) {
    res.sendFile(indexPath);
  } else {
    res.status(404).send('Application not found (index.html missing)');
  }
});

app.listen(port, () => {
  console.log(`Server listening on port ${port}`);
});
