#!/usr/bin/env python3
"""Rebuild the web trial page from the currently published page.

The published page is the app's single HTML page plus a few blocks that exist only in the
published page (the localStorage data stand-in, the 测试数据 panel, outer scroll styles).
So the page is never built from scratch: take the live page as the base and swap each
src/ block that changed since the commit the live page was built from.

Usage (run from anywhere; -I keeps Python from importing files next to the inputs):

    python3 -I scripts/web-trial/rebuild.py --base LIVE.html --old-ref COMMIT --out NEW.html

  --base     the live page, saved to a file (read it from the published page first, every time:
             another session may have published since you last looked)
  --old-ref  the commit the live page was built from. If unsure, try the tip of
             claude/web-trial-combined and the commits just before it; the script stops
             when the page does not match.
  --out      where to write the rebuilt page
  --insert   NEW.js:BEFORE.js, repeatable. For a script src/ gained since --old-ref: put it in
             its own <script> block right before the block of BEFORE.js. Take the order from
             src/template.html (the file whose marker follows the new one).

The script stops instead of guessing when:
  - a src/ file's old content is not found exactly once in the base page (wrong --old-ref,
    or the page was hand-edited);
  - src/ gained a file since --old-ref and no --insert says where it goes (new stylesheets
    and removed files still have to be handled by hand);
  - scripts/web-trial/mail-demo.js in the page differs from --old-ref.
"""
import argparse
import os
import subprocess
import sys

REPO = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))


def git(*args):
    return subprocess.run(['git', '-C', REPO, *args], capture_output=True, text=True, check=True).stdout


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument('--base', required=True)
    parser.add_argument('--old-ref', required=True)
    parser.add_argument('--out', required=True)
    parser.add_argument('--insert', action='append', default=[], metavar='NEW.js:BEFORE.js')
    opts = parser.parse_args()
    old_ref = git('rev-parse', opts.old_ref).strip()
    src = os.path.join(REPO, 'src')
    css = {f for f in os.listdir(src) if f.endswith('.css')}

    # The published page rewrites 100vw in the stylesheets to var(--lai-w)
    # (outer scroll container with a 1100px floor).
    def pub(name, text):
        return text.replace('100vw', 'var(--lai-w)') if name in css else text

    def old_of(path):
        return git('show', f'{old_ref}:{path}')

    def new_of(path):
        return open(os.path.join(REPO, path), encoding='utf8').read()

    page = open(opts.base, encoding='utf8').read()
    old_files = {p[4:] for p in git('ls-tree', '--name-only', old_ref, 'src/').split()}
    now_files = set(os.listdir(src))
    added = sorted(now_files - old_files)
    removed = sorted(old_files - now_files)
    inserts = [tuple(pair.split(':', 1)) for pair in opts.insert]
    unplaced = [f for f in added if f not in {new for new, _ in inserts}]
    bad = [pair for pair in inserts if pair[0] not in added or not pair[0].endswith('.js') or pair[1] not in old_files]
    if unplaced or removed or bad:
        sys.exit(f'STOP: src/ files added without --insert {unplaced}, removed {removed}, or unusable --insert {bad} (since {old_ref[:7]}).')

    files = sorted(f for f in old_files if f != 'template.html')
    mismatch = [(f, page.count(pub(f, old_of('src/' + f)))) for f in files if page.count(pub(f, old_of('src/' + f))) != 1]
    if mismatch:
        sys.exit(f'STOP: base page does not match {old_ref[:7]} (file, times found): {mismatch}')

    changed = [f for f in files if old_of('src/' + f) != new_of('src/' + f)]
    for f in changed:
        page = page.replace(pub(f, old_of('src/' + f)), pub(f, new_of('src/' + f)), 1)
    for f in changed:
        if page.count(pub(f, new_of('src/' + f))) != 1:
            sys.exit(f'STOP: new content of {f} is not in the page exactly once after the swap')

    # New scripts go in after the swaps, each right before the block it must precede.
    for new, before in inserts:
        anchor = pub(before, new_of('src/' + before))
        if page.count(anchor) != 1:
            sys.exit(f'STOP: cannot place {new}: {before} is not in the page exactly once')
        at = page.rindex('<script>', 0, page.index(anchor))
        page = page[:at] + '<script>\n' + new_of('src/' + new) + '\n</script>\n' + page[at:]
        changed.append(new + ' (new)')

    demo = 'scripts/web-trial/mail-demo.js'
    old_demo, new_demo = old_of(demo).strip(), new_of(demo).strip()
    if page.count(old_demo) != 1:
        sys.exit(f'STOP: {demo} in the base page differs from {old_ref[:7]}')
    if old_demo != new_demo:
        page = page.replace(old_demo, new_demo, 1)
        changed.append(demo)

    open(opts.out, 'w', encoding='utf8').write(page)
    print('swapped:', changed or 'nothing (page already matches the working tree)')
    print('wrote', opts.out, len(page.encode('utf8')), 'bytes')


if __name__ == '__main__':
    main()
