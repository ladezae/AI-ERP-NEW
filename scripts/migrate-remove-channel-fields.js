/**
 * 遷移腳本：清除 yiji_products collection 中已廢棄的欄位
 *
 * 刪除的欄位（共 18 個）：
 * - 成本：costBeforeTax, costAfterTax
 * - 庫存：stock, safetyStock, allocatedStock, externalStock, transitQuantity, totalPickingQuantity, qualityConfirmed
 * - 包裝：moq, packageType
 * - 狀態：controlStatus
 * - 說明：highlightNote, expiryNote, productFeatures, notes
 *
 * 使用方式：在瀏覽器 Console 執行，或用 Node.js（需安裝 firebase-admin）
 * 這裡使用 Firestore REST API，可直接在瀏覽器 Console 貼上執行
 */

const PROJECT_ID = 'new-angular-298fe';
const BASE_URL = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents`;

// 要清除的通路商品 collections
const COLLECTIONS = ['yiji_products'];

// 要刪除的欄位
const FIELDS_TO_REMOVE = [
  'costBeforeTax',
  'costAfterTax',
  'stock',
  'safetyStock',
  'allocatedStock',
  'externalStock',
  'transitQuantity',
  'totalPickingQuantity',
  'qualityConfirmed',
  'moq',
  'packageType',
  'controlStatus',
  'highlightNote',
  'expiryNote',
  'productFeatures',
  'notes',
];

async function fetchAllDocs(collectionName) {
  let allDocs = [];
  let nextPageToken = null;
  do {
    let url = `${BASE_URL}/${collectionName}?pageSize=300`;
    if (nextPageToken) url += `&pageToken=${nextPageToken}`;
    const res = await fetch(url);
    const data = await res.json();
    if (data.documents) allDocs = allDocs.concat(data.documents);
    nextPageToken = data.nextPageToken || null;
  } while (nextPageToken);
  return allDocs;
}

async function removeFields(docPath, fieldsToRemove) {
  // Firestore REST API: 使用 updateMask 搭配空值來刪除欄位
  // 實際做法：PATCH 時只帶保留的欄位，不帶要刪的欄位
  // 更簡潔做法：用 FieldTransform 的 delete sentinel → 但 REST API 不支援
  // 最穩妥做法：讀取文件 → 移除欄位 → 整份寫回（用 updateMask）

  const getRes = await fetch(`https://firestore.googleapis.com/v1/${docPath}`);
  const docData = await getRes.json();

  if (!docData.fields) return { skipped: true };

  const existingFields = Object.keys(docData.fields);
  const toRemove = fieldsToRemove.filter(f => existingFields.includes(f));

  if (toRemove.length === 0) return { skipped: true, reason: '無需清除的欄位' };

  // 建立新的 fields（排除要刪的）
  const newFields = {};
  for (const [key, val] of Object.entries(docData.fields)) {
    if (!fieldsToRemove.includes(key)) {
      newFields[key] = val;
    }
  }

  // 使用 updateMask 精確指定保留的欄位
  const keepFields = Object.keys(newFields);
  const updateMaskParams = keepFields.map(f => `updateMask.fieldPaths=${f}`).join('&');

  const patchUrl = `https://firestore.googleapis.com/v1/${docPath}?${updateMaskParams}`;
  const patchRes = await fetch(patchUrl, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ fields: newFields }),
  });

  if (!patchRes.ok) {
    const err = await patchRes.text();
    return { error: err };
  }

  return { removed: toRemove };
}

async function migrate() {
  console.log('===== 開始清除通路商品廢棄欄位 =====');
  console.log(`要刪除的欄位（${FIELDS_TO_REMOVE.length} 個）:`, FIELDS_TO_REMOVE);

  for (const collName of COLLECTIONS) {
    console.log(`\n📦 處理 collection: ${collName}`);
    const docs = await fetchAllDocs(collName);
    console.log(`  共 ${docs.length} 筆文件`);

    let cleaned = 0;
    let skipped = 0;
    let errors = 0;

    for (const doc of docs) {
      const docPath = doc.name; // 完整路徑
      const docId = docPath.split('/').pop();
      const result = await removeFields(docPath, FIELDS_TO_REMOVE);

      if (result.skipped) {
        skipped++;
      } else if (result.error) {
        console.error(`  ✗ ${docId}: ${result.error}`);
        errors++;
      } else {
        console.log(`  ✓ ${docId}: 已移除 ${result.removed.join(', ')}`);
        cleaned++;
      }
    }

    console.log(`\n  📊 ${collName} 結果: 已清除 ${cleaned} 筆 / 跳過 ${skipped} 筆 / 錯誤 ${errors} 筆`);
  }

  console.log('\n===== 遷移完成 =====');
}

// 執行
migrate();
