/* ============================================================
   KRAMER — static record-page generator
   Reads the ARTISTS array straight from index.html (single source
   of truth) and writes a dedicated page per artist at
   /artistes/<slug>/index.html, plus a refreshed sitemap.xml.
   Run from WEB/:  node build/build.mjs
============================================================ */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const WEB = join(dirname(fileURLToPath(import.meta.url)), '..');
const SITE = 'https://kramer.paris';

const html = readFileSync(join(WEB, 'index.html'), 'utf8');
const ARTISTS = eval(html.match(/const ARTISTS=(\[[\s\S]*?\]);/)[1]);
/* Cloudflare Web Analytics token — single-sourced from index.html (const CF_TOKEN='…') */
const CF_TOKEN = (html.match(/const CF_TOKEN='([^']*)'/) || [])[1] || '';
/* Carousel hero map — single-sourced from index.html (const ARTIST_IMG={…}); used as Person image */
const ARTIST_IMG = eval('(' + ((html.match(/const ARTIST_IMG=(\{[\s\S]*?\});/) || [])[1] || '{}') + ')');

const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/* Mechanical name variants for entity disambiguation (people search with and
   without diacritics). Derived only: diacritics stripped + German/Nordic
   transliteration, applied to the display name AND any hand-supplied a.alt
   spellings (real variants only — e.g. a legal name). Never invented. */
const stripDiacritics = s => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
const translit = s => s.replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/Ä/g, 'Ae').replace(/Ö/g, 'Oe').replace(/Ü/g, 'Ue').replace(/ß/g, 'ss')
  .replace(/ø/g, 'o').replace(/Ø/g, 'O').replace(/æ/g, 'ae').replace(/Æ/g, 'Ae');
const nameVariants = a => {
  const bases = [a.name, ...(a.alt || [])];
  return [...new Set(bases.flatMap(n => [n, stripDiacritics(n), translit(n)]))].filter(v => v && v !== a.name);
};

/* One gallery entity, embedded in every record page's graph so Person.affiliation
   resolves without a cross-page fetch. Mirrors the home-page ArtGallery node. */
const GALLERY_ID = `${SITE}/#gallery`;
const GALLERY = {
  '@type': 'ArtGallery', '@id': GALLERY_ID, name: 'Kramer', url: `${SITE}/`,
  image: `${SITE}/images/kramer_wordmark.png`,
  address: { '@type': 'PostalAddress', streetAddress: '132 Bd de Magenta', postalCode: '75010', addressLocality: 'Paris', addressCountry: 'FR' },
  sameAs: ['https://www.instagram.com/galeriekramer/'],
};

