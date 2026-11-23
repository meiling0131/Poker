"""Pack turing's blueprints for the browser.

  python3 tools/turing/pack.py <folder with bp*.bin> js/turing/blueprints.bin

The output is gzip (the page inflates it, js/turing.js) around "TBP1", the number of blueprints, then each one
(smallest stack first) as its length and bytes: what `load` in web/src/lib.rs reads.
"""
import glob
import gzip
import os
import struct
import sys


def main():
    if len(sys.argv) != 3:
        sys.exit(__doc__)
    src, out = sys.argv[1], sys.argv[2]
    files = sorted(glob.glob(os.path.join(src, 'bp*.bin')), key=lambda p: float(os.path.basename(p)[2:-4]))
    if not files:
        sys.exit(f'no bp*.bin in {src}')
    blob = b'TBP1' + struct.pack('<I', len(files))
    for f in files:
        b = open(f, 'rb').read()
        assert b[:4] == b'HUBP', f'{f} is not a blueprint'
        blob += struct.pack('<I', len(b)) + b
    with open(out + '.tmp', 'wb') as f:
        f.write(gzip.compress(blob, 9, mtime=0))
    os.replace(out + '.tmp', out)
    print(f'{out}: {", ".join(os.path.basename(f) for f in files)}, {len(blob) / 1e6:.2f} MB -> {os.path.getsize(out) / 1e6:.2f} MB')


if __name__ == '__main__':
    main()
