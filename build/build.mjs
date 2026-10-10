/* ============================================================
   KRAMER — static site generator
   Two sources of truth: the ARTISTS array in index.html (artists,
   works) and build/shows.mjs (exhibitions, events, press). From them
   this writes
     /artistes/<slug>/index.html      one record page per artist
     /artistes/index.html             the artist register
     /expositions/<slug>/index.html   one record page per show
     /expositions/index.html          the exhibition register
     sitemap.xml
   and refreshes the generated regions of index.html, each fenced by
   <!--BUILD:name-->…<!--/BUILD:name--> (a BUILD comment pair inside the script):
   the exhibition + event registers, the artist list, the carousel, the
   JSON-LD block and the three meta descriptions. Nothing else in
   index.html is touched.
   Run from WEB/:  node build/build.mjs
   Status (à venir / en cours / terminée) is derived from today's date,
   never stored. To see the site on another day:
     KRAMER_TODAY=2026-10-02 node build/build.mjs
============================================================ */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { SHOWS } from './shows.mjs';

const WEB = join(dirname(fileURLToPath(import.meta.url)), '..');
const SITE = 'https://kramer.paris';

let home = readFileSync(join(WEB, 'index.html'), 'utf8'); // rewritten region by region, written once at the end
const homeOriginal = home; // pre-mutation snapshot, so the sitemap can tell whether '/' actually changed
const ARTISTS = eval(home.match(/const ARTISTS=(\[[\s\S]*?\]);/)[1]);
/* Cloudflare Web Analytics token — single-sourced from index.html (const CF_TOKEN='…') */
const CF_TOKEN = (home.match(/const CF_TOKEN='([^']*)'/) || [])[1] || '';
/* Carousel hero map — single-sourced from index.html (const ARTIST_IMG={…}); used as Person image */
const ARTIST_IMG = eval('(' + ((home.match(/const ARTIST_IMG=(\{[\s\S]*?\});/) || [])[1] || '{}') + ')');

const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
/* strip tags/entities from an html string (event programme names) */
const htmlText = s => String(s).replace(/<[^>]+>/g, '').replace(/&amp;/g, '&');
const plural = (n, w) => `${n} ${w}${n > 1 ? 's' : ''}`;
const warnings = [];
const warn = m => { warnings.push(m); console.warn('⚠ ' + m); };

/* work-title → URL-fragment slug, for stable VisualArtwork @ids (referenced from
   each show's ExhibitionEvent.workFeatured — keep both sides using this one helper) */
const slugify = s => stripDiacritics(String(s))
  .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
/* an artist with several works under one title (Luka Naujoks' three «Bouquets») gets the
   year appended to those ids; every other work keeps the plain title slug */
const workSlug = (a, w) => a.works.filter(x => slugify(x.t) === slugify(w.t)).length > 1
  ? `${slugify(w.t)}-${slugify(w.d)}` : slugify(w.t);

/* ------------------------------------------------------------
   THE REGISTER OF SHOWS — status is derived here, never stored.
   (The home page once still read «exposition en cours» a month after
   the show closed, because the label was written by hand.)
------------------------------------------------------------ */
const TODAY = process.env.KRAMER_TODAY || new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Paris' }).format(new Date());
if (!/^\d{4}-\d{2}-\d{2}$/.test(TODAY)) throw new Error(`KRAMER_TODAY must be YYYY-MM-DD, got "${TODAY}"`);
const statusOf = s => TODAY < s.from ? 'à venir' : TODAY <= s.to ? 'en cours' : 'terminée';
const showUrl = s => `${SITE}/expositions/${s.slug}/`;
const metaDates = s => s.dates.replace(' – ', '–');

const SHOW_BY = Object.fromEntries(SHOWS.map(s => [s.code, s]));
const showsAsc = [...SHOWS].sort((a, b) => a.from.localeCompare(b.from));
const showsDesc = [...showsAsc].reverse();
/* the show the home page is about: the one running, else the next one, else the latest;
   PREVIOUS is the most recent finished show besides it (build-summary line only) */
const CURRENT = showsAsc.find(s => statusOf(s) === 'en cours') || showsAsc.find(s => statusOf(s) === 'à venir') || showsAsc[showsAsc.length - 1];
const PREVIOUS = showsDesc.find(s => s !== CURRENT && statusOf(s) === 'terminée');

const ARTIST_BY_NAME = new Map(ARTISTS.map(a => [a.name, a]));
/* an artist's representative image — the carousel hero if one's set, else their first
   consigned work's plate. Shared by the Person JSON-LD image and the /artistes/ hover preview. */
const artistHeroImg = a => ARTIST_IMG[a.slug] ? `${SITE}/${ARTIST_IMG[a.slug]}`
  : (a.works[0] && a.works[0].i
      ? (p => `${SITE}/images/${p.dir}/${p.f}`)(plateOf(a.works[0].i, a.works[0]))
      : '');
/* which shows an artist is in — derived from SHOWS[].artists, so membership is recorded once */
const showsOf = a => showsAsc.filter(s => s.artists.includes(a.name));
/* a work's show: its own `x` code, else the artist's only show */
function showOfWork(a, w) {
  if (w.x) {
    if (!SHOW_BY[w.x]) throw new Error(`${a.name}: work "${w.t}" has x:'${w.x}', which is not a show code`);
    return SHOW_BY[w.x];
  }
  const ss = showsOf(a);
  if (ss.length === 1) return ss[0];
  throw new Error(`${a.name}: work "${w.t}" needs x:'KRnn' — the artist is in ${ss.length ? 'several shows' : 'no show'}`);
}

/* Museum-tombstone captions for a work's plates — shared by the per-artist pages
   (work-cap paragraphs) and the home carousel (work slides pulled in from shows.mjs). */
/* Each plate carries its own photo credit. `i` and string `views` inherit the work's `ph`;
   an object view {f, ph, dir} overrides it (e.g. Matteo's install shots hung under an artist-
   credited reproduction). `dir` lets a view point at images/installation/ instead of
   images/works/ — used for an installation shot an artist is pictured in, so the photo has
   ONE file and ONE URL (the show's own copy) rather than a byte-identical second copy sitting
   under the artist, which just competes with itself in image search. Returns [{f, ph, dir}]
   in display order. Both `i` and a view accept either form, so a work whose only
   photograph is a room shot (Luka's Bouquets, Yeva's Tulipes, Caroline's étoile) can
   point its hero straight at images/installation/ — before 2026-10-09 `i` was assumed
   to be a string and an object there rendered as the literal "[object Object]". */
const plateOf = (v, w) => typeof v === 'string'
  ? { f: v, ph: w.ph || '', dir: 'works' }
  : { f: v.f, ph: v.ph || w.ph || '', dir: v.dir || 'works' };
const workImgs = w => [
  ...(w.i ? [plateOf(w.i, w)] : []),
  ...(w.views || []).map(v => plateOf(v, w)),
];
/* filename convention: an installation shot (…inst-N…) gets the exhibition caption;
   a work shot (obj/det/repro) gets the tombstone. …det-N… gets a "(détail)" marker. */
const isInst = f => /inst-\d/i.test(f);
const isDet = f => /det-\d/i.test(f);
const courtesy = w => w.c === undefined ? "Courtoisie de l'artiste" : w.c;
/* Credit: the gallery's own shots (Matteo Kramer) are credited simply "Kramer";
   any other photographer keeps the "Photo : Name" form. */
const credit = ph => !ph ? '' : (/^(matteo\s+)?kramer$/i.test(ph) ? 'Kramer' : 'Photo : ' + esc(ph));
const workCap = (a, w, ph, det) => [
  `${esc(a.name)}, <em>${esc(w.t)}</em>${det ? ' (détail)' : ''}${w.d ? ', ' + esc(String(w.d)) : ''}.`,
  [w.m, w.s, w.e].filter(Boolean).map(esc).join(', ') ? [w.m, w.s, w.e].filter(Boolean).map(esc).join(', ') + '.' : '',
  courtesy(w) ? esc(courtesy(w)) + '.' : '',
  credit(ph) ? credit(ph) + '.' : '',
].filter(Boolean).join(' ');
/* plain-text variant (no <em>) for attributes such as the carousel's img alt */
const workCapText = (a, w, ph, det) => workCap(a, w, ph, det).replace(/<\/?em>/g, '');

