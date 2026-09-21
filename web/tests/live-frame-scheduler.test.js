import test from 'node:test';
import assert from 'node:assert/strict';
import { createFrameScheduler } from '../live-frame-scheduler.js';
function harness(native=true) {
  let time=0,serial=0,callbackSerial=0,pace=100;
  const timers=new Map(),callbacks=new Map(),frames=[],beats=[],errors=[];
  const video={videoWidth:640,videoHeight:480,currentTime:0};
  if(native){video.requestVideoFrameCallback=fn=>{callbacks.set(++callbackSerial,fn);return callbackSerial;};video.cancelVideoFrameCallback=id=>callbacks.delete(id);}
  const scheduler=createFrameScheduler({video,onFrame:meta=>frames.push(meta),onHeartbeat:()=>beats.push(scheduler.fresh),onError:e=>errors.push(e),
    now:()=>time,interval:()=>pace,setTimer(fn,ms){timers.set(++serial,{fn,at:time+ms});return serial;},clearTimer:id=>timers.delete(id)});
  function advance(ms){const end=time+ms;for(;;){const next=[...timers].filter(([,j])=>j.at<=end).sort((a,b)=>a[1].at-b[1].at)[0];if(!next)break;time=next[1].at;timers.delete(next[0]);next[1].fn();}time=end;}
  function present(count){const next=[...callbacks][0];callbacks.delete(next[0]);next[1](time,{presentedFrames:count,mediaTime:0});}
  return {scheduler,video,callbacks,timers,frames,beats,errors,advance,present,pace(v){pace=v;}};
}
test('live mediaTime zero does not suppress genuinely new presented frames',()=>{
 const h=harness();h.scheduler.start();h.present(1);h.advance(100);h.present(2);assert.equal(h.frames.length,2);h.scheduler.stop();
});
test('duplicate and out-of-order frame callbacks never refresh freshness or submit work',()=>{
 const h=harness();h.scheduler.start();h.present(5);h.advance(400);h.present(5);h.present(4);h.advance(200);
 assert.equal(h.scheduler.fresh,false);assert.equal(h.frames.length,1);assert.equal(h.scheduler.stats.duplicates,2);h.scheduler.stop();
});
test('load pacing caps image work without accumulating a queue or inventing frames',()=>{
 const h=harness();h.scheduler.start();h.pace(250);h.present(1);
 for(let i=2;i<=16;i++){h.advance(20);h.present(i);}
 assert.equal(h.frames.length,2);assert.equal(h.callbacks.size,1);assert.equal(h.scheduler.stats.skipped,14);
 h.pace(9999);assert.equal(h.scheduler.stats.intervalMilliseconds,300);h.pace(0);assert.equal(h.scheduler.stats.intervalMilliseconds,100);h.scheduler.stop();
});
test('independent heartbeat still expires a view when native frame callbacks stop',()=>{
 const h=harness();h.scheduler.start();h.present(1);h.advance(600);assert.equal(h.scheduler.fresh,false);assert.equal(h.beats.at(-1),false);
 assert.equal(h.frames.length,1);h.scheduler.stop();assert.equal(h.timers.size,0);assert.equal(h.callbacks.size,0);
});
test('fallback currentTime processes only changed video times',()=>{
 const h=harness(false);h.scheduler.start();h.advance(100);assert.equal(h.frames.length,1);h.advance(500);
 assert.equal(h.frames.length,1);h.advance(100);assert.equal(h.scheduler.fresh,false);
 h.video.currentTime=.5;h.advance(100);assert.equal(h.frames.length,2);h.scheduler.stop();
});
test('fallback decoded frame counts take precedence over an advancing media clock',()=>{
 const h=harness(false);let count=3;h.video.getVideoPlaybackQuality=()=>({totalVideoFrames:count});h.scheduler.start();h.advance(100);
 h.video.currentTime=5;h.advance(600);assert.equal(h.frames.length,1);assert.equal(h.scheduler.fresh,false);
 count++;h.advance(100);assert.equal(h.frames.length,2);h.scheduler.stop();
});
test('no frame metadata never becomes a perpetual fresh-video fallback',()=>{
 const h=harness(false);delete h.video.currentTime;h.scheduler.start();h.advance(1000);assert.equal(h.frames.length,0);assert.equal(h.scheduler.fresh,false);h.scheduler.stop();
});
test('stopping and restarting fences a deliberately late native callback',()=>{
 const h=harness();h.scheduler.start();const obsolete=[...h.callbacks.values()][0];h.scheduler.stop();h.scheduler.start();
 obsolete(0,{presentedFrames:55});assert.equal(h.frames.length,0);assert.equal(h.callbacks.size,1);
 h.present(1);assert.equal(h.frames.length,1);h.scheduler.stop();
});
test('an unusable native callback API falls back without stopping the watchdog',()=>{
 const h=harness();h.video.requestVideoFrameCallback=()=>{throw Error('unsupported');};h.scheduler.start();h.advance(100);
 assert.equal(h.frames.length,1);assert.equal(h.scheduler.stats.mode,'fallback');h.scheduler.stop();
});
test('repeated starts maintain one heartbeat and one native request',()=>{
 const h=harness();h.scheduler.start();h.scheduler.start();assert.equal(h.timers.size,1);assert.equal(h.callbacks.size,1);h.scheduler.stop();
});

