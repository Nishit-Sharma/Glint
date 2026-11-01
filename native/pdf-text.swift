import Foundation
import PDFKit
import CoreGraphics
import ImageIO

func emit(_ value: [String: Any]) -> Never {
    guard let bytes = try? JSONSerialization.data(withJSONObject: value) else { exit(1) }
    FileHandle.standardOutput.write(bytes)
    exit(0)
}
let arguments = Array(CommandLine.arguments.dropFirst())
let mode: String
let path: String
if arguments.count == 1 { mode = "text"; path = arguments[0] }
else if arguments.count == 2 && arguments[0] == "--inspect" { mode = "inspect"; path = arguments[1] }
else if arguments.count == 3 && arguments[0] == "--page" { mode = "page"; path = arguments[1] }
else { emit(["kind": "error", "reason": "failed"]) }
guard let document = PDFDocument(url: URL(fileURLWithPath: path)) else {
    emit(["kind": "error", "reason": "failed"])
}
guard !document.isLocked, document.allowsCopying, document.pageCount > 0, document.pageCount <= 200 else {
    emit(["kind": "error", "reason": "pdf"])
}
if mode != "text" {
    guard !document.isEncrypted else { emit(["kind": "error", "reason": "pdf"]) }
    if mode == "inspect" { emit(["kind": "pdf", "pageCount": document.pageCount]) }
    guard let number = Int(arguments[2]), number >= 1, number <= document.pageCount,
          let page = document.page(at: number - 1), let reference = page.pageRef else {
        emit(["kind": "error", "reason": "page"])
    }
    let bounds = page.bounds(for: .cropBox)
    guard bounds.width.isFinite, bounds.height.isFinite, bounds.width > 0, bounds.height > 0,
          bounds.width <= 20_000, bounds.height <= 20_000 else { emit(["kind": "error", "reason": "render"]) }
    let rotated = abs(page.rotation) % 180 == 90
    let displayWidth = rotated ? bounds.height : bounds.width
    let displayHeight = rotated ? bounds.width : bounds.height
    let scale = 1600.0 / max(displayWidth, displayHeight)
    let width = max(1, Int(ceil(displayWidth * scale)))
    let height = max(1, Int(ceil(displayHeight * scale)))
    guard width <= 1600, height <= 1600,
          let context = CGContext(data: nil, width: width, height: height, bitsPerComponent: 8,
                                  bytesPerRow: width * 4, space: CGColorSpaceCreateDeviceRGB(),
                                  bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue) else {
        emit(["kind": "error", "reason": "render"])
    }
    context.setFillColor(CGColor(gray: 1, alpha: 1))
    context.fill(CGRect(x: 0, y: 0, width: width, height: height))
    // CGPDFPage's fitting transform does not upscale; raster density is explicit.
    context.scaleBy(x: scale, y: scale)
    context.concatenate(reference.getDrawingTransform(.cropBox, rect: CGRect(x: 0, y: 0, width: CGFloat(width) / scale, height: CGFloat(height) / scale), rotate: 0, preserveAspectRatio: true))
    context.drawPDFPage(reference)
    guard let image = context.makeImage(), let data = CFDataCreateMutable(kCFAllocatorDefault, 0),
          let destination = CGImageDestinationCreateWithData(data, "public.png" as CFString, 1, nil) else {
        emit(["kind": "error", "reason": "render"])
    }
    CGImageDestinationAddImage(destination, image, nil)
    guard CGImageDestinationFinalize(destination) else { emit(["kind": "error", "reason": "render"]) }
    let png = data as Data
    guard png.count <= 8 * 1024 * 1024 else { emit(["kind": "error", "reason": "render"]) }
    emit(["kind": "page", "page": number, "pageCount": document.pageCount, "width": width, "height": height, "png": png.base64EncodedString()])
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