/* fail loudly on register mistakes rather than publishing them */
{
  const seen = new Set();
  for (const s of SHOWS) {
    for (const k of ['code', 'slug', 'title', 'from', 'to', 'dates', 'desc', 'artists']) if (s[k] === undefined) throw new Error(`shows.mjs: ${s.code || s.slug || '?'} has no "${k}"`);
    if (seen.has(s.code) || seen.has(s.slug)) throw new Error(`shows.mjs: duplicate code or slug ${s.code} / ${s.slug}`);
    seen.add(s.code); seen.add(s.slug);
    if (s.to < s.from) throw new Error(`shows.mjs: ${s.code} ends before it starts`);
  }
  const lower = new Map(ARTISTS.map(a => [a.name.toLowerCase(), a.name]));
  for (const s of SHOWS) for (const n of s.artists) {
    if (!ARTIST_BY_NAME.has(n) && lower.has(n.toLowerCase())) throw new Error(`shows.mjs: "${n}" in ${s.code} differs only in case from the artist record "${lower.get(n.toLowerCase())}"`);
  }
  for (const a of ARTISTS) if (!showsOf(a).length) throw new Error(`${a.name} is in no show — list them in SHOWS[].artists`);
}

/* Gallery detail fields shared by the embedded GALLERY node (below) and the home page's
   ArtGallery node — one definition, so the two cannot drift. */
const LOGO = `${SITE}/images/kramer_wordmark.png`;
const MAP_URL = 'https://www.google.com/maps/search/?api=1&query=132%20Bd%20de%20Magenta%2C%2075010%20Paris';
const GALLERY_DESC = "Galerie d'art contemporain à Paris (10e) — galerie d'appartement, registre d'expositions.";
/* Verified 2026-09-15 against the French national address database (api-adresse.data.gouv.fr,
   confidence 0.979) and OpenStreetMap Nominatim, both agreeing to 4 decimal places. */
const GEO = { '@type': 'GeoCoordinates', latitude: 48.880867, longitude: 2.352205 };

/* Mechanical name variants for entity disambiguation (people search with and
   without diacritics). Derived only: diacritics stripped + German/Nordic
   transliteration, applied to the display name AND any hand-supplied a.alt
   spellings (real variants only — e.g. a legal name). Never invented. */
const stripDiacritics = s => s.normalize('NFD').replace(/[̀-ͯ]/g, '');
const translit = s => s.replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/Ä/g, 'Ae').replace(/Ö/g, 'Oe').replace(/Ü/g, 'Ue').replace(/ß/g, 'ss')
  .replace(/ø/g, 'o').replace(/Ø/g, 'O').replace(/æ/g, 'ae').replace(/Æ/g, 'Ae');
const nameVariants = a => {
  const bases = [a.name, ...(a.alt || [])];
  return [...new Set(bases.flatMap(n => [n, stripDiacritics(n), translit(n)]))].filter(v => v && v !== a.name);
};

/* One gallery entity, embedded in every record page's graph so Person.affiliation
   resolves without a cross-page fetch. */
const GALLERY_ID = `${SITE}/#gallery`;
const WEBSITE_ID = `${SITE}/#website`;
const GALLERY = {
  '@type': 'ArtGallery', '@id': GALLERY_ID, name: 'Kramer', url: `${SITE}/`,
  image: LOGO, logo: LOGO, description: GALLERY_DESC,
  address: { '@type': 'PostalAddress', streetAddress: '132 Bd de Magenta', postalCode: '75010', addressLocality: 'Paris', addressCountry: 'FR' },
  geo: GEO, hasMap: MAP_URL,
  sameAs: ['https://www.instagram.com/galeriekramer/'],
};
/* the home page adds the two fields only it carries */
const HOME_GALLERY = {
  ...GALLERY,
  knowsAbout: ['art contemporain', "galerie d'appartement", 'art et technologie', 'art et nature', 'diaspora', 'altérité', 'classe', 'peinture', 'sculpture', 'photographie', 'dessin', 'gravure', 'installation', 'collage', 'sérigraphie', 'art vidéo'],
};
const WEBSITE = { '@type': 'WebSite', '@id': WEBSITE_ID, name: 'Kramer', url: `${SITE}/`, inLanguage: 'fr', publisher: { '@id': GALLERY_ID } };
const IS_PART_OF = { '@type': 'WebSite', '@id': WEBSITE_ID, name: 'Kramer', url: `${SITE}/` };

/* ------------------------------------------------------------
   SHARED PIECES
------------------------------------------------------------ */
const CF_BEACON = CF_TOKEN ? `<script defer src='https://static.cloudflareinsights.com/beacon.min.js' data-cf-beacon='${JSON.stringify({ token: CF_TOKEN })}'></script>` : '';

/* Every generated page: same head, same pinned chrome, same footer line. */
const shell = ({ depth, title, desc, url, ogTitle, ogDesc, ogImage, ogAlt, ogType = 'website', ld, topRight, main, script }) => {
  const up = '../'.repeat(depth);
  return `<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${esc(title)}</title>
<meta name="description" content="${esc(desc)}">
<link rel="canonical" href="${url}">
<link rel="icon" href="${up}images/edelweiss.svg">
<link rel="preconnect" href="https://use.typekit.net" crossorigin>
<meta property="og:type" content="${ogType}">
<meta property="og:title" content="${esc(ogTitle)}">
<meta property="og:description" content="${esc(ogDesc)}">
<meta property="og:url" content="${url}">
<meta property="og:image" content="${ogImage}">
<meta property="og:image:alt" content="${esc(ogAlt)}">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${esc(ogTitle)}">
<meta name="twitter:description" content="${esc(ogDesc)}">
<meta name="twitter:image" content="${ogImage}">
<script type="application/ld+json">
${JSON.stringify(ld)}
</script>
<link rel="stylesheet" href="https://use.typekit.net/svm4vfk.css">
<link rel="stylesheet" href="${up}kramer.css">
</head>
<body>
<div class="chrome ct"><a class="cnav c9" href="${up}"><span class="hb-arrow" aria-hidden="true">←</span> Retour</a><div class="c9i">${topRight}</div></div>

<main class="wrap">
${main}
</main>

<div class="chrome cb"><div class="c9">© Kramer 2026</div><a href="${up}#section-acces" class="cnav c9">Contact</a></div>

<script>
${script}
</script>
${CF_BEACON}
</body>
</html>
`;
};

/* the home page's footer line, on every other page too: just the legal link */
const pageFoot = depth => {
  const up = '../'.repeat(depth);
  return `<p class="page-foot"><a href="${up}#mentions-legales">Mentions légales</a></p>`;
};

/* Presse: reverse-chronological outbound links (publication — «title», author), the
   registry way of citing coverage. Dates are YYYY, YYYY-MM or YYYY-MM-DD, shown DD.MM.YYYY.
   Rendered only when there is something to show — never an empty «Presse» heading. */
const pressDate = d => { const [y, m, dd] = String(d).split('-'); return [dd, m, y].filter(Boolean).join('.'); };
const pressRows = list => [...(list || [])]
  .sort((a, b) => String(b.d).localeCompare(String(a.d)))
  .map(p => {
    for (const k of ['d', 'pub', 't', 'url']) if (!p[k]) throw new Error(`press entry lacks "${k}": ${JSON.stringify(p)}`);
    return `<div class="cv-row"><span class="cv-yr">${esc(pressDate(p.d))}</span><span>${esc(p.pub)} — <a href="${esc(p.url)}" target="_blank" rel="noopener">«&nbsp;${esc(p.t)}&nbsp;»</a>${p.by ? ', par ' + esc(p.by) : ''}</span></div>`;
  });
