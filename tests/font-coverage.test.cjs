// The embedded fonts are a subset (vendor/fonts/SUBSET.md): every character the app shows must still be in them.
// The cmap of each shipped WOFF2 file is read here in plain Node (brotli is built into node:zlib), so the test
// checks the real files and needs nothing installed.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');

const root = path.join(__dirname, '..');
const fontsDir = path.join(root, 'vendor/fonts');

// WOFF2 known-table tags, in the order of the spec (index = flags & 0x3f).
const KNOWN_TAGS = ('cmap,head,hhea,hmtx,maxp,name,OS/2,post,cvt ,fpgm,glyf,loca,prep,CFF ,VORG,EBDT,EBLC,gasp,hdmx,kern,'
  + 'LTSH,PCLT,VDMX,vhea,vmtx,BASE,GDEF,GPOS,GSUB,EBSC,JSTF,MATH,CBDT,CBLC,COLR,CPAL,SVG ,sbix,acnt,avar,bdat,bloc,bsln,'
  + 'cvar,fdsc,feat,fmtx,fvar,gvar,hsty,just,lcar,mort,morx,opbd,prop,trak,Zapf,Silf,Glat,Gloc,Feat,Sill').split(',');

function readBase128(buf, pos) {
  let value = 0;
  for (let i = 0; i < 5; i++) {
    const byte = buf[pos.at++];
    value = value * 128 + (byte & 0x7f);
    if (!(byte & 0x80)) return value;
  }
  throw new Error('bad UIntBase128');
}

// Returns the raw cmap table of a WOFF2 file.
function woff2Cmap(file) {
  const buf = fs.readFileSync(file);
  assert.equal(buf.toString('latin1', 0, 4), 'wOF2', file);
  const numTables = buf.readUInt16BE(12);
  const compressedLength = buf.readUInt32BE(20);
  const pos = { at: 48 };
  let offset = 0, cmap = null;
  for (let i = 0; i < numTables; i++) {
    const flags = buf[pos.at++];
    let tag;
    if ((flags & 0x3f) === 0x3f) { tag = buf.toString('latin1', pos.at, pos.at + 4); pos.at += 4; } else tag = KNOWN_TAGS[flags & 0x3f];
    const origLength = readBase128(buf, pos);
    const version = flags >> 6;
    const transformed = tag === 'glyf' || tag === 'loca' ? version === 0 : version !== 0;
    const length = transformed ? readBase128(buf, pos) : origLength;
    if (tag === 'cmap') cmap = { offset, length };
    offset += length;
  }
  assert.ok(cmap, `${file} has no cmap`);
  const data = zlib.brotliDecompressSync(buf.subarray(pos.at, pos.at + compressedLength));
  return data.subarray(cmap.offset, cmap.offset + cmap.length);
}

// Code points that map to a real glyph (format 4 or 12 subtable from the Unicode encodings).
function cmapCodePoints(cmap) {
  const records = [];
  for (let i = 0, n = cmap.readUInt16BE(2); i < n; i++) {
    const at = 4 + i * 8;
    records.push({ platform: cmap.readUInt16BE(at), encoding: cmap.readUInt16BE(at + 2), offset: cmap.readUInt32BE(at + 4) });
  }
  const unicode = records.filter((r) => r.platform === 0 || (r.platform === 3 && (r.encoding === 1 || r.encoding === 10)));
  const pick = unicode.find((r) => cmap.readUInt16BE(r.offset) === 12) || unicode.find((r) => cmap.readUInt16BE(r.offset) === 4);
  assert.ok(pick, 'no Unicode cmap subtable');
  const t = pick.offset, cps = new Set();
  if (cmap.readUInt16BE(t) === 12) {
    for (let g = 0, n = cmap.readUInt32BE(t + 12); g < n; g++) {
      const at = t + 16 + g * 12, start = cmap.readUInt32BE(at), end = cmap.readUInt32BE(at + 4), glyph = cmap.readUInt32BE(at + 8);
      for (let cp = start; cp <= end; cp++) if (glyph + cp - start) cps.add(cp);
    }
    return cps;
  }
  const segX2 = cmap.readUInt16BE(t + 6);
  const ends = t + 14, starts = ends + segX2 + 2, deltas = starts + segX2, rangeOffsets = deltas + segX2;
  for (let s = 0; s < segX2; s += 2) {
    const end = cmap.readUInt16BE(ends + s), start = cmap.readUInt16BE(starts + s);
    const delta = cmap.readInt16BE(deltas + s), rangeOffset = cmap.readUInt16BE(rangeOffsets + s);
    for (let cp = start; cp <= end && cp !== 0xffff; cp++) {
      let glyph;
      if (rangeOffset === 0) glyph = (cp + delta) & 0xffff;
      else {
        glyph = cmap.readUInt16BE(rangeOffsets + s + rangeOffset + (cp - start) * 2);
        if (glyph) glyph = (glyph + delta) & 0xffff;
      }
      if (glyph) cps.add(cp);
    }
  }
  return cps;
}

function parseRange(text) {
  const ranges = text.split(',').map((part) => {
    const [lo, hi] = part.trim().slice(2).split('-');
    return [parseInt(lo, 16), parseInt(hi || lo, 16)];
  });
  return (cp) => ranges.some(([lo, hi]) => cp >= lo && cp <= hi);
}

