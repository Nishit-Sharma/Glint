import Foundation
import CoreGraphics

// Metadata only: no capture, activation, permission prompt or foreground fallback.
let args = Array(CommandLine.arguments.dropFirst())
if args.first == "--window" {
    guard args.count == 3, let id = UInt32(args[1]), id > 0,
          let expectedPID = Int(args[2]), expectedPID > 0 else { exit(2) }
    guard let windows = CGWindowListCopyWindowInfo(.optionOnScreenOnly, kCGNullWindowID) as? [[String: Any]] else { exit(3) }
    var hit: [String: Any]? = nil
    for window in windows {
        guard let number = window[kCGWindowNumber as String] as? UInt32, number > 0,
              let pid = window[kCGWindowOwnerPID as String] as? Int, pid > 0 else { exit(3) }
        if number != id { continue }
        guard pid == expectedPID else { break }
        let sharing = window[kCGWindowSharingState as String] as? Int
        hit = ["osId": Int(number), "processId": pid, "knownProtected": sharing != 1 && sharing != 2]
        break
    }
    let output: Any = hit ?? NSNull()
    let data = try JSONSerialization.data(withJSONObject: output, options: [.fragmentsAllowed, .sortedKeys])
    FileHandle.standardOutput.write(data)
    exit(0)
}
guard args.count >= 2, args.count <= 10,
      let x = Double(args[0]), let y = Double(args[1]), x.isFinite, y.isFinite,
      abs(x) <= 1_000_000, abs(y) <= 1_000_000 else { exit(2) }
let ignored: [(UInt32, Int)] = args.dropFirst(2).compactMap { value in
    let parts = value.split(separator: ":", omittingEmptySubsequences: false)
    guard parts.count == 2, let id = UInt32(parts[0]), id > 0,
          let pid = Int(parts[1]), pid > 0 else { return nil }
    return (id, pid)
}
guard ignored.count == args.count - 2 else { exit(2) }
guard let windows = CGWindowListCopyWindowInfo(.optionOnScreenOnly, kCGNullWindowID) as? [[String: Any]] else { exit(3) }
let point = CGPoint(x: x, y: y)
var hit: [String: Any]? = nil
for window in windows {
    guard let number = window[kCGWindowNumber as String] as? UInt32, number > 0,
          let pid = window[kCGWindowOwnerPID as String] as? Int, pid > 0 else { exit(3) }
    if ignored.contains(where: { $0.0 == number && $0.1 == pid }) { continue }
    guard let raw = window[kCGWindowBounds as String] as? NSDictionary,
          let rect = CGRect(dictionaryRepresentation: raw),
          rect.minX.isFinite, rect.minY.isFinite, rect.width.isFinite, rect.height.isFinite else { exit(3) }
    guard rect.width > 0, rect.height > 0,
          point.x >= rect.minX, point.x < rect.maxX,
          point.y >= rect.minY, point.y < rect.maxY,
          (window[kCGWindowAlpha as String] as? Double ?? 1) > 0 else { continue }
    // Preserve utility/menu/other-layer occluders. Metadata matching may reject this hit,
    // but must never select a different window through it. Unknown sharing fails closed.
    let sharing = window[kCGWindowSharingState as String] as? Int
    hit = ["osId": Int(number), "processId": pid, "knownProtected": sharing != 1 && sharing != 2]
    break
}
let output: Any = hit ?? NSNull()
let data = try JSONSerialization.data(withJSONObject: output, options: [.fragmentsAllowed, .sortedKeys])
FileHandle.standardOutput.write(data)
