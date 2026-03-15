#!/usr/bin/env python3
"""
上傳圖片和文案到 ERP 通路 (Firestore)
圖片轉為 Base64 存入 Firestore（與 ERP 現有做法一致）
"""
import argparse
import base64
import json
import os
import sys

try:
    import firebase_admin
    from firebase_admin import credentials, firestore
except ImportError:
    print("需要安裝 firebase-admin: pip install firebase-admin --break-system-packages")
    sys.exit(1)


# Firebase 設定（與 ERP 前端的 firebase.config.ts 相同）
FIREBASE_CONFIG = {
    "apiKey": "AIzaSyA7xzubG1Jq8Pns6WViOUDL3AlVETW3XpA",
    "authDomain": "new-angular-298fe.firebaseapp.com",
    "projectId": "new-angular-298fe",
    "storageBucket": "new-angular-298fe.firebasestorage.app",
    "messagingSenderId": "485498025781",
    "appId": "1:485498025781:web:67d18c11c51c8bd75c8c78",
}


def init_firestore():
    """初始化 Firestore 連線"""
    if not firebase_admin._apps:
        # 用 Application Default Credentials 或匿名模式
        try:
            cred = credentials.ApplicationDefault()
            firebase_admin.initialize_app(cred, {"projectId": FIREBASE_CONFIG["projectId"]})
        except Exception:
            # Fallback: 無憑證模式（需要 Firestore 規則允許）
            firebase_admin.initialize_app(options={"projectId": FIREBASE_CONFIG["projectId"]})
    return firestore.client()


def image_to_base64(image_path: str) -> str:
    """將圖片檔轉為 data URL（與 ERP 前端 ImageService 一致）"""
    with open(image_path, "rb") as f:
        data = f.read()
    b64 = base64.b64encode(data).decode("utf-8")
    # 偵測 MIME type
    ext = os.path.splitext(image_path)[1].lower()
    mime = "image/jpeg" if ext in (".jpg", ".jpeg") else "image/png"
    return f"data:{mime};base64,{b64}"


def get_channel_product_collection(db, channel_id: str) -> str:
    """從 channels 集合取得通路的 productCollection 名稱"""
    doc = db.collection("channels").document(channel_id).get()
    if doc.exists:
        return doc.to_dict().get("productCollection", f"{channel_id}_products")
    # Fallback: 嘗試用 channel_id 當 document ID 查詢
    # 或直接用命名慣例
    return f"{channel_id}_products"


def find_product_by_name(db, collection_name: str, product_name: str):
    """在通路商品集合中用名稱找商品"""
    docs = db.collection(collection_name).where("name", "==", product_name).stream()
    for doc in docs:
        return doc.id, doc.to_dict()
    return None, None


def list_channels(db):
    """列出所有通路"""
    docs = db.collection("channels").stream()
    channels = []
    for doc in docs:
        data = doc.to_dict()
        channels.append({
            "id": doc.id,
            "name": data.get("name", ""),
            "productCollection": data.get("productCollection", ""),
        })
    return channels


def upload_image(db, collection_name: str, product_id: str, image_path: str, field: str = "imageUrl"):
    """上傳圖片到通路商品"""
    data_url = image_to_base64(image_path)
    ref = db.collection(collection_name).document(product_id)

    if field == "imageUrl":
        ref.update({"imageUrl": data_url})
    elif field == "images":
        # 附加到 images 陣列
        doc = ref.get()
        current_images = doc.to_dict().get("images", []) if doc.exists else []
        ref.update({"images": current_images + [data_url]})

    print(f"  ✓ 圖片已上傳 → {field}")


def upload_copy(db, collection_name: str, product_id: str, text: str, field: str = "description"):
    """上傳文案到通路商品"""
    ref = db.collection(collection_name).document(product_id)
    ref.update({field: text})
    print(f"  ✓ 文案已上傳 → {field}")


def main():
    parser = argparse.ArgumentParser(description="上傳圖片/文案到 ERP 通路")
    parser.add_argument("--channel-id", required=True, help="通路 ID")
    parser.add_argument("--product-name", required=True, help="商品名稱（需完全匹配）")
    parser.add_argument("--image", default="", help="處理後的圖片路徑")
    parser.add_argument("--image-field", default="imageUrl", choices=["imageUrl", "images"], help="圖片欄位")
    parser.add_argument("--copy", default="", help="文案內容")
    parser.add_argument("--copy-field", default="description", choices=["description", "intro"], help="文案欄位")
    parser.add_argument("--list-channels", action="store_true", help="列出所有通路")

    args = parser.parse_args()

    db = init_firestore()

    if args.list_channels:
        channels = list_channels(db)
        print("可用通路：")
        for ch in channels:
            print(f"  - {ch['id']}: {ch['name']} (collection: {ch['productCollection']})")
        return

    # 取得通路商品集合名稱
    col_name = get_channel_product_collection(db, args.channel_id)
    print(f"通路集合: {col_name}")

    # 找商品
    product_id, product_data = find_product_by_name(db, col_name, args.product_name)
    if not product_id:
        print(f"✗ 找不到通路商品：{args.product_name}")
        sys.exit(1)

    print(f"找到商品: {args.product_name} (ID: {product_id})")

    # 上傳圖片
    if args.image and os.path.exists(args.image):
        upload_image(db, col_name, product_id, args.image, args.image_field)

    # 上傳文案
    if args.copy:
        upload_copy(db, col_name, product_id, args.copy, args.copy_field)

    print("完成！")


if __name__ == "__main__":
    main()