const docRows = list => (list || []).map(d => `<div class="cv-row"><span class="cv-yr"></span><span><a href="${esc(d.url)}" target="_blank" rel="noopener">${esc(d.t)}</a></span></div>`);

/* register lists — one row per artist; a name with a record page links to it, any other is plain text */
const artistItem = (name, href, code, img) => {
  const label = esc(name) + (code ? ` <em>${esc(code)}</em>` : '');
  return href
    ? `        <li class="artist-item">
          <a class="artist-link" href="${href}"${img ? ` data-hover-img="${esc(img)}"` : ''}>
            <div class="cb-box"></div>
            <span class="artist-nm">${label}</span>
          </a>
        </li>`
    : `        <li class="artist-item plain">
          <div class="artist-link">
            <div class="cb-box"></div>
            <span class="artist-nm">${label}</span>
          </div>
        </li>`;
};
const showRoster = (s, artistBase) => s.artists.map(n => {
  const rec = ARTIST_BY_NAME.get(n);
  return artistItem(n, rec ? `${artistBase}${rec.slug}/` : '');
}).join('\n');

/* one event, as a register entry (home page register + each show page). showCode:false
   drops the internal registry code (e.g. "KR01V") — meaningless to a visitor; the show's
   own page already carries its code once, at the top. */
const eventItem = (ev, { showCode = true } = {}) => {
  const L = [];
  L.push('        <li class="ev-item">');
  L.push(`          <p class="exh-ref">${showCode ? `${esc(ev.kind)} · ${esc(ev.code)}` : esc(ev.kind)}</p>`);
  L.push(`          <p class="ac-big">${ev.title}</p>`);
  (ev.meta || []).forEach(m => L.push(`          <p class="ev-meta">${m}</p>`));
  if (ev.note) L.push(`          <p class="ev-note">${ev.note}</p>`);
  if (ev.prog && ev.prog.length) {
    L.push('          <ul class="prog-list">');
    ev.prog.forEach(([n, w]) => L.push(`            <li class="prog-item"><span class="prog-name">${n}</span><span class="prog-work">${w}</span></li>`));
    L.push('          </ul>');
  }
  if (ev.note2) L.push(`          <p class="ev-note">${ev.note2}</p>`);
  L.push('        </li>');
  return L.join('\n');
};

/* a show as a register entry; `href` is where the title points. Under a status heading
   (/expositions/) the reference line carries only the code — the heading already says it.
   showCode:false (the home page) drops the code too, leaving just the status word.
   checkbox:true (the home page's Registre des expositions) renders the entry beside a
   cb-box, like the artist list, instead of opening with a reference line.
   cur:false (the home page only) drops the commissariat line — the home register is a
   quick index; commissariat is a detail, already shown on /expositions/ and the show's
   own page (field('Commissariat', …) below). */
const showItem = (s, href, { artists = false, status = true, showCode = true, checkbox = false, cur = true } = {}) => {
  const ref = [showCode ? s.code : '', status ? statusOf(s) : ''].filter(Boolean).join(' · ');
  /* checkbox:true wraps the whole row (box + title + dates) in one <a>, so the box and
     the date range are just as clickable as the title text — can't nest an <a> inside
     that, so the title stays plain text there instead of its own link */
  const titleLine = checkbox
    ? `          <p class="ac-big">${esc(s.title)} — ${esc(s.dates)}</p>`
    : `          <p class="ac-big"><a href="${href}">${esc(s.title)}</a> — ${esc(s.dates)}</p>`;
  const body = `${ref ? `          <p class="exh-ref">${ref}</p>\n` : ''}${titleLine}${cur && s.cur ? `
          <p class="ev-meta">Commissariat · ${esc(s.cur)}</p>` : ''}${artists && s.artists.length ? `
          <p class="ev-note">Avec ${esc(s.artists.join(', '))}.</p>` : ''}`;
  return checkbox
    ? `        <li class="ev-item">
          <a class="ev-link" href="${href}">
            <div class="cb-box"></div>
            <div class="ev-body">
${body}
            </div>
          </a>
        </li>`
    : `        <li class="ev-item">
${body}
        </li>`;
};

/* every distinct name in the register, with the codes it appears under:
   the artists of each show, and the artists of each event's programme (KR01V) */
function registerRows() {
  const map = new Map();
  const add = (name, code) => { const r = map.get(name) || { name, codes: [] }; if (!r.codes.includes(code)) r.codes.push(code); map.set(name, r); };
  for (const s of showsAsc) {
    s.artists.forEach(n => add(n, s.code));
    for (const ev of s.events || []) (ev.prog || []).forEach(([n]) => add(htmlText(n), ev.code));
  }
  return [...map.values()].sort((a, b) => a.name.localeCompare(b.name, 'fr', { sensitivity: 'base' }));
}

/* ------------------------------------------------------------
   JSON-LD — one graph per show, used on the show page and, for the
   current show, on the home page (same @ids, so they agree)
------------------------------------------------------------ */
const EVENT_STATUS = 'https://schema.org/EventScheduled';   // schema.org has no "past" status: the dates carry that
const ATTENDANCE = 'https://schema.org/OfflineEventAttendanceMode';
const gRef = { '@id': GALLERY_ID };

/* event nodes are written in shows.mjs with only what is particular to them;
   the constants every event here shares are filled in */
const eventNodes = s => (s.events || [])
  .flatMap(ev => ev.ld || [])
  .map(n => {
    const o = { ...n };
    const dflt = { eventStatus: EVENT_STATUS, eventAttendanceMode: ATTENDANCE, image: LOGO, location: gRef, organizer: gRef, superEvent: { '@id': `${showUrl(s)}#exposition` } };
    for (const [k, v] of Object.entries(dflt)) if (!(k in o)) o[k] = v;
    return o;
  })
  .sort((a, b) => a.startDate.localeCompare(b.startDate));

const performers = s => s.artists.map(n => {
  const rec = ARTIST_BY_NAME.get(n);
  return rec ? { '@type': 'Person', '@id': `${SITE}/artistes/${rec.slug}/#person`, name: rec.name, url: `${SITE}/artistes/${rec.slug}/` } : { '@type': 'Person', name: n };
});
/* each consigned work → a stub matching the VisualArtwork @id on the artist's page */
const workStubs = s => ARTISTS.flatMap(a => a.works.filter(w => showOfWork(a, w) === s).map(w =>
  ({ '@type': 'VisualArtwork', '@id': `${SITE}/artistes/${a.slug}/#oeuvre-${workSlug(a, w)}`, name: w.t, url: `${SITE}/artistes/${a.slug}/` })));

const exhibitionNode = s => {
  const works = workStubs(s), evs = eventNodes(s);
  return {
    '@type': 'ExhibitionEvent', '@id': `${showUrl(s)}#exposition`, name: s.title, description: s.desc, url: showUrl(s),
    startDate: s.from, endDate: s.to, eventStatus: EVENT_STATUS, eventAttendanceMode: ATTENDANCE, image: LOGO,
    location: gRef, organizer: s.org && s.org.length ? [gRef, ...s.org] : gRef,
    ...(works.length ? { workFeatured: works } : {}),
    performer: performers(s),
    ...(evs.length ? { subEvent: evs.map(e => ({ '@id': e['@id'] })) } : {}),
  };
};
const breadcrumbNode = (url, crumbs) => ({
  '@type': 'BreadcrumbList', '@id': `${url}#breadcrumb`,
  itemListElement: crumbs.map(([name, item], i) => ({ '@type': 'ListItem', position: i + 1, name, item })),
});

