import { phFromAcids } from '../sim/chemistry.js';
import { reactionPackets } from '../metabolism.js';
import { activityTurnover } from './activity.js';
import { liquidPosition } from './space.js';
import { SPECIES_COLORS, cssColor } from './palette.js';

const CORNERS = [[-1,-1,-1],[1,-1,-1],[1,1,-1],[-1,1,-1],[-1,-1,1],[1,-1,1],[1,1,1],[-1,1,1]];
const EDGES = [[0,1],[1,2],[2,3],[3,0],[4,5],[5,6],[6,7],[7,4],[0,4],[1,5],[2,6],[3,7]];
const REACH = .105, GRID = .035;
const LABELS = { sugar: 'Sugar', oxygen: 'O₂', ethanol: 'Ethanol', acid: 'Acids', co2: 'CO₂' };

// Locks belong to organism IDs, never array slots or stationary grid cells.
export function pickVoxel(sim, type = 'yeast', current = null) {
  const candidates = sim.agents.filter(a => a.type === type);
  const agent = candidates.find(a => a.id === current?.agentId) || candidates.sort((a, b) => {
    if (current?.x !== undefined) {
      const distance = a => (a.x-current.x)**2 + (a.y-current.y)**2 + (a.z-current.z)**2;
      return distance(a)-distance(b) || a.id-b.id;
    }
    return a.id-b.id;
  })[0];
  const voxel = { type, yaw: current?.yaw ?? .55, pitch: current?.pitch ?? .32, ...current, agentId: agent?.id ?? null };
  if (agent) Object.assign(voxel, { x: agent.x, y: agent.y, z: agent.z,
    gx: Math.min(sim.nx-1, Math.floor(agent.x*sim.nx)),
    gy: Math.min(sim.ny-1, Math.floor(agent.y*sim.ny)),
    gz: Math.min(sim.nz-1, Math.floor(agent.z*sim.nz)) });
  return voxel;
}

export function followVoxel(sim, voxel) {
  const previous = voxel.agentId;
  Object.assign(voxel, pickVoxel(sim, voxel.type, voxel));
  return { agent: sim.agents.find(a => a.id === voxel.agentId), replaced: previous != null && previous !== voxel.agentId };
}

// Context uses actual vessel-space positions, so nearby organisms pass the
// locked cell as it moves. Rotating a paused view adds no history.
export function voxelContext(sim, voxel, agent) {
  const centre = liquidPosition(sim, agent.x, agent.y, agent.z);
  if (voxel.traceId !== agent.id) {
    voxel.traceId = agent.id; voxel.trace = []; voxel.traceDay = undefined;
  }
  if (voxel.traceDay !== sim.day) {
    voxel.trace.push([...centre]);
    if (voxel.trace.length > 32) voxel.trace.shift();
    voxel.traceDay = sim.day;
  }
  const neighbors = [];
  for (const other of sim.agents) {
    if (other.id === agent.id) continue;
    const position = liquidPosition(sim, other.x, other.y, other.z);
    const delta = position.map((value, i) => value - centre[i]);
    if (delta.every(value => Math.abs(value) < REACH)) neighbors.push({ agent: other, position, delta });
  }
  return { centre, neighbors, trace: voxel.trace };
}

function drawCell(ctx, agent, x, y, r, tracked, dark) {
  ctx.save(); ctx.translate(x,y);
  ctx.rotate(agent.type === 'yeast' ? -.35 : -.5 + Math.sin(agent.id)*.45);
  const color = cssColor(SPECIES_COLORS[agent.type]);
  ctx.fillStyle=color; ctx.strokeStyle=dark?'#c3d8d0':'#ffffff'; ctx.lineWidth=tracked?1.1:.5;
  if(agent.type==='yeast') {
    if(agent.energy>.58) {
      ctx.beginPath(); ctx.ellipse(r*.8,-r*.35,r*.43,r*.36,0,0,Math.PI*2); ctx.fill(); ctx.stroke();
    }
    ctx.beginPath(); ctx.ellipse(0,0,r,r*.78,0,0,Math.PI*2); ctx.fill(); ctx.stroke();
    ctx.fillStyle='#efcd91';
    ctx.beginPath(); ctx.ellipse(-r*.2,-r*.14,r*.27,r*.23,0,0,Math.PI*2); ctx.fill();
  } else {
    ctx.lineCap='round'; ctx.strokeStyle=color; ctx.lineWidth=r*.8;
    ctx.beginPath(); ctx.moveTo(-r,0); ctx.lineTo(r,0); ctx.stroke();
    ctx.strokeStyle=dark?'#b5e0d5':'#d0ebe2'; ctx.lineWidth=r*.17;
    ctx.beginPath(); ctx.moveTo(-r*.6,-r*.1); ctx.lineTo(r*.6,-r*.1); ctx.stroke();
  }
  ctx.restore();
}

