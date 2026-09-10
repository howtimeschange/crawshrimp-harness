// Window capture / Unicode input techniques adapted from huashu-mac-use (MIT).
// See THIRD_PARTY_NOTICES.md. JSON protocol and strict selector routing are Crawshrimp additions.
import Foundation
import AppKit
import ApplicationServices
import CoreGraphics
import Carbon

struct Refusal: Error { let message: String }
func refuse(_ message: String) throws -> Never { throw Refusal(message: message) }
func output(_ value: [String: Any]) {
    let data = try! JSONSerialization.data(withJSONObject: value, options: [.sortedKeys])
    print(String(data: data, encoding: .utf8)!)
}
func attr(_ el: AXUIElement, _ name: String) -> CFTypeRef? {
    var value: CFTypeRef?
    return AXUIElementCopyAttributeValue(el, name as CFString, &value) == .success ? value : nil
}
func rawWindows() -> [[String: Any]] {
    CGWindowListCopyWindowInfo([.optionAll, .excludeDesktopElements], kCGNullWindowID) as? [[String: Any]] ?? []
}
func window(_ id: Int) throws -> [String: Any] {
    guard let raw = rawWindows().first(where: { ($0[kCGWindowNumber as String] as? Int) == id }),
          let pid = raw[kCGWindowOwnerPID as String] as? Int,
          let app = NSRunningApplication(processIdentifier: pid_t(pid)),
          let b = raw[kCGWindowBounds as String] as? [String: Any] else { try refuse("Window closed or identity unavailable") }
    return ["id": id, "pid": pid, "process_started": app.launchDate?.timeIntervalSince1970 ?? 0,
            "executable": app.executableURL?.path ?? "", "app": app.localizedName ?? "",
            "title": raw[kCGWindowName as String] as? String ?? "",
            "x": b["X"] ?? 0, "y": b["Y"] ?? 0, "width": b["Width"] ?? 0, "height": b["Height"] ?? 0,
            "visible": raw[kCGWindowIsOnscreen as String] as? Bool ?? false,
            "coordinate_unit": "logical_point"]
}
func number(_ w: [String: Any], _ key: String) -> Double { (w[key] as? NSNumber)?.doubleValue ?? 0 }
func locked() -> Bool {
    let session = CGSessionCopyCurrentDictionary() as? [String: Any]
    return session == nil || (session?["CGSSessionScreenIsLocked"] as? Bool ?? false)
}
func rect(_ el: AXUIElement) -> CGRect? {
    guard let p = attr(el, kAXPositionAttribute), let s = attr(el, kAXSizeAttribute),
          CFGetTypeID(p) == AXValueGetTypeID(), CFGetTypeID(s) == AXValueGetTypeID() else { return nil }
    var point = CGPoint.zero, size = CGSize.zero
    guard AXValueGetValue(p as! AXValue, .cgPoint, &point), AXValueGetValue(s as! AXValue, .cgSize, &size) else { return nil }
    return CGRect(origin: point, size: size)
}
let roles = ["AXButton": "button", "AXTextField": "text_field", "AXTextArea": "text_area", "AXCheckBox": "checkbox",
             "AXComboBox": "combobox", "AXMenuItem": "menu_item", "AXStaticText": "text", "AXWindow": "window"]

