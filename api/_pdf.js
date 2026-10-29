// Minimale PDF-generator (één A4-pagina, Helvetica, geen extra pakketten): voor de factuur die
// bol.com als PDF wil ontvangen. Tekst in WinAnsi-codering, dus € en accenten werken.
const WIN = { '€': 0x80, '‚': 0x82, '„': 0x84, '…': 0x85, '–': 0x96, '—': 0x97, '‘': 0x91, '’': 0x92, '“': 0x93, '”': 0x94, '×': 0xd7 };
function codeer(s) {
  let uit = '';
  for (const ch of String(s)) {
    let c = WIN[ch] ?? ch.charCodeAt(0);
    if (c > 255) c = 0x3f; // '?'
    if (c === 0x28 || c === 0x29 || c === 0x5c) uit += '\\' + String.fromCharCode(c);
    else uit += c < 32 || c > 126 ? '\\' + c.toString(8).padStart(3, '0') : String.fromCharCode(c);
  }
  return uit;
}

/**
 * regels: [{ x, y, tekst, grootte?, vet?, rechts? }] in punten vanaf linksboven (A4 = 595 × 842).
 * lijnen: [{ x1, y1, x2, y2 }]
 */
export function maakPdf({ regels = [], lijnen = [] }) {
  const breedte = (t, g) => String(t).length * g * 0.5; // benadering voor rechts uitlijnen
  let inhoud = '';
  for (const l of lijnen) inhoud += `0.6 w ${l.x1} ${842 - l.y1} m ${l.x2} ${842 - l.y2} l S\n`;
  for (const r of regels) {
    const g = r.grootte || 10;
    const x = r.rechts ? r.x - breedte(r.tekst, g) : r.x;
    inhoud += `BT /${r.vet ? 'F2' : 'F1'} ${g} Tf ${x.toFixed(1)} ${(842 - r.y).toFixed(1)} Td (${codeer(r.tekst)}) Tj ET\n`;
  }
  const objecten = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R /F2 5 0 R >> >> /Contents 6 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>',
    `<< /Length ${Buffer.byteLength(inhoud, 'latin1')} >>\nstream\n${inhoud}endstream`,
  ];
  let pdf = '%PDF-1.4\n%\xe2\xe3\xcf\xd3\n';
  const posities = [];
  objecten.forEach((o, i) => { posities.push(Buffer.byteLength(pdf, 'latin1')); pdf += `${i + 1} 0 obj\n${o}\nendobj\n`; });
  const xref = Buffer.byteLength(pdf, 'latin1');
  pdf += `xref\n0 ${objecten.length + 1}\n0000000000 65535 f \n` + posities.map((p) => `${String(p).padStart(10, '0')} 00000 n \n`).join('');
  pdf += `trailer\n<< /Size ${objecten.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(pdf, 'latin1');
}
