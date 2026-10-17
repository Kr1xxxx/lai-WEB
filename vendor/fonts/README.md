# Interface fonts

The whole interface uses one font stack (`--font-ui` in `src/ui-tokens.css`):
**Inter** for Latin letters and digits, **MiSans VF** for Chinese, then system fonts as fallback.
`fonts.css` declares the faces; `scripts/build.py` (`font_faces_css()`) replaces each `url(...)` with a
base64 `data:` URI and puts the result in the page, so the Mac app (CSP allows `font-src data:`) and the
published web trial (no external files allowed) work the same way, fully offline.
Each face has a `unicode-range`, so the browser only decodes the slices a page actually shows.

| Font | Files | Source | License |
| --- | --- | --- | --- |
| Inter 4 (variable, weight 100–900) | `inter/inter-latin-wght-normal.woff2`, `inter/inter-latin-ext-wght-normal.woff2` | npm `@fontsource-variable/inter@5.3.0` | SIL Open Font License 1.1 (`inter/LICENSE`) |
| MiSans VF 4.009 (variable, weight 150–700) | `misans/MiSansVF.*.woff2` (Xiaomi's official slicing, subset to GB2312 + the app's text: 55 slices, see `SUBSET.md`) | npm `misans@5.0.0` (dsrkafuu/misans, `lib/Normal/MiSansVF.min.css`) | Xiaomi MiSans license (`misans/MiSans-License.txt`), see below |

**MiSans license.** Xiaomi's MiSans is free for commercial use on any platform
(https://hyperos.mi.com/font/zh/faq). Embedding it in software is allowed **provided the software states that
it uses MiSans**; the app does so in 关于来财Lai (`data-action="about"` in `src/app.js`). Do not change the
glyph shapes, and keep `misans/MiSans-License.txt` with the files (clause 2(4)). The npm packaging (slicing into WOFF2) is Apache-2.0 (`misans/PACKAGING-LICENSE-Apache-2.0`).

**Why Inter for Latin.** Mature, open (OFL), designed for screen UI at 12–16px, has tabular figures
(`font-variant-numeric: tabular-nums` is used across tables and amounts), and its x-height matches MiSans
closely, so mixed Chinese/English lines look even.

Curly quotes, the em dash and the ellipsis (U+2014, U+2018–2019, U+201C–201D, U+2026) are left out of
Inter's range so Chinese text gets MiSans's full-width forms.

**Updating.** Inter: `npm pack @fontsource-variable/inter` and copy the two files. MiSans: `npm pack misans`, then run
`scripts/fonts/subset.py --source <package>/lib/Normal` (needs fontTools outside the repo, see `SUBSET.md`); it writes
the slices and the MiSans `@font-face` rules. `tests/font-coverage.test.cjs` fails when the app uses a character the
embedded fonts lack.
