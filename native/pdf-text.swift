import Foundation
import PDFKit

func emit(_ value: [String: Any]) -> Never {
    guard let bytes = try? JSONSerialization.data(withJSONObject: value) else { exit(1) }
    FileHandle.standardOutput.write(bytes)
    exit(0)
}
guard CommandLine.arguments.count == 2,
      let document = PDFDocument(url: URL(fileURLWithPath: CommandLine.arguments[1])) else {
    emit(["kind": "error", "reason": "failed"])
}
guard !document.isLocked, document.allowsCopying, document.pageCount > 0, document.pageCount <= 200 else {
    emit(["kind": "error", "reason": "pdf"])
}
var parts: [String] = []
var missing: [Int] = []
var length = 0
for index in 0..<document.pageCount {
    guard let page = document.page(at: index) else { emit(["kind": "error", "reason": "failed"]) }
    let text = page.string ?? ""
    if text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty { missing.append(index + 1) }
    length += text.utf16.count + 2
    guard length <= 100_000 else { emit(["kind": "error", "reason": "text"]) }
    parts.append(text)
}
emit(["kind": "text", "text": parts.joined(separator: "\n\n"), "pageCount": document.pageCount, "emptyPages": missing])