func tree(_ w: [String: Any]) -> (items: [[String: Any]], nodes: [AXUIElement], truncated: Bool, error: String?) {
    guard AXIsProcessTrusted() else { return ([], [], false, "Accessibility permission unavailable") }
    let app = AXUIElementCreateApplication(pid_t(w["pid"] as! Int))
    AXUIElementSetMessagingTimeout(app, 2)
    _ = attr(app, kAXRoleAttribute)  // Read-only wakeup; do not alter accessibility settings.
    let windows = attr(app, kAXWindowsAttribute) as? [AXUIElement] ?? []
    // Public AX does not expose CGWindowID. Match title + exact geometry; ambiguity refuses.
    let matches = windows.filter { el in
        guard let r = rect(el) else { return false }
        return abs(r.minX-number(w,"x")) < 2 && abs(r.minY-number(w,"y")) < 2 &&
            abs(r.width-number(w,"width")) < 2 && abs(r.height-number(w,"height")) < 2 &&
            ((w["title"] as? String ?? "").isEmpty || (attr(el,kAXTitleAttribute) as? String ?? "") == w["title"] as? String)
    }
    guard matches.count == 1 else { return ([], [], false, "AX window mapping not unique or unavailable; use screenshot/CDP") }
    var queue: [(AXUIElement, Int)] = [(matches[0],0)]
    var nodes: [AXUIElement] = [], items: [[String: Any]] = []
    var depthTruncated = false
    let deadline = Date().addingTimeInterval(8)
    while !queue.isEmpty && items.count < 500 && Date() < deadline {
        let (el, depth) = queue.removeFirst()
        let role = attr(el,kAXRoleAttribute) as? String ?? ""
        let secure = (attr(el,kAXSubroleAttribute) as? String) == "AXSecureTextField"
        var actions: [String] = []
        var names: CFArray?
        AXUIElementCopyActionNames(el, &names)
        if (names as? [String] ?? []).contains(kAXPressAction) { actions.append("invoke") }
        var settable = DarwinBoolean(false)
        if AXUIElementIsAttributeSettable(el,kAXValueAttribute as CFString,&settable) == .success && settable.boolValue { actions.append("set_value") }
        let name = (attr(el,kAXTitleAttribute) as? String).flatMap { $0.isEmpty ? nil : $0 } ?? (attr(el,kAXDescriptionAttribute) as? String ?? "")
        var item: [String: Any] = ["role": roles[role] ?? role, "name": secure ? "" : name,
                                "automation_id": attr(el,kAXIdentifierAttribute) as? String ?? "",
                                "protected": secure, "enabled": attr(el,kAXEnabledAttribute) as? Bool ?? !actions.isEmpty,
                                "enabled_source":attr(el,kAXEnabledAttribute) == nil ? "supported_action_attribute" : "AXEnabled",
                                "focused": attr(el,kAXFocusedAttribute) as? Bool ?? false,
                                "actions": secure ? [] : actions]
        if !secure, let v = attr(el,kAXValueAttribute), let value = v as? String { item["value"] = value }
        if let r = rect(el) { item["rect"] = ["x":r.minX,"y":r.minY,"width":r.width,"height":r.height] }
        nodes.append(el); items.append(item)
        let children = attr(el,kAXChildrenAttribute) as? [AXUIElement] ?? []
        if depth < 32 { queue.append(contentsOf: children.map { ($0,depth+1) }) }
        else if !children.isEmpty { depthTruncated = true }
    }
    return (items,nodes,!queue.isEmpty || depthTruncated,nil)
}
func selected(_ selector: [String: String], _ t: (items: [[String: Any]], nodes: [AXUIElement], truncated: Bool, error: String?)) throws -> AXUIElement {
    guard !selector.isEmpty, Set(selector.keys).isSubset(of: ["role","name","automation_id"]) else { try refuse("Invalid selector") }
    let indices = t.items.indices.filter { i in selector.allSatisfy { t.items[i][$0.key] as? String == $0.value } }
    guard indices.count == 1 else { try refuse("Selector no longer unique") }
    let i = indices[0]
    guard t.items[i]["protected"] as? Bool != true, t.items[i]["enabled"] as? Bool == true else { try refuse("Protected or disabled control") }
    return t.nodes[i]
}
func foreground(_ w: [String: Any]) -> Bool {
    guard NSWorkspace.shared.frontmostApplication?.processIdentifier == pid_t(w["pid"] as! Int) else { return false }
    // Compositor order includes system utility windows. Require the app's actual focused AX window.
    let app=AXUIElementCreateApplication(pid_t(w["pid"] as! Int))
    guard let raw=attr(app,kAXFocusedWindowAttribute),CFGetTypeID(raw)==AXUIElementGetTypeID(),let r=rect(raw as! AXUIElement) else { return false }
    return abs(r.minX-number(w,"x"))<2 && abs(r.minY-number(w,"y"))<2 && abs(r.width-number(w,"width"))<2 && abs(r.height-number(w,"height"))<2
}
func physicalGuard(_ w: [String: Any], _ p: CGPoint?) throws {
    guard AXIsProcessTrusted(), !locked(), w["visible"] as? Bool == true, foreground(w) else {
        try refuse("Requires Accessibility and target foreground window on current Space; no automatic activation")
    }
    if let p = p {
        let hit = rawWindows().first { raw in
            if raw[kCGWindowOwnerPID as String] as? Int == Int(getpid()) { return false }
            if let pid=feedbackOverlayPID,raw[kCGWindowOwnerPID as String] as? Int == Int(pid) { return false }
            guard raw[kCGWindowIsOnscreen as String] as? Bool == true,
                  let b = raw[kCGWindowBounds as String] as? [String:Any] else { return false }
            return CGRect(x:number(b,"X"),y:number(b,"Y"),width:number(b,"Width"),height:number(b,"Height")).contains(p)
        }
        guard hit?[kCGWindowNumber as String] as? Int == w["id"] as? Int else {
            try refuse("Point occluded by another window (id \(hit?[kCGWindowNumber as String] ?? -1), owner \(hit?[kCGWindowOwnerName as String] ?? "unknown"), layer \(hit?[kCGWindowLayer as String] ?? -1))")
        }
    }
}
let inputMarker: Int64 = 0x4352415753485249
var lastFocusReport: [String:Any]?
var lastFeedbackReport: [String:Any]?
var feedbackOverlayPID:pid_t?
func post(_ event: CGEvent?) {
    event?.setIntegerValueField(.eventSourceUserData,value:inputMarker)
    event?.post(tap:.cghidEventTap)
}
func pump(_ seconds: Double) { RunLoop.current.run(until:Date().addingTimeInterval(seconds)) }
final class FocusLease {
    let window: [String:Any]
    let borrow: Bool
    let started = Date()
    let previous = NSWorkspace.shared.frontmostApplication
    let previousMouse = CGEvent(source:nil)?.location
    var previousWindow: AXUIElement?
    var monitor: CFMachPort?
    var monitorSource: CFRunLoopSource?
    var takeover = false
    var takeoverEvent: [String:Any]?
    var borrowed = false
    var armed = false
    var hudShown = false
    let feedback=DesktopFeedback()
    var ended = false
    init(_ window:[String:Any],_ borrow:Bool) {
        self.window=window; self.borrow=borrow
        if let pid=previous?.processIdentifier,
           let raw=attr(AXUIElementCreateApplication(pid),kAXFocusedWindowAttribute),
           CFGetTypeID(raw)==AXUIElementGetTypeID() { previousWindow=(raw as! AXUIElement) }
    }
    func activate(_ pid:pid_t) -> Bool {
        let p=Process()
        p.executableURL=URL(fileURLWithPath:"/usr/bin/osascript")
        p.arguments=["-e","with timeout of 2 seconds\ntell application \"System Events\" to set frontmost of (first application process whose unix id is \(pid)) to true\nend timeout"]
        p.standardOutput=FileHandle.nullDevice; p.standardError=FileHandle.nullDevice
        do { try p.run() } catch { return false }
        let until=Date().addingTimeInterval(2.5)
        while p.isRunning && Date()<until && !takeover && !runCancelled() { pump(0.01) }
        if p.isRunning { p.terminate(); return false }
        return p.terminationStatus == 0
    }
    func begin() throws {
        try checkCancellation()
        guard CGEventSource.secondsSinceLastEventType(.combinedSessionState,eventType:.null) >= 2 else { try refuse("User active in last 2 seconds") }
        guard !locked(),window["visible"] as? Bool == true else { try refuse("Window not visible on current Space; focus lease cannot switch desktops") }
        // A key press initiates takeover. macOS IME also generates untagged key-up
        // events while changing the text-input client, even without user input.
        let types:[CGEventType]=[.keyDown,.flagsChanged,.leftMouseDown,.rightMouseDown,.otherMouseDown,.mouseMoved,.scrollWheel,.leftMouseDragged,.rightMouseDragged]
        let mask=types.reduce(CGEventMask(0)) { $0 | (CGEventMask(1) << $1.rawValue) }
        monitor=CGEvent.tapCreate(tap:.cgSessionEventTap,place:.headInsertEventTap,options:.listenOnly,eventsOfInterest:mask,callback:{ _,type,event,context in
            let lease=Unmanaged<FocusLease>.fromOpaque(context!).takeUnretainedValue()
            if event.getIntegerValueField(.eventSourceUserData) != inputMarker {
                lease.takeover=true
                lease.takeoverEvent=["type":type.rawValue,"source_pid":event.getIntegerValueField(.eventSourceUnixProcessID),
                    "delta_x":event.getIntegerValueField(.mouseEventDeltaX),"delta_y":event.getIntegerValueField(.mouseEventDeltaY)]
            }
            return Unmanaged.passUnretained(event)
        },userInfo:Unmanaged.passUnretained(self).toOpaque())
        guard monitor != nil else { try refuse("User input monitor unavailable; cannot safely borrow focus") }
        monitorSource=CFMachPortCreateRunLoopSource(kCFAllocatorDefault,monitor!,0)
        CFRunLoopAddSource(CFRunLoopGetCurrent(),monitorSource,.commonModes)
        CGEvent.tapEnable(tap:monitor!,enable:true)
        armed=true
        if !foreground(window) {
            guard borrow else { try refuse("Target must be foreground, or use focus=borrow") }
            guard let target=NSRunningApplication(processIdentifier:pid_t(window["pid"] as! Int)) else { try refuse("Target closed") }
            borrowed=true
            guard activate(target.processIdentifier) else { try refuse(takeover ? "User takeover during activation" : "Focus activation failed; check Automation permission for System Events") }
            try checkCancellation()
            if let root=tree(window).nodes.first { _ = AXUIElementPerformAction(root,kAXRaiseAction as CFString) }
            let until=Date().addingTimeInterval(1.5)
            while !foreground(window) && Date()<until && !takeover && !runCancelled() { pump(0.02) }
            guard !takeover else { try refuse("User takeover during activation") }
            guard foreground(window) else { try refuse("Focus activation unavailable; target not foreground (target pid \(window["pid"]!), actual pid \(NSWorkspace.shared.frontmostApplication?.processIdentifier ?? -1))") }
        }
        feedback.show(borrowed,background:false)
        hudShown=true
        try check()
    }
    func check() throws {
        try checkCancellation()
        pump(0.002)
        guard !takeover else { try refuse("User takeover detected; partial input possible") }
        guard Date().timeIntervalSince(started)<8 else { try refuse("Focus lease timeout; partial input possible") }
        guard foreground(window) else { takeover=true; try refuse("Focus changed; user retains control") }
    }
    func finish() {
        if ended { return }; ended=true
        // Allow the target to process posted input before restoring its predecessor.
        // Restoring immediately can race AppKit's deferred click activation.
        pump(0.20)
        var restored=false
        if armed && !takeover && !runCancelled() && foreground(window) {
            if let point=previousMouse { post(CGEvent(mouseEventSource:nil,mouseType:.mouseMoved,mouseCursorPosition:point,mouseButton:.left)) }
            if borrowed,let previous=previous,!previous.isTerminated {
                _ = activate(previous.processIdentifier); pump(0.15)
                if !takeover && !runCancelled(),let oldWindow=previousWindow {
                    _ = AXUIElementPerformAction(oldWindow,kAXRaiseAction as CFString); pump(0.15)
                    if let current=attr(AXUIElementCreateApplication(previous.processIdentifier),kAXFocusedWindowAttribute) {
                        restored=CFEqual(oldWindow,current)
                    }
                }
                restored = restored && !takeover && !runCancelled() && NSWorkspace.shared.frontmostApplication?.processIdentifier == previous.processIdentifier
            }
        }
        lastFeedbackReport=feedback.report
        feedback.close()
        if let m=monitor { CFMachPortInvalidate(m); monitor=nil }
        if let source=monitorSource { CFRunLoopRemoveSource(CFRunLoopGetCurrent(),source,.commonModes); monitorSource=nil }
        lastFocusReport=["requested":borrow,"borrowed":borrowed,"restored":restored,"user_takeover":takeover,
                         "takeover_event":takeoverEvent as Any? ?? NSNull(),
                         "duration_seconds":Date().timeIntervalSince(started),"hud_shown":hudShown,
                         "capture_exclusion":"requested_not_guaranteed"]
    }
}
func capture(_ w: [String: Any], _ path: String) throws -> [String:Any] {
    guard !locked(), CGPreflightScreenCaptureAccess() else { try refuse("Screen recording permission unavailable or session locked") }
    let process = Process()
    process.executableURL = URL(fileURLWithPath:"/usr/sbin/screencapture")
    process.arguments = ["-x","-o","-l\(w["id"]!)",path]
    process.standardOutput = FileHandle.nullDevice; process.standardError = FileHandle.nullDevice
    try process.run(); process.waitUntilExit()
    guard process.terminationStatus == 0, let data = try? Data(contentsOf:URL(fileURLWithPath:path)), let image = NSBitmapImageRep(data:data) else { try refuse("Window screenshot unavailable; no activation or sibling substitution") }
    var minimum = 1.0, maximum = 0.0
    for y in stride(from:0,to:image.pixelsHigh,by:max(1,image.pixelsHigh/32)) {
        for x in stride(from:0,to:image.pixelsWide,by:max(1,image.pixelsWide/32)) {
            if let c = image.colorAt(x:x,y:y)?.usingColorSpace(.deviceRGB) {
                let v = (c.redComponent+c.greenComponent+c.blueComponent)/3
                minimum = min(minimum,v); maximum = max(maximum,v)
            }
        }
    }
    return ["available":true,"path":path,"width":image.pixelsWide,"height":image.pixelsHigh,
            "possibly_blank": maximum-minimum < 0.01,"mode":"window_compositor","content_verified":false]
}

