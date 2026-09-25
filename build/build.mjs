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
   PREVIOUS is the most recent finished show besides it («Précédemment» on the home page) */
const CURRENT = showsAsc.find(s => statusOf(s) === 'en cours') || showsAsc.find(s => statusOf(s) === 'à venir') || showsAsc[showsAsc.length - 1];
const PREVIOUS = showsDesc.find(s => s !== CURRENT && statusOf(s) === 'terminée');

const ARTIST_BY_NAME = new Map(ARTISTS.map(a => [a.name, a]));
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
  openingHoursSpecification: [{ '@type': 'OpeningHoursSpecification', dayOfWeek: 'Saturday', opens: '12:00', closes: '18:00' }],
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

/* the home page's footer line, on every other page too: the events register + legal */
const pageFoot = depth => {
  const up = '../'.repeat(depth);
  return `<p class="page-foot"><a href="${up}#section-archive">Registre des événements</a> · <a href="${up}#mentions-legales">Mentions légales</a></p>`;
};

/* email assembled at runtime so it stays out of the static source */
const MAIL_JS = `(function(){
  var a='contact'+'@'+'kramer'+String.fromCharCode(46)+'paris';
  document.querySelectorAll('.js-mail').forEach(function(el){el.innerHTML='<a href="mailto:'+a+'">'+a+'</a>';});
})();
`;

