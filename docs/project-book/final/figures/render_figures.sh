#!/bin/zsh
# Renders every src/fig-*.html diagram to a trimmed PNG (2x) with headless Chrome,
# converts the selected screenshots, and rewrites manifest.json (image sizes for the DOCX builder).
set -e
HERE="${0:A:h}"; cd "$HERE"
CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
TMP=$(mktemp -d)
for f in src/fig-*.html; do
  n=$(basename "$f" .html)
  "$CHROME" --headless=new --disable-gpu --hide-scrollbars --force-device-scale-factor=2 --window-size=960,1700 \
     --screenshot="$TMP/$n.png" "file://$HERE/$f" >/dev/null 2>&1
done
python3 -I - "$TMP" "$HERE" <<'PY'
import sys, os, json, glob
from PIL import Image, ImageChops
tmp, here = sys.argv[1], sys.argv[2]
man = {}
for p in sorted(glob.glob(os.path.join(tmp, "*.png"))):
    im = Image.open(p).convert("RGB")
    bbox = ImageChops.difference(im, Image.new("RGB", im.size, (255, 255, 255))).getbbox()
    pad = 16
    im = im.crop((max(0, bbox[0]-pad), max(0, bbox[1]-pad), min(im.width, bbox[2]+pad), min(im.height, bbox[3]+pad)))
    out = os.path.join(here, os.path.basename(p)); im.save(out, optimize=True); man[os.path.basename(p)] = im.size
shots = os.path.join(here, "..", "..", "assets", "screenshots")
for name in ["02-receipt-review", "03-manual-catalog-match", "04-smart-basket-items-and-reasons", "05-weekly-plan-quality-and-budget", "06-weekly-plan-day-view", "07-final-shopping-list"]:
    im = Image.open(os.path.join(shots, name + ".jpg")).convert("RGB")
    # thin neutral frame so that white screenshots do not bleed into the page
    framed = Image.new("RGB", (im.width + 4, im.height + 4), (201, 211, 206)); framed.paste(im, (2, 2))
    out = "shot-" + name + ".jpg"; framed.save(os.path.join(here, out), quality=90); man[out] = framed.size
json.dump(man, open(os.path.join(here, "manifest.json"), "w"), indent=1)
print(json.dumps(man))
PY
rm -rf "$TMP"