/* ------------------------------------------------------------
   ARTIST PAGE
------------------------------------------------------------ */
function page(a, i) {
  const entry = String(i + 1).padStart(3, '0');
  const url = `${SITE}/artistes/${a.slug}/`;
  const aShows = showsOf(a);                       // oldest → newest
  const latest = aShows[aShows.length - 1];        // the page's title/description name the most recent show
  const refOf = w => showOfWork(a, w).code + a.code;

  /* --- SEO-derived values (only from on-file data) --- */
  const mediumList = a.medium ? a.medium.split(',').map(s => s.trim()).filter(Boolean) : [];
  const primaryMedium = mediumList[0] || '';
  const titleMedium = primaryMedium ? ` — ${primaryMedium}` : '';
  const descMedium = a.medium ? `, ${a.medium.toLowerCase()}` : '';
  const descBased = a.based ? ` (${a.based})` : '';
  const ogDesc = (a.medium ? a.medium + ' · ' : '') + `${latest.title} · Kramer, Paris`;
  /* birth year + place parsed from a.born ("1998, Tel Aviv" | "1999" | "Montana, USA" | "2002") */
  const yearMatch = (a.born || '').match(/\b(?:18|19|20)\d{2}\b/);
  const birthDate = yearMatch ? yearMatch[0] : '';
  const birthPlace = (a.born || '').replace(/\b(?:18|19|20)\d{2}\b/, '').replace(/^[\s,]+|[\s,]+$/g, '').trim();

  /* JSON-LD graph: WebPage (mainEntity → Person) + enriched Person + the gallery
     + a VisualArtwork per consigned work */
  const personId = `${url}#person`;
  /* Google cuts a title at roughly 60 characters. Name first, gallery last — so when the
     show's title makes the line too long it is the show that goes, not «Kramer, Paris»
     (the page says which show it is twice over, in the «Au registre» field and the H1's
     reference line). The JSON-LD WebPage.name reuses this same string, as it always has. */
  const fullTitle = `${a.name}${titleMedium} · ${latest.title} · Kramer, Paris`;
  const titleTxt = fullTitle.length > 60 ? `${a.name}${titleMedium} · Kramer, Paris` : fullTitle;
  /* ~155 characters is what a result page shows; past that the tail is cut, and the tail is
     where the gallery and the city are. So the line is assembled from segments and the least
     useful ones are dropped — in order — until it fits: «registre des artistes» (the breadcrumb
     already says it), then the city, then the medium list. The <meta>, the OG/Twitter
     description and the JSON-LD description all read this one string. */
  const descTxt = (() => {
    const build = (reg, based, medium) =>
      `${a.name}${medium ? descMedium : ''}${based ? descBased : ''} — exposition « ${latest.title} » (${latest.code})${reg ? ', registre des artistes' : ''}. Kramer, galerie d'art contemporain, Paris 10e.`;
    for (const [reg, based, medium] of [[1, 1, 1], [0, 1, 1], [0, 0, 1], [0, 0, 0]]) {
      const t = build(reg, based, medium);
      if (t.length <= 160) return t;
    }
    return build(0, 0, 0);
  })();
  const variants = nameVariants(a);
  const heroImg = artistHeroImg(a);
  const webpage = {
    '@type': 'WebPage', '@id': url, url, name: titleTxt, description: descTxt,
    inLanguage: 'fr', mainEntity: { '@id': personId },
    isPartOf: IS_PART_OF,
    breadcrumb: { '@id': `${url}#breadcrumb` },
  };
  /* Mirrors the visible crumb (Accueil › Registre des artistes › Name) rendered below */
  const breadcrumb = breadcrumbNode(url, [['Accueil', `${SITE}/`], ['Registre des artistes', `${SITE}/artistes/`], [a.name, url]]);
  const person = {
    '@type': 'Person', '@id': personId, name: a.name,
    ...(variants.length ? { alternateName: variants.length === 1 ? variants[0] : variants } : {}),
    url, jobTitle: ['Artiste', 'Visual Artist'],
    ...(heroImg ? { image: heroImg } : {}),
    ...(mediumList.length ? { knowsAbout: mediumList } : {}),
    ...(birthDate ? { birthDate } : {}),
    ...(birthPlace ? { birthPlace: { '@type': 'Place', name: birthPlace } } : {}),
    ...(a.nat ? { nationality: { '@type': 'Country', name: a.nat } } : {}),
    ...(a.based ? { homeLocation: { '@type': 'Place', name: a.based } } : {}),
    ...(a.g === 'f' ? { gender: 'https://schema.org/Female' } : a.g === 'm' ? { gender: 'https://schema.org/Male' } : {}),
    affiliation: { '@id': GALLERY_ID },
    ...(a.links && a.links.length ? { sameAs: a.links } : {}),
  };
  /* Google's Image Metadata structured data (the "Licensable" badge) wants license,
     copyrightNotice, creator and acquireLicensePage on every ImageObject — added
     2026-09-17 from GSC's "Image Metadata" report. All four are derived from facts
     already on file, not new policy: the Mentions légales overlay already states the
     reproduction-rights position ("Toute reproduction… est interdite sans autorisation
     préalable"), so it doubles as the license URL; the access section is where that
     authorization is actually requested, so it's the acquireLicensePage; copyright of
     a photographed artwork sits with the artist per that same Mentions légales text
     (an install view, showing the show rather than one artist's piece, is credited to
     KRAMER instead); creator resolves the photographer (`ph`) to the artist's own
     Person node when they shot their own work, an Organization for the gallery's own
     shots, or a plain Person for a named third party (e.g. marytwo.one). */
  const LICENSE_URL = `${SITE}/#mentions-legales`;
  const ACQUIRE_LICENSE_URL = `${SITE}/#section-acces`;
  const imgCreator = ph => !ph ? undefined
    : /^(matteo\s+)?kramer$/i.test(ph) ? { '@type': 'Organization', name: 'Kramer', url: `${SITE}/` }
    : ph === a.name ? { '@id': personId }
    : { '@type': 'Person', name: ph };
  /* each plate → ImageObject so its per-plate photographer credit (workImgs sets `ph`)
     rides along as creditText; bare-URL images lose that credit */
  const toImg = im => ({
    '@type': 'ImageObject', contentUrl: `${SITE}/images/${im.dir}/${im.f}`,
    ...(im.ph ? { creditText: im.ph, creator: imgCreator(im.ph) } : {}),
    copyrightNotice: isInst(im.f) ? '© KRAMER' : `© ${a.name}`,
    license: LICENSE_URL, acquireLicensePage: ACQUIRE_LICENSE_URL,
  });
  const artworks = a.works.map(w => {
    const imgs = workImgs(w);
    /* "130 × 97 cm" | "30 × 40 × 5 cm" → height × width (× depth), gallery convention;
       non-numeric sizes ("dimensions variables") are skipped */
    const dims = (w.s || '').match(/^([\d.]+)\s*×\s*([\d.]+)(?:\s*×\s*([\d.]+))?\s*cm$/);
    return {
      '@type': 'VisualArtwork', '@id': `${url}#oeuvre-${workSlug(a, w)}`,
      name: w.t, creator: { '@id': personId }, url,
      ...(w.d ? { dateCreated: String(w.d) } : {}),
      ...(primaryMedium ? { artform: primaryMedium } : {}),
      ...(w.m ? { artMedium: w.m } : {}),
      ...(dims ? {
        height: { '@type': 'Distance', name: `${dims[1]} cm` },
        width: { '@type': 'Distance', name: `${dims[2]} cm` },
        ...(dims[3] ? { depth: { '@type': 'Distance', name: `${dims[3]} cm` } } : {}),
      } : {}),
      ...(imgs.length ? { image: imgs.length === 1 ? toImg(imgs[0]) : imgs.map(toImg) } : {}),
    };
  });
  const jsonld = { '@context': 'https://schema.org', '@graph': [webpage, breadcrumb, person, GALLERY, ...artworks] };

  const bornLbl = a.g === 'f' ? 'Née' : a.g === 'm' ? 'Né' : 'Né(e)';
  const fields = [
    a.born ? `<div class="a-field"><span class="a-lbl">${bornLbl}</span><span class="a-val">${esc(a.born)}</span></div>` : '',
    a.based ? `<div class="a-field"><span class="a-lbl">Résidence</span><span class="a-val">${esc(a.based)}</span></div>` : '',
    /* the show name links to its own page — the show pages already link back to the
       artists, so this closes the loop both ways (and gives the show page a link from
       every artist who was in it) */
    `<div class="a-field"><span class="a-lbl">Au registre</span><span class="a-val">${aShows.map(s => `<a href="../../expositions/${s.slug}/">${esc(`${s.title} · ${s.code}`)}</a>`).join(' / ')}</span></div>`,
  ].join('\n      ');

  /* first plate is the likely LCP → eager; everything after lazy-loads */
  let plateN = 0;
  const plateAttrs = () => plateN++ === 0 ? ' fetchpriority="high"' : ' loading="lazy" decoding="async"';
  /* Every plate carries its own full caption underneath (isInst/isDet/courtesy/credit/
     workCap are module-level, shared with the home carousel's work slides). An installation
     shot (filename …inst-N…) gets the exhibition caption; a work shot (obj/det/repro) gets
     the museum tombstone. Each caption names its own photographer, so a work photographed
     by several people reads correctly plate by plate. */
  /* Installation shots always carry an explicit "Photo :" prefix (even for the
     gallery's own Kramer shots) — unlike work plates, where "Kramer" stands bare. */
  const instCredit = ph => !ph ? '' : 'Photo : ' + (/^(matteo\s+)?kramer$/i.test(ph) ? 'Kramer' : esc(ph));
  const instCap = (ph, show) => `«${esc(show.title)}», vue d'installation, KRAMER, Paris, ${show.from.slice(0, 4)}.${instCredit(ph) ? ' ' + instCredit(ph) + '.' : ''}`;
  const inquire = w => `<a class="work-inquire" href="#" data-t="${esc(w.t)}" data-d="${esc(w.d)}" data-s="${esc(w.s)}" data-r="${esc(refOf(w))}">Demander la fiche →</a>`;
  const works = a.works.length ? `
    <h2 class="s-head">Œuvres — ${a.works.length} entrée${a.works.length > 1 ? 's' : ''}</h2>
    <div class="works-grid">
      ${a.works.map(w => {
        const show = showOfWork(a, w);
        const imgs = workImgs(w);
        const baseAlt = esc(w.t + (w.m ? ', ' + w.m : '') + (w.s ? ' · ' + w.s : ''));
        /* no photograph yet → caption only; never a stand-in image */
        if (!imgs.length) return `<div class="work-item">
        <p class="work-cap">${workCap(a, w, '', false)}</p>
        ${inquire(w)}
      </div>`;
        const plates = imgs.map(im => {
          const inst = isInst(im.f);
          /* a work with several plates used to repeat one alt string verbatim; the detail
             shots say so, as the caption under them already does */
          const alt = inst ? esc(`Vue d'installation de «${show.title}», KRAMER — ${a.name}`)
            : isDet(im.f) ? `${baseAlt} (détail)` : baseAlt;
          const cap = inst ? instCap(im.ph, show) : workCap(a, w, im.ph, isDet(im.f));
          return `<div class="work-plate"><img src="../../images/${im.dir}/${im.f}" alt="${alt}"${plateAttrs()}></div>
        <p class="work-cap">${cap}</p>`;
        });
        /* the "Demander la fiche" link belongs under the WORK, never an installation
           view: drop it in after the last non-install plate; trailing install plates
           (exhibition context) render below it */
        let lastWork = -1;
        imgs.forEach((im, i) => { if (!isInst(im.f)) lastWork = i; });
        if (lastWork === -1) lastWork = imgs.length - 1;
        const parts = [];
        plates.forEach((p, i) => { parts.push(p); if (i === lastWork) parts.push(inquire(w)); });
        return `<div class="work-item">
        ${parts.join('\n        ')}
      </div>`;
      }).join('\n      ')}
    </div>` : '';

  /* bio: optional data field — paragraphs split on blank lines. Either Matteo's own text or
     the artist's own, supplied through /depot/ section 02 with publication consent; the fiche
     records which. Absent field keeps the empty placeholder; never generated.
     bioLang: set it when the text is not in the page's French, so the markup says so — an
     artist's own words are recorded as they state them rather than translated. */
  const bio = a.bio
    ? `<div class="a-bio"${a.bioLang ? ` lang="${a.bioLang}"` : ''}>${a.bio.split(/\n\s*\n/).map(p => `<p>${esc(p.trim())}</p>`).join('')}</div>`
    : `<div class="a-bio"><!-- bio à venir --></div>`;

  const cvBlock = (label, rows) => rows.length ? `
    <h2 class="cv-section">${label}</h2>
    ${rows.map(r => `<div class="cv-row"><span class="cv-yr">${esc(r[0])}</span><span>${esc(r[1])}</span></div>`).join('\n    ')}` : '';
  /* extra: optional public-record sections from the fiche (education, awards, publications…)
     — each {l:'Label', rows:[[year,text],…]} renders like the solo/group blocks */
  const extras = (a.extra || []).map(s => cvBlock(s.l, s.rows)).join('');
  /* press: optional press:[{d,pub,t,by,url}] on the record — coverage, last in the record */
  const presse = pressRows(a.press);
  const presseBlock = presse.length ? `
    <h2 class="cv-section">Presse</h2>
    ${presse.join('\n    ')}` : '';
  const cv = (a.solo.length || a.group.length || extras || presseBlock) ? `
    <div class="cv">${cvBlock('Solo exhibitions', a.solo)}${cvBlock('Group exhibitions', a.group)}${extras}${presseBlock}
    </div>` : '';

  const main = `  <p class="crumb"><a href="../">Registre des artistes</a> › ${esc(a.name)}</p>

  <article>
  <h1 class="a-name">${esc(a.name)}</h1>
  <p class="a-ref">Entrée ${entry} · ${aShows.map(s => esc(s.title)).join(' / ')}</p>
  <div class="a-fields">
      ${fields}
  </div>

  ${bio}
