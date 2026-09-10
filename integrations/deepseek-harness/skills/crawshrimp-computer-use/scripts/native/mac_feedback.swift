import AppKit
import QuartzCore
var feedbackRemoteDirectory:URL?
var cancellationFile:String?
func runCancelled()->Bool { cancellationFile.map { FileManager.default.fileExists(atPath:$0) } ?? false }
func checkCancellation() throws { if runCancelled() { try refuse("User stopped this desktop run; partial input possible") } }
final class StopTarget:NSObject {
    var action:(()->Void)?
    @objc func stop(_ sender:Any?) { action?() }
}
struct FeedbackCopyEntry: Decodable { let title:String; let subtitles:[String] }
let feedbackCopy:[String:FeedbackCopyEntry] = {
    let root=URL(fileURLWithPath:CommandLine.arguments[0]).deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent()
    do { return try JSONDecoder().decode([String:FeedbackCopyEntry].self,from:Data(contentsOf:root.appendingPathComponent("assets/feedback-copy.json"))) }
    catch { fatalError("Feedback copy catalog unavailable: \(error)") }
}()

// Visual feedback owns only non-activating, mouse-transparent panels.
// It never moves the system cursor or changes application focus.
final class FeedbackPanel: NSPanel {
    override var canBecomeKey: Bool { false }
    override var canBecomeMain: Bool { false }
}
final class GhostPointerView: NSView {
    var ring: CGFloat = 0
    override var isFlipped: Bool { true }
    override func draw(_ dirtyRect:NSRect) {
        if ring > 0 {
            let r=10+ring*17
            let circle=NSBezierPath(ovalIn:NSRect(x:28-r,y:28-r,width:r*2,height:r*2))
            NSColor(calibratedRed:0.30,green:0.87,blue:1,alpha:1-ring).setStroke()
            circle.lineWidth=2; circle.stroke()
        }
        let shadow=NSShadow(); shadow.shadowColor=NSColor.systemCyan.withAlphaComponent(0.70)
        shadow.shadowBlurRadius=11; shadow.shadowOffset = .zero
        NSGraphicsContext.saveGraphicsState(); shadow.set()
        let p=NSBezierPath(); p.move(to:NSPoint(x:28,y:28)); p.line(to:NSPoint(x:37,y:53))
        p.curve(to:NSPoint(x:42,y:53),controlPoint1:NSPoint(x:38,y:57),controlPoint2:NSPoint(x:41,y:56))
        p.line(to:NSPoint(x:46,y:43)); p.line(to:NSPoint(x:54,y:40))
        p.curve(to:NSPoint(x:54,y:35),controlPoint1:NSPoint(x:58,y:38),controlPoint2:NSPoint(x:57,y:35))
        p.line(to:NSPoint(x:31,y:27)); p.close()
        NSColor(calibratedRed:0.18,green:0.43,blue:0.52,alpha:0.85).setFill(); p.fill()
        NSColor(calibratedRed:0.85,green:0.98,blue:1,alpha:0.98).setStroke()
        p.lineWidth=2.6; p.lineJoinStyle = .round; p.stroke(); NSGraphicsContext.restoreGraphicsState()
    }
}
final class DesktopFeedback {
    let remote=feedbackRemoteDirectory
    var titleLabel:NSTextField?
    var subtitleLabel:NSTextField?
    let theme="glass"
    var glassStyle="native_frosted_glass"
    var phase="idle",phaseToken=""
    var phaseSince=ProcessInfo.processInfo.systemUptime
    init() { if remote == nil { NSApplication.shared.setActivationPolicy(.accessory) } }
    func send(_ op:String,_ values:[String:Any]=[:])->[String:Any]? {
        guard let folder=remote else { return nil }
        if FileManager.default.fileExists(atPath:folder.deletingLastPathComponent().appendingPathComponent("cancel.json").path) { return nil }
        let fd=open(folder.appendingPathComponent("ipc.lock").path,O_CREAT | O_RDWR,0o600)
        guard fd >= 0 else { return nil }
        defer { flock(fd,LOCK_UN);Darwin.close(fd) }
        guard flock(fd,LOCK_EX | LOCK_NB) == 0 else { return nil }
        let seq=UUID().uuidString
        let payload=values.merging(["seq":seq,"op":op]) { _,new in new }
        guard let data=try? JSONSerialization.data(withJSONObject:payload),
              (try? data.write(to:folder.appendingPathComponent("command.json"),options:.atomic)) != nil else { return nil }
        let until=Date().addingTimeInterval(4)
        while Date()<until {
            if FileManager.default.fileExists(atPath:folder.deletingLastPathComponent().appendingPathComponent("cancel.json").path) { return nil }
            if let reply=try? Data(contentsOf:folder.appendingPathComponent("reply.json")),
               let object=(try? JSONSerialization.jsonObject(with:reply)) as? [String:Any],object["seq"] as? String == seq { return object }
            RunLoop.current.run(until:Date().addingTimeInterval(0.01))
        }
        return nil
    }
    let stopTarget=StopTarget()
    var stopPanel:FeedbackPanel?
    var stopButton:NSButton?
    var onStop:(()->Void)?
    var banner:FeedbackPanel?
    var pointer:FeedbackPanel?
    var pointerView:GhostPointerView?
    var lastPoint:CGPoint?
    var animated=false
    var pulsed=false
    var shown=false
    let reduceMotion=NSWorkspace.shared.accessibilityDisplayShouldReduceMotion
    func panel(_ frame:NSRect)->FeedbackPanel {
        let p=FeedbackPanel(contentRect:frame,styleMask:[.borderless,.nonactivatingPanel],backing:.buffered,defer:false)
        p.level = .floating; p.ignoresMouseEvents=true; p.sharingType = ProcessInfo.processInfo.environment["CRAWSHRIMP_CU_FEEDBACK_CAPTURE"] == "1" ? .readOnly : .none
        p.backgroundColor = .clear; p.isOpaque=false; p.hasShadow=true
        p.collectionBehavior=[.transient,.ignoresCycle]
        return p
    }
    func show(_ borrowed:Bool,background:Bool=true) {
        if remote != nil { shown=send("show",["borrowed":borrowed,"background":background]) != nil;return }
        setPhase(borrowed ? "borrowed" : (background ? "background" : "foreground"))
    }
    func liquidSurface(_ content:NSView)->NSView? {
        #if compiler(>=6.2)
        if #available(macOS 26.0, *) {
            let glass=NSGlassEffectView(frame:content.bounds)
            glass.style = .clear
            glass.cornerRadius=22
            glass.tintColor=nil
            glass.contentView=content;glassStyle="native_liquid_glass";return glass
        }
        #endif
        return nil
    }
    func ensureBanner() {
        if banner != nil { return }
        banner?.orderOut(nil)
        let screen=NSScreen.main?.visibleFrame ?? .zero
        let p=panel(NSRect(x:screen.midX-230,y:screen.maxY-84,width:460,height:64))
        p.hasShadow=false
        let content=NSView(frame:NSRect(x:0,y:0,width:460,height:64))
        let surface:NSView
        if let glass=liquidSurface(content) {
            surface=glass
        } else {
            let glass=NSVisualEffectView(frame:content.bounds)
            glass.material = .popover;glass.blendingMode = .behindWindow;glass.state = .active
            glass.wantsLayer=true;glass.layer?.cornerRadius=22;glass.layer?.masksToBounds=true
            glass.addSubview(content);surface=glass
        }
        let icon=NSTextField(labelWithString:"🦐"); icon.font = .systemFont(ofSize:25); icon.frame=NSRect(x:20,y:18,width:40,height:32)
        let title=NSTextField(labelWithString:"")
        title.font = .systemFont(ofSize:14,weight:.semibold); title.textColor = .labelColor; title.frame=NSRect(x:68,y:32,width:235,height:20)
        let subtitle=NSTextField(labelWithString:"")
        subtitle.font = .systemFont(ofSize:11); subtitle.textColor = .secondaryLabelColor; subtitle.frame=NSRect(x:68,y:13,width:280,height:17)
        for view in [icon,title,subtitle] { content.addSubview(view) }
        titleLabel=title;subtitleLabel=subtitle
        p.contentView=surface; p.orderFrontRegardless(); banner=p; shown=true
        // Only this small panel receives clicks. The banner and pointer remain
        // mouse-transparent across processes, not merely NSView hit-test nil.
        if onStop != nil {
            let buttonPanel=panel(NSRect(x:p.frame.minX+380,y:p.frame.minY+16,width:64,height:32))
            buttonPanel.ignoresMouseEvents=false;buttonPanel.hasShadow=false
            let button=NSButton(title:"■ 停止",target:stopTarget,action:#selector(StopTarget.stop(_:)))
            button.frame=NSRect(x:0,y:0,width:64,height:32);button.bezelStyle = .rounded
            button.font = .systemFont(ofSize:12,weight:.medium)
            button.setAccessibilityLabel("停止 AI 桌面操作")
            button.toolTip="停止当前桌面任务，已执行的操作不会撤回"
            stopTarget.action={ [weak self] in self?.onStop?() }
            buttonPanel.contentView=button;buttonPanel.orderFrontRegardless()
            stopPanel=buttonPanel;stopButton=button
        }
    }
    func locate(_ point:CGPoint, check:()->Bool) {
        if remote != nil { if check() { _=send("locate",["x":point.x,"y":point.y]);lastPoint=point;animated = !reduceMotion };return }
        let p=pointer ?? panel(.zero); let view=pointerView ?? GhostPointerView(frame:NSRect(x:0,y:0,width:84,height:84))
        p.hasShadow=false
        p.contentView=view; pointer=p; pointerView=view
        let origin=lastPoint ?? CGEvent(source:nil)?.location ?? point
        let top=NSScreen.screens.first?.frame.maxY ?? 0
        let frames=reduceMotion ? 1 : 16
        for i in 1...frames {
            if !check() { return }
            let t=CGFloat(i)/CGFloat(frames); let smooth=t*t*(3-2*t)
            let position=CGPoint(x:origin.x+(point.x-origin.x)*smooth,y:origin.y+(point.y-origin.y)*smooth)
            p.setFrame(NSRect(x:position.x-28,y:top-position.y-56,width:84,height:84),display:true)
            p.orderFrontRegardless()
            RunLoop.current.run(until:Date().addingTimeInterval(reduceMotion ? 0.001 : 0.012))
        }
        lastPoint=point; animated = !reduceMotion
    }
    func pulse(_ check:()->Bool) {
        if remote != nil { if check() { _=send("pulse");pulsed=true };return }
        guard let view=pointerView else { return }; pulsed=true
        for i in 1...(reduceMotion ? 1 : 12) {
            if !check() { break }
            view.ring=reduceMotion ? 0.4 : CGFloat(i)/12; view.needsDisplay=true
            RunLoop.current.run(until:Date().addingTimeInterval(0.015))
        }
        view.ring=0; view.needsDisplay=true
    }
    @discardableResult
    func setPhase(_ name:String,token:String="",ifToken:String?=nil)->Bool {
        guard feedbackCopy[name] != nil,ifToken == nil || ifToken == phaseToken else { return false }
        phase=name;phaseToken=token;phaseSince=ProcessInfo.processInfo.systemUptime
        ensureBanner();tick();return true
    }
    func tick() {
        var elapsed=max(0,ProcessInfo.processInfo.systemUptime-phaseSince)
        if phase != "idle" && elapsed >= 60 {
            phase="idle";phaseToken="";phaseSince=ProcessInfo.processInfo.systemUptime;elapsed=0
        }
        guard let copy=feedbackCopy[phase],!copy.subtitles.isEmpty else { return }
        let index=reduceMotion ? 0 : Int(elapsed/6) % copy.subtitles.count
        if titleLabel?.stringValue != copy.title { titleLabel?.stringValue=copy.title }
        if subtitleLabel?.stringValue != copy.subtitles[index] { subtitleLabel?.stringValue=copy.subtitles[index] }
    }
    func idle() { setPhase("idle") }
    func close() {
        if remote != nil { _=send("idle");return }
        pointer?.orderOut(nil);banner?.orderOut(nil);stopPanel?.orderOut(nil);pointer=nil;banner=nil;stopPanel=nil;stopButton=nil
    }
    var report:[String:Any] { ["stop_button":stopButton != nil,"shown":shown,"style":glassStyle,"theme":theme,"pointer_animated":animated,"click_pulse":pulsed,"system_cursor_moved":false,"takes_focus":false,"reduced_motion":reduceMotion,"resident":remote != nil,"phase":phase,"phase_token":phaseToken,"title":titleLabel?.stringValue ?? "","subtitle":subtitleLabel?.stringValue ?? ""] }
    deinit { close() }
}

