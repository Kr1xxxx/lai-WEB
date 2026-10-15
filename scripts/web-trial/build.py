#!/usr/bin/env python3
"""Build the web trial page from the repository alone (no published page needed).

The page is the app's single HTML page (scripts/build.py assemble_html) with the browser-only
pieces added: the localStorage data stand-in, the demo mailbox, the demo data and the 测试数据
panel; the three vendored scripts are inlined because a published page has no /vendor/ path.

Usage:

    python3 -I scripts/web-trial/build.py --out lai-web.html

Placement (same order the older published page used): vendored scripts where the template loads
them; data-shim.js, mail-demo.js, demo-seed.js, data-panel.js together right before the app's own
script (the last <script>), so they run before the app reads its data.

The page shows its own version (v1.01) in the top-left corner, in the version chip next to the logo (in place of the app's 1.4.x), read from scripts/web-trial/version.json. Every
update adds 0.01: run with --bump to do that, then build, and say the version when you report.

--publish writes the form the Artifact tool wants: the publisher adds its own <!doctype>, <html>, <head> and
<body>, so those (and the charset/viewport metas it also adds) are removed and the title becomes 来财Lai.

Differences from the page rebuilt by rebuild.py from an older published page: the outer scroll
container (100vw -> var(--lai-w), 1100px floor) is not applied, the page uses the browser width.
The script stops instead of guessing when a template marker or vendored file is missing.
"""
import argparse
import importlib.util
import json
import os
import re
import sys

REPO = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
VENDOR = [
    ('<script src="/vendor/xlsx.full.min.js"></script>', 'vendor/sheetjs-0.20.3/xlsx.full.min.js'),
    ('<script src="/vendor/purify.min.js"></script>', 'vendor/dompurify/purify.min.js'),
    ('<script src="/vendor/squire-raw.js"></script>', 'vendor/squire/squire-raw.js'),
]
SHELL_START = '<!doctype html>\n<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>来财Lai · 客户管理</title>'
SHELL_END = '</script></body></html>'
VERSION_FILE = os.path.join(REPO, 'scripts/web-trial/version.json')
EXTRA = ['data-shim.js', 'mail-demo.js', 'demo-seed.js', 'data-panel.js']


def read(path):
    with open(os.path.join(REPO, path), encoding='utf8') as handle:
        return handle.read()


def script(text, name, escape_replacement_char=False):
    # The Artifact tool refuses a page with a literal U+FFFD; the spreadsheet library's code-page tables contain
    # thousands of them, always inside string or regex literals, where \\uFFFD means the same character.
    if escape_replacement_char:
        text = text.replace('\ufffd', '\\uFFFD')
    if '</script' in text.lower():
        sys.exit(f'STOP: {name} contains "</script", it cannot be inlined')
    return '<script>\n' + text.rstrip('\n') + '\n</script>'


def read_version():
    with open(VERSION_FILE, encoding='utf8') as handle:
        version = json.load(handle)['version']
    major, _, minor = version.partition('.')
    if not (major.isdigit() and len(minor) == 2 and minor.isdigit()):
        sys.exit(f'STOP: {VERSION_FILE} must hold a version like "1.01", got {version!r}')
    return version


def next_version(version):
    hundredths = int(version.replace('.', '')) + 1
    return f'{hundredths // 100}.{hundredths % 100:02d}'


def add_version_chip(html, version):
    # The top bar's version chip (next to the logo) shows the trial's own version here instead of the app's
    # 1.4.x; the app version is still in the 关于来财 drawer and in the chip's tooltip.
    old = ('<button type="button" class="app-version" data-action="version-history" aria-haspopup="dialog" '
           'aria-label="当前版本 ${APP_VERSION}，查看版本更新历史">v${APP_VERSION}</button>')
    if html.count(old) != 1:
        sys.exit('STOP: expected the top bar version chip exactly once in the page')
    chip = (f'<button type="button" class="app-version" id="lai-trial-version" data-action="version-history" '
            f'aria-haspopup="dialog" title="网页试用版 {version}（应用版本 ${{APP_VERSION}}）" '
            f'aria-label="网页试用版版本 {version}，查看版本更新历史">v{version}</button>')
    return html.replace(old, chip, 1)


def to_fragment(html):
    if not html.startswith(SHELL_START) or not html.rstrip().endswith(SHELL_END):
        sys.exit('STOP: the page shell is not what --publish expects; update SHELL_START/SHELL_END in build.py')
    html = '<title>来财Lai</title>' + html[len(SHELL_START):].rstrip()[:-len('</body></html>')]
    # <head> is closed after the styles; the body follows. Drop those two tags, keep everything else in order.
    # The vendored scripts contain the same two tags inside strings; only the page's own pair is followed by #app.
    html, count = re.subn(r'</head>\s*<body>(?=<div id="app">)', '\n', html)
    if count != 1:
        sys.exit('STOP: expected one </head><body><div id="app"> in the page')
    return html + '\n'


def assemble():
    spec = importlib.util.spec_from_file_location('lai_build', os.path.join(REPO, 'scripts/build.py'))
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module.assemble_html()


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument('--out', required=True)
    parser.add_argument('--bump', action='store_true', help='add 0.01 to scripts/web-trial/version.json first')
    parser.add_argument('--publish', action='store_true', help='write the fragment form the Artifact tool wraps itself')
    opts = parser.parse_args()
    version = read_version()
    if opts.bump:
        version = next_version(version)
        with open(VERSION_FILE, 'w', encoding='utf8') as handle:
            json.dump({'version': version}, handle)
            handle.write('\n')
    html = add_version_chip(assemble(), version)
    for tag, path in VENDOR:
        if html.count(tag) != 1:
            sys.exit(f'STOP: expected {tag} exactly once in the template')
        html = html.replace(tag, script(read(path), path, True), 1)
    if '/vendor/' in html:
        sys.exit('STOP: the page still refers to /vendor/')
    # The app's own script is the last <script>; the extra scripts go right before it.
    cut = html.rindex('<script>')
    app_start = read('src/app.js')[:200]
    if app_start not in html[cut:]:
        sys.exit('STOP: the last <script> is not src/app.js')
    extra = '\n'.join(script(read('scripts/web-trial/' + name), name) for name in EXTRA) + '\n'
    html = html[:cut] + extra + html[cut:]
    if opts.publish:
        html = to_fragment(html)
    with open(opts.out, 'w', encoding='utf8') as handle:
        handle.write(html)
    print('version', version)
    print('wrote', opts.out, len(html.encode('utf8')), 'bytes')


if __name__ == '__main__':
    main()
