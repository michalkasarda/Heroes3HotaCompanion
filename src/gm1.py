import gzip, struct, re, zlib, numpy as np

def gunzip(path):
    d = open(path, 'rb').read()
    return zlib.decompress(d[10:], -15)  # skip gzip header, ignore broken CRC trailer

def tile_walk(raw, E):
    """E: (2*N*N, 7) h3m tile bytes. Returns list of record offsets and parsed per-tile headers/entries."""
    NT = len(E)
    def t6(i): return bytes(E[i, :6])
    for mo in re.finditer(re.escape(t6(0)), raw):
        s = mo.start(); ok = True; offs = []
        for i in range(NT):
            if raw[s:s+6] != t6(i): ok = False; break
            offs.append(s); n = struct.unpack_from('<H', raw, s + 18)[0]; s += 22 + 4 * n
            if i == 500 and not ok: break
        if ok: return offs, s
    raise ValueError('tile array not found')

def parse_tiles(raw, offs):
    heads = np.zeros((len(offs), 5), dtype=np.int64)   # a, cls, sub, idx, f
    present = set(); ents = []
    for i, s in enumerate(offs):
        a, cls, sub, idx, f = struct.unpack_from('<BHHHI', raw, s + 7)
        heads[i] = (a, cls, sub, idx, f)
        n = struct.unpack_from('<I', raw, s + 18)[0]
        e = [struct.unpack_from('<HBB', raw, s + 22 + 4 * k) for k in range(n)]
        ents.append(e)
        for o, _, _ in e: present.add(o)
    return heads, ents, present

def find_fog(raw, NN):
    """u16 per tile, low byte = per-player revealed mask, high byte in {0,1}; 2 levels."""
    a = np.frombuffer(raw, dtype=np.uint8)
    n = 4 * NN
    for s in range(len(raw) - n - 1, 0, -1):
        hi = a[s + 1:s + 2000:2]
        if hi.max() <= 1 and a[s - 1] > 1:
            full_hi = a[s + 1:s + n:2]
            if full_hi.max() <= 1 and len(np.unique(a[s:s + n:2])) > 8:
                v = np.frombuffer(raw[s:s + n], dtype='<u2').reshape(2, int(NN ** 0.5), int(NN ** 0.5))
                return s, (v & 0xff).astype(np.uint8)
    raise ValueError('fog not found')
