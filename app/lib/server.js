// HTTP server used by the Electron shell and by `node app/lib/standalone.js`.
// Serves the page (with the current map's data injected), static files, and the JSON API.
const http = require('http');
const zlib = require('zlib');
const fs = require('fs');
const path = require('path');
const { parse, title } = require('./h3m');
const { GameData } = require('./h3lod');
const { build } = require('./mapdata');
const { Atlas, terrainSheet, iconSheet } = require('./atlas');

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.json': 'application/json', '.png': 'image/png', '.webp': 'image/webp', '.css': 'text/css', '.def': 'application/octet-stream' };

function findGameDir(hints) {
  // a HotA/SoD install root: contains Data/H3sprite.lod
  for (const h of hints) { if (!h) continue; let d = h; for (let i = 0; i < 4 && d; i++) { if (fs.existsSync(path.join(d, 'Data', 'H3sprite.lod'))) return d; const p = path.dirname(d); if (p === d) break; d = p; } }
  return null;
}
// a map subfolder inside Games (HotA keeps saves per map) means the Games folder itself
function normSaves(d) { if (!d) return d; const parent = path.dirname(d); return /^games$/i.test(path.basename(parent)) && !/^games$/i.test(path.basename(d)) ? parent : d; }
// the map file name a save was made from (stored as a NUL-terminated string early in the save)
function saveMapFile(buf) {
  let hl = 10; const flg = buf[3];
  if (flg & 4) hl += 2 + buf.readUInt16LE(hl);
  if (flg & 8) { while (buf[hl]) hl++; hl++; }
  if (flg & 16) { while (buf[hl]) hl++; hl++; }
  if (flg & 2) hl += 2;
  const head = zlib.inflateRawSync(buf.subarray(hl, hl + 65536), { finishFlush: zlib.constants.Z_SYNC_FLUSH });
  const t = head.toString('latin1'); const m = /([^\x00-\x1f]{1,200}\.h3m)\x00/i.exec(t);
  const L = head.readUInt16LE(0x5f); const name = L > 0 && L < 200 ? t.slice(0x61, 0x61 + L) : null;
  return { h3m: m ? m[1] : null, name };
}
const titleCache = new Map();
function mapTitle(file) { const st = fs.statSync(file); const k = file + ':' + st.mtimeMs; if (!titleCache.has(k)) { let t = null; try { t = title(fs.readFileSync(file)); } catch (e) {} titleCache.set(k, t); } return titleCache.get(k); }
function listMaps(dirs) {
  const out = [];
  for (const d of dirs) { if (!d || !fs.existsSync(d)) continue; for (const f of fs.readdirSync(d)) if (/\.h3m$/i.test(f)) { const p = path.join(d, f); const st = fs.statSync(p); out.push({ file: p, name: f.replace(/\.h3m$/i, ''), mtime: st.mtimeMs, size: st.size }); } }
  out.sort((a, b) => a.name.localeCompare(b.name)); return out;
}

