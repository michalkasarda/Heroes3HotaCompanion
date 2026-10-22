import sys, os, json, base64, collections
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import numpy as np
import rewards as RW   # reuses name tables (runs its own parse; cheap)
m = RW.m; O = m['objects']; sz = m['size']
T = np.frombuffer(m['terrain'], dtype=np.uint8).reshape(m['levels'], sz, sz, 7)
# grid codes: 0 land free, 1 blocked, 2 water, 3 visitable(stop), 4 rock
G = np.zeros((2, sz, sz), dtype=np.uint8)
G[T[..., 0] == 8] = 2
G[T[..., 0] == 9] = 4
# cost class in high bits: terrain 0:100 1:125 2:150 3:175; road 4:75 5:65 6:50
TC = np.array([0, 2, 0, 2, 3, 1, 0, 0, 0, 0, 0, 1], dtype=np.uint8)  # dirt sand grass snow swamp rough subt lava water rock highlands wasteland
cost = TC[T[..., 0]]
road = T[..., 4] & 7
cost = np.where(road == 1, 4, cost); cost = np.where(road == 2, 5, cost); cost = np.where(road == 3, 6, cost)
blocked = np.zeros((2, sz, sz), dtype=bool); visit = np.zeros((2, sz, sz), dtype=bool)
def tiles(o, mask, inv):
    x, y, z = o['pos']
    for i in range(6):
        for j in range(8):
            bit = (mask[i] >> j) & 1
            if (bit == 0) == inv:
                tx, ty = x - (7 - j), y - (5 - i)
                if 0 <= tx < sz and 0 <= ty < sz: yield tx, ty, z
# codes: 0 free 1 blocked 2 water 3 visitable stop-only 4 rock 5 pass-through visitable 6 monster tile
PASSV = {26, 5, 65, 66, 67, 68, 69, 93, 79, 76, 101, 12, 29, 82, 86, 81, 59, 62, 33, 219, 9, 212, 215, 43, 44, 45, 103, 111}
MONS = {54, 71, 72, 73, 74, 75, 162, 163, 164}
vpass = np.zeros((2, sz, sz), dtype=bool); vmon = np.zeros((2, sz, sz), dtype=bool)
for o in O:
    for tx, ty, z in tiles(o, o['t']['block'], True): blocked[z, ty, tx] = True
    for tx, ty, z in tiles(o, o['t']['visit'], False):
        visit[z, ty, tx] = True
        if o['t']['id'] in PASSV: vpass[z, ty, tx] = True
        if o['t']['id'] in MONS: vmon[z, ty, tx] = True
G[blocked & (G != 4)] = 1
G[visit & (G != 4)] = 3
G[vpass & (G != 4)] = 5
G[vmon & (G != 4)] = 6
PASS = {33: 'garrison', 219: 'garrison', 9: 'borderGuard', 212: 'borderGate', 215: 'questGuard', 43: 'monoIn', 44: 'monoOut', 45: 'mono2', 103: 'subGate', 111: 'whirl'}
FAC = ['Castle', 'Rampart', 'Tower', 'Inferno', 'Necropolis', 'Dungeon', 'Stronghold', 'Fortress', 'Conflux', 'Cove', 'Factory', 'Bulwark']
COL = RW.COL
KEYCOL = ['Light Blue', 'Green', 'Red', 'Dark Blue', 'Brown', 'Purple', 'White', 'Black']
def entry(o):
    e = list(tiles(o, o['t']['visit'], False))
    return e[0][:2] if e else o['pos'][:2]
def army(a):
    return ', '.join(RW.cre(c, n) for c, n in (a or []) if c != 0xffff and n) or 'empty'
