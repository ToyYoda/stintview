"""Dump every live iRacing telemetry variable and watch tyre-related ones.

Run while driving (on track, ideally after a few laps so tyres are warm):
    python tools/live_vars.py [seconds]

Writes tools/live_vars.txt with all variables (name, type, count, unit, description)
and prints which tyre/temperature/pressure variables actually change while driving.
Used to find out whether iRacing exposes live tyre surface temperatures or pressures
(e.g. from car dashboards) under names other than LFtempL/LFpressure.
"""
import os, re, struct, sys, time

sys.path.insert(0, os.path.dirname(__file__))
from live_probe import TYPES, latest_buf, open_live  # noqa: E402

PATTERN = re.compile(r'tire|tyre|temp|press|wear|tpms|^(LF|RF|LR|RR)', re.I)


def var_headers(m, num_vars):
    var_off = struct.unpack_from('<i', m, 28)[0]
    out = []
    for i in range(num_vars):
        o = var_off + i * 144
        typ, off, count = struct.unpack_from('<3i', m, o)
        name = m[o + 16:o + 48].split(b'\0')[0].decode()
        desc = m[o + 48:o + 112].split(b'\0')[0].decode(errors='replace')
        unit = m[o + 112:o + 144].split(b'\0')[0].decode(errors='replace')
        out.append((name, typ, off, count, unit, desc))
    return out


def read_all(m, base, typ, off, count):
    fmt, size = TYPES[typ]
    return [struct.unpack_from('<' + fmt, m, base + off + k * size)[0] for k in range(count)]


def car_name(m):
    """CarScreenName of the player's car from the session YAML."""
    yaml_len, yaml_off = struct.unpack_from('<2i', m, 16)
    yaml = m[yaml_off:yaml_off + yaml_len]
    key = b'CarScreenName: '
    start = yaml.find(key)
    if start < 0:
        return '?'
    start += len(key)
    end = yaml.find(b'\n', start)
    return yaml[start:end].strip().decode(errors='replace')


def main():
    seconds = int(sys.argv[1]) if len(sys.argv) > 1 else 30
    m, num_buf, _ = open_live()
    num_vars = struct.unpack_from('<i', m, 24)[0]
    headers = var_headers(m, num_vars)

    # The shared memory can outlive the sim with a frozen last frame: make sure data is live.
    def tick():
        return max(struct.unpack_from('<i', m, 48 + i * 16)[0] for i in range(num_buf))
    t0 = tick()
    time.sleep(1)
    if tick() == t0:
        sys.exit('Telemetry is frozen (sim not running or not in a session). Start driving, then run again.')

    by_name = {h[0]: h for h in headers}
    base = latest_buf(m, num_buf)
    on_track = read_all(m, base, *by_name['IsOnTrack'][1:4])[0]
    speed = read_all(m, base, *by_name['Speed'][1:4])[0]
    print(f'Car: {car_name(m)}  IsOnTrack={on_track}  Speed={speed * 3.6:.0f} km/h')
    if not on_track:
        print('Warning: you are not in the car – tyre values will not change.')

    dump = os.path.join(os.path.dirname(__file__), 'live_vars.txt')
    with open(dump, 'w', encoding='utf-8') as f:
        for name, typ, off, count, unit, desc in headers:
            f.write(f'{name:32} {TYPES[typ][0]} x{count:<3} {unit:12} {desc}\n')
    print(f'{len(headers)} live variables written to {dump}')

    watched = [h for h in headers if PATTERN.search(h[0]) or PATTERN.search(h[5])]
    print(f'Watching {len(watched)} tyre/temperature/pressure variables for {seconds}s - keep driving...')
    lo, hi = {}, {}
    end = time.time() + seconds
    while time.time() < end:
        base = latest_buf(m, num_buf)
        for name, typ, off, count, unit, desc in watched:
            vals = read_all(m, base, typ, off, count)
            if name not in lo:
                lo[name] = list(vals)
                hi[name] = list(vals)
            for k, v in enumerate(vals):
                if isinstance(v, (int, float)):
                    lo[name][k] = min(lo[name][k], v)
                    hi[name][k] = max(hi[name][k], v)
        time.sleep(0.1)

    print('\nCHANGED while driving (candidates for live tyre data):')
    for name, typ, off, count, unit, desc in watched:
        if any(isinstance(a, (int, float)) and a != b for a, b in zip(lo[name], hi[name])):
            rng = ', '.join(f'{a:.2f}..{b:.2f}' for a, b in zip(lo[name][:4], hi[name][:4]))
            print(f'  {name:28} {unit:10} {rng:40} {desc}')
    print('\nUNCHANGED:')
    print('  ' + ', '.join(n for n, *_ in watched if all(a == b for a, b in zip(lo[n], hi[n]))))


if __name__ == '__main__':
    main()
