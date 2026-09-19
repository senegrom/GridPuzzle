import test from 'node:test';
import assert from 'node:assert/strict';
import { createScanDiagnostics } from '../scan-diagnostics.js';
import { setupDiagnosticsUI } from '../diagnostics-ui.js';

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