${works}${cv}
  </article>
  ${pageFoot(2)}`;

  const script = `/* email assembled at runtime so it stays out of the static source */
(function(){
  var addr='contact'+'@'+'kramer'+String.fromCharCode(46)+'paris';
  document.querySelectorAll('.work-inquire').forEach(function(el){
    var t=el.getAttribute('data-t'), d=el.getAttribute('data-d'), s=el.getAttribute('data-s'), ref=el.getAttribute('data-r');
    var subj=encodeURIComponent('Demande — '+ref+' · '+t);
    var body=encodeURIComponent('Bonjour,\\n\\nJe souhaite recevoir la fiche de l\\'œuvre suivante :\\n— '+t+' ('+d+'), '+s+'\\nRéf. '+ref+'\\n\\n');
    el.setAttribute('href','mailto:'+addr+'?subject='+subj+'&body='+body);
  });
})();
`;

  return shell({
    depth: 2, title: titleTxt, desc: descTxt, url,
    ogType: 'profile', ogTitle: `${a.name} — Kramer`, ogDesc,
    ogImage: heroImg || LOGO,
    ogAlt: heroImg ? a.name + (a.works[0] ? ' — ' + a.works[0].t : '') : 'Kramer',
    ld: jsonld, topRight: `Entrée ${entry}`, main, script,
  });
}

/* ------------------------------------------------------------
   SHOW PAGE — /expositions/<slug>/
------------------------------------------------------------ */
function showPage(s) {
  const url = showUrl(s);
  const status = statusOf(s);
  const events = [...(s.events || [])].sort((a, b) => b.day.localeCompare(a.day));
  const views = s.views || [];
  const metaDesc = s.metaDesc || `« ${s.title} » (${s.code}) — exposition, ${metaDates(s)}${s.cur ? ', commissariat ' + s.cur : ''}. Kramer, galerie d'art contemporain, Paris 10e.`;
  const titleTxt = `${s.title} — exposition (${s.code}) · Kramer, Paris`;
  const ogImage = views.length ? `${SITE}/images/installation/${views[0].f}` : LOGO;

  const webpage = {
    '@type': 'WebPage', '@id': url, url, name: titleTxt, description: metaDesc, inLanguage: 'fr',
    mainEntity: { '@id': `${url}#exposition` }, isPartOf: IS_PART_OF, breadcrumb: { '@id': `${url}#breadcrumb` },
  };
  const breadcrumb = breadcrumbNode(url, [['Accueil', `${SITE}/`], ['Registre des expositions', `${SITE}/expositions/`], [s.title, url]]);
  const ld = { '@context': 'https://schema.org', '@graph': [webpage, breadcrumb, GALLERY, exhibitionNode(s), ...eventNodes(s)] };

  const field = (lbl, val) => `<div class="a-field"><span class="a-lbl">${lbl}</span><span class="a-val">${esc(val)}</span></div>`;
  const fields = [
    field('Dates', s.dates),
    s.hours ? field('Horaires', s.hours) : '',
    field('Lieu', '132 Bd de Magenta, 75010 Paris'),
    s.cur ? field('Commissariat', s.cur) : '',
  ].filter(Boolean).join('\n      ');

  const heading = (label, n) => `    <h2 class="s-head">${label}${n ? ` — ${plural(n, 'entrée')}` : ''}</h2>`;
  const blocks = [];
  if (s.prose) blocks.push(`    <div class="show-prose">
      <p class="lang-toggle">Texte · <a href="#" id="lt-fr" class="on" onclick="setProseLang('fr');return false">FR</a> / <a href="#" id="lt-en" onclick="setProseLang('en');return false">EN</a></p>
      <div class="prose" id="prose-fr" lang="fr">${s.prose.fr.replace(/\s+$/, '')}
      </div>
      <div class="prose" id="prose-en" lang="en" hidden>${s.prose.en.replace(/\s+$/, '')}
      </div>
    </div>`);
  if (s.artists.length) blocks.push(`${heading('Artistes', s.artists.length)}
      <ul class="artist-list">
${showRoster(s, '../../artistes/')}
      </ul>`);
  if (views.length) blocks.push(`${heading("Vues d'installation", views.length)}
      <div class="view-grid">
${views.map(v => `        <div class="view-item"><div class="view-img"><img src="../../images/installation/${esc(v.f)}" class="plate-img" alt="${esc(v.alt)}" loading="lazy" decoding="async"></div><p class="view-cap">«${esc(s.title)}», vue d'installation, KRAMER, Paris, ${s.from.slice(0, 4)}. Photo : ${esc(v.ph || 'Kramer')}.</p></div>`).join('\n')}
      </div>`);
  if (events.length) blocks.push(`${heading('Événements', events.length)}
      <ul class="ev-list">

${events.map(eventItem).join('\n\n')}

      </ul>`);
  const presse = pressRows(s.press);
  if (presse.length) blocks.push(`${heading('Presse', presse.length)}
      <div class="cv">
        ${presse.join('\n        ')}
      </div>`);
  const docs = docRows(s.docs);
  if (docs.length) blocks.push(`${heading('Documents', docs.length)}
      <div class="cv">
        ${docs.join('\n        ')}
      </div>`);

  const main = `  <p class="crumb"><a href="../">Registre des expositions</a> › ${esc(s.title)}</p>

  <article>
  <h1 class="a-name">${esc(s.title)}</h1>
  <p class="a-ref">${s.code} · ${status}</p>
  <div class="a-fields">
      ${fields}
  </div>

${blocks.join('\n\n')}
  </article>
  ${pageFoot(2)}`;

  const script = (s.prose ? `/* FR / EN toggle — both texts are in the HTML, so both are crawlable; no persistence */
function setProseLang(l){
  document.getElementById('prose-fr').hidden=(l!=='fr');
  document.getElementById('prose-en').hidden=(l!=='en');
  document.getElementById('lt-fr').classList.toggle('on',l==='fr');
  document.getElementById('lt-en').classList.toggle('on',l==='en');
}
` : '');

  return shell({
    depth: 2, title: titleTxt, desc: metaDesc, url,
    ogTitle: `${s.title} — Kramer`, ogDesc: `Exposition ${s.dates} · Kramer, galerie d'art contemporain, Paris 10e`,
    ogImage, ogAlt: views.length ? `${s.title} — vue d'installation` : 'Kramer',
    ld, topRight: s.code, main, script,
  });
}

