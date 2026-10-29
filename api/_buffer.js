// Buffer GraphQL-API (https://api.buffer.com, Bearer-sleutel uit BUFFER_API_KEY; alleen server-side).
//
// Fouten worden in drie soorten gesplitst, want daar hangt "hoogstens één keer plaatsen" van af:
//   definitief  Buffer heeft het verzoek beoordeeld en geweigerd (MutationError, UNAUTHORIZED, ...) -> niet herhalen
//   tijdelijk   zeker niet verwerkt (429 / RATE_LIMIT_EXCEEDED) -> later opnieuw
//   onbekend    verbinding weg, time-out, 5xx, UNEXPECTED: misschien wél verwerkt -> eerst in Buffer zoeken
const URL_ = 'https://api.buffer.com';
export const bufferIngesteld = () => !!process.env.BUFFER_API_KEY;

export class BufferFout extends Error {
  constructor(soort, bericht, code) { super(bericht); this.soort = soort; this.code = code; }
}

export async function gql(query, variables = {}) {
  let r;
  try {
    r = await fetch(URL_, {
      method: 'POST',
      headers: { authorization: `Bearer ${process.env.BUFFER_API_KEY}`, 'content-type': 'application/json' },
      body: JSON.stringify({ query, variables }),
      signal: AbortSignal.timeout ? AbortSignal.timeout(20000) : undefined,
    });
  } catch (e) { throw new BufferFout('onbekend', `Geen antwoord van Buffer (${e.name === 'TimeoutError' ? 'time-out' : 'verbinding'})`); }
  if (r.status === 429) throw new BufferFout('tijdelijk', 'Buffer: te veel verzoeken, later opnieuw', 'RATE_LIMIT_EXCEEDED');
  if (r.status === 401 || r.status === 403) throw new BufferFout('definitief', 'Buffer weigert de API-sleutel (controleer BUFFER_API_KEY)', 'UNAUTHORIZED');
  if (r.status >= 500) throw new BufferFout('onbekend', `Buffer gaf een serverfout (${r.status})`);
  let j;
  try { j = await r.json(); } catch { throw new BufferFout(r.ok ? 'onbekend' : 'definitief', `Onleesbaar antwoord van Buffer (${r.status})`); }
  if (j.errors?.length) {
    const e = j.errors[0], code = e.extensions?.code || '';
    const soort = code === 'RATE_LIMIT_EXCEEDED' ? 'tijdelijk' : code === 'UNEXPECTED' || !code ? 'onbekend' : 'definitief';
    throw new BufferFout(soort, `Buffer: ${e.message || code}`, code);
  }
  if (!r.ok) throw new BufferFout('definitief', `Buffer: HTTP ${r.status}`);
  return j.data;
}

// Diensten die SKIFFA ondersteunt, met een indicatieve tekstlimiet en wat er minimaal bij moet.
export const DIENSTEN = {
  instagram: { naam: 'Instagram', limiet: 2200, media: 'verplicht', types: ['post', 'reel', 'story'] },
  facebook: { naam: 'Facebook', limiet: 63206, media: 'optioneel', types: ['post', 'reel', 'story'] },
  tiktok: { naam: 'TikTok', limiet: 2200, media: 'verplicht', types: ['post'] },
  pinterest: { naam: 'Pinterest', limiet: 500, media: 'verplicht', types: ['post'] },
  threads: { naam: 'Threads', limiet: 500, media: 'optioneel', types: ['post'] },
  linkedin: { naam: 'LinkedIn', limiet: 3000, media: 'optioneel', types: ['post'] },
  bluesky: { naam: 'Bluesky', limiet: 300, media: 'optioneel', types: ['post'] },
  twitter: { naam: 'X', limiet: 280, media: 'optioneel', types: ['post'] },
  mastodon: { naam: 'Mastodon', limiet: 500, media: 'optioneel', types: ['post'] },
};

export async function ping() {
  const d = await gql('query { account { id email organizations { id name } } }');
  return { ok: true, organisaties: d.account.organizations.map((o) => ({ id: o.id, naam: o.name })), email: d.account.email };
}

export async function kanalen(organisatieId) {
  const d = await gql(`query K($input: ChannelsInput!) { channels(input: $input) {
    id name displayName service avatar isDisconnected isLocked isQueuePaused externalLink hasActiveMemberDevice timezone
    metadata { ... on PinterestMetadata { boards { serviceId name } } } } }`, { input: { organizationId: organisatieId } });
  return d.channels;
}

