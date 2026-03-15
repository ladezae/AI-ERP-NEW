#!/usr/bin/env python3
"""
批次商品圖片加工腳本
功能：縮圖 1000x1000 + 浮水印押字 + 壓 LOGO
"""
import argparse
import math
import os
import sys

try:
    from PIL import Image, ImageDraw, ImageFont
except ImportError:
    print("需要安裝 Pillow: pip install Pillow --break-system-packages")
    sys.exit(1)


def process_image(
    input_path: str,
    output_path: str,
    size: int = 1000,
    watermark: str = "",
    logo_path: str = "",
    logo_size: int = 120,
    quality: int = 90,
):
    """
    處理單張圖片：
    1. 裁切為正方形（居中 cover）
    2. 縮放到 size x size
    3. 可選：加浮水印文字（斜向重複）
    4. 可選：壓 LOGO（右下角）
    """
    img = Image.open(input_path).convert("RGB")
    w, h = img.size

    # ── 裁切為正方形（居中 cover） ──
    side = min(w, h)
    left = (w - side) // 2
    top = (h - side) // 2
    img = img.crop((left, top, left + side, top + side))

    # ── 縮放到目標尺寸 ──
    img = img.resize((size, size), Image.LANCZOS)

    # ── 浮水印 ──
    if watermark:
        overlay = Image.new("RGBA", (size, size), (0, 0, 0, 0))
        draw = ImageDraw.Draw(overlay)

        # 嘗試載入中文字型
        font = _get_font(40)

        # 斜向重複浮水印
        text_layer = Image.new("RGBA", (size * 2, size * 2), (0, 0, 0, 0))
        text_draw = ImageDraw.Draw(text_layer)

        for y in range(0, size * 2, 140):
            for x in range(0, size * 2, 380):
                text_draw.text(
                    (x, y), watermark, fill=(255, 255, 255, 60), font=font
                )

        # 旋轉 -30 度
        text_layer = text_layer.rotate(30, expand=False, center=(size, size))
        # 裁切回原尺寸
        crop_x = (text_layer.width - size) // 2
        crop_y = (text_layer.height - size) // 2
        text_layer = text_layer.crop(
            (crop_x, crop_y, crop_x + size, crop_y + size)
        )

        img = img.convert("RGBA")
        img = Image.alpha_composite(img, text_layer)
        img = img.convert("RGB")

    # ── 壓 LOGO ──
    if logo_path and os.path.exists(logo_path):
        logo = Image.open(logo_path).convert("RGBA")
        # 等比縮放
        ratio = min(logo_size / logo.width, logo_size / logo.height)
        new_w = int(logo.width * ratio)
        new_h = int(logo.height * ratio)
        logo = logo.resize((new_w, new_h), Image.LANCZOS)

        # 放在右下角
        margin = 30
        pos = (size - new_w - margin, size - new_h - margin)

        img = img.convert("RGBA")
        # 建立透明底圖貼上 LOGO
        logo_layer = Image.new("RGBA", (size, size), (0, 0, 0, 0))
        logo_layer.paste(logo, pos, logo)
        img = Image.alpha_composite(img, logo_layer)
        img = img.convert("RGB")

    # ── 儲存 ──
    os.makedirs(os.path.dirname(output_path) or ".", exist_ok=True)
    img.save(output_path, "JPEG", quality=quality)
    print(f"✓ 已處理: {os.path.basename(input_path)} → {output_path} ({size}x{size})")
    return output_path


def _get_font(size: int):
    """嘗試載入可用的中文字型"""
    font_paths = [
        # Windows
        "C:/Windows/Fonts/msjh.ttc",      # 微軟正黑體
        "C:/Windows/Fonts/mingliu.ttc",    # 細明體
        "C:/Windows/Fonts/kaiu.ttf",       # 標楷體
        # Linux
        "/usr/share/fonts/truetype/noto/NotoSansCJK-Regular.ttc",
        "/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc",
        # macOS
        "/System/Library/Fonts/PingFang.ttc",
    ]
    for fp in font_paths:
        if os.path.exists(fp):
            try:
                return ImageFont.truetype(fp, size)
            except Exception:
                continue
    # Fallback: 預設字型
    try:
        return ImageFont.truetype("arial.ttf", size)
    except Exception:
        return ImageFont.load_default()


