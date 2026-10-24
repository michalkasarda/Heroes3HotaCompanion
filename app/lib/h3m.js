// HotA (map format 0x20, sub-version 10) .h3m parser. Port of src/h3m.py. Returns objects with the
// per-type details the companion needs (quests, rewards, owners, armies, artifacts, skills).
const zlib = require('zlib');
const { cp1251 } = require('./h3lod');

class R {
  constructor(d) { this.d = d; this.p = 0; }
  u8() { return this.d[this.p++]; }
  i8() { const v = this.d.readInt8(this.p); this.p += 1; return v; }
  u16() { const v = this.d.readUInt16LE(this.p); this.p += 2; return v; }
  i16() { const v = this.d.readInt16LE(this.p); this.p += 2; return v; }
  u32() { const v = this.d.readUInt32LE(this.p); this.p += 4; return v; }
  i32() { const v = this.d.readInt32LE(this.p); this.p += 4; return v; }
  bool() { return this.u8() !== 0; }
  s() { const n = this.u32(); const v = cp1251(this.d.subarray(this.p, this.p + n)); this.p += n; return v; }
  skip(n) { this.p += n; }
  zero(n) { for (let i = 0; i < n; i++) if (this.d[this.p + i] !== 0) throw new Error('expected zero at ' + (this.p + i)); this.p += n; }
  int3() { return [this.u8(), this.u8(), this.u8()]; }
  bytes(n) { const v = this.d.subarray(this.p, this.p + n); this.p += n; return v; }
}
const creatureSet = r => { const a = []; for (let i = 0; i < 7; i++) a.push([r.u16(), r.u16()]); return a; };
function msgGuards(r) { let g = null; if (r.bool()) { r.s(); if (r.bool()) g = creatureSet(r); r.zero(4); } return g; }
const artSlot = r => [r.u16(), r.i16()];
function heroArtifacts(r) { if (!r.bool()) return []; const out = []; for (let i = 0; i < 19; i++) out.push(artSlot(r)); const n = r.u16(); for (let i = 0; i < n; i++) out.push(artSlot(r)); return out.filter(a => a[0] !== 0xffff); }
function quest(r) {
  const m = r.u8(); const q = { m }; if (m === 0) return q;
  if (m === 1) q.level = r.u32();
  else if (m === 2) q.prim = [r.u8(), r.u8(), r.u8(), r.u8()];
  else if (m === 3 || m === 4) q.target = r.u32();
  else if (m === 5) { const n = r.u8(); q.arts = []; for (let i = 0; i < n; i++) q.arts.push(artSlot(r)); }
  else if (m === 6) { const n = r.u8(); q.army = []; for (let i = 0; i < n; i++) q.army.push([r.u16(), r.u16()]); }
  else if (m === 7) { q.res = []; for (let i = 0; i < 7; i++) q.res.push(r.u32()); }
  else if (m === 8) q.hero = r.u8();
  else if (m === 9) q.player = r.u8();
  else if (m === 10) { const sub = r.u32(); q.sub = sub; if (sub === 0) { const n = r.u32(); r.skip((n + 7) >> 3); } else if (sub === 1) q.day = r.u32(); else if (sub === 2) r.i32(); else if (sub === 3) { r.i32(); r.bool(); } else throw new Error('quest sub ' + sub); }
  else throw new Error('quest mission ' + m);
  q.lastday = r.i32(); q.txt = [r.s(), r.s(), r.s()]; return q;
}
function seerQuest(r) {
  const q = quest(r); if (q.m === 0) { r.zero(1); return q; }
  r.s(); const t = r.u8(); q.rt = t;
  if (t === 0) {} else if (t === 1 || t === 2) q.ra = r.u32(); else if (t === 3 || t === 4) q.ra = r.i8(); else if (t === 5) { q.ra = r.u8(); q.rb = r.u32(); } else if (t === 6 || t === 7) { q.ra = r.u8(); q.rb = r.u8(); } else if (t === 8) q.reward_art = artSlot(r); else if (t === 9) q.ra = r.u8(); else if (t === 10) { q.ra = r.u16(); q.rb = r.u16(); } else throw new Error('reward ' + t);
  return q;
}
function boxContent(r) {
  const g = msgGuards(r); r.u32(); r.i32(); r.i8(); r.i8(); r.skip(28); r.skip(4);
  let n = r.u8(); for (let i = 0; i < n; i++) { r.u8(); r.u8(); }
  n = r.u8(); const arts = []; for (let i = 0; i < n; i++) arts.push(artSlot(r));
  n = r.u8(); const spells = []; for (let i = 0; i < n; i++) spells.push(r.u8());
  n = r.u8(); for (let i = 0; i < n; i++) { r.u16(); r.u16(); }
  r.zero(8); return { arts, guards: g, spells };
}
function boxHota(r) { r.i32(); r.i32(); r.i32(); if (r.bool()) { r.i32(); r.bool(); } }
function rewardBlock(r) { r.i32(); r.i32(); r.i32(); r.i8(); r.i32(); r.i8(); }
function eventCommon(r) { r.s(); r.s(); r.skip(28); r.u8(); r.bool(); r.bool(); r.u16(); r.u16(); r.zero(16); r.i32(); if (r.bool()) { r.i32(); r.bool(); } }
function readHero(r) {
  const info = {}; info.qid = r.u32(); info.owner = r.u8(); info.hero = r.u8();
  if (r.bool()) info.name = r.s(); if (r.bool()) r.u32(); if (r.bool()) r.u8();
  if (r.bool()) { const n = r.u32(); for (let i = 0; i < n; i++) { r.u8(); r.u8(); } }
  if (r.bool()) info.army = creatureSet(r);
  r.i8(); info.arts = heroArtifacts(r); r.u8(); if (r.bool()) r.s(); r.i8(); if (r.bool()) r.skip(9); if (r.bool()) r.skip(4);
  r.zero(16); r.bool(); r.bool(); r.i32(); return info;
}
function readTown(r) {
  const info = {}; r.u32(); info.owner = r.u8(); if (r.bool()) info.name = r.s(); if (r.bool()) info.army = creatureSet(r); r.i8();
  if (r.bool()) r.skip(12); else r.bool();
  r.skip(9); r.skip(9); r.bool(); const n = r.u32(); r.skip(n);
  const ne = r.u32(); for (let i = 0; i < ne; i++) { eventCommon(r); r.i32(); r.i32(); r.i32(); r.i16(); r.bool(); r.skip(6); r.skip(14); r.zero(4); }
  r.u8(); r.zero(3); return info;
}
const MONSTERS = new Set([54, 71, 72, 73, 74, 75, 162, 163, 164]), BANKS = new Set([16, 24, 25, 84, 85]);
function readObject(r, oid, sub) {
  let info = {};
  if (oid === 26) { info = boxContent(r); r.u8(); r.bool(); r.bool(); r.zero(4); r.bool(); boxHota(r); }
  else if (oid === 34 || oid === 70 || oid === 62) info = readHero(r);
  else if (MONSTERS.has(oid)) { info.qid = r.u32(); info.count = r.u16(); r.i8(); if (r.bool()) { r.s(); r.skip(28); info.art = r.u16(); } r.bool(); r.bool(); r.zero(2); r.i32(); r.bool(); r.i32(); r.i32(); r.i32(); r.bool(); r.i32(); }
  else if (oid === 59 || oid === 91) { r.s(); r.zero(4); }
  else if (oid === 83) { const n = r.u32(); info.quests = []; for (let i = 0; i < n; i++) info.quests.push(seerQuest(r)); const m = r.u32(); info.repeat = []; for (let i = 0; i < m; i++) info.repeat.push(seerQuest(r)); info.seername = r.bool() ? r.s() : ''; r.zero(2); }
  else if (oid === 113) info.skills = r.u32();
  else if (oid === 81) { info.bonus = [r.i8(), r.u8()]; r.zero(6); }
  else if (oid === 33 || oid === 219) { info.owner = r.u32(); info.army = creatureSet(r); r.bool(); r.zero(8); }
  else if (oid === 5 || (oid >= 65 && oid <= 69)) { msgGuards(r); r.u32(); r.u8(); }
  else if (oid === 93) { msgGuards(r); info.spell = r.i32(); }
  else if (oid === 76 || oid === 79) { msgGuards(r); info.amount = r.u32(); r.zero(4); }
  else if (oid === 77 || oid === 98) info = readTown(r);
  else if (oid === 53 || oid === 220) { if (sub < 7) info.owner = r.u32(); else { r.skip(4); if (r.bool()) { r.u32(); r.i32(); r.i32(); } else r.skip(12); } }
  else if (oid >= 17 && oid <= 20) info.owner = r.u32();
  else if (oid === 88 || oid === 89 || oid === 90) info.spell = r.i32();
  else if (oid === 6) { info = boxContent(r); r.zero(1); boxHota(r); }
  else if (oid === 36) { if (sub < 1000) r.i32(); }
  else if (oid === 216 || oid === 217 || oid === 218) { info.owner = r.u32(); if (oid !== 218) { if (r.u32() === 0) r.skip(2); } if (oid !== 217) { r.u8(); r.u8(); } }
  else if (oid === 215 || (oid === 212 && sub === 1000)) { info.quest = quest(r); r.s(); }
  else if (oid === 87 || oid === 42) info.owner = r.u32();
  else if (oid === 214) { r.u8(); if (r.u8() === 0xff) r.u8(); r.bool(); for (let i = 0; i < 7; i++) { r.i32(); r.u32(); } const n = r.i32(); for (let i = 0; i < n; i++) artSlot(r); }
  else if (BANKS.has(oid)) { r.i32(); r.i8(); const n = r.u32(); info.arts = []; for (let i = 0; i < n; i++) info.arts.push(r.i32()); }
  else if (oid === 63) { r.i32(); r.i32(); }
  else if (oid === 101 || oid === 22 || oid === 108 || oid === 86 || oid === 82) { info.content = r.i32(); info.art = r.i32(); }
  else if (oid === 29 || oid === 102 || (oid === 145 && sub > 1)) { r.i32(); r.skip(4); }
  else if (oid === 105 || (oid === 212 && sub === 1001)) { info.content = r.i32(); info.art = r.i32(); r.skip(10); }
  else if (oid === 12 || oid === 39 || (oid === 145 && sub <= 1)) rewardBlock(r);
  else if (oid === 146 && sub === 0) { info.custom = r.i32(); info.skills = r.u32(); }
  else if (oid === 144 && sub === 12) { r.i32(); r.i32(); r.i32(); r.u32(); }
  else if (oid === 7) { for (let i = 0; i < 7; i++) artSlot(r); }
  else if (oid === 104) { info.custom = r.i32(); info.skills = r.u32(); }
  return info;
}
// map title only (any HotA sub-version, scripted maps included)
function title(buf) {
  const r = new R(zlib.gunzipSync(buf.subarray(0, 65536), { finishFlush: zlib.constants.Z_SYNC_FLUSH }));
  if (r.u32() !== 0x20) return null;
  r.u32(); r.u32(); r.u32(); r.u32(); r.bool(); r.bool(); r.u32(); r.u32(); r.i8(); r.bool(); r.bool();
  const n = r.u32(); for (let i = 0; i < n; i++) { r.s(); r.i32(); r.u8(); }
  r.bool(); r.i32(); r.bool(); return r.s();
}
function parse(buf) {
  const r = new R(zlib.gunzipSync(buf));
  if (r.u32() !== 0x20) throw new Error('Not a HotA map (format id)');
  const hv = r.u32(); if (hv !== 10) throw new Error('Unsupported HotA map sub-version ' + hv + ' (need 10 = HotA 1.8)');
  r.u32(); r.u32(); r.u32(); r.bool(); r.bool(); r.u32(); r.u32(); r.i8(); r.bool(); r.bool();
  let n = r.u32(); for (let i = 0; i < n; i++) { r.s(); r.i32(); r.u8(); }
  r.bool(); const size = r.i32(); const two = r.bool(); const name = r.s(), desc = r.s(); r.i8(); r.i8();
  const players = [];
  for (let i = 0; i < 8; i++) {
    const human = r.bool(), ai = r.bool(); r.i8(); r.skip(1); r.skip(2); r.bool();
    if (r.bool()) { r.bool(); r.skip(1); r.int3(); }
    r.bool(); if (r.u8() !== 0xff) { r.u8(); r.s(); }
    r.skip(1); n = r.u32(); for (let k = 0; k < n; k++) { r.u8(); r.s(); }
    players.push({ human, ai });
  }
  const vc = r.i8();
  if (vc !== -1) { r.bool(); r.bool(); if (vc === 0) r.u16(); else if (vc === 1) { r.u16(); r.i32(); } else if (vc === 2) { r.i8(); r.i32(); } else if (vc === 3) { r.int3(); r.i8(); r.i8(); } else if (vc === 4 || vc === 5 || vc === 6 || vc === 7) r.int3(); else if (vc === 8 || vc === 9 || vc === 11) {} else if (vc === 10) { r.u8(); r.int3(); } else if (vc === 12) r.u32(); else throw new Error('victory ' + vc); }
  const lc = r.i8(); if (lc === 0 || lc === 1) r.int3(); else if (lc === 2) r.u16();
  if (r.u8() > 0) r.skip(8);
  n = r.u32(); const heroAllowed = Buffer.from(r.bytes((n + 7) >> 3)); n = r.u32(); r.skip(n);
  // custom heroes: id, portrait, name, players allowed to hire them (bit per colour)
  n = r.u8(); const heroAvail = {}; for (let i = 0; i < n; i++) { const id = r.u8(); r.u8(); const nm = r.s(); heroAvail[id] = { mask: r.u8(), name: nm }; }
  r.zero(31); r.bool(); r.zero(3); n = r.i32(); r.skip((n + 7) >> 3); r.i32(); r.skip(8);
  if (r.bool()) throw new Error('Map uses the HotA event scripting system, not supported');
  n = r.u32(); r.skip((n + 7) >> 3); const spellBits = Buffer.from(r.bytes(9)); r.skip(4);  // spells: 70 bits, a set bit = banned on this map
  n = r.u32(); for (let i = 0; i < n; i++) { r.s(); r.s(); }
  const nh = r.u32();
  for (let i = 0; i < nh; i++) { if (!r.bool()) continue; if (r.bool()) r.u32(); if (r.bool()) { const k = r.u32(); for (let j = 0; j < k; j++) { r.u8(); r.u8(); } } heroArtifacts(r); if (r.bool()) r.s(); r.i8(); if (r.bool()) r.skip(9); if (r.bool()) r.skip(4); }
  for (let i = 0; i < nh; i++) { r.bool(); r.bool(); r.i32(); }
  const levels = two ? 2 : 1; const terrain = Buffer.from(r.bytes(levels * size * size * 7));
  const templates = []; n = r.u32();
  for (let i = 0; i < n; i++) { const anim = r.s(); const block = Buffer.from(r.bytes(6)), visit = Buffer.from(r.bytes(6)); r.u16(); r.u16(); const id = r.u32(), sub = r.u32(), type = r.u8(), prio = r.u8(); r.skip(16); templates.push({ anim, block, visit, id, sub, type, prio }); }
  const objects = []; n = r.u32();
  for (let i = 0; i < n; i++) { const pos = r.int3(); const ti = r.u32(); r.zero(5); const t = templates[ti]; const info = readObject(r, t.id, t.sub); objects.push(Object.assign({ pos, t, ti }, info)); }
  const events = r.u32();
  return { size, levels, name, desc, players, terrain, templates, objects, events, heroAvail, heroAllowed, spellBits };
}
module.exports = { title, parse };
