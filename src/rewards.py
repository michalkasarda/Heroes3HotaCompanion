import sys, os, csv, io, json, re
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import render
from lod import Lods
L = Lods()
def rows(n): return [l.split('\t') for l in L.get(n).decode('latin1').split('\r\n')]
AN = render.artifact_names()
mf = json.load(open('hota_mapping18.json'))
def words(ident): return re.sub(r'^\d+', '', re.sub(r'([a-z])([A-Z])', r'\1 \2', ident)).strip().capitalize()
from lod import Lod, G
CR = {i: n for i, n in enumerate([l.split('\t')[0] for l in Lod(G + '/H3bitmap.lod').get('crtraits.txt').decode('latin1').split('\r\n')[2:] if l.split('\t')[0].strip()])}
for k, v in mf['creatures'].items(): CR[v] = words(k)
HE = {i: n for i, n in enumerate([r[0] for r in rows('hotraits.txt')[2:] if r[0].strip()])}
for k, v in mf['heroes'].items(): HE[v] = words(k)
SP = [r[0] for r in rows('sptraits.txt') if r and r[0].strip() and r[0] not in ('Name', 'Adventure Spells', 'Combat Spells', 'Creature Abilities')]
cb = rows('crbanks.txt')
BANK = {16: {i: cb[2 + 4 * i][0] for i in range(7)}, 85: 'Shipwreck', 24: 'Derelict Ship', 84: 'Crypt', 25: 'Dragon Utopia'}
for k, v in mf['objects'].get('creatureBank', {}).items(): BANK[16][v[1]] = words(k)
RES = ['wood', 'mercury', 'ore', 'sulfur', 'crystal', 'gems', 'gold']
COL = ['Red', 'Blue', 'Tan', 'Green', 'Orange', 'Purple', 'Teal', 'Pink']
def art(a):
    aid, sp = a if isinstance(a, tuple) else (a, -1)
    if aid in (0xffff, -1): return None
    if aid == 1 and 0 <= sp < len(SP): return 'Spell Scroll (%s)' % SP[sp]
    return AN.get(aid, 'Artifact #%d' % aid)
def cre(cid, n):
    if cid == 0xffff: return None
    if cid >= 0xffff - 16: lvl = (0xffff - 1 - cid) // 2; return '%d random lvl %d' % (n, lvl + 1) if n else 'random lvl %d' % (lvl + 1)
    return '%s %s' % (n if n else 'random', CR.get(cid, 'creature #%d' % cid))
def guards(g):
    g = [cre(c, n) for c, n in (g or []) if c != 0xffff and n]
    return 'guarded by ' + ', '.join(g) if g else ''
m = render.parse(sys.argv[1] if len(sys.argv) > 1 and sys.argv[1].endswith(".h3m") else "[HotA] The Mysterious Island - v1-5-j.h3m")
O = m['objects']
byq = {}
for o in O:
    if 'qid' in o: byq[o['qid']] = o
def mission(q):
    t = q['m']
    if t == 1: return 'reach level %d' % q['level']
    if t == 2: return 'primary skills %s' % '/'.join(map(str, q['prim']))
    if t in (3, 4):
        tgt = byq.get(q['target'])
        if not tgt: return 'defeat target #%d' % q['target']
        x, y, z = tgt['pos']; lv = 'underground' if z else 'surface'
        if t == 3: return 'defeat hero %s at (%d,%d) %s' % (HE.get(tgt['hero'], '#%d' % tgt['hero']), x, y, lv)
        return 'defeat %s at (%d,%d) %s' % (cre(tgt['t']['sub'], tgt['count']) if tgt['t']['id'] == 54 else 'random monster', x, y, lv)
    if t == 5: return 'bring ' + ', '.join(filter(None, (art(a) for a in q['arts'])))
    if t == 6: return 'bring ' + ', '.join(cre(c, n) for c, n in q['army'])
    if t == 7: return 'bring ' + ', '.join('%d %s' % (n, RES[i]) for i, n in enumerate(q['res']) if n)
    if t == 8: return 'be hero %s' % HE.get(q['hero'], '#%d' % q['hero'])
    if t == 9: return 'be player %s' % COL[q['player']]
    if t == 10: return {0: 'be certain hero class', 1: 'after day %d' % (q.get('day', 0) + 1), 2: 'on certain difficulty', 3: 'scripted condition'}[q['sub']]
    return 'quest'
out = []
OI = {id(o): i for i, o in enumerate(O)}
def entry(o):
    x, y, z = o['pos']
    for k in range(6):
        for j in range(8):
            if (o['t']['visit'][k] >> j) & 1: return (x - (7 - j), y - (5 - k), z)
    return (x, y, z)
def add(o, kind, arts, via):
    arts = [a for a in arts if a]
    if not arts: return
    x, y, z = entry(o)
    out.append(dict(x=x, y=y, z=z, n=', '.join(arts), r=2, k=kind, v=via, oi=OI[id(o)]))
CHEST = {101: (3, 'Treasure Chest'), 22: (1, 'Corpse'), 108: (0, "Warrior's Tomb"), 86: (0, 'Shipwreck Survivor'), 82: (2, 'Sea Chest')}
for o in O:
    oid, sub = o['t']['id'], o['t']['sub']
    if oid == 83:
        for q in o['quests'] + o['repeat']:
            if 'reward_art' in q: add(o, "Seer's Hut", [art(q['reward_art'])], mission(q) + (' (repeatable)' if q in o['repeat'] else ''))
    elif oid in (54, 71, 72, 73, 74, 75, 162, 163, 164) and o.get('art', 0xffff) != 0xffff:
        add(o, 'Monster', [art(o['art'])], 'defeat ' + (cre(sub, o['count']) if oid == 54 else 'random monster'))
    elif oid in (6, 26) and o.get('arts'):
        add(o, "Pandora's Box" if oid == 6 else 'Event', [art(a) for a in o['arts']], guards(o.get('guards')) or 'unguarded')
    elif oid in (16, 24, 25, 84, 85) and o.get('arts'):
        nm = BANK[16].get(sub, 'Creature Bank') if oid == 16 else BANK[oid]
        add(o, nm, [art(a) for a in o['arts']], 'fixed bank loot')
    elif oid in CHEST and o.get('content') == CHEST[oid][0]:
        add(o, CHEST[oid][1], [art(o['art'])], 'pick up')
    elif (oid == 105 or (oid == 212 and sub == 1001)) and o.get('content') == 0 and o.get('art', -1) != -1:
        add(o, 'Wagon' if oid == 105 else 'Grave', [art(o['art'])], 'pick up')
    elif oid in (34, 62, 70) and o.get('arts'):
        arts = [art(a) for a in o['arts'] if a[0] not in (0, 3, 4, 5, 6)]
        hn = o.get('name') or HE.get(o['hero'], 'hero')
        if oid == 62: add(o, 'Prison', arts, 'free %s' % hn)
        else: add(o, 'Hero', arts, '%s, %s' % (hn, COL[o['owner']] if o['owner'] < 8 else 'neutral'))
if __name__ == '__main__':
    d = json.load(open(sys.argv[2]))
    d['arts'] = [a for a in d['arts'] if a.get('r', 0) != 2] + out
    json.dump(d, open(sys.argv[2], 'w'))
    import collections
    print(len(out), collections.Counter(a['k'] for a in out)); print(CR[0], CR[132], CR[142], CR[144], CR[155], HE[0], HE[155], SP[15], SP[0], SP[69], len(SP))
    for a in out[:12]: print(a)
