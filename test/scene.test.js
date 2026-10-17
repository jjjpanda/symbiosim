import { phFromAcids } from '../src/sim/chemistry.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { Simulation } from '../src/engine.js';
import { Geometry, STRIDE } from '../src/render/geometry.js';
import { createJar, createTap, buildFilm, buildWater, teaColor } from '../src/render/objects.js';
import { cameraMatrix, liquidPosition, discToMaterial, containInLiquid, interiorRadius, HEIGHT } from '../src/render/space.js';
import { streamState, sampleStream, buildStreams, SPOUT } from '../src/render/streams.js';
import { transferDuration } from '../src/sim/transfer-clock.js';
import { createScene } from '../src/render/scene.js';
import { filmPoint, materialPoint } from '../src/sim/film-body.js';
import { stepPellicle } from '../src/sim/pellicle.js';
import { pickVoxel, renderVoxel, voxelContext } from '../src/render/voxel.js';
import { sampleSurface } from '../src/sim/spatial.js';
import { LIQUID_RADIUS } from '../src/sim/constants.js';
import { SPECIES_COLORS, FLOW_COLOR } from '../src/render/palette.js';
import { CHEMICAL_COLORS } from '../src/metabolism.js';
const near = (a, b, tolerance = 1e-6) => assert.ok(Math.abs(a - b) < tolerance, `${a} differs from ${b}`);
function mockCanvas() {
  let handle = 0;
  let readTarget = null, drawTarget = null;
  const calls = [], events = new Map();
  const gl = new Proxy({}, { get: (_, name) => {
      if (name === 'COLOR_BUFFER_BIT')
        return 0x4000;
      if (name === 'DEPTH_BUFFER_BIT')
        return 0x0100;
      if (name === 'bindFramebuffer')
        return (target, framebuffer) => {
          if (target === 'FRAMEBUFFER' || target === 'READ_FRAMEBUFFER')
            readTarget = framebuffer;
          if (target === 'FRAMEBUFFER' || target === 'DRAW_FRAMEBUFFER')
            drawTarget = framebuffer;
          calls.push([name, target, framebuffer]);
        };
      if (name === 'drawArrays')
        return (...args) => {
          assert.ok(drawTarget, 'All scene geometry must use the shared offscreen depth');
          calls.push([name, ...args]);
        };
      if (name === 'blitFramebuffer')
        return (...args) => {
          assert.ok(readTarget && readTarget !== drawTarget);
          assert.equal(args[8], 0x4000, 'Never blit depth to an implementation-dependent screen buffer');
          calls.push([name, ...args]);
        };
      if (name === 'getShaderParameter' || name === 'getProgramParameter')
        return () => true;
      if (name === 'checkFramebufferStatus')
        return () => 'FRAMEBUFFER_COMPLETE';
      if (name === 'getExtension')
        return () => ({ loseContext() { } });
      if (String(name).startsWith('create') || String(name).startsWith('getUniform'))
        return () => ({ handle: ++handle });
      if (String(name).toUpperCase() === name)
        return name;
      return (...args) => calls.push([name, ...args]);
    } });
  return { canvas: { width: 0, height: 0, getContext: () => gl, addEventListener: (name, fn) => events.set(name, fn) }, calls, events };
}
test('perspective camera stays finite through orbit and physical tilt and preserves the liquid domain', () => {
  for (const yaw of [0, 65, 180])
    for (const tip of [0, .18]) {
      const camera = cameraMatrix(560, 710, { yaw, elevation: 25 }, tip), point = [0, .7, 0], p = camera.project(point);
      const front = camera.project([0, .7, .4]), back = camera.project([0, .7, -.4]);
      assert.ok(Math.abs(front[1] - back[1]) > 20);
      for (const value of camera.matrix)
        assert.ok(Number.isFinite(value));
    }
  const sim = new Simulation(), before = sim.snapshot();
  for (let x = .05; x < 1; x += .1)
    for (let z = .05; z < 1; z += .1) {
      const p = liquidPosition(sim, x, .5, z), uv = discToMaterial(p[0], p[2]);
      near(uv[0], x);
      near(uv[1], z);
    }
  assert.deepEqual(sim.snapshot(), before);
});
test('the jar contains distinct inner and outer walls, shoulder, rolled rim, base and a three-dimensional tap', () => {
  const jar = createJar(), tap = createTap(), radii = [];
  let low = Infinity, high = -Infinity;
  for (let i = 0; i < jar.count; i++) {
    const at = i * STRIDE;
    low = Math.min(low, jar.vertices[at + 1]);
    high = Math.max(high, jar.vertices[at + 1]);
    if (jar.vertices[at + 1] > .06 && jar.vertices[at + 1] < 1.24)
      radii.push(Math.hypot(jar.vertices[at], jar.vertices[at + 2]));
  }
  assert.ok(high > 1.34 && low < .02);
  assert.ok(Math.max(...radii) - Math.min(...radii) > .015);
  assert.ok(tap.count > 500);
  assert.ok(jar.count < 14000);
  const lip = [];
  for (let i = 0; i < tap.count; i++) {
    const at = i * STRIDE;
    if (Math.abs(tap.vertices[at + 1] - SPOUT[1]) < 1e-6)
      lip.push([tap.vertices[at] - SPOUT[0], tap.vertices[at + 2] - SPOUT[2]]);
  }
  assert.ok(lip.length >= 32);
  assert.ok(lip.every(([x, z]) => Math.abs(Math.hypot(x, z) - .043) < 1e-6), 'The nozzle mouth must surround the stream origin');
  for (const [width, height, tilt] of [[1000, 760, 0], [560, 650, 0], [300, 600, 0], [300, 390, .21], [300, 390, -.21]]) {
    const camera = cameraMatrix(width, height, { yaw: 0, elevation: 25 }, tilt);
    for (const mesh of [jar, tap])
      for (let i = 0; i < mesh.count; i++) {
        const at = i * STRIDE, p = camera.project(mesh.vertices.subarray(at, at + 3));
        assert.ok(p[0] > 4 && p[0] < width - 4 && p[1] > 4 && p[1] < height - 4, 'The larger view must keep the entire vessel and tap in frame');
      }
  }
  for (const mesh of [jar, tap])
    assert.ok(mesh.vertices.subarray(0, mesh.count * STRIDE).every(Number.isFinite));
});
test('a free mother rotates with a vortex while material inventory and inverse mapping stay intact', () => {
  const sim = new Simulation({ width: 16, height: 16, depth: 6 }), before = structuredClone(sim.membrane.layers);
  for (let z = 0; z < sim.nz; z++)
    for (let y = 0; y < sim.ny; y++)
      for (let x = 0; x < sim.nx; x++) {
        const i = (z * sim.ny + y) * sim.nx + x;
        sim.vx[i] = -((z + .5) / sim.nz - .5) * 2;
        sim.vz[i] = ((x + .5) / sim.nx - .5) * 2;
        sim.vy[i] = 0;
      }
  for (let i = 0; i < 400; i++)
    stepPellicle(sim, .005);
  assert.ok(Math.abs(sim.membrane.body.pose.angle) > .8, 'The mother must be able to rotate as an object');
  assert.deepEqual(sim.membrane.layers, before);
  for (const [u, v] of [[.5, .5], [.35, .5], [.65, .45]]) {
    const p = filmPoint(sim, u, v), inverse = materialPoint(sim, ...p);
    near(inverse[0], u, 1e-5);
    near(inverse[1], v, 1e-5);
  }
  const restored = Simulation.restore(sim.snapshot());
  sim.step(.02);
  restored.step(.02);
  assert.deepEqual(restored.snapshot(), sim.snapshot());
});
test('film geometry has a real contour and thickness and moves with the body rather than the waterline', () => {
  const sim = new Simulation(), film = new Geometry(24000), water = new Geometry(12000), before = sim.snapshot();
  buildFilm(film, sim);
  buildWater(water, sim);
  assert.ok(film.count > 1000 && film.count < 24000);
  assert.ok(water.count < 12000);
  const positions = film.vertices.slice(0, film.count * STRIDE), count = film.count;
  sim.membrane.body.pose.angle = .7;
  sim.membrane.body.pose.x = .03;
  buildFilm(film, sim);
  assert.equal(film.count, count);
  assert.ok(film.vertices.some((value, i) => i % STRIDE === 0 && Math.abs(value - positions[i]) > .02));
  sim.membrane.body.pose.angle = 0;
  sim.membrane.body.pose.x = 0;
  assert.deepEqual(sim.snapshot(), before);
});
test('jet radius follows continuity, hot tea lands at its solver inlet, and outlet drops detach after breakup', () => {
  const taper = new Geometry(100);
  taper.tube([[0, 1, 0], [0, 0, 0]], [.1, .05], [1, 1, 1]);
  const vertices = taper.vertices;
  // The light must follow the narrowing surface, including its axial slope.
  near(vertices[3] * (vertices[5 * STRIDE] - vertices[0]) + vertices[4] * (vertices[5 * STRIDE + 1] - vertices[1]) + vertices[5] * (vertices[5 * STRIDE + 2] - vertices[2]), 0);
  for (const phase of ['pour', 'drain']) {
    const sim = new Simulation();
    sim.care.autoDrain = sim.care.teaMode = false;
    if (phase === 'pour')
      sim.drain(.15);
    sim.startTransfer(phase, .1, { temperature: 70, sugar: 80 });
    sim.care.transfer.remaining *= .5;
    const state = streamState(sim), start = sampleStream(state, 0), end = sampleStream(state, state.flight);
    assert.ok(end.y < start.y && end.speed > start.speed);
    assert.ok(end.radius < start.radius * 1.5);
    if (phase === 'pour')
      for (const [j, key] of ['x', 'y', 'z'].entries())
        near(end[key], state.impact[j]);
    else {
      near(state.origin[0], SPOUT[0]);
      near(start.x, end.x);
      near(start.z, end.z);
      assert.ok(state.breakup < state.flight);
    }
    const mesh = new Geometry(12000), drops = [];
    buildStreams(mesh, sim, (...p) => drops.push(p));
    assert.ok(mesh.count > 500 && mesh.count < 12000);
    assert.ok(drops.length > 0);
    const smoothState = { ...state, pour: true };
    for (const age of [0, .01, .03]) {
      const p = sampleStream(smoothState, age);
      assert.ok(Number.isFinite(p.radius) && p.radius > 0);
    }
  }
  const a = new Simulation(), b = new Simulation();
  a.startTransfer('drain', .05);
  b.startTransfer('drain', .4);
  assert.ok(transferDuration(b) > transferDuration(a));
  assert.ok(transferDuration(b) <= 2.8);
  assert.ok(transferDuration(a) < 1.3);
});
test('one GPU scene shares depth, keeps particles visible, reuses storage and releases every resource', () => {
  const { canvas, calls, events } = mockCanvas(), scene = createScene(canvas), sim = new Simulation();
  // Even a canvas already at the target size needs its first offscreen target.
  canvas.width = 560;
  canvas.height = 710;
  const view = { sim, canvas: { clientWidth: 560, clientHeight: 710 }, camera: { yaw: 25, elevation: 24 }, ratio: 1, motion: true, overlay: 'liquid', isDark: () => true };
  const before = sim.snapshot();
  assert.equal(scene.render(view), true);
  const depthAttachments = calls.filter(c => c[0] === 'framebufferRenderbuffer' && c[2] === 'DEPTH_ATTACHMENT');
  assert.equal(depthAttachments.length, 2);
  assert.equal(depthAttachments[0][4], depthAttachments[1][4], 'Both targets share the same depth storage');
  assert.ok(scene.count >= sim.agents.length);
  assert.ok(scene.count <= sim.agents.length + 200, 'Default view leaves most of the volume clear');
  assert.ok(scene.points.subarray(0, scene.count * 9).every(Number.isFinite));
  let visible = 0;
  for (let i = 0; i < scene.count; i++)
    if (scene.points[i * 9 + 6] > .4 && scene.points[i * 9 + 7] >= 2.2)
      visible++;
  assert.ok(visible >= sim.agents.length, 'Every living cell remains visibly sized and opaque');
  const allocations = calls.filter(c => ['bufferData', 'texImage2D', 'renderbufferStorage'].includes(c[0])).length;
  const film = scene.film.vertices, points = scene.points;
  view.camera.yaw = 80;
  scene.render(view);
  assert.equal(scene.film.vertices, film);
  assert.equal(scene.points, points);
  assert.equal(calls.filter(c => ['bufferData', 'texImage2D', 'renderbufferStorage'].includes(c[0])).length, allocations);
  assert.equal(calls.filter(c => c[0] === 'blitFramebuffer').length, 4);
  const filmRevision = scene.revision, waterRevision = scene.waterRevision;
  view.overlay = 'sugar';
  scene.render(view);
  assert.equal(scene.revision, filmRevision, 'Chemical overlay must not rebuild the pellicle mesh');
  assert.equal(scene.waterRevision, waterRevision, 'Non-thermal overlay must not rebuild the water mesh');
  view.overlay = 'temperature';
  scene.render(view);
  assert.equal(scene.revision, filmRevision, 'Thermal overlay must not rebuild the pellicle mesh');
  assert.equal(scene.waterRevision, waterRevision + 1, 'Thermal overlay must update the water mesh');
  view.canvas.clientWidth = 320;
  view.ratio = 1.25;
  assert.equal(scene.render(view), true);
  assert.equal(canvas.width, 400);
  assert.equal(canvas.height, 888);
  assert.equal(calls.filter(c => c[0] === 'blitFramebuffer').length, 10);
  assert.deepEqual(sim.snapshot(), before);
  events.get('webglcontextlost')({ preventDefault() { } });
  assert.equal(scene.render(view), false);
  scene.dispose();
  assert.equal(calls.filter(c => c[0] === 'deleteFramebuffer').length, 2);
  assert.equal(calls.filter(c => c[0] === 'deleteRenderbuffer').length, 2);
  assert.ok(calls.some(c => c[0] === 'deleteProgram'));
});
test('liquid color shifts significantly from dark mahogany tea to bright golden-citrine as pH drops', () => {
  const sweet = teaColor(4.55, 0, 'liquid', [0, 0, 0]);
  const mid = teaColor(3.85, 0, 'liquid', [0, 0, 0]);
  const sour = teaColor(3.2, 0, 'liquid', [0, 0, 0]);
  assert.ok(sour[0] - sweet[0] > .4, 'Red channel brightens significantly with acidity');
  assert.ok(sour[1] - sweet[1] > .4, 'Green/amber channel brightens significantly with acidity');
  assert.ok(mid[0] > sweet[0] && sour[0] > mid[0], 'Color shift is monotonic across fermentation pH range');
  const sim = new Simulation(), sweetWater = new Geometry(12000), sourWater = new Geometry(12000);
  sim.fields.acetic.fill(0); sim.fields.gluconic.fill(0);
  buildWater(sweetWater, sim, 'liquid');
  sim.fields.acetic.fill(6); sim.fields.gluconic.fill(6);
  buildWater(sourWater, sim, 'liquid');
  assert.ok(sourWater.vertices[6] > sweetWater.vertices[6] + .25, 'Water mesh vertex colors reflect pH drop');
  assert.ok(sourWater.vertices[7] > sweetWater.vertices[7] + .25);
});
test('tracking voxels stay locked to a single live organism across grid boundaries and recover after loss', () => {
  const sim = new Simulation(), yeast = pickVoxel(sim, 'yeast'), bacteria = pickVoxel(sim, 'bacteria');
  const ctx = new Proxy({}, { get: (target, prop) => prop in target ? target[prop] : () =>
    prop.startsWith('create') ? { addColorStop() {} } : undefined });
  const canvas = { clientWidth: 260, clientHeight: 156, getContext: () => ctx };
  for (const voxel of [yeast, bacteria]) {
    const sample = renderVoxel(canvas, sim, voxel);
    assert.equal(sample.cells, 1);
    assert.equal(sample[voxel.type], 1);
    const agent = sim.agents.find(a => a.id === voxel.agentId);
    agent.x = .87; agent.y = .61; agent.z = .22;
    sim.agents.reverse(); // Array order changes must not change the lock.
    const moved = renderVoxel(canvas, sim, voxel);
    assert.equal(moved.agentId, agent.id);
    assert.equal(voxel.gx, Math.floor(.87 * sim.nx));
    assert.equal(voxel.gy, Math.floor(.61 * sim.ny));
    assert.equal(voxel.gz, Math.floor(.22 * sim.nz));
    const idx = sim.index(agent.x, agent.y, agent.z);
    sim.fields.acetic[idx] = 2.1; sim.fields.gluconic[idx] = .2;
    const local = renderVoxel(canvas, sim, voxel);
    assert.equal(local.ph, phFromAcids(2.1, .2));
    sim.agents = sim.agents.filter(a => a.id !== agent.id);
    const replaced = renderVoxel(canvas, sim, voxel);
    assert.equal(replaced.replaced, true);
    assert.equal(replaced.cells, 1);
    assert.equal(sim.agents.find(a => a.id === replaced.agentId).type, voxel.type);
  }
  sim.agents = sim.agents.filter(a => a.type !== 'yeast');
  const empty = renderVoxel(canvas, sim, yeast);
  assert.equal(empty.cells, 0); assert.equal(empty.agentId, null);
  sim.addAgent('yeast', .5, .5);
  assert.equal(renderVoxel(canvas, sim, yeast).cells, 1);
});