func applicationIcon(_ url: URL) -> String? {
    let icon = NSWorkspace.shared.icon(forFile:url.path)
    guard let bitmap = NSBitmapImageRep(bitmapDataPlanes:nil, pixelsWide:64, pixelsHigh:64,
        bitsPerSample:8, samplesPerPixel:4, hasAlpha:true, isPlanar:false,
        colorSpaceName:.deviceRGB, bytesPerRow:0, bitsPerPixel:0) else { return nil }
    NSGraphicsContext.saveGraphicsState()
    defer { NSGraphicsContext.restoreGraphicsState() }
    NSGraphicsContext.current = NSGraphicsContext(bitmapImageRep:bitmap)
    icon.draw(in:NSRect(x:0,y:0,width:64,height:64), from:.zero, operation:.copy, fraction:1)
    guard let png = bitmap.representation(using:.png, properties:[:]) else { return nil }
    return "data:image/png;base64," + png.base64EncodedString()
}

func run(_ req: [String:Any]) throws -> [String:Any] {
    try checkCancellation()
    let command = req["command"] as? String ?? ""
    if command == "automation_applications" {
        let manager = FileManager.default
        let roots = ["/Applications", "/System/Applications", NSHomeDirectory() + "/Applications"]
        let running = NSWorkspace.shared.runningApplications
        var candidates = running.compactMap { $0.bundleURL }
        var unavailableRoots: [String] = []
        for root in roots {
            guard manager.fileExists(atPath:root) else { continue }
            guard let iterator = manager.enumerator(at: URL(fileURLWithPath:root), includingPropertiesForKeys:nil,
                options:[.skipsHiddenFiles, .skipsPackageDescendants], errorHandler:{ _, _ in unavailableRoots.append(root); return false }) else {
                unavailableRoots.append(root); continue
            }
            for case let url as URL in iterator {
                if url.pathExtension.lowercased() == "app" { candidates.append(url); iterator.skipDescendants() }
            }
        }
        candidates += [URL(fileURLWithPath:"/System/Library/CoreServices/System Events.app"), URL(fileURLWithPath:"/System/Library/CoreServices/Finder.app")]
        var found: [String:[String:Any]] = [:]
        for url in candidates {
            guard url.pathExtension.lowercased() == "app" else { continue }
            guard let bundle = Bundle(url:url), let id = bundle.bundleIdentifier, !id.isEmpty else { continue }
            if found[id] != nil { continue }
            let instance = running.first { $0.bundleIdentifier == id }
            let name = instance?.localizedName ?? manager.displayName(atPath:url.path)
            found[id] = ["icon_data_url":applicationIcon(url) ?? "", "bundle_id":id, "name":name.replacingOccurrences(of:".app",with:""),
                         "path":url.path, "running":instance != nil,
                         "scripting_declared":bundle.object(forInfoDictionaryKey:"OSAScriptingDefinition") != nil || (bundle.object(forInfoDictionaryKey:"NSAppleScriptEnabled") as? Bool == true)]
        }
        return ["status":"ok", "applications":found.values.sorted { ($0["name"] as! String).localizedStandardCompare($1["name"] as! String) == .orderedAscending },
                "roots":roots, "unavailable_roots":Array(Set(unavailableRoots)), "scope":"application_directories_and_running_apps", "request_attempted":false]
    }
    if command == "automation_permission" {
        let bundleID = req["bundle_id"] as? String ?? ""
        guard bundleID.range(of: "^[A-Za-z0-9][A-Za-z0-9.-]{1,254}$", options: .regularExpression) != nil,
              let url = NSWorkspace.shared.urlForApplication(withBundleIdentifier: bundleID) else {
            return ["status":"target_unavailable", "bundle_id":bundleID, "prompted":false]
        }
        let ask = req["ask_user"] as? Bool ?? false
        let descriptor = NSAppleEventDescriptor(bundleIdentifier: bundleID)
        let code = AEDeterminePermissionToAutomateTarget(descriptor.aeDesc, AEEventClass(typeWildCard), AEEventID(typeWildCard), ask)
        let status: String
        switch code {
        case noErr: status = "authorized"
        case -1744: status = "not_determined"
        case -1743: status = "denied_or_restricted"
        case -600: status = "target_not_running"
        default: status = "unknown"
        }
        // A successful preflight is authorization evidence, not an executed AppleScript.
        return ["status":status, "os_status":Int(code), "bundle_id":bundleID,
                "target_name":FileManager.default.displayName(atPath:url.path), "target_path":url.path,
                "request_attempted":ask, "accessibility":AXIsProcessTrusted(),
                "scope":"current_process_context", "auto_retry":false]
    }
    if command == "doctor" {
        return ["backend":"AX + CoreGraphics; osascript for app dictionaries", "accessibility":AXIsProcessTrusted(),
                "screen_recording":CGPreflightScreenCaptureAccess(),"locked":locked(),"physical_input":"foreground_or_explicit_borrow"]
    }
    if command == "windows" {
        let filter = (req["app"] as? String ?? "").lowercased()
        let found = rawWindows().compactMap { raw -> [String:Any]? in
            guard raw[kCGWindowLayer as String] as? Int == 0, let id = raw[kCGWindowNumber as String] as? Int,
                  let w = try? window(id), number(w,"width") > 0, number(w,"height") > 0,
                  filter.isEmpty || "\(w["app"]!) \(w["title"]!)".lowercased().contains(filter) else { return nil }
            return w
        }
        return ["windows":found]
    }
    let old = req["window"] as? [String:Any]
    guard let id = req["window_id"] as? Int ?? old?["id"] as? Int else { try refuse("window_id required") }
    let w = try window(id)
    if let old = old {
        for key in ["id","pid","process_started"] {
            guard number(old,key) == number(w,key) else { try refuse("Window identity changed: \(key)") }
        }
        guard old["executable"] as? String == w["executable"] as? String else { try refuse("Window identity changed: executable") }
    }
    if command == "shot" {
        var result=try capture(w,req["path"] as! String)
        if let path=req["preview_path"] as? String,
           let data=try? Data(contentsOf:URL(fileURLWithPath:req["path"] as! String)),let image=NSImage(data:data) {
            let width=min(1400.0,number(result,"width")),height=number(result,"height")*width/number(result,"width")
            if let bitmap=NSBitmapImageRep(bitmapDataPlanes:nil,pixelsWide:Int(width),pixelsHigh:Int(height),bitsPerSample:8,samplesPerPixel:4,hasAlpha:true,isPlanar:false,colorSpaceName:.deviceRGB,bytesPerRow:0,bitsPerPixel:0) {
                NSGraphicsContext.saveGraphicsState(); NSGraphicsContext.current=NSGraphicsContext(bitmapImageRep:bitmap)
                image.draw(in:NSRect(x:0,y:0,width:width,height:height)); NSGraphicsContext.restoreGraphicsState()
                if let png=bitmap.representation(using:.png,properties:[:]) {
                    try png.write(to:URL(fileURLWithPath:path))
                    result["preview"]=["path":path,"width":Int(width),"height":Int(height),"coordinate_hint":"Use normalized coordinates; image-space refers to original screenshot."]
                }
            }
        }
        return result
    }
    let t = tree(w)
    if command == "observe" {
        return ["window":w,"elements":t.items,"truncated":t.truncated,"tree_error":t.error as Any? ?? NSNull(),"foreground":foreground(w),
                "foreground_pid":NSWorkspace.shared.frontmostApplication?.processIdentifier ?? -1]
    }
    if command == "probe" {
        let app = NSRunningApplication(processIdentifier:pid_t(w["pid"] as! Int))
        let bundle = app?.bundleURL.flatMap { Bundle(url:$0) }
        let types = bundle?.infoDictionary?["CFBundleURLTypes"] as? [[String:Any]] ?? []
        let schemes = types.flatMap { $0["CFBundleURLSchemes"] as? [String] ?? [] }
        return ["window":w,"bundle_id":app?.bundleIdentifier ?? "","app_path":app?.bundleURL?.path ?? "",
                "url_schemes":schemes,"scripting_definition":bundle?.infoDictionary?["OSAScriptingDefinition"] ?? NSNull(),
                "semantic_controls":t.items.filter { !($0["actions"] as! [String]).isEmpty }.count,
                "tree_complete":!t.truncated && t.error == nil,
                "note":"Read sdef for actual commands; inspect current process-family ports for CDP. No relaunch performed."]
    }
    guard command == "act", AXIsProcessTrusted(), !locked() else { try refuse("Unsupported command or Accessibility/session unavailable") }
    let kind = req["kind"] as? String ?? ""
    if kind == "invoke" || kind == "set_value" {
        guard !t.truncated, t.error == nil else { try refuse("Incomplete AX tree; cannot prove selector uniqueness") }
        let el = try selected(req["selector"] as? [String:String] ?? [:],t)
        let visual=DesktopFeedback()
        defer { visual.close() }
        visual.show(false)
        if let r=rect(el), w["visible"] as? Bool == true {
            visual.locate(CGPoint(x:r.midX,y:r.midY),check:{ true })
        }
        try checkCancellation()
        let err = kind == "invoke" ? AXUIElementPerformAction(el,kAXPressAction as CFString) :
            AXUIElementSetAttributeValue(el,kAXValueAttribute as CFString,(req["text"] as? String ?? "") as CFString)
        guard err == .success else { try refuse("AX returned \(err.rawValue); effect unknown, no fallback") }
        visual.pulse({ true }); lastFeedbackReport=visual.report
    } else {
        let lease=FocusLease(w,req["focus"] as? String == "borrow")
        defer { lease.finish() }
        try lease.begin()
        for key in ["x","y","width","height"] { guard number(old!,key) == number(w,key) else { try refuse("Window moved before dispatch") } }
        var point: CGPoint?
        if let p = req["point"] as? [String:Any] {
            guard number(p,"x") >= 0, number(p,"y") >= 0, number(p,"x") < number(w,"width"),number(p,"y") < number(w,"height") else { try refuse("Point outside window") }
            point = CGPoint(x:number(w,"x")+number(p,"x"),y:number(w,"y")+number(p,"y"))
        }
        // AX focus may update before WindowServer finishes raising the window.
        // Only poll the read-only occlusion guard; never repeat posted input.
        let readyDeadline=Date().addingTimeInterval(0.5)
        while true {
            try lease.check()
            do { try physicalGuard(w,point); break }
            catch let error as Refusal {
                guard error.message.hasPrefix("Point occluded"),Date()<readyDeadline else { throw error }
                pump(0.02)
            }
        }
        if let p=point { lease.feedback.locate(p,check:{ (try? lease.check()) != nil }) }
        try lease.check()
        try physicalGuard(w,point)  // Animation time must not make the hit-test stale.
        if kind == "click", let p = point {
            for type in [CGEventType.leftMouseDown,.leftMouseUp] {
                post(CGEvent(mouseEventSource:nil,mouseType:type,mouseCursorPosition:p,mouseButton:.left))
            }
        } else if kind == "scroll", let p = point {
            let e = CGEvent(scrollWheelEvent2Source:nil,units:.line,wheelCount:1,wheel1:Int32(req["delta"] as! Int),wheel2:0,wheel3:0)
            e?.location = p; post(e)
        } else if kind == "type" {
            let chars = Array(req["text"] as? String ?? "")
            for i in stride(from:0,to:chars.count,by:12) {
                try lease.check()
                var utf16 = Array(String(chars[i..<min(i+12,chars.count)]).utf16)
                for down in [true,false] {
                    let event = CGEvent(keyboardEventSource:nil,virtualKey:0,keyDown:down)
                    event?.keyboardSetUnicodeString(stringLength:utf16.count,unicodeString:&utf16)
                    post(event)
                }
                usleep(12_000)
            }
        } else if kind == "key" {
            let keys: [String:CGKeyCode] = ["ENTER":36,"ESC":53,"TAB":48,"BACKSPACE":51,"DELETE":117,"LEFT":123,"RIGHT":124,"UP":126,"DOWN":125,"HOME":115,"END":119,"SELECT_ALL":0,"COPY":8,"PASTE":9]
            let key = req["key"] as? String ?? ""
            guard let code = keys[key] else { try refuse("Unknown key") }
            for down in [true,false] {
                let e = CGEvent(keyboardEventSource:nil,virtualKey:code,keyDown:down)
                if ["SELECT_ALL","COPY","PASTE"].contains(key) { e?.flags = .maskCommand }
                post(e)
            }
        } else { try refuse("Unknown physical action") }
        if kind == "click" { lease.feedback.pulse({ (try? lease.check()) != nil }) }
        pump(0.04); try lease.check(); lease.finish()
    }
    return ["dispatched":true,"business_success":false,"focus_report":lastFocusReport as Any? ?? NSNull(),"feedback":lastFeedbackReport as Any? ?? NSNull()]
}
if CommandLine.arguments.count == 3 && CommandLine.arguments[1] == "--feedback-server" {
    serveFeedback(CommandLine.arguments[2]); exit(0)
}
do {
    let req = try JSONSerialization.jsonObject(with:FileHandle.standardInput.readDataToEndOfFile()) as! [String:Any]
    cancellationFile=req["cancel_file"] as? String
    if let path=req["feedback_dir"] as? String { feedbackRemoteDirectory=URL(fileURLWithPath:path) }
    if let pid=req["feedback_pid"] as? Int,
       NSRunningApplication(processIdentifier:pid_t(pid))?.executableURL?.resolvingSymlinksInPath().path == URL(fileURLWithPath:CommandLine.arguments[0]).resolvingSymlinksInPath().path { feedbackOverlayPID=pid_t(pid) }
    output(try run(req))
} catch let error as Refusal {
    output(["status":"refused","error":error.message,"focus_report":lastFocusReport as Any? ?? NSNull(),"feedback":lastFeedbackReport as Any? ?? NSNull()]); exit(2)
} catch {
    output(["status":"error","error":String(describing:error)]); exit(1)
}