function page(a, i) {
  const entry = String(i + 1).padStart(3, '0');
  const ref = 'KR/01·' + a.code;
  const url = `${SITE}/artistes/${a.slug}/`;

  /* --- SEO-derived values (only from on-file data) --- */
  const mediumList = a.medium ? a.medium.split(',').map(s => s.trim()).filter(Boolean) : [];
  const primaryMedium = mediumList[0] || '';
  const titleMedium = primaryMedium ? ` — ${primaryMedium}` : '';
  const descMedium = a.medium ? `, ${a.medium.toLowerCase()}` : '';
  const descBased = a.based ? ` (${a.based})` : '';
  const ogDesc = (a.medium ? a.medium + ' · ' : '') + 'La Bride · Kramer, Paris';
  /* birth year + place parsed from a.born ("1998, Tel Aviv" | "1999" | "Montana, USA" | "2002") */
  const yearMatch = (a.born || '').match(/\b(?:18|19|20)\d{2}\b/);
  const birthDate = yearMatch ? yearMatch[0] : '';
  const birthPlace = (a.born || '').replace(/\b(?:18|19|20)\d{2}\b/, '').replace(/^[\s,]+|[\s,]+$/g, '').trim();

  /* JSON-LD graph: WebPage (mainEntity → Person) + enriched Person + the gallery
     + a VisualArtwork per consigned work */
  const personId = `${url}#person`;
  const titleTxt = `${a.name}${titleMedium} · La Bride · Kramer, Paris`;
  const descTxt = `${a.name}${descMedium}${descBased} — exposition « La Bride » (KR/01), registre des artistes. Kramer, galerie d'art contemporain, Paris 10e.`;
  const variants = nameVariants(a);
  const heroImg = ARTIST_IMG[a.slug] ? `${SITE}/${ARTIST_IMG[a.slug]}`
    : (a.works[0] && a.works[0].i ? `${SITE}/images/works/${a.works[0].i}` : '');
  const webpage = {
    '@type': 'WebPage', '@id': url, url, name: titleTxt, description: descTxt,
    inLanguage: 'fr', mainEntity: { '@id': personId },
    isPartOf: { '@type': 'WebSite', name: 'Kramer', url: `${SITE}/` },
  };
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
  const artworks = a.works.map(w => {
    const imgs = workImgs(w);
    /* "130 × 97 cm" | "30 × 40 × 5 cm" → height × width (× depth), gallery convention;
       non-numeric sizes ("dimensions variables") are skipped */
    const dims = (w.s || '').match(/^([\d.]+)\s*×\s*([\d.]+)(?:\s*×\s*([\d.]+))?\s*cm$/);
    return {
      '@type': 'VisualArtwork', name: w.t, creator: { '@id': personId }, url,
      ...(w.d ? { dateCreated: String(w.d) } : {}),
      ...(primaryMedium ? { artform: primaryMedium } : {}),
      ...(w.m ? { artMedium: w.m } : {}),
      ...(dims ? {
        height: { '@type': 'Distance', name: `${dims[1]} cm` },
        width: { '@type': 'Distance', name: `${dims[2]} cm` },
        ...(dims[3] ? { depth: { '@type': 'Distance', name: `${dims[3]} cm` } } : {}),
      } : {}),
      ...(imgs.length ? { image: imgs.length === 1 ? `${SITE}/images/works/${imgs[0].f}` : imgs.map(im => `${SITE}/images/works/${im.f}`) } : {}),
    };
  });
  const jsonld = JSON.stringify({ '@context': 'https://schema.org', '@graph': [webpage, person, GALLERY, ...artworks] });

  const bornLbl = a.g === 'f' ? 'Née' : a.g === 'm' ? 'Né' : 'Né(e)';
  const fields = [
    a.born ? `<div class="a-field"><span class="a-lbl">${bornLbl}</span><span class="a-val">${esc(a.born)}</span></div>` : '',
    a.based ? `<div class="a-field"><span class="a-lbl">Résidence</span><span class="a-val">${esc(a.based)}</span></div>` : '',
    `<div class="a-field"><span class="a-lbl">Au registre</span><span class="a-val">La Bride · KR/01</span></div>`,
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
  const instCap = ph => `«La Bride», vue d'installation, KRAMER, Paris, 2026.${instCredit(ph) ? ' ' + instCredit(ph) + '.' : ''}`;
  const inquire = w => `<a class="work-inquire" href="#" data-t="${esc(w.t)}" data-d="${esc(w.d)}" data-s="${esc(w.s)}">Demander la fiche →</a>`;
  const works = a.works.length ? `
    <h2 class="s-head">Œuvres — ${a.works.length} entrée${a.works.length > 1 ? 's' : ''}</h2>
    <div class="works-grid">
      ${a.works.map(w => {
        const imgs = workImgs(w);
        const baseAlt = esc(w.t + (w.m ? ', ' + w.m : '') + (w.s ? ' · ' + w.s : ''));
        if (!imgs.length) return `<div class="work-item">
        <div class="work-plate"><img src="../../images/placeholder.png" alt="${baseAlt}"${plateAttrs()}></div>
        <p class="work-cap">${workCap(w, '', false)}</p>
        ${inquire(w)}
      </div>`;
        const plates = imgs.map(im => {
          const inst = isInst(im.f);
          const alt = inst ? esc(`Vue d'installation de «La Bride», KRAMER — ${a.name}`) : baseAlt;
          const cap = inst ? instCap(im.ph) : workCap(w, im.ph, isDet(im.f));
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

  /* bio: optional data field (Matteo-written, per-artist) — paragraphs split on blank lines.
     Absent field keeps the empty placeholder; never generated. */
  const bio = a.bio
    ? `<div class="a-bio">${a.bio.split(/\n\s*\n/).map(p => `<p>${esc(p.trim())}</p>`).join('')}</div>`
    : `<div class="a-bio"><!-- bio à venir --></div>`;

  const cvBlock = (label, rows) => rows.length ? `
    <h2 class="cv-section">${label}</h2>
    ${rows.map(r => `<div class="cv-row"><span class="cv-yr">${esc(r[0])}</span><span>${esc(r[1])}</span></div>`).join('\n    ')}` : '';
  /* extra: optional public-record sections from the fiche (education, awards, publications…)
     — each {l:'Label', rows:[[year,text],…]} renders like the solo/group blocks */
  const extras = (a.extra || []).map(s => cvBlock(s.l, s.rows)).join('');
  const cv = (a.solo.length || a.group.length || extras) ? `
    <div class="cv">${cvBlock('Solo exhibitions', a.solo)}${cvBlock('Group exhibitions', a.group)}${extras}
    </div>` : '';

  return `<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${esc(titleTxt)}</title>
<meta name="description" content="${esc(descTxt)}">
<link rel="canonical" href="${url}">
<link rel="icon" href="../../images/edelweiss.svg">
<meta property="og:type" content="profile">
<meta property="og:title" content="${esc(a.name)} — Kramer">
<meta property="og:description" content="${esc(ogDesc)}">
<meta property="og:url" content="${url}">
<meta property="og:image" content="${heroImg || `${SITE}/images/kramer_wordmark.png`}">
<meta property="og:image:alt" content="${esc(heroImg ? a.name + (a.works[0] ? ' — ' + a.works[0].t : '') : 'Kramer')}">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${esc(a.name)} — Kramer">
<meta name="twitter:description" content="${esc(ogDesc)}">
<meta name="twitter:image" content="${heroImg || `${SITE}/images/kramer_wordmark.png`}">
<script type="application/ld+json">
${jsonld}
</script>
<link rel="stylesheet" href="https://use.typekit.net/svm4vfk.css">
<link rel="stylesheet" href="../../kramer.css">
</head>
<body>
<div class="chrome ct"><a class="cnav c9" href="../../"><span class="hb-arrow" aria-hidden="true">←</span> Retour</a><div class="c9i">Entrée ${entry}</div></div>

<main class="wrap">
  <p class="crumb"><a href="../../#section-artistes">Registre des artistes</a> › ${esc(a.name)}</p>

  <article>
  <h1 class="a-name">${esc(a.name)}</h1>
  <p class="a-ref">Entrée ${entry} · La Bride</p>
  <div class="a-fields">
      ${fields}
  </div>

  ${bio}
${works}${cv}
  </article>
</main>

<div class="chrome cb"><div class="c9">© Kramer 2026</div><a href="../../#section-acces" class="cnav c9">Contact</a></div>

<script>
/* email assembled at runtime so it stays out of the static source */
(function(){
  var addr='contact'+'@'+'kramer'+String.fromCharCode(46)+'paris', ref=${JSON.stringify(ref)};
  document.querySelectorAll('.work-inquire').forEach(function(el){
    var t=el.getAttribute('data-t'), d=el.getAttribute('data-d'), s=el.getAttribute('data-s');
    var subj=encodeURIComponent('Demande — '+ref+' · '+t);
    var body=encodeURIComponent('Bonjour,\\n\\nJe souhaite recevoir la fiche de l\\'œuvre suivante :\\n— '+t+' ('+d+'), '+s+'\\nRéf. '+ref+'\\n\\n');
    el.setAttribute('href','mailto:'+addr+'?subject='+subj+'&body='+body);
  });
})();

</script>
${CF_TOKEN ? `<script defer src='https://static.cloudflareinsights.com/beacon.min.js' data-cf-beacon='${JSON.stringify({ token: CF_TOKEN })}'></script>` : ''}
</body>
</html>
`;
}

let count = 0;
for (let i = 0; i < ARTISTS.length; i++) {
  const a = ARTISTS[i];
  const dir = join(WEB, 'artistes', a.slug);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'index.html'), page(a, i));
  count++;
}

/* sitemap: home + one entry per artist page; lastmod = build date */
const today = new Date().toISOString().slice(0, 10);
const urls = [`${SITE}/`, ...ARTISTS.map(a => `${SITE}/artistes/${a.slug}/`)];
const sitemap = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.map(u => `  <url><loc>${u}</loc><lastmod>${today}</lastmod></url>`).join('\n')}
</urlset>
`;
writeFileSync(join(WEB, 'sitemap.xml'), sitemap);

console.log(`Generated ${count} artist pages + sitemap (${urls.length} urls).`);

/* drift check: warn if the ARTISTS array and the fiches disagree (no-op when the vault is absent) */
try { await import('./check-fiches.mjs'); } catch (e) { console.warn('check-fiches skipped:', e.message); }