test('tracking context uses real neighbors and simulation-time paths without changing the culture', () => {
  const sim = new Simulation(), voxel = pickVoxel(sim, 'yeast');
  const target = sim.agents.find(a => a.id === voxel.agentId);
  Object.assign(target, { x: .5, y: .5, z: .5 });
  const neighbor = { ...target, id: 9001, type: 'bacteria', x: .52 };
  sim.agents = [target, neighbor, { ...neighbor, id: 9002, x: .98 }];
  const snapshot = sim.snapshot(), first = voxelContext(sim, voxel, target);
  assert.deepEqual(first.neighbors.map(n => n.agent.id), [neighbor.id]);
  assert.deepEqual(first.neighbors[0].position, liquidPosition(sim, neighbor.x, neighbor.y, neighbor.z));
  assert.equal(first.trace.length, 1);
  voxelContext(sim, voxel, target);
  assert.equal(voxel.trace.length, 1, 'Paused redraws never extend the path');
  assert.deepEqual(sim.snapshot(), snapshot, 'Observation must not consume RNG or modify organisms');
  const priorDelta = first.neighbors[0].delta[0];
  target.x = .51; sim.day += .01;
  const moved = voxelContext(sim, voxel, target);
  assert.ok(moved.neighbors[0].delta[0] < priorDelta, 'Neighbor moves relative to the followed cell');
  assert.deepEqual(moved.trace[0], first.centre);
  assert.equal(moved.trace.length, 2);
  for(let i=0;i<50;i++) { sim.day += .01; voxelContext(sim,voxel,target); }
  assert.equal(voxel.trace.length, 32, 'Tracking history is bounded');
  voxelContext(sim,voxel,neighbor);
  assert.equal(voxel.trace.length, 1, 'Acquiring another cell starts a new path');
});

