"""Give Atkinson Hyperlegible Next a plain (unslashed) zero.

Izgah sets times, counts and dates in Atkinson Hyperlegible Next, whose zero is slashed and has no
plain alternate (docs/designs/izgah-ui-v4.md §2). This script rebuilds the zero's counter from the
counter of the capital O, scaled into the zero's counter box at every master of the weight axis, and
writes a modified copy of the latin subset. The font is under the SIL OFL 1.1 without a Reserved
Font Name; the copy is renamed so it is never mistaken for the original.

Usage (fontTools and brotli must be importable):

    python3 scripts/fonts/plain-zero.py \
        node_modules/@fontsource-variable/atkinson-hyperlegible-next/files/atkinson-hyperlegible-next-latin-wght-normal.woff2 \
        src/lib/fonts/atkinson-hyperlegible-next-latin-wght-normal.woff2
"""

import sys

from fontTools.ttLib import TTFont
from fontTools.ttLib.tables import ttProgram
from fontTools.ttLib.tables.TupleVariation import TupleVariation

SUFFIX = " Izgah"


def contours(coords, end_pts):
    start = 0
    for end in end_pts:
        yield list(range(start, end + 1))
        start = end + 1


def bbox(points):
    xs = [p[0] for p in points]
    ys = [p[1] for p in points]
    return min(xs), min(ys), max(xs), max(ys)


def full_deltas(font, name):
    """Default coordinates (with phantom points) and complete per-master deltas."""
    glyf = font["glyf"]
    coords, controls = glyf._getCoordinatesAndControls(name, font["hmtx"].metrics)
    n = len(coords)
    end_pts = list(controls.endPts) + [n - 4, n - 3, n - 2, n - 1]
    variations = []
    for tv in font["gvar"].variations[name]:
        tv = TupleVariation(dict(tv.axes), list(tv.coordinates))
        tv.calcInferredDeltas(coords, end_pts)
        variations.append(tv)
    return list(coords), controls, variations


def at_master(coords, tv):
    return [(x + dx, y + dy) for (x, y), (dx, dy) in zip(coords, tv.coordinates)]


def fit(points, src_box, dst_box):
    sx0, sy0, sx1, sy1 = src_box
    dx0, dy0, dx1, dy1 = dst_box
    kx = (dx1 - dx0) / (sx1 - sx0)
    ky = (dy1 - dy0) / (sy1 - sy0)
    return [(dx0 + (x - sx0) * kx, dy0 + (y - sy0) * ky) for x, y in points]


def main(src, dst):
    font = TTFont(src)
    glyf = font["glyf"]
    zero = glyf["zero"]
    if zero.numberOfContours != 3:
        sys.exit(f"expected a slashed zero with 3 contours, found {zero.numberOfContours}")

    z_coords, z_controls, z_vars = full_deltas(font, "zero")
    o_coords, o_controls, o_vars = full_deltas(font, "O")

    z_contours = list(contours(z_coords[:-4], z_controls.endPts))
    outer = max(z_contours, key=lambda c: (lambda b: (b[2] - b[0]) * (b[3] - b[1]))(bbox([z_coords[i] for i in c])))
    halves = [c for c in z_contours if c is not outer]
    o_contours = list(contours(o_coords[:-4], o_controls.endPts))
    o_inner = min(o_contours, key=lambda c: (lambda b: (b[2] - b[0]) * (b[3] - b[1]))(bbox([o_coords[i] for i in c])))

    def counter(coords, o_pts):
        box = bbox([coords[i] for c in halves for i in c])
        inner = [o_pts[i] for i in o_inner]
        return fit(inner, bbox(inner), box)

    default_inner = counter(z_coords, o_coords)
    new_coords = [z_coords[i] for i in outer] + default_inner
    new_flags = [z_controls.flags[i] for i in outer] + [o_controls.flags[i] for i in o_inner]
    new_ends = [len(outer) - 1, len(new_coords) - 1]
    phantom = list(range(len(z_coords) - 4, len(z_coords)))

    new_vars = []
    for z_tv, o_tv in zip(z_vars, o_vars):
        if z_tv.axes != o_tv.axes:
            sys.exit("zero and O use different variation regions")
        z_master = at_master(z_coords, z_tv)
        o_master = at_master(o_coords, o_tv)
        inner = counter(z_master, o_master)
        deltas = [z_tv.coordinates[i] for i in outer]
        deltas += [(round(mx - x), round(my - y)) for (mx, my), (x, y) in zip(inner, default_inner)]
        deltas += [z_tv.coordinates[i] for i in phantom]
        new_vars.append(TupleVariation(dict(z_tv.axes), deltas))

    zero.coordinates = type(zero.coordinates)([(round(x), round(y)) for x, y in new_coords])
    zero.flags = bytearray(new_flags)
    zero.endPtsOfContours = new_ends
    zero.numberOfContours = 2
    zero.program = ttProgram.Program()
    zero.program.fromBytecode(b"")
    zero.recalcBounds(glyf)
    font["gvar"].variations["zero"] = new_vars

    for record in font["name"].names:
        if record.nameID in (1, 3, 4, 16):
            record.string = record.toUnicode() + SUFFIX
        elif record.nameID == 6:
            record.string = record.toUnicode().replace("-", "Izgah-", 1)

    font.flavor = "woff2"
    font.save(dst)


if __name__ == "__main__":
    if len(sys.argv) != 3:
        sys.exit(__doc__)
    main(sys.argv[1], sys.argv[2])