/* ------------------------------------------------------------
   /expositions/ — the register of shows: en cours / à venir / passées
------------------------------------------------------------ */
function expositionsIndex() {
  const url = `${SITE}/expositions/`;
  const titleTxt = 'Registre des expositions · Kramer, Paris';
  const desc = `Registre des expositions de Kramer, galerie d'art contemporain, Paris 10e : ${showsAsc.map(s => `${s.code} « ${s.title} »`).join(', ')}.`;
  const groups = [['En cours', 'en cours'], ['À venir', 'à venir'], ['Passées', 'terminée']]
    .map(([label, st]) => [label, showsDesc.filter(s => statusOf(s) === st)]).filter(([, l]) => l.length);
  const body = groups.map(([label, list]) => `    <h2 class="s-head">${label} — ${plural(list.length, 'entrée')}</h2>
    <ul class="ev-list">
${list.map(s => showItem(s, `${s.slug}/`, { artists: true, status: false })).join('\n')}
    </ul>`).join('\n\n');
  const ld = {
    '@context': 'https://schema.org',
    '@graph': [
      { '@type': 'WebPage', '@id': url, url, name: titleTxt, description: desc, inLanguage: 'fr', isPartOf: IS_PART_OF, breadcrumb: { '@id': `${url}#breadcrumb` },
        mainEntity: { '@type': 'ItemList', itemListElement: showsDesc.map((s, i) => ({ '@type': 'ListItem', position: i + 1, name: s.title, url: showUrl(s) })) } },
      breadcrumbNode(url, [['Accueil', `${SITE}/`], ['Registre des expositions', url]]),
      GALLERY,
    ],
  };
  const main = `  <p class="crumb"><a href="../">Accueil</a> › Registre des expositions</p>

  <article>
  <h1 class="a-name">Registre des expositions</h1>
  <p class="a-ref">${plural(SHOWS.length, 'entrée')}</p>

${body}
  </article>
  ${pageFoot(1)}`;
  return shell({ depth: 1, title: titleTxt, desc, url, ogTitle: 'Registre des expositions — Kramer', ogDesc: desc, ogImage: LOGO, ogAlt: 'Kramer', ld, topRight: 'Registre', main, script: '' });
}

/* ------------------------------------------------------------
   /artistes/ — the artist register: one alphabetical list, every name
   that has appeared, with the code(s) it appears under
------------------------------------------------------------ */
function artistesIndex(rows) {
  const url = `${SITE}/artistes/`;
  const titleTxt = 'Registre des artistes · Kramer, Paris';
  const desc = `Registre des artistes de Kramer, galerie d'art contemporain, Paris 10e — ${plural(rows.length, 'entrée')} : les artistes exposés et les programmes vidéo.`;
  const items = rows.map(r => {
    const rec = ARTIST_BY_NAME.get(r.name);
    return artistItem(r.name, rec ? `${rec.slug}/` : '', r.codes.join(' · '), rec ? artistHeroImg(rec) : '');
  }).join('\n');
  const linked = rows.filter(r => ARTIST_BY_NAME.has(r.name));
  const ld = {
    '@context': 'https://schema.org',
    '@graph': [
      { '@type': 'WebPage', '@id': url, url, name: titleTxt, description: desc, inLanguage: 'fr', isPartOf: IS_PART_OF, breadcrumb: { '@id': `${url}#breadcrumb` },
        mainEntity: { '@type': 'ItemList', itemListElement: linked.map((r, i) => ({ '@type': 'ListItem', position: i + 1, name: r.name, url: `${SITE}/artistes/${ARTIST_BY_NAME.get(r.name).slug}/` })) } },
      breadcrumbNode(url, [['Accueil', `${SITE}/`], ['Registre des artistes', url]]),
      GALLERY,
    ],
  };
  const main = `  <p class="crumb"><a href="../">Accueil</a> › Registre des artistes</p>

  <article>
  <h1 class="a-name">Registre des artistes</h1>
  <p class="a-ref">${plural(rows.length, 'entrée')}</p>

  <ul class="artist-list">
${items}
  </ul>
  </article>
  ${pageFoot(1)}
  <div class="artist-hover-preview" id="ahp" aria-hidden="true"><img id="ahp-img" alt=""></div>`;
  return shell({ depth: 1, title: titleTxt, desc, url, ogTitle: 'Registre des artistes — Kramer', ogDesc: desc, ogImage: LOGO, ogAlt: 'Kramer', ld, topRight: 'Registre', main, script: ARTIST_HOVER_JS });
}