/** CreatePostInput opbouwen. Gooit een (Nederlandse) melding als er iets verplichts ontbreekt. */
export function postInput({ service, kanaalId, tekst, publicatie, postType, dueAt, assets, metadata = {} }) {
  const d = DIENSTEN[service];
  if (!d) throw new Error(`${service} wordt (nog) niet ondersteund in SKIFFA`);
  const mis = [];
  if (!tekst?.trim() && service !== 'instagram' && service !== 'tiktok' && service !== 'pinterest') mis.push('tekst ontbreekt');
  if (tekst && tekst.length > d.limiet) mis.push(`tekst is ${tekst.length} tekens; ${d.naam} staat er ${d.limiet} toe`);
  if (d.media === 'verplicht' && !assets.length) mis.push(`${d.naam} vraagt minstens één afbeelding of video`);
  if (service === 'pinterest' && !metadata.bord) mis.push('kies een Pinterest-bord');
  if (postType === 'reel' && !assets.some((a) => a.soort === 'video')) mis.push('een reel vraagt een video');
  if (!d.types.includes(postType)) mis.push(`${d.naam} kent geen ${postType}`);
  if (mis.length) throw new Error(mis.join('; '));
  const input = {
    channelId: kanaalId, text: tekst || '', schedulingType: publicatie === 'telefoon' ? 'notification' : 'automatic',
    mode: dueAt ? 'customScheduled' : 'addToQueue', ...(dueAt ? { dueAt } : {}), source: 'skiffa',
    assets: assets.map((a) => (a.soort === 'video'
      ? { video: { url: a.url, ...(a.thumbnail_offset_ms != null ? { metadata: { thumbnailOffset: a.thumbnail_offset_ms } } : {}) } }
      : { image: { url: a.url, ...(a.alt_tekst ? { metadata: { altText: a.alt_tekst } } : {}) } })),
  };
  const md = {};
  if (service === 'instagram') md.instagram = { type: postType, shouldShareToFeed: true, ...(metadata.eerste_reactie ? { firstComment: metadata.eerste_reactie } : {}) };
  if (service === 'facebook') md.facebook = { type: postType, ...(metadata.eerste_reactie ? { firstComment: metadata.eerste_reactie } : {}) };
  if (service === 'tiktok') md.tiktok = { isAiGenerated: !!metadata.ai_gegenereerd, ...(metadata.titel ? { title: metadata.titel } : {}) };
  if (service === 'pinterest') md.pinterest = { boardServiceId: metadata.bord, ...(metadata.titel ? { title: metadata.titel } : {}), ...(metadata.link ? { url: metadata.link } : {}) };
  if (service === 'linkedin' && metadata.eerste_reactie) md.linkedin = { firstComment: metadata.eerste_reactie };
  if (Object.keys(md).length) input.metadata = md;
  return input;
}

const POSTVELDEN = 'id text status dueAt sentAt externalLink notificationStatus schedulingType createdAt channelId error { message }';

/** Bericht aanmaken. Gooit BufferFout; een MutationError is definitief (Buffer heeft het niet aangemaakt). */
export async function maakPost(input) {
  const d = await gql(`mutation M($input: CreatePostInput!) { createPost(input: $input) {
    ... on PostActionSuccess { post { ${POSTVELDEN} } } ... on MutationError { message } } }`, { input });
  const r = d.createPost;
  if (r?.post) return r.post;
  throw new BufferFout('definitief', `Buffer weigerde het bericht: ${r?.message || 'onbekende reden'}`);
}

export async function haalPost(id) {
  try { return (await gql(`query P($input: PostInput!) { post(input: $input) { ${POSTVELDEN} } }`, { input: { id } })).post; }
  catch (e) { if (e.code === 'NOT_FOUND') return null; throw e; }
}

/** Berichten van één kanaal sinds een tijdstip (om na een onduidelijk antwoord te zoeken of het er al is). */
export async function zoekPosts(organisatieId, kanaalId, sinds) {
  const d = await gql(`query Z($input: PostsInput!) { posts(first: 50, input: $input) { edges { node { ${POSTVELDEN} } } } }`, {
    input: { organizationId: organisatieId, filter: { channelIds: [kanaalId], createdAt: { start: sinds } }, sort: [{ field: 'createdAt', direction: 'desc' }] },
  });
  return (d.posts?.edges || []).map((e) => e.node);
}

export async function verwijderPost(id) {
  const d = await gql(`mutation D($input: DeletePostInput!) { deletePost(input: $input) { ... on MutationError { message } } }`, { input: { id } });
  if (d.deletePost?.message) throw new BufferFout('definitief', `Buffer: ${d.deletePost.message}`);
  return true;
}

/**
 * Buffer-status vertalen naar SKIFFA. Een herinnering ("Afronden op telefoon") is nooit gepubliceerd:
 * pas als Buffer markedAsPublished meldt (jij hebt het in de app als geplaatst gemarkeerd).
 */
export function vertaalStatus(p) {
  if (!p) return { status: 'geannuleerd', melding: 'Het bericht bestaat niet meer in Buffer (verwijderd).' };
  if (p.status === 'error') return { status: 'fout', melding: p.error?.message || 'Buffer kon het bericht niet plaatsen.' };
  if (p.status === 'sent') {
    if (p.schedulingType === 'notification') {
      return p.notificationStatus === 'markedAsPublished'
        ? { status: 'gepubliceerd', gepubliceerd_op: p.sentAt, extern_link: p.externalLink || null, melding: 'Op je telefoon geplaatst en in Buffer als gepubliceerd gemarkeerd.' }
        : { status: 'herinnering', herinnerd_op: p.sentAt, melding: 'Herinnering verstuurd: rond het af op je telefoon. Nog niet gepubliceerd.' };
    }
    return { status: 'gepubliceerd', gepubliceerd_op: p.sentAt, extern_link: p.externalLink || null, melding: null };
  }
  return { status: 'in_buffer', melding: { draft: 'Staat als concept in Buffer.', needs_approval: 'Wacht op goedkeuring in Buffer.', sending: 'Wordt nu geplaatst.' }[p.status] || null };
}
