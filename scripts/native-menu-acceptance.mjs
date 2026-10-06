import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import {spawnSync} from 'node:child_process';

// Compile the exact production menu factory, inspect real AppKit menu objects.
// No window is created and no keyboard/mouse action is synthesized here.
const root=path.resolve('.');
const evidence=path.resolve(process.env.LAI_NATIVE_MENU_EVIDENCE||'evidence/ui-1.4.46/native-menu');
const file=path.join(root,'native/Sources/LaiNative/main.swift');
const native=fs.readFileSync(file,'utf8');
const start=native.indexOf('    private func createMainMenu() {');
const end=native.indexOf('\n    func webView(',start);
assert.ok(start>=0&&end>start,'Production menu factory boundaries must be present');
const factory=native.slice(start,end).replace('private func createMainMenu()', 'func createMainMenu()');
const temporary=fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()),'lai-test-menu-'));
const program=`import Cocoa
final class ProductionMenuFactory {
${factory}
}
let application = NSApplication.shared
ProductionMenuFactory().createMainMenu()
func items(_ menu: NSMenu) -> [NSMenuItem] {
    menu.items.flatMap { [$0] + ($0.submenu.map(items) ?? []) }
}
let all = items(application.mainMenu!)
let close = all.filter { $0.keyEquivalent == "w" && $0.keyEquivalentModifierMask == .command }
var checks: [String: Bool] = [:]
checks["exactlyOneCommandW"] = close.count == 1
checks["usesNativeWindowCloseAction"] = close.first?.action == #selector(NSWindow.performClose(_:))
checks["usesResponderChainForCurrentWindow"] = close.first != nil && close.first?.target == nil
checks["standardCloseTitle"] = close.first?.title == "关闭窗口"
checks["quitShortcutRetained"] = all.contains { $0.keyEquivalent == "q" && $0.action == #selector(NSApplication.terminate(_:)) }
checks["editingShortcutsRetained"] = ["z","Z","x","c","v","a"].allSatisfy { key in all.contains { $0.keyEquivalent == key } }
let result: [String: Any] = ["checks": checks, "result": checks.values.allSatisfy { $0 } ? "pass" : "fail"]
let data = try JSONSerialization.data(withJSONObject: result, options: [.sortedKeys])
print(String(data: data, encoding: .utf8)!)
exit(checks.values.allSatisfy { $0 } ? 0 : 1)
`;
try {
 fs.mkdirSync(evidence,{recursive:true});
 const swift=path.join(temporary,'main.swift');fs.writeFileSync(swift,program);
 const run=spawnSync('/usr/bin/swift',[swift],{encoding:'utf8',timeout:60000});
 fs.writeFileSync(path.join(evidence,'compiler.log'),run.stderr||'');
 const line=(run.stdout||'').trim().split('\n').findLast(line=>line.startsWith('{'));
 assert.ok(line,'AppKit verifier must emit a report, not a compiler failure');
 const report=JSON.parse(line);report.checkedAt=new Date().toISOString();
 report.nativeSourceSha256=crypto.createHash('sha256').update(native).digest('hex');
 report.scope='Real AppKit menu object inspection from exact production factory; UI shortcut and draft behavior require separate native acceptance';
 fs.writeFileSync(path.join(evidence,'report.json'),JSON.stringify(report,null,2));
 console.log(JSON.stringify({result:report.result,checks:report.checks}));
 assert.equal(run.status,0,'Native menu behavior must meet Command-W requirements');
} finally {fs.rmSync(temporary,{recursive:true,force:true});}
