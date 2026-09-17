"""Offline printed-digit CNN experiment. Never train on scanner reference answers.

Requires Python 3.11+, numpy, Pillow and torch, plus local Noto/Lato training and
DejaVu/Liberation test fonts. Font files are deliberately not bundled.
Run: python train.py --out artifacts --epochs 10
No checkpoint selection or hyperparameter tuning on held-out fonts/photos.
"""
from __future__ import annotations
import argparse, hashlib, json, math, platform, random, time
from functools import lru_cache
from pathlib import Path
import numpy as np
from PIL import Image, ImageDraw, ImageFont, ImageFilter, __version__ as PIL_VERSION
import torch
from torch import nn
TRAIN_PATTERNS=['noto/NotoSans-Regular.ttf','noto/NotoSans-Bold.ttf','noto/NotoSans-Italic.ttf',
 'noto/NotoSerif-Regular.ttf','noto/NotoSerif-Bold.ttf','noto/NotoSerif-Italic.ttf',
 'lato/Lato-Regular.ttf','lato/Lato-Bold.ttf','lato/Lato-Italic.ttf','lato/Lato-Light.ttf']
TEST_PATTERNS=['dejavu/DejaVuSans.ttf','dejavu/DejaVuSans-Bold.ttf',
 'dejavu/DejaVuSerif.ttf','dejavu/DejaVuSerif-Italic.ttf',
 'liberation2/LiberationSans-Regular.ttf','liberation2/LiberationSerif-Regular.ttf',
 'liberation2/LiberationMono-Regular.ttf','liberation/LiberationSans-Regular.ttf',
 'liberation/LiberationSerif-Regular.ttf','liberation/LiberationMono-Regular.ttf']
class TinyDigit(nn.Module):
    def __init__(self):
        super().__init__();self.conv1=nn.Conv2d(1,8,3,padding=1);self.conv2=nn.Conv2d(8,16,3,padding=1)
        self.fc1=nn.Linear(16*7*7,32);self.fc2=nn.Linear(32,11)
    def forward(self,x):
        x=nn.functional.max_pool2d(torch.relu(self.conv1(x)),2)
        x=nn.functional.max_pool2d(torch.relu(self.conv2(x)),2)
        return self.fc2(torch.relu(self.fc1(x.flatten(1))))
def normalize(gray: np.ndarray) -> np.ndarray:
    """Polarity-corrected grayscale crop -> 28x28 ink. Exact half-pixel resize."""
    a=np.asarray(gray,dtype=np.float32)
    if a.ndim!=2 or not a.size or max(a.shape)>4096 or not np.isfinite(a).all():
        raise ValueError('Expected finite nonempty 2-D crop <=4096 pixels per side')
    if a.min()<0 or a.max()>255:raise ValueError('Pixels must be in [0,255]')
    h,w=a.shape;levels=np.sort(a.ravel());hi=float(levels[math.floor((a.size-1)*.95)]);lo=float(levels[math.floor((a.size-1)*.05)])
    a=np.clip((hi-a)/max(32.,hi-lo),0,1)
    scale=24/max(w,h);tw=max(1,math.floor(w*scale+.5));th=max(1,math.floor(h*scale+.5))
    xx=np.clip((np.arange(tw)+.5)*w/tw-.5,0,w-1);yy=np.clip((np.arange(th)+.5)*h/th-.5,0,h-1)
    x0=np.floor(xx).astype(int);y0=np.floor(yy).astype(int);x1=np.minimum(x0+1,w-1);y1=np.minimum(y0+1,h-1)
    dx=xx-x0;dy=yy-y0
    resized=(a[y0[:,None],x0]*(1-dx)+a[y0[:,None],x1]*dx)*(1-dy[:,None])+(a[y1[:,None],x0]*(1-dx)+a[y1[:,None],x1]*dx)*dy[:,None]
    out=np.zeros((28,28),np.float32);top=(28-th)//2;left=(28-tw)//2;out[top:top+th,left:left+tw]=resized
    return out
@lru_cache(maxsize=64)
def font(path):return ImageFont.truetype(path,64)
@lru_cache(maxsize=4096)
def glyph(path,text):
    f=font(path);box=f.getbbox(text);im=Image.new('L',(max(1,box[2]-box[0]),max(1,box[3]-box[1])),0)
    ImageDraw.Draw(im).text((-box[0],-box[1]),text,font=f,fill=255);return im

