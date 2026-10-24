// Derives everything the page needs from a parsed map + game data: names, artifact spots and
// rewards, routing grid, portals/guards, owners, Seer anchors, skills/spells, tooltips, combos.
const path = require('path');
const fs = require('fs');
const LIB = __dirname;
const MAP = JSON.parse(fs.readFileSync(path.join(LIB, 'hota_mapping.json')));
const MAP18 = JSON.parse(fs.readFileSync(path.join(LIB, 'hota_mapping18.json')));
const HART = JSON.parse(fs.readFileSync(path.join(LIB, 'hota_art.json')));
const OBJDESC = JSON.parse(fs.readFileSync(path.join(LIB, 'objdesc.json')));
const COMBOS = JSON.parse(fs.readFileSync(path.join(LIB, 'combos.json')));

const COL = ['Red', 'Blue', 'Tan', 'Green', 'Orange', 'Purple', 'Teal', 'Pink'];
const KEYCOL = ['Light Blue', 'Green', 'Red', 'Dark Blue', 'Brown', 'Purple', 'White', 'Black'];
const FAC = ['Castle', 'Rampart', 'Tower', 'Inferno', 'Necropolis', 'Dungeon', 'Stronghold', 'Fortress', 'Conflux', 'Cove', 'Factory', 'Bulwark'];
const RES = ['wood', 'mercury', 'ore', 'sulfur', 'crystal', 'gems', 'gold'];
const MINE = ['Sawmill', 'Alchemist Lab', 'Ore Pit', 'Sulfur Dune', 'Crystal Cavern', 'Gem Pond', 'Gold Mine', 'Abandoned Mine'];
const PRIM = ['Attack', 'Defense', 'Spell Power', 'Knowledge'];
const MON = new Set([54, 71, 72, 73, 74, 75, 162, 163, 164]);
const words = s => s.replace(/^\d+/, '').replace(/([a-z])([A-Z])/g, '$1 $2').trim().replace(/^./, c => c.toUpperCase());

// TSV with quoted multi-line cells (artraits.txt uses them)
function tsv(text) {
  const rows = []; let row = [], cell = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) { if (c === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += c; }
    else if (c === '"') q = true; else if (c === '\t') { row.push(cell); cell = ''; }
    else if (c === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; }
    else if (c !== '\r') cell += c;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows;
}

// Name tables from the install (+ HotA additions from the mod mapping)
function loadNames(gd) {
  const art = tsv(gd.text('artraits.txt') || ''); const AN = {}, AD = {};
  art.slice(2).forEach((r, i) => { if (r[0]) { AN[i] = r[0]; AD[i] = (r[r.length - 1] || '').replace(/\s+/g, ' ').trim(); } });
  for (const [ident, idx] of Object.entries(MAP.artifacts)) { const h = HART[ident.toLowerCase()]; AN[idx] = h ? h.name : words(ident); if (h) AD[idx] = h.desc; }
  const CR = {}; let i = 0;
  // SoD creature table from H3bitmap.lod (plain lines, blank separator rows skipped)
  const crt = gd.lods.map(l => l.has('crtraits.txt') ? l.get('crtraits.txt') : null).filter(Boolean).pop();
  for (const line of (crt ? require('./h3lod').cp1251(crt) : '').split('\r\n').slice(2)) { const n = line.split('\t')[0]; if (n && n.trim()) CR[i++] = n; }
  for (const [k, v] of Object.entries(MAP18.creatures)) CR[v] = words(k);
  const HE = {}; i = 0; for (const r of gd.rows('hotraits.txt').slice(2)) if (r[0] && r[0].trim()) HE[i++] = r[0];
  // HotA heroes are not in hotraits.txt: name them from the HotA 1.8 identifiers; names the map author set win
  for (const [ident, id] of Object.entries(MAP18.heroes || {})) if (!HE[id]) { const n = ident.replace(/^\d+/, ''); HE[id] = n.charAt(0).toUpperCase() + n.slice(1); }
  for (const [k, v] of Object.entries(MAP18.heroes)) HE[v] = words(k);
  const SP = gd.rows('sptraits.txt').map(r => r[0]).filter(s => s && s.trim() && !['Name', 'Adventure Spells', 'Combat Spells', 'Creature Abilities'].includes(s));
  const SK = gd.rows('sstraits.txt').slice(2).map(r => r[0]).filter(s => s && s.trim()).concat(['Interference', 'Runes']);
  const cb = gd.rows('crbanks.txt'); const BANK = {}; for (let k = 0; k < 7; k++) BANK[k] = (cb[2 + 4 * k] || [''])[0];
  for (const [k, v] of Object.entries((MAP18.objects || {}).creatureBank || {})) BANK[v[1]] = words(k);
  const OBJN = gd.rows('objnames.txt').map(r => r[0]);
  const DW1 = gd.rows('crgen1.txt').map(r => r[0]);
  return { AN, AD, CR, HE, SP, SK, BANK, OBJN, DW1 };
}

