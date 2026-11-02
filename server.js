/* ============================================================
   workers.js — Web Workers для тяжёлых операций
   ============================================================ */

const FLOOD_FILL_SRC = `
self.onmessage = function(e){
  const {buffer, W, H, x0, y0, fillRGBA, tol} = e.data;
  const data = new Uint32Array(buffer);
  const fill = fillRGBA;
  const target = data[y0 * W + x0];
  if (target === fill) { self.postMessage({buffer: data.buffer, changed: false}, [data.buffer]); return; }
  const tr = target & 0xFF, tg = (target >>> 8) & 0xFF, tb = (target >>> 16) & 0xFF, ta = (target >>> 24) & 0xFF;
  const tol2 = tol * tol * 4;
  const match = (pix) => {
    const r = pix & 0xFF, g = (pix >>> 8) & 0xFF, b = (pix >>> 16) & 0xFF, a = (pix >>> 24) & 0xFF;
    const dr = r - tr, dg = g - tg, db = b - tb, da = a - ta;
    return (dr*dr + dg*dg + db*db + da*da) <= tol2;
  };
  const visited = new Uint8Array(W * H);
  const stack = new Int32Array(W * H * 2);
  let top = 0;
  stack[top++] = x0; stack[top++] = y0;
  while(top > 0){
    const y = stack[--top]; const x = stack[--top];
    let xL = x;
    while(xL >= 0 && !visited[y*W + xL] && match(data[y*W + xL])) xL--;
    xL++;
    let xR = x;
    while(xR < W && !visited[y*W + xR] && match(data[y*W + xR])) xR++;
    xR--;
    for(let i = xL; i <= xR; i++){
      const idx = y * W + i;
      visited[idx] = 1;
      data[idx] = fill;
      if(y > 0){
        const up = (y-1)*W + i;
        if(!visited[up] && match(data[up]) && (i === xL || !visited[up-1] || !match(data[up-1]))){
          if(top + 2 <= stack.length){ stack[top++] = i; stack[top++] = y-1; }
        }
      }
      if(y < H-1){
        const dn = (y+1)*W + i;
        if(!visited[dn] && match(data[dn]) && (i === xL || !visited[dn-1] || !match(data[dn-1]))){
          if(top + 2 <= stack.length){ stack[top++] = i; stack[top++] = y+1; }
        }
      }
    }
  }
  self.postMessage({buffer: data.buffer, changed: true}, [data.buffer]);
};
`;

