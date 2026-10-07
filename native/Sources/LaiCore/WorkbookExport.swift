import Foundation

// Accept only a generated workbook from the trusted local document. The destination
// is chosen by NSSavePanel, never supplied by JavaScript.
public struct LaiWorkbookExport {
    public let filename: String
    public let bytes: Data
    public init?(body: [String: Any]) {
        guard let filename = body["filename"] as? String,
              filename.lowercased().hasSuffix(".xlsx"), filename.count <= 180,
              !filename.contains("/"), !filename.contains("\\"),
              !filename.unicodeScalars.contains(where: { CharacterSet.controlCharacters.contains($0) }),
              let base64 = body["contentBase64"] as? String,
              base64.utf8.count <= 14 * 1024 * 1024,
              let bytes = Data(base64Encoded: base64), bytes.count <= 10 * 1024 * 1024,
              bytes.starts(with: [0x50, 0x4b, 0x03, 0x04]) else { return nil }
        self.filename = filename
        self.bytes = bytes
    }
    public func write(to url: URL) throws {
        guard url.isFileURL, url.pathExtension.lowercased() == "xlsx" else {
            throw CocoaError(.fileWriteInvalidFileName)
        }
        try bytes.write(to: url, options: .atomic)
    }
}
