import express from 'express';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import fs from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();
// 【修正 1】：讓 Cloud Run 決定 Port，如果沒有才用 8080
const port = process.env.PORT || 8080;

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

// ═══ 產出商品資料夾 ═══
app.use(express.json());

app.post('/api/scaffold-folders', (req, res) => {
  const { channelName, products } = req.body;
  // products: [{ id: string, name: string }]

  if (!channelName || !Array.isArray(products) || !products.length) {
    return res.status(400).json({ error: '需要 channelName 與 products 陣列' });
  }

  const basePath = process.env.AI_PRODUCTS_PATH || 'D:\\AI_Products';
  const channelDir = join(basePath, channelName);

  try {
    // 建立通路根目錄
    fs.mkdirSync(channelDir, { recursive: true });

    const mapping = {};
    const created = [];
    const skipped = [];

    for (const p of products) {
      // 清理檔名（移除 Windows 不允許的字元）
      const safeName = p.name.replace(/[<>:"/\\|?*]/g, '_').trim();
      if (!safeName) continue;

      const productDir = join(channelDir, safeName);
      mapping[safeName] = p.id;

      if (fs.existsSync(productDir)) {
        skipped.push(safeName);
      } else {
        fs.mkdirSync(productDir, { recursive: true });
        created.push(safeName);
      }
    }

    // 寫入 _mapping.json（商品名 → Firestore docId）
    const mappingPath = join(channelDir, '_mapping.json');
    fs.writeFileSync(mappingPath, JSON.stringify(mapping, null, 2), 'utf-8');

    // 寫入 _scaffold_log.json（產出紀錄）
    const logEntry = {
      timestamp: new Date().toISOString(),
      channelName,
      totalProducts: products.length,
      created: created.length,
      skipped: skipped.length,
      createdFolders: created,
      skippedFolders: skipped
    };

    const logPath = join(channelDir, '_scaffold_log.json');
    let logs = [];
    if (fs.existsSync(logPath)) {
      try { logs = JSON.parse(fs.readFileSync(logPath, 'utf-8')); } catch { logs = []; }
    }
    logs.push(logEntry);
    fs.writeFileSync(logPath, JSON.stringify(logs, null, 2), 'utf-8');

    res.json({
      success: true,
      basePath: channelDir,
      mappingPath,
      created,
      skipped,
      totalProducts: products.length
    });
  } catch (err) {
    console.error('產出資料夾失敗:', err);
    res.status(500).json({ error: err.message });
  }
});

// 讀取指定商品資料夾的圖片（回傳 base64）
app.get('/api/product-images/:channelName/:productName', (req, res) => {
  const basePath = process.env.AI_PRODUCTS_PATH || 'D:\\AI_Products';
  const productDir = join(basePath, req.params.channelName, req.params.productName);

  if (!fs.existsSync(productDir)) {
    return res.json({ images: [] });
  }

  try {
    const files = fs.readdirSync(productDir)
      .filter(f => /\.(jpg|jpeg|png|webp)$/i.test(f))
      .sort(); // 字母排序，第一張當主圖

    const images = files.map(f => {
      const filePath = join(productDir, f);
      const buffer = fs.readFileSync(filePath);
      const ext = f.split('.').pop().toLowerCase();
      const mime = ext === 'png' ? 'image/png' : ext === 'webp' ? 'image/webp' : 'image/jpeg';
      return {
        filename: f,
        dataUrl: `data:${mime};base64,${buffer.toString('base64')}`
      };
    });

    res.json({ images });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 查詢資料夾狀態（哪些商品已有圖片）
app.get('/api/folder-status/:channelName', (req, res) => {
  const basePath = process.env.AI_PRODUCTS_PATH || 'D:\\AI_Products';
  const channelDir = join(basePath, req.params.channelName);

  if (!fs.existsSync(channelDir)) {
    return res.json({ exists: false, folders: [] });
  }

  try {
    const entries = fs.readdirSync(channelDir, { withFileTypes: true });
    const folders = entries
      .filter(e => e.isDirectory())
      .map(e => {
        const files = fs.readdirSync(join(channelDir, e.name));
        const images = files.filter(f => /\.(jpg|jpeg|png|webp)$/i.test(f));
        return { name: e.name, imageCount: images.length, files: images };
      });

    // 讀取 mapping
    const mappingPath = join(channelDir, '_mapping.json');
    let mapping = {};
    if (fs.existsSync(mappingPath)) {
      try { mapping = JSON.parse(fs.readFileSync(mappingPath, 'utf-8')); } catch { /* ignore */ }
    }

    // 讀取 log
    const logPath = join(channelDir, '_scaffold_log.json');
    let logs = [];
    if (fs.existsSync(logPath)) {
      try { logs = JSON.parse(fs.readFileSync(logPath, 'utf-8')); } catch { /* ignore */ }
    }

    res.json({ exists: true, folders, mapping, logs });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ═══ 圖片 AI 加工 API（localhost 專用）═══
// 需要增加 body 大小限制（圖片 base64 很大）
app.use('/api/image', express.json({ limit: '20mb' }));

/** 去背：呼叫 Python rembg */
app.post('/api/image/remove-bg', async (req, res) => {
  try {
    const { image } = req.body; // base64 dataUrl
    if (!image) return res.status(400).json({ error: '缺少 image' });

    const base64Data = image.replace(/^data:image\/\w+;base64,/, '');
    const inputPath = join(__dirname, '_tmp_rembg_input.png');
    const outputPath = join(__dirname, '_tmp_rembg_output.png');
    fs.writeFileSync(inputPath, Buffer.from(base64Data, 'base64'));

    const { execSync } = await import('child_process');
    // rembg 2.x 不支援 -m rembg，改用 Python 腳本直接呼叫
    const pyScript = `
import sys; from rembg import remove; from pathlib import Path
inp = Path(sys.argv[1]).read_bytes()
out = remove(inp)
Path(sys.argv[2]).write_bytes(out)
`.trim().replace(/\n/g, '; ');
    const pythonCmd = process.env.PYTHON_CMD || 'python';
    execSync(`${pythonCmd} -c "${pyScript}" "${inputPath}" "${outputPath}"`, { timeout: 120000 });

    const outputData = fs.readFileSync(outputPath);
    const outputBase64 = `data:image/png;base64,${outputData.toString('base64')}`;

    // 清理暫存檔
    try { fs.unlinkSync(inputPath); } catch {}
    try { fs.unlinkSync(outputPath); } catch {}

    res.json({ image: outputBase64 });
  } catch (err) {
    console.error('去背失敗:', err.message);
    res.status(500).json({ error: '去背失敗: ' + err.message });
  }
});

/** 去背 + 加背景：先去背，再呼叫 Fooocus API 合成 */
app.post('/api/image/add-background', async (req, res) => {
  try {
    const { image, prompt } = req.body; // image = 已去背的 base64, prompt = 背景描述
    if (!image || !prompt) return res.status(400).json({ error: '缺少 image 或 prompt' });

    // 呼叫 Fooocus Gradio API (預設 127.0.0.1:7865)
    const fooocusUrl = process.env.FOOOCUS_URL || 'http://127.0.0.1:7865';
    const base64Data = image.replace(/^data:image\/\w+;base64,/, '');

    // Fooocus inpaint API
    const response = await fetch(`${fooocusUrl}/api/v1/generation/image-prompt`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        prompt: prompt,
        negative_prompt: 'blurry, low quality, distorted',
        image_prompts: [{
          cn_img: base64Data,
          cn_stop: 0.6,
          cn_weight: 0.8,
          cn_type: 'ImagePrompt'
        }],
        performance_selection: 'Speed',
        aspect_ratios_selection: '1024×1024',
        image_number: 1,
        require_base64: true
      })
    });

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`Fooocus API 失敗: ${errText}`);
    }

    const result = await response.json();
    const generatedBase64 = result[0]?.base64 || result?.base64;
    if (!generatedBase64) throw new Error('Fooocus 回傳無圖片');

    res.json({ image: `data:image/png;base64,${generatedBase64}` });
  } catch (err) {
    console.error('加背景失敗:', err.message);
    res.status(500).json({ error: '加背景失敗: ' + err.message });
  }
});

/** 純提示詞生成圖片：呼叫 Fooocus API */
app.post('/api/image/generate', async (req, res) => {
  try {
    const { prompt } = req.body;
    if (!prompt) return res.status(400).json({ error: '缺少 prompt' });

    const fooocusUrl = process.env.FOOOCUS_URL || 'http://127.0.0.1:7865';

    const response = await fetch(`${fooocusUrl}/api/v1/generation/text-to-image`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        prompt: prompt,
        negative_prompt: 'blurry, low quality, distorted, text, watermark',
        performance_selection: 'Speed',
        aspect_ratios_selection: '1024×1024',
        image_number: 1,
        require_base64: true
      })
    });

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`Fooocus API 失敗: ${errText}`);
    }

    const result = await response.json();
    const generatedBase64 = result[0]?.base64 || result?.base64;
    if (!generatedBase64) throw new Error('Fooocus 回傳無圖片');

    res.json({ image: `data:image/png;base64,${generatedBase64}` });
  } catch (err) {
    console.error('圖片生成失敗:', err.message);
    res.status(500).json({ error: '圖片生成失敗: ' + err.message });
  }
});

// 【修正 2】：萬用路由，將所有前端路由導回 index.html
app.get('/{*path}', (req, res) => {
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

// force rebuild 2026-03-08: Trigger new Cloud Build deployment
