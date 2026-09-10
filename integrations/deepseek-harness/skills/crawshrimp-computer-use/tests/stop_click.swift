// Inspect and click only the small stop panel owned by the supplied test PID.
import AppKit
import CoreGraphics
let pid=Int(CommandLine.arguments[1])!
func windows()->[[String:Any]] {
    (CGWindowListCopyWindowInfo([.optionOnScreenOnly],kCGNullWindowID) as? [[String:Any]] ?? []).filter { ($0[kCGWindowOwnerPID as String] as? Int)==pid }
}
let rows=windows()
let before=NSWorkspace.shared.frontmostApplication?.processIdentifier ?? 0
var samples=[before]
if CommandLine.arguments.count>2 {
    let row=rows.first { ($0[kCGWindowBounds as String] as? [String:CGFloat])?["Width"] == 64 }!
    let b=row[kCGWindowBounds as String] as! [String:CGFloat]
    let p=CGPoint(x:b["X"]!+32,y:b["Y"]!+16)
    for type in [CGEventType.mouseMoved,.leftMouseDown,.leftMouseUp] {
        CGEvent(mouseEventSource:nil,mouseType:type,mouseCursorPosition:p,mouseButton:.left)?.post(tap:.cghidEventTap)
        Thread.sleep(forTimeInterval:0.05)
    }
    for _ in 0..<30 { samples.append(NSWorkspace.shared.frontmostApplication?.processIdentifier ?? 0);Thread.sleep(forTimeInterval:0.02) }
}
let cursor=CGEvent(source:nil)!.location
let result:[String:Any]=["windows":windows().map { ["id":$0[kCGWindowNumber as String]!,"bounds":$0[kCGWindowBounds as String]!] },"foreground":before,"foreground_samples":samples,"cursor":[cursor.x,cursor.y]]
print(String(data:try! JSONSerialization.data(withJSONObject:result),encoding:.utf8)!)
