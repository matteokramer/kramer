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

const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

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

  /* JSON-LD graph: enriched Person + a VisualArtwork per consigned work */
  const personId = `${url}#person`;
  const person = {
    '@type': 'Person', '@id': personId, name: a.name, url, jobTitle: 'Artiste',
    ...(mediumList.length ? { knowsAbout: mediumList } : {}),
    ...(birthDate ? { birthDate } : {}),
    ...(birthPlace ? { birthPlace: { '@type': 'Place', name: birthPlace } } : {}),
    memberOf: { '@type': 'ArtGallery', name: 'Kramer', url: `${SITE}/` },
    ...(a.links && a.links.length ? { sameAs: a.links } : {}),
  };
  const artworks = a.works.map(w => ({
    '@type': 'VisualArtwork', name: w.t, creator: { '@id': personId }, url,
    ...(w.d ? { dateCreated: String(w.d) } : {}),
    ...(primaryMedium ? { artform: primaryMedium } : {}),
    ...(w.m ? { artMedium: w.m } : {}),
  }));
  const jsonld = JSON.stringify({ '@context': 'https://schema.org', '@graph': [person, ...artworks] });

  const bornLbl = a.g === 'f' ? 'Née' : a.g === 'm' ? 'Né' : 'Né(e)';
  const fields = [
    a.born ? `<div class="a-field"><span class="a-lbl">${bornLbl}</span><span class="a-val">${esc(a.born)}</span></div>` : '',
    a.based ? `<div class="a-field"><span class="a-lbl">Résidence</span><span class="a-val">${esc(a.based)}</span></div>` : '',
    `<div class="a-field"><span class="a-lbl">Au registre</span><span class="a-val">La Bride · KR/01</span></div>`,
  ].join('\n      ');

  const works = a.works.length ? `
    <p class="s-head">Œuvres — ${a.works.length} entrée${a.works.length > 1 ? 's' : ''}</p>
    <div class="works-grid">
      ${a.works.map(w => `<div class="work-item">
        <div class="work-plate"><img src="../../images/placeholder.png" alt="${esc(w.t + (w.m ? ', ' + w.m : '') + (w.s ? ' · ' + w.s : ''))}"></div>
        <p class="work-cap"><em>${esc(w.t)}</em>, ${esc(w.d)} &middot; ${esc(w.s)}</p>
        <a class="work-inquire" href="#" data-t="${esc(w.t)}" data-d="${esc(w.d)}" data-s="${esc(w.s)}">Demander la fiche →</a>
      </div>`).join('\n      ')}
    </div>` : '';

  const cvBlock = (label, rows) => rows.length ? `
    <p class="cv-section">${label}</p>
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
<title>${esc(a.name + titleMedium)} · La Bride · Kramer, Paris</title>
<meta name="description" content="${esc(a.name + descMedium + descBased)} — exposition « La Bride » (KR/01), registre des artistes. Kramer, galerie d'art contemporain, Paris 10e.">
<link rel="canonical" href="${url}">
<link rel="icon" href="../../images/edelweiss.svg">
<meta property="og:type" content="profile">
<meta property="og:title" content="${esc(a.name)} — Kramer">
<meta property="og:description" content="${esc(ogDesc)}">
<meta property="og:url" content="${url}">
<meta property="og:image" content="${SITE}/images/kramer_wordmark.png">
<script type="application/ld+json">
${jsonld}
</script>
<link rel="stylesheet" href="https://use.typekit.net/svm4vfk.css">
<link rel="stylesheet" href="../../kramer.css">
</head>
<body>
<div class="chrome ct"><div class="c9">Répertoire : K › Kr</div><div class="c9i">Entrée ${entry}</div></div>

<div class="wrap">
  <a class="home-btn" href="../../"><span class="hb-arrow" aria-hidden="true">←</span> Retour</a>
  <p class="crumb"><a href="../../#section-artistes">Registre des artistes</a> › ${esc(a.name)}</p>

  <h1 class="a-name">${esc(a.name)}</h1>
  <p class="a-ref">Entrée ${entry} · La Bride</p>
  <div class="a-fields">
      ${fields}
  </div>

  <div class="a-bio"><!-- bio à venir --></div>
${works}${cv}
</div>

<div class="chrome cb"><div class="c9">Kramer · 132 Bd de Magenta, 75010 Paris</div><div><a class="cnav c9" href="../../">Accueil</a></div></div>

<script>
/* email assembled at runtime so it stays out of the static source */
(function(){
  var addr='contact'+'@'+'kramer'+String.fromCharCode(46)+'paris', ref=${JSON.stringify(ref)};
  document.querySelectorAll('.work-inquire').forEach(function(el){
    var t=el.getAttribute('data-t'), d=el.getAttribute('data-d'), s=el.getAttribute('data-s');
    var subj=encodeURIComponent('Demande — '+ref+' · '+t);
    var body=encodeURIComponent('Bonjour,\\n\\nJe souhaite recevoir la fiche de l’œuvre suivante :\\n— '+t+' ('+d+'), '+s+'\\nRéf. '+ref+'\\n\\n');
    el.setAttribute('href','mailto:'+addr+'?subject='+subj+'&body='+body);
  });
})();

/* Registry reticle cursor — replaces the OS pointer on mouse devices.
   Text fields keep the I-beam; touch / coarse pointers are left alone. */
(function(){
  if(!(window.matchMedia&&window.matchMedia('(hover:hover) and (pointer:fine)').matches))return;
  var r=document.createElement('div');
  r.className='reticle';r.setAttribute('aria-hidden','true');
  document.body.appendChild(r);
  function suppress(t){
    if(!t||!t.closest)return false;
    if(t.closest('.slider-wrap'))return true;
    var f=t.closest('input,textarea');
    if(!f)return false;
    if(f.tagName==='TEXTAREA')return true;
    var ty=(f.getAttribute('type')||'text').toLowerCase();
    return ty!=='checkbox'&&ty!=='radio';
  }
  document.addEventListener('mousemove',function(e){
    if(suppress(e.target)){r.style.opacity='0';return;}
    r.style.left=e.clientX+'px';r.style.top=e.clientY+'px';r.style.opacity='1';
  },{passive:true});
  document.documentElement.addEventListener('mouseleave',function(){r.style.opacity='0';});
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

/* sitemap: home + one entry per artist page */
const urls = [`${SITE}/`, ...ARTISTS.map(a => `${SITE}/artistes/${a.slug}/`)];
const sitemap = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.map(u => `  <url><loc>${u}</loc><lastmod>2026-06-09</lastmod></url>`).join('\n')}
</urlset>
`;
writeFileSync(join(WEB, 'sitemap.xml'), sitemap);

console.log(`Generated ${count} artist pages + sitemap (${urls.length} urls).`);

/* drift check: warn if the ARTISTS array and the fiches disagree (no-op when the vault is absent) */
try { await import('./check-fiches.mjs'); } catch (e) { console.warn('check-fiches skipped:', e.message); }
