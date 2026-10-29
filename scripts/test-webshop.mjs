// Test van de hele webshop (bestellen, betalen, mails, factuur, administratie) zonder echte diensten:
// Supabase, Mollie en Resend worden nagebootst. Draai met:  npm test
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
const R=fileURLToPath(new URL('../api/', import.meta.url));
import { T, supabase as supa } from './_testmock.mjs';
// ---- nep-Mollie / Resend ----
const M={};const mails=[];const mcalls=[];
function mollieApi(url,o){const u=new URL(url);const p=u.pathname.replace('/v2/','');const body=o.body?JSON.parse(o.body):null;mcalls.push(o.method+' '+p);
  if(p==='payments'&&o.method==='POST'){const id='tr_'+crypto.randomBytes(5).toString('hex');M[id]={id,status:'open',method:null,amount:body.amount,metadata:body.metadata,redirectUrl:body.redirectUrl,amountRefunded:{value:'0.00'},_links:{checkout:{href:'https://mollie.test/'+id}}};return M[id];}
  const m=p.match(/^payments\/(tr_\w+)(\/refunds)?$/);if(m){const pay=M[m[1]];if(m[2]){pay.amountRefunded={value:(Number(pay.amountRefunded.value)+Number(body.amount.value)).toFixed(2)};return {id:'re_1'};}if(o.method==='PATCH'){Object.assign(pay,body);}return pay;}
  throw new Error('mollie?'+p);}
globalThis.fetch=async(url,o={})=>{o.method=o.method||'GET';let d;
  if(url.startsWith('https://supa.test'))d=supa(url,o);else if(url.startsWith('https://api.mollie.com'))d=mollieApi(url,o);
  else if(url.startsWith('https://api.resend.com')){const b=JSON.parse(o.body);mails.push({aan:b.to[0],onderwerp:b.subject,html:b.html});d={id:'m'};}
  else throw new Error('fetch? '+url);
  const t=JSON.stringify(d);return {ok:true,status:200,text:async()=>t,json:async()=>d};};
Object.assign(process.env,{SUPABASE_URL:'https://supa.test',SUPABASE_SERVICE_ROLE_KEY:'srk',MOLLIE_API_KEY:'test_x',RESEND_API_KEY:'re_x',SITE_URL:'https://skiffa.store',ADMIN_WACHTWOORD:'zeer-geheim-wachtwoord'});
const bestel=(await import(R+'bestel.js')).default,hook=(await import(R+'mollie-webhook.js')).default,admin=(await import(R+'admin.js')).default,factuur=(await import(R+'factuur.js')).default;
const call=async(h,{method='GET',url='/',body,cookie}={})=>{const u=new URL(url,'http://x');const req={method,url,headers:{host:'skiffa.store',cookie},query:Object.fromEntries(u.searchParams),body};
  const out={c:200,h:{}};const res={status(c){out.c=c;return res},setHeader(k,v){out.h[k.toLowerCase()]=v},json(x){out.j=x},send(x){out.s=x},end(){}};await h(req,res);return out;};
const ok=(cond,msg)=>{console.log((cond?'✓ ':'✗ ')+msg);if(!cond)process.exitCode=1;};
const klant={naam:'Ann de Vries',email:'ann@voorbeeld.nl',straat:'Strandweg 1',postcode:'2586 aa',plaats:'Den Haag',land:'NL',opmerking:'<script>x</script>'};
const regels=[{id:'golf',formaat:'50x70',aantal:1},{id:'zon',formaat:'30x40',aantal:1}];

