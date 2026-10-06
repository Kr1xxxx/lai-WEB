import Cocoa
import Darwin
import Foundation
import LaiCore
import WebKit

private let laiActivationNotification = Notification.Name("com.local.laicai.lai.activate-existing")
private let laiActivationUser = String(getuid())

final class LaiWindow: NSWindow {
    override func performKeyEquivalent(with event: NSEvent) -> Bool {
        let modifiers = event.modifierFlags.intersection([.command, .shift, .control, .option])
        if modifiers == .command, event.charactersIgnoringModifiers?.lowercased() == "w" {
            performClose(nil)
            return true
        }
        return super.performKeyEquivalent(with: event)
    }
}

final class LaiDragRegionView: NSView {
    private var dragRects: [NSRect] = []
    private var exclusionRects: [NSRect] = []

    override var mouseDownCanMoveWindow: Bool { true }

    func update(dragRects: [NSRect], exclusionRects: [NSRect]) {
        self.dragRects = dragRects
        self.exclusionRects = exclusionRects
    }

    override func hitTest(_ point: NSPoint) -> NSView? {
        let chrome = LaiWindowChromeLayout(
            width: Double(bounds.width),
            height: Double(bounds.height)
        )
        let isFallback = chrome.isFallbackDragPoint(
            x: Double(point.x),
            y: Double(point.y)
        )
        let isExcluded = exclusionRects.contains(where: { $0.contains(point) })
        guard !isExcluded else { return nil }
        let isReported = dragRects.contains(where: { $0.contains(point) })
        guard isFallback || isReported else { return nil }
        return self
    }

    override func mouseDown(with event: NSEvent) {
        window?.performDrag(with: event)
    }
}

final class LaiAppDelegate: NSObject, NSApplicationDelegate, NSWindowDelegate, WKNavigationDelegate, WKUIDelegate, WKScriptMessageHandler, @unchecked Sendable {
    private var window: NSWindow?
    private var webView: WKWebView?
    private var dragRegionView: LaiDragRegionView?
    private var auxiliaryWindows: [NSWindow] = []
    private var customerDetailWindow: NSWindow?
    private var customerDetailWebView: WKWebView?
    private var customerDetailDragRegionView: LaiDragRegionView?

    private let startupQueue = DispatchQueue(label: "com.local.laicai.lai.server-startup", qos: .userInitiated)
    private let processLock = NSLock()
    nonisolated(unsafe) private var serverProcess: Process?
    nonisolated(unsafe) private var serverOutput = ""
    nonisolated(unsafe) private var stopping = false

    private var localIdentity: LaiLocalServiceIdentity?
    private var originPolicy: LaiLocalOriginPolicy?
    private var appHasLoaded = false

    private var allowTermination = false
    private var terminationInProgress = false
    private var terminationReplyPending = false
    private var flushAttemptID: UUID?

    func applicationWillFinishLaunching(_ notification: Notification) {
        DistributedNotificationCenter.default().addObserver(
            self, selector: #selector(activateExistingWindow(_:)),
            name: laiActivationNotification, object: laiActivationUser
        )
    }

    @objc private func activateExistingWindow(_ notification: Notification) {
        bringWindowForward()
    }

    private func bringWindowForward() {
        let target = customerDetailWindow?.isVisible == true ? customerDetailWindow : window
        target?.deminiaturize(nil)
        target?.makeKeyAndOrderFront(nil)
        NSApp.activate(ignoringOtherApps: true)
    }

    func applicationShouldHandleReopen(_ sender: NSApplication, hasVisibleWindows flag: Bool) -> Bool {
        bringWindowForward()
        return false
    }

    func applicationDidFinishLaunching(_ notification: Notification) {
        createMainMenu()
        createWindow()
        startLocalServer()
    }

    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool {
        false
    }

    func applicationShouldTerminate(_ sender: NSApplication) -> NSApplication.TerminateReply {
        if allowTermination { return .terminateNow }
        if terminationInProgress { return .terminateLater }
        beginTermination(replyToApplication: true)
        return .terminateLater
    }

