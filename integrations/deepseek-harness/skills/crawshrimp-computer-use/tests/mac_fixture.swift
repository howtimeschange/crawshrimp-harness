// Local-only test window. No file persistence, network, or external messaging.
import AppKit
class Handler: NSObject {
    let status: NSTextField
    init(_ status: NSTextField) { self.status = status }
    @objc func clicked(_ sender: Any?) { status.stringValue = "invoked-once" }
}
let app = NSApplication.shared
app.setActivationPolicy(.regular)
let window = NSWindow(contentRect:NSRect(x:160,y:180,width:540,height:220),styleMask:[.titled,.closable],backing:.buffered,defer:false)
let anchor = CommandLine.arguments.contains("--anchor")
window.title = anchor ? "Crawshrimp CU Focus Anchor" : "Crawshrimp CU Test Fixture"
if anchor { window.setFrameOrigin(NSPoint(x:820,y:180)) }
let label = NSTextField(labelWithString:"抓虾 Computer Use · 本地验收")
label.frame = NSRect(x:24,y:166,width:490,height:30)
let input = NSTextField(frame:NSRect(x:24,y:110,width:490,height:32))
input.setAccessibilityIdentifier("cu-input")
let status = NSTextField(labelWithString:"not-invoked")
status.frame = NSRect(x:220,y:48,width:280,height:30)
status.setAccessibilityIdentifier("cu-status")
let handler = Handler(status)
let button = NSButton(title:"本地测试按钮",target:handler,action:#selector(Handler.clicked(_:)))
button.frame = NSRect(x:24,y:40,width:175,height:40)
button.setAccessibilityIdentifier("cu-button")
for view in [label,input,status,button] { window.contentView!.addSubview(view) }
window.makeKeyAndOrderFront(nil)
// Exercise the OS event-monitor path using an unmarked event from a separate process.
// It is a simulated takeover, not a claim that a human physically moved the mouse.
var takeoverPosted = false
var stopSignalled = false
let takeoverTimer = Timer.scheduledTimer(withTimeInterval:0.005,repeats:true) { _ in
    if let i=CommandLine.arguments.firstIndex(of:"--stop-signal"), i+1<CommandLine.arguments.count,
       !stopSignalled, (input.currentEditor()?.string ?? input.stringValue).hasPrefix("stop:") {
        stopSignalled=true;try? Data("started".utf8).write(to:URL(fileURLWithPath:CommandLine.arguments[i+1]))
    }
    if (input.currentEditor()?.string ?? input.stringValue).hasPrefix("takeover:") && !takeoverPosted {
        takeoverPosted=true
        if let point=CGEvent(source:nil)?.location {
            let event=CGEvent(mouseEventSource:nil,mouseType:.mouseMoved,mouseCursorPosition:point,mouseButton:.left)
            event?.post(tap:.cghidEventTap)
            FileHandle.standardError.write(Data("SIMULATED_TAKEOVER_POSTED\n".utf8))
        }
    }
}
app.run()