const FILTERS_SRC = `
function clamp(v,a,b){return v<a?a:v>b?b:v;}
function convolve(data,W,H,kernel,divisor,offset){
  const out=new Uint8ClampedArray(data.length);
  for(let y=0;y<H;y++){
    for(let x=0;x<W;x++){
      let r=0,g=0,b=0,a=0;
      for(let ky=-1;ky<=1;ky++){
        for(let kx=-1;kx<=1;kx++){
          const px=clamp(x+kx,0,W-1);
          const py=clamp(y+ky,0,H-1);
          const i=(py*W+px)*4;
          const k=kernel[(ky+1)*3+(kx+1)];
          r+=data[i]*k; g+=data[i+1]*k; b+=data[i+2]*k; a+=data[i+3]*k;
        }
      }
      const o=(y*W+x)*4;
      out[o]=clamp(r/divisor+offset,0,255);
      out[o+1]=clamp(g/divisor+offset,0,255);
      out[o+2]=clamp(b/divisor+offset,0,255);
      out[o+3]=clamp(a/divisor,0,255);
    }
  }
  return out;
}
function boxBlur(data,W,H,radius){
  const tmp=new Uint8ClampedArray(data.length);
  const out=new Uint8ClampedArray(data.length);
  for(let y=0;y<H;y++)for(let x=0;x<W;x++){
    let r=0,g=0,b=0,a=0,n=0;
    for(let k=-radius;k<=radius;k++){
      const px=clamp(x+k,0,W-1); const i=(y*W+px)*4;
      r+=data[i];g+=data[i+1];b+=data[i+2];a+=data[i+3];n++;
    }
    const o=(y*W+x)*4;
    tmp[o]=r/n;tmp[o+1]=g/n;tmp[o+2]=b/n;tmp[o+3]=a/n;
  }
  for(let y=0;y<H;y++)for(let x=0;x<W;x++){
    let r=0,g=0,b=0,a=0,n=0;
    for(let k=-radius;k<=radius;k++){
      const py=clamp(y+k,0,H-1); const i=(py*W+x)*4;
      r+=tmp[i];g+=tmp[i+1];b+=tmp[i+2];a+=tmp[i+3];n++;
    }
    const o=(y*W+x)*4;
    out[o]=r/n;out[o+1]=g/n;out[o+2]=b/n;out[o+3]=a/n;
  }
  return out;
}
self.onmessage=function(e){
  const {buffer,W,H,type,params}=e.data;
  const data=new Uint8ClampedArray(buffer);
  let out;
  switch(type){
    case 'blur-soft': out=boxBlur(data,W,H,2); break;
    case 'blur-strong': out=boxBlur(data,W,H,6); break;
    case 'sharpen': out=convolve(data,W,H,[0,-1,0,-1,5,-1,0,-1,0],1,0); break;
    case 'emboss': out=convolve(data,W,H,[-2,-1,0,-1,1,1,0,1,2],1,0); break;
    case 'edge': out=convolve(data,W,H,[-1,-1,-1,-1,8,-1,-1,-1,-1],1,0); break;
    case 'grayscale':{
      out=new Uint8ClampedArray(data.length);
      for(let i=0;i<data.length;i+=4){
        const g=data[i]*0.299+data[i+1]*0.587+data[i+2]*0.114;
        out[i]=g;out[i+1]=g;out[i+2]=g;out[i+3]=data[i+3];
      }
      break;}
    case 'invert':{
      out=new Uint8ClampedArray(data.length);
      for(let i=0;i<data.length;i+=4){
        out[i]=255-data[i];out[i+1]=255-data[i+1];out[i+2]=255-data[i+2];out[i+3]=data[i+3];
      }
      break;}
    case 'sepia':{
      out=new Uint8ClampedArray(data.length);
      for(let i=0;i<data.length;i+=4){
        const r=data[i],g=data[i+1],b=data[i+2];
        out[i]=clamp(r*0.393+g*0.769+b*0.189,0,255);
        out[i+1]=clamp(r*0.349+g*0.686+b*0.168,0,255);
        out[i+2]=clamp(r*0.272+g*0.534+b*0.131,0,255);
        out[i+3]=data[i+3];
      }
      break;}
    case 'hue-shift':{
      out=new Uint8ClampedArray(data.length);
      const shift=params.shift||30;
      for(let i=0;i<data.length;i+=4){
        let r=data[i]/255,g=data[i+1]/255,b=data[i+2]/255;
        const max=Math.max(r,g,b),min=Math.min(r,g,b);
        let h=0,s=0,v=max;
        const d=max-min; s=max===0?0:d/max;
        if(d!==0){
          if(max===r)h=((g-b)/d)%6;
          else if(max===g)h=(b-r)/d+2;
          else h=(r-g)/d+4;
          h*=60;if(h<0)h+=360;
        }
        h=(h+shift)%360;
        const c=v*s, x=c*(1-Math.abs((h/60)%2-1)), m=v-c;
        let rr=0,gg=0,bb=0;
        if(h<60){rr=c;gg=x;} else if(h<120){rr=x;gg=c;}
        else if(h<180){gg=c;bb=x;} else if(h<240){gg=x;bb=c;}
        else if(h<300){rr=x;bb=c;} else {rr=c;bb=x;}
        out[i]=(rr+m)*255;out[i+1]=(gg+m)*255;out[i+2]=(bb+m)*255;out[i+3]=data[i+3];
      }
      break;}
    case 'brightness':{
      out=new Uint8ClampedArray(data.length);
      const bv=params.brightness||0, ct=params.contrast||0;
      const cf=(259*(ct+255))/(255*(259-ct));
      for(let i=0;i<data.length;i+=4){
        out[i]=clamp(cf*(data[i]-128)+128+bv,0,255);
        out[i+1]=clamp(cf*(data[i+1]-128)+128+bv,0,255);
        out[i+2]=clamp(cf*(data[i+2]-128)+128+bv,0,255);
        out[i+3]=data[i+3];
      }
      break;}
    case 'levels':{
      out=new Uint8ClampedArray(data.length);
      const b=params.black||0, w=params.white||255, g=params.gamma||1;
      const range=Math.max(1,w-b);
      const lut=new Uint8ClampedArray(256);
      for(let i=0;i<256;i++){
        lut[i]=clamp(Math.pow(clamp((i-b)/range,0,1),1/g)*255,0,255);
      }
      for(let i=0;i<data.length;i+=4){
        out[i]=lut[data[i]];out[i+1]=lut[data[i+1]];out[i+2]=lut[data[i+2]];out[i+3]=data[i+3];
      }
      break;}
    case 'noise':{
      out=new Uint8ClampedArray(data);
      const amt=params.amount||30;
      for(let i=0;i<out.length;i+=4){
        const n=(Math.random()-0.5)*amt*2;
        out[i]=clamp(out[i]+n,0,255);
        out[i+1]=clamp(out[i+1]+n,0,255);
        out[i+2]=clamp(out[i+2]+n,0,255);
      }
      break;}
    case 'pixelate':{
      out=new Uint8ClampedArray(data.length);
      const ps=params.size||8;
      for(let y=0;y<H;y+=ps)for(let x=0;x<W;x+=ps){
        let r=0,g=0,b=0,a=0,n=0;
        for(let yy=y;yy<Math.min(y+ps,H);yy++)for(let xx=x;xx<Math.min(x+ps,W);xx++){
          const i=(yy*W+xx)*4;
          r+=data[i];g+=data[i+1];b+=data[i+2];a+=data[i+3];n++;
        }
        r/=n;g/=n;b/=n;a/=n;
        for(let yy=y;yy<Math.min(y+ps,H);yy++)for(let xx=x;xx<Math.min(x+ps,W);xx++){
          const i=(yy*W+xx)*4;
          out[i]=r;out[i+1]=g;out[i+2]=b;out[i+3]=a;
        }
      }
      break;}
    default: out=data;
  }
  self.postMessage({buffer:out.buffer},[out.buffer]);
};
`;

