import sys, os, csv, io, json, importlib, re
import numpy as np
from PIL import Image, ImageDraw, ImageFont
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from h3m import parse
from lod import Lods
D = importlib.import_module('def')

HERE = os.path.dirname(os.path.abspath(__file__))
TERRAIN_DEFS = ['dirttl', 'sandtl', 'grastl', 'snowtl', 'swmptl', 'rougtl', 'subbtl', 'lavatl', 'watrtl', 'rocktl']
RIVER_DEFS = [None, 'clrrvr', 'icyrvr', 'mudrvr', 'lavrvr']
ROAD_DEFS = [None, 'dirtrd', 'gravrd', 'cobbrd']
KEY = [(0, 255, 255), (255, 150, 255), (255, 100, 255), (255, 50, 255), (255, 0, 255), (255, 255, 0), (180, 0, 255), (0, 255, 0)]
KEY_ALPHA = [0, 64, 128, 128, 128, 255, 0, 0]
FLAG_COLOR = (200, 200, 200)
RANDOM_ART = {65: 'Any', 66: 'Treasure', 67: 'Minor', 68: 'Major', 69: 'Relic'}

L = Lods()
DL = {f.lower().replace('remap_', ''): os.path.join(HERE, 'dl', f) for f in os.listdir(os.path.join(HERE, 'dl'))}

def load_def_bytes(name):
    if L.has(name):
        return L.get(name)
    p = DL.get(name.lower())
    if p:
        return open(p, 'rb').read()
    return None

def frame_rgba(d, pal, off):
    img, fw, fh, lm, tm = D.decode_frame(d, off)
    h, w = img.shape
    rgb = pal[img].astype(np.uint8)
    a = np.full((h, w), 255, dtype=np.uint8)
    for i in range(8):
        if tuple(pal[i]) == KEY[i]:
            m = img == i
            a[m] = KEY_ALPHA[i]
            rgb[m] = FLAG_COLOR if i == 5 else (0, 0, 0)
    full = np.zeros((fh, fw, 4), dtype=np.uint8)
    full[tm:tm+h, lm:lm+w, :3] = rgb
    full[tm:tm+h, lm:lm+w, 3] = a
    return full

_cache = {}
def sprite(name, frame=0):
    key = (name.lower(), frame)
    if key in _cache:
        return _cache[key]
    d = load_def_bytes(name)
    res = None
    if d is not None:
        typ, w, h, pal, blocks = D.parse_def(d)
        frames = [f for b in blocks for f in b]
        if frame < len(frames):
            res = frame_rgba(d, pal, frames[frame][1])
    _cache[key] = res
    return res

def all_frames(name):
    d = load_def_bytes(name)
    typ, w, h, pal, blocks = D.parse_def(d)
    return [frame_rgba(d, pal, off) for b in blocks for _, off in b]