test('animated cell chemistry, billboards and entire trails stay inside the liquid at every wall', () => {
  const { canvas } = mockCanvas(), scene = createScene(canvas), sim = new Simulation();
  sim.volume = .55;
  sim.agents = [0,1,2,3,4,5,6,7].map((n) => ({
    id: n*8, type:n%2?'bacteria':'yeast', x:n&1?.999:.001, y:n&2?.999:.001,z:n&4?.999:.001,
    age:1,energy:.9,metabolism:{sugar:10,oxygen:.5,ethanol:8,co2:5,acid:5,turnover:n+.3}
  }));
  sim.gas.bubbles = [{id:99,x:.999,y:.001,z:.999,size:1.2,drift:3,depthDrift:-3}];
  sim.gas.bursts = [{x:.999,z:.999,age:.1,strength:1}];
  for(let i=0;i<sim.surface.displacement.length;i++) sim.surface.displacement[i]=.018*Math.sin(i*.9);
  sim.temperature.fill(sim.settings.room+10);
  sim.vx.fill(1); sim.vy.fill(-1); sim.vz.fill(1);
  const view={sim,canvas:{clientWidth:300,clientHeight:390},camera:{yaw:65,elevation:32},ratio:1,motion:true,isDark:()=>false,
    voxels:{yeast:{agentId:0},bacteria:{agentId:8}}};
  const before=sim.snapshot();
  const inside=(point,margin=0)=>{
    assert.ok(Math.hypot(point[0],point[2])+margin<=LIQUID_RADIUS+1e-6,'Full sprite radius is within the glass');
    assert.ok(Math.hypot(point[0],point[2])+margin<=Math.min(interiorRadius(point[1]-margin),interiorRadius(point[1]+margin))+1e-6,'Foot and shoulder match the actual inner wall');
    assert.ok(point[1]>=.044+margin-1e-6,'Full sprite clears the glass floor');
    const uv=discToMaterial(point[0],point[2]);
    const surface=(sim.volume-sampleSurface(sim,sim.surface.displacement,...uv))*HEIGHT;
    assert.ok(point[1]+margin<=surface+1e-6,'Full sprite stays below the local liquid surface');
  };
  for(const volume of [.04,.55,.95]) for(const overlay of ['liquid','organisms','sugar','oxygen','ethanol','acidity','co2','flow','temperature']) {
    sim.volume=volume;
    view.overlay=overlay;
    sim.vessel.tilt=7; sim.vessel.tiltZ=-6;
    scene.render(view);
    for(let i=0;i<scene.count;i++) {
      const at=i*9;
      const point=scene.points.subarray(at,at+3),depth=scene.camera.project(point)[2],size=scene.points[at+7],kind=scene.points[at+8];
      const pixels=Math.max(1.8,Math.min(kind>1.5?46:25,size*3.8/depth));
      inside(point,pixels*depth*Math.tan(17*Math.PI/180)/view.canvas.clientHeight);
    }
    for(let i=0;i<scene.trails.count;i+=2) {
      const a=scene.trails.vertices.subarray(i*STRIDE,i*STRIDE+3),b=scene.trails.vertices.subarray((i+1)*STRIDE,(i+1)*STRIDE+3);
      for(const t of [0,.25,.5,.75,1]) inside(Array.from(a,(v,j)=>v+(b[j]-v)*t));
    }
  }
  const after=sim.snapshot(); before.vessel.tilt=7; before.vessel.tiltZ=-6; before.volume=.95;
  assert.deepEqual(after,before);
  const offset=[3,-2,-3],bounded=containInLiquid(sim,offset,.02,[0,0,0]);
  inside(bounded,.02); assert.deepEqual(offset,[3,-2,-3],'Clamping can preserve its input');
  scene.dispose();
});

