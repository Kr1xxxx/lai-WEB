#!/usr/bin/env python3
"""Compile the actual native classes plus test-only entry; do not launch business runtime."""
from pathlib import Path
import subprocess,tempfile
root=Path(__file__).resolve().parent.parent
native=root/'native'
subprocess.run(['/usr/bin/swift','build','--package-path',str(native),'--product','LaiCoreTests'],check=True,capture_output=True)
bin_dir=Path(subprocess.run(['/usr/bin/swift','build','--package-path',str(native),'--show-bin-path'],check=True,capture_output=True,text=True).stdout.strip())
source=(native/'Sources/LaiNative/main.swift').read_text().split('let app = NSApplication.shared\n')[0]
with tempfile.TemporaryDirectory(prefix='lai-test-native-drag-') as tmp:
 p=Path(tmp);(p/'main.swift').write_text(source+'\n'+(root/'scripts/native-drag-acceptance.swift').read_text())
 objects=list((bin_dir/'LaiCore.build').glob('*.swift.o'))
 subprocess.run(['/usr/bin/swiftc','-I',str(bin_dir/'Modules'),str(p/'main.swift'),*map(str,objects),'-o',str(p/'drag-tests')],check=True)
 r=subprocess.run([str(p/'drag-tests')],capture_output=True,text=True);print(r.stdout,end='');print(r.stderr,end='');raise SystemExit(r.returncode)
