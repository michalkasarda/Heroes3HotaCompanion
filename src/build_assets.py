import sys, os, json, importlib, collections
import numpy as np
from PIL import Image
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import render
D = importlib.import_module('def')
HERE = os.path.dirname(os.path.abspath(__file__))
OUT = sys.argv[2]
m = render.parse(sys.argv[1]); N = m['size']; NN = N * N

def frame_rgba_mask(name):
    d = render.load_def_bytes(name)
    if d is None: return None
    typ, w, h, pal, blocks = D.parse_def(d)
    frames = [f for b in blocks for f in b]
    if not frames: return None
    img, fw, fh, lm, tm = D.decode_frame(d, frames[0][1])
    hh, ww = img.shape
    rgb = pal[img].astype(np.uint8); a = np.full((hh, ww), 255, np.uint8); flag = np.zeros((hh, ww), np.uint8)
    a[img == 0] = 0
    for i in range(1, 8):
        if tuple(pal[i]) == render.KEY[i]:
            mk = img == i; a[mk] = render.KEY_ALPHA[i]; rgb[mk] = (0, 0, 0)
            if i == 5: flag[mk] = 255; a[mk] = 0
    full = np.zeros((fh, fw, 4), np.uint8); full[tm:tm+hh, lm:lm+ww, :3] = rgb; full[tm:tm+hh, lm:lm+ww, 3] = a
    fm = np.zeros((fh, fw), np.uint8); fm[tm:tm+hh, lm:lm+ww] = flag
    return full, fm

# 1. terrain-only tiles
TS = 1008
for z, label in (() if '--no-terrain' in sys.argv else ((0, 'ow'), (1, 'ug'))):
    img = render.render_level(m, z, OUT, label, labels=False, objects=False)
    n = img.width // TS
    for ty in range(n):
        for tx in range(n):
            img.crop((tx*TS, ty*TS, (tx+1)*TS, (ty+1)*TS)).save(os.path.join(OUT, '%s_%d_%d.webp' % (label, tx, ty)), quality=82, method=4)
    img.resize((1008, 1008), Image.LANCZOS).save(os.path.join(OUT, '%s_mini.webp' % label), quality=80)
print('terrain tiles done')

# 2. atlas of used defs (+ hero sprite)
defs = {}
for o in m['objects']:
    defs.setdefault(o['t']['anim'].lower(), o['t']['anim'])
defs['ah00_e.def'] = 'AH00_E.def'
for nm in json.load(open(os.path.join(HERE, 'save_templates.json'))): defs.setdefault(nm.lower(), nm)
sprites = {}
for k, nm in defs.items():
    r = frame_rgba_mask(nm)
    if r is not None: sprites[k] = r
print('sprites', len(sprites), 'missing', len(defs) - len(sprites))
# shelf packing into 2048x2048 pages
PAGE = 2048
items = sorted(sprites.items(), key=lambda kv: -kv[1][0].shape[0])
pages = []; atlas = {}
cur = None
for k, (im, fm) in items:
    h, w = im.shape[:2]
    if cur is None or cur['y'] + h > PAGE and cur['x'] + w > PAGE:
        pass
    placed = False
    for pi, pg in enumerate(pages):
        # try current shelf
        if pg['x'] + w <= PAGE and pg['y'] + h <= PAGE:
            x, y = pg['x'], pg['y']; pg['x'] += w; pg['sh'] = max(pg['sh'], h); placed = True
        elif pg['y'] + pg['sh'] + h <= PAGE:
            pg['y'] += pg['sh']; pg['x'] = 0; pg['sh'] = h; x, y = 0, pg['y']; pg['x'] = w; placed = True
        if placed:
            pg['img'][y:y+h, x:x+w] = im; pg['fm'][y:y+h, x:x+w] = fm
            atlas[k] = dict(p=pi, x=int(x), y=int(y), w=int(w), h=int(h), f=int(fm.any())); break
    if not placed:
        pg = dict(x=w, y=0, sh=h, img=np.zeros((PAGE, PAGE, 4), np.uint8), fm=np.zeros((PAGE, PAGE), np.uint8)); pages.append(pg)
        pg['img'][0:h, 0:w] = im; pg['fm'][0:h, 0:w] = fm
        atlas[k] = dict(p=len(pages)-1, x=0, y=0, w=int(w), h=int(h), f=int(fm.any()))
for pi, pg in enumerate(pages):
    Image.fromarray(pg['img']).save(os.path.join(OUT, 'atlas%d.png' % pi), optimize=True)
    Image.fromarray(pg['fm']).save(os.path.join(OUT, 'flag%d.png' % pi), optimize=True)
print('atlas pages', len(pages))

# 3. object placement list in draw order per level: [x, y, z, defkey index, oi]
keys = list(atlas); kidx = {k: i for i, k in enumerate(keys)}
objs = []
for oi, o in enumerate(m['objects']):
    k = o['t']['anim'].lower()
    if k not in kidx: continue
    t = o['t']; x, y, z = o['pos']
    is_hero = t['id'] in (34, 70, 62); visitable = any(t['visit'])
    objs.append((-t['prio'], y, is_hero, visitable, x, z, oi, kidx[k], t['id']))
objs.sort()
out = [[o[4], o[1], o[5], o[7], o[6], o[8]] for o in objs]
json.dump(dict(keys=keys, atlas=atlas, pages=len(pages), objs=out, heroDef=kidx['ah00_e.def']), open(os.path.join(OUT, 'sprites.json'), 'w'), separators=(',', ':'))
print('objects', len(out))
