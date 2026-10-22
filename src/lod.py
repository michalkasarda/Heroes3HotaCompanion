import struct, zlib, os
G='/home/michal-work/.var/app/com.usebottles.bottles/data/bottles/bottles/Heroes3/drive_c/Heroes3Complete/Data'
class Lod:
    def __init__(self, path):
        self.f = open(path, 'rb')
        d = self.f.read(92)
        n = struct.unpack_from('<I', d, 8)[0]
        self.entries = {}
        for i in range(n):
            e = self.f.read(32)
            name = e[:16].split(b'\0')[0].decode('latin1').lower()
            off, size, typ, csize = struct.unpack_from('<IIII', e, 16)
            self.entries[name] = (off, size, csize)
    def get(self, name):
        off, size, csize = self.entries[name.lower()]
        self.f.seek(off)
        if csize:
            return zlib.decompress(self.f.read(csize))
        return self.f.read(size)
class Lods:
    def __init__(self, names=('HotA.lod','H3ab_spr.lod','H3sprite.lod','HotA_lng.lod','H3ab_bmp.lod','H3bitmap.lod')):
        self.lods = [Lod(os.path.join(G, n)) for n in names]
    def get(self, name):
        for l in self.lods:
            if name.lower() in l.entries:
                return l.get(name)
        raise KeyError(name)
    def has(self, name):
        return any(name.lower() in l.entries for l in self.lods)
