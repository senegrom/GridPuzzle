// Dependency-free experimental inference. Not imported by the production scanner.
const SHAPES = [[8,1,3,3],[8],[16,8,3,3],[16],[32,784],[32],[11,32],[11]];
const NAMES = ['conv1.weight','conv1.bias','conv2.weight','conv2.bias','fc1.weight','fc1.bias','fc2.weight','fc2.bias'];
const COUNT = 26731;
export function normalizeGray(gray, width, height) {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width<1 || height<1 ||
      width>4096 || height>4096 || gray?.length!==width*height)
    throw new TypeError('Invalid grayscale crop dimensions');
  const values=Float32Array.from(gray);
  if (values.some(v=>!Number.isFinite(v)||v<0||v>255)) throw new TypeError('Grayscale must be finite and in [0,255]');
  const sorted=values.slice().sort();
  const hi=sorted[Math.floor((values.length-1)*.95)],lo=sorted[Math.floor((values.length-1)*.05)];
  const denominator=Math.max(32,hi-lo);
  for(let i=0;i<values.length;i++) values[i]=Math.max(0,Math.min(1,(hi-values[i])/denominator));
  const scale=24/Math.max(width,height),w=Math.max(1,Math.round(width*scale)),h=Math.max(1,Math.round(height*scale));
  const out=new Float32Array(784),left=Math.floor((28-w)/2),top=Math.floor((28-h)/2);
  for(let y=0;y<h;y++) {
    const sy=Math.max(0,Math.min(height-1,(y+.5)*height/h-.5)),y0=Math.floor(sy),y1=Math.min(y0+1,height-1),dy=sy-y0;
    for(let x=0;x<w;x++) {
      const sx=Math.max(0,Math.min(width-1,(x+.5)*width/w-.5)),x0=Math.floor(sx),x1=Math.min(x0+1,width-1),dx=sx-x0;
      out[(top+y)*28+left+x]=(values[y0*width+x0]*(1-dx)+values[y0*width+x1]*dx)*(1-dy)+
        (values[y1*width+x0]*(1-dx)+values[y1*width+x1]*dx)*dy;
    }
  }
  return out;
}
function convPool(input, size, channels, outputs, weights, bias) {
  const next=size/2,out=new Float32Array(outputs*next*next);
  for(let oc=0;oc<outputs;oc++) for(let y=0;y<next;y++) for(let x=0;x<next;x++) {
    let maximum=0;
    for(let py=0;py<2;py++) for(let px=0;px<2;px++) {
      let sum=bias[oc],iy=2*y+py,ix=2*x+px;
      for(let ic=0;ic<channels;ic++) for(let ky=0;ky<3;ky++) {
        const sy=iy+ky-1;if(sy<0||sy>=size) continue;
        for(let kx=0;kx<3;kx++) {
          const sx=ix+kx-1;if(sx<0||sx>=size) continue;
          sum+=input[(ic*size+sy)*size+sx]*weights[((oc*channels+ic)*3+ky)*3+kx];
        }
      }
      maximum=Math.max(maximum,sum);
    }
    out[(oc*next+y)*next+x]=maximum;
  }
  return out;
}
function dense(input, weights, bias, relu=false) {
  const out=new Float32Array(bias.length);
  for(let j=0;j<out.length;j++) {
    let sum=bias[j];for(let k=0;k<input.length;k++) sum+=weights[j*input.length+k]*input[k];
    out[j]=relu?Math.max(0,sum):sum;
  }
  return out;
}
export function createModel(manifest, bytes) {
  if(manifest?.format!=='gridpuzzle-tiny-digit-v1'||manifest.parameters!==COUNT||
    JSON.stringify(manifest.labels)!==JSON.stringify([...Array(10).keys()].map(String).concat('reject'))||
    !(bytes instanceof ArrayBuffer)||bytes.byteLength!==COUNT*4||manifest.tensors?.length!==8)
    throw new TypeError('Invalid tiny digit model');
  const view=new DataView(bytes),all=new Float32Array(COUNT);
  for(let i=0;i<COUNT;i++) {all[i]=view.getFloat32(i*4,true);if(!Number.isFinite(all[i])) throw new TypeError('Non-finite model weight');}
  const tensors=[];let offset=0;
  for(let i=0;i<8;i++) {
    const length=SHAPES[i].reduce((a,b)=>a*b,1),t=manifest.tensors[i];
    if(t.name!==NAMES[i]||t.offset!==offset||t.length!==length||JSON.stringify(t.shape)!==JSON.stringify(SHAPES[i]))
      throw new TypeError('Invalid tensor shape or offset');
    tensors.push(all.subarray(offset,offset+length));offset+=length;
  }
  const logits=(pixels)=>{
    if(pixels?.length!==784||Array.from(pixels).some(x=>!Number.isFinite(x)||x<0||x>1))
      throw new TypeError('Expected 784 finite pixels in [0,1]');
    const one=convPool(pixels,28,1,8,tensors[0],tensors[1]);
    const two=convPool(one,14,8,16,tensors[2],tensors[3]);
    return dense(dense(two,tensors[4],tensors[5],true),tensors[6],tensors[7]);
  };
  return Object.freeze({logits,predict(pixels) {
    const scores=logits(pixels),max=Math.max(...scores),exps=Array.from(scores,x=>Math.exp(x-max)),sum=exps.reduce((a,b)=>a+b,0);
    const probabilities=exps.map(x=>x/sum),order=[...probabilities.keys()].sort((a,b)=>probabilities[b]-probabilities[a]);
    return {label:manifest.labels[order[0]],digit:order[0]<10?order[0]:null,score:probabilities[order[0]],
      margin:probabilities[order[0]]-probabilities[order[1]],probabilities}; // Scores are NOT calibrated probabilities of correctness.
  }});
}
export async function loadModel(url=new URL('./artifacts/model.json',import.meta.url)) {
  const response=await fetch(url);if(!response.ok) throw new Error(`Model metadata HTTP ${response.status}`);
  const manifest=await response.json(),wr=await fetch(new URL('./weights.f32',url));
  if(!wr.ok) throw new Error(`Model weights HTTP ${wr.status}`);
  const bytes=await wr.arrayBuffer();
  const digest=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),b=>b.toString(16).padStart(2,'0')).join('');
  if(digest!==manifest.weights_sha256) throw new Error('Model checksum mismatch');
  return createModel(manifest,bytes);
}
