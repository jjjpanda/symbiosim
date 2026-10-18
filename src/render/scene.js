import { createProgram } from './webgl.js';
import { meshVertex, meshFragment, particleVertex, particleFragment } from './scene-shaders.js';
import { Geometry, STRIDE } from './geometry.js';
import { createJar, createTap, buildWater, buildFilm, teaColor } from './objects.js';
import { cameraMatrix, liquidPosition, containInLiquid, discToMaterial, interiorRadius, HEIGHT } from './space.js';
import { buildStreams } from './streams.js';
import { advanceParticles } from './particles.js';
import { vesselOrientation } from '../sim/vessel.js';
import { reactionPackets, CHEMICAL_COLORS } from '../metabolism.js';
import { SPECIES_COLORS, FLOW_COLOR, MOLD_COLOR, scalarColor } from './palette.js';
import { activityTurnover } from './activity.js';
import { sampleSurface } from '../sim/spatial.js';
import { fieldView, fieldAmount, fieldRange, fieldFraction } from '../fields.js';
import { FILM_CUTOFF, LIQUID_RADIUS } from '../sim/constants.js';
import { filmPoint, sampleFilm } from '../sim/film-body.js';
import { toDisc } from '../sim/domain.js';
export function createScene(canvas) {
  const gl = canvas.getContext('webgl2', { alpha: true, antialias: false, premultipliedAlpha: true, depth: false });
  if (!gl)
    throw new Error('WebGL 2 is required for the 3D vessel.');
  const resources = { programs: [], shaders: [], buffers: [], vaos: [], textures: [], framebuffers: [], renderbuffers: [] };
  let meshProgram, pointProgram;
  try {
    meshProgram = createProgram(gl, meshVertex, meshFragment, resources);
    pointProgram = createProgram(gl, particleVertex, particleFragment, resources);
  }
  catch (error) {
    disposeResources(gl, resources);
    throw error;
  }
  const uniforms = program => Object.fromEntries(['Camera', 'Tilt', 'TiltDirection', 'Eye', 'Background', 'Viewport', 'Backdrop', 'Water', 'Refract', 'Transparent', 'Ratio', 'Zoom'].map(key => [key, gl.getUniformLocation(program, 'u' + key)]));
  const meshUniforms = uniforms(meshProgram), pointUniforms = uniforms(pointProgram);
  const gpu = new Map();
  const meshBuffer = mesh => {
    if (gpu.has(mesh))
      return gpu.get(mesh);
    const vao = gl.createVertexArray(), buffer = gl.createBuffer();
    resources.vaos.push(vao);
    resources.buffers.push(buffer);
    gl.bindVertexArray(vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, mesh.vertices.byteLength, gl.DYNAMIC_DRAW);
    for (const [location, size, offset] of [[0, 3, 0], [1, 3, 3], [2, 4, 6], [3, 1, 10], [4, 2, 11]]) {
      gl.enableVertexAttribArray(location);
      gl.vertexAttribPointer(location, size, gl.FLOAT, false, STRIDE * 4, offset * 4);
    }
    const value = { vao, buffer, revision: -1 };
    gpu.set(mesh, value);
    return value;
  };
  const texture = () => {
    const t = gl.createTexture();
    resources.textures.push(t);
    gl.bindTexture(gl.TEXTURE_2D, t);
    for (const key of [gl.TEXTURE_MIN_FILTER, gl.TEXTURE_MAG_FILTER])
      gl.texParameteri(gl.TEXTURE_2D, key, gl.LINEAR);
    for (const key of [gl.TEXTURE_WRAP_S, gl.TEXTURE_WRAP_T])
      gl.texParameteri(gl.TEXTURE_2D, key, gl.CLAMP_TO_EDGE);
    return t;
  };
  const backdrop = texture(), blank = texture();
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(4));
  const framebuffer = gl.createFramebuffer(), composite = gl.createFramebuffer();
  const depth = gl.createRenderbuffer(), compositeColor = gl.createRenderbuffer();
  resources.framebuffers.push(framebuffer, composite);
  resources.renderbuffers.push(depth, compositeColor);
  const pointVao = gl.createVertexArray(), pointBuffer = gl.createBuffer();
  resources.vaos.push(pointVao);
  resources.buffers.push(pointBuffer);
  gl.bindVertexArray(pointVao);
  gl.bindBuffer(gl.ARRAY_BUFFER, pointBuffer);
  gl.bufferData(gl.ARRAY_BUFFER, 8192 * 9 * 4, gl.DYNAMIC_DRAW);
  for (const [location, size, offset] of [[0, 3, 0], [1, 4, 3], [2, 1, 7], [3, 1, 8]]) {
    gl.enableVertexAttribArray(location);
    gl.vertexAttribPointer(location, size, gl.FLOAT, false, 9 * 4, offset * 4);
  }
  const state = { gl, canvas, jar: createJar(), tap: createTap(), water: new Geometry(12000), film: new Geometry(24000), streams: new Geometry(12000), trails: new Geometry(24000),
    points: new Float32Array(8192 * 9), count: 0, overflow: 0, lost: false, backend: 'webgl2', revision: 0, waterRevision: 0 };
  canvas.addEventListener?.('webglcontextlost', event => { event.preventDefault(); state.lost = true; });
  canvas.addEventListener?.('webglcontextrestored', () => { state.lost = false; state.invalid = true; });
  let renderSim, renderHeight = 710, trailCeiling = 1;
  const bounded = [0, 0, 0], projected = [0, 0, 0];
  const spriteMargin = (p, size, kind) => {
    const depth=state.camera.project(p,projected)[2];
    const pixels=Math.max(1.8,Math.min(kind>1.5?46:25,size*3.8/depth));
    return .004+pixels*depth*Math.tan(17*Math.PI/180)/renderHeight;
  };
  const addPoint = (p, color, alpha, size, kind = 0, internal = true) => {
    if (state.count >= 8192) {
      state.overflow++;
      return false;
    }
    // Include the billboard's world-space radius, not just its centre. This
    // also contains large glows on small screens and at oblique camera angles.
    if(internal) {
      let margin=spriteMargin(p,size,kind);
      containInLiquid(renderSim,p,margin,bounded);
      // Large density sprites can move far enough while being contained to
      // change perspective size. Keep the largest radius at the final depth.
      for (let pass = 0; kind > 1.5 && size >= 20 && pass < 3; pass++) {
        margin = Math.max(margin, spriteMargin(bounded,size,kind));
        containInLiquid(renderSim,bounded,margin,bounded);
      }
      const uv=discToMaterial(bounded[0],bounded[2]);
      const water=(renderSim.volume-sampleSurface(renderSim,renderSim.surface.displacement,...uv))*HEIGHT;
      // Near an empty bottom, an oversized sprite may have no room to fit.
      if(bounded[1]+margin>water) return false;
    }
    const i = state.count++ * 9;
    state.points.set(internal ? bounded : p, i);
    state.points.set(color, i + 3);
    state.points[i + 6] = alpha;
    state.points[i + 7] = size;
    state.points[i + 8] = kind;
    return true;
  };
  const trailVertex = (p, n, color, alpha, material) => {
    if(trailCeiling<.054) return;
    containInLiquid(renderSim, p, .008, bounded);
    // A segment joining two locally submerged endpoints can still cross a
    // wave trough. A common ceiling keeps the whole line below every trough.
    bounded[1] = Math.min(bounded[1], trailCeiling);
    state.trails.vertex(bounded, n, color, alpha, material);
  };
  const yeastColor = SPECIES_COLORS.yeast, bacteriaColor = SPECIES_COLORS.bacteria, symColor = [.64, .69, .56], normal = [0, 1, 0];
  const activeBacteria = [];
  const current = [0, 0, 0], midpoint = [0, 0, 0], currentHead = [0, 0, 0], currentTail = [0, 0, 0], currentTint = [0, 0, 0];
  // Integrate the instantaneous solver field, so curved paths have a readable
  // length at every frame rate. These samples never modify simulation state.
  function emitCurrentPath(s, x, y, z, tint, opacity, range = null) {
    const head = currentHead, tail = currentTail;
    liquidPosition(s, x, y, z, head);
    for (let step = 0; step < 12; step++) {
      s.velocity(x, y, current, z);
      const speed = Math.hypot(...current);
      if (speed < .0005) break;
      const dt = Math.min(.12, .025 / speed);
      const mx = x - current[0] * dt * .5, my = y - current[1] * dt * .5, mz = z - current[2] * dt * .5;
      s.velocity(mx, my, midpoint, mz);
      x -= midpoint[0] * dt; y -= midpoint[1] * dt; z -= midpoint[2] * dt;
      if (Math.min(x, y, z) < .015 || Math.max(x, y, z) > .985) break;
      liquidPosition(s, x, y, z, tail);
      const color = range ? scalarColor(tint, fieldFraction(speed, range), currentTint) : tint;
      const alpha = opacity * (range ? .8 : Math.min(1, speed * 6)) * (1 - step / 12);
      trailVertex(tail, normal, color, alpha * .7, 6);
      trailVertex(head, normal, color, alpha, 6);
      head[0] = tail[0]; head[1] = tail[1]; head[2] = tail[2];
    }
  }
  function emitOrganismsAndGas(view, s, p, old, mark, fieldContext = false) {
    const subdued = view.overlay !== 'liquid';
    for (let idx = 0; idx < s.agents.length; idx++) {
      const agent = s.agents[idx];
      liquidPosition(s, agent.x, agent.y, agent.z, p);
      const isYeast = agent.type === 'yeast';
      const energy = agent.energy ?? .5;
      if (agent.id === view.voxels?.[agent.type]?.agentId) {
        containInLiquid(s, p, spriteMargin(p,12,3));
        addPoint(p, isYeast ? yeastColor : bacteriaColor, subdued ? .28 : .85, 12, 3);
      }
      const size = (isYeast ? 4.5 : 4) + Math.min(1.4, energy * .9);
      addPoint(p, isYeast ? yeastColor : bacteriaColor, subdued ? .16 : .96, size * (subdued ? .75 : 1), isYeast ? 0 : -1 - (agent.id * .618 % 1));
    }
    // Living cells provide context in scalar views; gas glints stay in living views.
    if (fieldContext) return;
    if (view.motion) {
      for (const bubble of s.gas.bubbles) {
        liquidPosition(s, bubble.x, bubble.y, bubble.z, p);
        const bSize = 4.2 + bubble.size * 4.4;
        addPoint(p, [.78, .92, .88], .92, bSize, 1);
        old[0] = p[0] - (bubble.drift || 0) * .018;
        old[1] = Math.max(.04, p[1] - (.024 + bubble.size * .03));
        old[2] = p[2] - (bubble.depthDrift || 0) * .018;
        trailVertex(old, normal, FLOW_COLOR, .05, 6);
        trailVertex(p, normal, FLOW_COLOR, .2, 6);
        addPoint(old, [.82, .94, .9], .58, Math.max(2.2, bSize * .48), 1);
      }
      if (s.gas.bursts) {
        for (const burst of s.gas.bursts) {
          const life = Math.max(0, Math.min(1, 1 - (burst.age || 0) / .32));
          const strength = burst.strength || .5;
          const ringR = (.014 + (1 - life) * .052) * (.55 + strength * .35);
          liquidPosition(s, burst.x, 0, burst.z ?? .5, p);
          for (let k = 0; k < 6; k++) {
            const a = k * 1.0472 + (1 - life) * 2.4;
            mark[0] = p[0] + Math.cos(a) * ringR;
            mark[1] = p[1] + life * (1 - life) * .045 * Math.sin(k * 1.7 + life * 3);
            mark[2] = p[2] + Math.sin(a) * ringR;
            addPoint(mark, [.88, .96, .92], .78 * life, 2.4 + life * 2.6, 1);
          }
        }
      }
    }
    const filmDisplacement = s.filmContact?.displacement ?? s.membrane.displacement;
    for (let z = 0; z < s.nz; z++)
      for (let x = 0; x < s.nx; x++) {
        const i = z * s.nx + x, amount = s.gas.pockets[i];
        if (amount < .03)
          continue;
        const u = (x + .5) / s.nx, v = (z + .5) / s.nz;
        if (sampleFilm(s, s.pellicle, u, v) < FILM_CUTOFF) continue;
        liquidPosition(s, u, 0, v, p);
        p[1] = Math.min(p[1], (s.volume - filmDisplacement[i]) * HEIGHT - .018);
        addPoint(p, [.82, .91, .75], .9, Math.min(13, 4 + Math.sqrt(amount) * 6), 1);
      }
  }
  function emitMetabolicInteractions(view, s, p, mark, mate, maxPoints) {
    if (view.overlay !== 'organisms') return;
    activeBacteria.length = 0;
    for (let i = 0; i < s.agents.length; i++) {
      const a = s.agents[i];
      if (a.type === 'bacteria' && ((a.metabolism?.ethanol ?? 0) + (a.metabolism?.acid ?? 0)) > .01)
        activeBacteria.push(a);
    }
    for (let idx = 0; idx < s.agents.length && state.count < maxPoints; idx++) {
      const agent = s.agents[idx];
      liquidPosition(s, agent.x, agent.y, agent.z, p);
      const isYeast = agent.type === 'yeast';
      if (agent.id % 8 === 0) {
        for (const packet of reactionPackets(agent, view.motion, activityTurnover(view, agent))) {
          if (state.count >= maxPoints)
            break;
          const span = packet.intake ? 1 - packet.phase : packet.phase;
          const radius = .018 + .054 * span;
          mark[0] = p[0] + Math.cos(packet.angle) * radius;
          mark[1] = p[1] + Math.sin(packet.angle) * radius;
          mark[2] = p[2] + Math.sin(agent.id + packet.angle) * radius * .72;
          addPoint(mark, packet.color, .3 + .35 * packet.strength, 2 + packet.strength);
          if (view.motion && packet.strength > .2) {
            trailVertex(p, normal, packet.color, .08, 6);
            trailVertex(mark, normal, packet.color, .18 + .15 * packet.strength, 6);
          }
        }
      }
      // Symbiotic cross-feeding filaments require active yeast ethanol production and
      // active bacterial oxidation, selecting the nearest partner independent of array order.
      const yeastFlux = isYeast ? (agent.metabolism?.ethanol ?? 0) : 0;
      if (view.motion && view.overlay === 'organisms' && yeastFlux > .01 && agent.id % 8 === 0 && state.count < maxPoints) {
        let bestOther = null, bestD2 = .026;
        for (let j = 0; j < activeBacteria.length; j++) {
          const other = activeBacteria[j];
          const dx = other.x - agent.x, dy = other.y - agent.y, dz = (other.z ?? .5) - (agent.z ?? .5);
          const d2 = dx * dx + dy * dy + dz * dz;
          if (d2 < bestD2 - 1e-12 || (Math.abs(d2 - bestD2) <= 1e-12 && (!bestOther || other.id < bestOther.id))) {
            bestD2 = d2;
            bestOther = other;
          }
        }
        if (bestOther) {
          const bacFlux = (bestOther.metabolism?.ethanol ?? 0) + (bestOther.metabolism?.acid ?? 0);
          const fluxScale = Math.min(1, Math.sqrt(Math.min(yeastFlux, bacFlux)));
          liquidPosition(s, bestOther.x, bestOther.y, bestOther.z, mate);
          const linkAlpha = (1 - bestD2 / .026) * (view.overlay === 'organisms' ? .62 : .42) * (.45 + .55 * fluxScale);
          trailVertex(p, normal, yeastColor, linkAlpha * .4, 6);
          trailVertex(mate, normal, bacteriaColor, linkAlpha * .4, 6);
          const pulse = (activityTurnover(view, agent) * .22 + agent.id * .17) % 1;
          mark[0] = p[0] + (mate[0] - p[0]) * pulse;
          mark[1] = p[1] + (mate[1] - p[1]) * pulse;
          mark[2] = p[2] + (mate[2] - p[2]) * pulse;
          addPoint(mark, symColor, .45 + linkAlpha * .5, 3.1);
        }
      }
    }
  }
  function synchronize(view) {
    const s = view.sim, coverage = s.coverage(), thermalOverlay = view.overlay === 'temperature';
    const field = fieldView(view.overlay), chemical = field?.chemical;
    const moldOverlay = view.overlay === 'mold', moldRange = moldOverlay ? fieldRange(s, 'mold') : null;
    const scalar = thermalOverlay || Boolean(chemical) || moldOverlay;
    const range = chemical || view.overlay === 'flow' ? fieldRange(s, view.overlay) : null;
    renderSim = s;
    renderHeight = Math.max(100, view.canvas.clientHeight);
    let deepestSurface = 0;
    for (const displacement of s.surface.displacement) deepestSurface = Math.max(deepestSurface, displacement);
    trailCeiling = Math.max(.046, (s.volume - deepestSurface) * HEIGHT - .012);
    const simChanged = state.sim !== s || state.day !== s.day || state.volume !== s.volume || state.coverage !== coverage;
    if (simChanged || state.moldOverlay !== moldOverlay) {
      buildFilm(state.film, s, moldRange);
      state.revision++;
    }
    if (simChanged || state.thermalOverlay !== thermalOverlay || (thermalOverlay && state.thermalRoom !== s.settings.room)) {
      buildWater(state.water, s, view.overlay);
      state.waterRevision++;
    }
    state.sim = s;
    state.day = s.day;
    state.volume = s.volume;
    state.coverage = coverage;
    state.overlay = view.overlay;
    state.thermalOverlay = thermalOverlay;
    state.thermalRoom = s.settings.room;
    state.moldOverlay = moldOverlay;
    advanceParticles(view, 0);
    state.count = 0;
    state.overflow = 0;
    state.trails.count = 0;
    state.streams.count = 0;
    const p = [0, 0, 0], old = [0, 0, 0], mark = [0, 0, 0], mate = [0, 0, 0], particles = view.particles;
    // 1. Reserve primary capacity for streams/droplets, living organisms, and gas bubbles/pockets.
    // Transfer droplets intentionally travel outside the vessel.
    state.stream = buildStreams(state.streams, s, (...args) => addPoint(...args, false));
    // Keep actual cells visible without competing with the quantitative samples.
    emitOrganismsAndGas(view, s, p, old, mark, scalar);
    // Spores stay attached to the moving material, above its rendered top.
    const moldTint = [0, 0, 0];
    for (let i = 0; i < s.pellicle.length; i++) {
      const amount = s.mold.coverage[i];
      if (amount < .001 || s.pellicle[i] < FILM_CUTOFF) continue;
      const u = (i % s.nx + .5) / s.nx, v = (Math.floor(i / s.nx) + .5) / s.nz;
      filmPoint(s, u, v, current);
      toDisc(current[0], current[1], p, LIQUID_RADIUS);
      p[2] = p[1];
      const blister = Math.min(1, sampleSurface(s, s.gas.pockets, current[0], current[1]) * 1.1);
      p[1] = (s.volume - s.membrane.displacement[i]) * HEIGHT + .004 + s.pellicle[i] * .0055 + s.membrane.layers[2][i] * .0018 + blister * .003;
      const size = moldOverlay ? 5 : 2 + Math.sqrt(amount) * 5;
      const radius = interiorRadius(p[1]) - spriteMargin(p, size, 5) - .002;
      const distance = Math.hypot(p[0], p[2]);
      if (distance > radius) { p[0] *= radius / distance; p[2] *= radius / distance; }
      const tint = moldOverlay ? scalarColor(MOLD_COLOR, fieldFraction(fieldAmount(s, 'mold', i), moldRange), moldTint) : MOLD_COLOR;
      addPoint(p, tint, .9, size, 5, false);
    }
    // 2. Emit metabolic packets and cross-feeding links within a bounded budget.
    emitMetabolicInteractions(view, s, p, mark, mate, Math.min(6800, state.count + 3200));
    // Temperature is a scalar volume, sampled at distributed tracer positions.
    // Stepping a flattened grid by nx aliases every sample to one x column.
    const thermal = thermalOverlay ? fieldRange(s, 'temperature') : null, thermalTint = [0, 0, 0], scalarTint = [0, 0, 0];
    // 4. Fill remaining capacity with ambient chemical tracers and flow streaks.
    for (let i = 0; !moldOverlay && i < particles.length && state.count < 8192; i += 3) {
      const x = particles[i], y = particles[i + 1], z = particles[i + 2], index = s.index(x, y, z);
      const heat = thermal ? Math.max(-1, Math.min(1, (s.temperature[index] - thermal.centre) / thermal.extent)) : 0;
      const amount = range ? fieldAmount(s, view.overlay, index) : 1;
      const fieldTint = chemical ? CHEMICAL_COLORS[chemical] : thermal ? teaColor(0, heat, 'temperature', thermalTint) : FLOW_COLOR;
      const color = range ? scalarColor(fieldTint, fieldFraction(amount, range), scalarTint) : fieldTint;
      if (range && amount <= 0)
        continue;
      liquidPosition(s, x, y, z, p);
      addPoint(p, color, range || thermal ? .94 : view.overlay === 'liquid' ? .20 : .24,
        range || thermal ? 4.5 : 1.8, range || thermal ? 4 : 0);
      if (view.motion && (view.overlay === 'flow' || view.overlay === 'liquid') && i / 3 % 7 === 0) {
        emitCurrentPath(s, x, y, z, FLOW_COLOR, view.overlay === 'liquid' ? .16 : .48, range);
      }
    }
    state.pointRevision = (state.pointRevision || 0) + 1;
  }
  const drawMesh = (mesh, revision, mode = gl.TRIANGLES) => {
    if (!mesh.count)
      return;
    const data = meshBuffer(mesh);
    gl.bindVertexArray(data.vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, data.buffer);
    if (data.revision !== revision) {
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, mesh.vertices.subarray(0, mesh.count * STRIDE));
      data.revision = revision;
    }
    gl.drawArrays(mode, 0, mesh.count);
  };
  state.render = view => {
    if (state.lost)
      return false;
    if (state.invalid)
      throw new Error('The 3D context was restored; recreate the scene.');
    const width = view.canvas.clientWidth, height = view.canvas.clientHeight, ratio = Math.min(view.sim.nx < 20 ? 1.5 : 1.75, view.ratio || 1);
    const pixelWidth = Math.max(1, Math.round(width * ratio)), pixelHeight = Math.max(1, Math.round(height * ratio));
    if (state.pixelWidth !== pixelWidth || state.pixelHeight !== pixelHeight) {
      canvas.width = pixelWidth;
      canvas.height = pixelHeight;
      gl.bindTexture(gl.TEXTURE_2D, backdrop);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, pixelWidth, pixelHeight, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
      gl.bindRenderbuffer(gl.RENDERBUFFER, depth);
      gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_COMPONENT24, pixelWidth, pixelHeight);
      gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, backdrop, 0);
      gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, depth);
      if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE)
        throw new Error('3D scene framebuffer is incomplete');
      gl.bindRenderbuffer(gl.RENDERBUFFER, compositeColor);
      gl.renderbufferStorage(gl.RENDERBUFFER, gl.RGBA8, pixelWidth, pixelHeight);
      gl.bindFramebuffer(gl.FRAMEBUFFER, composite);
      gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.RENDERBUFFER, compositeColor);
      gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, depth);
      if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE)
        throw new Error('3D composite framebuffer is incomplete');
      state.pixelWidth = pixelWidth;
      state.pixelHeight = pixelHeight;
    }
    const pose = vesselOrientation(view.sim), tilt = pose.angle, camera = cameraMatrix(width, height, view.camera, pose), dark = view.isDark();
    state.camera = camera;
    synchronize(view);
    gl.viewport(0, 0, pixelWidth, pixelHeight);
    gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LEQUAL);
    gl.disable(gl.CULL_FACE);
    gl.enable(gl.BLEND);
    gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.useProgram(meshProgram);
    gl.uniformMatrix4fv(meshUniforms.Camera, false, camera.matrix);
    gl.uniform2f(meshUniforms.Tilt, Math.cos(tilt), Math.sin(tilt));
    gl.uniform2f(meshUniforms.TiltDirection, pose.x, pose.z);
    gl.uniform3fv(meshUniforms.Eye, camera.eye);
    gl.uniform3fv(meshUniforms.Background, dark ? [.063, .078, .09] : [.957, .953, .937]);
    gl.uniform1f(meshUniforms.Water, view.sim.volume * HEIGHT);
    gl.uniform2f(meshUniforms.Viewport, pixelWidth, pixelHeight);
    gl.uniform1i(meshUniforms.Backdrop, 0);
    gl.uniform1f(meshUniforms.Refract, 0);
    gl.uniform1f(meshUniforms.Transparent, view.transparent || view.hasAttribute?.('transparent') ? 1 : 0);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, blank);
    gl.depthMask(true);
    drawMesh(state.tap, 0);
    drawMesh(state.film, state.revision);
    gl.depthMask(false);
    drawMesh(state.trails, state.pointRevision, gl.LINES);
    gl.useProgram(pointProgram);
    gl.uniformMatrix4fv(pointUniforms.Camera, false, camera.matrix);
    gl.uniform2f(pointUniforms.Tilt, Math.cos(tilt), Math.sin(tilt));
    gl.uniform2f(pointUniforms.TiltDirection, pose.x, pose.z);
    gl.uniform1f(pointUniforms.Ratio, ratio);
    gl.uniform1f(pointUniforms.Zoom, Math.max(1, Math.min(3, view.camera.zoom || 1)));
    gl.bindVertexArray(pointVao);
    gl.bindBuffer(gl.ARRAY_BUFFER, pointBuffer);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, state.points.subarray(0, state.count * 9));
    gl.drawArrays(gl.POINTS, 0, state.count);
    // Both scene targets share our depth attachment. Never copy depth into
    // the browser's default target: its format is implementation-dependent,
    // and an incompatible depth blit also rejects the colour copy, leaving
    // trails of earlier glass and streams on screen.
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, framebuffer);
    gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, composite);
    gl.blitFramebuffer(0, 0, pixelWidth, pixelHeight, 0, 0, pixelWidth, pixelHeight, gl.COLOR_BUFFER_BIT, gl.NEAREST);
    gl.bindFramebuffer(gl.FRAMEBUFFER, composite);
    gl.useProgram(meshProgram);
    gl.bindTexture(gl.TEXTURE_2D, backdrop);
    gl.uniform1f(meshUniforms.Refract, 1);
    gl.depthMask(false);
    gl.enable(gl.CULL_FACE);
    gl.cullFace(gl.FRONT);
    drawMesh(state.water, state.waterRevision);
    drawMesh(state.jar, 0);
    gl.cullFace(gl.BACK);
    drawMesh(state.water, state.waterRevision);
    drawMesh(state.jar, 0);
    gl.disable(gl.CULL_FACE);
    drawMesh(state.streams, state.pointRevision);
    gl.depthMask(true);
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, composite);
    gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, null);
    gl.blitFramebuffer(0, 0, pixelWidth, pixelHeight, 0, 0, pixelWidth, pixelHeight, gl.COLOR_BUFFER_BIT, gl.NEAREST);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    return true;
  };
  state.dispose = () => {
    disposeResources(gl, resources);
    gpu.clear();
  };
  return state;
}
function disposeResources(gl, resources) {
  for (const [key, method] of [['buffers', 'deleteBuffer'], ['vaos', 'deleteVertexArray'], ['textures', 'deleteTexture'], ['framebuffers', 'deleteFramebuffer'], ['renderbuffers', 'deleteRenderbuffer'], ['programs', 'deleteProgram'], ['shaders', 'deleteShader']])
    for (const resource of resources[key])
      gl[method](resource);
  gl.getExtension('WEBGL_lose_context')?.loseContext();
}
