"""Non-activating glass-style feedback and a visual pointer, separate from OS input."""
import ctypes
from ctypes import wintypes
import math
import os
from pathlib import Path
import time
from functools import lru_cache
import win32api
import win32con
import win32gui
import win32ui
from PIL import Image, ImageDraw, ImageFont, ImageFilter
from feedback_copy import PhaseState
from cancellation import cancel, cancelled, marker


class DesktopFeedback:
    def __init__(self):
        import os
        self.remote=os.environ.get('CRAWSHRIMP_CU_FEEDBACK_DIR')
        self.shown=False;self.animated=False;self.pulsed=False;self.closed=False;self.reduce_motion=False
        if self.remote:return
        self.on_stop=None
        self.stop_button=None
        self.windows=[]
        self.bitmaps=[]
        self.pointer=None
        self.position=None
        self.animated=False
        self.pulsed=False
        self.shown=False
        self.closed=False
        enabled=wintypes.BOOL(True)
        ctypes.windll.user32.SystemParametersInfoW(0x1042,0,ctypes.byref(enabled),0)  # SPI_GETCLIENTAREAANIMATION
        self.reduce_motion=not enabled.value
        self.theme='navy' if os.environ.get('CRAWSHRIMP_CU_FEEDBACK_THEME') == 'navy' else 'glass'
        self.phase_state=PhaseState(self.reduce_motion)
        self.last_frame=None
        self.name=f'CrawshrimpFeedback-{id(self)}'
        wc=win32gui.WNDCLASS(); wc.lpszClassName=self.name;wc.hInstance=win32api.GetModuleHandle(None)
        def window_proc(h,m,w,l):
            if h == self.stop_button:
                if m == win32con.WM_MOUSEACTIVATE: return 3  # MA_NOACTIVATE
                if m == win32con.WM_NCHITTEST: return win32con.HTCLIENT
                if m == win32con.WM_LBUTTONUP and self.on_stop:
                    try: self.on_stop()
                    except Exception: pass  # Leave button available if persistence failed.
                    return 0
            elif m == win32con.WM_NCHITTEST: return win32con.HTTRANSPARENT
            return win32gui.DefWindowProc(h,m,w,l)
        self.proc=window_proc
        wc.lpfnWndProc=self.proc;win32gui.RegisterClass(wc)
        self.instance=wc.hInstance

    def make(self,interactive=False):
        h=win32gui.CreateWindowEx(win32con.WS_EX_LAYERED | win32con.WS_EX_TOOLWINDOW | win32con.WS_EX_TOPMOST | (0 if interactive else win32con.WS_EX_TRANSPARENT) | 0x08000000,
                                 self.name,'停止 AI 桌面操作' if interactive else 'Crawshrimp',win32con.WS_POPUP | (0 if interactive else win32con.WS_DISABLED),0,0,1,1,0,0,self.instance,None)
        self.windows.append(h)
        user=ctypes.WinDLL('user32');user.SetWindowDisplayAffinity.argtypes=[wintypes.HWND,wintypes.DWORD]
        if os.environ.get('CRAWSHRIMP_CU_FEEDBACK_CAPTURE') != '1':
            user.SetWindowDisplayAffinity(h,0x11)
        return h

    def draw(self,hwnd,image,position):
        # UpdateLayeredWindow expects premultiplied BGRA. Keep the alpha edges soft.
        image=image.convert('RGBA'); raw=bytearray(image.tobytes('raw','BGRA'))
        for i in range(0,len(raw),4):
            a=raw[i+3]
            raw[i]=raw[i]*a//255;raw[i+1]=raw[i+1]*a//255;raw[i+2]=raw[i+2]*a//255
        screen=win32gui.GetDC(0);dc=win32ui.CreateDCFromHandle(screen);mem=dc.CreateCompatibleDC()
        class BitmapInfo(ctypes.Structure):
            _fields_=[('size',wintypes.DWORD),('width',wintypes.LONG),('height',wintypes.LONG),('planes',wintypes.WORD),('bits',wintypes.WORD),('compression',wintypes.DWORD),('sizeImage',wintypes.DWORD),('x',wintypes.LONG),('y',wintypes.LONG),('used',wintypes.DWORD),('important',wintypes.DWORD)]
        info=BitmapInfo(ctypes.sizeof(BitmapInfo),image.width,-image.height,1,32,0,0,0,0,0,0)
        gdi=ctypes.WinDLL('gdi32');gdi.CreateDIBSection.argtypes=[wintypes.HDC,ctypes.c_void_p,wintypes.UINT,ctypes.POINTER(ctypes.c_void_p),wintypes.HANDLE,wintypes.DWORD];gdi.CreateDIBSection.restype=wintypes.HBITMAP
        bits=ctypes.c_void_p();bitmap=gdi.CreateDIBSection(mem.GetSafeHdc(),ctypes.byref(info),0,ctypes.byref(bits),None,0)
        if not bitmap: raise OSError('Feedback bitmap unavailable')
        gdi.SelectObject.argtypes=[wintypes.HDC,wintypes.HGDIOBJ];gdi.SelectObject.restype=wintypes.HGDIOBJ
        old=gdi.SelectObject(mem.GetSafeHdc(),bitmap)
        try:
            ctypes.memmove(bits,bytes(raw),len(raw))
            win32gui.UpdateLayeredWindow(hwnd,screen,tuple(map(round,position)),image.size,mem.GetSafeHdc(),(0,0),0,(0,0,255,1),2)
            win32gui.ShowWindow(hwnd,win32con.SW_SHOWNOACTIVATE)
        finally:
            gdi.SelectObject(mem.GetSafeHdc(),old);win32gui.DeleteObject(bitmap);mem.DeleteDC();dc.DeleteDC();win32gui.ReleaseDC(0,screen)
        win32gui.PumpWaitingMessages()

    @lru_cache(maxsize=8)
    def font(self,size):
        import os
        from pathlib import Path
        for name in ('msyh.ttc','segoeui.ttf'):
            path=Path(os.environ.get('WINDIR','C:/Windows'))/'Fonts'/name
            if path.exists(): return ImageFont.truetype(str(path),size)
        return ImageFont.load_default()

    def send(self,op,**values):
        if self.remote and cancelled(marker(Path(self.remote).parent)): return None
        from feedback_session import command
        return command(self.remote,op,**values)

    @lru_cache(maxsize=1)
    def brand_icon(self):
        # Bundle a color emoji asset: GDI/Pillow text cannot reliably render
        # Segoe UI Emoji's color tables on every supported Windows runtime.
        with Image.open(Path(__file__).resolve().parents[2] / 'assets' / 'shrimp-emoji.png') as source:
            return source.convert('RGBA').resize((38,38),Image.Resampling.LANCZOS)

    def show(self,borrowed=False,background=True,idle=False):
        if self.remote:
            self.send('show',borrowed=borrowed,background=background);self.shown=True;return
        self.phase_state.set('idle' if idle else ('borrowed' if borrowed else ('background' if background else 'foreground')))
        self.tick()

    def set_phase(self,phase,token='',if_token=None):
        self.phase_state.set(phase,token,if_token)
        self.tick()

    def tick(self):
        frame=self.phase_state.frame()
        if frame != self.last_frame:
            self.render_banner(frame)
            self.last_frame=frame

    def render_banner(self,frame):
        alpha=242 if self.theme=='navy' else 220
        image=Image.new('RGBA',(480,82));mask=Image.new('L',image.size);d=ImageDraw.Draw(mask);d.rounded_rectangle((8,7,472,72),radius=22,fill=alpha)
        # Windows keeps a translucent fallback on all supported desktop versions.
        # Native blur is compositor-specific; no claim of universal Liquid Glass.
        paint=ImageDraw.Draw(image)
        for y in range(7,73):
            t=(y-7)/66
            start,end=((32,34,49),(20,22,34)) if self.theme=='navy' else ((47,48,54),(30,31,37))
            paint.line((8,y,472,y),fill=tuple(int(a+(b-a)*t) for a,b in zip(start,end))+(alpha,))
        image.putalpha(mask);paint=ImageDraw.Draw(image)
        paint.rounded_rectangle((8,7,472,72),radius=22,outline=(235,238,245,100),width=1)
        image.alpha_composite(self.brand_icon(),(26,21))
        paint.text((78,17),frame['title'],font=self.font(16),fill=(246,253,255,255))
        subtitle=frame['subtitle']
        paint.text((78,43),subtitle,font=self.font(12),fill=(196,200,214,255))
        if not hasattr(self,'banner'):self.banner=self.make()
        left=(win32api.GetSystemMetrics(0)-480)//2
        self.draw(self.banner,image,(left,26));self.shown=True
        if self.on_stop and not self.stop_button:
            self.stop_button=self.make(interactive=True)
            button=Image.new('RGBA',(64,32));d=ImageDraw.Draw(button)
            d.rounded_rectangle((0,0,63,31),radius=11,fill=(255,255,255,32),outline=(245,245,255,90))
            d.rounded_rectangle((10,12,17,19),radius=1,fill=(255,179,142,255))
            d.text((24,7),'停止',font=self.font(12),fill=(250,250,255,255))
            self.draw(self.stop_button,button,(left+392,50))

    def pointer_image(self,ring=0):
        scale=2;image=Image.new('RGBA',(84*scale,84*scale));p=ImageDraw.Draw(image)
        points=[(28,28),(37,54),(41,55),(46,43),(56,39),(55,35),(30,27)]
        points=[(x*scale,y*scale) for x,y in points]
        glow=Image.new('RGBA',image.size);g=ImageDraw.Draw(glow);g.polygon(points,fill=(37,198,250,170));glow=glow.filter(ImageFilter.GaussianBlur(7*scale));image.alpha_composite(glow);p=ImageDraw.Draw(image)
        if ring:
            r=(10+ring*17)*scale;p.ellipse((56-r,56-r,56+r,56+r),outline=(98,227,255,int(255*(1-ring))),width=3)
        p.polygon(points,fill=(49,115,139,240));p.line(points+[points[0]],fill=(218,250,255,255),width=5,joint='curve')
        return image.resize((84,84),Image.Resampling.LANCZOS)

    def locate(self,point,check=lambda:True):
        if self.remote:
            if check():self.send('locate',x=point[0],y=point[1]);self.animated=True
            return
        self.pointer=self.pointer or self.make();origin=self.position or win32gui.GetCursorPos();frames=1 if self.reduce_motion else 16;image=self.pointer_image()
        for i in range(1,frames+1):
            if not check(): return
            t=i/frames;t=t*t*(3-2*t);pos=(origin[0]+(point[0]-origin[0])*t,origin[1]+(point[1]-origin[1])*t)
            self.draw(self.pointer,image,(pos[0]-28,pos[1]-28));time.sleep(.012 if not self.reduce_motion else .001)
        self.position=point;self.animated=not self.reduce_motion

    def pulse(self,check=lambda:True):
        if self.remote:
            if check():self.send('pulse');self.pulsed=True
            return
        if not self.pointer or not self.position:return
        self.pulsed=True
        for i in range(1,13):
            if not check():break
            self.draw(self.pointer,self.pointer_image(.4 if self.reduce_motion else i/12),(self.position[0]-28,self.position[1]-28));time.sleep(.015)
            if self.reduce_motion:break
        self.draw(self.pointer,self.pointer_image(),(self.position[0]-28,self.position[1]-28))

    @property
    def report(self):
        return {'stop_button':bool(self.stop_button) if not self.remote else False,'shown':self.shown,'style':'translucent_glass_fallback','theme':self.theme if not self.remote else 'remote','pointer_animated':self.animated,'click_pulse':self.pulsed,'system_cursor_moved':False,'takes_focus':False,'reduced_motion':self.reduce_motion,'resident':bool(self.remote),**(self.last_frame or {} if not self.remote else {})}

    def idle(self):
        self.show(idle=True)  # Repaint the existing banner; keep pointer and HWNDs alive.

    def close(self):
        if self.closed:return
        if self.remote:
            self.send('idle');self.closed=True;return
        self.closed=True
        for h in self.windows:
            if win32gui.IsWindow(h):win32gui.DestroyWindow(h)
        win32gui.UnregisterClass(self.name,self.instance)


