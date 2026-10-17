# MiSans subset (one-off, 2026-10-17)

The page embeds every font as base64 (D-021), so font bytes are page bytes. The owner approved a one-time subset of
the MiSans slices on 2026-10-17. The subsetted files are committed; **the build does not subset anything and has no
new dependency.** Inter is not changed (see below).

## What was done

- **Tool:** fontTools 4.67.0 with brotli (for WOFF2), installed in a throwaway virtualenv outside the repo.
- **Script:** `scripts/fonts/subset.py`, a manual one-off. To redo it (e.g. after updating MiSans):

  ```bash
  python3 -m venv /tmp/fontvenv && /tmp/fontvenv/bin/pip install fonttools brotli
  (cd /tmp && npm pack misans@5.0.0 && tar xzf misans-5.0.0.tgz)
  /tmp/fontvenv/bin/python scripts/fonts/subset.py --source /tmp/package/lib/Normal
  ```

  It reads the 56 original slices and their `unicode-range` from `MiSansVF.min.css`, writes the slices to
  `misans/` (same file names) and regenerates the MiSans rules in `fonts.css` with each slice's new range.
  A slice that loses nothing is copied byte for byte with its original range; a slice left with no characters is
  removed (only slice 47).
- **Kept unchanged in every slice:** glyph outlines, advance widths, the `wght` axis (150–700) and its variations,
  every OpenType feature (`aalt fwid hwid ss07 vert vrt2`), every table, and every `name` record (copyright and
  licence notices). Checked glyph by glyph against the originals: 7888 of 7888 identical.
- **Licence:** Xiaomi's MiSans licence (`misans/MiSans-License.txt`) forbids adapting the font or changing how it
  looks (FAQ: "不得单独将 MiSans 字体或其组件进行外观上的更改"); the subset only leaves out characters, the same
  kind of change as the npm package's official slicing. The licence must stay with the files and the app must name
  MiSans (关于来财Lai).

## Character set

Only **Han ideographs** are removed. A slice keeps:

- every non-Han character it had (ASCII, Latin-1 and Latin Extended, Greek, Cyrillic, general punctuation,
  CJK symbols and punctuation, full-width forms, arrows, box drawing, ✓ × → ← ↑ ↓ … · — 、。，：；！（）【】《》“”‘’ ¥ € £…),
  so customer names in other scripts still draw in MiSans;
- the 6763 GB2312 level 1 and 2 hanzi (67 of them were never in the MiSans slices; the system font draws those);
- every Han character in the app's own text and demo data: `src/**/*.js|css|html`, `scripts/web-trial/**/*.js`
  (demo seed, mail demo), `docs/samples/**`. Today all of them are in GB2312.

Result: 7888 code points (was 11093), of which 6696 hanzi (was 9901).
Han characters outside this set (rare names, traditional characters) fall back to the system Chinese font.

`tests/font-coverage.test.cjs` reads the cmap of every shipped WOFF2 file in plain Node (brotli is built into
`node:zlib`) and checks that every character of the app text, the demo data, GB2312 and the common UI symbols is
covered. When new UI text uses a character outside GB2312, that test fails: rerun the script.

## Sizes

| | before | after |
| --- | ---: | ---: |
| MiSans slices (56 → 55 files) | 4,551,884 bytes | 2,901,768 bytes |
| Inter (2 files, unchanged) | 133,324 bytes | 133,324 bytes |
| Fonts as embedded CSS (base64) | about 6.33 MB | 4.10 MB |
| Web trial page (`scripts/web-trial/build.py`) | 9,938,135 bytes | 7,715,580 bytes |

## Inter

Inter (SIL OFL 1.1, no Reserved Font Name) could be subset too, but it is only 133 KB and its Latin Extended
file draws accented customer names (Polish, Turkish, Vietnamese…). Left as shipped by `@fontsource-variable/inter`.

## Per slice