/* /artistes/ only: floats a work plate beside a name on hover/focus — a quick look before
   clicking through. Desktop-only (gated on hover+fine-pointer so touch gets no dead preview). */
const ARTIST_HOVER_JS = `(function(){
  if(!window.matchMedia('(hover:hover) and (pointer:fine)').matches) return;
  var box=document.getElementById('ahp'), img=document.getElementById('ahp-img');
  if(!box||!img) return;
  function place(x,y){
    var w=box.offsetWidth||220,h=box.offsetHeight||220;
    if(x+w>window.innerWidth-12) x=x-48-w;
    if(x<12) x=12;
    if(y<12) y=12;
    if(y+h>window.innerHeight-12) y=window.innerHeight-12-h;
    box.style.transform='translate('+x+'px,'+y+'px)';
  }
  document.querySelectorAll('.artist-item a[data-hover-img]').forEach(function(a){
    a.addEventListener('mouseenter',function(){ img.src=a.getAttribute('data-hover-img'); box.classList.add('on'); });
    a.addEventListener('mousemove',function(e){ place(e.clientX+24,e.clientY-40); });
    a.addEventListener('mouseleave',function(){ box.classList.remove('on'); });
    a.addEventListener('focus',function(){
      img.src=a.getAttribute('data-hover-img');
      var r=a.getBoundingClientRect();
      place(r.right+24,r.top);
      box.classList.add('on');
    });
    a.addEventListener('blur',function(){ box.classList.remove('on'); });
  });
})();
`;

/* ------------------------------------------------------------
   WRITE THE PAGES
------------------------------------------------------------ */
/* changedPaths tracks which generated files this run actually rewrote content for (not just
   touched) — the sitemap uses it below so lastmod reflects a real change, not just a rebuild. */
const changedPaths = new Set();
const put = (rel, txt) => {
  const f = join(WEB, rel);
  mkdirSync(dirname(f), { recursive: true });
  const prev = existsSync(f) ? readFileSync(f, 'utf8') : null;
  if (prev !== txt) changedPaths.add(rel);
  writeFileSync(f, txt);
};

for (let i = 0; i < ARTISTS.length; i++) put(`artistes/${ARTISTS[i].slug}/index.html`, page(ARTISTS[i], i));
const REG = registerRows();
put('artistes/index.html', artistesIndex(REG));
for (const s of SHOWS) put(`expositions/${s.slug}/index.html`, showPage(s));
put('expositions/index.html', expositionsIndex());

const urls = [`${SITE}/`, `${SITE}/expositions/`, ...showsDesc.map(showUrl), `${SITE}/artistes/`, ...ARTISTS.map(a => `${SITE}/artistes/${a.slug}/`)];

/* ------------------------------------------------------------
   THE HOME PAGE — regenerate the fenced regions, nothing else
------------------------------------------------------------ */
const region = (src, name, body, [open, close] = [`<!--BUILD:${name}-->`, `<!--/BUILD:${name}-->`]) => {
  const i = src.indexOf(open), j = src.indexOf(close);
  if (i < 0 || j < i) throw new Error(`index.html: no ${open} … ${close} region — add the markers`);
  return src.slice(0, i + open.length) + '\n' + body + '\n' + src.slice(j);
};
const swap = (src, re, txt, what) => { if (!re.test(src)) throw new Error(`index.html: ${what} not found`); return src.replace(re, () => txt); };

/* meta descriptions: gallery + the show the page is about */
const lead = { 'en cours': 'Exposition en cours', 'à venir': 'Prochaine exposition', 'terminée': 'Dernière exposition' }[statusOf(CURRENT)];
const homeDesc = `Kramer — galerie d'art contemporain, Paris 10e. Galerie d'appartement. ${lead} : « ${CURRENT.title} » (${CURRENT.code}), ${metaDates(CURRENT)}.`;
const homeOg = `${lead} « ${CURRENT.title} » · ${metaDates(CURRENT)} · galerie d'art contemporain, Paris 10e`;
home = swap(home, /<meta name="description" content="[^"]*">/, `<meta name="description" content="${esc(homeDesc)}">`, 'meta description');
home = swap(home, /<meta property="og:description" content="[^"]*">/, `<meta property="og:description" content="${esc(homeOg)}">`, 'og:description');
home = swap(home, /<meta name="twitter:description" content="[^"]*">/, `<meta name="twitter:description" content="${esc(homeOg)}">`, 'twitter:description');

/* JSON-LD: website + gallery + the current show and its events */
const homeLd = { '@context': 'https://schema.org', '@graph': [WEBSITE, HOME_GALLERY, exhibitionNode(CURRENT), ...eventNodes(CURRENT)] };
home = swap(home, /<script type="application\/ld\+json">[\s\S]*?<\/script>/, `<script type="application/ld+json">\n${JSON.stringify(homeLd, null, 2)}\n</script>`, 'JSON-LD block');

/* carousel: the current show's flagged installation views, plus any individual work
   plates named in workSlides (images/works/, with the same museum-tombstone caption
   the artist page uses, as alt text). No views and no workSlides → no carousel at all. */
const workSlides = (CURRENT.workSlides || []).map(ws => {
  const wa = ARTISTS.find(x => x.slug === ws.artist);
  if (!wa) throw new Error(`shows.mjs: workSlides references unknown artist slug "${ws.artist}"`);
  const w = wa.works.find(w => workImgs(w).some(im => im.f === ws.f));
  if (!w) throw new Error(`shows.mjs: workSlides — "${ws.f}" is not one of ${wa.name}'s work images`);
  const im = workImgs(w).find(im => im.f === ws.f);
  return {
    img: `images/works/${ws.f}`, alt: workCapText(wa, w, im.ph, isDet(ws.f)),
    href: `artistes/${wa.slug}/`, main: wa.name, sub: w.t,
  };
});
const slides = [
  ...(CURRENT.views || []).filter(v => v.car).map(v => ({
    img: `images/installation/${v.f}`, alt: v.alt, href: `expositions/${CURRENT.slug}/`, main: `« ${CURRENT.title} »`, sub: "vue d'installation",
  })),
  ...workSlides,
];
const sliderHtml = slides.length ? `    <div class="slider-wrap" id="section-artworks">
      <div class="slide-cursor" id="slide-cursor">→</div>
      <div class="slide-area">
        <a class="slide-plate" id="slide-link" href="#" aria-label="Voir l'exposition">
          <!-- Transparent 1×1 initial src: showSlide() sets the real image on init, so a
               real file here would be a download the visitor never sees. -->
          <img src="data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7" class="plate-img" id="slide-img" alt="">
          <span class="slide-counter" id="slide-counter"></span><!-- set by showSlide() -->
        </a>
      </div>
      <div class="slide-caption">
        <a class="slide-artist" id="slide-artist" href="#"></a>
        <span class="slide-detail" id="slide-detail"></span>
      </div>
    </div>` : '    <!-- no carousel: the current show has no installation view flagged car:1 in build/shows.mjs -->';
home = region(home, 'slider', sliderHtml);
home = region(home, 'slides', `const SLIDES=${JSON.stringify(slides).replace(/</g, '\\u003c')};`, ['/*BUILD:slides*/', '/*/BUILD:slides*/']);