test('default culture view suppresses reaction confetti and chemical views use one chemical tint', () => {
  const {canvas}=mockCanvas(),scene=createScene(canvas),sim=new Simulation();
  sim.gas.bubbles=[];sim.gas.bursts=[];sim.gas.pockets.fill(0);
  for(const agent of sim.agents) agent.metabolism={sugar:8,oxygen:.5,ethanol:4,co2:4,acid:3,turnover:10};
  const view={sim,canvas:{clientWidth:560,clientHeight:710},camera:{},ratio:1,motion:true,overlay:'liquid',isDark:()=>true};
  const colors=()=>Array.from({length:scene.count},(_,i)=>Array.from(scene.points.subarray(i*9+3,i*9+6)));
  const same=(a,b)=>a.every((value,j)=>Math.abs(value-b[j])<1e-6);
  scene.render(view);
  assert.equal(scene.count,sim.agents.length+180);
  assert.ok(colors().every(color=>[...Object.values(SPECIES_COLORS),FLOW_COLOR].some(allowed=>same(color,allowed))));
  for(const [overlay,chemical] of [['sugar','sugar'],['oxygen','oxygen'],['ethanol','ethanol'],['acidity','acid'],['co2','co2']]) {
    view.overlay=overlay;scene.render(view);
    assert.ok(colors().every(color=>[...Object.values(SPECIES_COLORS),CHEMICAL_COLORS[chemical]].some(allowed=>same(color,allowed))));
  }
  scene.dispose();
});

