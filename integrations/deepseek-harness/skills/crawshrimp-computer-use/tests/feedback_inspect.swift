// Read only OS state for the owned feedback process, or show a non-activating test backdrop.
import AppKit
import CoreGraphics
let args=CommandLine.arguments
    let pid=Int(args[1])!
    let rows=(CGWindowListCopyWindowInfo([.optionOnScreenOnly],kCGNullWindowID) as? [[String:Any]] ?? []).filter { ($0[kCGWindowOwnerPID as String] as? Int)==pid }
    let windows=rows.map { ["id":$0[kCGWindowNumber as String]!,"bounds":$0[kCGWindowBounds as String]!] }
    let cursor=CGEvent(source:nil)!.location
    let result:[String:Any]=["windows":windows,"foreground":Int(NSWorkspace.shared.frontmostApplication?.processIdentifier ?? 0),"cursor":[cursor.x,cursor.y]]
    print(String(data:try! JSONSerialization.data(withJSONObject:result),encoding:.utf8)!)
