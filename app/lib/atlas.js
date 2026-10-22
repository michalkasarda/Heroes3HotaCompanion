// Incremental sprite atlas: packs DEF frame 0 of requested names into 2048x2048 RGBA pages
// plus matching flag (player colour) alpha pages. Pages are raw buffers served to the renderer.
const { parseDef, frameRGBA } = require('./h3lod');
const fs = require('fs'), path = require('path');
// original HotA def names -> names used by the VCMI mod files bundled under hota/defs
const EXTRA_ALIAS = { 'avxamsn2.def': 'avxamsn2_1.def', 'avcbule0.def': 'avcbulc0.def' };
const ALIAS = (() => { const out = {}; try { const t = JSON.parse(fs.readFileSync(path.join(__dirname, 'hota_mapping18.json'))).templates || {}; for (const [modPath, orig] of Object.entries(t)) out[orig.toLowerCase()] = modPath.split('/').pop().toLowerCase(); } catch (e) {} return out; })();
const PAGE = 2048;
class Atlas {
  constructor(gd) { this.gd = gd; this.pages = []; this.flags = []; this.entries = {}; this.version = 0; this.cur = null; }
  newPage() { this.pages.push(Buffer.alloc(PAGE * PAGE * 4)); this.flags.push(Buffer.alloc(PAGE * PAGE)); this.cur = { p: this.pages.length - 1, x: 0, y: 0, sh: 0 }; }
  ensure(names) {
    let added = 0;
    for (const name of names) {
      const k = name.toLowerCase(); if (this.entries[k] !== undefined) continue;
      let d = this.gd.getDef(k); if (!d && ALIAS[k]) d = this.gd.getDef(ALIAS[k]); if (!d && EXTRA_ALIAS[k]) d = this.gd.getDef(EXTRA_ALIAS[k]);
      // newer HotA variants missing from the bundled set: fall back to the previous numbered sibling (avmcrsn2 -> avmcrsn1)
      if (!d) { const m = /^(.*?)(\d)\.def$/.exec(k); if (m) for (let v = +m[2] - 1; v >= 0 && !d; v--) d = this.gd.getDef(m[1] + v + '.def'); }
      if (!d) { this.entries[k] = null; continue; }
      let fr; try { const def = parseDef(d); if (!def.frames.length) { this.entries[k] = null; continue; } fr = frameRGBA(def, d, def.frames[0]); } catch (e) { this.entries[k] = null; continue; }
      if (fr.w > PAGE || fr.h > PAGE) { this.entries[k] = null; continue; }
      if (!this.cur) this.newPage();
      if (this.cur.x + fr.w > PAGE) { this.cur.y += this.cur.sh; this.cur.x = 0; this.cur.sh = 0; }
      if (this.cur.y + fr.h > PAGE) this.newPage();
      const { p, x, y } = this.cur; const pg = this.pages[p], fl = this.flags[p];
      for (let r = 0; r < fr.h; r++) { fr.rgba.copy(pg, ((y + r) * PAGE + x) * 4, r * fr.w * 4, (r + 1) * fr.w * 4); fr.flag.copy(fl, (y + r) * PAGE + x, r * fr.w, (r + 1) * fr.w); }
      this.entries[k] = { p, x, y, w: fr.w, h: fr.h, f: fr.hasFlag ? 1 : 0 };
      this.cur.x += fr.w; this.cur.sh = Math.max(this.cur.sh, fr.h); added++;
    }
    if (added) this.version++;
    return added;
  }
  meta() { const atlas = {}; for (const [k, v] of Object.entries(this.entries)) if (v) atlas[k] = v; return { atlas, pages: this.pages.length, version: this.version, size: PAGE }; }
}
// Terrain sheet: one row per def (10 terrains, 4 rivers, 3 roads), 32x32 frames, max 79 columns.
const TERR = ['dirttl', 'sandtl', 'grastl', 'snowtl', 'swmptl', 'rougtl', 'subbtl', 'lavatl', 'watrtl', 'rocktl'];
const RIV = ['clrrvr', 'icyrvr', 'mudrvr', 'lavrvr'], ROAD = ['dirtrd', 'gravrd', 'cobbrd'];
function terrainSheet(gd) {
  const rows = TERR.concat(RIV, ROAD); const W = 80 * 32, H = rows.length * 32; const buf = Buffer.alloc(W * H * 4); const counts = [];
  rows.forEach((name, r) => {
    const d = gd.getDef(name + '.def'); if (!d) { counts.push(0); return; }
    const def = parseDef(d); counts.push(def.frames.length);
    def.frames.forEach((fr, c) => { if (c >= 80) return; const f = frameRGBA(def, d, fr); for (let y = 0; y < Math.min(32, f.h); y++) f.rgba.copy(buf, ((r * 32 + y) * W + c * 32) * 4, y * f.w * 4, y * f.w * 4 + Math.min(32, f.w) * 4); });
  });
  return { buf, w: W, h: H, counts, rows };
}
// Artifact icon sheet from artifact.def (44x44), 14 columns; HotA icons are PNG files composed by the renderer.
function iconSheet(gd) {
  const d = gd.getDef('artifact.def'); if (!d) return null; const def = parseDef(d); const COLS = 14, n = Math.max(def.frames.length, 166); const ROWS = Math.ceil(n / COLS);
  const W = COLS * 44, H = ROWS * 44; const buf = Buffer.alloc(W * H * 4);
  def.frames.forEach((fr, i) => { if (i >= 141 && i <= 145) return; const f = frameRGBA(def, d, fr); const cx = (i % COLS) * 44, cy = Math.floor(i / COLS) * 44; for (let y = 0; y < Math.min(44, f.h); y++) for (let x = 0; x < Math.min(44, f.w); x++) { const s = (y * f.w + x) * 4, t = ((cy + y) * W + cx + x) * 4; buf[t] = f.rgba[s]; buf[t + 1] = f.rgba[s + 1]; buf[t + 2] = f.rgba[s + 2]; buf[t + 3] = 255; } });
  return { buf, w: W, h: H, cols: COLS };
}
module.exports = { Atlas, terrainSheet, iconSheet, PAGE };
