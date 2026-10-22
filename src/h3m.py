import struct, gzip

class R:
    def __init__(self, d):
        self.d = d; self.p = 0
    def u8(self):
        v = self.d[self.p]; self.p += 1; return v
    def i8(self):
        v = struct.unpack_from('<b', self.d, self.p)[0]; self.p += 1; return v
    def u16(self):
        v = struct.unpack_from('<H', self.d, self.p)[0]; self.p += 2; return v
    def i16(self):
        v = struct.unpack_from('<h', self.d, self.p)[0]; self.p += 2; return v
    def u32(self):
        v = struct.unpack_from('<I', self.d, self.p)[0]; self.p += 4; return v
    def i32(self):
        v = struct.unpack_from('<i', self.d, self.p)[0]; self.p += 4; return v
    def bool(self):
        return self.u8() != 0
    def s(self):
        n = self.u32(); v = self.d[self.p:self.p+n].decode('cp1251', 'replace'); self.p += n; return v
    def skip(self, n):
        self.p += n
    def zero(self, n):
        z = self.d[self.p:self.p+n]
        assert z == b'\0'*n, (self.p, z)
        self.p += n
    def int3(self):
        return (self.u8(), self.u8(), self.u8())
    def bytes(self, n):
        v = self.d[self.p:self.p+n]; self.p += n; return v

ART_BYTES_SIZED = None  # sized bitmasks read count inline

def creature_set(r):
    return [(r.u16(), r.u16()) for _ in range(7)]

def msg_guards(r):
    g = None
    if r.bool():
        r.s()
        if r.bool():
            g = creature_set(r)
        r.zero(4)
    return g

def artifact_slot(r):
    return (r.u16(), r.i16())

def hero_artifacts(r):
    if not r.bool():
        return []
    out = [artifact_slot(r) for _ in range(19)]
    n = r.u16()
    out += [artifact_slot(r) for _ in range(n)]
    return [a for a in out if a[0] != 0xffff]

