// Heroes 3 data readers: LOD archives, DEF sprites, text tables. Plain Node, no Electron.
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

class Lod {
  constructor(file) {
    this.fd = fs.openSync(file, 'r');
    const head = Buffer.alloc(92); fs.readSync(this.fd, head, 0, 92, 0);
    const n = head.readUInt32LE(8); this.entries = new Map();
    const tab = Buffer.alloc(32 * n); fs.readSync(this.fd, tab, 0, 32 * n, 92);
    for (let i = 0; i < n; i++) {
      const e = tab.subarray(32 * i, 32 * i + 32); const z = e.indexOf(0); const name = e.subarray(0, z < 0 ? 16 : z).toString('latin1').toLowerCase();
      this.entries.set(name, { off: e.readUInt32LE(16), size: e.readUInt32LE(20), csize: e.readUInt32LE(28) });
    }
  }
  has(name) { return this.entries.has(name.toLowerCase()); }
  get(name) {
    const e = this.entries.get(name.toLowerCase()); if (!e) return null;
    const buf = Buffer.alloc(e.csize || e.size); fs.readSync(this.fd, buf, 0, buf.length, e.off);
    return e.csize ? zlib.inflateSync(buf) : buf;
  }
}

// Game data directory: Data/ of a HotA/SoD install. Encrypted HotA.lod is skipped.
class GameData {
  constructor(dataDir, extraDefDirs = []) {
    this.lods = [];
    for (const n of ['HotA_lng.lod', 'H3ab_spr.lod', 'H3sprite.lod', 'H3ab_bmp.lod', 'H3bitmap.lod']) { const p = path.join(dataDir, n); if (fs.existsSync(p)) this.lods.push(new Lod(p)); }
    this.extra = new Map();
    for (const d of extraDefDirs) if (fs.existsSync(d)) for (const f of fs.readdirSync(d)) this.extra.set(f.toLowerCase(), path.join(d, f));
  }
  has(name) { const k = name.toLowerCase(); return this.lods.some(l => l.has(k)) || this.extra.has(k); }
  get(name) { const k = name.toLowerCase(); for (const l of this.lods) { if (l.has(k)) return l.get(k); } if (this.extra.has(k)) return fs.readFileSync(this.extra.get(k)); return null; }
  // sprite lookup prefers bundled HotA extras (newer graphics) over LOD copies
  getDef(name) { const k = name.toLowerCase(); if (this.extra.has(k)) return fs.readFileSync(this.extra.get(k)); for (const l of this.lods) { if (l.has(k)) return l.get(k); } return null; }
  text(name) { const b = this.get(name); return b ? cp1251(b) : null; }
  rows(name) { const t = this.text(name); return t ? t.split('\r\n').map(l => l.split('\t')) : []; }
}

const CP1251 = (() => { const m = new Array(256); for (let i = 0; i < 128; i++) m[i] = String.fromCharCode(i); const hi = 'ЂЃ‚ѓ„…†‡€‰Љ‹ЊЌЋЏђ‘’“”•–—˜™љ›њќћџ ЎўЈ¤Ґ¦§Ё©Є«¬­®Ї°±Ііґµ¶·ё№є»јЅѕїАБВГДЕЖЗИЙКЛМНОПРСТУФХЦЧШЩЪЫЬЭЮЯабвгдежзийклмнопрстуфхцчшщъыьэюя'; for (let i = 0; i < 128; i++) m[128 + i] = hi[i] || '?'; return m; })();
function cp1251(buf) { let s = ''; for (let i = 0; i < buf.length; i++) s += CP1251[buf[i]]; return s; }

