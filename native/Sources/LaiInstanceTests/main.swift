import Darwin
import Foundation
import LaiCore

func check(_ condition: @autoclosure () throws -> Bool, _ label: String) throws {
    guard try condition() else { throw NSError(domain: label, code: 1) }
    print("PASS: \(label)")
}

if CommandLine.arguments.count == 3, CommandLine.arguments[1] == "--hold" {
    do {
        guard let lock = try LaiSingleInstanceLock(fileURL: URL(fileURLWithPath: CommandLine.arguments[2])) else { exit(2) }
        print("ready")
        fflush(stdout)
        withExtendedLifetime(lock) { Thread.sleep(forTimeInterval: 30) }
        exit(0)
    } catch { exit(3) }
}

let directory = FileManager.default.temporaryDirectory.appendingPathComponent("lai-instance-tests-\(UUID().uuidString)")
try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
defer { try? FileManager.default.removeItem(at: directory) }
do {
    let path = directory.appendingPathComponent("instance.lock")
    var first = try LaiSingleInstanceLock(fileURL: path)
    try check(first != nil, "first process acquires lock")
    try check(try LaiSingleInstanceLock(fileURL: path) == nil, "second opener cannot acquire held lock")
    let other = try LaiSingleInstanceLock(fileURL: directory.appendingPathComponent("other.lock"))
    try check(other != nil, "unrelated lock remains available")
    first = nil
    var reopened = try LaiSingleInstanceLock(fileURL: path)
    try check(reopened != nil, "normal release permits reopening with existing file")
    reopened = nil

    let holder = Process()
    holder.executableURL = URL(fileURLWithPath: CommandLine.arguments[0])
    holder.arguments = ["--hold", path.path]
    let pipe = Pipe(); holder.standardOutput = pipe
    try holder.run()
    let ready = pipe.fileHandleForReading.availableData
    try check(String(data: ready, encoding: .utf8)?.contains("ready") == true, "separate process holds actual lock")
    try check(try LaiSingleInstanceLock(fileURL: path) == nil, "cross-process duplicate rejected")
    kill(holder.processIdentifier, SIGKILL)
    holder.waitUntilExit()
    let afterCrash = try LaiSingleInstanceLock(fileURL: path)
    try check(afterCrash != nil, "crashed process releases lock without deleting file")
    withExtendedLifetime((other, afterCrash)) {}
    print("Lai single-instance lock tests passed (7).")
} catch {
    FileHandle.standardError.write(Data("Single-instance test failed: \(error)\n".utf8))
    exit(1)
}
