"""Maakt van een hoge-resolutie posterbeeld de drukbestanden voor alle formaten.

Gebruik:  python3 scripts/maak-drukbestanden.py <bronbestand> <poster-id> [--pdf] [--afloop 3] [--passend]
  bijv.   python3 scripts/maak-drukbestanden.py ~/Downloads/golf-hr.tif golf

Schrijft drukbestanden/<id>-<formaat>.jpg (map staat in .gitignore), één per formaat uit
api/_catalogus.js, op ware grootte, max. 300 dpi. Prodigi kan jpg en png zelf op het drukvlak plaatsen;
een pdf wordt niet geschaald en moet precies passen. Met --pdf: pdf op ware grootte plus afloop rondom
(standaard 3 mm). Sleep de map daarna in /admin → producten: de bestandsnamen koppelen zichzelf aan de
variant (poster + formaat) en elk bestand wordt gecontroleerd op maat, verhouding en resolutie.

Het beeld wordt vanuit het midden bijgesneden tot de verhouding van het formaat (30 × 40 = 3:4,
50 × 70 = 5:7, 70 × 100 = 7:10). Met --passend wordt er niets weggesneden maar wit aangevuld.
Heb je per formaat een eigen ontwerp, exporteer dat dan zelf als pdf en gebruik deze namen.
Vereist Pillow (pip install pillow).
"""
import re
from pathlib import Path
from PIL import Image

Image.MAX_IMAGE_PIXELS = None  # grote drukbestanden zijn hier de bedoeling
import argparse
ap = argparse.ArgumentParser(usage=__doc__)
ap.add_argument('bron'); ap.add_argument('poster_id')
ap.add_argument('--afloop', type=float, default=None)
ap.add_argument('--pdf', action='store_true')
ap.add_argument('--passend', action='store_true')
a = ap.parse_args()
bron, pid, passend, als_pdf = a.bron, a.poster_id, a.passend, a.pdf
afloop = a.afloop if a.afloop is not None else (3.0 if als_pdf else 0.0)
root = Path(__file__).resolve().parent.parent

# Formaten uit de catalogus van de server lezen, zodat er maar één lijst is.
cat = (root / 'api' / '_catalogus.js').read_text()
formaten = re.findall(r"'([\w]+)':\s*\{\s*label:\s*'([^']+)',\s*prijs:\s*[\d.]+,\s*mm:\s*\[([\d.]+),\s*([\d.]+)\]", cat)
if not formaten:
    sys.exit('kon de formaten niet lezen uit api/_catalogus.js')

uit = root / 'drukbestanden'
uit.mkdir(exist_ok=True)
im = Image.open(bron)
im = im.convert('CMYK' if im.mode == 'CMYK' else 'RGB')
print(f'bron: {im.width} × {im.height} px ({im.mode})')

for fid, label, w, h in formaten:
    bw, bh = float(w) + 2 * afloop, float(h) + 2 * afloop  # mm incl. afloop
    doel = bw / bh
    if passend:
        s = min(im.width / bw, im.height / bh)
        canvas = Image.new(im.mode, (round(bw * s), round(bh * s)), 'white' if im.mode == 'RGB' else (0, 0, 0, 0))  # CMYK: geen inkt = wit
        canvas.paste(im, ((canvas.width - im.width) // 2, (canvas.height - im.height) // 2))
        stuk = canvas
    else:
        if im.width / im.height > doel:
            nw = round(im.height * doel)
            stuk = im.crop(((im.width - nw) // 2, 0, (im.width - nw) // 2 + nw, im.height))
        else:
            nh = round(im.width / doel)
            stuk = im.crop((0, (im.height - nh) // 2, im.width, (im.height - nh) // 2 + nh))
    dpi = stuk.width / (bw / 25.4)
    if dpi > 300:
        stuk = stuk.resize((round(bw / 25.4 * 300), round(bh / 25.4 * 300)), Image.LANCZOS)
        dpi = 300
    # resolutie zo kiezen dat de pagina precies bw × bh mm is
    res = stuk.width / (bw / 25.4)
    if als_pdf:
        pad = uit / f'{pid}-{fid}.pdf'
        stuk.save(pad, 'PDF', resolution=res, quality=95)
    else:
        pad = uit / f'{pid}-{fid}.jpg'
        stuk.convert('RGB').save(pad, 'JPEG', quality=95, dpi=(round(res), round(res)))
    waarschuwing = '  ⚠ lage resolutie, liever ≥ 150 dpi' if dpi < 150 else ''
    print(f'{label:>14}: {pad.relative_to(root)}  {bw:g} × {bh:g} mm, {dpi:.0f} dpi{waarschuwing}')
