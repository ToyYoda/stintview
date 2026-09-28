"""Inspect an iRacing .ibt file: header, variable list, and sampled values."""
import mmap, struct, sys

TYPES = {0: ('c', 1), 1: ('?', 1), 2: ('i', 4), 3: ('I', 4), 4: ('f', 4), 5: ('d', 8)}

def open_ibt(path):
    f = open(path, 'rb')
    m = mmap.mmap(f.fileno(), 0, access=mmap.ACCESS_READ)
    (ver, status, tick_rate, si_update, si_len, si_off, num_vars, var_off,
     num_buf, buf_len) = struct.unpack_from('<10i', m, 0)
    buf_off = struct.unpack_from('<i', m, 52)[0]  # varBuf[0].bufOffset
    start_date, t0, t1, laps, records = struct.unpack_from('<qddii', m, 112)
    vars_ = {}
    for i in range(num_vars):
        o = var_off + i * 144
        typ, off, count = struct.unpack_from('<3i', m, o)
        name = m[o+16:o+48].split(b'\0')[0].decode()
        desc = m[o+48:o+112].split(b'\0')[0].decode(errors='replace')
        unit = m[o+112:o+144].split(b'\0')[0].decode(errors='replace')
        vars_[name] = (typ, off, count, desc, unit)
    si = m[si_off:si_off+si_len].split(b'\0')[0].decode('latin-1')
    return dict(m=m, tick=tick_rate, buf_off=buf_off, buf_len=buf_len,
                records=records, laps=laps, t0=t0, t1=t1, vars=vars_, yaml=si)

def val(ibt, rec, name):
    typ, off, count, *_ = ibt['vars'][name]
    fmt, size = TYPES[typ]
    return struct.unpack_from('<' + fmt, ibt['m'], ibt['buf_off'] + rec * ibt['buf_len'] + off)[0]

if __name__ == '__main__':
    ibt = open_ibt(sys.argv[1])
    print(f"tick={ibt['tick']}Hz records={ibt['records']} laps={ibt['laps']} "
          f"dur={(ibt['t1']-ibt['t0'])/3600:.2f}h vars={len(ibt['vars'])}")
    for n, (t, o, c, d, u) in sorted(ibt['vars'].items()):
        print(f"{n:28} {TYPES[t][0]} x{c:<3} {u:10} {d}")
