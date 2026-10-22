import sys, os, json, csv, io, re
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import rewards as RW
from lod import Lods, Lod, G
L = Lods(); m = RW.m; O = m['objects']
def rows(n): return [l.split('\t') for l in L.get(n).decode('latin1').split('\r\n')]
OBJN = [r[0] for r in rows('objnames.txt')]
# artifact descriptions: artraits csv (quoted multi-line descriptions)
AN = RW.AN; AD = {}
t = L.get('artraits.txt').decode('latin1')
for i, r in enumerate(list(csv.reader(io.StringIO(t), delimiter='\t', quotechar='"'))[2:]):
    if r and r[0]: AD[i] = re.sub(r'\s+', ' ', r[-1].strip()) if len(r) > 2 else ''
mf = json.load(open(os.path.join(os.path.dirname(os.path.abspath(__file__)), 'hota_mapping.json')))
for ident, idx in mf['artifacts'].items():
    for f in os.listdir('artjson'):
        if f.lower() == (ident + '.json').lower():
            txt = open('artjson/' + f).read(); mm = re.search(r'"description"\s*:\s*"((?:[^"\\]|\\.)*)"', txt)
            if mm: AD[idx] = re.sub(r'\s+', ' ', mm.group(1).replace('\\r\\n', ' ').replace('\\n', ' '))
RES = ['Wood', 'Mercury', 'Ore', 'Sulfur', 'Crystal', 'Gems', 'Gold']
DW1 = [r[0] for r in rows('crgen1.txt')]  # dwelling names by sub for id 17
MINE = ['Sawmill', 'Alchemist Lab', 'Ore Pit', 'Sulfur Dune', 'Crystal Cavern', 'Gem Pond', 'Gold Mine', 'Abandoned Mine']
FAC = ['Castle', 'Rampart', 'Tower', 'Inferno', 'Necropolis', 'Dungeon', 'Stronghold', 'Fortress', 'Conflux', 'Cove', 'Factory', 'Bulwark']
KEYCOL = ['Light Blue', 'Green', 'Red', 'Dark Blue', 'Brown', 'Purple', 'White', 'Black']
from objdesc import DESC, HOTA
info = {}
for oi, o in enumerate(O):
    oid, sub = o['t']['id'], o['t']['sub']; d = {}
    name = OBJN[oid] if oid < len(OBJN) and OBJN[oid] else 'Object %d' % oid
    if oid in RW.RW_MON if hasattr(RW, 'RW_MON') else oid in (54, 71, 72, 73, 74, 75, 162, 163, 164):
        d['n'] = RW.cre(sub, o.get('count', 0)) if oid == 54 else ('Random monster' + (' level %d' % (oid - 70) if 71 < oid < 76 else ' level %d' % (oid - 157) if oid >= 162 else ''))
        if o.get('art', 0xffff) != 0xffff: d['x'] = 'Guards ' + (RW.art(o['art']) or '')
    elif oid == 5: d['n'] = AN.get(sub, 'Artifact #%d' % sub); d['x'] = AD.get(sub, '')
    elif oid in (65, 66, 67, 68, 69): d['n'] = 'Random %s artifact' % {65: '', 66: 'treasure', 67: 'minor', 68: 'major', 69: 'relic'}[oid]
    elif oid == 79: d['n'] = RES[sub] if sub < 7 else name
    elif oid == 76: d['n'] = 'Random resource'
    elif oid in (53, 220): d['n'] = MINE[min(sub, 7)]
    elif oid == 17: d['n'] = DW1[sub] if sub < len(DW1) and DW1[sub] else name
    elif oid in (98, 77): d['n'] = o.get('name', name); d['x'] = FAC[sub] if oid == 98 and sub < len(FAC) else 'random faction'
    elif oid == 83:
        qs = o['quests'] + o['repeat']; d['n'] = "Seer's Hut" + (' ' + o['seername'] if o.get('seername') else '')
        d['x'] = '; '.join((RW.mission(q) if q['m'] else 'no quest') + (' -> ' + (RW.art(q['reward_art']) or 'artifact') if 'reward_art' in q else '') for q in qs)
    elif oid == 215 or (oid == 212 and sub == 1000): d['n'] = 'Quest Guard' if oid == 215 else 'Quest Gate'; d['x'] = RW.mission(o['quest']) if o.get('quest', {}).get('m') else ''
    elif oid in (9, 212) and sub < 8: d['n'] = ('Border Guard' if oid == 9 else 'Border Gate') + ' (' + KEYCOL[sub] + ')'
    elif oid == 10 and sub < 8: d['n'] = "Keymaster's Tent (" + KEYCOL[sub] + ')'
    elif oid in (43, 44, 45): d['n'] = name + ' channel %d' % sub
    elif oid in (33, 219): d['n'] = 'Garrison'; d['x'] = RW.army if False else ', '.join(RW.cre(c, n) for c, n in (o.get('army') or []) if c != 0xffff and n) or 'empty'
    elif oid in (34, 70, 62): d['n'] = ('Prison' if oid == 62 else 'Hero') + ': ' + (o.get('name') or RW.HE.get(o.get('hero'), ''))
    elif oid in (6, 26): d['n'] = "Pandora's Box" if oid == 6 else 'Event'; d['x'] = ', '.join(filter(None, (RW.art(a) for a in o.get('arts', [])))) if o.get('arts') else ''
    else: d['n'] = name
    hn = HOTA.get((oid, sub))
    if hn and d['n'].startswith('Object '): d['n'] = hn.split(':')[0]
    if oid in (16, 24, 25, 84, 85) and o.get('arts'): d['x'] = 'Loot: ' + ', '.join(filter(None, (RW.art(a) for a in o['arts'])))
    if d.get('n') != name and oid not in (5, 65, 66, 67, 68, 69, 79, 76, 53, 220, 17, 98, 77, 83, 215, 212, 9, 10, 43, 44, 45, 33, 219, 34, 70, 62, 6, 26, 54, 71, 72, 73, 74, 75, 162, 163, 164): d['t'] = name
    desc = HOTA.get((oid, sub)) or DESC.get(oid)
    if oid == 212 and sub == 1000: desc = 'Quest Gate: passable once the quest is fulfilled.'
    if desc and oid not in (5, 65, 66, 67, 68, 69, 93): d['d'] = desc
    if not d.get('x'): d.pop('x', None)
    info[oi] = d
json.dump(info, open(sys.argv[1], 'w'), separators=(',', ':'))
print(len(info), info[1854], info[908], info[1796])
