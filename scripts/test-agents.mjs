// Vindbaarheid voor zoekmachines en AI-agents: sitemap, robots.txt, Link-headers, Markdown en API-catalogus.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { T, supabase, antwoord, call, ok, zaaiCatalogus } from './_testmock.mjs';
const root = fileURLToPath(new URL('../', import.meta.url)), R = root + 'api/';
globalThis.fetch = async (url, o = {}) => { if (new URL(url).host === 'supa.test') return antwoord(supabase(url, o)); throw new Error('fetch? ' + url); };
Object.assign(process.env, { SUPABASE_URL: 'https://supa.test', SUPABASE_SERVICE_ROLE_KEY: 'srk', SITE_URL: 'https://skiffa.store' });
const cat = await import(R + '_catalogus.js');
zaaiCatalogus(cat.TEKSTEN);
for (const p of T.producten) p.status = p.id === 'golf' ? 'actief' : 'concept';
T.producten.find((p) => p.id === 'golf').beschrijving_en = 'One wave that stays standing.';
let did = 1; for (const v of T.varianten.filter((x) => x.product_id === 'golf')) { T.drukbestand_versies.push({ id: ++did, variant_sku: v.sku, versie: 1, pad: 'p', status: 'ok', controles: [] }); Object.assign(v, { drukbestand_id: did, actief: true, prodigi_status: 'bevestigd', handmatig_leverbaar: true }); }
await cat.laadCatalogus({ vers: true });

// sitemap
const sitemap = (await import(R + 'sitemap.js')).default;
let r = await call(sitemap, { url: '/api/sitemap' });
ok(r.c === 200 && r.h['content-type'].startsWith('application/xml') && r.s.includes('<loc>https://skiffa.store/poster/golf</loc>') && r.s.includes('<loc>https://skiffa.store/poster/golf?lang=en</loc>') && r.s.includes('hreflang="en"') && !r.s.includes('/poster/zon'), 'sitemap: bestelbare posters in NL en EN met hreflang, concepten niet');
ok(r.s.includes('<loc>https://skiffa.store/terms.html</loc>') && !r.s.includes('admin') && !r.s.includes('bestelling.html'), 'sitemap: voorwaarden erin, beheer en statuspagina niet');

// robots.txt
const robots = readFileSync(root + 'robots.txt', 'utf8');
ok(/^Sitemap: https:\/\/skiffa\.store\/sitemap\.xml$/m.test(robots) && /^Content-Signal: search=yes, ai-input=yes, ai-train=no$/m.test(robots), 'robots.txt: sitemap en Content Signals');
ok(/^Allow: \/feed\/$/m.test(robots) && /^Allow: \/api\/catalogus\?actie=feed$/m.test(robots) && /^Disallow: \/admin$/m.test(robots), 'robots.txt: productfeeds bereikbaar voor crawlers, beheer niet');

// vercel.json: rewrites en Link-headers
const v = JSON.parse(readFileSync(root + 'vercel.json', 'utf8'));
const rw = Object.fromEntries(v.rewrites.map((x) => [x.source, x.destination]));
ok(rw['/sitemap.xml'] === '/api/sitemap' && rw['/feed/google.xml'].includes('kanaal=google') && rw['/feed/meta.xml'].includes('kanaal=meta'), 'vercel.json: sitemap en nette feed-URLs');
const link = v.headers.find((h) => h.source === '/')?.headers.find((h) => h.key === 'Link')?.value || '';
ok(link.includes('</sitemap.xml>; rel="sitemap"') && link.includes('rel="api-catalog"') && link.includes('hreflang="en"') && link.includes('rel="terms-of-service"') && link.includes('rel="privacy-policy"'), 'homepage: Link-headers (RFC 8288)');

// API-catalogus (RFC 9727) en OpenAPI
const ac = JSON.parse(readFileSync(root + '.well-known/api-catalog', 'utf8')), oa = JSON.parse(readFileSync(root + 'openapi.json', 'utf8'));
ok(Array.isArray(ac.linkset) && ac.linkset[0].anchor === 'https://skiffa.store/api/catalogus' && ac.linkset[0]['service-desc'][0].href.endsWith('/openapi.json') && oa.openapi.startsWith('3.') && oa.paths['/api/catalogus'], 'api-catalog: linkset met OpenAPI-beschrijving');
ok(v.headers.find((h) => h.source === '/.well-known/api-catalog')?.headers.some((h) => h.key === 'Content-Type' && h.value === 'application/linkset+json'), 'api-catalog: juiste content-type');

// Markdown for Agents
const md = (await import(R + 'markdown.js')).default;
r = await call(md, { url: '/api/markdown' });
ok(r.c === 200 && r.h['content-type'].startsWith('text/markdown') && r.s.startsWith('# SKIFFA') && r.s.includes('| 50 × 70 cm |') && r.s.includes('https://skiffa.store/poster/golf') && Number(r.h['x-markdown-tokens']) > 0, 'markdown: winkel met posters, prijzen en links');
r = await call(md, { url: '/api/markdown?lang=en' });
ok(r.s.includes('One wave that stays standing.') && r.s.includes('/poster/golf?lang=en') && r.s.includes('unframed'), 'markdown: Engelse versie');
const poster = (await import(R + 'poster.js')).default;
r = await call(poster, { url: '/api/poster?id=golf', headers: { accept: 'text/markdown' } });
ok(r.c === 200 && r.h['content-type'].startsWith('text/markdown') && r.s.startsWith('# ') && r.s.includes('| 30 × 40 cm |') && r.h.vary === 'Accept', 'productpagina: Markdown bij Accept: text/markdown');
r = await call(poster, { url: '/api/poster?id=golf', headers: { accept: 'text/html' } });
ok(r.h['content-type'].startsWith('text/html') && r.h.vary === 'Accept', 'productpagina: browsers krijgen HTML (Vary: Accept)');

// middleware: alleen bij Accept: text/markdown omleiden
const mw = (await import(root + 'middleware.js')).default;
let gevraagd = null; globalThis.fetch = async (u) => { gevraagd = String(u); return new Response('# md', { headers: { 'content-type': 'text/markdown' } }); };
ok((await mw(new Request('https://skiffa.store/', { headers: { accept: 'text/html' } }))) === undefined && gevraagd === null, 'middleware: browser gaat gewoon door naar index.html');
const antw = await mw(new Request('https://skiffa.store/?lang=en', { headers: { accept: 'text/markdown' } }));
ok(antw instanceof Response && gevraagd === 'https://skiffa.store/api/markdown?lang=en', 'middleware: agent krijgt de Markdown-versie (met taal)');
