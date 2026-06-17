/* ============================================================
   KRAMER — fiche/site drift detector (warn-only)
   Cross-checks the ARTISTS array in index.html against the
   authoritative fiches in ../EXHIBITIONS/KR01_LA-BRIDE/ARTISTS/
   (vault root, OUTSIDE this public repo — the script degrades
   gracefully when the fiches are absent, e.g. in CI).

   Direction 1 (fiche → site): every public-record entry in a
   fiche should appear somewhere in that artist's array data.
   Direction 2 (site → fiche): every array entry should be
   traceable back to the fiche (catches invented or
   cross-attributed data).

   It WARNS, never edits — the fiches contain do-not-publish
   material, so syncing stays a human decision.
   Run:  node build/check-fiches.mjs   (also auto-runs after build.mjs)
============================================================ */
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const WEB = join(dirname(fileURLToPath(import.meta.url)), '..');
const FICHES = join(WEB, '..', 'EXHIBITIONS', 'KR01_LA-BRIDE', 'ARTISTS');

/* fiche sections that are public record (checked) vs never published (skipped) */
const INCLUDE = /exhibition|solo|group|education|formation|performance|grant|award|prize|publication|curat|studio|project|talk|archive|collection|recognition|acquisition|consigned|collaboration|residenc|interview/i;
const EXCLUDE = /statement|reference|internal|to confirm|gaps|notes de recherche|experience|identity|practice|other/i;

/* known-deliberate gaps — each entry silences one warning, keep the why next to it */
const ALLOW = [
  /la bride/i,                 // Nanna's CV lists our own show — self-referential, kept off her page
  /per research notes/i,       // Henri: Art Brussels / Dior Castle are provisional research notes
  /co-curateur|co-curator/i,   // Jürgen: translated summary line of the fiche's curation paragraph
  /geisterschrank (ii|iii|iv)/i, // Jürgen: I–IV are itemised in the fiche but shown as one combined entry on the site (deliberate)
];
/* bold "keys" in fiches that are labels, not entries */
const KEY_STOP = /^(conservation|price discrepancy|title note|dimension note|name spelling|status|note)/i;

const norm = s => String(s).toLowerCase()
  .replace(/[’‘`´]/g, "'").replace(/[“”«»]/g, '"').replace(/[–—−]/g, '-')
  .replace(/\*\*?/g, '').replace(/\s+/g, ' ')
  /* the array gallicises connectors; fold both languages to one form */
  .replace(/\b(mit|with)\b/g, 'avec').replace(/\b(und|and)\b/g, '&')
  .trim();

const html = readFileSync(join(WEB, 'index.html'), 'utf8');
const ARTISTS = eval(html.match(/const ARTISTS=(\[[\s\S]*?\]);/)[1]);

export function run() {
  if (!existsSync(FICHES)) { console.log('check-fiches: fiche folder not found — check skipped (fine in CI).'); return 0; }
  let warnings = 0, checked = 0;

  for (const a of ARTISTS) {
    const dir = join(FICHES, a.name);
    const fname = existsSync(dir) && readdirSync(dir).find(f => /FICHE\.md$/.test(f));
    if (!fname) { console.warn(`⚠ ${a.name}: no fiche found at ${dir}`); warnings++; continue; }
    const ficheRaw = readFileSync(join(dir, fname), 'utf8');

    /* cut off the folded research notes; they are internal */
    const fiche = ficheRaw.split(/^## Notes de recherche/m)[0];
    const ficheN = norm(fiche);

    /* flat list of every string in the artist's array entry */
    const siteStrings = [];
    (function walk(v) {
      if (typeof v === 'string') { if (v) siteStrings.push(norm(v)); }
      else if (Array.isArray(v)) v.forEach(walk);
      else if (v && typeof v === 'object') Object.values(v).forEach(walk);
    })(a);
    const siteN = siteStrings.join('  ');

    /* a key matches if it is contained in the haystack (or, fiche→site,
       a site string is contained in it); failing that, trim words off the
       end — entries often carry trailing detail the other side lacks */
    const matches = (key, hay, alsoReverse) => {
      if (key.length >= 4 && hay.includes(key)) return true;
      if (alsoReverse && siteStrings.some(s => s.length >= 8 && key.includes(s))) return true;
      const words = key.split(' ');
      while (words.length > 2) {
        words.pop();
        const k = words.join(' ');
        if (k.length >= 10 && hay.includes(k)) return true;
      }
      return false;
    };

    /* ---- direction 1: fiche → site ---- */
    for (const block of fiche.split(/^## /m).slice(1)) {
      const header = block.slice(0, block.indexOf('\n'));
      if (!INCLUDE.test(header) || EXCLUDE.test(header)) continue;
      for (const line of block.split('\n')) {
        if (!/^- /.test(line)) continue;                       // top-level bullets only
        if (ALLOW.some(rx => rx.test(line))) continue;
        const consigned = /consigned/i.test(header); // care/price notes live here — only bold work titles count
        for (const part of line.slice(2).split(' · ')) {
          /* keys: italic/bold spans; else the text after "YYYY — " up to the first comma */
          let keys = consigned
            ? [...part.matchAll(/\*\*([^*]+)\*\*/g)].map(m => m[1])
            : [...part.matchAll(/\*\*?([^*]+)\*\*?/g)].map(m => m[1]);
          if (!keys.length && !consigned) keys = [part.replace(/^\s*(?:\d{4}(?:[–-]\d{2,4})?\s*(?:\([^)]*\))?\s*—\s*)?/, '').split(',')[0]];
          for (const kRaw of keys) {
            if (/^\s*\(/.test(kRaw)) continue;             // parenthetical asides, not entries
            const k = norm(kRaw).replace(/^["'(]+/, '').replace(/[.,;:"']+$/, '');
            if (k.length < 4 || /^\d[\d\s–-]*$/.test(k) || KEY_STOP.test(k) || ALLOW.some(rx => rx.test(k))) continue;
            checked++;
            if (!matches(k, siteN, true)) { console.warn(`⚠ ${a.name} — in fiche, not on site [${header.trim()}]: ${kRaw.trim()}`); warnings++; }
          }
        }
      }
    }

    /* ---- direction 2: site → fiche ---- */
    const rows = [...(a.solo || []), ...(a.group || []), ...(a.extra || []).flatMap(s => s.rows)];
    for (const [, text] of rows) {
      const title = norm(text).split(/,| - /)[0].replace(/^["'(]+/, '').replace(/[.,;:"']+$/, '');
      if (title.length < 6 || ALLOW.some(rx => rx.test(title))) continue;
      checked++;
      if (!matches(title, ficheN, false)) { console.warn(`⚠ ${a.name} — on site, not in fiche (invented? cross-attributed?): ${text}`); warnings++; }
    }
    for (const w of a.works || []) {
      checked++;
      if (!matches(norm(w.t), ficheN, false)) { console.warn(`⚠ ${a.name} — work on site, not in fiche: ${w.t}`); warnings++; }
    }
    /* born field: every fact in it must exist in the fiche (catches invented birth data) */
    for (const tok of String(a.born || '').split(',').map(t => norm(t)).filter(t => t.length >= 4)) {
      checked++;
      if (!ficheN.includes(tok)) { console.warn(`⚠ ${a.name} — born:'${a.born}' contains '${tok}', not found in fiche`); warnings++; }
    }
  }

  console.log(warnings
    ? `check-fiches: ${warnings} warning(s) over ${checked} checks — review above (warn-only, nothing was changed).`
    : `check-fiches: OK — ${checked} checks, no drift detected between fiches and ARTISTS array.`);
  return warnings;
}

run();