for (const native of [true, false]) test(`paused video cannot be refreshed by an advancing frame counter, native ${native}`, () => {
 const h=harness(native);h.scheduler.start();if(native)h.present(1);else h.advance(100);
 h.video.paused=true;h.video.currentTime=10;h.advance(400);if(native)h.present(2);h.advance(200);
 assert.equal(h.frames.length,1);assert.equal(h.scheduler.fresh,false);
 h.video.paused=false;h.video.currentTime=11;if(native)h.present(3);else h.advance(100);
 assert.equal(h.frames.length,2);h.scheduler.stop();
});

test('silent native callbacks recover only after independent presented counters advance',()=>{
 const h=harness();let count=1;h.video.getVideoPlaybackQuality=()=>({totalVideoFrames:count,droppedVideoFrames:0});
 h.scheduler.start();h.present(1);const late=[...h.callbacks.values()][0];
 for(let i=0;i<12;i++){count++;h.advance(100);}
 assert.equal(h.scheduler.stats.mode,'fallback');assert.equal(h.scheduler.stats.fallbacks,1);
 const frames=h.frames.length;late(0,{presentedFrames:999});assert.equal(h.frames.length,frames);
 assert.equal(h.callbacks.size,0);h.scheduler.stop();
});
test('silent native API is not bypassed using only elapsed media time or dropped frames',()=>{
 for(const dropped of [false,true]){
  const h=harness();let count=1;if(dropped)h.video.getVideoPlaybackQuality=()=>({totalVideoFrames:count,droppedVideoFrames:count-1});
  h.scheduler.start();h.present(1);
  for(let i=0;i<20;i++){h.video.currentTime++;count++;h.advance(100);}
  assert.equal(h.scheduler.stats.mode,'video-frame');assert.equal(h.scheduler.fresh,false);h.scheduler.stop();
 }
});
test('a frozen independent counter cannot switch a silent native source to fallback',()=>{
 const h=harness();h.video.getVideoPlaybackQuality=()=>({totalVideoFrames:10,droppedVideoFrames:0});
 h.scheduler.start();h.present(1);h.advance(5000);assert.equal(h.scheduler.stats.fallbacks,0);assert.equal(h.frames.length,1);h.scheduler.stop();
});

test('old independent advances cannot manufacture freshness later at the fallback deadline',()=>{
 const h=harness();let count=1;h.video.getVideoPlaybackQuality=()=>({totalVideoFrames:count});
 h.scheduler.start();h.present(1);h.advance(500);count++;h.advance(100);count++;h.advance(100);h.advance(500);
 assert.equal(h.scheduler.stats.fallbacks,0);assert.equal(h.scheduler.fresh,false);
 count++;h.advance(100);assert.equal(h.scheduler.stats.fallbacks,1);h.scheduler.stop();
});
