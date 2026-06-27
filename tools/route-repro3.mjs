import { init, routeEdges } from '@mr_mint/elkjs-libavoid';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
const __dirname = dirname(fileURLToPath(import.meta.url));
const raw = readFileSync(join(__dirname,'..','.claude','worktrees','vigilant-pike-7136af','novakai.mmd'),'utf8');
const nodes=new Map();
for(const l of raw.split('\n')){const m=l.match(/^%% fm (\S+) (-?[\d.]+) (-?[\d.]+) (-?[\d.]+) (-?[\d.]+) (\S+)/);if(!m)continue;nodes.set(m[1],{id:m[1],x:+m[2],y:+m[3],w:+m[4],h:+m[5],shape:m[6]});}
const be=[];for(const l of raw.split('\n')){const m=l.match(/^\s*(\S+)\s*(?:-.->|-->)\s*(?:\|[^|]*\|)?\s*(\S+)/);if(!m||!nodes.has(m[1])||!nodes.has(m[2]))continue;be.push({from:m[1],to:m[2]});}
const isG=id=>nodes.get(id).shape==='group';
const ng=[...nodes.values()].filter(n=>n.shape!=='group');
const rb=be.filter(e=>!isG(e.from)&&!isG(e.to));
// tile x3
const obs=[],eds=[];const YS=2600;
for(let t=0;t<3;t++){const dy=t*YS;for(const n of ng)obs.push({id:`${n.id}_${t}`,x:n.x,y:n.y+dy,w:n.w,h:n.h});for(let i=0;i<rb.length;i++)eds.push({id:`e${t}_${i}`,source:`${rb[i].from}_${t}`,target:`${rb[i].to}_${t}`});}
const SP=140,CG=6,CH=120;
const wide=n=>{const w=Math.max(n.w,n.w+SP);return{id:n.id,x:n.x-(w-n.w)/2,y:n.y,width:w,height:n.h+CG+CH};};
const clipped=n=>({id:n.id,x:n.x,y:n.y,width:n.w,height:n.h+CG+CH});
const box=n=>({id:n.id,x:n.x,y:n.y,width:n.w,height:n.h});
function ov(r,b){const x=r.map(p=>({x:p.x-b,y:p.y-b,w:p.width+2*b,h:p.height+2*b}));let n=0;for(let i=0;i<x.length;i++)for(let j=i+1;j<x.length;j++){const a=x[i],c=x[j];if(a.x<c.x+c.w&&a.x+a.w>c.x&&a.y<c.y+c.h&&a.y+a.h>c.y)n++;}return n;}
const O=b=>({routingType:'orthogonal',shapeBufferDistance:b,idealNudgingDistance:16,nudgeOrthogonalSegmentsConnectedToShapes:true});
async function run(label,builder,buf){
  const ch=obs.map(builder);const g={id:'root',children:ch,edges:eds};
  const o=ov(ch,buf);const t0=performance.now();
  const timeout=new Promise((_,rej)=>setTimeout(()=>rej(new Error('TIMEOUT>30s')),30000));
  try{await init();const r=await Promise.race([routeEdges(g,O(buf)),timeout]);const dt=(performance.now()-t0).toFixed(0);console.log(`${label.padEnd(22)} buf=${buf} ov=${String(o).padStart(4)} routes=${r.size}/${eds.length} time=${dt}ms OK`);}
  catch(e){const dt=(performance.now()-t0).toFixed(0);console.log(`${label.padEnd(22)} buf=${buf} ov=${String(o).padStart(4)} time=${dt}ms ${e.message.slice(0,40)}`);}
}
await run('box-only (floor)',box,4);
await run('card-clipped',clipped,4);
await run('card-clipped',clipped,2);
await run('card-clipped',clipped,0);
await run('card-wide buf0',wide,0);
