import Foundation

public struct LaiLocalServiceIdentity: Equatable, Sendable {
    public let port: Int
    public let apiToken: String
    public let instanceNonce: String

    public init(port: Int, apiToken: String, instanceNonce: String) {
        self.port = port
        self.apiToken = apiToken
        self.instanceNonce = instanceNonce
    }

    public static func random() -> LaiLocalServiceIdentity {
        LaiLocalServiceIdentity(
            port: Int.random(in: 49_152...65_535),
            apiToken: randomHexIdentifier() + randomHexIdentifier(),
            instanceNonce: randomHexIdentifier()
        )
    }

    private static func randomHexIdentifier() -> String {
        UUID().uuidString.replacingOccurrences(of: "-", with: "").lowercased()
    }
}

public struct LaiLocalOriginPolicy: Equatable, Sendable {
    public let port: Int

    public init(port: Int) {
        self.port = port
    }

    public func contains(_ url: URL) -> Bool {
        url.scheme?.lowercased() == "http"
            && url.host?.lowercased() == "127.0.0.1"
            && url.port == port
    }

    public func mayOpenExternally(_ url: URL) -> Bool {
        url.scheme?.lowercased() == "https" && url.host != nil
    }
}

public enum LaiRuntimeEnvironment {
    public static func build(parent: [String: String], identity: LaiLocalServiceIdentity) -> [String: String] {
        var environment: [String: String] = [:]
        for key in ["HOME", "TMPDIR", "LANG", "LC_CTYPE", "LAI_DATA_DIR"] {
            if let value = parent[key] { environment[key] = value }
        }
        environment["LAI_APP_NO_OPEN"] = "1"
        environment["LAI_APP_PORT"] = String(identity.port)
        environment["LAI_API_TOKEN"] = identity.apiToken
        environment["LAI_INSTANCE_NONCE"] = identity.instanceNonce
        environment["PATH"] = "/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"
        return environment
    }
}

public struct LaiWindowChromeLayout: Equatable, Sendable {
    public let width: Double
    public let height: Double

    public init(width: Double, height: Double) {
        self.width = max(0, width)
        self.height = max(0, height)
    }

    public func isFallbackDragPoint(x: Double, y: Double) -> Bool {
        guard x >= 0, y >= 0, x <= width, y <= height else { return false }
        return x >= 52 && y >= max(0, height - 56)
    }
}