def render(label,paths,rng):
    path=paths[int(rng.integers(len(paths)))];text=str(label)
    if label==10:
        kind=int(rng.integers(5))
        text=['','',str(int(rng.integers(10,1000))),str(rng.choice(list('+-x<>^=/'))),str(rng.choice(list('ABEK#?')))][kind]
    if text:
        ink=glyph(path,text).copy();th=int(rng.integers(26,59));tw=max(2,int(ink.width*th/ink.height*rng.uniform(.48,1.25)))
        ink=ink.resize((tw,th),Image.Resampling.BILINEAR).rotate(float(rng.uniform(-7,7)),Image.Resampling.BICUBIC,expand=True,fillcolor=0)
        pad=int(rng.integers(3,10));canvas=Image.new('L',(ink.width+2*pad,ink.height+2*pad),0);canvas.paste(ink,(pad,pad))
        if label<10 and rng.random()<.13:
            y=int(rng.integers(pad+2,pad+ink.height-2));ImageDraw.Draw(canvas).rectangle((0,y,canvas.width,y+int(rng.integers(1,3))),fill=0)
        if rng.random()<.6:canvas=canvas.filter(ImageFilter.GaussianBlur(float(rng.uniform(.1,.8))))
    else:
        canvas=Image.new('L',(int(rng.integers(20,65)),int(rng.integers(25,65))),0);draw=ImageDraw.Draw(canvas)
        if rng.random()<.4:
            for _ in range(int(rng.integers(1,4))):
                x,y=int(rng.integers(canvas.width)),int(rng.integers(canvas.height))
                draw.ellipse((x,y,x+int(rng.integers(1,4)),y+int(rng.integers(1,4))),fill=255)
        if rng.random()<.35:draw.line((0,0,0,canvas.height),fill=255,width=int(rng.integers(1,4)))
    a=np.asarray(canvas,np.float32)/255;h,w=a.shape;paper=float(rng.uniform(175,255));contrast=float(rng.uniform(40,min(230,paper)))
    gray=paper-contrast*a+np.linspace(0,float(rng.uniform(-20,20)),w)[None,:]+rng.normal(0,float(rng.uniform(0,3)),(h,w))
    image=normalize(np.clip(gray,0,255));dx,dy=rng.integers(-1,2,2)
    return np.roll(image,(int(dy),int(dx)),(0,1))
def dataset(paths,per_class,seed):
    rng=np.random.default_rng(seed);n=11*per_class;x=np.empty((n,1,28,28),np.float32);y=np.repeat(np.arange(11),per_class)
    for i,label in enumerate(y):x[i,0]=render(int(label),paths,rng)
    return torch.from_numpy(x),torch.from_numpy(y.astype(np.int64))
def evaluate(model,x,y):
    with torch.no_grad():p=torch.cat([model(b).softmax(1) for b in x.split(512)])
    pred=p.argmax(1);truth=y.numpy();guess=pred.numpy();score=p.max(1).values.numpy()
    confusion=np.zeros((11,11),int);np.add.at(confusion,(truth,guess),1);digit=truth<10;negative=~digit;confident=score>=.99
    return {'n':len(y),'correct':int((pred==y).sum()),'digits':int(digit.sum()),'digits_correct':int(((truth==guess)&digit).sum()),
      'rejects':int(negative.sum()),'rejects_correct':int(((truth==guess)&negative).sum()),
      'score_ge_099_count':int(confident.sum()),'score_ge_099_errors':int(((truth!=guess)&confident).sum()),'confusion':confusion.tolist()},p