def quest(r, index):
    m = r.u8()
    q = {'m': m}
    if m == 0:
        return q
    if m == 1: q['level'] = r.u32()
    elif m == 2: q['prim'] = [r.u8() for _ in range(4)]
    elif m in (3, 4): q['target'] = r.u32()
    elif m == 5:
        q['arts'] = [artifact_slot(r) for _ in range(r.u8())]
    elif m == 6:
        q['army'] = [(r.u16(), r.u16()) for _ in range(r.u8())]
    elif m == 7: q['res'] = [r.u32() for _ in range(7)]
    elif m == 8: q['hero'] = r.u8()
    elif m == 9: q['player'] = r.u8()
    elif m == 10:
        sub = r.u32(); q['sub'] = sub
        if sub == 0:
            n = r.u32(); r.skip((n + 7) // 8)
        elif sub == 1: q['day'] = r.u32()
        elif sub == 2: r.i32()
        elif sub == 3: r.i32(); r.bool()
        else: raise ValueError(sub)
    else:
        raise ValueError(m)
    q['lastday'] = r.i32()
    q['txt'] = (r.s(), r.s(), r.s())
    return q

def seer_quest(r, index):
    q = quest(r, index)
    if q['m'] == 0:
        r.zero(1)
        return q
    r.s()  # timeout message (HOTA10)
    t = r.u8(); q['rt'] = t
    if t == 0: pass
    elif t in (1, 2): r.u32()
    elif t in (3, 4): r.i8()
    elif t == 5: r.u8(); r.u32()
    elif t in (6, 7): r.u8(); r.u8()
    elif t == 8: q['reward_art'] = artifact_slot(r)
    elif t == 9: r.u8()
    elif t == 10: r.u16(); r.u16()
    else: raise ValueError(t)
    return q

def box_content(r):
    g = msg_guards(r)
    r.u32(); r.i32(); r.i8(); r.i8()
    r.skip(28)
    r.skip(4)
    for _ in range(r.u8()): r.u8(); r.u8()
    arts = [artifact_slot(r) for _ in range(r.u8())]
    for _ in range(r.u8()): r.u8()
    for _ in range(r.u8()): r.u16(); r.u16()
    r.zero(8)
    return {'arts': arts, 'guards': g}

def box_hota(r):
    r.i32(); r.i32()
    r.i32()
    if r.bool():
        r.i32(); r.bool()

def reward_block(r):
    r.i32(); r.i32(); r.i32(); r.i8(); r.i32(); r.i8()

def event_common(r):
    r.s(); r.s(); r.skip(28); r.u8(); r.bool(); r.bool(); r.u16(); r.u16(); r.zero(16)
    r.i32()
    if r.bool():
        r.i32(); r.bool()

def read_hero(r):
    info = {}
    info['qid'] = r.u32(); info['owner'] = r.u8(); info['hero'] = r.u8()
    if r.bool(): info['name'] = r.s()
    if r.bool(): r.u32()
    if r.bool(): r.u8()
    if r.bool():
        for _ in range(r.u32()): r.u8(); r.u8()
    if r.bool(): info['army'] = creature_set(r)
    r.i8()
    info['arts'] = hero_artifacts(r)
    r.u8()
    if r.bool(): r.s()
    r.i8()
    if r.bool(): r.skip(9)
    if r.bool(): r.skip(4)
    r.zero(16)
    r.bool(); r.bool(); r.i32()
    return info

def read_town(r):
    info = {}
    r.u32(); info['owner'] = r.u8()
    if r.bool(): info['name'] = r.s()
    if r.bool(): info['army'] = creature_set(r)
    r.i8()
    if r.bool(): r.skip(12)
    else: r.bool()
    r.skip(9); r.skip(9)
    r.bool()
    n = r.u32(); r.skip(n)
    for _ in range(r.u32()):
        event_common(r)
        r.i32(); r.i32(); r.i32(); r.i16()
        r.bool()
        r.skip(6)
        r.skip(14)
        r.zero(4)
    r.u8()
    r.zero(3)
    return info

MONSTERS = {54, 71, 72, 73, 74, 75, 162, 163, 164}
BANKS = {16, 24, 25, 84, 85}

def read_object(r, oid, sub):
    info = {}
    if oid == 26:
        info = box_content(r); r.u8(); r.bool(); r.bool(); r.zero(4); r.bool(); box_hota(r)
    elif oid in (34, 70, 62):
        info = read_hero(r)
    elif oid in MONSTERS:
        info['qid'] = r.u32(); info['count'] = r.u16(); r.i8()
        if r.bool(): r.s(); r.skip(28); info['art'] = r.u16()
        r.bool(); r.bool(); r.zero(2)
        r.i32(); r.bool(); r.i32(); r.i32(); r.i32()
        r.bool(); r.i32()
    elif oid in (59, 91):
        r.s(); r.zero(4)
    elif oid == 83:
        n = r.u32()
        info['quests'] = [seer_quest(r, i) for i in range(n)]
        info['repeat'] = [seer_quest(r, n + i) for i in range(r.u32())]
        info['seername'] = r.s() if r.bool() else ''
        r.zero(2)
    elif oid == 113:
        info['skills'] = r.u32()
    elif oid == 81:
        info['bonus'] = (r.i8(), r.u8()); r.zero(6)
    elif oid in (33, 219):
        info['owner'] = r.u32(); info['army'] = creature_set(r); r.bool(); r.zero(8)
    elif oid in (5, 65, 66, 67, 68, 69):
        msg_guards(r); info['pickup'] = (r.u32(), r.u8())
    elif oid == 93:
        msg_guards(r); info['spell'] = r.i32()
    elif oid in (76, 79):
        msg_guards(r); r.u32(); r.zero(4)
    elif oid in (77, 98):
        info = read_town(r)
    elif oid in (53, 220):
        if sub < 7: info['owner'] = r.u32()
        else:
            r.skip(4)
            if r.bool(): r.u32(); r.i32(); r.i32()
            else: r.skip(12)
    elif oid in (17, 18, 19, 20):
        info['owner'] = r.u32()
    elif oid in (88, 89, 90):
        info['spell'] = r.i32()
    elif oid == 6:
        info = box_content(r); r.zero(1); box_hota(r)
    elif oid == 36:
        if sub < 1000: r.i32()
    elif oid in (216, 217, 218):
        info['owner'] = r.u32()
        if oid in (216, 217):
            if r.u32() == 0: r.skip(2)
        if oid in (216, 218):
            r.u8(); r.u8()
    elif oid == 215 or (oid == 212 and sub == 1000):
        info['quest'] = quest(r, 0); r.s()
    elif oid in (87, 42):
        info['owner'] = r.u32()
    elif oid == 214:
        r.u8()
        if r.u8() == 0xff: r.u8()
        r.bool()
        for _ in range(7): r.i32(); r.u32()
        for _ in range(r.i32()): artifact_slot(r)
    elif oid in BANKS:
        r.i32(); r.i8()
        info['arts'] = [r.i32() for _ in range(r.u32())]
    elif oid == 63:
        r.i32(); r.i32()
    elif oid in (101, 22, 108, 86, 82):
        info['content'] = r.i32(); info['art'] = r.i32()
    elif oid in (29, 102) or (oid == 145 and sub > 1):
        r.i32(); r.skip(4)
    elif oid in (105,) or (oid == 212 and sub == 1001):
        info['content'] = r.i32(); info['art'] = r.i32(); r.skip(10)
    elif oid in (12, 39) or (oid == 145 and sub in (0, 1)):
        reward_block(r)
    elif oid == 146 and sub == 0:
        info['custom'] = r.i32(); info['skills'] = r.u32()
    elif oid == 144 and sub == 12:
        r.i32(); r.i32(); r.i32(); r.u32()
    elif oid == 7:
        for _ in range(7): artifact_slot(r)
    elif oid == 104:
        info['custom'] = r.i32(); info['skills'] = r.u32()
    return info

def parse(path):
    r = R(gzip.open(path).read())
    assert r.u32() == 0x20
    hv = r.u32(); assert hv == 10, hv
    r.u32(); r.u32(); r.u32()
    r.bool(); r.bool()
    r.u32()
    r.u32(); r.i8()
    r.bool()
    r.bool()
    for _ in range(r.u32()):
        r.s(); r.i32(); r.u8()
    r.bool()
    size = r.i32()
    two = r.bool()
    name = r.s(); desc = r.s()
    r.i8(); r.i8()
    for i in range(8):
        r.bool(); r.bool(); r.i8(); r.skip(1); r.skip(2); r.bool()
        if r.bool():
            r.bool(); r.skip(1); r.int3()
        r.bool()
        if r.u8() != 0xff:
            r.u8(); r.s()
        r.skip(1)
        for _ in range(r.u32()):
            r.u8(); r.s()
    vc = r.i8()
    if vc != -1:
        r.bool(); r.bool()
        if vc == 0: r.u16()
        elif vc == 1: r.u16(); r.i32()
        elif vc == 2: r.i8(); r.i32()
        elif vc == 3: r.int3(); r.i8(); r.i8()
        elif vc == 4: r.int3()
        elif vc in (5, 6, 7): r.int3()
        elif vc in (8, 9): pass
        elif vc == 10: r.u8(); r.int3()
        elif vc == 11: pass
        elif vc == 12: r.u32()
        else: raise ValueError(vc)
    lc = r.i8()
    if lc == 0 or lc == 1: r.int3()
    elif lc == 2: r.u16()
    if r.u8() > 0: r.skip(8)
    n = r.u32(); r.skip((n + 7) // 8)
    for _ in range(r.u32()): r.u8()
    for _ in range(r.u8()):
        r.u8(); r.u8(); r.s(); r.u8()
    r.zero(31)
    r.bool(); r.zero(3)
    n = r.i32(); r.skip((n + 7) // 8)
    r.i32()
    r.skip(8)
    scripts = r.bool()
    assert not scripts, 'HotA event system active - unsupported'
    n = r.u32(); r.skip((n + 7) // 8)
    r.skip(9); r.skip(4)
    for _ in range(r.u32()): r.s(); r.s()
    nh = r.u32()
    for _ in range(nh):
        if not r.bool(): continue
        if r.bool(): r.u32()
        if r.bool():
            for _ in range(r.u32()): r.u8(); r.u8()
        hero_artifacts(r)
        if r.bool(): r.s()
        r.i8()
        if r.bool(): r.skip(9)
        if r.bool(): r.skip(4)
    for _ in range(nh): r.bool(); r.bool(); r.i32()
    levels = 2 if two else 1
    terrain = r.bytes(levels * size * size * 7)
    templates = []
    for _ in range(r.u32()):
        anim = r.s()
        block = r.bytes(6); visit = r.bytes(6)
        r.u16(); r.u16()
        oid = r.u32(); sub = r.u32(); typ = r.u8(); prio = r.u8(); r.skip(16)
        templates.append(dict(anim=anim, block=block, visit=visit, id=oid, sub=sub, type=typ, prio=prio))
    objects = []
    for i in range(r.u32()):
        pos = r.int3()
        ti = r.u32()
        r.zero(5)
        t = templates[ti]
        info = read_object(r, t['id'], t['sub'])
        objects.append(dict(pos=pos, t=t, ti=ti, **info))
    nev = r.u32()
    return dict(size=size, levels=levels, name=name, desc=desc, terrain=terrain, templates=templates, objects=objects, end=r.p, total=len(r.d), events=nev)

if __name__ == '__main__':
    import sys
    m = parse(sys.argv[1])
    print(m['name'], m['size'], m['levels'], len(m['templates']), len(m['objects']), 'events', m['events'], 'pos', m['end'], '/', m['total'])