func serveFeedback(_ path:String) {
    let folder=URL(fileURLWithPath:path),visual=DesktopFeedback()
    var lastSeq="",lastCommand=Date(),lastHeartbeat=Date.distantPast,running=true
    func save(_ name:String,_ object:[String:Any]) {
        if let data=try? JSONSerialization.data(withJSONObject:object,options:.sortedKeys) { try? data.write(to:folder.appendingPathComponent(name),options:.atomic) }
    }
    let cancelPath=folder.deletingLastPathComponent().appendingPathComponent("cancel.json")
    func isCancelled()->Bool { FileManager.default.fileExists(atPath:cancelPath.path) }
    visual.onStop={
        if !isCancelled() {
            do {
                let data=try JSONSerialization.data(withJSONObject:["status":"cancelled","source":"user_stop","requested_at":Date().timeIntervalSince1970])
                try data.write(to:cancelPath,options:.atomic)
            } catch {
                visual.subtitleLabel?.stringValue="停止未成功，请重试";return
            }
        }
        visual.stopButton?.isEnabled=false
    }
    if isCancelled() { save("state.json",["status":"cancelled","pid":getpid(),"heartbeat":Date().timeIntervalSince1970]);return }
    visual.show(false)
    if let point=CGEvent(source:nil)?.location { visual.locate(point,check:{true}) }
    visual.idle()
    while running && !isCancelled() && Date().timeIntervalSince(lastCommand)<900 {
        while let event=NSApplication.shared.nextEvent(matching:.any,until:Date.distantPast,inMode:.default,dequeue:true) {
            NSApplication.shared.sendEvent(event)
        }
        if isCancelled() { break }
        if let data=try? Data(contentsOf:folder.appendingPathComponent("command.json")),
           let message=(try? JSONSerialization.jsonObject(with:data)) as? [String:Any],let seq=message["seq"] as? String,seq != lastSeq {
            lastSeq=seq;lastCommand=Date()
            switch message["op"] as? String {
            case "show":visual.show(message["borrowed"] as? Bool ?? false,background:message["background"] as? Bool ?? true)
            case "locate":if let x=message["x"] as? Double,let y=message["y"] as? Double { visual.locate(CGPoint(x:x,y:y),check:{ !isCancelled() }) }
            case "pulse":visual.pulse({ !isCancelled() })
            case "phase":visual.setPhase(message["phase"] as? String ?? "idle",token:seq)
            case "idle":visual.setPhase("idle",token:seq,ifToken:message["if_phase"] as? String)
            case "stop":running=false
            default:break
            }
            visual.tick()
            save("reply.json",["seq":seq,"pid":getpid(),"status":running ? "running" : "stopping","feedback":visual.report.merging(["resident":true]) { _,new in new },"position":visual.lastPoint.map { ["x":$0.x,"y":$0.y] } as Any? ?? NSNull()])
        }
        visual.tick()
        if Date().timeIntervalSince(lastHeartbeat)>0.5 {
            save("state.json",["pid":getpid(),"status":"running","heartbeat":Date().timeIntervalSince1970,"last_command":lastCommand.timeIntervalSince1970,"feedback":visual.report]);lastHeartbeat=Date()
        }
        RunLoop.current.run(until:Date().addingTimeInterval(0.02))
    }
    visual.close();save("state.json",["pid":getpid(),"status":isCancelled() ? "cancelled" : "stopped","heartbeat":Date().timeIntervalSince1970])
}
