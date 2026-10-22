import struct
import numpy as np

def parse_def(d):
    typ, w, h, nblocks = struct.unpack_from('<IIII', d, 0)
    pal = np.frombuffer(d[16:16+768], dtype=np.uint8).reshape(256, 3)
    p = 16 + 768
    frames = []  # list of (offset) in block order
    for _ in range(nblocks):
        bid, n, _, _ = struct.unpack_from('<IIII', d, p); p += 16
        names = [d[p+13*i:p+13*i+13].split(b'\0')[0].decode('latin1') for i in range(n)]; p += 13*n
        offs = struct.unpack_from('<%dI' % n, d, p); p += 4*n
        frames.append(list(zip(names, offs)))
    return typ, w, h, pal, frames

def decode_frame(d, off):
    size, fmt, fw, fh, w, h, lm, tm = struct.unpack_from('<IIIIIIii', d, off)
    p = off + 32
    img = np.zeros((h, w), dtype=np.uint8)
    if fmt == 0:
        img[:] = np.frombuffer(d[p:p+w*h], dtype=np.uint8).reshape(h, w)
    elif fmt == 1:
        offs = struct.unpack_from('<%dI' % h, d, p)
        for y in range(h):
            q = p + offs[y]; x = 0
            while x < w:
                code = d[q]; ln = d[q+1] + 1; q += 2
                if code == 0xff:
                    img[y, x:x+ln] = np.frombuffer(d[q:q+ln], dtype=np.uint8); q += ln
                else:
                    img[y, x:x+ln] = code
                x += ln
    elif fmt in (2, 3):
        if fmt == 2:
            offs = [struct.unpack_from('<H', d, p)[0]]
            q0 = p + offs[0]
            rows = [(y, q0) for y in range(h)]
            # format 2: single offset, rows sequential
            q = q0
            for y in range(h):
                x = 0
                while x < w:
                    b = d[q]; q += 1; code = b >> 5; ln = (b & 31) + 1
                    if code == 7:
                        img[y, x:x+ln] = np.frombuffer(d[q:q+ln], dtype=np.uint8); q += ln
                    else:
                        img[y, x:x+ln] = code
                    x += ln
        else:
            nseg = w // 32
            for y in range(h):
                for s in range(nseg):
                    o = struct.unpack_from('<H', d, p + 2*(y*nseg + s))[0]
                    q = p + o; x = s*32; end = x + 32
                    while x < end:
                        b = d[q]; q += 1; code = b >> 5; ln = (b & 31) + 1
                        if code == 7:
                            img[y, x:x+ln] = np.frombuffer(d[q:q+ln], dtype=np.uint8); q += ln
                        else:
                            img[y, x:x+ln] = code
                        x += ln
    else:
        raise ValueError(fmt)
    return img, fw, fh, lm, tm

def frame_rgba(d, pal, off, shadow=True):
    img, fw, fh, lm, tm = decode_frame(d, off)
    full = np.zeros((fh, fw, 4), dtype=np.uint8)
    h, w = img.shape
    rgb = pal[img]
    a = np.full((h, w), 255, dtype=np.uint8)
    a[img == 0] = 0
    a[img == 1] = 64 if shadow else 0   # shadow
    a[img == 4] = 128 if shadow else 0
    a[img == 5] = 0  # player color/flag key, filled later
    a[(img == 2) | (img == 3) | (img == 6) | (img == 7)] = 0  # hmm: 2,3 unused;6,7 selection
    rgb = rgb.copy()
    rgb[(img == 1) | (img == 4)] = 0
    full[tm:tm+h, lm:lm+w, :3] = rgb
    full[tm:tm+h, lm:lm+w, 3] = a
    return full
