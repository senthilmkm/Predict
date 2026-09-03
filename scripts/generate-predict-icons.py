from PIL import Image
from pathlib import Path

src = Path(
    r"C:\Users\senth\.cursor\projects\c-Users-senth-OneDrive-Documents-RobinhoodTradingMCP\assets\predict-app-icon.png"
)
assets = Path(
    r"C:\Users\senth\OneDrive\Documents\Kalshi Auto Trading ios app\ForesightApp\assets"
)
img = Image.open(src).convert("RGBA")

icon = img.resize((1024, 1024), Image.Resampling.LANCZOS)
icon.save(assets / "icon.png", "PNG")

splash_bg = Image.new("RGBA", (1284, 2778), (15, 20, 25, 255))
mark = img.resize((640, 640), Image.Resampling.LANCZOS)
sx = (splash_bg.width - mark.width) // 2
sy = (splash_bg.height - mark.height) // 2
splash_bg.paste(mark, (sx, sy), mark)
splash_bg.save(assets / "splash-icon.png", "PNG")
mark.save(assets / "splash-mark.png", "PNG")

fg_canvas = Image.new("RGBA", (1024, 1024), (0, 0, 0, 0))
fg_mark = img.resize((680, 680), Image.Resampling.LANCZOS)
fx = (1024 - 680) // 2
fy = (1024 - 680) // 2
fg_canvas.paste(fg_mark, (fx, fy), fg_mark)
fg_canvas.save(assets / "android-icon-foreground.png", "PNG")

bg = Image.new("RGBA", (1024, 1024), (15, 20, 25, 255))
bg.save(assets / "android-icon-background.png", "PNG")

mono = Image.new("RGBA", (1024, 1024), (0, 0, 0, 0))
gray = fg_mark.convert("L")
mono_mark = Image.merge("RGBA", (gray, gray, gray, gray))
mono.paste(mono_mark, (fx, fy), mono_mark)
mono.save(assets / "android-icon-monochrome.png", "PNG")

icon.resize((48, 48), Image.Resampling.LANCZOS).save(assets / "favicon.png", "PNG")

print("icons written")
for p in sorted(assets.glob("*")):
    print(p.name, p.stat().st_size)
