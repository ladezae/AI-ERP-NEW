#!/usr/bin/env python3
"""
根據通路商品清單，自動建立以商品 ID 命名的空資料夾
使用者再把對應的 JPG 放進去，後續批次處理就能精準對應
"""
import argparse
import json
import os
import sys

try:
    import firebase_admin
    from firebase_admin import credentials, firestore
except ImportError:
    print("需要安裝 firebase-admin: pip install firebase-admin --break-system-packages")
    sys.exit(1)

FIREBASE_PROJECT_ID = "new-angular-298fe"


def init_firestore():
    """初始化 Firestore"""
    if not firebase_admin._apps:
        try:
            cred = credentials.ApplicationDefault()
            firebase_admin.initialize_app(cred, {"projectId": FIREBASE_PROJECT_ID})
        except Exception:
            firebase_admin.initialize_app(options={"projectId": FIREBASE_PROJECT_ID})
    return firestore.client()


def get_channel_info(db, channel_id: str) -> dict:
    """取得通路基本資訊"""
    doc = db.collection("channels").document(channel_id).get()
    if doc.exists:
        data = doc.to_dict()
        return {
            "id": doc.id,
            "name": data.get("name", ""),
            "productCollection": data.get("productCollection", f"{channel_id}_products"),
        }
    return {"id": channel_id, "name": "", "productCollection": f"{channel_id}_products"}


def list_all_channels(db) -> list:
    """列出所有通路"""
    channels = []
    for doc in db.collection("channels").stream():
        data = doc.to_dict()
        channels.append({
            "id": doc.id,
            "name": data.get("name", ""),
            "productCollection": data.get("productCollection", ""),
            "visible": data.get("visible", True),
        })
    return channels


def get_channel_products(db, collection_name: str, visible_only: bool = True) -> list:
    """取得通路商品清單"""
    products = []
    for doc in db.collection(collection_name).stream():
        data = doc.to_dict()
        if visible_only and data.get("visible") is False:
            continue
        products.append({
            "id": doc.id,
            "name": data.get("name", ""),
            "category": data.get("category", ""),
            "price": data.get("price", 0) or data.get("priceAfterTax", 0),
            "imageUrl": data.get("imageUrl", ""),
            "description": data.get("description", ""),
            "intro": data.get("intro", ""),
        })
    return products


def safe_folder_name(name: str) -> str:
    """將商品名稱轉為安全的資料夾名稱（移除 Windows 不允許的字元）"""
    invalid = r'<>:"/\|?*'
    result = name
    for ch in invalid:
        result = result.replace(ch, '_')
    return result.strip('. ')


def scaffold(output_dir: str, products: list, channel_name: str):
    """建立資料夾結構（以商品名稱命名）"""
    os.makedirs(output_dir, exist_ok=True)

    created = 0
    skipped = 0

    for p in sorted(products, key=lambda x: x["name"]):
        folder_name = safe_folder_name(p["name"])
        folder_path = os.path.join(output_dir, folder_name)

        if os.path.exists(folder_path):
            skipped += 1
            continue

        os.makedirs(folder_path, exist_ok=True)
        created += 1

    # 產出對照表（商品名稱 ↔ ID，方便後續上傳比對）
    index_path = os.path.join(output_dir, "_商品對照表.txt")
    with open(index_path, "w", encoding="utf-8") as f:
        f.write(f"通路：{channel_name}\n")
        f.write(f"共 {len(products)} 個商品\n")
        f.write("=" * 70 + "\n\n")
        f.write(f"{'資料夾名稱（商品名稱）':<35} {'商品 ID':<25} {'已有圖'}\n")
        f.write("-" * 70 + "\n")
        for p in sorted(products, key=lambda x: x["name"]):
            has_img = "✓" if p["imageUrl"] else ""
            fname = safe_folder_name(p["name"])
            f.write(f"{fname:<35} {p['id']:<25} {has_img}\n")

    # 同時產出 JSON 對照檔（給 Skill 腳本用）
    mapping_path = os.path.join(output_dir, "_mapping.json")
    mapping = {
        safe_folder_name(p["name"]): {
            "id": p["id"],
            "name": p["name"],
        }
        for p in products
    }
    with open(mapping_path, "w", encoding="utf-8") as f:
        json.dump(mapping, f, ensure_ascii=False, indent=2)

    print(f"\n通路：{channel_name}")
    print(f"輸出目錄：{output_dir}")
    print(f"建立 {created} 個資料夾，跳過 {skipped} 個已存在的")
    print(f"對照表：{index_path}")
    print(f"映射檔：{mapping_path}")
    print(f"\n請將商品圖片 (JPG) 放入對應商品名稱的資料夾中")


def main():
    parser = argparse.ArgumentParser(description="根據通路商品建立圖片資料夾")
    parser.add_argument("--channel-id", help="通路 ID")
    parser.add_argument("--output", required=True, help="輸出根目錄路徑")
    parser.add_argument("--list-channels", action="store_true", help="列出所有通路")
    parser.add_argument("--include-hidden", action="store_true", help="包含下架商品")

    args = parser.parse_args()

    db = init_firestore()

    # 列出通路
    if args.list_channels:
        channels = list_all_channels(db)
        print("可用通路：")
        for ch in channels:
            status = "啟用" if ch["visible"] else "停用"
            print(f"  {ch['id']:<20} {ch['name']:<30} [{status}]")
        return

    if not args.channel_id:
        print("請指定 --channel-id，或用 --list-channels 查看可用通路")
        sys.exit(1)

    # 取得通路資訊
    channel = get_channel_info(db, args.channel_id)
    print(f"讀取通路：{channel['name']} ({channel['id']})")
    print(f"商品集合：{channel['productCollection']}")

    # 取得商品清單
    products = get_channel_products(
        db, channel["productCollection"],
        visible_only=not args.include_hidden
    )
    print(f"找到 {len(products)} 個商品")

    if not products:
        print("此通路沒有商品，請先在 ERP 通路管理中同步商品")
        return

    # 建立資料夾
    scaffold(args.output, products, channel["name"])


if __name__ == "__main__":
    main()