// Each face draws a character only if its unicode-range lists it and its file has a glyph for it.
const faces = [...fs.readFileSync(path.join(fontsDir, 'fonts.css'), 'utf8').matchAll(/@font-face\{font-family:"([^"]+)"[^}]*url\('([^']+)'\)[^}]*unicode-range:([^;}]+)/g)]
  .map(([, family, file, range]) => ({ family, file, inRange: parseRange(range), cps: cmapCodePoints(woff2Cmap(path.join(fontsDir, file))) }));
const covered = (cp) => faces.some((face) => face.inRange(cp) && face.cps.has(cp));

// Same text sources as scripts/fonts/subset.py.
function appTextChars() {
  const chars = new Map();
  const walk = (dir, suffixes) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full, suffixes);
      else if (!suffixes || suffixes.includes(path.extname(entry.name))) {
        for (const ch of fs.readFileSync(full, 'utf8')) if (!chars.has(ch)) chars.set(ch, path.relative(root, full));
      }
    }
  };
  walk(path.join(root, 'src'), ['.js', '.css', '.html']);
  walk(path.join(root, 'scripts/web-trial'), ['.js']);
  walk(path.join(root, 'docs/samples'), null);
  return chars;
}

// Characters the app text uses that the original, unsubsetted fonts never had either (checked against the files
// before the subset): emoji, a few symbols and full-width forms. The system fonts draw them. Keep this list exact.
const NEVER_IN_FONTS = new Set([
  // Full-width forms and symbols in neither Inter nor the MiSans slices.
  '／', '？', '＋', '＝', '｜', '⌄', '⚠', '♡', '♥', '⊖', '⋮', '▾', '▸', 'ⓘ', '❤', '❄', '⇅',
  // Emoji and flag letters (color emoji font).
  '💎', '🟢', '🔷', '🟡', '🟤', '🔹', '🇬', '🇧', '👍',
  // The ends of a Han range in a regular expression (src/whatsapp-model.js), never shown; narrow no-break space.
  '\u3400', '\u9fff', '\u202f',
]);
// MiSans VF 4.009 as sliced by npm misans@5.0.0 never had these GB2312 hanzi (they fall back to the system font).
const GB2312_NOT_IN_MISANS = '亍丌丨丿丶刂冂亻勹亠冫冖讠卩阝廴凵厶艹茳莰蒎蔹廾扌撖囗彳犭夂饣忄丬爿氵浈瀵宀辶彐弪屮纟桊牮毪膣灬礻禚碹铘铴疒瘃瘭衤疋耔耠虍簖糸酏豸鲺鼽';
const INVISIBLE = (cp) => cp < 0x20 || cp === 0x7f || (cp >= 0x200b && cp <= 0x200f) || (cp >= 0x2028 && cp <= 0x202e)
  || (cp >= 0x2060 && cp <= 0x206f) || (cp >= 0xfe00 && cp <= 0xfe0f) || cp === 0xfeff || (cp >= 0xe0000 && cp <= 0xe007f);

test('the shipped font files and fonts.css agree', () => {
  assert.equal(faces.filter((f) => f.family === 'Inter').length, 2);
  assert.equal(faces.filter((f) => f.family === 'MiSans VF').length, 55);
  for (const face of faces) {
    const inRange = [...face.cps].filter(face.inRange).length;
    assert.ok(inRange > 0, `${face.file} draws nothing in its unicode-range`);
  }
});

test('every character in the app text and the demo data is in the embedded fonts', () => {
  const missing = [];
  for (const [ch, file] of appTextChars()) {
    const cp = ch.codePointAt(0);
    if (INVISIBLE(cp) || NEVER_IN_FONTS.has(ch) || covered(cp)) continue;
    missing.push(`U+${cp.toString(16).toUpperCase().padStart(4, '0')} ${ch} (${file})`);
  }
  assert.deepEqual(missing, []);
});

test('the listed exceptions are really not in the fonts (keeps the list exact)', () => {
  for (const ch of NEVER_IN_FONTS) assert.ok(!covered(ch.codePointAt(0)), `${ch} is covered now; remove it from the list`);
});

test('all GB2312 hanzi, ASCII, Latin-1 and the common UI symbols are covered', () => {
  const gbk = new TextDecoder('gbk');
  const missing = [];
  for (let b1 = 0xb0; b1 <= 0xf7; b1++) {
    for (let b2 = 0xa1; b2 <= 0xfe; b2++) {
      if (b1 === 0xd7 && b2 > 0xf9) continue; // the end of level 1 is unassigned
      const ch = gbk.decode(Uint8Array.of(b1, b2));
      if (!covered(ch.codePointAt(0))) missing.push(ch);
    }
  }
  assert.deepEqual(missing.join(''), GB2312_NOT_IN_MISANS);
  const symbols = '¥€£✓×→←↑↓…·—、。，：；！（）【】《》“”‘’';
  for (let cp = 0x20; cp <= 0x7e; cp++) assert.ok(covered(cp), `U+${cp.toString(16)}`);
  for (let cp = 0xa1; cp <= 0xff; cp++) if (cp !== 0xad) assert.ok(covered(cp), `U+${cp.toString(16)}`);
  for (const ch of symbols) assert.ok(covered(ch.codePointAt(0)), ch);
});