specials = []; portals = []; monsters = []; towns = []; keys = []
for oi, o in enumerate(O):
    oid, sub = o['t']['id'], o['t']['sub']; x, y, z = o['pos']
    if oid in PASS:
        ex, ey = entry(o)
        d = dict(k=PASS[oid], x=ex, y=ey, z=z, ox=x, oy=y, s=sub, oi=oi)
        if oid in (33, 219): d['a'] = army(o.get('army')); d['o'] = COL[o['owner']] if o['owner'] < 8 else 'neutral'
        if oid == 212 and sub >= 1000: d['k'] = 'questGate' if sub == 1000 else None
        if d['k'] is None: continue
        if oid in (9, 212) and sub < 8: d['c'] = KEYCOL[sub]
        if 'quest' in o: d['q'] = RW.mission(o['quest']) if o['quest']['m'] else 'no condition'
        if oid in (43, 44, 45): d['c'] = 'channel %d' % sub
        specials.append(d)
    elif oid in (54, 71, 72, 73, 74, 75, 162, 163, 164):
        nm = RW.cre(sub, o['count']) if oid == 54 else ('random monster' + (' lvl %d' % (oid - 71) if oid > 71 and oid < 76 else ' lvl %d' % (oid - 157) if oid >= 162 else ''))
        monsters.append(dict(x=x, y=y, z=z, n=nm, oi=oi))
    elif oid == 10 and sub < 8:
        keys.append(dict(x=x, y=y, z=z, c=KEYCOL[sub]))
    elif oid in (98, 77):
        ex, ey = entry(o)
        towns.append(dict(oi=oi, x=ex, y=ey, z=z, n=(o.get('name') or ('Random town' if oid == 77 else FAC[sub] if sub < len(FAC) else 'Town')), f=(FAC[sub] if oid == 98 and sub < len(FAC) else 'random'), o=(COL[o['owner']] if o['owner'] < 8 else 'neutral')))
import base64
MINE_NAMES = ['Sawmill', 'Alchemist Lab', 'Ore Pit', 'Sulfur Dune', 'Crystal Cavern', 'Gem Pond', 'Gold Mine', 'Abandoned Mine']
own = []; seers = []
for oi, o in enumerate(O):
    oid, sub = o['t']['id'], o['t']['sub']; x, y, z = o['pos']; e = entry(o)
    if oid in (53, 220): own.append(dict(oi=oi, k='mine', x=e[0], y=e[1], z=z, n=MINE_NAMES[min(sub, 7)]))
    elif oid == 42: own.append(dict(oi=oi, k='mine', x=e[0], y=e[1], z=z, n='Lighthouse'))
    elif oid in (17, 18, 19, 20, 216, 217, 218): own.append(dict(oi=oi, k='dwelling', x=e[0], y=e[1], z=z, n='Dwelling'))
    elif oid in (33, 219): own.append(dict(oi=oi, k='garrison', x=e[0], y=e[1], z=z, n='Garrison'))
    elif oid in (98, 77): own.append(dict(oi=oi, k='town', x=e[0], y=e[1], z=z, n=o.get('name', 'Town')))
    elif oid == 83:
        qs = o['quests'] + o['repeat']
        t = qs[0]['txt'][0].encode('cp1251', 'replace') if qs and 'txt' in qs[0] else b''
        seers.append(dict(oi=oi, x=x, y=y, z=z, n=o.get('seername', ''), t=base64.b64encode(t[:24]).decode(), tl=len(t)))
DWRI = json.load(open(os.path.join(os.path.dirname(os.path.abspath(__file__)), 'dwelling_ri.json')))
rank = {}
for w in own:
    ow = O[w['oi']].get('owner', 255); w['o'] = ow if ow is not None and ow < 8 else 255
    if w['k'] == 'dwelling': w['ri'] = DWRI.get(str(w['oi']), -1)
    else: w['ri'] = rank[w['k']] = rank.get(w['k'], -1) + 1
counts = dict(mine=sum(1 for w in own if w['k'] == 'mine'), dwelling=sum(1 for w in own if w['k'] == 'dwelling'), garrison=sum(1 for w in own if w['k'] == 'garrison'))
water = (T[..., 0] == 8).astype(np.uint8)
nav = dict(own=own, seers=seers, counts=counts, grid=[base64.b64encode((G[z] | (cost[z] << 3) | (water[z] << 6)).astype(np.uint8).tobytes()).decode() for z in range(2)], sp=specials, mon=monsters, towns=towns, keys=keys)
d = json.load(open(sys.argv[1])); d['nav'] = nav; json.dump(d, open(sys.argv[1], 'w'))
print(collections.Counter(s['k'] for s in specials), len(monsters), len(towns), len(keys))
print([s for s in specials if s['k'] in ('monoIn', 'monoOut', 'mono2')][:6])
print(collections.Counter((s['k'], s.get('c')) for s in specials if s['k'].startswith('mono')))
print(collections.Counter(G.ravel().tolist()))