| slice | file | before | after | chars before | chars after |
| --- | --- | ---: | ---: | ---: | ---: |
| 0 | MiSansVF.16240990c6f7f7dd.0.woff2 | 50044 | 50044 | 200 | 200 |
| 1 | MiSansVF.1fa3a293a561985c.1.woff2 | 60192 | 60192 | 200 | 200 |
| 2 | MiSansVF.235af3ebfd0343d5.2.woff2 | 66632 | 66632 | 200 | 200 |
| 3 | MiSansVF.53744263f2939586.3.woff2 | 68912 | 68912 | 200 | 200 |
| 4 | MiSansVF.8ac4bbc96a6db0e2.4.woff2 | 70216 | 70216 | 200 | 200 |
| 5 | MiSansVF.73924789affc3080.5.woff2 | 72452 | 72452 | 200 | 200 |
| 6 | MiSansVF.52728aa7bc854270.6.woff2 | 75708 | 75708 | 200 | 200 |
| 7 | MiSansVF.d77855c75a78e271.7.woff2 | 78316 | 78316 | 200 | 200 |
| 8 | MiSansVF.c06909dbc78c83aa.8.woff2 | 78632 | 78632 | 200 | 200 |
| 9 | MiSansVF.18220753c89aeaa7.9.woff2 | 78568 | 78568 | 200 | 200 |
| 10 | MiSansVF.91d6994ea01c40e1.10.woff2 | 79272 | 79272 | 200 | 200 |
| 11 | MiSansVF.4432f1e8b9c6afb6.11.woff2 | 81852 | 81852 | 200 | 200 |
| 12 | MiSansVF.a597bc0d89a7e9de.12.woff2 | 81580 | 81580 | 200 | 200 |
| 13 | MiSansVF.799303268bd0a8c8.13.woff2 | 81896 | 81896 | 200 | 200 |
| 14 | MiSansVF.353f733c1a9d24dd.14.woff2 | 82708 | 82708 | 200 | 200 |
| 15 | MiSansVF.00d0682c24b9e852.15.woff2 | 82132 | 82132 | 200 | 200 |
| 16 | MiSansVF.c626836af9104d5f.16.woff2 | 81992 | 81420 | 200 | 199 |
| 17 | MiSansVF.7f4670c6ddefc0b7.17.woff2 | 82508 | 82508 | 200 | 200 |
| 18 | MiSansVF.8739e6cdf2007d9e.18.woff2 | 86940 | 85000 | 200 | 197 |
| 19 | MiSansVF.a397ccbbda85fd60.19.woff2 | 89640 | 89008 | 200 | 198 |
| 20 | MiSansVF.cfcb48d0933e0ec5.20.woff2 | 84144 | 83752 | 200 | 199 |
| 21 | MiSansVF.868ff10381a4fff7.21.woff2 | 84864 | 83360 | 200 | 196 |
| 22 | MiSansVF.184e5227db3e935f.22.woff2 | 87060 | 85140 | 200 | 196 |
| 23 | MiSansVF.a068ef4539a6cd96.23.woff2 | 84368 | 82724 | 200 | 196 |
| 24 | MiSansVF.77773797e06e14c0.24.woff2 | 90748 | 84528 | 200 | 187 |
| 25 | MiSansVF.e4ea5bc4c8993992.25.woff2 | 86672 | 80816 | 200 | 188 |
| 26 | MiSansVF.3581642e24f576d7.26.woff2 | 88716 | 83552 | 200 | 190 |
| 27 | MiSansVF.30106979750ad8e7.27.woff2 | 86976 | 79456 | 200 | 183 |
| 28 | MiSansVF.0aa19e2394367e45.28.woff2 | 86864 | 80232 | 200 | 186 |
| 29 | MiSansVF.43a930e968cb0514.29.woff2 | 90640 | 79212 | 200 | 178 |
| 30 | MiSansVF.e2fb4df3666402bd.30.woff2 | 89136 | 72456 | 200 | 166 |
| 31 | MiSansVF.f08d1f83ff0dabdd.31.woff2 | 94472 | 68532 | 200 | 150 |
| 32 | MiSansVF.92c0f158f1d0c43b.32.woff2 | 91936 | 53032 | 200 | 118 |
| 33 | MiSansVF.081b771213563eae.33.woff2 | 96796 | 49612 | 200 | 107 |
| 34 | MiSansVF.c6c390a740763363.34.woff2 | 96604 | 32760 | 200 | 73 |
| 35 | MiSansVF.b8965049ba77d8e5.35.woff2 | 98464 | 27404 | 200 | 58 |
| 36 | MiSansVF.5ebd323d44595044.36.woff2 | 97568 | 21960 | 200 | 46 |
| 37 | MiSansVF.aa995a1ea7837593.37.woff2 | 99848 | 14644 | 200 | 28 |
| 38 | MiSansVF.d6a0497045ed1170.38.woff2 | 101420 | 10488 | 200 | 21 |
| 39 | MiSansVF.71c7e77bac6a2786.39.woff2 | 106032 | 6720 | 200 | 11 |
| 40 | MiSansVF.def9fc53240b0bba.40.woff2 | 102892 | 5592 | 200 | 11 |
| 41 | MiSansVF.182a224825bf167c.41.woff2 | 108944 | 8064 | 200 | 15 |
| 42 | MiSansVF.c4a48795fdedf3a5.42.woff2 | 105624 | 3800 | 200 | 7 |
| 43 | MiSansVF.ef133bbc03cec415.43.woff2 | 106400 | 2424 | 200 | 3 |
| 44 | MiSansVF.a3d4bcfd8dba2e50.44.woff2 | 103428 | 2212 | 200 | 3 |
| 45 | MiSansVF.b666094020110d0a.45.woff2 | 103292 | 4276 | 200 | 8 |
| 46 | MiSansVF.bc2b7bd40e327658.46.woff2 | 104932 | 1468 | 200 | 1 |
| 47 | MiSansVF.00ed8f01da81647e.47.woff2 | 99992 | removed | 200 | 0 |
| 48 | MiSansVF.4f3d21c8b761cd08.48.woff2 | 109828 | 2020 | 200 | 3 |
| 49 | MiSansVF.0915b4d5a6f0ee33.49.woff2 | 71488 | 2940 | 130 | 3 |
| 50 | MiSansVF.3ee7f36171786397.50.woff2 | 50712 | 50712 | 199 | 199 |
| 51 | MiSansVF.4f81f745e2c3159d.51.woff2 | 24800 | 24800 | 200 | 200 |
| 52 | MiSansVF.d525a1349c7ec9e4.52.woff2 | 29224 | 29224 | 200 | 200 |
| 53 | MiSansVF.ca620abda1b076bd.53.woff2 | 22792 | 22792 | 193 | 193 |
| 54 | MiSansVF.517a94fe8dd5692a.54.woff2 | 25596 | 25596 | 200 | 200 |
| 55 | MiSansVF.7d084b054b54abc1.55.woff2 | 8420 | 8420 | 171 | 171 |
| all | 56 -> 55 files | 4551884 | 2901768 | | |