def main():
    ap=argparse.ArgumentParser();ap.add_argument('--out',type=Path,default=Path('artifacts'));ap.add_argument('--font-root',type=Path,default=Path('/usr/share/fonts/truetype'))
    ap.add_argument('--train-per-class',type=int,default=2200);ap.add_argument('--test-per-class',type=int,default=400);ap.add_argument('--epochs',type=int,default=10);ap.add_argument('--seed',type=int,default=1729)
    args=ap.parse_args()
    if min(args.epochs,args.train_per_class,args.test_per_class)<1:ap.error('Counts must be positive')
    torch.set_num_threads(4);torch.manual_seed(args.seed);random.seed(args.seed);np.random.seed(args.seed)
    train=[str(args.font_root/p) for p in TRAIN_PATTERNS if (args.font_root/p).is_file()];test=[str(args.font_root/p) for p in TEST_PATTERNS if (args.font_root/p).is_file()]
    if len(train)<4 or len(test)<3:ap.error('Need local Noto/Lato training and disjoint DejaVu/Liberation test fonts')
    args.out.mkdir(parents=True,exist_ok=True);start=time.perf_counter();print('Generating training:',len(train),'test fonts:',len(test),flush=True)
    x,y=dataset(train,args.train_per_class,args.seed);vx,vy=dataset(train,100,args.seed+1)
    net=TinyDigit();optim=torch.optim.Adam(net.parameters(),lr=.002);schedule=torch.optim.lr_scheduler.CosineAnnealingLR(optim,args.epochs,eta_min=.0002);history=[]
    print('parameters',sum(p.numel() for p in net.parameters()),'data seconds',round(time.perf_counter()-start,2),flush=True)
    for epoch in range(args.epochs):
        net.train();order=torch.randperm(len(y));total=0
        for ids in order.split(256):
            optim.zero_grad();logits=net(x[ids]);loss=nn.functional.cross_entropy(logits,y[ids]);loss.backward();optim.step();total+=float(loss.detach())*len(ids)
        schedule.step();net.eval();metrics,_=evaluate(net,vx,vy);row={'epoch':epoch+1,'loss':total/len(y),'validation_correct':metrics['correct'],'validation_n':metrics['n']};history.append(row);print(json.dumps(row),flush=True)
    # Freeze before creating or evaluating the held-out test set.
    torch.save(net.state_dict(),args.out/'weights.pt');tensors=[];raw=[];offset=0
    for name,t in net.state_dict().items():
        a=t.cpu().numpy().astype('<f4');tensors.append({'name':name,'shape':list(a.shape),'offset':offset,'length':a.size});raw.append(a.ravel());offset+=a.size
    data=np.concatenate(raw).astype('<f4').tobytes();(args.out/'weights.f32').write_bytes(data)
    manifest={'format':'gridpuzzle-tiny-digit-v1','input':[1,28,28],'labels':[str(i) for i in range(10)]+['reject'],'parameters':offset,'weights_sha256':hashlib.sha256(data).hexdigest(),'weight_bytes':len(data),'tensors':tensors,'experimental':True}
    (args.out/'model.json').write_text(json.dumps(manifest,indent=2)+'\n')
    tx,ty=dataset(test,args.test_per_class,args.seed+2);metrics,p=evaluate(net,tx,ty);np.savez_compressed(args.out/'test-samples.npz',x=tx.numpy(),y=ty.numpy())
    report={'seed':args.seed,'train_count':len(y),'epochs':args.epochs,'parameters':offset,'versions':{'python':platform.python_version(),'torch':torch.__version__,'numpy':np.__version__,'Pillow':PIL_VERSION},
      'fonts':{k:[{'file':str(Path(f).relative_to(args.font_root)),'sha256':hashlib.sha256(Path(f).read_bytes()).hexdigest()} for f in files] for k,files in [('training',train),('held_out',test)]},
      'history':history,'held_out_synthetic':metrics,'seconds':time.perf_counter()-start,'limits':'Synthetic printed-digit test, not end-to-end OCR. No handwriting, score calibration, or unknown-font guarantees. No photographs used for training.'}
    (args.out/'training-report.json').write_text(json.dumps(report,indent=2)+'\n');print('held-out:',json.dumps(metrics),'seconds',report['seconds'],flush=True)
    vectors=[]
    for idx in np.linspace(0,len(tx)-1,11,dtype=int):
        inp=tx[idx:idx+1]
        with torch.no_grad():expected=net(inp).numpy()[0]
        vectors.append({'input':inp.numpy().ravel().tolist(),'logits':expected.tolist()})
    (args.out/'parity.json').write_text(json.dumps(vectors,separators=(',',':'))+'\n')
if __name__=='__main__':main()
