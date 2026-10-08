#!/usr/bin/env python3
"""Build a standalone empty-data macOS bundle without TOS or private seeds."""
from pathlib import Path
import argparse
import datetime
import hashlib
import json
import os
import plistlib
import shutil
import subprocess
import tempfile

ROOT = Path(__file__).resolve().parent.parent
APP = ROOT / 'dist/来财Lai.app'

def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()

def run(args):
    result = subprocess.run(args, check=True, capture_output=True, text=True)
    if result.stdout.strip():
        print(result.stdout.strip())
    return result

def assemble_html():
    html = (ROOT / 'src/template.html').read_text()
    for marker, filename, tag in [('<!--UI_TOKENS-->','ui-tokens.css','style'),('<!--PREVIEW_STYLE-->','styles.css','style'),('<!--PREVIEW_MODEL-->','model.js','script'),('<!--PREVIEW_SEGMENTS-->','segments.js','script'),('<!--LAI_MODULES-->','modules.js','script'),('<!--CUSTOMER_TOOLS-->','customer-tools.js','script'),('<!--LAI_BUSINESS_MODEL-->','business-model.js','script'),('<!--TEAM_MODEL-->','team-model.js','script'),('<!--TEAM_UI-->','team-ui.js','script'),('<!--OPP_MODEL-->','opportunity-model.js','script'),('<!--OPP_UI-->','opportunity-ui.js','script'),('<!--WORKBENCH-->','workbench.js','script'),('<!--SETTINGS_HUB-->','settings-hub.js','script'),('<!--ORDERS_PAGE-->','orders-page.js','script'),('<!--LAI_BUSINESS_UI-->','business-ui.js','script'),('<!--CUSTOMER_REPLICA_STYLE-->','customer-replica.css','style'),('<!--CUSTOMER_DETAIL_STYLE-->','customer-detail.css','style'),('<!--CUSTOMER_EDITOR_STYLE-->','customer-editor.css','style'),('<!--BUSINESS_STYLE-->','business.css','style'),('<!--MAIL_STYLE-->','mail.css','style'),('<!--SKIN_GLASS-->','skin-glass.css','style'),('<!--LAI_MAIL_EDITOR-->','mail-editor.js','script'),('<!--LAI_MAIL_UI-->','mail-ui.js','script'),('<!--CUSTOMER_FIELDS-->','customer-fields.js','script'),('<!--CUSTOMER_LIST-->','customer-list-ui.js','script'),('<!--CUSTOMER_DETAIL-->','customer-detail-ui.js','script'),('<!--CUSTOMER_EDITOR-->','customer-editor-ui.js','script'),('<!--CUSTOMER_COUNTRY-->','customer-country.js','script'),('<!--CUSTOMER_SELECT_STYLE-->','customer-select.css','style'),('<!--CUSTOMER_SUGGESTIONS_STYLE-->','customer-suggestions.css','style'),('<!--CUSTOMER_SELECT-->','customer-select.js','script'),('<!--CUSTOMER_SUGGESTIONS-->','customer-suggestions.js','script'),('<!--CUSTOMER_IMPORT-->','customer-import.js','script'),('<!--RAIL_MENU-->','rail-menu.js','script'),('<!--NAV_FAVORITES-->','nav-favorites.js','script'),('<!--ACTIVITY_CATEGORY_NAVIGATION-->','activity-category-navigation.js','script'),('<!--CUSTOMER_MOTION-->','customer-motion.js','script'),('<!--UI_TRUNCATION-->','truncation-title.js','script'),('<!--PREVIEW_APP-->','app.js','script')]:
        if html.count(marker) != 1:
            raise RuntimeError('Missing or duplicate template marker: ' + marker)
        html = html.replace(marker, '<' + tag + '>\n' + (ROOT / 'src' / filename).read_text() + '\n</' + tag + '>', 1)
    return html

