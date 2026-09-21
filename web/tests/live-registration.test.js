import test from "node:test";
import assert from "node:assert/strict";
import { gridAnchor, matchGrid } from "../live-registration.js";
const width=640,height=720,corners=[{x:80,y:110},{x:560,y:110},{x:560,y:590},{x:80,y:590}];
function board() {
 const data=new Uint8ClampedArray(width*height*4).fill(255),img={width,height,data};
 const rect=(x,y,w,h,v)=>{x*=2;y*=2;w*=2;h*=2;for(let yy=y;yy<y+h;yy++)for(let xx=x;xx<x+w;xx++){const at=(yy*width+xx)*4;data[at]=data[at+1]=data[at+2]=v;}};
 for(let i=0;i<=4;i++){rect(40+i*60,55,2,242,20);rect(40,55+i*60,242,2,20);}
 for(let r=0;r<4;r++)for(let c=0;c<4;c++){
  const x=40+c*60+22,y=55+r*60+19;rect(x,y,4,26,30);rect(x,y,14,4,30);
  if((r+c)%2)rect(x+10,y+12,4,14,30);
 }
 return img;
}
function transform(a,dx=0,dy=0,angle=0) {
 const out={width,height,data:new Uint8ClampedArray(a.data.length).fill(255)},co=Math.cos(angle),si=Math.sin(angle);
 for(let y=1;y<height-2;y++)for(let x=1;x<width-2;x++){
  const xx=x-width/2-dx,yy=y-height/2-dy,sx=co*xx+si*yy+width/2,sy=-si*xx+co*yy+height/2;
  const ix=Math.floor(sx),iy=Math.floor(sy),fx=sx-ix,fy=sy-iy;if(ix<0||iy<0||ix>=width-1||iy>=height-1)continue;
  const at=(iy*width+ix)*4,v=(a.data[at]*(1-fx)+a.data[at+4]*fx)*(1-fy)+(a.data[at+width*4]*(1-fx)+a.data[at+(width+1)*4]*fx)*fy;
  out.data[(y*width+x)*4]=out.data[(y*width+x)*4+1]=out.data[(y*width+x)*4+2]=v;
 }return out;
}
const original=board(),anchor=gridAnchor(original,corners,4,4);
for(const [dx,dy,angle] of [[0,0,0],[1,0,0],[2,0,0],[4,3,0],[-3,2,0],[.4,.3,0],[0,0,.004]])
 test(`registered print survives translation ${dx},${dy} and rotation ${angle}`,()=>{
  const m=matchGrid(anchor,transform(original,dx,dy,angle));assert.ok(m);
  const p=corners[0],expected={x:Math.cos(angle)*(p.x-width/2)-Math.sin(angle)*(p.y-height/2)+width/2+dx,y:Math.sin(angle)*(p.x-width/2)+Math.cos(angle)*(p.y-height/2)+height/2+dy};
  assert.ok(Math.hypot(m.corners[0].x-expected.x,m.corners[0].y-expected.y)<1.3);
 });
function changed(rect) { rect=rect.map((v,i)=>i<4?v*2:v); const img=transform(original,1,1);for(let y=rect[1];y<rect[1]+rect[3];y++)for(let x=rect[0];x<rect[0]+rect[2];x++){const i=(y*width+x)*4;img.data[i]=img.data[i+1]=img.data[i+2]=rect[4];}return img; }
test("unrelated background and timer changes leave the grid matched",()=>assert.ok(matchGrid(anchor,changed([20,10,200,25,10]))));
for(const [name,rect] of [["changed digit",[73,84,12,6,10]],["finger",[123,128,30,50,90]],["erased digit",[180,194,20,35,255]],["small label",[44,58,8,5,200]],["faint boundary mark",[96,139,10,8,205]]])
 test(`${name} cannot hide behind the same fitted rectangle`,()=>assert.equal(matchGrid(anchor,changed(rect)),null));
test("malformed/oversized images and invalid corners cannot become anchors",()=>{
 assert.equal(gridAnchor({width:2000,height:2000,data:[]},corners,4,4),null);
 assert.equal(gridAnchor(original,[...corners].reverse(),4,4),null);
 assert.equal(matchGrid(anchor,{width:1,height:1,data:[]}),null);
 assert.equal(matchGrid(null,original),null);
});