function molecule(ctx, name, x, y, color, alpha) {
  ctx.save(); ctx.translate(x,y); ctx.globalAlpha=alpha;
  ctx.strokeStyle=color; ctx.fillStyle=color; ctx.lineWidth=1.1; ctx.beginPath();
  if(name==='sugar') {
    for(let i=0;i<=6;i++) {
      const angle=i*Math.PI/3;
      if(i===0) ctx.moveTo(Math.cos(angle)*3.7,Math.sin(angle)*3.7);
      else ctx.lineTo(Math.cos(angle)*3.7,Math.sin(angle)*3.7);
    }
    ctx.stroke();
  } else if(name==='co2'||name==='oxygen') {
    ctx.moveTo(-3,0); ctx.lineTo(3,0); ctx.stroke();
    for(const dx of [-3,3]) { ctx.beginPath(); ctx.arc(dx,0,2,0,Math.PI*2); ctx.fill(); }
    if(name==='co2') { ctx.beginPath(); ctx.arc(0,0,2,0,Math.PI*2); ctx.fill(); }
  } else {
    ctx.moveTo(-4,2); ctx.lineTo(0,-2); ctx.lineTo(4,1); ctx.stroke();
    ctx.beginPath(); ctx.arc(name==='acid'?4:-4,name==='acid'?1:2,2.3,0,Math.PI*2); ctx.fill();
  }
  ctx.restore();
}

function drawReactions(ctx, packets, cx, cy, width, r, dark) {
  const ink=dark?'#b6c9c4':'#536865';
  for(const intake of [true,false]) {
    const channels=packets.filter(packet=>packet.intake===intake);
    channels.forEach((packet,i)=>{
      const side=intake?-1:1, row=(i-(channels.length-1)/2)*27;
      const inner=cx+side*(r+7), outer=cx+side*Math.min(width*.40,102), bend=row*.35;
      const at=t=>[outer+(inner-outer)*t,cy+row*(1-t)+Math.sin(t*Math.PI)*bend];
      const color=cssColor(packet.color);
      ctx.strokeStyle=color; ctx.globalAlpha=.28; ctx.lineWidth=1;
      ctx.beginPath(); ctx.moveTo(...at(0));
      for(let step=1;step<=20;step++) ctx.lineTo(...at(step/20));
      ctx.stroke();
      // Arrowheads and molecular silhouettes preserve direction without color.
      const arrowT=intake?.72:.28, arrow=at(arrowT), direction=intake?-side:side;
      ctx.globalAlpha=.7; ctx.beginPath(); ctx.moveTo(arrow[0]-direction*3,arrow[1]-2);
      ctx.lineTo(arrow[0],arrow[1]); ctx.lineTo(arrow[0]-direction*3,arrow[1]+2); ctx.stroke();
      for(let k=0;k<3;k++) {
        const phase=(packet.phase+k/3)%1,t=intake?phase:1-phase,[x,y]=at(t);
        molecule(ctx,packet.name,x,y,color,(.32+.58*packet.strength)*Math.sin(Math.PI*t));
      }
      ctx.globalAlpha=1; ctx.font='9px system-ui'; ctx.fillStyle=ink; ctx.textAlign=intake?'left':'right';
      ctx.fillText(LABELS[packet.name],intake?8:width-8,cy+row-8);
    });
  }
  ctx.globalAlpha=1;
}

