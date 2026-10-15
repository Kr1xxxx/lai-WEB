"""Test privacy export and portable bundle assembly with synthetic inputs only."""
import contextlib
import importlib.util
import io
import json
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]


def load_build():
    spec = importlib.util.spec_from_file_location('lai_release_build', ROOT / 'scripts/build.py')
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class PortableBuild(unittest.TestCase):
    def fixture(self, directory):
        for folder in ['src', 'backend', 'vendor']:
            shutil.copytree(ROOT / folder, directory / folder)
        (directory / 'assets').mkdir()
        (directory / 'assets/AppIcon.icns').write_bytes(b'SYNTHETIC-ICON')
        shutil.copy2(ROOT / 'package.json', directory / 'package.json')
        (directory / 'native').mkdir()
        (directory / 'compiled').mkdir()
        (directory / 'compiled/Lai').write_bytes(b'SYNTHETIC-NATIVE')
        runtime = directory / 'node'
        runtime.write_bytes(b'SYNTHETIC-NODE')
        runtime.chmod(0o755)
        return runtime

    def test_clean_build_without_tos_baseline_or_business_seed(self):
        with tempfile.TemporaryDirectory(prefix='lai-test-portable-build-') as temp:
            root = Path(temp).resolve()
            runtime = self.fixture(root)
            build = load_build()
            build.ROOT = root
            build.BASELINE = root / 'nonexistent-baseline'
            build.INSTALLED = root / 'nonexistent-TOS.app'
            build.APP = root / 'dist/来财Lai.app'
            commands = []
            def run(args):
                commands.append(args)
                stdout = str(root / 'compiled') if '--show-bin-path' in args else ''
                if args[0] == str(runtime):
                    stdout = json.dumps({'version': 'v24.15.0', 'sqlite': True})
                return subprocess.CompletedProcess(args, 0, stdout=stdout, stderr='')
            failure = None
            with patch.object(build, 'run', run), patch.object(sys, 'argv', ['build.py', '--node-runtime', str(runtime)]):
                try:
                    with contextlib.redirect_stdout(io.StringIO()):
                        build.main()
                except Exception as error:
                    failure = error
            self.assertIsNone(failure, 'Clean empty-data build must not require private TOS/baseline/seed: ' + str(failure))
            resources = root / 'dist/来财Lai.app/Contents/Resources'
            self.assertFalse((resources / 'trade-order-data.json').exists())
            self.assertEqual((resources / 'node-runtime').read_bytes(), b'SYNTHETIC-NODE')
            self.assertIn('来财', (resources / 'trade-order-system.html').read_text())
            self.assertTrue(any('--strict' in args for args in commands))

    def test_compiler_failure_preserves_previous_bundle(self):
        with tempfile.TemporaryDirectory(prefix='lai-test-portable-build-') as temp:
            root = Path(temp).resolve()
            runtime = self.fixture(root)
            app = root / 'dist/来财Lai.app'
            app.mkdir(parents=True)
            (app / 'last-good').write_text('keep')
            build = load_build()
            build.ROOT, build.APP = root, app
            def run(args):
                if args[0] == str(runtime):
                    return subprocess.CompletedProcess(args, 0, stdout=json.dumps({'version':'v24.15.0','sqlite':True}), stderr='')
                raise RuntimeError('SYNTHETIC COMPILER FAILURE')
            with patch.object(build, 'run', run), patch.object(sys, 'argv', ['build.py', '--node-runtime', str(runtime)]):
                with self.assertRaises(RuntimeError):
                    build.main()
            self.assertEqual((app / 'last-good').read_text(), 'keep')