const POLY_MASK_SRC = `
self.onmessage=function(e){
  const {W,H,points}=e.data;
  const mask=new Uint8Array(W*H);
  if(!points||points.length<3){ self.postMessage({mask:mask.buffer,bbox:{x:0,y:0,w:0,h:0}},[mask.buffer]); return; }
  let minX=W,maxX=0,minY=H,maxY=0;
  for(const p of points){
    if(p.x<minX)minX=p.x; if(p.x>maxX)maxX=p.x;
    if(p.y<minY)minY=p.y; if(p.y>maxY)maxY=p.y;
  }
  minX=Math.max(0,Math.floor(minX)); maxX=Math.min(W-1,Math.ceil(maxX));
  minY=Math.max(0,Math.floor(minY)); maxY=Math.min(H-1,Math.ceil(maxY));
  const n=points.length;
  for(let y=minY;y<=maxY;y++){
    const xs=[];
    for(let i=0;i<n;i++){
      const a=points[i], b=points[(i+1)%n];
      if((a.y<=y&&b.y>y)||(b.y<=y&&a.y>y)){
        const t=(y-a.y)/(b.y-a.y);
        xs.push(a.x+t*(b.x-a.x));
      }
    }
    xs.sort((a,b)=>a-b);
    for(let k=0;k<xs.length;k+=2){
      const x0=Math.max(0,Math.ceil(xs[k]));
      const x1=Math.min(W-1,Math.floor(xs[k+1]));
      for(let x=x0;x<=x1;x++) mask[y*W+x]=1;
    }
  }
  self.postMessage({mask:mask.buffer,bbox:{x:minX,y:minY,w:maxX-minX+1,h:maxY-minY+1}},[mask.buffer]);
};
`;

const MAGIC_WAND_SRC = `
self.onmessage=function(e){
  const {buffer,W,H,x0,y0,tol,contiguous}=e.data;
  const data=new Uint32Array(buffer);
  const mask=new Uint8Array(W*H);
  const target=data[y0*W+x0];
  const tr=target&0xFF, tg=(target>>>8)&0xFF, tb=(target>>>16)&0xFF, ta=(target>>>24)&0xFF;
  const tol2=tol*tol*4;
  const match=(pix)=>{
    const r=pix&0xFF, g=(pix>>>8)&0xFF, b=(pix>>>16)&0xFF, a=(pix>>>24)&0xFF;
    const dr=r-tr, dg=g-tg, db=b-tb, da=a-ta;
    return (dr*dr+dg*dg+db*db+da*da)<=tol2;
  };
  let minX=W,maxX=0,minY=H,maxY=0;
  if(contiguous){
    const stack=[x0,y0];
    while(stack.length){
      const y=stack.pop(); const x=stack.pop();
      if(x<0||y<0||x>=W||y>=H) continue;
      const idx=y*W+x;
      if(mask[idx]) continue;
      if(!match(data[idx])) continue;
      mask[idx]=1;
      if(x<minX)minX=x; if(x>maxX)maxX=x;
      if(y<minY)minY=y; if(y>maxY)maxY=y;
      stack.push(x+1,y, x-1,y, x,y+1, x,y-1);
    }
  } else {
    for(let y=0;y<H;y++)for(let x=0;x<W;x++){
      if(match(data[y*W+x])){
        mask[y*W+x]=1;
        if(x<minX)minX=x; if(x>maxX)maxX=x;
        if(y<minY)minY=y; if(y>maxY)maxY=y;
      }
    }
  }
  if(maxX<minX){minX=0;maxX=0;minY=0;maxY=0;}
  self.postMessage({mask:mask.buffer,bbox:{x:minX,y:minY,w:maxX-minX+1,h:maxY-minY+1}},[mask.buffer]);
};
`;

function makeWorker(src){
  const blob = new Blob([src], {type:'application/javascript'});
  const url = URL.createObjectURL(blob);
  const w = new Worker(url);
  URL.revokeObjectURL(url);
  return w;
}

window.FloodFillWorker = () => makeWorker(FLOOD_FILL_SRC);
window.FiltersWorker   = () => makeWorker(FILTERS_SRC);
window.PolyMaskWorker  = () => makeWorker(POLY_MASK_SRC);
window.MagicWandWorker = () => makeWorker(MAGIC_WAND_SRC);

console.log('[workers.js] 4 воркера готовы');