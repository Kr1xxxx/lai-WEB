// AppKit integration assertions compiled with the actual native app classes.
// No backend, business database, input-event synthesis or system preference changes.
final class TestURLWebView: WKWebView {
    var testURL: URL?
    override var url: URL? { testURL }
}
final class TestDragMessage: WKScriptMessage {
    var source: WKWebView?
    var payload: Any = [:]
    override var name: String { "windowDragRegions" }
    override var webView: WKWebView? { source }
    override var body: Any { payload }
}
extension LaiAppDelegate {
    func runDragAcceptance() -> [String: Bool] {
        originPolicy = LaiLocalOriginPolicy(port: 51234)
        createWindow()
        let mainContent = window!.contentView!
        let mainHeight = mainContent.bounds.height
        let mainSource = TestURLWebView(frame: .zero, configuration: webView!.configuration)
        mainSource.testURL = URL(string: "http://127.0.0.1:51234/trade-order-system.html")!
        webView = mainSource
        showCustomerDetail("Synthetic Drag", from: mainSource.url!)
        let detailContent = customerDetailWindow!.contentView!
        let detailHeight = detailContent.bounds.height
        let detailSource = TestURLWebView(frame: .zero, configuration: mainSource.configuration)
        detailSource.testURL = URL(string: "http://127.0.0.1:51234/trade-order-system.html?customer=Synthetic")!
        customerDetailWebView = detailSource
        func report(_ source: WKWebView, searchX: Double) {
            let message = TestDragMessage()
            message.source = source
            message.payload = ["region": ["x":0,"y":0,"width":1480,"height":56],
                               "exclusions": [["x":searchX,"y":12,"width":200,"height":32]]]
            userContentController(mainSource.configuration.userContentController, didReceive: message)
        }
        report(mainSource, searchX: 350)
        let mainInitiallyExcluded = !(mainContent.hitTest(NSPoint(x:400,y:mainHeight-30)) is LaiDragRegionView)
        report(detailSource, searchX: 900)
        let result = [
            "detail white bar blank receives native drag handler": detailContent.hitTest(NSPoint(x:300,y:detailHeight-30)) is LaiDragRegionView,
            "detail report preserves main search exclusion": mainInitiallyExcluded && !(mainContent.hitTest(NSPoint(x:400,y:mainHeight-30)) is LaiDragRegionView),
            "detail search remains interactive": !(detailContent.hitTest(NSPoint(x:950,y:detailHeight-30)) is LaiDragRegionView),
            "main trailing blank remains draggable": mainContent.hitTest(NSPoint(x:1000,y:mainHeight-30)) is LaiDragRegionView
        ]
        let foreign = TestURLWebView(frame: .zero)
        foreign.testURL = URL(string:"https://example.test/")!
        report(mainSource, searchX: 350)
        report(foreign, searchX: 1100)
        var checks = result
        checks["foreign-origin report cannot overwrite main exclusions"] = !(mainContent.hitTest(NSPoint(x:400,y:mainHeight-30)) is LaiDragRegionView)
        let unknown = TestURLWebView(frame: .zero)
        unknown.testURL = mainSource.testURL
        report(mainSource, searchX: 350)
        report(unknown, searchX: 1100)
        checks["unknown local webview report cannot overwrite main exclusions"] = !(mainContent.hitTest(NSPoint(x:400,y:mainHeight-30)) is LaiDragRegionView)
        window?.orderOut(nil)
        customerDetailWindow?.orderOut(nil)
        return checks
    }
}
let testingApp = NSApplication.shared
testingApp.setActivationPolicy(.prohibited)
let checks = LaiAppDelegate().runDragAcceptance()
print(String(data:try! JSONSerialization.data(withJSONObject:checks,options:[.sortedKeys]),encoding:.utf8)!)
exit(checks.values.allSatisfy{$0} ? 0 : 1)
