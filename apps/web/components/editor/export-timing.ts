export function audioWindow(timestamp:number,frames:number,rate:number,start:number,end:number,offset:number){
 const first=Math.max(0,Math.ceil((start-timestamp)*rate-1e-6));
 const last=Math.min(frames,Math.ceil((end-timestamp)*rate-1e-6));
 return {first,frames:Math.max(0,last-first),timestamp:offset+timestamp+first/rate-start};
}
export function audioGain(time:number,total:number,volume:number,fade:number){
 const length=Math.min(Math.max(0,fade),total/2);
 return volume*(length?Math.max(0,Math.min(1,time/length,(total-time)/length)):1);
}