    func windowShouldClose(_ sender: NSWindow) -> Bool {
        if allowTermination { return true }
        if sender === customerDetailWindow {
            guard let popup = customerDetailWebView else { return false }
            popup.callAsyncJavaScript(
                "return window.flushPendingSave ? await window.flushPendingSave() : true;",
                arguments: [:], in: nil, in: .page
            ) { [weak sender] result in
                guard case .success(let safeToClose) = result,
                      (safeToClose as? Bool) == true,
                      let sender else { return }
                sender.orderOut(nil)
            }
            return false
        }
        guard sender === window else { return true }
        if !terminationInProgress {
            beginTermination(replyToApplication: false)
        }
        return false
    }

    func applicationWillTerminate(_ notification: Notification) {
        flushAttemptID = nil
        processLock.lock()
        stopping = true
        let process = serverProcess
        processLock.unlock()
        if let process {
            terminate(process, timeout: 2.0)
        }
    }

    private func createWindow() {
        let config = WKWebViewConfiguration()
        config.websiteDataStore = .nonPersistent()
        config.preferences.javaScriptCanOpenWindowsAutomatically = true
        config.userContentController.add(self, name: "windowDragRegions")
        config.userContentController.add(self, name: "openCustomerDetail")
        config.userContentController.add(self, name: "closeCustomerDetail")
        let dragBridgeScript = WKUserScript(
            source: """
            (() => {
              if (window.__laiWindowDragRegionsInstalled) return;
              window.__laiWindowDragRegionsInstalled = true;
              const handler = window.webkit?.messageHandlers?.windowDragRegions;
              if (!handler) return;
              const toRect = element => {
                const rect = element.getBoundingClientRect();
                return { x: rect.left, y: rect.top, width: rect.width, height: rect.height };
              };
              let scheduled = false;
              const report = () => {
                scheduled = false;
                const region = document.querySelector('.topbar');
                if (!region) return;
                const regionRect = toRect(region);
                const exclusions = [...region.querySelectorAll('input, button, select, textarea, a, [contenteditable="true"], .global-search-panel')]
                  .map(toRect);
                handler.postMessage({ region: regionRect, exclusions });
              };
              const scheduleReport = () => {
                if (scheduled) return;
                scheduled = true;
                requestAnimationFrame(report);
              };
              const start = () => {
                const region = document.querySelector('.topbar');
                if (!region) return;
                new ResizeObserver(scheduleReport).observe(region);
                new MutationObserver(scheduleReport).observe(document.body, {
                  childList: true,
                  subtree: true
                });
                window.addEventListener('resize', scheduleReport, { passive: true });
                scheduleReport();
              };
              if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
              else start();
            })();
            """,
            injectionTime: .atDocumentEnd,
            forMainFrameOnly: true
        )
        config.userContentController.addUserScript(dragBridgeScript)

        let webView = WKWebView(frame: .zero, configuration: config)
        webView.navigationDelegate = self
        webView.uiDelegate = self
        webView.setValue(false, forKey: "drawsBackground")
        self.webView = webView

        let window = LaiWindow(
            contentRect: NSRect(x: 0, y: 0, width: 1756, height: 1022),
            styleMask: [.titled, .closable, .miniaturizable, .resizable, .fullSizeContentView],
            backing: .buffered,
            defer: false
        )
        window.title = "来财Lai"
        window.titleVisibility = .hidden
        window.titlebarAppearsTransparent = true
        window.backgroundColor = .clear
        window.isMovableByWindowBackground = false
        window.minSize = NSSize(width: 1100, height: 720)
        window.center()
        window.delegate = self

        let (container, dragRegionView) = windowContent(for: webView, size: NSSize(width: 1756, height: 1022))
        self.dragRegionView = dragRegionView

        window.contentView = container
        window.makeKeyAndOrderFront(nil)
        self.window = window
    }

    private func windowContent(for webView: WKWebView, size: NSSize) -> (NSView, LaiDragRegionView) {
        let container = NSView(frame: NSRect(origin: .zero, size: size))
        container.autoresizingMask = [.width, .height]
        webView.frame = container.bounds
        webView.autoresizingMask = [.width, .height]
        container.addSubview(webView)

        let dragRegionView = LaiDragRegionView(frame: container.bounds)
        dragRegionView.autoresizingMask = [.width, .height]
        container.addSubview(dragRegionView)
        return (container, dragRegionView)
    }

