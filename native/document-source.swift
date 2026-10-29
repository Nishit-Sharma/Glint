import AppKit
import ApplicationServices
import CryptoKit

func emit(_ value: [String: Any]) -> Never {
    let data = try! JSONSerialization.data(withJSONObject: value, options: [.sortedKeys])
    FileHandle.standardOutput.write(data)
    exit(0)
}
func frozen(_ reason: String) -> Never { emit(["kind": "frozen", "reason": reason]) }
func attribute(_ element: AXUIElement, _ name: CFString) -> CFTypeRef? {
    var value: CFTypeRef?
    return AXUIElementCopyAttributeValue(element, name, &value) == .success ? value : nil
}
// AXEdited is an optional public dirty-state hint, never a content generation.
func editedState(_ window: AXUIElement) -> Bool? {
    guard let value = attribute(window, kAXEditedAttribute as CFString),
          CFGetTypeID(value) == CFBooleanGetTypeID() else { return nil }
    return CFBooleanGetValue(unsafeBitCast(value, to: CFBoolean.self))
}
func element(_ value: CFTypeRef?) -> AXUIElement? {
    guard let value, CFGetTypeID(value) == AXUIElementGetTypeID() else { return nil }
    return unsafeBitCast(value, to: AXUIElement.self)
}
struct EditedObservation {
    let source: AXUIElement
    let value: Bool?
}
func editedObservation(_ window: AXUIElement, _ pid: pid_t) -> EditedObservation {
    if let value = editedState(window) { return EditedObservation(source: window, value: value) }
    // Read only the named close button, and verify its relationship before AXEdited.
    guard let button = element(attribute(window, kAXCloseButtonAttribute as CFString)) else {
        return EditedObservation(source: window, value: nil)
    }
    var buttonPid: pid_t = 0
    guard AXUIElementGetPid(button, &buttonPid) == .success, buttonPid == pid,
          let ownerWindow = element(attribute(button, kAXWindowAttribute as CFString)), CFEqual(ownerWindow, window),
          let parent = element(attribute(button, kAXParentAttribute as CFString)), CFEqual(parent, window) else {
        return EditedObservation(source: window, value: nil)
    }
    // Preserve the verified source identity even when its optional hint is absent.
    return EditedObservation(source: button, value: editedState(button))
}
func focusedWindow(_ application: AXUIElement) -> AXUIElement? {
    return element(attribute(application, kAXFocusedWindowAttribute as CFString))
}
guard CommandLine.arguments.count == 2, let pid = Int32(CommandLine.arguments[1]), pid > 0 else { frozen("ambiguous") }
guard AXIsProcessTrusted() else { frozen("permission") }
guard NSWorkspace.shared.frontmostApplication?.processIdentifier == pid else { frozen("ambiguous") }
let application = AXUIElementCreateApplication(pid)
AXUIElementSetMessagingTimeout(application, 0.25)
guard let window = focusedWindow(application) else { frozen("metadata-unavailable") }
var actualPid: pid_t = 0
guard AXUIElementGetPid(window, &actualPid) == .success, actualPid == pid else { frozen("ambiguous") }
guard let document = attribute(window, kAXDocumentAttribute as CFString) as? String,
      !document.isEmpty, document.utf8.count <= 16384,
      let url = URL(string: document), ["file", "http", "https"].contains(url.scheme?.lowercased() ?? "") else { frozen("metadata-unavailable") }
let edited = editedObservation(window, pid)
guard let after = focusedWindow(application), CFEqual(window, after) else { frozen("ambiguous") }
let afterEdited = editedObservation(after, pid)
guard CFEqual(edited.source, afterEdited.source), edited.value == afterEdited.value,
      (attribute(after, kAXDocumentAttribute as CFString) as? String) == document,
      NSWorkspace.shared.frontmostApplication?.processIdentifier == pid,
      AXIsProcessTrusted() else { frozen("ambiguous") }
let digest = SHA256.hash(data: Data(document.utf8)).map { String(format: "%02x", $0) }.joined()
var reply: [String: Any] = ["kind": "document", "processId": pid, "digest": digest]
if let value = edited.value { reply["edited"] = value }
emit(reply)
