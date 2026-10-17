#!/usr/bin/env python3
"""One-off: subset the vendored MiSans VF slices to the Chinese characters the app needs.

This is a MANUAL tool, not part of the build. It needs fontTools and brotli, installed OUTSIDE the repo:

    python3 -m venv /tmp/fontvenv && /tmp/fontvenv/bin/pip install fonttools brotli
    (cd /tmp && npm pack misans@5.0.0 && tar xzf misans-5.0.0.tgz)      # the original, unsubsetted slices
    /tmp/fontvenv/bin/python scripts/fonts/subset.py --source /tmp/package/lib/Normal

It reads the 56 original slices (MiSansVF.*.woff2) and their unicode-ranges (MiSansVF.min.css) from --source,
writes the subsetted slices into vendor/fonts/misans/ and rewrites the MiSans rules in vendor/fonts/fonts.css.
See vendor/fonts/SUBSET.md for what is kept and why. Inter is not touched.

What is removed: only Han ideographs (CJK Unified Ideographs and their extensions / compatibility blocks)
that are neither in GB2312 (levels 1 and 2) nor used anywhere in the app's own text or demo data. Every other
code point MiSans has (Latin, Greek, Cyrillic, punctuation, symbols, box drawing, kana...) is kept, so
customer names in other scripts still render in MiSans. Glyph outlines, the wght axis, all OpenType
features, hinting and all name records (copyright, licence) are kept unchanged.
"""
import argparse
import pathlib
import re
import sys

from fontTools import subset, version as fonttools_version
from fontTools.ttLib import TTFont

ROOT = pathlib.Path(__file__).resolve().parents[2]
OUT_DIR = ROOT / 'vendor/fonts/misans'
FONTS_CSS = ROOT / 'vendor/fonts/fonts.css'

# Han blocks: Ext A, URO, compatibility, and the supplementary-plane extensions.
HAN_BLOCKS = [(0x3400, 0x4DBF), (0x4E00, 0x9FFF), (0xF900, 0xFAFF), (0x20000, 0x3FFFF)]

# Text the app shows: source files and demo data (the coverage test reads the same list).
TEXT_SOURCES = [('src', ('.js', '.css', '.html')), ('scripts/web-trial', ('.js',)), ('docs/samples', None)]


def is_han(cp):
    return any(lo <= cp <= hi for lo, hi in HAN_BLOCKS)


def gb2312_hanzi():
    chars = set()
    for b1 in range(0xB0, 0xF8):           # level 1: B0-D7, level 2: D8-F7
        for b2 in range(0xA1, 0xFF):
            try:
                chars.add(ord(bytes([b1, b2]).decode('gb2312')))
            except UnicodeDecodeError:
                pass
    return chars


def app_text_chars():
    chars = set()
    for folder, suffixes in TEXT_SOURCES:
        for path in sorted((ROOT / folder).rglob('*')):
            if not path.is_file() or (suffixes and path.suffix not in suffixes):
                continue
            try:
                chars |= {ord(c) for c in path.read_text(encoding='utf-8')}
            except UnicodeDecodeError:
                continue
    return chars


def parse_ranges(text):
    cps = set()
    for part in text.split(','):
        lo, _, hi = part.strip()[2:].partition('-')
        cps.update(range(int(lo, 16), int(hi or lo, 16) + 1))
    return cps


def format_ranges(cps):
    cps, out, i = sorted(cps), [], 0
    while i < len(cps):
        j = i
        while j + 1 < len(cps) and cps[j + 1] == cps[j] + 1:
            j += 1
        out.append('U+%x' % cps[i] if i == j else 'U+%x-%x' % (cps[i], cps[j]))
        i = j + 1
    return ','.join(out)


def subset_options():
    options = subset.Options()
    options.flavor = 'woff2'
    options.layout_features = ['*']        # keep every OpenType feature (aalt, fwid, hwid, ss07, vert, vrt2)
    options.name_IDs = ['*']                # keep copyright, licence and every other name record
    options.name_languages = ['*']
    options.name_legacy = True
    options.hinting = True
    options.notdef_outline = True
    options.glyph_names = True
    options.legacy_kern = True
    options.symbol_cmap = True
    options.prune_unicode_ranges = False
    options.drop_tables = []                # keep every table (STAT, vhea/vmtx, gvar...)
    return options


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument('--source', required=True, type=pathlib.Path,
                        help='folder with the original MiSansVF.*.woff2 slices and MiSansVF.min.css (npm misans@5.0.0 lib/Normal)')
    args = parser.parse_args()

    source_css = (args.source / 'MiSansVF.min.css').read_text()
    slices = re.findall(r"url\('(MiSansVF\.[0-9a-f]+\.(\d+)\.woff2)'\) format\('woff2'\);unicode-range:([^;}]+);?\}", source_css)
    if len(slices) != 56:
        sys.exit(f'expected 56 slices in {args.source}/MiSansVF.min.css, found {len(slices)}')

    han_keep = gb2312_hanzi() | {cp for cp in app_text_chars() if is_han(cp)}
    rules, report, kept_total = [], [], set()
    before_total = after_total = 0
    for name, index, ranges in sorted(slices, key=lambda s: int(s[1])):
        src = args.source / name
        cmap = set(TTFont(src).getBestCmap())
        declared = parse_ranges(ranges)
        keep = {cp for cp in cmap & declared if not is_han(cp) or cp in han_keep}
        before = src.stat().st_size
        dest = OUT_DIR / name
        if not keep:
            dest.unlink(missing_ok=True)
            report.append((index, name, before, 0, len(cmap), 0))
            before_total += before
            continue
        if keep == cmap and cmap <= declared:
            # Nothing to remove: ship the original file byte for byte, with its original range.
            dest.write_bytes(src.read_bytes())
            unicode_range = ranges.strip()
        else:
            font = TTFont(src)
            subsetter = subset.Subsetter(subset_options())
            subsetter.populate(unicodes=sorted(keep))
            subsetter.subset(font)
            font.flavor = 'woff2'
            font.save(dest)
            unicode_range = format_ranges(keep)
        after = dest.stat().st_size
        before_total += before
        after_total += after
        kept_total |= keep
        report.append((index, name, before, after, len(cmap), len(keep)))
        rules.append('@font-face{font-family:"MiSans VF";font-style:normal;font-weight:150 700;font-display:swap;'
                     f"src:url('misans/{name}') format('woff2');unicode-range:{unicode_range}}}")

    css = FONTS_CSS.read_text()
    head = [line for line in css.splitlines() if '"MiSans VF"' not in line or not line.startswith('@font-face')]
    FONTS_CSS.write_text('\n'.join(head + rules) + '\n')

    print(f'fontTools {fonttools_version}; Han kept: {len(han_keep)} (GB2312 + app text); code points kept: {len(kept_total)}')
    print('| slice | file | before | after | chars before | chars after |')
    print('| --- | --- | ---: | ---: | ---: | ---: |')
    for index, name, before, after, n_before, n_after in report:
        print(f'| {index} | {name} | {before} | {after or "removed"} | {n_before} | {n_after} |')
    print(f'| all | {len(slices)} -> {len(rules)} files | {before_total} | {after_total} | | |')


if __name__ == '__main__':
    main()