function build(m, gd) {
  const N = m.size, NN = N * N, O = m.objects, T = m.terrain;
  const names = loadNames(gd); const { AN, AD, CR, SP, SK, BANK, OBJN, DW1 } = names; const HE = Object.assign({}, names.HE);
  for (const [id, h] of Object.entries(m.heroAvail || {})) if (h.name) HE[id] = h.name;  // names the map author set
  const art = a => { const [aid, sp] = Array.isArray(a) ? a : [a, -1]; if (aid === 0xffff || aid === -1 || aid === undefined) return null; if (aid === 1 && sp >= 0 && sp < SP.length) return 'Spell Scroll (' + SP[sp] + ')'; return AN[aid] || ('Artifact #' + aid); };
  const cre = (cid, n) => { if (cid === 0xffff) return null; if (cid >= 0xffff - 16) { const lvl = Math.floor((0xffff - 1 - cid) / 2); return n ? `${n} random lvl ${lvl + 1}` : `random lvl ${lvl + 1}`; } return `${n ? n : 'random'} ${CR[cid] || 'creature #' + cid}`; };
  const army = a => (a || []).filter(([c, n]) => c !== 0xffff && n).map(([c, n]) => cre(c, n)).join(', ') || 'empty';
  const byq = new Map(); O.forEach(o => { if (o.qid !== undefined) byq.set(o.qid, o); });
  const mission = q => {
    const t = q.m;
    if (t === 1) return 'reach level ' + q.level;
    if (t === 2) return 'primary skills ' + q.prim.join('/');
    if (t === 3 || t === 4) { const tg = byq.get(q.target); if (!tg) return 'defeat target #' + q.target; const [x, y, z] = tg.pos, lv = z ? 'underground' : 'surface'; return t === 3 ? `defeat hero ${HE[tg.hero] || '#' + tg.hero} at (${x},${y}) ${lv}` : `defeat ${tg.t.id === 54 ? cre(tg.t.sub, tg.count) : 'random monster'} at (${x},${y}) ${lv}`; }
    if (t === 5) return 'bring ' + q.arts.map(art).filter(Boolean).join(', ');
    if (t === 6) return 'bring ' + q.army.map(([c, n]) => cre(c, n)).join(', ');
    if (t === 7) return 'bring ' + q.res.map((n, i) => n ? `${n} ${RES[i]}` : '').filter(Boolean).join(', ');
    if (t === 8) return 'be hero ' + (HE[q.hero] || '#' + q.hero);
    if (t === 9) return 'be player ' + COL[q.player];
    if (t === 10) return { 0: 'be certain hero class', 1: `after day ${(q.day || 0) + 1}`, 2: 'on certain difficulty', 3: 'scripted condition' }[q.sub];
    return 'quest';
  };
  const SPN = gd.rows('sptraits.txt').map(r => r[0]).filter(s => s && s.trim() && !['Name', 'Adventure Spells', 'Combat Spells', 'Creature Abilities'].includes(s));
  const reward = q => { const a = q.ra, b = q.rb; switch (q.rt) { case 1: return a + ' experience'; case 2: return a + ' spell points'; case 3: return (a > 0 ? '+' : '') + a + ' morale'; case 4: return (a > 0 ? '+' : '') + a + ' luck'; case 5: return b + ' ' + RES[a]; case 6: return '+' + b + ' ' + PRIM[a]; case 7: return ['', 'Basic', 'Advanced', 'Expert'][b] + ' ' + (SK[a] || 'skill #' + a); case 8: return art(q.reward_art) || 'artifact'; case 9: return 'spell ' + (SPN[a] || '#' + a); case 10: return (cre(a, b) || b + ' creatures'); default: return 'nothing'; } };
  const seerQ = [];
  const entry = o => { const [x, y, z] = o.pos; for (let k = 0; k < 6; k++) for (let j = 0; j < 8; j++) if ((o.t.visit[k] >> j) & 1) return [x - (7 - j), y - (5 - k), z]; return [x, y, z]; };

  // ---- artifacts on the ground + rewards ----
  const arts = [];
  const CHEST = { 101: [3, 'Treasure Chest'], 22: [1, 'Corpse'], 108: [0, "Warrior's Tomb"], 86: [0, 'Shipwreck Survivor'], 82: [2, 'Sea Chest'] };
  const RND = { 65: 'Any', 66: 'Treasure', 67: 'Minor', 68: 'Major', 69: 'Relic' };
  const add = (o, oi, kind, list, via) => { list = list.filter(Boolean); if (!list.length) return; const [x, y, z] = entry(o); arts.push({ x, y, z, n: list.join(', '), r: 2, k: kind, v: via, oi }); };
  O.forEach((o, oi) => {
    const id = o.t.id, sub = o.t.sub, [x, y, z] = o.pos;
    if (id === 5) arts.push({ x, y, z, n: AN[sub] || 'Artifact #' + sub, r: 0, oi, id: sub });
    else if (RND[id]) arts.push({ x, y, z, n: RND[id], r: 1, oi });
    else if (id === 83) { for (const q of o.quests.concat(o.repeat)) if (q.reward_art) add(o, oi, "Seer's Hut", [art(q.reward_art)], mission(q) + (o.repeat.includes(q) ? ' (repeatable)' : '')); }
    else if (MON.has(id) && o.art !== undefined && o.art !== 0xffff) add(o, oi, 'Monster', [art(o.art)], 'defeat ' + (id === 54 ? cre(sub, o.count) : 'random monster'));
    else if ((id === 6 || id === 26) && o.arts && o.arts.length) { const g = (o.guards || []).filter(([c, n]) => c !== 0xffff && n).map(([c, n]) => cre(c, n)); add(o, oi, id === 6 ? "Pandora's Box" : 'Event', o.arts.map(art), g.length ? 'guarded by ' + g.join(', ') : 'unguarded'); }
    else if ([16, 24, 25, 84, 85].includes(id) && o.arts && o.arts.length) add(o, oi, id === 16 ? (BANK[sub] || 'Creature Bank') : { 85: 'Shipwreck', 24: 'Derelict Ship', 84: 'Crypt', 25: 'Dragon Utopia' }[id], o.arts.map(art), 'fixed bank loot');
    else if (CHEST[id] && o.content === CHEST[id][0]) add(o, oi, CHEST[id][1], [art(o.art)], 'pick up');
    else if ((id === 105 || (id === 212 && sub === 1001)) && o.content === 0 && o.art !== undefined && o.art !== -1) add(o, oi, id === 105 ? 'Wagon' : 'Grave', [art(o.art)], 'pick up');
    else if ((id === 34 || id === 62 || id === 70) && o.arts && o.arts.length) { const l = o.arts.filter(a => ![0, 3, 4, 5, 6].includes(a[0])).map(art); const hn = o.name || HE[o.hero] || 'hero'; if (id === 62) add(o, oi, 'Prison', l, 'free ' + hn); else add(o, oi, 'Hero', l, `${hn}, ${o.owner < 8 ? COL[o.owner] : 'neutral'}`); }
  });

  // ---- routing grid ----
  const G = new Uint8Array(2 * NN), cost = new Uint8Array(2 * NN), water = new Uint8Array(2 * NN);
  const TC = [0, 2, 0, 2, 3, 1, 0, 0, 0, 0, 0, 1];
  for (let i = 0; i < m.levels * NN; i++) { const tt = T[7 * i], road = T[7 * i + 4] & 7; if (tt === 8) { G[i] = 2; water[i] = 1; } else if (tt === 9) G[i] = 4; cost[i] = road === 1 ? 4 : road === 2 ? 5 : road === 3 ? 6 : (TC[tt] || 0); }
  // walk-through entrances: towns, teleports, garrisons, gates, and pickups that vanish once taken; every other visitable is visited from a neighbouring tile and is goal-only
  const PASSV = new Set([26, 5, 65, 66, 67, 68, 69, 93, 79, 76, 101, 12, 29, 82, 86, 81, 59, 62, 33, 219, 9, 212, 215, 43, 44, 45, 103, 111, 98, 77]);
  // engine rule: an entrance cannot be entered from the three tiles above it, except creatures, heroes, artifacts, resources (template type 2-5) and a few classes
  const FROM_TOP = new Set([29, 82, 86, 11, 59, 8, 111, 33, 219, 81, 12, 9, 212, 215, 22]);
  const noTop = new Uint8Array(2 * NN);
  const blocked = new Uint8Array(2 * NN), visit = new Uint8Array(2 * NN), vpass = new Uint8Array(2 * NN), vmon = new Uint8Array(2 * NN);
  const tiles = (o, mask, inv, fn) => { const [x, y, z] = o.pos; for (let i = 0; i < 6; i++) for (let j = 0; j < 8; j++) { const bit = (mask[i] >> j) & 1; if ((bit === 0) === inv) { const tx = x - (7 - j), ty = y - (5 - i); if (tx >= 0 && ty >= 0 && tx < N && ty < N) fn(z * NN + ty * N + tx); } } };
  for (const o of O) { tiles(o, o.t.block, true, i => { blocked[i] = 1; }); tiles(o, o.t.visit, false, i => { visit[i] = 1; if (PASSV.has(o.t.id)) vpass[i] = 1; if (MON.has(o.t.id)) vmon[i] = 1; if (!(o.t.type >= 2 && o.t.type <= 5) && !FROM_TOP.has(o.t.id)) noTop[i] = 1; }); }
  for (let i = 0; i < 2 * NN; i++) { if (G[i] === 4) continue; if (blocked[i]) G[i] = 1; if (visit[i]) G[i] = 3; if (vpass[i]) G[i] = 5; if (vmon[i]) G[i] = 6; }
  const grid = [0, 1].map(z => { const b = Buffer.alloc(NN); for (let i = 0; i < NN; i++) b[i] = G[z * NN + i] | (cost[z * NN + i] << 3) | (water[z * NN + i] << 6) | (visit[z * NN + i] && noTop[z * NN + i] ? 128 : 0); return b.toString('base64'); });

  // ---- specials, monsters, towns, keys, owners, seers ----
  const PASS = { 33: 'garrison', 219: 'garrison', 9: 'borderGuard', 212: 'borderGate', 215: 'questGuard', 43: 'monoIn', 44: 'monoOut', 45: 'mono2', 103: 'subGate', 111: 'whirl' };
  const sp = [], mon = [], towns = [], keys = [], own = [], seers = [], skills = [];
  const skillsOf = mask => SK.filter((_, i) => (mask >> i) & 1);
  O.forEach((o, oi) => {
    const id = o.t.id, sub = o.t.sub, [x, y, z] = o.pos, e = entry(o);
    if (PASS[id]) {
      const d = { k: PASS[id], x: e[0], y: e[1], z, ox: x, oy: y, s: sub, oi };
      if (id === 33 || id === 219) { d.a = army(o.army); d.o = o.owner < 8 ? COL[o.owner] : 'neutral'; }
      if (id === 212 && sub >= 1000) { if (sub === 1000) d.k = 'questGate'; else d.k = null; }
      if (d.k) { if ((id === 9 || id === 212) && sub < 8) d.c = KEYCOL[sub]; if (o.quest) { d.q = o.quest.m ? mission(o.quest) : 'no condition'; if (o.quest.m === 8) d.hid = o.quest.hero; } if (id >= 43 && id <= 45) d.c = 'channel ' + sub; sp.push(d); }
    } else if (MON.has(id)) mon.push({ x, y, z, n: id === 54 ? cre(sub, o.count) : 'random monster' + (id > 71 && id < 76 ? ' lvl ' + (id - 71) : id >= 162 ? ' lvl ' + (id - 157) : ''), oi });
    else if (id === 10 && sub < 8) keys.push({ x, y, z, c: KEYCOL[sub] });
    if (id === 98 || id === 77) towns.push({ oi, x: e[0], y: e[1], z, cn: o.name || '', n: o.name || (id === 77 ? 'Random town' : FAC[sub] || 'Town'), f: id === 98 && sub < FAC.length ? FAC[sub] : 'random', o: o.owner < 8 ? COL[o.owner] : 'neutral' });
    const ow = o.owner !== undefined && o.owner < 8 ? o.owner : 255;
    if (id === 53 || id === 220) own.push({ oi, k: 'mine', x: e[0], y: e[1], z, n: MINE[Math.min(sub, 7)], o: ow });
    else if (id === 42) own.push({ oi, k: 'mine', x: e[0], y: e[1], z, n: 'Lighthouse', o: ow });
    else if ((id >= 17 && id <= 20) || (id >= 216 && id <= 218)) own.push({ oi, k: 'dwelling', x: e[0], y: e[1], z, n: 'Dwelling', o: ow, rnd: id >= 216 });
    else if (id === 33 || id === 219) own.push({ oi, k: 'garrison', x: e[0], y: e[1], z, n: 'Garrison', o: ow });
    else if (id === 98 || id === 77) own.push({ oi, k: 'town', x: e[0], y: e[1], z, n: o.name || 'Town', o: ow });
    else if (id === 83) { const qs = o.quests.concat(o.repeat); const t = qs.length && qs[0].txt ? Buffer.from(qs[0].txt[0], 'latin1') : Buffer.alloc(0); seers.push({ oi, x, y, z, n: o.seername || '', t: t.subarray(0, 24).toString('base64'), tl: t.length });
      o.quests.forEach((q, i) => { if (q.m) seerQ.push({ oi, x: e[0], y: e[1], z, n: o.seername || '', i, rep: false, q: mission(q), r: reward(q), hid: q.m === 8 ? q.hero : undefined }); });
      o.repeat.forEach((q, i) => { if (q.m) seerQ.push({ oi, x: e[0], y: e[1], z, n: o.seername || '', i, rep: true, q: mission(q), r: reward(q), hid: q.m === 8 ? q.hero : undefined }); }); }
    if (id === 113) { const sk = skillsOf(o.skills); skills.push({ oi, x: e[0], y: e[1], z, k: 'Witch Hut', n: sk.length === 1 ? sk[0] : sk.length ? 'random of ' + sk.length : 'any', v: sk.length > 1 && sk.length <= 12 ? sk.join(', ') : '' }); }
    else if (id === 81) { const [t, i] = o.bonus; skills.push({ oi, x: e[0], y: e[1], z, k: 'Scholar', n: t === 0 ? 'primary: ' + (PRIM[i] || '?') : t === 1 ? (SK[i] || 'skill #' + i) : t === 2 ? 'spell: ' + (SP[i] || '#' + i) : 'random', v: '' }); }
    else if (id === 104 || (id === 146 && sub === 0)) { const sk = o.custom !== -1 ? skillsOf(o.skills) : []; skills.push({ oi, x: e[0], y: e[1], z, k: id === 104 ? 'University' : 'Seafaring Academy', n: sk.length ? sk.join(', ') : 'random 4 skills', v: '' }); }
    else if (id === 88 || id === 89 || id === 90) skills.push({ oi, x: e[0], y: e[1], z, k: 'Shrine', n: o.spell >= 0 && o.spell < SP.length ? SP[o.spell] : `random level ${id - 87} spell`, v: `level ${id - 87} spell` });
  });
  // record indices: map order per kind; dwellings = regular first, random after
  const rank = {}; for (const w of own) { if (w.k !== 'dwelling') w.ri = rank[w.k] = (rank[w.k] === undefined ? 0 : rank[w.k] + 1); }
  let ri = 0; for (const w of own) if (w.k === 'dwelling' && !w.rnd) w.ri = ri++; for (const w of own) if (w.k === 'dwelling' && w.rnd) w.ri = ri++;
  const counts = { mine: own.filter(w => w.k === 'mine').length, dwelling: own.filter(w => w.k === 'dwelling').length, garrison: own.filter(w => w.k === 'garrison').length };

  // ---- tooltips ----
  const oinfo = {};
  O.forEach((o, oi) => {
    const id = o.t.id, sub = o.t.sub, d = {}; const name = OBJN[id] || 'Object ' + id;
    if (MON.has(id)) { d.n = id === 54 ? cre(sub, o.count || 0) : 'Random monster' + (id > 71 && id < 76 ? ' level ' + (id - 70) : id >= 162 ? ' level ' + (id - 157) : ''); if (o.art !== undefined && o.art !== 0xffff) d.x = 'Guards ' + (art(o.art) || ''); }
    else if (id === 5) { d.n = AN[sub] || 'Artifact #' + sub; d.x = AD[sub] || ''; }
    else if (RND[id]) d.n = 'Random ' + RND[id].toLowerCase() + ' artifact';
    else if (id === 79) d.n = sub < 7 ? RES[sub][0].toUpperCase() + RES[sub].slice(1) : name;
    else if (id === 76) d.n = 'Random resource';
    else if (id === 53 || id === 220) d.n = MINE[Math.min(sub, 7)];
    else if (id === 17) d.n = DW1[sub] || name;
    else if (id === 98 || id === 77) { d.n = o.name || name; d.x = id === 98 && FAC[sub] ? FAC[sub] : 'random faction'; }
    else if (id === 83) { const qs = o.quests.concat(o.repeat); d.n = "Seer's Hut" + (o.seername ? ' ' + o.seername : ''); d.x = qs.map(q => (q.m ? mission(q) : 'no quest') + (q.reward_art ? ' -> ' + (art(q.reward_art) || 'artifact') : '')).join('; '); }
    else if (id === 215 || (id === 212 && sub === 1000)) { d.n = id === 215 ? 'Quest Guard' : 'Quest Gate'; d.x = o.quest && o.quest.m ? mission(o.quest) : ''; }
    else if ((id === 9 || id === 212) && sub < 8) d.n = (id === 9 ? 'Border Guard' : 'Border Gate') + ' (' + KEYCOL[sub] + ')';
    else if (id === 10 && sub < 8) d.n = "Keymaster's Tent (" + KEYCOL[sub] + ')';
    else if (id >= 43 && id <= 45) d.n = name + ' channel ' + sub;
    else if (id === 33 || id === 219) { d.n = 'Garrison'; d.x = army(o.army); }
    else if (id === 34 || id === 70 || id === 62) d.n = (id === 62 ? 'Prison' : 'Hero') + ': ' + (o.name || HE[o.hero] || '');
    else if (id === 6 || id === 26) { d.n = id === 6 ? "Pandora's Box" : 'Event'; d.x = (o.arts || []).map(art).filter(Boolean).join(', '); }
    else d.n = name;
    const hd = OBJDESC.hota[id + ',' + sub];
    if (hd && d.n.startsWith('Object ')) d.n = hd.split(':')[0];
    if ([16, 24, 25, 84, 85].includes(id) && o.arts && o.arts.length) d.x = 'Loot: ' + o.arts.map(art).filter(Boolean).join(', ');
    if (d.n !== name && ![5, 65, 66, 67, 68, 69, 79, 76, 53, 220, 17, 98, 77, 83, 215, 212, 9, 10, 43, 44, 45, 33, 219, 34, 70, 62, 6, 26, 54, 71, 72, 73, 74, 75, 162, 163, 164].includes(id)) d.t = name;
    let desc = hd || OBJDESC.desc[id]; if (id === 212 && sub === 1000) desc = 'Quest Gate: passable once the quest is fulfilled.';
    if (desc && ![5, 65, 66, 67, 68, 69, 93].includes(id)) d.d = desc;
    if (!d.x) delete d.x;
    oinfo[oi] = d;
  });
  for (const e of skills) oinfo[e.oi].x = 'Teaches: ' + e.n + (e.v ? ' (' + e.v + ')' : '');

  // ---- placements for the sprite renderer (draw order) ----
  const objs = O.map((o, oi) => ({ k: o.t.anim.toLowerCase(), key: [-o.t.prio, o.pos[1], [34, 70, 62].includes(o.t.id) ? 1 : 0, o.t.visit.some(b => b) ? 1 : 0, o.pos[0]], o, oi }));
  objs.sort((a, b) => { for (let i = 0; i < 5; i++) if (a.key[i] !== b.key[i]) return a.key[i] - b.key[i]; return 0; });
  const defNames = [...new Set(objs.map(x => x.k))].concat(['ah00_e.def']);
  const kidx = new Map(defNames.map((k, i) => [k, i]));
  const placements = objs.map(x => [x.o.pos[0], x.o.pos[1], x.o.pos[2], kidx.get(x.k), x.oi, x.o.t.id]);

  const tile0 = Buffer.alloc(600 * 6); for (let i = 0; i < 600; i++) T.copy(tile0, 6 * i, 7 * i, 7 * i + 6);
  const opos = Buffer.alloc(3 * O.length); O.forEach((o, i) => { opos[3 * i] = o.pos[0]; opos[3 * i + 1] = o.pos[1]; opos[3 * i + 2] = o.pos[2]; });
  const hotaIcons = {}; try { const have = new Set(fs.readdirSync(path.join(LIB, '..', 'hota', 'icons')).map(f => f.toLowerCase())); for (const [ident, idx] of Object.entries(MAP.artifacts)) if (have.has(ident.toLowerCase() + '.png')) hotaIcons[idx] = fs.readdirSync(path.join(LIB, '..', 'hota', 'icons')).find(f => f.toLowerCase() === ident.toLowerCase() + '.png'); } catch (e) {}
  const perHeroObjs = perHeroList(O, entry);
  const data = {
    size: N, tile: 1008, name: m.name, levels: m.levels, arts, terrain: T.toString('base64'), hotaIcons, tile0: tile0.toString('base64'), nobj: O.length, opos: opos.toString('base64'),
    artnames: AN, artdesc: AD, skills, combos: COMBOS, spellNames: SP.slice(0, 70),
    nav: { own, seers, counts, grid, sp, mon, towns, keys },
    seerQ, heroAvail: Object.fromEntries(Object.entries(m.heroAvail || {}).map(([id, h]) => [id, h.mask])),
    perHero: PERHERO.map(([id, sub, n, b]) => ({ n, b })), perHeroObjs,
  };
  return { data, oinfo, defNames, placements, names };
}
// once-per-hero objects; a hero's visit field for each kind is a bit set indexed by the object's rank in (level, row, column) order
const PERHERO = [[100, null, 'Learning Stone', '+1000 experience'], [23, null, 'Marletto Tower', '+1 Defense'], [32, null, 'Garden of Revelation', '+1 Knowledge'], [51, null, 'Mercenary Camp', '+1 Attack'], [61, null, 'Star Axis', '+1 Spell Power'], [102, null, 'Tree of Knowledge', '+1 level'], [41, null, 'Library of Enlightenment', '+2 all primary skills'], [4, null, 'Arena', '+2 Attack or Defense'], [47, null, 'School of Magic', '+1 Power or Knowledge'], [107, null, 'School of War', '+1 Attack or Defense'], [144, 2, 'Colosseum of the Magi', '+2 Power or Knowledge'], [144, 5, "Hermit's Shack", 'upgrades a secondary skill'], [144, 6, 'Gazebo', '+2000 experience for gold']];
function perHeroList(O, entry) {
  const out = [];
  PERHERO.forEach(([id, sub], k) => {
    const l = []; O.forEach((o, oi) => { if (o.t.id === id && (sub === null || o.t.sub === sub)) l.push({ o, oi }); });
    l.sort((a, b) => a.o.pos[2] - b.o.pos[2] || a.o.pos[1] - b.o.pos[1] || a.o.pos[0] - b.o.pos[0]);
    l.forEach(({ o, oi }, i) => { const e = entry(o); out.push({ k, i, oi, x: e[0], y: e[1], z: e[2] }); });
  });
  return out;
}
module.exports = { build, tsv, loadNames };
