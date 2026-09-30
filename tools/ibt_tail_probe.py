"""Can we read live tyre surface temps / hot pressures by tailing the .ibt iRacing is writing?

The live shared memory lacks LFtempL/M/R (surface) and LFpressure (hot), but the .ibt
disk telemetry has them at 60 Hz. This probe checks, while you drive:
  1. that the .ibt being written can be opened for reading,
  2. how often iRacing appends to it,
  3. how far the newest record in the file lags behind the live SessionTime.

Usage (iRacing running, you in the car on track):
  python ibt_tail_probe.py [telemetry_dir] [--start]
  --start  switch disk telemetry on via the iRacing SDK (same as Alt+L)
"""
import ctypes, glob, mmap, os, struct, sys, time

TYPES = {0: ('c', 1), 1: ('?', 1), 2: ('i', 4), 3: ('I', 4), 4: ('f', 4), 5: ('d', 8)}
MEM_NAME = 'Local\\IRSDKMemMapFileName'
WATCH = ['LFtempL', 'LFtempM', 'LFtempR', 'LFpressure', 'RRtempM', 'RRpressure']


def live_session_time():
    """SessionTime from the live shared memory, None if iRacing is not running."""
    k32 = ctypes.WinDLL('kernel32', use_last_error=True)
    k32.OpenFileMappingW.restype = ctypes.c_void_p
    h = k32.OpenFileMappingW(0x0004, False, MEM_NAME)
    if not h:
        return None
    k32.CloseHandle(ctypes.c_void_p(h))
    head = mmap.mmap(-1, 112, tagname=MEM_NAME, access=mmap.ACCESS_READ)
    num_vars, var_off, num_buf, buf_len = struct.unpack_from('<4i', head, 24)
    if num_buf <= 0:
        return None
    size = max(struct.unpack_from('<i', head, 52 + i * 16)[0] for i in range(num_buf)) + buf_len
    m = mmap.mmap(-1, size, tagname=MEM_NAME, access=mmap.ACCESS_READ)
    base = max(struct.unpack_from('<2i', m, 48 + i * 16) for i in range(num_buf))[1]
    for i in range(num_vars):
        o = var_off + i * 144
        if m[o + 16:o + 48].split(b'\0')[0] == b'SessionTime':
            typ, off = struct.unpack_from('<2i', m, o)
            return struct.unpack_from('<d', m, base + off)[0]
    return None


def start_disk_telemetry():
    u32 = ctypes.WinDLL('user32')
    msg = u32.RegisterWindowMessageA(b'IRSDK_BROADCASTMSG')
    # irsdk_BroadcastTelemCommand = 10, irsdk_TelemCommand_Start = 1
    u32.SendNotifyMessageA(ctypes.c_void_p(0xFFFF), msg, 10 | (1 << 16), 0)
    print('sent "start telemetry recording" to iRacing')


def read_header(f):
    f.seek(0)
    h = f.read(144)
    (ver, status, tick, si_upd, si_len, si_off, num_vars, var_off, num_buf, buf_len) = struct.unpack_from('<10i', h, 0)
    buf_off = struct.unpack_from('<i', h, 52)[0]
    f.seek(var_off)
    raw = f.read(num_vars * 144)
    vars_ = {}
    for i in range(num_vars):
        o = i * 144
        typ, off, count = struct.unpack_from('<3i', raw, o)
        vars_[raw[o + 16:o + 48].split(b'\0')[0].decode()] = (typ, off)
    return buf_off, buf_len, vars_


def last_record(f, buf_off, buf_len, vars_, names):
    size = os.fstat(f.fileno()).st_size
    n = (size - buf_off) // buf_len
    if n <= 0:
        return 0, None
    f.seek(buf_off + (n - 1) * buf_len)
    rec = f.read(buf_len)
    out = {}
    for name in names:
        if name in vars_:
            typ, off = vars_[name]
            out[name] = struct.unpack_from('<' + TYPES[typ][0], rec, off)[0]
    return n, out


def main():
    args = [a for a in sys.argv[1:] if not a.startswith('--')]
    tel_dir = args[0] if args else os.path.expanduser(r'~\Documents\iRacing\telemetry')
    started = time.time()
    if '--start' in sys.argv:
        start_disk_telemetry()

    print(f'Waiting for a new .ibt in {tel_dir} (created after this probe started) ... Ctrl+C to abort')
    path = None
    while not path:
        files = [p for p in glob.glob(os.path.join(tel_dir, '*.ibt')) if os.path.getctime(p) >= started - 5]
        path = max(files, key=os.path.getctime) if files else None
        if not path:
            time.sleep(1)
    print(f'--- file: {os.path.basename(path)}')

    try:
        f = open(path, 'rb')  # Python opens with FILE_SHARE_READ|WRITE on Windows
    except OSError as e:
        sys.exit(f'CANNOT open the file while iRacing writes it: {e}')
    time.sleep(2)
    buf_off, buf_len, vars_ = read_header(f)
    names = ['SessionTime'] + WATCH
    missing = [n for n in WATCH if n not in vars_]
    print(f'record size {buf_len} B, data starts at {buf_off}; missing in this file: {missing or "none"}')
    print('time      records   file-lag   ' + ' '.join(f'{n:>10}' for n in WATCH))

    last_n = 0
    for _ in range(90):
        n, rec = last_record(f, buf_off, buf_len, vars_, names)
        live = live_session_time()
        lag = f'{live - rec["SessionTime"]:7.2f}s' if rec and live is not None else '      ?'
        grew = f'+{n - last_n}' if n != last_n else '  0'
        last_n = n
        vals = ' '.join(f'{rec[k]:10.1f}' if rec and k in rec else f'{"-":>10}' for k in WATCH)
        print(f'{time.strftime("%H:%M:%S")} {n:8d} {grew:>5} {lag}   {vals}')
        time.sleep(1)


if __name__ == '__main__':
    main()