    func userContentController(_ userContentController: WKUserContentController,
                               didReceive message: WKScriptMessage) {
        if message.name == "openCustomerDetail" {
            guard let source = message.webView, source === webView,
                  let url = source.url, originPolicy?.contains(url) == true,
                  let body = message.body as? [String: Any],
                  let name = body["name"] as? String,
                  !name.isEmpty, name.count <= 512 else { return }
            showCustomerDetail(name, from: url)
            return
        }
        if message.name == "closeCustomerDetail" {
            guard let popup = message.webView,
                  let url = popup.url,
                  originPolicy?.contains(url) == true,
                  popup === customerDetailWebView else { return }
            customerDetailWindow?.orderOut(nil)
            return
        }
        guard message.name == "windowDragRegions",
              let source = message.webView,
              let url = source.url,
              originPolicy?.contains(url) == true,
              let body = message.body as? [String: Any],
              let region = body["region"] as? [String: Any] else { return }
        let target: LaiDragRegionView?
        if source === webView { target = dragRegionView }
        else if source === customerDetailWebView { target = customerDetailDragRegionView }
        else { return }
        guard let target else { return }
        let dragRects = nativeRects(from: [region], in: target)
        let exclusions = nativeRects(from: body["exclusions"] as? [[String: Any]] ?? [], in: target)
        target.update(dragRects: dragRects, exclusionRects: exclusions)
    }

    private func showCustomerDetail(_ name: String, from sourceURL: URL) {
        guard var components = URLComponents(url: sourceURL, resolvingAgainstBaseURL: false) else { return }
        components.path = "/trade-order-system.html"
        components.queryItems = [URLQueryItem(name: "customer", value: name)]
        components.fragment = "customers"
        guard let destination = components.url, originPolicy?.contains(destination) == true else { return }

        if let customerDetailWindow, let customerDetailWebView {
            if customerDetailWindow.isVisible {
                customerDetailWindow.makeKeyAndOrderFront(nil)
                return
            }
            customerDetailWebView.load(URLRequest(url: destination))
            customerDetailWindow.makeKeyAndOrderFront(nil)
            return
        }

        guard let mainWebView = webView else { return }
        let size = NSSize(width: 1480, height: 900)
        let detailView = WKWebView(frame: NSRect(origin: .zero, size: size), configuration: mainWebView.configuration)
        detailView.navigationDelegate = self
        detailView.uiDelegate = self
        let detailWindow = LaiWindow(
            contentRect: NSRect(origin: .zero, size: size),
            styleMask: [.titled, .closable, .miniaturizable, .resizable],
            backing: .buffered,
            defer: false
        )
        detailWindow.title = "客户详情 · 来财Lai"
        detailWindow.isReleasedWhenClosed = false
        detailWindow.delegate = self
        let (detailContent, detailDragRegion) = windowContent(for: detailView, size: size)
        detailWindow.contentView = detailContent
        customerDetailDragRegionView = detailDragRegion
        detailWindow.center()
        customerDetailWebView = detailView
        customerDetailWindow = detailWindow
        detailView.load(URLRequest(url: destination))
        detailWindow.makeKeyAndOrderFront(nil)
    }

    private func nativeRects(from values: [[String: Any]], in view: NSView) -> [NSRect] {
        values.compactMap { value in
            guard let x = finiteNumber(value["x"]),
                  let y = finiteNumber(value["y"]),
                  let width = finiteNumber(value["width"]),
                  let height = finiteNumber(value["height"]),
                  width > 0, height > 0 else { return nil }
            let rect = NSRect(x: x, y: view.bounds.height - y - height, width: width, height: height)
                .intersection(view.bounds)
            return rect.isNull || rect.isEmpty ? nil : rect
        }
    }

    private func finiteNumber(_ value: Any?) -> CGFloat? {
        guard let number = value as? NSNumber else { return nil }
        let result = number.doubleValue
        guard result.isFinite else { return nil }
        return CGFloat(result)
    }