/* Registre des artistes: the current show's artists only — no code in the heading, it means
   nothing to a visitor. Everyone else (every past show) lives at /artistes/, one click away. */
{
  const cur = CURRENT.artists.length ? `      <h2 class="s-head">Registre des artistes — ${plural(CURRENT.artists.length, 'entrée')}</h2>
      <ul class="artist-list">
${showRoster(CURRENT, 'artistes/')}
      </ul>` : '      <h2 class="s-head">Registre des artistes</h2>';
  home = region(home, 'artistes', `    <div class="section" id="section-artistes">
${cur}
      <p class="reg-more"><a href="artistes/">Registre complet — ${plural(REG.length, 'entrée')} →</a></p>
    </div>`);
}

/* Registre des expositions (replaces the old single-show «Exposition» section). showCode:false —
   the home page shows the status word, not the internal code. CURRENT is excluded here: the
   Actualité block above already names it, with its own link to the show's page, so it isn't
   repeated twice on the same page. (The standalone /expositions/ page still lists every show,
   current included — that register is the complete archive, not the home page's quick view.) */
{
  const pastShows = showsDesc.filter(s => s !== CURRENT);
  home = region(home, 'expositions', `    <div class="section" id="section-exposition">
      <h2 class="s-head">Registre des expositions — ${plural(pastShows.length, 'entrée')}</h2>
      <ul class="ev-list">
${pastShows.map(s => showItem(s, `expositions/${s.slug}/`, { showCode: false, status: false, checkbox: true, cur: false })).join('\n')}
      </ul>
    </div>`);
}

/* Registre des événements — home page: upcoming/current only, no internal code. Past events
   aren't lost, they stay on record on their own show's page (the real archive); llms.txt's
   separate pastEvents list further below still needs every event that has already happened. */
const upcomingEvents = showsAsc.flatMap(s => (s.events || [])).filter(ev => ev.day >= TODAY).sort((a, b) => a.day.localeCompare(b.day));
/* With nothing upcoming the section used to print «0 entrée · Aucune entrée pour l'instant»,
   an empty register with a menu row pointing at it. It is left out entirely instead (Matteo,
   2026-10-07) — and so is its row in the step menu, so the two can't fall out of step. Put an
   event with a future day in shows.mjs and both come back on the next build. */
home = region(home, 'events', !upcomingEvents.length ? '' : `    <div class="section" id="section-archive">
      <h2 class="s-head">Registre des événements — ${plural(upcomingEvents.length, 'entrée')}</h2>
      <ul class="ev-list">
${'\n' + upcomingEvents.map(ev => eventItem(ev, { showCode: false })).join('\n\n') + '\n'}
      </ul>
    </div>`);
home = region(home, 'navevents', !upcomingEvents.length ? '' : `            <li class="cb-item"><a class="cb-link" onclick="goTo('section-archive');return false" href="#">
              <div class="cb-box" id="cb-archive"></div>
              <span class="cb-txt">Le <strong>registre des événements</strong></span>
            </a></li>`);
/* llms.txt (below) still audits against every PAST event, so it stays accurate once an event has happened */
const pastEvents = showsAsc.flatMap(s => (s.events || [])).filter(ev => ev.day < TODAY).sort((a, b) => b.day.localeCompare(a.day));

if (home !== homeOriginal) changedPaths.add('index.html');
writeFileSync(join(WEB, 'index.html'), home);

/* sitemap: lastmod is per-URL — TODAY only for a page this run actually changed the content
   of; otherwise whatever date is already on record, read back from the sitemap before this
   run overwrites it. A page that hasn't changed since June stops claiming a same-day edit on
   every build, which is the point: a sitemap that always says "everything changed today" gets
   discounted by crawlers. */
const relOf = u => u === `${SITE}/` ? 'index.html'
  : u === `${SITE}/expositions/` ? 'expositions/index.html'
  : u === `${SITE}/artistes/` ? 'artistes/index.html'
  : u.includes('/expositions/') ? `expositions/${u.split('/').filter(Boolean).pop()}/index.html`
  : `artistes/${u.split('/').filter(Boolean).pop()}/index.html`;
const oldSitemapPath = join(WEB, 'sitemap.xml');
const oldLastmod = new Map();
if (existsSync(oldSitemapPath)) {
  for (const m of readFileSync(oldSitemapPath, 'utf8').matchAll(/<loc>([^<]+)<\/loc><lastmod>([^<]+)<\/lastmod>/g)) oldLastmod.set(m[1], m[2]);
}
const lastmodOf = u => changedPaths.has(relOf(u)) || !oldLastmod.has(u) ? TODAY : oldLastmod.get(u);
put('sitemap.xml', `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.map(u => `  <url><loc>${u}</loc><lastmod>${lastmodOf(u)}</lastmod></url>`).join('\n')}
</urlset>
`);

/* ------------------------------------------------------------
   GUARDS — the ways this site has gone stale before
------------------------------------------------------------ */
/* Actualité is written by hand; make sure it still says what is true. It no longer prints a
   bare registry code (meaningless to a visitor), so staleness is detected off the title text
   ("« Show Title »") instead. */
{
  const news = (home.match(/<div class="section" id="section-news"[\s\S]*?\n    <\/div>\n/) || [''])[0];
  /* the title may be set in guillemets or bare — don't make the guard depend on punctuation */
  const announced = SHOWS.filter(s => news.includes(s.title)).map(s => s.code);
  for (const c of announced) if (SHOW_BY[c] && statusOf(SHOW_BY[c]) === 'terminée') warn(`Actualité still announces ${c}, which ended ${SHOW_BY[c].to} — put the holding line back, or announce the next show`);
  if (statusOf(CURRENT) !== 'terminée' && !announced.includes(CURRENT.code)) warn(`Actualité does not announce ${CURRENT.code} (${statusOf(CURRENT)}) — announce it, or leave the holding line on purpose`);
  /* …and that the status tag above the title still matches the date-derived status: the tag
     is hand-written, so it went on reading «Exposition en cours» for a show that had not
     opened yet */
  const st = statusOf(CURRENT);
  if (announced.includes(CURRENT.code)) {
    if (/Exposition en cours/.test(news) && st !== 'en cours') warn(`Actualité's tag says «Exposition en cours» but ${CURRENT.code} is ${st} — fix the tag`);
    if (/Prochaine exposition/.test(news) && st !== 'à venir') warn(`Actualité's tag says «Prochaine exposition» but ${CURRENT.code} is ${st} — fix the tag`);
  }
  /* the show's own dates belong in the announcement — they are nowhere else on the home page
     (the register below lists only shows that have finished) */
  if (announced.includes(CURRENT.code) && !news.includes(CURRENT.dates)) warn(`Actualité does not give ${CURRENT.code}'s dates («${CURRENT.dates}») — the home page then states them nowhere`);
}
/* llms.txt is hand-written and has gone stale twice: every show must be in it, with its page */
if (existsSync(join(WEB, 'llms.txt'))) {
  const llms = readFileSync(join(WEB, 'llms.txt'), 'utf8');
  for (const s of SHOWS) if (!llms.includes(s.code) || !llms.includes(showUrl(s))) warn(`llms.txt does not list ${s.code} « ${s.title} » with ${showUrl(s)}`);
  /* …and each past event, as a line naming its kind and «(CODE)» */
  const lines = llms.split('\n');
  for (const ev of pastEvents) if (!lines.some(l => l.includes(ev.kind) && l.includes(`(${ev.code})`))) warn(`llms.txt does not list the past event «${ev.kind} (${ev.code})» — add it under « Registre des événements (passés) »`);
}

console.log(`Generated ${ARTISTS.length} artist pages + ${SHOWS.length} show pages + 2 registers + sitemap (${urls.length} urls). Current show: ${CURRENT.code} (${statusOf(CURRENT)})${PREVIOUS ? `, previous: ${PREVIOUS.code}` : ''}; ${REG.length} register entries, ${pastEvents.length} past events. Today: ${TODAY}.`);

/* drift check: warn if the ARTISTS array and the fiches disagree (no-op when the vault is absent) */
try { await import('./check-fiches.mjs'); } catch (e) { console.warn('check-fiches skipped:', e.message); }
