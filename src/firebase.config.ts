
import { initializeApp } from 'firebase/app';
import { getFirestore } from 'firebase/firestore';

// =================================================================================
// ⚠️ Firebase 連線設定
// 
// 系統會優先讀取 LocalStorage (若您曾在 UI 設定過)。
// 若無，則使用下方您提供的預設金鑰。
// =================================================================================

let app;
let db: any = null;
let initError: string | null = null;

// 1. 嘗試讀取瀏覽器快取的設定 (優先權最高)
const localConfigStr = localStorage.getItem('erp_custom_firebase_config');
let configToUse: any = null;

if (localConfigStr) {
    try {
        configToUse = JSON.parse(localConfigStr);
        console.log('Using custom Firebase config from LocalStorage');
    } catch (e) {
        console.error('Invalid custom config in LocalStorage', e);
    }
}

// 2. 若無快取，使用您提供的固定設定 (Fallback)
if (!configToUse) {
    configToUse = {
      apiKey: "AIzaSyDJzp8X3h2lVfPBxlkxpomLVs6nWCd3swc",
      authDomain: "new-angular-298fe.firebaseapp.com",
      projectId: "new-angular-298fe",
      storageBucket: "new-angular-298fe.firebasestorage.app",
      messagingSenderId: "984210010824",
      appId: "1:984210010824:web:095b851f2ca7763c116bfd",
      measurementId: "G-VQGKSR4TH0"
    };
}

// 3. 初始化 Firebase
try {
  app = initializeApp(configToUse);
  db = getFirestore(app);
  console.log('Firebase initialized successfully with provided credentials');
} catch (error: any) {
  console.warn('Firebase initialization failed. Running in Mock Mode.', error);
  initError = error.message;
}

export { db, initError };