/* one line: how to ask about a work. The form link is the no-JS fallback. */
const inquiryNote = depth => `<p class="reg-note">Pour une demande concernant une œuvre : <span class="js-mail"></span> · <a href="${'../'.repeat(depth)}#form-rsvp">formulaire de contact</a></p>`;

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
const artistItem = (name, href, code) => {
  const label = esc(name) + (code ? ` <em>${esc(code)}</em>` : '');
  return href
    ? `        <li class="artist-item">
          <a class="artist-link" href="${href}">
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

/* one event, as a register entry (home page register + each show page) */
const eventItem = ev => {
  const L = [];
  L.push('        <li class="ev-item">');
  L.push(`          <p class="exh-ref">${esc(ev.kind)} · ${esc(ev.code)}</p>`);
  L.push(`          <p class="ac-big">${ev.title}</p>`);
  (ev.meta || []).forEach(m => L.push(`          <p class="ev-meta">${m}</p>`));
  L.push('          <p class="ev-meta" style="margin-top:8px">132 Bd de Magenta · 75010 Paris</p>');
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
   (/expositions/) the reference line carries only the code — the heading already says it. */
const showItem = (s, href, { artists = false, status = true } = {}) => `        <li class="ev-item">
          <p class="exh-ref">${s.code}${status ? ' · ' + statusOf(s) : ''}</p>
          <p class="ac-big"><a href="${href}">${esc(s.title)}</a> — ${esc(s.dates)}</p>${s.cur ? `
          <p class="ev-meta">Commissariat · ${esc(s.cur)}</p>` : ''}${artists && s.artists.length ? `
          <p class="ev-note">Avec ${esc(s.artists.join(', '))}.</p>` : ''}
        </li>`;

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
  ({ '@type': 'VisualArtwork', '@id': `${SITE}/artistes/${a.slug}/#oeuvre-${slugify(w.t)}`, name: w.t, url: `${SITE}/artistes/${a.slug}/` })));

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
  const titleTxt = `${a.name}${titleMedium} · ${latest.title} · Kramer, Paris`;
  const descTxt = `${a.name}${descMedium}${descBased} — exposition « ${latest.title} » (${latest.code}), registre des artistes. Kramer, galerie d'art contemporain, Paris 10e.`;
  const variants = nameVariants(a);
  const heroImg = ARTIST_IMG[a.slug] ? `${SITE}/${ARTIST_IMG[a.slug]}`
    : (a.works[0] && a.works[0].i ? `${SITE}/images/works/${a.works[0].i}` : '');
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
  /* Each plate carries its own photo credit. `i` + string `views` inherit the work's `ph`;
     an object view {f, ph} overrides it (e.g. Matteo's install shots hung under an artist-
     credited reproduction). Returns [{f, ph}] in display order. */
  const workImgs = w => [
    ...(w.i ? [{ f: w.i, ph: w.ph || '' }] : []),
    ...(w.views || []).map(v => typeof v === 'string' ? { f: v, ph: w.ph || '' } : { f: v.f, ph: v.ph || w.ph || '' }),
  ];
  /* filename convention shared with the caption logic further down (isInst there) —
     duplicated here because toImg needs it before that block is defined */
  const isInstFile = f => /inst-\d/i.test(f);
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
    '@type': 'ImageObject', contentUrl: `${SITE}/images/works/${im.f}`,
    ...(im.ph ? { creditText: im.ph, creator: imgCreator(im.ph) } : {}),
    copyrightNotice: isInstFile(im.f) ? '© KRAMER' : `© ${a.name}`,
    license: LICENSE_URL, acquireLicensePage: ACQUIRE_LICENSE_URL,
  });
  const artworks = a.works.map(w => {
    const imgs = workImgs(w);
    /* "130 × 97 cm" | "30 × 40 × 5 cm" → height × width (× depth), gallery convention;
       non-numeric sizes ("dimensions variables") are skipped */
    const dims = (w.s || '').match(/^([\d.]+)\s*×\s*([\d.]+)(?:\s*×\s*([\d.]+))?\s*cm$/);
    return {
      '@type': 'VisualArtwork', '@id': `${url}#oeuvre-${slugify(w.t)}`,
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
    `<div class="a-field"><span class="a-lbl">Au registre</span><span class="a-val">${aShows.map(s => esc(`${s.title} · ${s.code}`)).join(' / ')}</span></div>`,
  ].join('\n      ');

  /* first plate is the likely LCP → eager; everything after lazy-loads */
  let plateN = 0;
  const plateAttrs = () => plateN++ === 0 ? ' fetchpriority="high"' : ' loading="lazy" decoding="async"';
  /* Every plate carries its own full caption underneath. An installation shot
     (filename …inst-N…) gets the exhibition caption; a work shot (obj/det/repro)
     gets the museum tombstone. Each caption names its own photographer, so a work
     photographed by several people reads correctly plate by plate. */
  const isInst = f => /inst-\d/i.test(f);
  const isDet = f => /det-\d/i.test(f);
  const courtesy = w => w.c === undefined ? "Courtoisie de l'artiste" : w.c;
  /* Credit: the gallery's own shots (Matteo Kramer) are credited simply "Kramer";
     any other photographer keeps the "Photo : Name" form. */
  const credit = ph => !ph ? '' : (/^(matteo\s+)?kramer$/i.test(ph) ? 'Kramer' : 'Photo : ' + esc(ph));
  /* det = true for detail shots (filename …det-N…) → title gets a "(détail)" marker */
  const workCap = (w, ph, det) => [
    `${esc(a.name)}, <em>${esc(w.t)}</em>${det ? ' (détail)' : ''}${w.d ? ', ' + esc(String(w.d)) : ''}.`,
    [w.m, w.s].filter(Boolean).map(esc).join(', ') ? [w.m, w.s].filter(Boolean).map(esc).join(', ') + '.' : '',
    courtesy(w) ? esc(courtesy(w)) + '.' : '',
    credit(ph) ? credit(ph) + '.' : '',
  ].filter(Boolean).join(' ');
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
        if (!imgs.length) return `<div class="work-item">
        <div class="work-plate"><img src="../../images/placeholder.png" alt="${baseAlt}"${plateAttrs()}></div>
        <p class="work-cap">${workCap(w, '', false)}</p>
        ${inquire(w)}
      </div>`;
        const plates = imgs.map(im => {
          const inst = isInst(im.f);
          const alt = inst ? esc(`Vue d'installation de «${show.title}», KRAMER — ${a.name}`) : baseAlt;
          const cap = inst ? instCap(im.ph, show) : workCap(w, im.ph, isDet(im.f));
          return `<div class="work-plate"><img src="../../images/works/${im.f}" alt="${alt}"${plateAttrs()}></div>
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
  const rec = n => ARTIST_BY_NAME.get(n);
  const events = [...(s.events || [])].sort((a, b) => b.day.localeCompare(a.day));
  const views = s.views || [];
  const hasWorks = s.artists.some(n => rec(n));
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
  if (hasWorks) blocks.push(`    ${inquiryNote(2)}`);

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
` : '') + (hasWorks ? MAIL_JS : '');

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
    return artistItem(r.name, rec ? `${rec.slug}/` : '', r.codes.join(' · '));
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

  ${inquiryNote(1)}
  </article>
  ${pageFoot(1)}`;
  return shell({ depth: 1, title: titleTxt, desc, url, ogTitle: 'Registre des artistes — Kramer', ogDesc: desc, ogImage: LOGO, ogAlt: 'Kramer', ld, topRight: 'Registre', main, script: MAIL_JS });
}

/* ------------------------------------------------------------
   WRITE THE PAGES
------------------------------------------------------------ */
const put = (rel, txt) => { const f = join(WEB, rel); mkdirSync(dirname(f), { recursive: true }); writeFileSync(f, txt); };

for (let i = 0; i < ARTISTS.length; i++) put(`artistes/${ARTISTS[i].slug}/index.html`, page(ARTISTS[i], i));
const REG = registerRows();
put('artistes/index.html', artistesIndex(REG));
for (const s of SHOWS) put(`expositions/${s.slug}/index.html`, showPage(s));
put('expositions/index.html', expositionsIndex());

/* sitemap: home, the two registers, every show and artist page; lastmod = build date */
const urls = [`${SITE}/`, `${SITE}/expositions/`, ...showsDesc.map(showUrl), `${SITE}/artistes/`, ...ARTISTS.map(a => `${SITE}/artistes/${a.slug}/`)];
put('sitemap.xml', `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.map(u => `  <url><loc>${u}</loc><lastmod>${TODAY}</lastmod></url>`).join('\n')}
</urlset>
`);

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

/* carousel: the current show's flagged installation views. None → no carousel at all. */
const slides = (CURRENT.views || []).filter(v => v.car).map(v => ({
  img: `images/installation/${v.f}`, alt: v.alt, href: `expositions/${CURRENT.slug}/`, main: `« ${CURRENT.title} »`, sub: "vue d'installation",
}));
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

/* Registre des artistes: the current show's artists, then the previous show's, then the full register */
{
  const cur = CURRENT.artists.length ? `      <h2 class="s-head">Registre des artistes — ${plural(CURRENT.artists.length, 'entrée')} · ${CURRENT.code}</h2>
      <ul class="artist-list">
${showRoster(CURRENT, 'artistes/')}
      </ul>` : '';
  const prev = PREVIOUS && PREVIOUS.artists.length ? `      <h${cur ? 3 : 2} class="s-head${cur ? ' sub' : ''}">${cur ? 'Précédemment' : 'Registre des artistes'} · ${PREVIOUS.code} — ${plural(PREVIOUS.artists.length, 'entrée')}</h${cur ? 3 : 2}>
      <ul class="artist-list">
${showRoster(PREVIOUS, 'artistes/')}
      </ul>` : '';
  home = region(home, 'artistes', `    <div class="section" id="section-artistes">
${[cur, prev].filter(Boolean).join('\n')}
      <p class="reg-more"><a href="artistes/">Registre complet — ${plural(REG.length, 'entrée')} →</a></p>
    </div>`);
}

/* Registre des expositions (replaces the old single-show «Exposition» section) */
home = region(home, 'expositions', `    <div class="section" id="section-exposition">
      <h2 class="s-head">Registre des expositions — ${plural(SHOWS.length, 'entrée')}</h2>
      <ul class="ev-list">
${showsDesc.map(s => showItem(s, `expositions/${s.slug}/`)).join('\n')}
      </ul>
    </div>`);

/* Registre des événements: records only — an event enters once its day has passed */
const pastEvents = showsAsc.flatMap(s => (s.events || [])).filter(ev => ev.day < TODAY).sort((a, b) => b.day.localeCompare(a.day));
home = region(home, 'events', `    <div class="section" id="section-archive">
      <h2 class="s-head">Registre des événements — ${plural(pastEvents.length, 'entrée')}</h2>
      <ul class="ev-list">
${pastEvents.length ? '\n' + pastEvents.map(eventItem).join('\n\n') + '\n' : '        <li class="ev-item"><p class="ev-note" style="margin-top:0">Aucune entrée pour l\'instant.</p></li>'}
      </ul>
    </div>`);

writeFileSync(join(WEB, 'index.html'), home);

/* ------------------------------------------------------------
   GUARDS — the ways this site has gone stale before
------------------------------------------------------------ */
/* Actualité is written by hand; make sure it still says what is true */
{
  const news = (home.match(/<div class="section" id="section-news"[\s\S]*?\n    <\/div>\n/) || [''])[0];
  const announced = [...news.matchAll(/class="exh-ref">(KR\d+)</g)].map(m => m[1]);
  for (const c of announced) if (SHOW_BY[c] && statusOf(SHOW_BY[c]) === 'terminée') warn(`Actualité still announces ${c}, which ended ${SHOW_BY[c].to} — put the holding line back, or announce the next show`);
  if (statusOf(CURRENT) !== 'terminée' && !announced.includes(CURRENT.code)) warn(`Actualité does not announce ${CURRENT.code} (${statusOf(CURRENT)}) — announce it, or leave the holding line on purpose`);
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