function createServer(opts) {
  // opts: appDir, getSavesDir(), getGameDir(), getExtraMapDirs(), onPick(), onFind(), info() (extra fields for /api/info), listSaves(dir)
  const st = { gd: null, map: null, atlas: null, terrain: null, icons: null };
  const gameData = () => { if (st.gd) return st.gd; const g = opts.getGameDir(); if (!g) return null; st.gd = new GameData(path.join(g, 'Data'), [path.join(opts.appDir, 'hota', 'defs')]); return st.gd; };
  function openMap(file) {
    const gd = gameData(); if (!gd) throw new Error('Heroes 3 game folder not found');
    const buf = fs.readFileSync(file); const m = parse(buf); const r = build(m, gd);
    const atlas = new Atlas(gd); atlas.ensure(r.defNames);
    st.map = { file, name: m.name, size: m.size, levels: m.levels, data: r.data, oinfo: r.oinfo, defNames: r.defNames, placements: r.placements, atlas };
    if (!st.terrain) st.terrain = terrainSheet(gd);
    if (!st.icons) st.icons = iconSheet(gd);
    return st.map;
  }
  function spritesMeta() { const a = st.map.atlas.meta(); const keys = st.map.defNames.slice(); const extra = Object.keys(a.atlas).filter(k => !st.map.defNames.includes(k)); return { keys: keys.concat(extra), atlas: a.atlas, pages: a.pages, version: a.version, size: a.size, objs: st.map.placements, heroDef: keys.indexOf('ah00_e.def') }; }
  const srv = http.createServer(async (req, res) => {
    const u = new URL(req.url, 'http://x'); const url = decodeURIComponent(u.pathname);
    const json = (code, obj) => { const b = Buffer.from(JSON.stringify(obj)); res.writeHead(code, { 'Content-Type': 'application/json', 'Content-Length': b.length }); res.end(b); };
    const raw = (buf, type) => { res.writeHead(200, { 'Content-Type': type || 'application/octet-stream', 'Content-Length': buf.length }); res.end(buf); };
    try {
      if (url === '/api/info') return json(200, Object.assign({ pick: true, dir: opts.getSavesDir(), gameDir: opts.getGameDir(), data: st.gd ? { lods: st.gd.lods.map(l => path.basename(l.file)), defs: st.gd.extra.size } : null, sprites: st.map ? { keys: Object.keys(st.map.atlas.entries).length, found: Object.values(st.map.atlas.entries).filter(Boolean).length, missing: Object.entries(st.map.atlas.entries).filter(e => !e[1]).map(e => e[0]) } : null, map: st.map ? { file: st.map.file, name: st.map.name, size: st.map.size, levels: st.map.levels } : null }, opts.info ? opts.info() : {}));
      if (url === '/api/maps') return json(200, { gameDir: opts.getGameDir(), maps: listMaps([opts.getGameDir() && path.join(opts.getGameDir(), 'Maps')].concat(opts.getExtraMapDirs ? opts.getExtraMapDirs() : [])) });
      if (url === '/api/map/open') { const file = u.searchParams.get('file'); if (!file || !fs.existsSync(file)) return json(404, { error: 'map file not found' }); const m = openMap(file); return json(200, { name: m.name, size: m.size, levels: m.levels, file }); }
      if (url.startsWith('/api/map/')) {
        if (!st.map) return json(409, { error: 'no map open' });
        if (url === '/api/map/data') return json(200, st.map.data);
        if (url === '/api/map/oinfo') return json(200, st.map.oinfo);
        if (url === '/api/map/sprites') return json(200, spritesMeta());
        if (url === '/api/map/ensure' && req.method === 'POST') { let body = ''; req.on('data', c => body += c); await new Promise(r => req.on('end', r)); const names = JSON.parse(body || '[]'); st.map.atlas.ensure(names); return json(200, spritesMeta()); }
        let mm = /^\/api\/map\/atlas\/(\d+)$/.exec(url); if (mm) { const p = st.map.atlas.pages[+mm[1]]; return p ? raw(p) : json(404, {}); }
        mm = /^\/api\/map\/flag\/(\d+)$/.exec(url); if (mm) { const p = st.map.atlas.flags[+mm[1]]; return p ? raw(p) : json(404, {}); }
        if (url === '/api/map/terrain') return raw(st.terrain.buf);
        if (url === '/api/map/terrainmeta') return json(200, { w: st.terrain.w, h: st.terrain.h, counts: st.terrain.counts, rows: st.terrain.rows });
        if (url === '/api/map/icons') return st.icons ? raw(st.icons.buf) : json(404, {});
        if (url === '/api/map/iconsmeta') return st.icons ? json(200, { w: st.icons.w, h: st.icons.h, cols: st.icons.cols }) : json(404, {});
      }
      if (url === '/api/pick') { const d = normSaves(opts.onPick ? await opts.onPick('saves') : null); if (d) opts.setSavesDir(d); return json(200, { dir: d || opts.getSavesDir() }); }
      if (url === '/api/pickgame') { const d = opts.onPick ? await opts.onPick('game') : null; st.gd = null; st.terrain = null; st.icons = null; return json(200, { gameDir: d || opts.getGameDir() }); }
      if (url === '/api/find') { const seen = new Map(); for (const f of opts.onFind ? opts.onFind() : []) { const d = normSaves(f.dir); const q = seen.get(d); if (q) { q.count += f.count; q.newest = Math.max(q.newest, f.newest); } else seen.set(d, Object.assign({}, f, { dir: d })); } return json(200, { folders: [...seen.values()].sort((a, b) => b.newest - a.newest) }); }
      if (url.startsWith('/api/use/')) { const d = normSaves(url.slice('/api/use/'.length)); if (!fs.existsSync(d)) return json(404, { error: 'missing' }); opts.setSavesDir(d); return json(200, { dir: d }); }
      if (url === '/api/saves') { const d = normSaves(opts.getSavesDir()); return json(200, { dir: d || '', saves: d ? opts.listSaves(d) : [] }); }
      if (url === '/api/savemap') { const d = opts.getSavesDir(); const rel = u.searchParams.get('file') || ''; const p = path.normalize(path.join(d || '', rel)); if (!d || !p.startsWith(path.normalize(d)) || !fs.existsSync(p)) return json(404, { error: 'not found' });
        const { h3m, name } = saveMapFile(fs.readFileSync(p)); const maps = listMaps([opts.getGameDir() && path.join(opts.getGameDir(), 'Maps')].concat(opts.getExtraMapDirs ? opts.getExtraMapDirs() : []));
        let hit = h3m ? maps.find(m => path.basename(m.file).toLowerCase() === h3m.toLowerCase()) : null;
        if (!hit && name) { const same = maps.filter(m => mapTitle(m.file) === name); if (same.length === 1) hit = same[0]; else if (same.length > 1) hit = same.sort((a, b) => b.mtime - a.mtime)[0]; }
        return json(200, { h3m, name, mapFile: hit ? hit.file : null, mapName: hit ? hit.name : null }); }
      if (url.startsWith('/api/save/')) { const d = opts.getSavesDir(); if (!d) return json(404, { error: 'no folder' }); const p = path.normalize(path.join(d, url.slice('/api/save/'.length))); if (!p.startsWith(path.normalize(d)) || !fs.existsSync(p)) return json(404, { error: 'not found' }); return raw(fs.readFileSync(p)); }
      if (url === '/' || url === '/index.html') {
        if (!st.map) { res.writeHead(302, { Location: '/start.html' }); return res.end(); }
        const tpl = fs.readFileSync(path.join(opts.appDir, 'page.html'), 'utf8');
        const html = tpl.replace('__DATA__', () => JSON.stringify(st.map.data));
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); return res.end(html);
      }
      if (url.startsWith('/hota/')) { const f = path.normalize(path.join(opts.appDir, url)); if (!f.startsWith(opts.appDir) || !fs.existsSync(f)) { res.writeHead(404); return res.end(); } res.writeHead(200, { 'Content-Type': MIME[path.extname(f).toLowerCase()] || 'application/octet-stream' }); return fs.createReadStream(f).pipe(res); }
      const f = path.normalize(path.join(opts.appDir, url));
      if (!f.startsWith(opts.appDir) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end('not found'); }
      res.writeHead(200, { 'Content-Type': MIME[path.extname(f).toLowerCase()] || 'application/octet-stream' }); fs.createReadStream(f).pipe(res);
    } catch (e) { json(500, { error: e.message }); }
  });
  srv.state = st;
  return srv;
}
function listSaves(dir) {
  const out = [];
  const walk = (d, rel, depth) => { let ents = []; try { ents = fs.readdirSync(d, { withFileTypes: true }); } catch (e) { return; } for (const e of ents) { const p = path.join(d, e.name); if (e.isDirectory() && depth < 2) walk(p, path.join(rel, e.name), depth + 1); else if (/\.gm[12]$/i.test(e.name) || /\.cgm$/i.test(e.name)) { const s = fs.statSync(p); out.push({ name: path.join(rel, e.name).split(path.sep).join('/'), mtime: s.mtimeMs / 1000, size: s.size }); } } };
  walk(dir, '', 0); out.sort((a, b) => b.mtime - a.mtime); return out;
}
module.exports = { createServer, findGameDir, listMaps, listSaves };
