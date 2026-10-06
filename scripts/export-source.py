#!/usr/bin/env python3
"""Export reviewed source only; never read business data or publish remotely."""
import argparse
import hashlib
import json
from pathlib import Path
import re
import shutil
import tempfile

ROOT = Path(__file__).resolve().parents[1]
SINGLE_FILES = ['package.json', '.gitignore', 'README.github.md', 'native/Package.swift', 'assets/AppIcon.icns',
                'vendor/sheetjs-0.20.3/xlsx.full.min.js', 'vendor/sheetjs-0.20.3/LICENSE', 'vendor/sheetjs-0.20.3/README.md',
                'vendor/mail-libs/mail-libs.cjs', 'vendor/mail-libs/LICENSES.txt', 'vendor/mail-libs/README.md',
                'vendor/mail-libs/build/entry.js', 'vendor/mail-libs/build/pino-stub.js', 'vendor/mail-libs/build/socks-stub.js',
                'vendor/squire/squire-raw.js', 'vendor/squire/LICENSE', 'vendor/dompurify/purify.min.js', 'vendor/dompurify/LICENSE',
                'tests/fixtures/cus-list-003-fields.txt', 'tests/fixtures/cus-list-003-fields-provenance.json']
TREES = [('src', {'.js', '.css', '.html'}), ('backend', {'.js'}), ('native/Sources', {'.swift'})]
SECRET_PATTERNS = [re.compile(rb'-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----'),
                   re.compile(rb'gh[pousr]_[A-Za-z0-9]{36,}'),
                   re.compile(rb'github_pat_[A-Za-z0-9_]{40,}'),
                   re.compile(rb'sk-(?:proj-)?[A-Za-z0-9_-]{32,}'),
                   re.compile(rb'AKIA[0-9A-Z]{16}')]


def source_files(root):
    selected = []
    for name in SINGLE_FILES:
        file = root / name
        if file.exists() or file.is_symlink():
            selected.append(file)
        elif not name.startswith('tests/fixtures/'):
            raise ValueError('Required source missing: ' + name)
    for folder, extensions in TREES:
        directory = root / folder
        if directory.is_symlink():
            raise ValueError('Linked source directory refused: ' + folder)
        for file in directory.rglob('*'):
            if file.is_symlink():
                raise ValueError('Linked source refused: ' + str(file.relative_to(root)))
            if file.is_file():
                if file.suffix not in extensions:
                    raise ValueError('Unreviewed source file type: ' + str(file.relative_to(root)))
                selected.append(file)
    selected.extend((root / 'tests').glob('*.test.cjs'))
    selected.extend((root / 'tests').glob('test_*.py'))
    selected.extend((root / 'scripts').glob('*.mjs'))
    selected.extend((root / 'scripts').glob('*.cjs'))
    selected.extend(root / 'scripts' / name for name in ['build.py', 'export-source.py'])
    selected.extend(file for name in ['native-drag-acceptance.py', 'native-drag-acceptance.swift']
                    if (file := root / 'scripts' / name).exists())
    return sorted(set(selected))


def export_source(root, output):
    root = root.resolve()
    output = output.absolute()
    if output.exists() or output.is_symlink():
        raise ValueError('Output already exists; use a new directory')
    destination = output.resolve()
    if destination == root or any(root / folder == destination or root / folder in destination.parents
                                  for folder in ['src', 'backend', 'native', 'scripts', 'tests', 'assets', 'vendor', 'data']):
        raise ValueError('Output must not overlap source or data')
    entries = []
    for file in source_files(root):
        relative = file.relative_to(root)
        for part in [file, *file.parents]:
            if part == root:
                break
            if part.is_symlink():
                raise ValueError('Linked source refused: ' + str(relative))
        if file.stat().st_nlink != 1:
            raise ValueError('Hardlinked source refused: ' + str(relative))
        data = file.read_bytes()
        if any(pattern.search(data) for pattern in SECRET_PATTERNS):
            raise ValueError('Credential pattern found in ' + str(relative) + '; value not displayed')
        if str(relative) == '.gitignore':
            # Only the local historical README is ignored; exported README is sanitized.
            data = b'\n'.join(line for line in data.split(b'\n') if line.strip() != b'README.md')
        entries.append((relative, data))
        if str(relative) == 'README.github.md':
            entries.append((Path('README.md'), data))
    # Complete scan before creating destination; do not leave partial publishable output.
    output.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix='.lai-export-', dir=output.parent) as temporary:
        staging = Path(temporary) / 'source'
        staging.mkdir()
        manifest = {}
        for relative, data in entries:
            target = staging / relative
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(data)
            manifest[str(relative)] = hashlib.sha256(data).hexdigest()
        (staging / 'source-manifest.json').write_text(json.dumps({'format':1, 'businessDataIncluded':False, 'files':manifest}, ensure_ascii=False, indent=2))
        staging.rename(output)
    return manifest


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source', type=Path, default=ROOT)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    try:
        manifest = export_source(args.source, args.output)
    except (ValueError, OSError) as error:
        parser.exit(1, str(error) + '\n')
    print(json.dumps({'exportedFiles':len(manifest), 'businessDataIncluded':False, 'remoteWrites':False}))


if __name__ == '__main__':
    main()