// DEF decode: returns {w, h, frames:[{name, off}], pal:Buffer(768)} and frame decoder
function parseDef(d) {
  const type = d.readUInt32LE(0), w = d.readUInt32LE(4), h = d.readUInt32LE(8), nb = d.readUInt32LE(12);
  const pal = d.subarray(16, 16 + 768); let p = 16 + 768; const frames = [];
  for (let b = 0; b < nb; b++) {
    const n = d.readUInt32LE(p + 4); p += 16;
    const names = []; for (let i = 0; i < n; i++) { const s = d.subarray(p + 13 * i, p + 13 * i + 13); const z = s.indexOf(0); names.push(s.subarray(0, z < 0 ? 13 : z).toString('latin1')); } p += 13 * n;
    for (let i = 0; i < n; i++) frames.push({ name: names[i], off: d.readUInt32LE(p + 4 * i) }); p += 4 * n;
  }
  return { type, w, h, pal, frames };
}
function decodeFrame(d, off) {
  const fmt = d.readUInt32LE(off + 4), fw = d.readUInt32LE(off + 8), fh = d.readUInt32LE(off + 12), w = d.readUInt32LE(off + 16), h = d.readUInt32LE(off + 20), lm = d.readInt32LE(off + 24), tm = d.readInt32LE(off + 28);
  let p = off + 32; const img = Buffer.alloc(w * h);
  if (fmt === 0) d.copy(img, 0, p, p + w * h);
  else if (fmt === 1) {
    for (let y = 0; y < h; y++) { let q = p + d.readUInt32LE(p + 4 * y), x = 0; while (x < w) { const code = d[q], len = d[q + 1] + 1; q += 2; if (code === 0xff) { d.copy(img, y * w + x, q, q + len); q += len; } else img.fill(code, y * w + x, y * w + x + len); x += len; } }
  } else if (fmt === 2) {
    let q = p + d.readUInt16LE(p);
    for (let y = 0; y < h; y++) { let x = 0; while (x < w) { const b = d[q++], code = b >> 5, len = (b & 31) + 1; if (code === 7) { d.copy(img, y * w + x, q, q + len); q += len; } else img.fill(code, y * w + x, y * w + x + len); x += len; } }
  } else if (fmt === 3) {
    const nseg = w >> 5;
    for (let y = 0; y < h; y++) for (let s = 0; s < nseg; s++) { let q = p + d.readUInt16LE(p + 2 * (y * nseg + s)), x = s * 32; const end = x + 32; while (x < end) { const b = d[q++], code = b >> 5, len = (b & 31) + 1; if (code === 7) { d.copy(img, y * w + x, q, q + len); q += len; } else img.fill(code, y * w + x, y * w + x + len); x += len; } }
  } else throw new Error('def format ' + fmt);
  return { img, fw, fh, w, h, lm, tm };
}
const KEY = [[0, 255, 255], [255, 150, 255], [255, 100, 255], [255, 50, 255], [255, 0, 255], [255, 255, 0], [180, 0, 255], [0, 255, 0]];
const KEYA = [0, 64, 128, 128, 128, 255, 0, 0];
// RGBA of a frame (full canvas fw x fh) + flag mask (palette 5). Index 0 always transparent.
function frameRGBA(def, d, fr) {
  const f = decodeFrame(d, fr.off); const rgba = Buffer.alloc(f.fw * f.fh * 4), flag = Buffer.alloc(f.fw * f.fh);
  const special = []; for (let i = 0; i < 8; i++) { const c = def.pal; special[i] = i === 0 || (c[3 * i] === KEY[i][0] && c[3 * i + 1] === KEY[i][1] && c[3 * i + 2] === KEY[i][2]); }
  for (let y = 0; y < f.h; y++) for (let x = 0; x < f.w; x++) {
    const idx = f.img[y * f.w + x], o = ((y + f.tm) * f.fw + (x + f.lm)) * 4;
    if (idx < 8 && special[idx]) { if (idx === 5) flag[(y + f.tm) * f.fw + x + f.lm] = 255; else { rgba[o + 3] = KEYA[idx]; } continue; }
    rgba[o] = def.pal[3 * idx]; rgba[o + 1] = def.pal[3 * idx + 1]; rgba[o + 2] = def.pal[3 * idx + 2]; rgba[o + 3] = 255;
  }
  return { rgba, flag, w: f.fw, h: f.fh, hasFlag: flag.includes(255) };
}
module.exports = { Lod, GameData, parseDef, decodeFrame, frameRGBA, cp1251 };