test('rendered film follows negative gas-supported displacement', () => {
  const sim = new Simulation();
  // Verify buildFilm renders negative gas-supported displacement without clamping at -0.035
  const filmHigh = new Geometry(24000), filmClamped = new Geometry(24000);
  sim.pellicle.fill(.9);
  for (const layer of sim.membrane.layers) layer.fill(.3);
  sim.membrane.displacement.fill(-.07);
  buildFilm(filmHigh, sim);
  sim.membrane.displacement.fill(-.035);
  buildFilm(filmClamped, sim);
  let maxYHigh = -Infinity, maxYClamped = -Infinity;
  for (let i = 1; i < filmHigh.count * STRIDE; i += STRIDE) maxYHigh = Math.max(maxYHigh, filmHigh.vertices[i]);
  for (let i = 1; i < filmClamped.count * STRIDE; i += STRIDE) maxYClamped = Math.max(maxYClamped, filmClamped.vertices[i]);
  assert.ok(maxYHigh > maxYClamped + .02, 'Rendered film geometry must follow negative gas-supported displacement down to -0.07 without clamping at -0.035');
});
test('scene reserves capacity for bubbles in dense cultures, suppresses trails under reduced motion, and gates cross-feeding on metabolism', () => {
  const { canvas } = mockCanvas(), scene = createScene(canvas), sim = new Simulation();
  canvas.width = 560; canvas.height = 710;
  // Populate dense culture with high metabolic rates and add a bubble
  while (sim.agents.length < 1584) sim.addAgent(sim.agents.length % 2 ? 'yeast' : 'bacteria', .5, .5);
  for (const a of sim.agents) a.metabolism = { sugar: 8, oxygen: 1, ethanol: 4, co2: 4, acid: 3, turnover: 10 };
  sim.gas.bubbles.push({ id: 99, x: .5, y: .4, z: .5, size: 1.2, drift: 0, depthDrift: 0 });
  const view = { sim, canvas: { clientWidth: 560, clientHeight: 710 }, camera: { yaw: 25, elevation: 24 }, ratio: 1, motion: true, overlay: 'organisms', isDark: () => true };
  scene.render(view);
  let bubbleSprites = 0;
  for (let i = 0; i < scene.count; i++) if (scene.points[i * 9 + 8] === 1) bubbleSprites++;
  assert.ok(bubbleSprites >= 2, 'Bubbles must still be emitted even in a maximum-density culture');

  // Reduced motion must suppress all trails
  view.motion = false;
  sim.day += .01;
  scene.render(view);
  assert.equal(scene.trails.count, 0, 'Reduced motion must suppress all trail vertices');

  // Cross-feeding links require metabolic activity and do not depend on agent array order
  view.motion = true;
  sim.gas.bubbles.length = 0;
  sim.agents = [
    { id: 1, type: 'yeast', x: .5, y: .5, z: .5, age: 1, energy: .5, traits: { rate: 1, tolerance: 1 }, metabolism: { sugar: 0, oxygen: 0, ethanol: 0, co2: 0, acid: 0, turnover: 0 } },
    { id: 2, type: 'bacteria', x: .52, y: .5, z: .5, age: 1, energy: .5, traits: { rate: 1, tolerance: 1 }, metabolism: { sugar: 0, oxygen: 0, ethanol: 0, co2: 0, acid: 0, turnover: 0 } }
  ];
  sim.day += .01;
  scene.render(view);
  assert.equal(scene.trails.count, 0, 'Dormant cells with zero metabolic rates must not emit cross-feeding filaments');

  // Activate metabolism and verify candidate bacteria array ordering does not change the selected partner
  const y = { id: 8, type: 'yeast', x: .5, y: .5, z: .5, age: 1, energy: .5, traits: { rate: 1, tolerance: 1 }, metabolism: { sugar: 2, oxygen: 0, ethanol: 1.5, co2: 1, acid: 0, turnover: 1 } };
  const bFar = { id: 3, type: 'bacteria', x: .6, y: .5, z: .5, age: 1, energy: .5, traits: { rate: 1, tolerance: 1 }, metabolism: { sugar: 0, oxygen: .2, ethanol: 1.2, co2: 0, acid: 1, turnover: 1 } };
  const bNear = { id: 4, type: 'bacteria', x: .52, y: .5, z: .5, age: 1, energy: .5, traits: { rate: 1, tolerance: 1 }, metabolism: { sugar: 0, oxygen: .2, ethanol: 1.2, co2: 0, acid: 1, turnover: 1 } };
  sim.agents = [y, bFar, bNear];
  sim.day += .01;
  scene.render(view);
  const filamentForward = Array.from(scene.trails.vertices.subarray(0, 2 * STRIDE));
  sim.agents = [y, bNear, bFar];
  scene.day = -1;
  scene.render(view);
  const filamentReverse = Array.from(scene.trails.vertices.subarray(0, 2 * STRIDE));
  assert.ok(scene.trails.count >= 2, 'Active cross-feeding pair emits trail filament');
  assert.deepEqual(filamentForward, filamentReverse, 'Cross-feeding partner selection is independent of candidate bacteria array order');
});




