import {findGrid,warp,sharpness,estimateGrid} from './geometry.js';
self.onmessage=({data:m})=>{
  try{
    if(m.op==='detect')self.postMessage({id:m.id,result:{...findGrid(m.image),sharpness:sharpness(m.image)}});
    else if(m.op==='warp'){
      const image=warp(m.image,m.corners,m.width,m.height),meta=estimateGrid(image);
      self.postMessage({id:m.id,result:{image,meta}},[image.data.buffer]);
    }else throw Error('Unknown geometry task');
  }catch(error){self.postMessage({id:m.id,error:error.message});}
};
