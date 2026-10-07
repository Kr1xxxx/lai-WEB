import Foundation
import LaiCore

private struct VerificationFailure: Error, CustomStringConvertible {
    let description: String
}

private func verify(_ condition: @autoclosure () -> Bool, _ message: String) throws {
    guard condition() else { throw VerificationFailure(description: message) }
}

do {
    let identity = LaiLocalServiceIdentity.random()
    try verify((49_152...65_535).contains(identity.port), "identity port is outside the ephemeral range")
    try verify(identity.apiToken.count == 64, "API token does not have 256 bits of UUID entropy")
    try verify(identity.instanceNonce.count == 32, "instance nonce does not have 128 bits of UUID entropy")
    try verify(identity.apiToken != identity.instanceNonce, "API token and instance nonce must differ")
    try verify(identity.apiToken.allSatisfy(\.isHexDigit), "API token is not hexadecimal")
    try verify(identity.instanceNonce.allSatisfy(\.isHexDigit), "instance nonce is not hexadecimal")

    let policy = LaiLocalOriginPolicy(port: 51_234)
    try verify(policy.contains(URL(string: "http://127.0.0.1:51234/trade-order-system.html")!), "exact local origin was rejected")
    try verify(!policy.contains(URL(string: "http://localhost:51234/trade-order-system.html")!), "localhost alias must not be trusted")
    try verify(!policy.contains(URL(string: "http://127.0.0.1:51235/trade-order-system.html")!), "wrong local port was trusted")
    try verify(!policy.contains(URL(string: "https://127.0.0.1:51234/trade-order-system.html")!), "wrong local scheme was trusted")
    try verify(!policy.contains(URL(string: "http://127.0.0.1.evil.test:51234/")!), "lookalike host was trusted")
    try verify(policy.mayOpenExternally(URL(string: "https://www.dhl.com/track")!), "HTTPS external URL was rejected")
    try verify(!policy.mayOpenExternally(URL(string: "http://www.dhl.com/track")!), "HTTP external URL was accepted")
    try verify(!policy.mayOpenExternally(URL(fileURLWithPath: "/tmp/order.json")), "file URL was accepted")
    try verify(!policy.mayOpenExternally(URL(string: "javascript:alert(1)")!), "JavaScript URL was accepted")

    let parent = ["HOME":"/tmp/home", "TMPDIR":"/private/tmp", "LAI_DATA_DIR":"/private/tmp/lai-test-example/data", "TRADE_APP_DATA_DIR":"/production", "TRADE_API_TOKEN":"old-token", "AI_API_KEY":"old-ai", "LAI_APP_PORT":"1"]
    let environment = LaiRuntimeEnvironment.build(parent: parent, identity: identity)
    try verify(environment["TRADE_APP_DATA_DIR"] == nil, "Production data override leaked to Lai runtime")
    try verify(environment["TRADE_API_TOKEN"] == nil && environment["AI_API_KEY"] == nil, "Old credentials leaked to Lai runtime")
    try verify(environment["LAI_DATA_DIR"] == "/private/tmp/lai-test-example/data", "Lai test data path was not forwarded")
    try verify(environment["LAI_APP_PORT"] == String(identity.port), "Lai port must use minted identity")
    try verify(environment["LAI_API_TOKEN"] == identity.apiToken, "Lai token must use minted identity")
    try verify(environment["LAI_APP_NO_OPEN"] == "1", "Native host must suppress browser launch")

    let chrome = LaiWindowChromeLayout(width: 1_320, height: 768)
    try verify(chrome.isFallbackDragPoint(x: 660, y: 764), "Top-edge fallback drag strip is missing")
    try verify(chrome.isFallbackDragPoint(x: 120, y: 730), "Logo fallback drag region is missing")
    try verify(chrome.isFallbackDragPoint(x: 56, y: 730), "Visible logo leading edge must be draggable")
    try verify(!chrome.isFallbackDragPoint(x: 32, y: 730), "Traffic-light area must stay interactive")
    try verify(chrome.isFallbackDragPoint(x: 660, y: 730), "Full topbar center must be draggable")
    try verify(chrome.isFallbackDragPoint(x: 1_280, y: 730), "Full topbar trailing edge must be draggable")
    let zip = Data([0x50, 0x4b, 0x03, 0x04, 1, 2, 3, 4])
    let workbookBody: [String: Any] = ["filename": "Synthetic.xlsx", "contentBase64": zip.base64EncodedString()]
    let export = LaiWorkbookExport(body: workbookBody)
    try verify(export != nil, "Generated workbook rejected")
    for name in ["../escape.xlsx", "bad\\path.xlsx", "bad\nname.xlsx", "script.html"] {
        try verify(LaiWorkbookExport(body: ["filename":name, "contentBase64":zip.base64EncodedString()]) == nil, "Unsafe workbook filename accepted")
    }
    try verify(LaiWorkbookExport(body: ["filename":"bad.xlsx", "contentBase64":"not-base64"]) == nil, "Invalid file bytes accepted")
    try verify(LaiWorkbookExport(body: ["filename":"bad.xlsx", "contentBase64":Data("HTML".utf8).base64EncodedString()]) == nil, "Non-workbook bytes accepted")
    let exportDirectory = FileManager.default.temporaryDirectory.appendingPathComponent("lai-test-export-" + UUID().uuidString)
    try FileManager.default.createDirectory(at: exportDirectory, withIntermediateDirectories: true)
    defer { try? FileManager.default.removeItem(at: exportDirectory) }
    let destination = exportDirectory.appendingPathComponent("Synthetic.xlsx")
    try export!.write(to: destination)
    let savedExport = try Data(contentsOf: destination)
    try verify(savedExport == zip, "Saved workbook bytes differ")
    print("Lai native runtime and environment isolation tests passed.")
} catch {
    FileHandle.standardError.write(Data("Native runtime policy test failed: \(error)\n".utf8))
    exit(1)
}
