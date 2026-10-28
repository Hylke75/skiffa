"""Maakt van een hoge-resolutie poster de bestanden die de site gebruikt.

Gebruik:  python3 scripts/maak-beelden.py <bronbestand> <poster-id>
  bijv.   python3 scripts/maak-beelden.py ~/Downloads/havenpier.png havenpier

Schrijft:
  posters/<id>.webp         de poster (productbeeld, max 1333 x 2000)
  posters/<id>-klein.webp   600 x 900, voor overzicht en mandje
  sfeer/<id>-detail-1.webp  bovenste helft (sfeerbeeld in het productvenster)
  sfeer/<id>-detail-2.webp  onderste helft zonder titelband
Verfijn de uitsneden gerust met de hand; de posters-lijst in index.html verwijst ernaar via `sfeer`.
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
(root / 'sfeer').mkdir(exist_ok=True)

im = Image.open(bron).convert('RGB')
im.thumbnail((1333, 2000), Image.LANCZOS)
im.save(root / 'posters' / f'{pid}.webp', 'WEBP', quality=88, method=6)
im.resize((600, 900), Image.LANCZOS).save(root / 'posters' / f'{pid}-klein.webp', 'WEBP', quality=82, method=6)

w, h = im.size
uitsneden = {
    'detail-1': (0, int(h * .10), w, int(h * .55)),
    'detail-2': (int(w * .15), int(h * .40), w, int(h * .78)),
}
for naam, box in uitsneden.items():
    im.crop(box).save(root / 'sfeer' / f'{pid}-{naam}.webp', 'WEBP', quality=84, method=6)
print(f'klaar: posters/{pid}.webp, posters/{pid}-klein.webp, sfeer/{pid}-detail-1/2.webp')
print(f"zet in index.html bij '{pid}': actief:true en sfeer:[['/sfeer/{pid}-detail-1.webp','…'],['/sfeer/{pid}-detail-2.webp','…']]")
print(f"en voeg '{pid}' toe aan POSTERS in api/_catalogus.js")
