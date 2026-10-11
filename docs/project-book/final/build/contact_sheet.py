"""Contact sheet of PDF pages for visual QA. Usage: python3 -I contact_sheet.py book.pdf out.png 1,2,3 [dpi] [cols]"""
import sys, fitz
from PIL import Image
pdf, out, pages = sys.argv[1], sys.argv[2], [int(x) for x in sys.argv[3].split(",")]
dpi = int(sys.argv[4]) if len(sys.argv) > 4 else 75
cols = int(sys.argv[5]) if len(sys.argv) > 5 else len(pages)
doc = fitz.open(pdf)
ims = []
for p in pages:
    if p > len(doc): continue
    pm = doc[p - 1].get_pixmap(dpi=dpi)
    ims.append(Image.frombytes("RGB", (pm.width, pm.height), pm.samples))
w, h = ims[0].size
rows = (len(ims) + cols - 1) // cols
sheet = Image.new("RGB", (cols * w + (cols + 1) * 8, rows * h + (rows + 1) * 8), (120, 120, 120))
for i, im in enumerate(ims):
    sheet.paste(im, (8 + (i % cols) * (w + 8), 8 + (i // cols) * (h + 8)))
sheet.save(out)