def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--node-runtime', help='Node 24+ executable to bundle; defaults to LAI_NODE_RUNTIME or node on PATH')
    parser.add_argument('--output', type=Path, default=APP, help='Output app bundle (never an installed application)')
    options = parser.parse_args(argv)
    chosen = options.node_runtime or os.environ.get('LAI_NODE_RUNTIME') or shutil.which('node')
    if not chosen:
        raise RuntimeError('Node 24+ required: provide --node-runtime or LAI_NODE_RUNTIME')
    runtime = Path(chosen).expanduser().resolve()
    if not runtime.is_file() or not os.access(runtime, os.X_OK):
        raise RuntimeError('Node runtime must be an executable file')
    runtime_info = json.loads(run([str(runtime), '-e', "try { require('node:sqlite'); console.log(JSON.stringify({version:process.version,sqlite:true})); } catch { process.exit(1); }"]).stdout)
    if int(runtime_info['version'].lstrip('v').split('.')[0]) < 24 or not runtime_info.get('sqlite'):
        raise RuntimeError('Node 24+ with built-in node:sqlite required')
    app = options.output.expanduser().resolve()
    if app.suffix != '.app' or app == Path('/Applications') or Path('/Applications') in app.parents:
        raise RuntimeError('Build output must be a non-installed .app bundle')
    if app == ROOT or any(ROOT / folder == app or ROOT / folder in app.parents for folder in ['src', 'backend', 'native', 'assets', 'vendor', 'data']):
        raise RuntimeError('Build output must not replace source or data')
    sheetjs = ROOT / 'vendor/sheetjs-0.20.3/xlsx.full.min.js'
    if hashlib.md5(sheetjs.read_bytes()).hexdigest() != '6b3130af1ceadf07caa0ec08af7addff':
        raise RuntimeError('SheetJS vendor checksum mismatch')
    icon = ROOT / 'assets/AppIcon.icns'
    if not icon.is_file():
        raise RuntimeError('assets/AppIcon.icns required')
    version = json.loads((ROOT / 'package.json').read_text())['version']
    html = assemble_html()
    native = str(ROOT / 'native')
    run(['/usr/bin/swift', 'run', '--package-path', native, 'LaiCoreTests'])
    run(['/usr/bin/swift', 'run', '--package-path', native, 'LaiInstanceTests'])
    run(['/usr/bin/swift', 'build', '--package-path', native, '-c', 'release', '--product', 'Lai'])
    binary_directory = Path(run(['/usr/bin/swift', 'build', '--package-path', native, '-c', 'release', '--show-bin-path']).stdout.strip())
    app.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix='.lai-build-', dir=app.parent) as temporary:
        staging = Path(temporary) / 'Lai.app'
        resources = staging / 'Contents/Resources'
        macos = staging / 'Contents/MacOS'
        resources.mkdir(parents=True)
        macos.mkdir()
        shutil.copy2(binary_directory / 'Lai', macos / 'Lai')
        shutil.copy2(runtime, resources / 'node-runtime')
        shutil.copy2(icon, resources / 'AppIcon.icns')
        for filename in ['server.js', 'storage.js', 'storage-path.js', 'auth.js', 'errors.js', 'mail-account.js', 'mail-imap.js', 'mail-client.js', 'mail-smtp.js', 'mail-mime.js', 'mail-service.js', 'mail-libs.js']:
            shutil.copy2(ROOT / 'backend' / filename, resources / filename)
        vendor = resources / 'vendor'
        vendor.mkdir()
        shutil.copy2(sheetjs, vendor / 'xlsx.full.min.js')
        shutil.copy2(sheetjs.parent / 'LICENSE', vendor / 'LICENSE')
        # 邮件用到的第三方库：收发与解析的打包文件、富文本编辑器、HTML 净化库，连同各自的许可证。
        for source, name in [('vendor/mail-libs/mail-libs.cjs', 'mail-libs.cjs'), ('vendor/mail-libs/LICENSES.txt', 'mail-libs-LICENSES.txt'),
                             ('vendor/squire/squire-raw.js', 'squire-raw.js'), ('vendor/squire/LICENSE', 'squire-LICENSE'),
                             ('vendor/dompurify/purify.min.js', 'purify.min.js'), ('vendor/dompurify/LICENSE', 'dompurify-LICENSE')]:
            shutil.copy2(ROOT / source, vendor / name)
        (resources / 'trade-order-system.html').write_text(html)
        # No seed resource: storage starts empty only when its own database is absent.
        info = {'CFBundleDevelopmentRegion':'zh_CN', 'CFBundleDisplayName':'来财Lai', 'CFBundleExecutable':'Lai', 'CFBundleIconFile':'AppIcon', 'CFBundleIdentifier':'com.local.laicai.lai', 'CFBundleInfoDictionaryVersion':'6.0', 'CFBundleName':'来财Lai', 'CFBundlePackageType':'APPL', 'CFBundleShortVersionString':version, 'CFBundleVersion':'356', 'LSMinimumSystemVersion':'13.5', 'NSHighResolutionCapable':True}
        (staging / 'Contents/Info.plist').write_bytes(plistlib.dumps(info))
        run(['/usr/bin/codesign', '--force', '--deep', '--sign', '-', str(staging)])
        run(['/usr/bin/codesign', '--verify', '--deep', '--strict', str(staging)])
        previous = Path(temporary) / 'previous.app'
        if app.exists():
            app.rename(previous)
        try:
            staging.rename(app)
        except Exception:
            if previous.exists():
                previous.rename(app)
            raise
    metadata = {'builtAt':datetime.datetime.now(datetime.timezone.utc).isoformat(), 'version':version, 'build':'356', 'standalone':True, 'seedIncluded':False, 'tosAccessed':False, 'newlyCompiledNative':True, 'signatureVerified':True, 'nodeVersion':runtime_info['version'], 'runtimeSha256':digest(app / 'Contents/Resources/node-runtime'), 'nativeSha256':digest(app / 'Contents/MacOS/Lai'), 'htmlSha256':digest(app / 'Contents/Resources/trade-order-system.html')}
    (app.parent / 'build-metadata.json').write_text(json.dumps(metadata, ensure_ascii=False, indent=2))
    print('Built standalone empty-data 来财Lai: ' + str(app))

if __name__ == '__main__':
    main()