export function renderVoxel(canvas, sim, voxel, dark=true, motion=true) {
  if(!canvas||!sim||!voxel) return null;
  const {agent,replaced}=followVoxel(sim,voxel),width=canvas.clientWidth||260,height=canvas.clientHeight||196;
  if(width<10||height<10) return null;
  const ratio=Math.min(globalThis.devicePixelRatio||1,2);
  if(canvas.width!==Math.round(width*ratio)||canvas.height!==Math.round(height*ratio)) {
    canvas.width=Math.round(width*ratio); canvas.height=Math.round(height*ratio);
  }
  const ctx=canvas.getContext('2d');
  if(!ctx?.save) return null;
  ctx.save(); ctx.setTransform(ratio,0,0,ratio,0,0); ctx.clearRect(0,0,width,height);
  const ink=dark?'#dcebe8':'#314e50';
  if(!agent) {
    voxel.trace=[]; voxel.traceId=null;
    ctx.fillStyle=ink; ctx.font='12px system-ui'; ctx.textAlign='center';
    ctx.fillText('No living cells of this species',width/2,height/2); ctx.restore();
    return {cells:0,agentId:null,coords:'No cell to follow',summary:'Waiting for a living cell',replaced};
  }
  const {centre,neighbors,trace}=voxelContext(sim,voxel,agent);
  const cx=width/2,cy=height*.52,scale=Math.min(width-24,height-54)*.28/REACH;
  const c=Math.cos(voxel.yaw),s=Math.sin(voxel.yaw),cp=Math.cos(voxel.pitch),sp=Math.sin(voxel.pitch);
  const project=([x,y,z])=>{
    const rx=x*c-z*s,rz=x*s+z*c;
    return [cx+rx*scale,cy-(y*cp-rz*sp)*scale,rz*cp+y*sp];
  };
  ctx.save(); ctx.beginPath(); ctx.rect(1,29,width-2,height-53); ctx.clip();
  const corners=CORNERS.map(p=>project(p.map(v=>v*REACH)));
  ctx.strokeStyle=dark?'rgba(168,200,193,.18)':'rgba(74,117,116,.22)'; ctx.lineWidth=.8; ctx.beginPath();
  for(const [a,b] of EDGES) { ctx.moveTo(...corners[a].slice(0,2)); ctx.lineTo(...corners[b].slice(0,2)); }
  // The lattice stays in vessel coordinates, visibly sliding past the target.
  for(let axis=0;axis<3;axis++) {
    const next=(axis+1)%3,fixed=(axis+2)%3;
    for(let i=Math.ceil((centre[next]-REACH)/GRID);i*GRID<centre[next]+REACH;i++) {
      const a=[0,0,0],b=[0,0,0];
      a[axis]=-REACH; b[axis]=REACH; a[next]=b[next]=i*GRID-centre[next]; a[fixed]=b[fixed]=-REACH;
      ctx.moveTo(...project(a).slice(0,2)); ctx.lineTo(...project(b).slice(0,2));
    }
  }
  ctx.stroke();
  ctx.strokeStyle=cssColor(SPECIES_COLORS[agent.type]); ctx.lineWidth=1.4;
  for(let i=1;i<trace.length;i++) {
    const a=trace[i-1].map((v,j)=>v-centre[j]),b=trace[i].map((v,j)=>v-centre[j]);
    if([...a,...b].some(v=>Math.abs(v)>REACH)) continue;
    ctx.globalAlpha=.08+.35*i/trace.length; ctx.beginPath();
    ctx.moveTo(...project(a).slice(0,2)); ctx.lineTo(...project(b).slice(0,2)); ctx.stroke();
  }
  const ordered=neighbors.map(other=>({...other,screen:project(other.delta)})).sort((a,b)=>a.screen[2]-b.screen[2]);
  for(const other of ordered) {
    ctx.globalAlpha=.30+.18*(other.screen[2]/REACH+1)/2;
    drawCell(ctx,other.agent,other.screen[0],other.screen[1],other.agent.type==='yeast'?3.4:2.7,false,dark);
  }
  ctx.globalAlpha=1;
  const r=Math.min(11,height*.052),packets=reactionPackets(agent,motion,activityTurnover(voxel,agent,sim));
  drawReactions(ctx,packets,cx,cy,width,r,dark);
  ctx.strokeStyle=cssColor(SPECIES_COLORS[agent.type]); ctx.globalAlpha=.65; ctx.lineWidth=1;
  ctx.setLineDash([2,4]); ctx.beginPath(); ctx.arc(cx,cy,r+8,0,Math.PI*2); ctx.stroke(); ctx.setLineDash([]);
  ctx.globalAlpha=1; drawCell(ctx,agent,cx,cy,r,true,dark);
  ctx.fillStyle=ink; ctx.font='9px ui-monospace, monospace'; ctx.textAlign='center'; ctx.fillText(`#${agent.id}`,cx,cy+r+29);
  if(!packets.length) { ctx.globalAlpha=.65; ctx.font='10px system-ui'; ctx.fillText('Low metabolic activity',cx,height-34); }
  ctx.restore();
  ctx.fillStyle=ink; ctx.globalAlpha=.72; ctx.font='10px system-ui'; ctx.textAlign='left';
  ctx.fillText(`${neighbors.length} nearby · path trails behind`,10,17);
  ctx.font='9px system-ui'; ctx.fillText('Uptake → cell → products',10,height-10);
  // The locator links this moving microscope to a position in the jar.
  const lx=width-25,ly=7,lw=13,lh=19;
  ctx.strokeStyle=ink; ctx.globalAlpha=.35; ctx.strokeRect(lx,ly,lw,lh);
  ctx.globalAlpha=1; ctx.fillStyle=cssColor(SPECIES_COLORS[agent.type]);
  ctx.beginPath(); ctx.arc(lx+2+agent.x*(lw-4),ly+2+agent.y*(lh-4),2,0,Math.PI*2); ctx.fill(); ctx.restore();
  const idx=sim.index(agent.x,agent.y,agent.z),f=sim.fields;
  const ph=phFromAcids(f.acetic[idx],f.gluconic[idx]),sugar=f.sucrose[idx]+f.glucose[idx]+f.fructose[idx],o2=f.oxygen[idx];
  return {agentId:agent.id,cells:1,yeast:agent.type==='yeast'?1:0,bacteria:agent.type==='bacteria'?1:0,
    neighbors:neighbors.length,traceSamples:trace.length,activeReactions:packets.map(p=>p.name),
    coords:`Following #${agent.id} · (${voxel.gx}, ${voxel.gy}, ${voxel.gz})`,
    summary:`pH ${ph.toFixed(2)} · ${Math.round(sugar)} g/L sugar · O₂ ${o2.toFixed(2)}`,ph,sugar,o2,replaced};
}
