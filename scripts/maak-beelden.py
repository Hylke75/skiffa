"""Maakt van een hoge-resolutie poster de bestanden die de site gebruikt.

Gebruik:  python3 scripts/maak-beelden.py <bronbestand> <poster-id>
  bijv.   python3 scripts/maak-beelden.py ~/Downloads/havenpier.png havenpier

Schrijft:
  posters/<id>.webp         de poster (productbeeld, max 1333 x 2000)
  posters/<id>-klein.webp   600 x 900, voor overzicht, mandje en de muur-/lijst-dia's
Vereist Pillow (pip install pillow).
"""
import sys
from pathlib import Path
from PIL import Image

if len(sys.argv) != 3:
    sys.exit(__doc__)
bron, pid = sys.argv[1], sys.argv[2]
root = Path(__file__).resolve().parent.parent
(root / 'posters').mkdir(exist_ok=True)

im = Image.open(bron).convert('RGB')
im.thumbnail((1333, 2000), Image.LANCZOS)
im.save(root / 'posters' / f'{pid}.webp', 'WEBP', quality=88, method=6)
im.resize((600, 900), Image.LANCZOS).save(root / 'posters' / f'{pid}-klein.webp', 'WEBP', quality=72, method=6)

print(f'klaar: posters/{pid}.webp en posters/{pid}-klein.webp')
print(f"zet in index.html bij '{pid}': actief:true")
print(f"en voeg '{pid}' toe aan POSTERS in api/_catalogus.js")