def blit(canvas, img, x, y):
    H, W = canvas.shape[:2]
    h, w = img.shape[:2]
    x0, y0 = max(x, 0), max(y, 0)
    x1, y1 = min(x + w, W), min(y + h, H)
    if x1 <= x0 or y1 <= y0:
        return
    src = img[y0-y:y1-y, x0-x:x1-x]
    dst = canvas[y0:y1, x0:x1]
    a = src[..., 3:4].astype(np.uint16)
    dst[..., :3] = ((src[..., :3].astype(np.uint16) * a + dst[..., :3].astype(np.uint16) * (255 - a)) // 255).astype(np.uint8)

def flip(img, flags, shift):
    if flags & (1 << shift): img = img[:, ::-1]
    if flags & (2 << shift): img = img[::-1, :]
    return img

def artifact_names():
    t = L.get('artraits.txt').decode('latin1')
    rows = list(csv.reader(io.StringIO(t), delimiter='\t', quotechar='"'))
    names = {i: r[0] for i, r in enumerate(rows[2:]) if r and r[0]}
    mf = json.load(open(os.path.join(HERE, 'hota_mapping.json')))
    for ident, idx in mf['artifacts'].items():
        p = os.path.join(HERE, 'artjson', ident + '.json')
        cands = [os.path.join(HERE, 'artjson', f) for f in os.listdir(os.path.join(HERE, 'artjson')) if f.lower() == (ident + '.json').lower()]
        if not cands:
            names[idx] = ident.capitalize()
            continue
        p = cands[0]
        names[idx] = re.search(r'"name"\s*:\s*"([^"]+)"', open(p).read()).group(1)
    return names

def render_level(m, z, out_dir, label, labels=True, objects=True):
    sz = m['size']
    T = np.frombuffer(m['terrain'], dtype=np.uint8).reshape(m['levels'], sz, sz, 7)[z]
    canvas = np.zeros((sz * 32, sz * 32, 4), dtype=np.uint8)
    canvas[..., 3] = 255
    tdefs = [all_frames(n + '.def') for n in TERRAIN_DEFS]
    hota_tiles = {}
    for name, prefix in ((10, 'HGLNT'), (11, 'wstlt')):
        hota_tiles[name] = []
        for i in range(124):
            p = os.path.join(HERE, 'tiles', '%s%03d.png' % (prefix, i))
            hota_tiles[name].append(np.array(Image.open(p).convert('RGBA')))
    rdefs = [all_frames(n + '.def') if n else None for n in RIVER_DEFS]
    odefs = [all_frames(n + '.def') if n else None for n in ROAD_DEFS]
    for y in range(sz):
        for x in range(sz):
            tt, view, river, rdir, road, odir, flags = T[y, x]
            tile = tdefs[tt][view] if tt < 10 else hota_tiles[tt][view]
            canvas[y*32:(y+1)*32, x*32:(x+1)*32] = flip(tile, flags, 0)
    for y in range(sz):
        for x in range(sz):
            tt, view, river, rdir, road, odir, flags = T[y, x]
            if river & 7:
                blit(canvas, flip(rdefs[river & 7][rdir], flags, 2), x*32, y*32)
    for y in range(sz):
        for x in range(sz):
            tt, view, river, rdir, road, odir, flags = T[y, x]
            if road & 7:
                blit(canvas, flip(odefs[road & 7][odir], flags, 4), x*32, y*32 + 16)
    objs = [o for o in m['objects'] if o['pos'][2] == z] if objects else []
    def key(o):
        t = o['t']
        is_hero = t['id'] in (34, 70, 62)
        visitable = any(t['visit'])
        return (-t['prio'], o['pos'][1], is_hero, visitable, o['pos'][0])
    objs.sort(key=key)
    missing = set()
    for o in objs:
        x, y, _ = o['pos']
        spr = sprite(o['t']['anim'])
        if spr is None:
            missing.add(o['t']['anim'])
            blk = o['t']['block']
            for r in range(6):
                for c in range(8):
                    if not (blk[r] >> c) & 1:
                        tx, ty = x - c, y - r
                        if 0 <= tx < sz and 0 <= ty < sz:
                            ph = np.zeros((32, 32, 4), dtype=np.uint8); ph[...] = (120, 60, 140, 110)
                            blit(canvas, ph, tx*32, ty*32)
            continue
        h, w = spr.shape[:2]
        blit(canvas, spr, (x + 1) * 32 - w, (y + 1) * 32 - h)
    img = Image.fromarray(canvas[..., :3])
    if not labels:
        return img
    names = artifact_names()
    draw = ImageDraw.Draw(img)
    font = ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf', 15)
    arts = []
    for o in objs:
        oid = o['t']['id']
        if oid not in (5, 65, 66, 67, 68, 69):
            continue
        x, y, _ = o['pos']
        if oid == 5:
            nm = names.get(o['t']['sub'], 'Artifact #%d' % o['t']['sub']); rnd = False
        else:
            nm = '? ' + RANDOM_ART[oid]; rnd = True
        arts.append((x, y, nm, rnd))
    for x, y, nm, rnd in arts:
        col = (255, 80, 80) if rnd else (255, 230, 0)
        draw.rectangle([x*32-1, y*32-1, x*32+32, y*32+32], outline=col, width=3)
        tx, ty = x*32 + 36, y*32 + 6
        bb = draw.textbbox((tx, ty), nm, font=font)
        if bb[2] > img.width - 4:
            tx = x*32 - 4 - (bb[2] - bb[0]); bb = draw.textbbox((tx, ty), nm, font=font)
        draw.rectangle([bb[0]-3, bb[1]-2, bb[2]+3, bb[3]+2], fill=(0, 0, 0, 200))
        draw.text((tx, ty), nm, font=font, fill=col)
    img.save(os.path.join(out_dir, label + '.png'))
    img.resize((img.width // 2, img.height // 2), Image.LANCZOS).save(os.path.join(out_dir, label + '_half.png'))
    return arts, missing

if __name__ == '__main__':
    path, out_dir = sys.argv[1], sys.argv[2]
    os.makedirs(out_dir, exist_ok=True)
    m = parse(path)
    lines = []
    for z, label in ((0, 'overworld'), (1, 'underground')):
        if z >= m['levels']:
            break
        arts, missing = render_level(m, z, out_dir, label)
        print(label, 'artifacts', len(arts), 'missing sprites', sorted(missing))
        lines.append('== %s ==' % label)
        for x, y, nm, rnd in sorted(arts, key=lambda a: (a[1], a[0])):
            lines.append('(%3d,%3d)  %s' % (x, y, nm))
    open(os.path.join(out_dir, 'artifacts.txt'), 'w').write('\n'.join(lines) + '\n')
