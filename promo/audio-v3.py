# Place the measured peaks of synthesized UI sounds on the film's event times.
import argparse
import json
from pathlib import Path
import wave

import numpy as np

here = Path(__file__).resolve().parent
parser = argparse.ArgumentParser()
parser.add_argument('--events', type=Path, default=here / '.v3-build' / 'events.json')
parser.add_argument('--output', type=Path, default=here / '.v3-build' / 'audio3_raw.wav')
args = parser.parse_args()
try:
    timeline = json.loads(args.events.read_text(encoding='utf-8'))
except FileNotFoundError:
    parser.error('Generate the v3 timeline first with node render-60fps.cjs --events-only')

SR=48000; DUR=timeline['duration']; BEAT=0.5; n=round(SR*DUR)
L=np.zeros(n); R=np.zeros(n); rng=np.random.default_rng(11)
x_=lambda d:np.arange(int(d*SR))/SR
def place(sig,t,g=1.0,pan=0.0):
    pk=int(np.argmax(np.abs(sig))); i=int(round(t*SR))-pk
    a=max(0,i); z=min(n,i+len(sig)); s=sig[a-i:z-i]*g
    L[a:z]+=s*(1-pan); R[a:z]+=s*(1+pan)
def lp(s,k): return np.convolve(s,np.ones(k)/k,'same')
def tone(f,d,dec,h=(1,)):
    x=x_(d); return sum(a*np.sin(2*np.pi*f*(i+1)*x) for i,a in enumerate(h))*np.exp(-x/dec)*np.minimum(1,x/0.002)
SFX={
 'key':  lambda e: np.diff(rng.standard_normal(int(.03*SR)),prepend=0)*np.exp(-x_(.03)/.004)*0.5,
 'click':lambda e: tone(1800,.06,.006)+0.5*tone(900,.06,.012),
 'tick': lambda e: tone(1400,.08,.015)*0.6,
 'word': lambda e: tone(220,.25,.06,(1,.4))+0.3*lp(rng.standard_normal(int(.25*SR)),6)*np.exp(-x_(.25)/.02),
 'send': lambda e: tone(660,.25,.05,(1,.3))+tone(990,.25,.04)*0.6,
 'done': lambda e: tone(880*2**(e.get('i',0)*3/12),.3,.07,(1,.3)),
 'chime':lambda e: tone(1046.5,.8,.22,(1,.5,.2))+tone(1568,.8,.18)*0.4,
 'alert':lambda e: tone(587,.35,.09,(1,.3))+tone(784,.35,.07)*0.6,
 'pop':lambda e: tone(1200*2**(e.get('i',0)*2/12),.15,.035,(1,.2)),
 'msg':lambda e: tone(1568,.2,.05)+tone(1046,.2,.06)*0.5,
 'success':lambda e: tone(1318.5,.8,.2,(1,.4))+tone(1975.5,.8,.15)*0.35,
}
def whoosh():
    d=.8; s=lp(rng.standard_normal(int(d*SR)),18); x=x_(d); return s*(x/d)**2*np.exp(-np.maximum(0,x-.7*d)/.03)
def impact():
    x=x_(1.8); f=42+70*np.exp(-x/.05)
    return np.sin(2*np.pi*np.cumsum(f)/SR)*np.exp(-x/.55)+0.12*rng.standard_normal(len(x))*np.exp(-x/.06)
G={'alert':.22,'pop':.16,'msg':.14,'impact_s':.4,'key':.20,'click':.22,'tick':.10,'word':.30,'send':.25,'done':.20,'chime':.16,'success':.18,'whoosh':.45,'impact':.6}
for e in timeline['events']:
    t=e['t']; ty=e['type']
    if ty=='whoosh': place(whoosh(),t,G[ty])
    elif ty=='impact': place(impact(),t,G[ty])
    elif ty=='impact_s': place(impact()[:int(.8*SR)]*np.linspace(1,0,int(.8*SR)),t,G[ty])
    else: place(SFX[ty](e),t,G[ty],pan=float(rng.uniform(-.15,.15)) if ty=='key' else 0)
# music bed on the same 120 BPM grid: pad per 2 bars, kick on beats, hat on off-beats
def pad(f,d):
    x=x_(d); s=sum(np.sin(2*np.pi*f*k*x)/k**1.7 for k in range(1,6)); return s*np.minimum(1,x/1.0)*np.minimum(1,(d-x)/1.0)
prog=[[110,164.8,220,261.6],[87.3,130.8,174.6,220],[130.8,196,261.6,329.6],[98,146.8,196,246.9]]
for k,t0 in enumerate(np.arange(4.0,58.0,4.0)):
    for j,f in enumerate(prog[k%4]):
        s=pad(f,4.6); i=int(t0*SR); z=min(n,i+len(s)); L[i:z]+=s[:z-i]*.03*(1-(j-1.5)*.25); R[i:z]+=s[:z-i]*.03*(1+(j-1.5)*.25)
for j,f in enumerate([220,277.2,329.6,440]):
    s=pad(f,3.4); i=int(59.5*SR); L[i:i+len(s)]+=s*.045; R[i:i+len(s)]+=s*.045
def kick():
    x=x_(.4); f=48+95*np.exp(-x/.028); return np.sin(2*np.pi*np.cumsum(f)/SR)*np.exp(-x/.13)
def hat():
    s=np.diff(rng.standard_normal(int(.06*SR)),prepend=0); return s*np.exp(-x_(.06)/.012)
for t in np.arange(6.0,53.0,BEAT):
    place(kick(),t,.34); place(hat(),t+BEAT/2,.05,.3)
for t in np.arange(53.5,58.5,BEAT): place(kick(),t,.26)
g=np.minimum(1,np.arange(n)/SR/0.4)*np.minimum(1,(DUR-np.arange(n)/SR)/1.0)
L*=g; R*=g; pk=max(abs(L).max(),abs(R).max()); L*=.9/pk; R*=.9/pk
with wave.open(str(args.output), 'wb') as w:
    w.setnchannels(2)
    w.setsampwidth(2)
    w.setframerate(SR)
    w.writeframes((np.stack([L,R],1)*32767).astype(np.int16).tobytes())