// 1. zonder akkoord
let r=await call(bestel,{method:'POST',body:{klant,regels,t:5000}});ok(r.c===400&&/voorwaarden/.test(r.j.melding),'zonder akkoord geweigerd');
// 2. bestellen met Mollie
r=await call(bestel,{method:'POST',body:{klant,regels,akkoord:true,t:5000}});
const b=T.bestellingen[0];ok(r.j.ok&&r.j.modus==='mollie'&&r.j.url.startsWith('https://mollie.test/'),'bestelling opgeslagen + Mollie-betaling gestart');
ok(b.totaal===80.95&&b.subtotaal===74&&b.verzending===6.95,'bedragen door server berekend (45 + 29 + 6,95 = 80,95)');
ok(T.bestelregels.length===2&&b.mollie_id&&M[b.mollie_id].redirectUrl.includes(`bestelling.html?nr=${b.nummer}&t=${b.token}`),'regels + mollie_id + terugkeer naar statuspagina');
ok(M[b.mollie_id].metadata.order_id===b.id&&M[b.mollie_id].amount.value==='80.95','Mollie-bedrag en metadata kloppen');
// 3. status voor betaling
r=await call(bestel,{url:`/api/bestel?nr=${b.nummer}&t=${b.token}`});ok(r.j.ok&&r.j.status==='open'&&!r.j.factuur,'statuspagina: open');
r=await call(bestel,{url:`/api/bestel?nr=${b.nummer}&t=${'0'.repeat(36)}`});ok(r.c===404,'statuspagina met verkeerd token geweigerd');
// 4. klant betaalt; statuspagina eerder dan webhook
M[b.mollie_id].status='paid';M[b.mollie_id].method='ideal';
r=await call(bestel,{url:`/api/bestel?nr=${b.nummer}&t=${b.token}`});ok(r.j.status==='betaald'&&r.j.factuur?.includes('/api/factuur?nr='),'statuspagina haalt betaling zelf op: betaald + factuurlink');
ok(b.factuurnummer==='2026-0001','factuurnummer 2026-0001 toegekend');
ok(mails.length===2&&mails[0].aan==='ann@voorbeeld.nl'&&/Bedankt/.test(mails[0].onderwerp)&&mails[1].aan==='hallo@skiffa.nl','bevestiging aan klant + melding aan winkel');
ok(!mails[1].html.includes('<script>')&&mails[1].html.includes('&lt;script&gt;'),'klantinvoer in mails ge-escaped');
// 5. webhook daarna: geen dubbele mails
await call(hook,{method:'POST',body:'id='+b.mollie_id});await call(hook,{method:'POST',body:'id='+b.mollie_id});ok(mails.length===2,'webhook twee keer: geen dubbele mails');
// 6. factuur
r=await call(factuur,{url:`/api/factuur?nr=${b.nummer}&t=${b.token}`});ok(r.c===200&&r.s.includes('2026-0001')&&r.s.includes('66,90')&&r.s.includes('14,05')&&r.s.includes('80,95'),'factuur: excl. € 66,90 + btw € 14,05 = € 80,95');
r=await call(factuur,{url:`/api/factuur?nr=${b.nummer}`});ok(r.c===404,'factuur zonder token of inlog geweigerd');
// 7. admin
r=await call(admin,{url:'/api/admin?actie=overzicht'});ok(r.c===401,'admin zonder inlog geweigerd');
r=await call(admin,{method:'POST',url:'/api/admin?actie=login',body:{wachtwoord:'fout'}});ok(r.c===401,'verkeerd wachtwoord geweigerd');
r=await call(admin,{method:'POST',url:'/api/admin?actie=login',body:{wachtwoord:'zeer-geheim-wachtwoord'}});const cookie=r.h['set-cookie'].split(';')[0];ok(r.j.ok&&/HttpOnly; Secure; SameSite=Strict/.test(r.h['set-cookie']),'inloggen: veilige sessiecookie');
r=await call(admin,{url:'/api/admin?actie=overzicht',cookie});ok(r.j.teVerzenden===1&&r.j.omzetMaand===80.95,'overzicht: 1 te verzenden, omzet € 80,95');
r=await call(admin,{url:'/api/admin?actie=bestellingen&status=actie',cookie});ok(r.j.bestellingen.length===1,'lijst "te verzenden"');
r=await call(admin,{url:'/api/admin?actie=bestellingen&q=vries',cookie});ok(r.j.bestellingen.length===1,'zoeken op naam');
r=await call(admin,{url:'/api/admin?actie=bestelling&id='+b.nummer,cookie});ok(r.j.bestelling.bestelregels.length===2&&r.j.bestelling.log.length>=3,'detail met regels en logboek');
r=await call(factuur,{url:`/api/factuur?nr=${b.nummer}`,cookie});ok(r.c===200,'factuur via admin-inlog');
r=await call(admin,{method:'POST',url:'/api/admin?actie=status',cookie,body:{id:b.id,status:'verzonden',track_trace:'3SABCD123456789'}});ok(r.j.gemaild&&b.status==='verzonden'&&mails.at(-1).html.includes('3SABCD123456789'),'verzonden + track-and-trace-mail');
r=await call(admin,{method:'POST',url:'/api/admin?actie=terugbetalen',cookie,body:{id:b.id,bedrag:'100'}});ok(r.c===400,'terugbetalen meer dan betaald geweigerd');
r=await call(admin,{method:'POST',url:'/api/admin?actie=terugbetalen',cookie,body:{id:b.id,bedrag:'29,00'}});ok(r.j.ok&&b.terugbetaald===29&&b.status==='verzonden'&&mcalls.includes(`POST payments/${b.mollie_id}/refunds`)&&/Terugbetaling/.test(mails.at(-1).onderwerp),'gedeeltelijke terugbetaling via Mollie + mail');
const nm=mails.length;await call(hook,{method:'POST',body:'id='+b.mollie_id});ok(mails.length===nm&&b.terugbetaald===29,'webhook na terugbetaling: niet dubbel geboekt');
r=await call(admin,{url:'/api/admin?actie=export&van=2026-10-01&tot=2026-10-31',cookie});const csv=r.s.split('\r\n');ok(r.h['content-type'].includes('csv')&&csv.length===2&&csv[1].startsWith('2026-0001;2026-10-29;'+b.nummer)&&csv[1].includes('66,90;14,05;80,95;6,95;29,00'),'CSV-export voor de boekhouding');
// 8. zonder Mollie: betaalverzoek
delete process.env.MOLLIE_API_KEY;
r=await call(bestel,{method:'POST',body:{klant:{...klant,email:'bob@voorbeeld.be',land:'BE'},regels:[{id:'regatta',formaat:'70x100',aantal:2}],akkoord:true,t:5000}});
const b2=T.bestellingen[1];ok(r.j.ok&&r.j.modus==='mail'&&b2.betaalwijze==='betaalverzoek'&&b2.totaal===138&&b2.verzending===0,'zonder Mollie: betaalverzoek, gratis verzending boven € 75');
ok(/ontvangen/.test(mails.at(-2).onderwerp)&&mails.at(-2).aan==='bob@voorbeeld.be','klant krijgt "ontvangen"-mail');
r=await call(admin,{method:'POST',url:'/api/admin?actie=betaald',cookie,body:{id:b2.id}});ok(r.j.ok&&b2.factuurnummer==='2026-0002'&&/Bedankt/.test(mails.at(-2).onderwerp),'handmatig betaald: factuur 2026-0002 + bevestiging');
r=await call(admin,{method:'POST',url:'/api/admin?actie=betaald',cookie,body:{id:b2.id}});ok(r.c===400,'twee keer betaald zetten geweigerd');
r=await call(admin,{method:'POST',url:'/api/admin?actie=terugbetalen',cookie,body:{id:b2.id}});ok(r.j.ok&&b2.status==='terugbetaald'&&b2.terugbetaald===138,'volledige handmatige terugbetaling');
// 9. bot
const n=T.bestellingen.length;r=await call(bestel,{method:'POST',body:{klant,regels,akkoord:true,t:200}});ok(T.bestellingen.length===n,'bot (te snel) wordt niet opgeslagen');
if(process.env.VERBOSE)console.log('\nmails:',mails.map(m=>m.aan+' · '+m.onderwerp).join('\n       '));
