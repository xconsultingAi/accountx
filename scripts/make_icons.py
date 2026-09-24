"""Generate the PWA icons into public/icons. Run: python3 scripts/make_icons.py (needs Pillow)."""
from pathlib import Path

from PIL import Image, ImageDraw

OUT = Path(__file__).resolve().parent.parent / "public" / "icons"
BRAND = (15, 118, 110)
WHITE = (255, 255, 255)


def draw(size: int, padding: float, rounded: bool) -> Image.Image:
	img = Image.new("RGBA", (size, size), (0, 0, 0, 0) if rounded else BRAND + (255,))
	d = ImageDraw.Draw(img)
	if rounded:
		d.rounded_rectangle([0, 0, size - 1, size - 1], radius=int(size * 0.22), fill=BRAND)

	# A ledger: two ruled columns under a heading bar, inside the safe zone.
	inner = size * (1 - 2 * padding)
	x0 = y0 = size * padding
	stroke = max(2, int(inner * 0.06))
	d.rounded_rectangle([x0, y0, x0 + inner, y0 + inner], radius=int(inner * 0.08), outline=WHITE, width=stroke)
	d.rectangle([x0, y0, x0 + inner, y0 + inner * 0.22], fill=WHITE)
	d.line([x0 + inner * 0.5, y0 + inner * 0.22, x0 + inner * 0.5, y0 + inner], fill=WHITE, width=stroke)
	for i in range(1, 4):
		y = y0 + inner * (0.22 + i * 0.19)
		d.line([x0 + inner * 0.1, y, x0 + inner * 0.4, y], fill=WHITE, width=max(1, stroke // 2))
		d.line([x0 + inner * 0.6, y, x0 + inner * 0.9, y], fill=WHITE, width=max(1, stroke // 2))
	return img


def main() -> None:
	OUT.mkdir(parents=True, exist_ok=True)
	draw(192, 0.2, True).save(OUT / "icon-192.png")
	draw(512, 0.2, True).save(OUT / "icon-512.png")
	# Maskable icons get cropped to a circle; keep the art inside the central 60%.
	draw(512, 0.28, False).save(OUT / "icon-maskable-512.png")
	draw(180, 0.2, False).convert("RGB").save(OUT / "apple-touch-icon.png")
	print(f"icons written to {OUT}")


if __name__ == "__main__":
	main()
