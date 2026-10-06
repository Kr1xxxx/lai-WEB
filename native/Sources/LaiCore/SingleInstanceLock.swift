import Darwin
import Foundation

/// A process-owned lock. Keep the file in place: removing it could create two locks.
public final class LaiSingleInstanceLock {
    private let descriptor: Int32

    public init?(fileURL: URL) throws {
        let fd = open(fileURL.path, O_RDWR | O_CREAT | O_CLOEXEC | O_NOFOLLOW, S_IRUSR | S_IWUSR)
        guard fd >= 0 else { throw NSError(domain: NSPOSIXErrorDomain, code: Int(errno)) }
        guard flock(fd, LOCK_EX | LOCK_NB) == 0 else {
            let failure = errno
            close(fd)
            if failure == EWOULDBLOCK { return nil }
            throw NSError(domain: NSPOSIXErrorDomain, code: Int(failure))
        }
        descriptor = fd
    }

    deinit { close(descriptor) }
}