if __name__=='__main__':
    import json,sys,os
    from pathlib import Path
    from common import write_json, read_json
    folder=Path(sys.argv[2]);visual=DesktopFeedback();last_seq='';last=time.time();heartbeat=0;running=True
    visual.on_stop=lambda: cancel(folder.parent)
    try:
        if cancelled(marker(folder.parent)): sys.exit(0)
        visual.show();visual.locate(win32gui.GetCursorPos());visual.idle()
        while running and not cancelled(marker(folder.parent)) and time.time()-last<900:
            try:msg=read_json(folder/'command.json')
            except (FileNotFoundError,json.JSONDecodeError):msg={}
            if msg.get('seq') and msg['seq']!=last_seq:
                last_seq=msg['seq'];last=time.time();op=msg.get('op')
                if op=='show':visual.show(msg.get('borrowed',False),msg.get('background',True))
                elif op=='locate':visual.locate((msg['x'],msg['y']))
                elif op=='pulse':visual.pulse()
                elif op=='phase':visual.set_phase(msg['phase'],msg['seq'])
                elif op=='idle':visual.set_phase('idle',msg['seq'],msg.get('if_phase'))
                elif op=='stop':running=False
                write_json(folder/'reply.json',{'seq':last_seq,'pid':os.getpid(),'status':'running' if running else 'stopping','feedback':{**visual.report,'resident':True},'position':visual.position})
            visual.tick()
            if time.time()-heartbeat>.5:
                write_json(folder/'state.json',{'pid':os.getpid(),'status':'running','heartbeat':time.time(),'last_command':last,'feedback':visual.report});heartbeat=time.time()
            win32gui.PumpWaitingMessages();time.sleep(.02)
    finally:
        visual.close();write_json(folder/'state.json',{'pid':os.getpid(),'status':'cancelled' if cancelled(marker(folder.parent)) else 'stopped','heartbeat':time.time()})
