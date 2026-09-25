import test from 'node:test';
import assert from 'node:assert/strict';
import { cameraModal } from '../camera-modal.js';
function modalHarness() {
 const handlers=new Map();const doc={activeElement:null,addEventListener(t,cb){if(!handlers.has(t))handlers.set(t,new Set());handlers.get(t).add(cb);},removeEventListener(t,cb){handlers.get(t)?.delete(cb);}};
 const node=()=>({inert:false,tabIndex:0,isConnected:true,focus(){doc.activeElement=this;},setAttribute(){},removeAttribute(){}});
 const outside=node(),earlier=node(),a=node(),b=node(),panel=node(); earlier.inert=true;
 panel.contains=n=>n===panel||n===a||n===b;panel.querySelectorAll=()=>[a,b];
 const section={children:[panel,outside]},body={children:[section,earlier]};panel.parentElement=section;section.parentElement=body;
 const modal=cameraModal(panel,outside,doc);doc.activeElement=outside;
 return {modal,panel,outside,earlier,a,b,doc,send(event){for(const cb of [...handlers.get(event.type)||[]])cb(event);}};
}
test('camera modal makes every background branch inert and restores pre-existing state',()=>{
 const h=modalHarness();h.modal.open();assert.equal(h.outside.inert,true);assert.equal(h.earlier.inert,true);
 h.modal.close();assert.equal(h.outside.inert,false);assert.equal(h.earlier.inert,true);assert.equal(h.doc.activeElement,h.outside);
 h.modal.close();assert.equal(h.outside.inert,false);
});
test('camera modal wraps Tab and Shift+Tab and redirects escaped focus',()=>{
 const h=modalHarness();h.modal.open();h.a.focus();let prevented=0;
 h.send({type:'keydown',key:'Tab',shiftKey:true,preventDefault(){prevented++;}});assert.equal(h.doc.activeElement,h.b);
 h.send({type:'keydown',key:'Tab',preventDefault(){prevented++;}});assert.equal(h.doc.activeElement,h.a);assert.equal(prevented,2);
 h.outside.focus();h.send({type:'focusin',target:h.outside});assert.equal(h.doc.activeElement,h.a);h.modal.close();
});
