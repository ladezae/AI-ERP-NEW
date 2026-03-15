/**
 * 清空 yiji_products collection 中所有商品的照片欄位
 * 清除欄位：imageUrl、images、nutritionLabelUrl
 *
 * 執行方式（在專案根目錄）：
 *   node scripts/clear-yiji-photos.mjs
 */

import { initializeApp } from 'firebase/app';
import { getFirestore, collection, getDocs, doc, updateDoc } from 'firebase/firestore';

const firebaseConfig = {
  apiKey: "AIzaSyDJzp8X3h2lVfPBxlkxpomLVs6nWCd3swc",
  authDomain: "new-angular-298fe.firebaseapp.com",
  projectId: "new-angular-298fe",
  storageBucket: "new-angular-298fe.firebasestorage.app",
  messagingSenderId: "984210010824",
  appId: "1:984210010824:web:095b851f2ca7763c116bfd",
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

async function clearYijiPhotos() {
  console.log('🔍 讀取 yiji_products collection...');
  const snap = await getDocs(collection(db, 'yiji_products'));
  const docs = snap.docs;
  console.log(`📦 共找到 ${docs.length} 筆商品`);

  if (docs.length === 0) {
    console.log('✅ 集合為空，無需清除。');
    process.exit(0);
  }

  let updated = 0;
  for (const d of docs) {
    const data = d.data();
    const hasPhoto =
      data.imageUrl ||
      (data.images && data.images.length > 0) ||
      data.nutritionLabelUrl;

    if (!hasPhoto) continue; // 沒有照片欄位，跳過

    await updateDoc(doc(db, 'yiji_products', d.id), {
      imageUrl: '',
      images: [],
      nutritionLabelUrl: '',
    });
    updated++;
    console.log(`  ✔ 已清除：${data.name || d.id}`);
  }

  console.log(`\n✅ 完成！共清除 ${updated} 筆商品的照片欄位。`);
  process.exit(0);
}

clearYijiPhotos().catch(err => {
  console.error('❌ 執行失敗：', err);
  process.exit(1);
});