class SourceExport(unittest.TestCase):
    def fixture(self, directory):
        for folder in ['src','backend','native/Sources','tests/fixtures','vendor/sheetjs-0.20.3','vendor/mail-libs/build','vendor/squire','vendor/dompurify','vendor/flatpickr','scripts','assets']:
            (directory / folder).mkdir(parents=True)
        for file, text in {
            'src/app.js':'// synthetic app', 'backend/server.js':'// synthetic server',
            'native/Package.swift':'// synthetic package', 'native/Sources/main.swift':'// synthetic native',
            'tests/model.test.cjs':'// synthetic test', 'scripts/build.py':'# synthetic build',
            'scripts/export-source.py':'# synthetic exporter', '.gitignore':'data/\n',
            'package.json':'{"name":"synthetic","private":true}', 'README.github.md':'# Synthetic source',
            'vendor/sheetjs-0.20.3/LICENSE':'synthetic license',
            'vendor/sheetjs-0.20.3/README.md':'synthetic dependency',
            'vendor/sheetjs-0.20.3/xlsx.full.min.js':'// synthetic vendor',
            'vendor/mail-libs/mail-libs.cjs':'// synthetic mail bundle', 'vendor/mail-libs/LICENSES.txt':'synthetic licenses',
            'vendor/mail-libs/README.md':'synthetic provenance', 'vendor/mail-libs/build/entry.js':'// synthetic entry',
            'vendor/mail-libs/build/pino-stub.js':'// synthetic stub', 'vendor/mail-libs/build/socks-stub.js':'// synthetic stub',
            'vendor/squire/squire-raw.js':'// synthetic editor', 'vendor/squire/LICENSE':'synthetic license',
            'vendor/dompurify/purify.min.js':'// synthetic sanitizer', 'vendor/dompurify/LICENSE':'synthetic license',
            **{'vendor/flatpickr/' + name: '// synthetic date picker' for name in ['flatpickr.min.js','flatpickr.min.css','l10n-zh.js','monthSelect.js','monthSelect.css','LICENSE','README.md']},
        }.items():
            (directory / file).write_text(text)
        (directory / 'assets/AppIcon.icns').write_bytes(b'SYNTHETIC-ICON')
        for folder in ['data','backups','evidence','baseline','dist']:
            (directory / folder).mkdir()
            (directory / folder / 'customer-private.json').write_text('{"customers":{"PRIVATE-CUSTOMER":{}}}')

    def export(self, source, target):
        return subprocess.run([sys.executable, str(ROOT / 'scripts/export-source.py'), '--source', str(source), '--output', str(target)], capture_output=True, text=True)

    def test_allowlist_excludes_business_data_and_internal_evidence(self):
        with tempfile.TemporaryDirectory(prefix='lai-test-source-export-') as temp:
            source, target = Path(temp)/'source', Path(temp)/'export'
            source.mkdir(); self.fixture(source)
            result = self.export(source, target)
            self.assertEqual(result.returncode, 0, 'Export must work: ' + result.stderr)
            self.assertTrue((target/'src/app.js').exists())
            self.assertTrue((target/'README.md').exists())
            self.assertFalse(any((target/folder).exists() for folder in ['data','backups','evidence','baseline','dist']))
            self.assertFalse(any(b'PRIVATE-CUSTOMER' in f.read_bytes() for f in target.rglob('*') if f.is_file()))

    def test_symlink_cannot_smuggle_private_data_into_source(self):
        with tempfile.TemporaryDirectory(prefix='lai-test-source-export-') as temp:
            source, target = Path(temp)/'source', Path(temp)/'export'
            source.mkdir(); self.fixture(source)
            (source/'src/leak.js').symlink_to(source/'data/customer-private.json')
            result = self.export(source, target)
            self.assertNotEqual(result.returncode, 0)
            self.assertFalse(target.exists(), 'Failed scan must not leave a publishable partial export')

    def test_high_confidence_credential_blocks_export_without_printing_value(self):
        with tempfile.TemporaryDirectory(prefix='lai-test-source-export-') as temp:
            source, target = Path(temp)/'source', Path(temp)/'export'
            source.mkdir(); self.fixture(source)
            credential = 'ghp_' + 'A'*36
            (source/'src/leak.js').write_text('const token="'+credential+'";')
            result = self.export(source, target)
            self.assertNotEqual(result.returncode, 0)
            self.assertNotIn(credential, result.stdout + result.stderr)
            self.assertFalse(target.exists())

    def test_existing_export_is_not_overwritten(self):
        with tempfile.TemporaryDirectory(prefix='lai-test-source-export-') as temp:
            source, target = Path(temp)/'source', Path(temp)/'export'
            source.mkdir(); self.fixture(source); target.mkdir()
            (target/'keep.txt').write_text('keep')
            result = self.export(source, target)
            self.assertNotEqual(result.returncode, 0)
            self.assertEqual((target/'keep.txt').read_text(), 'keep')


if __name__ == '__main__':
    unittest.main()


class WebTrialBuild(unittest.TestCase):
    def test_trial_page_is_built_from_the_repository_alone(self):
        spec = importlib.util.spec_from_file_location('lai_web_trial_build', ROOT / 'scripts/web-trial/build.py')
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        with tempfile.TemporaryDirectory() as directory:
            out = Path(directory) / 'lai-web.html'
            with patch.object(sys, 'argv', ['build.py', '--out', str(out)]), contextlib.redirect_stdout(io.StringIO()):
                module.main()
            html = out.read_text(encoding='utf8')
        self.assertNotIn('/vendor/', html)
        positions = [html.index(marker) for marker in ('XLSX', 'root.LaiWebTrial = {', 'LaiWebTrialMailDemo = {', 'LaiWebTrialDemoSeed = {', 'lai-web-panel')]
        self.assertEqual(positions, sorted(positions))
        app_script = html.rindex('<script>')
        self.assertLess(html.index('root.LaiWebTrial = {'), app_script)
        self.assertLess(html.index('lai-web-panel'), app_script)

    def test_publish_form_has_no_page_shell(self):
        spec = importlib.util.spec_from_file_location('lai_web_trial_build2', ROOT / 'scripts/web-trial/build.py')
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        with tempfile.TemporaryDirectory() as directory:
            out = Path(directory) / 'lai-artifact.html'
            with patch.object(sys, 'argv', ['build.py', '--publish', '--out', str(out)]), contextlib.redirect_stdout(io.StringIO()):
                module.main()
            html = out.read_text(encoding='utf8')
        self.assertTrue(html.startswith('<title>来财Lai</title><style>'))
        self.assertFalse(html.lstrip().lower().startswith('<!doctype'))
        self.assertNotIn('</body>', html[-200:])
        self.assertIn('<div id="app">', html)
        self.assertTrue(html.rstrip().endswith('</script>'))

    def test_trial_version_is_shown_and_bumped_by_one_hundredth(self):
        spec = importlib.util.spec_from_file_location('lai_web_trial_build3', ROOT / 'scripts/web-trial/build.py')
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        version = module.read_version()
        self.assertRegex(version, r'^\d+\.\d\d$')
        for before, after in [('1.01', '1.02'), ('1.09', '1.10'), ('1.99', '2.00'), ('2.10', '2.11')]:
            self.assertEqual(module.next_version(before), after)
        with tempfile.TemporaryDirectory() as directory:
            out = Path(directory) / 'lai-web.html'
            with patch.object(sys, 'argv', ['build.py', '--out', str(out)]), contextlib.redirect_stdout(io.StringIO()):
                module.main()
            html = out.read_text(encoding='utf8')
        self.assertEqual(html.count('id="lai-trial-version"'), 1)
        self.assertIn('>v' + version + '</button>', html)
