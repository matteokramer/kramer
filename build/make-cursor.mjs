/* ============================================================
   make-cursor.mjs — bakes the "vintage internet" white arrow cursor
   ------------------------------------------------------------
   Renders the classic north-west pointer (white fill, 1px black
   outline, transparent ground) as a hard-edged PNG — no anti-alias,
   on purpose: an old-school aliased cursor. Output: images/cursor.png
   (hotspot = the tip, ~2,2). Re-run with `node build/make-cursor.mjs`
   only if you want to regenerate the bitmap; the PNG is committed.
============================================================ */
import { deflateSync } from 'node:zlib';
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const W = 24, H = 32, BORDER = 1;          // canvas + outline thickness (px)

/* Classic arrow outline, clockwise from the tip. Tip sits at (2,2)
   so the 1px border never clips against the canvas edge. */
const POLY = [
  [2,   2  ],  // tip (hotspot)
  [2,   24 ],  // bottom of the vertical left edge
  [8,   19 ],  // inner notch, left barb
  [11.5,30 ],  // tail, bottom-left
  [15,  28.6], // tail, bottom-right
  [11.5,18 ],  // inner notch, right barb
  [19,  18 ],  // right point of the arrowhead
];

function inside(px, py, poly){
  let hit = false;
  for(let i=0, j=poly.length-1; i<poly.length; j=i++){
    const [xi,yi]=poly[i], [xj,yj]=poly[j];
    if(((yi>py)!==(yj>py)) && (px < (xj-xi)*(py-yi)/(yj-yi)+xi)) hit=!hit;
  }
  return hit;
}

/* RGBA buffer */
const px = Buffer.alloc(W*H*4, 0);
for(let y=0; y<H; y++){
  for(let x=0; x<W; x++){
    const cx=x+0.5, cy=y+0.5;
    if(!inside(cx,cy,POLY)) continue;            // transparent ground
    let border=false;
    for(let dy=-BORDER; dy<=BORDER && !border; dy++)
      for(let dx=-BORDER; dx<=BORDER; dx++)
        if(!inside(cx+dx,cy+dy,POLY)){ border=true; break; }
    const o=(y*W+x)*4, v = border?0:255;
    px[o]=v; px[o+1]=v; px[o+2]=v; px[o+3]=255; // black outline / white fill, opaque
  }
}

/* --- minimal PNG encoder (RGBA, filter 0) --- */
const crcTable=(()=>{const t=new Int32Array(256);for(let n=0;n<256;n++){let c=n;for(let k=0;k<8;k++)c=c&1?0xEDB88320^(c>>>1):c>>>1;t[n]=c;}return t;})();
function crc32(buf){let c=~0;for(let i=0;i<buf.length;i++)c=crcTable[(c^buf[i])&0xff]^(c>>>8);return ~c>>>0;}
function chunk(type,data){
  const len=Buffer.alloc(4); len.writeUInt32BE(data.length,0);
  const tb=Buffer.from(type,'ascii');
  const crc=Buffer.alloc(4); crc.writeUInt32BE(crc32(Buffer.concat([tb,data])),0);
  return Buffer.concat([len,tb,data,crc]);
}
const ihdr=Buffer.alloc(13);
ihdr.writeUInt32BE(W,0); ihdr.writeUInt32BE(H,4);
ihdr[8]=8; ihdr[9]=6; ihdr[10]=0; ihdr[11]=0; ihdr[12]=0; // 8-bit, RGBA
const raw=Buffer.alloc(H*(W*4+1));
for(let y=0;y<H;y++){ raw[y*(W*4+1)]=0; px.copy(raw, y*(W*4+1)+1, y*W*4, (y+1)*W*4); }
const png=Buffer.concat([
  Buffer.from([137,80,78,71,13,10,26,10]),
  chunk('IHDR',ihdr),
  chunk('IDAT',deflateSync(raw,{level:9})),
  chunk('IEND',Buffer.alloc(0)),
]);
const out=join(dirname(fileURLToPath(import.meta.url)),'..','images','cursor.png');
writeFileSync(out,png);
console.log(`wrote ${out} — ${W}×${H}, ${png.length} bytes, hotspot 2 2`);
