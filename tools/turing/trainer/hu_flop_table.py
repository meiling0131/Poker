"""The bot's flop table (flop.bkt) from a bucket file.

  python3 hu_flop_table.py --buckets cuda3/data/buckets2.bin --out ../bot/data3/flop.bkt

Version 1 bucket files give "HUFB" + the table; version 2 give "HUF2" + the abstraction exactly as the bucket file
stores it (strength bins, potential bins, buckets, then the flop / turn / river edges) + the table, so the bot can
check that the table belongs to its blueprints.
"""
import argparse
import os
import struct

NF = 22100 * 1326


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--buckets', required=True)
    ap.add_argument('--out', required=True)
    a = ap.parse_args()
    with open(a.buckets, 'rb') as f:
        assert f.read(4) == b'PBKT', 'not a bucket file'
        ver, = struct.unpack('<i', f.read(4))
        if ver == 1:
            f.read(17 * 8)
            head = b'HUFB'
        else:
            dims = f.read(12)
            ne, npb, nb = struct.unpack('<3i', dims)
            edges = f.read(8 * ((ne - 1) * 2 + ne * (npb - 1) * 2 + nb - 1))
            head = b'HUF2' + dims + edges
        table = f.read(NF)
    assert len(table) == NF
    os.makedirs(os.path.dirname(os.path.abspath(a.out)), exist_ok=True)
    with open(a.out + '.tmp', 'wb') as f:
        f.write(head)
        f.write(table)
    os.replace(a.out + '.tmp', a.out)
    print(f'{a.out}: version {ver}, {os.path.getsize(a.out) / 1e6:.1f} MB')


if __name__ == '__main__':
    main()
