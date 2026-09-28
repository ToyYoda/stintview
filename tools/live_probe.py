"""Run while iRacing is on track (telemetry logging enabled, Alt+L).

Checks:
  1. Which tyre channels exist in the LIVE shared memory (vs. only in .ibt).
  2. Whether surface temps change live.
  3. How often iRacing flushes the .ibt file currently being written (for tailing it).

Usage: python live_probe.py [telemetry_dir]
"""
import ctypes, glob, mmap, os, struct, sys, time

TYPES = {0: ('c', 1), 1: ('?', 1), 2: ('i', 4), 3: ('I', 4), 4: ('f', 4), 5: ('d', 8)}
TYRE_VARS = [f'{w}{k}' for w in ('LF', 'RF', 'LR', 'RR')
             for k in ('tempL', 'tempM', 'tempR', 'tempCL', 'tempCM', 'tempCR', 'wearL', 'wearM', 'wearR')]


MEM_NAME = 'Local\\IRSDKMemMapFileName'


def mapping_exists():
    # mmap(tagname=...) silently creates an empty mapping if iRacing hasn't made one,
    # so check with OpenFileMappingW first.
    k32 = ctypes.WinDLL('kernel32', use_last_error=True)
    k32.OpenFileMappingW.restype = ctypes.c_void_p
    h = k32.OpenFileMappingW(0x0004, False, MEM_NAME)  # FILE_MAP_READ
    if h:
        k32.CloseHandle(ctypes.c_void_p(h))
    return bool(h)


def wait_for_iracing():
    announced = False
    while True:
        if mapping_exists():
            head = mmap.mmap(-1, 112, tagname=MEM_NAME, access=mmap.ACCESS_READ)
            status = struct.unpack_from('<i', head, 4)[0]
            num_buf = struct.unpack_from('<i', head, 32)[0]
            if status & 1 and num_buf > 0:  # irsdk_stConnected
                return
            state = 'iRacing running, waiting for a session (status not connected)'
        else:
            state = 'iRacing not running (no shared memory)'
        if not announced:
            print(f'{state} ... waiting, Ctrl+C to abort')
            announced = True
        time.sleep(1)


def open_live():
    wait_for_iracing()
    head = mmap.mmap(-1, 112, tagname=MEM_NAME, access=mmap.ACCESS_READ)
    num_vars, var_off, num_buf, buf_len = struct.unpack_from('<4i', head, 24)
    size = max(struct.unpack_from('<i', head, 52 + i * 16)[0] for i in range(num_buf)) + buf_len
    m = mmap.mmap(-1, size, tagname=MEM_NAME, access=mmap.ACCESS_READ)
    vars_ = {}
    for i in range(num_vars):
        o = var_off + i * 144
        typ, off, count = struct.unpack_from('<3i', m, o)
        vars_[m[o + 16:o + 48].split(b'\0')[0].decode()] = (typ, off)
    return m, num_buf, vars_


def latest_buf(m, num_buf):
    bufs = [struct.unpack_from('<2i', m, 48 + i * 16) for i in range(num_buf)]
    return max(bufs)[1]


def read(m, base, vars_, name):
    typ, off = vars_[name]
    return struct.unpack_from('<' + TYPES[typ][0], m, base + off)[0]


def main():
    try:
        m, num_buf, vars_ = open_live()
    except KeyboardInterrupt:
        sys.exit('aborted')

    live = [v for v in TYRE_VARS if v in vars_]
    missing = [v for v in TYRE_VARS if v not in vars_]
    print(f'Live vars total: {len(vars_)}')
    print(f'Tyre vars available live : {live}')
    print(f'Tyre vars NOT live (.ibt only): {missing}\n')

    tel_dir = sys.argv[1] if len(sys.argv) > 1 else os.path.expanduser(r'~\Documents\iRacing\telemetry')

    def newest_ibt():
        # iRacing starts a new file when the car goes on track; names sort by timestamp
        # and mtime lags on files still open for writing, so pick by ctime (creation on Windows).
        files = glob.glob(os.path.join(tel_dir, '*.ibt'))
        return max(files, key=os.path.getctime) if files else None

    watch = [v for v in ('LFtempL', 'LFtempM', 'LFtempCM', 'LFwearM') if v in vars_]
    ibt, last_size, last_growth = None, 0, 0
    print('time     ' + ' '.join(f'{v:>9}' for v in watch) + '   ibt-size   since-last-flush')
    for _ in range(60):
        base = latest_buf(m, num_buf)
        vals = ' '.join(f'{read(m, base, vars_, v):9.2f}' for v in watch)
        flush = ''
        if newest_ibt() != ibt:
            ibt = newest_ibt()
            last_size, last_growth = os.stat(ibt).st_size, time.time()
            print(f'--- watching {os.path.basename(ibt)}')
        if ibt:
            size = os.stat(ibt).st_size
            if size != last_size:
                flush = f'+{(size - last_size) / 1024:.0f} KB after {time.time() - last_growth:.1f}s'
                last_size, last_growth = size, time.time()
            flush = f'{size / 1e6:9.1f}MB  {flush}'
        print(f'{time.strftime("%H:%M:%S")} {vals}   {flush}')
        time.sleep(1)


if __name__ == '__main__':
    main()
