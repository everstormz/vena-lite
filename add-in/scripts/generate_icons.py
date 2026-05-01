"""Generate solid-color placeholder PNGs for the Office add-in manifest.

Pure-stdlib (no Pillow). Vena-lite blue, 16/32/64/80/128. Office accepts these
for sideloaded development; replace before publishing to AppSource.
"""
from __future__ import annotations

import struct
import sys
import zlib
from pathlib import Path

_VENA_BLUE = (37, 99, 235)


def _chunk(typ: bytes, data: bytes) -> bytes:
    return struct.pack(">I", len(data)) + typ + data + struct.pack(">I", zlib.crc32(typ + data))


def write_solid_png(path: Path, size: int, rgb: tuple[int, int, int]) -> None:
    sig = b"\x89PNG\r\n\x1a\n"
    ihdr = _chunk(b"IHDR", struct.pack(">IIBBBBB", size, size, 8, 2, 0, 0, 0))
    row = b"\x00" + bytes(rgb) * size  # filter byte 0 + RGB row
    raw = row * size
    idat = _chunk(b"IDAT", zlib.compress(raw))
    iend = _chunk(b"IEND", b"")
    path.write_bytes(sig + ihdr + idat + iend)


def main() -> int:
    public = Path(__file__).resolve().parents[1] / "public"
    public.mkdir(parents=True, exist_ok=True)
    for size in (16, 32, 64, 80, 128):
        out = public / f"icon-{size}.png"
        write_solid_png(out, size, _VENA_BLUE)
        print(f"wrote {out}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