def batch_process(
    input_dir: str,
    output_dir: str,
    size: int = 1000,
    watermark: str = "",
    logo_path: str = "",
    logo_size: int = 120,
    quality: int = 90,
):
    """批次處理整個資料夾（支援兩種模式）

    模式 A — 扁平模式：資料夾內直接放 JPG，檔名當商品名
    模式 B — ID 資料夾模式：每個子資料夾以商品 ID 命名，裡面放 JPG

    自動偵測：如果子目錄存在且裡面有圖片，就用模式 B
    """
    supported = (".jpg", ".jpeg", ".png")
    results = []

    # 偵測模式
    subdirs = [
        d for d in os.listdir(input_dir)
        if os.path.isdir(os.path.join(input_dir, d)) and not d.startswith("_")
    ]
    has_subdirs_with_images = any(
        any(f.lower().endswith(supported) for f in os.listdir(os.path.join(input_dir, d)))
        for d in subdirs
        if os.path.isdir(os.path.join(input_dir, d))
    ) if subdirs else False

    if has_subdirs_with_images:
        # ── 模式 B：商品名稱資料夾結構 ──
        # 嘗試讀取 _mapping.json（由 scaffold_folders.py 產生）
        mapping = {}
        mapping_path = os.path.join(input_dir, "_mapping.json")
        if os.path.exists(mapping_path):
            import json
            with open(mapping_path, "r", encoding="utf-8") as mf:
                mapping = json.load(mf)

        print("偵測到商品名稱資料夾結構，使用批次模式 B\n")
        for folder_name in sorted(subdirs):
            sub_path = os.path.join(input_dir, folder_name)
            if not os.path.isdir(sub_path):
                continue
            images = [
                f for f in os.listdir(sub_path)
                if os.path.splitext(f)[1].lower() in supported
            ]
            if not images:
                continue

            # 從 mapping 取得商品 ID 和名稱
            product_info = mapping.get(folder_name, {})
            product_id = product_info.get("id", "")
            product_name = product_info.get("name", folder_name)

            # 取第一張圖當主圖，輸出檔名 = 商品名稱
            img_file = sorted(images)[0]
            input_path = os.path.join(sub_path, img_file)
            output_path = os.path.join(output_dir, f"{folder_name}.jpg")

            try:
                process_image(
                    input_path, output_path, size, watermark, logo_path, logo_size, quality
                )
                results.append({
                    "product_id": product_id,
                    "name": product_name,
                    "folder": folder_name,
                    "path": output_path,
                    "source": img_file,
                    "status": "ok",
                })
            except Exception as e:
                print(f"✗ 處理失敗: {folder_name}/{img_file} — {e}")
                results.append({
                    "product_id": product_id,
                    "name": product_name,
                    "folder": folder_name,
                    "path": "",
                    "source": img_file,
                    "status": f"error: {e}",
                })
    else:
        # ── 模式 A：扁平模式 ──
        print("使用扁平模式（檔名 = 商品名）\n")
        files = [
            f for f in os.listdir(input_dir)
            if os.path.splitext(f)[1].lower() in supported
        ]

        if not files:
            print(f"在 {input_dir} 中找不到任何 JPG/PNG 檔案")
            return []

        for f in sorted(files):
            input_path = os.path.join(input_dir, f)
            base_name = os.path.splitext(f)[0]
            output_path = os.path.join(output_dir, f"{base_name}.jpg")

            try:
                process_image(
                    input_path, output_path, size, watermark, logo_path, logo_size, quality
                )
                results.append({"product_id": "", "name": base_name, "path": output_path, "status": "ok"})
            except Exception as e:
                print(f"✗ 處理失敗: {f} — {e}")
                results.append({"product_id": "", "name": base_name, "path": "", "status": f"error: {e}"})

    ok = sum(1 for r in results if r["status"] == "ok")
    print(f"\n完成！成功 {ok}/{len(results)} 張")
    return results


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="商品圖片加工（縮圖+浮水印+LOGO）")
    parser.add_argument("--input", required=True, help="單張圖片路徑 或 整個資料夾路徑")
    parser.add_argument("--output", required=True, help="輸出路徑（檔案或資料夾）")
    parser.add_argument("--size", type=int, default=1000, help="目標尺寸（正方形，預設 1000）")
    parser.add_argument("--watermark", default="", help="浮水印文字（空白則不加）")
    parser.add_argument("--logo", default="", help="LOGO 圖片路徑（空白則不壓）")
    parser.add_argument("--logo-size", type=int, default=120, help="LOGO 尺寸（預設 120px）")
    parser.add_argument("--quality", type=int, default=90, help="JPEG 品質 0-100（預設 90）")

    args = parser.parse_args()

    if os.path.isdir(args.input):
        # 批次模式
        batch_process(
            args.input, args.output, args.size,
            args.watermark, args.logo, args.logo_size, args.quality
        )
    else:
        # 單張模式
        process_image(
            args.input, args.output, args.size,
            args.watermark, args.logo, args.logo_size, args.quality
        )
