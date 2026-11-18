import {clamp, seg, eo} from '/core/lib.js';
const canvas=document.querySelector('canvas');
const g=canvas.getContext('2d');
const W=1200,H=630;
const C={bg:'#090b10',white:'#eff2f7',dim:'#a6afbf',muted:'#747e91',line:'rgba(217,227,244,.11)',orange:'#ff7a24'};
const logo=new Image();logo.src='./assets/harness-mark.png';
function font(size,weight=500,mono=false){return `${weight} ${size}px ${mono?'JBMono':'Inter'}, NotoSC, sans-serif`;}
function text(str,x,y,size=16,color=C.white,weight=500,align='left',mono=false){g.font=font(size,weight,mono);g.fillStyle=color;g.textAlign=align;g.textBaseline='alphabetic';g.fillText(str,x,y);}
function rr(x,y,w,h,r=16){g.beginPath();g.roundRect(x,y,w,h,r);}
function line(x1,y1,x2,y2,color=C.line,width=1){g.strokeStyle=color;g.lineWidth=width;g.beginPath();g.moveTo(x1,y1);g.lineTo(x2,y2);g.stroke();}
function pane(x,y,w,h,{main=false,alpha=1}={}){
 g.save();g.globalAlpha=alpha;g.shadowColor='rgba(0,0,0,.65)';g.shadowBlur=main?35:25;g.shadowOffsetY=main?18:10;
 const fill=g.createLinearGradient(x,y,x+w,y+h);fill.addColorStop(0,main?'#252b37':'#1b202a');fill.addColorStop(1,main?'#171c25':'#121720');
 g.fillStyle=fill;rr(x,y,w,h,main?21:17);g.fill();g.shadowColor='transparent';g.strokeStyle=main?'rgba(225,234,249,.21)':C.line;g.lineWidth=1;g.stroke();
 line(x+18,y+1.5,x+w-18,y+1.5,'rgba(255,255,255,.12)');g.restore();
}
function docIcon(x,y,kind){
 g.save();g.lineWidth=1.1;g.strokeStyle='#9ba6b9';g.fillStyle='#232b38';g.beginPath();g.moveTo(x+2,y);g.lineTo(x+19,y);g.lineTo(x+27,y+8);g.lineTo(x+27,y+33);g.quadraticCurveTo(x+27,y+36,x+24,y+36);g.lineTo(x+2,y+36);g.quadraticCurveTo(x-1,y+36,x-1,y+33);g.lineTo(x-1,y+3);g.quadraticCurveTo(x-1,y,x+2,y);g.fill();g.stroke();line(x+19,y,x+19,y+8,'#9ba6b9');line(x+19,y+8,x+27,y+8,'#9ba6b9');
 if(kind==='table'){for(let j=0;j<3;j++)line(x+5,y+15+j*5,x+21,y+15+j*5,'#8d98ab');line(x+12,y+14,x+12,y+27,'#8d98ab');}else{for(let j=0;j<3;j++)line(x+5,y+15+j*5,x+20-(j===2?5:0),y+15+j*5,'#8d98ab');}g.restore();
}
function tick(x,y){g.strokeStyle='#b6bfce';g.lineWidth=1.8;g.beginPath();g.moveTo(x,y);g.lineTo(x+4,y+4);g.lineTo(x+11,y-4);g.stroke();}
function arrow(x,y){g.strokeStyle='#788397';g.lineWidth=1.5;g.beginPath();g.moveTo(x,y);g.lineTo(x+17,y);g.moveTo(x+12,y-4);g.lineTo(x+17,y);g.lineTo(x+12,y+4);g.stroke();}
function browserIcon(x,y){g.strokeStyle='#a7b0c0';g.lineWidth=1.3;rr(x,y,25,21,4);g.stroke();line(x,y+6,x+25,y+6,'#a7b0c0');for(let i=0;i<3;i++){g.fillStyle='#9aa5b7';g.fillRect(x+4+i*4,y+3,1,1);}}
function lift(alpha,dy,draw){g.save();g.globalAlpha=alpha;g.translate(0,dy);draw();g.restore();}
function background(){
 g.fillStyle=C.bg;g.fillRect(0,0,W,H);
 let glow=g.createRadialGradient(620,110,0,620,110,720);glow.addColorStop(0,'rgba(51,64,92,.32)');glow.addColorStop(1,'rgba(9,11,16,0)');g.fillStyle=glow;g.fillRect(0,0,W,H);
 for(let x=24;x<W;x+=48)line(x+.5,0,x+.5,H,`rgba(240,246,255,${(x-24)%192===0?.035:.018})`);
 for(let y=16;y<H;y+=48)line(0,y+.5,W,y+.5,`rgba(240,246,255,${(y-16)%192===0?.035:.018})`);
 const vignette=g.createRadialGradient(600,280,120,600,280,690);vignette.addColorStop(0,'rgba(0,0,0,0)');vignette.addColorStop(1,'rgba(0,0,0,.52)');g.fillStyle=vignette;g.fillRect(0,0,W,H);
}
function inputs(){
 pane(64,321,268,184);
 text('01',84,350,11,C.muted,500,'left',true);text('任务输入',112,351,17,C.dim,600);
 line(84,367,312,367);
 browserIcon(85,386);text('业务后台',125,403,16,C.white,500);
 docIcon(86,433,'table');text('商品表.xlsx',125,456,15,C.white,500);
}
function execution(t){
 pane(356,282,488,252,{main:true});
 text('Harness',380,317,19,C.white,700);text('/ 任务工作区',465,317,16,C.dim,500);
 text('RUN / 001',820,316,10,C.muted,500,'right',true);line(380,333,820,333);
 g.fillStyle='#30394a';rr(380,351,440,52,10);g.fill();g.strokeStyle='rgba(235,242,255,.11)';g.lineWidth=1;g.stroke();
 text('把商品表整理成一份周报',398,384,20,C.white,500);arrow(785,377);
 browserIcon(383,422);text('浏览器执行',422,438,16,C.dim,500);tick(795,432);
 docIcon(384,465,'text');text('整理表格与文件',422,488,16,C.dim,500);if(t>=1.5)tick(795,482);
}
function outputs(){
 pane(868,321,268,184);
 text('03',888,350,11,C.muted,500,'left',true);text('文件交付',916,351,17,C.dim,600);line(888,367,1116,367);
 docIcon(890,382,'table');text('商品汇总.xlsx',932,405,15,C.white,500);
 docIcon(890,440,'text');text('运营周报.docx',932,463,15,C.white,500);
}
window.DUR=3;
window.render=(t)=>{
 canvas.width=innerWidth;canvas.height=innerHeight;g.setTransform(canvas.width/W,0,0,canvas.height/H,0,0);
 background();
 g.save();rr(56,42,42,42,11);g.clip();g.drawImage(logo,56,42,42,42);g.restore();
 text('抓虾 Harness',112,72,27,C.white,700);text('harness.crawshrimp.com',1144,69,13,C.dim,500,'right',true);
 const a='把重复工作，',b='交给智能体。';g.font=font(63,700);const aw=g.measureText(a).width,bw=g.measureText(b).width,start=(W-aw-bw)/2;
 text(a,start,185,63,C.white,700);text(b,start+aw,185,63,C.orange,700);
 text('从一句任务，到浏览器执行与文件交付。',600,232,21,C.dim,500,'center');
 lift(1,0,inputs);
 const centre=eo(seg(t,.1,.85));lift(.18+.82*centre,12*(1-centre),()=>execution(t));
 if(t>=.4)arrow(334,414);
 const deliver=eo(seg(t,.8,1.6));lift(.16+.84*deliver,14*(1-deliver),outputs);
 if(t>=1.2)arrow(846,414);
 text('工作流示意',600,558,11,C.muted,500,'center');
 text('本地优先  /  过程可见  /  脚本复用  /  产物留存',600,595,16,C.dim,500,'center');
};
await Promise.all([new Promise((resolve,reject)=>{if(logo.complete&&logo.naturalWidth)resolve();else{logo.onload=resolve;logo.onerror=reject;}}),document.fonts.ready]);
for(const f of ['500 20px NotoSC','700 63px NotoSC','700 27px Inter','500 13px JBMono'])await document.fonts.load(f);
window.render(2);window.READY=true;
