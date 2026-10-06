import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import {spawnSync} from 'node:child_process';

// Execute the production window's dispatch method. Never show or activate a window.
const native=fs.readFileSync('native/Sources/LaiNative/main.swift','utf8');
const evidence=path.resolve(process.env.LAI_NATIVE_CLOSE_EVIDENCE||'evidence/ui-1.4.47/native-routing');
const start=native.indexOf('final class LaiWindow: NSWindow {');
const end=native.indexOf('\nfinal class LaiDragRegionView:',start);
const implementation=start>=0&&end>start ? native.slice(start,end).replace('final class LaiWindow:', 'class LaiWindow:') : '';
const productionType=implementation?'LaiWindow':'NSWindow';
const directory=fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()),'lai-close-routing-'));
const program=`import Cocoa
${implementation}
final class CloseAttemptWindow: ${productionType} {
    var closeAttempts = 0
    override func performClose(_ sender: Any?) { closeAttempts += 1 }
}
let app = NSApplication.shared
let window = CloseAttemptWindow(contentRect: NSRect(x:0,y:0,width:400,height:300), styleMask:[.titled,.closable], backing:.buffered, defer:false)
func event(_ key: String, _ flags: NSEvent.ModifierFlags) -> NSEvent {
    NSEvent.keyEvent(with:.keyDown, location:.zero, modifierFlags:flags, timestamp:0, windowNumber:window.windowNumber, context:nil, characters:key, charactersIgnoringModifiers:key, isARepeat:false, keyCode:13)!
}
let commandResult = window.performKeyEquivalent(with:event("w", .command))
let commandAttempts = window.closeAttempts
let plainResult = window.performKeyEquivalent(with:event("w", []))
let shiftResult = window.performKeyEquivalent(with:event("w", [.command,.shift]))
let optionResult = window.performKeyEquivalent(with:event("w", [.command,.option]))
let controlResult = window.performKeyEquivalent(with:event("w", [.command,.control]))
let otherResult = window.performKeyEquivalent(with:event("r", .command))
let ordinaryAttempts = window.closeAttempts
let capsResult = window.performKeyEquivalent(with:event("W", [.command,.capsLock]))
let checks = [
    "commandWUsesNativeGuardedClose": commandResult && ordinaryAttempts == 1,
    "ordinaryAndOtherShortcutsNotClosed": ordinaryAttempts == commandAttempts,
    "capsLockPreservesCommandW": capsResult && window.closeAttempts == 2
]
print(String(data:try JSONSerialization.data(withJSONObject:["checks":checks,"result":checks.values.allSatisfy{$0} ? "pass":"fail"],options:[.sortedKeys]),encoding:.utf8)!)
exit(checks.values.allSatisfy{$0} ? 0:1)
`;
try {
    fs.mkdirSync(evidence,{recursive:true});
    const file=path.join(directory,'main.swift');fs.writeFileSync(file,program);
    const run=spawnSync('/usr/bin/swift',[file],{encoding:'utf8',timeout:60000});
    fs.writeFileSync(path.join(evidence,'compiler.log'),run.stderr||'');
    const line=(run.stdout||'').trim().split('\n').findLast(x=>x.startsWith('{'));
    assert.ok(line,'Actual AppKit dispatch must run and emit a result');
    const report={...JSON.parse(line),checkedAt:new Date().toISOString(),nativeSourceSha256:crypto.createHash('sha256').update(native).digest('hex'),scope:'Exact production dispatch, native action observed with spy; visible window and draft guard verified separately'};
    fs.writeFileSync(path.join(evidence,'report.json'),JSON.stringify(report,null,2));
    console.log(JSON.stringify(report));
    assert.equal(run.status,0,'Command-W must dispatch through performClose');
} finally {fs.rmSync(directory,{recursive:true,force:true});}
