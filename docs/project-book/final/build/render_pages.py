"""Render PDF pages to PNG for visual QA.  Usage: python3 -I render_pages.py book.pdf outdir [dpi] [pages e.g. 1,2,5-8]"""
import sys, os, fitz
pdf, out = sys.argv[1], sys.argv[2]
dpi = int(sys.argv[3]) if len(sys.argv) > 3 else 60
doc = fitz.open(pdf)
sel = None
if len(sys.argv) > 4:
    sel = set()
    for part in sys.argv[4].split(","):
        a, _, b = part.partition("-")
        sel.update(range(int(a), int(b or a) + 1))
os.makedirs(out, exist_ok=True)
for i, page in enumerate(doc, 1):
    if sel and i not in sel: continue
    page.get_pixmap(dpi=dpi).save(os.path.join(out, f"p{i:03d}.png"))
print("pages:", len(doc))
