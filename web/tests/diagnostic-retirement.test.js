import test from 'node:test';
import assert from 'node:assert/strict';
import { createScanDiagnostics } from '../scan-diagnostics.js';
import { setupDiagnosticsUI } from '../diagnostics-ui.js';

// A transient source is a frame drawn only for this report (the live camera
// without an adopted frame): it is released once encoded. A kept source, the
// adopted or frozen frame or the editor's photograph, is left alone.
test('a transient diagnostic source is released once encoded; a kept one is not', t => {
 const previous={window:globalThis.window,document:globalThis.document};
 globalThis.window={addEventListener(){}};
 globalThis.document={createElement:()=>({width:0,height:0,getContext:()=>({drawImage(){}}),toDataURL:()=>'data:image/jpeg;base64,AAAA'})};
 t.after(()=>{for(const [key,value] of Object.entries(previous)){if(value===undefined)delete globalThis[key];else globalThis[key]=value;}});
 const nodes=new Map(),get=key=>{if(!nodes.has(key))nodes.set(key,{textContent:'',checked:false,removeAttribute(key){delete this[key];}});return nodes.get(key);};
 const panel={querySelector(selector){return get(selector.match(/"([^"\]]+)"/)[1]);},addEventListener(){}};
 const diagnostics=createScanDiagnostics();let source=null;
 setupDiagnosticsUI({$:id=>id==='live-diagnostics'?panel:null,diagnostics,getSource:()=>source});
 diagnostics.begin('live',{});diagnostics.event({stage:'reading',reason:'full-read'});
 for(const transient of [true,false]){
  source={image:{width:640,height:480},verified:false,...(transient?{transient}:{})};
  get('image-toggle').checked=true;get('image-toggle').onchange();
  assert.equal(get('download').disabled,false,get('error').textContent);
  assert.equal(get('image').src,'data:image/jpeg;base64,AAAA');
  assert.deepEqual([source.image.width,source.image.height],transient?[0,0]:[640,480]);
 }
});

test('a new scan or camera close clears a prepared report and resets image consent', t => {
 const previous=globalThis.window;
 globalThis.window={addEventListener(){}};
 t.after(()=>{if(previous===undefined)delete globalThis.window;else globalThis.window=previous;});
 const nodes=new Map(),get=key=>{if(!nodes.has(key))nodes.set(key,{textContent:'',checked:false,removeAttribute(key){delete this[key];}});return nodes.get(key);};
 const panel={querySelector(selector){return get(selector.match(/"([^"\]]+)"/)[1]);},addEventListener(){}};
 const diagnostics=createScanDiagnostics();
 setupDiagnosticsUI({$:id=>id==='scan-diagnostics'?panel:null,diagnostics,getSource:()=>({image:null,verified:false})});
 for(const next of [()=>diagnostics.begin('photo',{}),()=>diagnostics.event({stage:'tracking',reason:'stopped'})]){
  diagnostics.begin('live',{});diagnostics.event({stage:'reading',reason:'full-read'});
  get('prepare').onclick();assert.equal(get('download').disabled,false);
  get('image-toggle').checked=true;get('image').src='retired image';
  next();assert.equal(get('download').disabled,true);assert.equal(get('preview').textContent,'');
  assert.equal(get('image-toggle').checked,false);assert.equal(get('image').src,undefined);
 }
});
