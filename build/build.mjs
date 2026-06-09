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

const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function page(a, i) {
  const entry = String(i + 1).padStart(3, '0');
  const ref = 'KR/01·' + a.code;
  const url = `${SITE}/artistes/${a.slug}/`;

  const fields = [
    a.born ? `<div class="a-field"><span class="a-lbl">Né(e)</span><span class="a-val">${esc(a.born)}</span></div>` : '',
    a.based ? `<div class="a-field"><span class="a-lbl">Résidence</span><span class="a-val">${esc(a.based)}</span></div>` : '',
    `<div class="a-field"><span class="a-lbl">Au registre</span><span class="a-val">La Bride · KR/01</span></div>`,
  ].join('\n      ');

  const works = a.works.length ? `
    <p class="s-head">Œuvres — ${a.works.length} entrée${a.works.length > 1 ? 's' : ''} · ${a.code}</p>
    <div class="works-grid">
      ${a.works.map(w => `<div class="work-item">
        <div class="work-plate"><img src="../../images/placeholder.png" alt="${esc(w.t)}"><span class="work-plate-tag">${esc(ref)}</span></div>
        <p class="work-cap"><em>${esc(w.t)}</em>, ${esc(w.d)} &middot; ${esc(w.s)}</p>
        <a class="work-inquire" href="#" data-t="${esc(w.t)}" data-d="${esc(w.d)}" data-s="${esc(w.s)}">Demander la fiche →</a>
      </div>`).join('\n      ')}
    </div>` : '';

  const cvBlock = (label, rows) => rows.length ? `
    <p class="cv-section">${label}</p>
    ${rows.map(r => `<div class="cv-row"><span class="cv-yr">${esc(r[0])}</span><span>${esc(r[1])}</span></div>`).join('\n    ')}` : '';
  const cv = (a.solo.length || a.group.length) ? `
    <div class="cv">${cvBlock('Expositions personnelles (sélection)', a.solo)}${cvBlock('Expositions collectives (sélection)', a.group)}
    </div>` : '';

  return `<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${esc(a.name)} — Kramer</title>
<meta name="description" content="${esc(a.name)} — Registre des artistes, exposition La Bride. Kramer, galerie d'art contemporain, Paris.">
<link rel="canonical" href="${url}">
<link rel="icon" href="../../images/edelweiss.svg">
<meta property="og:type" content="profile">
<meta property="og:title" content="${esc(a.name)} — Kramer">
<meta property="og:description" content="Registre des artistes · La Bride">
<meta property="og:url" content="${url}">
<meta property="og:image" content="${SITE}/images/kramer_wordmark.png">
<script type="application/ld+json">
{"@context":"https://schema.org","@type":"Person","name":${JSON.stringify(a.name)},"url":"${url}","memberOf":{"@type":"ArtGallery","name":"Kramer","url":"${SITE}/"}}
</script>
<link rel="stylesheet" href="https://use.typekit.net/svm4vfk.css">
<link rel="stylesheet" href="../../kramer.css">
</head>
<body>
<div class="chrome ct"><div class="c9">Répertoire : K › Kr</div><div class="c9i">Entrée ${entry} · ${esc(a.code)}</div></div>

<div class="wrap">
  <a class="back" href="../../"><span class="wordmark">Kramer</span></a>
  <p class="crumb"><a href="../../#section-artistes">Registre des artistes</a> › ${esc(a.name)}</p>

  <h1 class="a-name">${esc(a.name)}</h1>
  <p class="a-ref">Entrée ${entry} · La Bride · ${esc(ref)}</p>
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
</script>
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
