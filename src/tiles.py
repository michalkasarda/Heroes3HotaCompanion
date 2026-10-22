import sys, os, json
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import render
from PIL import features
print('webp', features.check('webp'))
m = render.parse(sys.argv[1]); out = sys.argv[2]; os.makedirs(out, exist_ok=True)
TS = 1008
names = render.artifact_names()
arts = []
for oi, o in enumerate(m['objects']):
    oid = o['t']['id']
    if oid not in (5, 65, 66, 67, 68, 69): continue
    x, y, z = o['pos']
    if oid == 5: arts.append(dict(x=x, y=y, z=z, n=names.get(o['t']['sub'], 'Artifact #%d' % o['t']['sub']), r=0, oi=oi, id=o['t']['sub']))
    else: arts.append(dict(x=x, y=y, z=z, n=render.RANDOM_ART[oid], r=1, oi=oi))
import base64
T6 = m['terrain']
N = m['size']
tile0 = base64.b64encode(b''.join(T6[i*7:i*7+6] for i in range(600))).decode()
d = json.load(open(os.path.join(out, 'data.json'))) if os.path.exists(os.path.join(out, 'data.json')) else {}
d.update(artnames={str(k): v for k, v in names.items()}, size=m['size'], tile=TS, arts=[a for a in d.get('arts', []) if a.get('r') == 2] + arts, tile0=tile0, nobj=len(m['objects']))
json.dump(d, open(os.path.join(out, 'data.json'), 'w'))
if '--data' in sys.argv: sys.exit(0)
for z, label in ((0, 'ow'), (1, 'ug')):
    img = render.render_level(m, z, out, label, labels=False)
    n = img.width // TS
    for ty in range(n):
        for tx in range(n):
            t = img.crop((tx*TS, ty*TS, (tx+1)*TS, (ty+1)*TS))
            t.save(os.path.join(out, '%s_%d_%d.webp' % (label, tx, ty)), quality=82, method=4)
    img.resize((1008, 1008), render.Image.LANCZOS).save(os.path.join(out, '%s_mini.webp' % label), quality=80)
