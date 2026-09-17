"""Decode repository test photos into RGBA without labels influencing pixels.
Pillow performs test degradations; these are NOT pixel-identical to browser
canvas resizing or blur and must not be presented as a direct browser A/B.
"""
import argparse,json,hashlib
from pathlib import Path
import numpy as np
from PIL import Image,ImageFilter

def main():
 ap=argparse.ArgumentParser();ap.add_argument('--source',type=Path,required=True);ap.add_argument('--out',type=Path,default=Path('artifacts/photos'));a=ap.parse_args()
 root=a.source/'Examples/BrowserScanner/Newspaper';a.out.mkdir(parents=True,exist_ok=True);cases=[]
 for f in json.loads((root/'ground-truth.json').read_text())['fixtures']:
  raw=root/f['image'];original=Image.open(raw).convert('RGBA')
  for name in ['original','small','faded','mild-fade','blur']:
   im=original.copy()
   if name=='small':im=im.resize((round(im.width/2),round(im.height/2)),Image.Resampling.BILINEAR)
   if name=='blur':im=im.filter(ImageFilter.GaussianBlur(.6))
   pixels=np.asarray(im).copy()
   if name in ['faded','mild-fade']:
    contrast=.35 if name=='faded' else .65
    pixels[:,:,:3]=np.floor(255-(255-pixels[:,:,:3].astype(float))*contrast+.5)
   path=f"{f['name']}-{name}.rgba";(a.out/path).write_bytes(pixels.tobytes())
   cases.append(dict(name=f['name'],variation=name,type=f['type'],expected=f['cells'],file=path,
     width=im.width,height=im.height,source_sha256=hashlib.sha256(raw.read_bytes()).hexdigest()))
 (a.out/'cases.json').write_text(json.dumps(cases,indent=2)+'\n')
if __name__=='__main__':main()