    private func createMainMenu() {
        let mainMenu = NSMenu()

        let appMenuItem = NSMenuItem()
        let appMenu = NSMenu()
        appMenu.addItem(NSMenuItem(title: "退出来财Lai", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q"))
        appMenuItem.submenu = appMenu
        mainMenu.addItem(appMenuItem)

        let fileMenuItem = NSMenuItem()
        let fileMenu = NSMenu(title: "文件")
        let closeWindowItem = NSMenuItem(title: "关闭窗口", action: #selector(NSWindow.performClose(_:)), keyEquivalent: "w")
        closeWindowItem.keyEquivalentModifierMask = .command
        fileMenu.addItem(closeWindowItem)
        fileMenuItem.submenu = fileMenu
        mainMenu.addItem(fileMenuItem)

        let editMenuItem = NSMenuItem()
        let editMenu = NSMenu(title: "编辑")
        editMenu.addItem(NSMenuItem(title: "撤销", action: Selector(("undo:")), keyEquivalent: "z"))
        editMenu.addItem(NSMenuItem(title: "重做", action: Selector(("redo:")), keyEquivalent: "Z"))
        editMenu.addItem(NSMenuItem.separator())
        editMenu.addItem(NSMenuItem(title: "剪切", action: #selector(NSText.cut(_:)), keyEquivalent: "x"))
        editMenu.addItem(NSMenuItem(title: "复制", action: #selector(NSText.copy(_:)), keyEquivalent: "c"))
        editMenu.addItem(NSMenuItem(title: "粘贴", action: #selector(NSText.paste(_:)), keyEquivalent: "v"))
        editMenu.addItem(NSMenuItem(title: "全选", action: #selector(NSText.selectAll(_:)), keyEquivalent: "a"))
        editMenuItem.submenu = editMenu
        mainMenu.addItem(editMenuItem)

        NSApp.mainMenu = mainMenu
    }

    func webView(_ webView: WKWebView,
                 decidePolicyFor navigationAction: WKNavigationAction,
                 decisionHandler: @escaping @MainActor @Sendable (WKNavigationActionPolicy) -> Void) {
        guard let url = navigationAction.request.url else {
            decisionHandler(.cancel)
            return
        }
        if url.absoluteString == "about:blank" || originPolicy?.contains(url) == true {
            decisionHandler(.allow)
            return
        }

        decisionHandler(.cancel)
        let userInitiated = navigationAction.navigationType == .linkActivated || navigationAction.targetFrame == nil
        if userInitiated, originPolicy?.mayOpenExternally(url) == true {
            NSWorkspace.shared.open(url)
        }
    }

    func webView(_ webView: WKWebView,
                 createWebViewWith configuration: WKWebViewConfiguration,
                 for navigationAction: WKNavigationAction,
                 windowFeatures: WKWindowFeatures) -> WKWebView? {
        guard navigationAction.targetFrame == nil,
              let url = navigationAction.request.url,
              originPolicy?.contains(url) == true else { return nil }

        let popupSize = NSSize(width: 960, height: 720)
        let popup = WKWebView(frame: NSRect(origin: .zero, size: popupSize), configuration: configuration)
        popup.navigationDelegate = self
        popup.uiDelegate = self
        let popupWindow = NSWindow(
            contentRect: NSRect(origin: .zero, size: popupSize),
            styleMask: [.titled, .closable, .miniaturizable, .resizable],
            backing: .buffered,
            defer: false
        )
        popupWindow.title = "订单附件"
        popupWindow.contentView = popup
        popupWindow.center()
        popupWindow.makeKeyAndOrderFront(nil)
        auxiliaryWindows.append(popupWindow)
        return popup
    }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        guard webView === self.webView,
              let url = webView.url,
              originPolicy?.contains(url) == true else { return }
        appHasLoaded = true
    }

    private func startLocalServer() {
        guard let resources = Bundle.main.resourceURL else {
            showError("未找到应用资源目录。")
            return
        }
        let server = resources.appendingPathComponent("server.js")
        guard FileManager.default.fileExists(atPath: server.path) else {
            showError("未找到本地数据服务文件。")
            return
        }
        guard let node = findNode() else {
            showError("未找到内置 Node.js，无法启动本地数据服务。")
            return
        }

        startupQueue.async { [weak self] in
            self?.launchServerWithRetries(node: node, server: server, resources: resources)
        }
    }

    nonisolated private func launchServerWithRetries(node: String, server: URL, resources: URL) {
        var lastFailure = "服务未响应"
        for _ in 0..<6 {
            if shouldStopServer() { return }
            let identity = LaiLocalServiceIdentity.random()
            let process = configuredServerProcess(node: node, server: server, resources: resources, identity: identity)
            do {
                try process.run()
                setServerProcess(process)
            } catch {
                lastFailure = error.localizedDescription
                continue
            }

            let probe = waitForHealthyServer(identity: identity, process: process, timeout: 12)
            if probe.healthy {
                DispatchQueue.main.async { [weak self] in
                    guard let self, !self.shouldStopServer() else { return }
                    self.localIdentity = identity
                    self.originPolicy = LaiLocalOriginPolicy(port: identity.port)
                    self.loadApp(identity: identity)
                }
                return
            }
            lastFailure = probe.message
            terminate(process, timeout: 0.75)
            clearServerProcess(if: process)
        }

        let diagnostic = recentServerOutput()
        DispatchQueue.main.async { [weak self] in
            guard let self, !self.shouldStopServer() else { return }
            let detail = diagnostic.isEmpty ? lastFailure : "\(lastFailure)\n\n\(diagnostic)"
            self.showError("本地数据服务启动失败：\(detail)")
        }
    }

    nonisolated private func configuredServerProcess(node: String,
                                         server: URL,
                                         resources: URL,
                                         identity: LaiLocalServiceIdentity) -> Process {
        let process = Process()
        process.executableURL = URL(fileURLWithPath: node)
        process.arguments = [server.path]
        process.environment = LaiRuntimeEnvironment.build(parent: ProcessInfo.processInfo.environment, identity: identity)
        process.currentDirectoryURL = resources

        let outputPipe = Pipe()
        let errorPipe = Pipe()
        process.standardOutput = outputPipe
        process.standardError = errorPipe
        captureOutput(from: outputPipe.fileHandleForReading)
        captureOutput(from: errorPipe.fileHandleForReading)
        return process
    }

    nonisolated private func captureOutput(from handle: FileHandle) {
        handle.readabilityHandler = { [weak self] readable in
            let data = readable.availableData
            if data.isEmpty {
                readable.readabilityHandler = nil
                return
            }
            guard let text = String(data: data, encoding: .utf8) else { return }
            self?.processLock.lock()
            self?.serverOutput.append(text)
            if let count = self?.serverOutput.count, count > 8_000 {
                self?.serverOutput.removeFirst(count - 8_000)
            }
            self?.processLock.unlock()
        }
    }

    nonisolated private func waitForHealthyServer(identity: LaiLocalServiceIdentity,
                                      process: Process,
                                      timeout: TimeInterval) -> (healthy: Bool, message: String) {
        let deadline = Date().addingTimeInterval(timeout)
        var lastMessage = "等待健康检查超时"
        while Date() < deadline, process.isRunning, !shouldStopServer() {
            let result = healthProbe(identity: identity)
            if result.healthy { return result }
            lastMessage = result.message
            Thread.sleep(forTimeInterval: 0.1)
        }
        if !process.isRunning {
            lastMessage = "服务进程提前退出（状态 \(process.terminationStatus)）"
        }
        return (false, lastMessage)
    }

    nonisolated private func healthProbe(identity: LaiLocalServiceIdentity) -> (healthy: Bool, message: String) {
        guard let url = URL(string: "http://127.0.0.1:\(identity.port)/api/health") else {
            return (false, "健康检查 URL 无效")
        }
        var request = URLRequest(url: url, cachePolicy: .reloadIgnoringLocalCacheData, timeoutInterval: 0.75)
        request.setValue("Bearer \(identity.apiToken)", forHTTPHeaderField: "Authorization")

        let semaphore = DispatchSemaphore(value: 0)
        let result = HealthProbeBox()
        let config = URLSessionConfiguration.ephemeral
        config.timeoutIntervalForRequest = 0.75
        config.timeoutIntervalForResource = 1
        let session = URLSession(configuration: config)
        session.dataTask(with: request) { data, response, error in
            defer { semaphore.signal() }
            guard error == nil,
                  let http = response as? HTTPURLResponse,
                  (200...299).contains(http.statusCode),
                  let data,
                  let body = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else {
                result.set(healthy: false, message: error?.localizedDescription ?? "健康检查未返回有效 JSON")
                return
            }
            guard body["instanceNonce"] as? String == identity.instanceNonce else {
                result.set(healthy: false, message: "端口响应者身份不匹配")
                return
            }
            guard body["ok"] as? Bool == true else {
                let message = body["storageError"] as? String
                    ?? (body["integrity"] as? [String: Any])?["message"] as? String
                    ?? "数据库健康检查失败"
                result.set(healthy: false, message: message)
                return
            }
            result.set(healthy: true, message: "")
        }.resume()
        _ = semaphore.wait(timeout: .now() + 1.1)
        session.invalidateAndCancel()
        return result.value()
    }

    private func loadApp(identity: LaiLocalServiceIdentity) {
        var components = URLComponents()
        components.scheme = "http"
        components.host = "127.0.0.1"
        components.port = identity.port
        components.path = "/trade-order-system.html"
        components.queryItems = [URLQueryItem(name: "token", value: identity.apiToken)]
        components.fragment = "customers"
        guard let url = components.url else {
            showError("本地应用地址生成失败。")
            return
        }
        var request = URLRequest(url: url, cachePolicy: .reloadIgnoringLocalCacheData)
        request.setValue("Bearer \(identity.apiToken)", forHTTPHeaderField: "Authorization")
        webView?.load(request)
    }

    private func beginTermination(replyToApplication: Bool) {
        terminationInProgress = true
        terminationReplyPending = replyToApplication
        flushPendingSave { [weak self] result in
            guard let self else { return }
            switch result {
            case .success:
                self.completeTermination(shouldTerminate: true)
            case .failure(let error):
                self.presentUnsavedExitWarning(error: error)
            }
        }
    }

    private func flushPendingSave(completion: @escaping (Result<Void, Error>) -> Void) {
        guard appHasLoaded, let webView else {
            completion(.success(()))
            return
        }
        var pages = [webView]
        if customerDetailWindow?.isVisible == true, let customerDetailWebView {
            pages.append(customerDetailWebView)
        }

        let attemptID = UUID()
        flushAttemptID = attemptID
        DispatchQueue.main.asyncAfter(deadline: .now() + 10) { [weak self] in
            guard self?.flushAttemptID == attemptID else { return }
            self?.flushAttemptID = nil
            completion(.failure(TerminationError.saveTimedOut))
        }

        let script = """
        if (typeof window.flushPendingSave !== 'function') {
          throw new Error('页面未提供关闭前保存接口');
        }
        const saved = await window.flushPendingSave();
        return saved !== false;
        """
        Task { @MainActor [weak self] in
            do {
                for page in pages {
                    let value = try await page.callAsyncJavaScript(
                        script,
                        arguments: [:],
                        in: nil,
                        contentWorld: .page
                    )
                    guard (value as? Bool) == true else {
                        throw TerminationError.saveRejected
                    }
                }
                guard self?.flushAttemptID == attemptID else { return }
                self?.flushAttemptID = nil
                completion(.success(()))
            } catch {
                guard self?.flushAttemptID == attemptID else { return }
                self?.flushAttemptID = nil
                completion(.failure(error))
            }
        }
    }

    private func presentUnsavedExitWarning(error: Error) {
        let alert = NSAlert()
        alert.messageText = "来财数据尚未确认保存"
        alert.informativeText = "\(error.localizedDescription)\n\n建议返回软件，确认“数据库已保存”后再退出。"
        alert.alertStyle = .critical
        alert.addButton(withTitle: "返回软件")
        alert.addButton(withTitle: "仍然退出")
        let shouldExit = alert.runModal() == .alertSecondButtonReturn
        completeTermination(shouldTerminate: shouldExit)
    }

    private func completeTermination(shouldTerminate: Bool) {
        terminationInProgress = false
        let replyPending = terminationReplyPending
        terminationReplyPending = false
        if shouldTerminate {
            allowTermination = true
            if replyPending {
                NSApp.reply(toApplicationShouldTerminate: true)
            } else {
                NSApp.terminate(nil)
            }
        } else if replyPending {
            NSApp.reply(toApplicationShouldTerminate: false)
        }
    }

    private func findNode() -> String? {
        let bundledNode = Bundle.main.resourceURL?.appendingPathComponent("node-runtime").path
        return [bundledNode].compactMap { $0 }
            .first { FileManager.default.isExecutableFile(atPath: $0) }
    }

    nonisolated private func setServerProcess(_ process: Process) {
        processLock.lock()
        serverProcess = process
        processLock.unlock()
    }

    nonisolated private func clearServerProcess(if process: Process) {
        processLock.lock()
        if serverProcess === process {
            serverProcess = nil
        }
        processLock.unlock()
    }

    nonisolated private func shouldStopServer() -> Bool {
        processLock.lock()
        defer { processLock.unlock() }
        return stopping
    }

    nonisolated private func recentServerOutput() -> String {
        processLock.lock()
        defer { processLock.unlock() }
        return serverOutput.trimmingCharacters(in: .whitespacesAndNewlines)
    }

    nonisolated private func terminate(_ process: Process, timeout: TimeInterval) {
        guard process.isRunning else { return }
        process.terminate()
        let deadline = Date().addingTimeInterval(timeout)
        while process.isRunning, Date() < deadline {
            Thread.sleep(forTimeInterval: 0.05)
        }
        if process.isRunning {
            Darwin.kill(process.processIdentifier, SIGKILL)
        }
    }

    private func showError(_ message: String) {
        let alert = NSAlert()
        alert.messageText = "来财Lai无法启动"
        let summary = message.split(separator: "\n", omittingEmptySubsequences: true)
            .prefix(5).joined(separator: "\n")
        alert.informativeText = String(summary.prefix(600))
        alert.alertStyle = .critical
        alert.addButton(withTitle: "退出来财")
        alert.runModal()
        allowTermination = true
        NSApp.terminate(nil)
    }
}

private final class HealthProbeBox: @unchecked Sendable {
    private let lock = NSLock()
    private var result: (healthy: Bool, message: String) = (false, "健康检查超时")

    func set(healthy: Bool, message: String) {
        lock.lock()
        result = (healthy, message)
        lock.unlock()
    }

    func value() -> (healthy: Bool, message: String) {
        lock.lock()
        defer { lock.unlock() }
        return result
    }
}

private enum TerminationError: LocalizedError {
    case saveTimedOut
    case saveRejected

    var errorDescription: String? {
        switch self {
        case .saveTimedOut:
            return "等待数据库保存超过 10 秒。"
        case .saveRejected:
            return "页面报告本次保存没有完成。"
        }
    }
}

let app = NSApplication.shared
func activateRunningLai() {
    DistributedNotificationCenter.default().postNotificationName(
        laiActivationNotification, object: laiActivationUser, userInfo: nil, deliverImmediately: true
    )
    runningLai()?.activate(options: [.activateIgnoringOtherApps])
}

func runningLai() -> NSRunningApplication? {
    NSWorkspace.shared.runningApplications.first {
        $0.processIdentifier != getpid() && !$0.isTerminated && $0.isFinishedLaunching
            && $0.executableURL?.lastPathComponent == "Lai"
            && ($0.bundleIdentifier?.hasPrefix("com.local.laicai.") == true)
    }
}

let instanceLock: LaiSingleInstanceLock
do {
    let directory = FileManager.default.homeDirectoryForCurrentUser
        .appendingPathComponent("Library/Caches/com.local.laicai.lai", isDirectory: true)
    try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true,
                                           attributes: [.posixPermissions: 0o700])
    guard let acquired = try LaiSingleInstanceLock(fileURL: directory.appendingPathComponent("instance.lock")) else {
        activateRunningLai()
        exit(0)
    }
    instanceLock = acquired
} catch {
    let alert = NSAlert()
    alert.messageText = "来财Lai无法启动"
    alert.informativeText = "无法确认来财的运行状态，请退出后重试。"
    alert.addButton(withTitle: "退出")
    alert.runModal()
    exit(1)
}
// Older fully launched copies have no lock. Startup contenders are handled above.
if runningLai() != nil {
    activateRunningLai()
    exit(0)
}
let delegate = LaiAppDelegate()
app.delegate = delegate
app.setActivationPolicy(.regular)
app.activate(ignoringOtherApps: true)
app.run()
withExtendedLifetime(instanceLock) {}
