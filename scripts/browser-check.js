import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { access, mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

// No automation dependency: drive a headless Chromium browser over CDP.
// BROWSER_PATH can point to Edge or Chrome on any supported platform.
const root = fileURLToPath(new URL('../', import.meta.url));
const site = resolve(root, process.argv[2] || '.');
const artifacts = resolve(root, '.artifacts');
const layoutOnly = process.env.LAYOUT_ONLY === '1';
const embedOnly = process.argv.includes('--embed');
const candidates = [process.env.BROWSER_PATH, 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Google/Chrome/Application/chrome.exe', '/usr/bin/chromium', '/usr/bin/google-chrome',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'].filter(Boolean);
let executable;
for (const candidate of candidates) {
  try { await access(candidate); executable = candidate; break; } catch { /* Try the next installed browser. */ }
}
assert.ok(executable, 'Set BROWSER_PATH to an installed Chrome or Edge executable');
await mkdir(artifacts, { recursive: true });
const profile = await mkdtemp(resolve(artifacts, 'browser-'));
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const server = spawn(process.execPath, ['scripts/serve.js', site], {
  cwd: root, env: { ...process.env, PORT: '0' }, windowsHide: true, stdio: 'pipe'
});
const gpuFlags = layoutOnly ? ['--disable-gpu', '--disable-software-rasterizer'] : ['--enable-unsafe-swiftshader', '--use-angle=swiftshader'];
const browser = spawn(executable, ['--headless=new', ...gpuFlags, '--no-first-run', '--no-default-browser-check',
  '--remote-debugging-pipe', `--user-data-dir=${profile}`, 'about:blank'], {
  windowsHide: true, stdio: ['ignore','pipe','pipe','pipe','pipe']
});
let socket;
const failures = [];
let siteUrl;
server.stdout.on('data', chunk => {
  const match = chunk.toString().match(/http:\/\/127\.0\.0\.1:\d+/);
  if (match) siteUrl = match[0];
});
server.stderr.on('data', chunk => failures.push(chunk.toString()));
server.on('error', error => failures.push(error.message));
browser.on('error', error => failures.push(error.message));
let diagnostics = '';
browser.stderr.on('data', chunk => {
  diagnostics += chunk.toString();
});
try {
  for (let attempt = 0; attempt < 100 && !siteUrl && !failures.length; attempt++) {
    await pause(100);
  }
  assert.deepEqual(failures, []);
  assert.ok(siteUrl, 'Local server must start');
  let sequence = 0, pageSession;
  const pending = new Map(), errors = [];
  const onMessage = data => {
    const message = JSON.parse(data);
    if (message.id) {
      const request = pending.get(message.id);
      if (!request) return;
      pending.delete(message.id);
      message.error ? request.reject(message.error) : request.resolve(message.result);
    }
    if (message.method === 'Runtime.exceptionThrown') errors.push(message.params.exceptionDetails);
    if (message.method === 'Network.responseReceived' && message.params.response.status >= 400 && !message.params.response.url.endsWith('/favicon.ico')) errors.push(message.params.response);
  };
  let incoming=Buffer.alloc(0);
  browser.stdio[4].on('data',chunk=>{
    incoming=Buffer.concat([incoming,chunk]);
    for(let end;(end=incoming.indexOf(0))>=0;){
      onMessage(incoming.subarray(0,end).toString('utf8'));incoming=incoming.subarray(end+1);
    }
  });
  socket={send:data=>browser.stdio[3].write(data+'\0'),close:()=>browser.stdio[3].end()};
  browser.stdio[3].on('error',error=>failures.push(error.message));
  const command = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++sequence;
    const timeout = setTimeout(() => { pending.delete(id); reject(new Error(`Browser command timed out: ${method}. ${diagnostics}`)); }, 15000);
    pending.set(id, {
      resolve: result => { clearTimeout(timeout); resolve(result); },
      reject: error => { clearTimeout(timeout); reject(error); }
    });
    socket.send(JSON.stringify({ id, method, params, ...(pageSession ? { sessionId: pageSession } : {}) }));
  });
  const evaluate = async expression => {
    const result = await command('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    assert.ok(!result.exceptionDetails, JSON.stringify(result.exceptionDetails));
    return result.result.value;
  };
  const screenshot = async name => {
    const result = await command('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true });
    await writeFile(resolve(artifacts, name + '.png'), Buffer.from(result.data, 'base64'));
  };
  const metrics = (width, height) => command('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: width < 640 });
  const target = await command('Target.createTarget', { url: 'about:blank' });
  const attached = await command('Target.attachToTarget', { targetId: target.targetId, flatten: true });
  pageSession = attached.sessionId;
  await command('Runtime.enable'); await command('Page.enable'); await command('Network.enable');
  if (!embedOnly) {
  await metrics(1365, 900);
  await command('Page.navigate', { url: siteUrl });
  for (let i=0;i<40;i++) {
    if(await evaluate(`Boolean(document.querySelector('symbiosim-vessel')?.sim)`))break;
    await pause(100);
  }
  const inspect = () => evaluate(`(() => {
    const v=document.querySelector('symbiosim-vessel');v.sim.playing=false;v.draw();
    return { error:v.sceneError, backend:v.sceneRenderer?.backend, particles:v.sceneRenderer?.count, organisms:v.sim.agents.length,
      film:v.sceneRenderer?.film.count, depth:v.sim.nz, gl:v.sceneRenderer?.gl.getError(),
      width:document.documentElement.clientWidth,scroll:document.documentElement.scrollWidth };
  })()`);
  // Assert actions never cover the simulation, and both locks render real cells.
  const checkTrackingLayout = () => evaluate(`(() => {
    const v=document.querySelector('symbiosim-vessel');v.sim.playing=false;v.drawVoxel();
    const field=v.canvas.getBoundingClientRect(),actions=v.$('.fluid-actions').getBoundingClientRect();
    const overlap=field.width>0 && actions.left<field.right && actions.right>field.left && actions.top<field.bottom && actions.bottom>field.top;
    return {overlap,locks:Object.entries(v.voxels).map(([type,lock])=>({type,id:lock.agentId,
      species:v.sim.agents.find(a=>a.id===lock.agentId)?.type,summary:v.$('#'+type+'-summary').textContent})),
      presets:v.$$('[data-preset]').length,quickTweaks:Boolean(v.$('.quick-tweaks'))};
  })()`);
  const tracking=await checkTrackingLayout();
  assert.equal(tracking.overlap,false);assert.equal(tracking.locks.length,2);
  for(const lock of tracking.locks){assert.equal(lock.species,lock.type);assert.match(lock.summary,/pH/);}
  assert.equal(tracking.presets,6);assert.equal(tracking.quickTweaks,false);
  const fields = await evaluate(`(() => {
    const v=document.querySelector('symbiosim-vessel'), results=[];
    for(const option of v.$('#overlay').options) {
      v.$('#overlay').value=option.value;v.$('#overlay').dispatchEvent(new Event('change'));
      results.push({id:v.overlay, selected:v.$('#overlay').value===v.overlay ? 1 : 0,
        title:v.$('#field-title').textContent, description:v.$('#field-description').textContent,
        reading:v.$('#field-reading').textContent,error:v.sceneError,gl:v.sceneRenderer?.gl.getError()});
    }
    v.selectField('liquid');
    return results;
  })()`);
  assert.equal(fields.length,10);
  for(const field of fields) {
    assert.equal(field.selected,1);assert.ok(field.title&&field.description);
    assert.doesNotMatch(field.reading,/NaN|undefined/);
    if(!layoutOnly){assert.equal(field.error,undefined);assert.equal(field.gl,0);}
  }
  // Hit-test and click the actual controls, including after focus moves to a button.
  const clickControl = async selector => {
    const point = await evaluate(`(() => {
      const v=document.querySelector('symbiosim-vessel'),button=v.$(${JSON.stringify(selector)});
      button.scrollIntoView({block:'nearest'});const r=button.getBoundingClientRect();
      const x=r.left+r.width/2,y=r.top+r.height/2;
      return {x,y,hit:v.shadowRoot.elementFromPoint(x,y)?.closest('button')===button};
    })()`);
    assert.equal(point.hit,true,selector+' must receive pointer input');
    await command('Input.dispatchMouseEvent',{type:'mousePressed',x:point.x,y:point.y,button:'left',clickCount:1});
    await command('Input.dispatchMouseEvent',{type:'mouseReleased',x:point.x,y:point.y,button:'left',clickCount:1});
  };
  await evaluate(`document.querySelector('symbiosim-vessel').camera.yaw=0`);
  await clickControl('[data-camera="right"]');
  assert.equal(await evaluate(`document.querySelector('symbiosim-vessel').camera.yaw`),10);
  await clickControl('[data-zoom="1.25"]');
  assert.equal(await evaluate(`document.querySelector('symbiosim-vessel').camera.zoom`),1.25);
  await clickControl('#reset-camera');
  assert.equal(await evaluate(`document.querySelector('symbiosim-vessel').camera.zoom`),1);
  assert.equal(await evaluate(`(() => {
    const v=document.querySelector('symbiosim-vessel'), nav=v.$('nav').getBoundingClientRect();
    return Math.abs(nav.left+nav.width/2-innerWidth/2)<2 && !v.$('.trend') && !v.$('nav [data-chart]') && !v.$('.care-heading button');
  })()`),true,'Centered top controls without redundant buttons or culture card');
  await clickControl('#speed-toggle');
  const popup=await evaluate(`(() => {
    const v=document.querySelector('symbiosim-vessel'),p=v.$('#speed-popup'),nav=v.$('nav').getBoundingClientRect(),r=p.getBoundingClientRect();
    const rail=v.$('.left-rail'),inst=v.$('.instruments').getBoundingClientRect();
    return {open:!p.hidden,below:r.top>=nav.bottom,instTop:inst.top,navTop:nav.top,railFits:rail.scrollHeight<=rail.clientHeight+1,
      restart:Boolean(v.$('nav [data-k="n"]')),panelRestart:Boolean(v.$('#panel [data-k="n"]')),hint:Boolean(v.$('.sample-hint'))};
  })()`);
  assert.equal(popup.open,true);assert.equal(popup.below,true,'Pace popup opens under the top bar');
  assert.ok(popup.instTop<=popup.navTop+2,'Right panel starts at the top of the viewport');
  assert.equal(popup.railFits,true,'Left voxels fit without overflow');
  assert.equal(popup.restart,true);assert.equal(popup.panelRestart,false);assert.equal(popup.hint,false);
  await clickControl('#speed-toggle');
  assert.equal(await evaluate(`document.querySelector('symbiosim-vessel').$('#speed-popup').hidden`),true);
  await evaluate(`document.querySelector('symbiosim-vessel').selectField('ethanol')`);
  assert.equal(await evaluate(`document.querySelector('symbiosim-vessel').$('#field-history-title').textContent`),'Ethanol history');
  await evaluate(`document.querySelector('symbiosim-vessel').selectField('liquid')`);
  await clickControl('#swirl');
  assert.equal(await evaluate(`document.querySelector('symbiosim-vessel').$('[role=status]').textContent`),'');
  assert.match(await evaluate(`document.querySelector('symbiosim-vessel').$('#swirl-speed').textContent`),/rpm/);
  const themeBefore=await evaluate(`document.querySelector('symbiosim-vessel').isDark()`);
  const themeIconBefore=await evaluate(`document.querySelector('symbiosim-vessel').$('[data-k="t"] path').getAttribute('d')`);
  await clickControl('[data-k="t"]');
  assert.notEqual(await evaluate(`document.querySelector('symbiosim-vessel').isDark()`),themeBefore);
  assert.notEqual(await evaluate(`document.querySelector('symbiosim-vessel').$('[data-k="t"] path').getAttribute('d')`),themeIconBefore);
  assert.equal(await evaluate(`(async () => {
    const icons=[...document.querySelectorAll('link[rel="icon"]')];
    const responses=await Promise.all(icons.map(icon=>fetch(icon.href)));
    return icons.length===2 && responses.every(response=>response.ok);
  })()`),true,'SVG and ICO favicon URLs must both load');
  await clickControl('#field-history-open');
  assert.equal(await evaluate(`document.querySelector('symbiosim-vessel').$('#detail').open`),true);
  assert.equal(await evaluate(`document.querySelector('symbiosim-vessel').$$('.history-card').length`),10);
  await clickControl('[data-close="detail"]');
  assert.equal(await evaluate(`(() => {const v=document.querySelector('symbiosim-vessel');return ['pour','drain','starter','skim'].every(id=>v.$('#'+id).closest('.care-card') && !v.$('#'+id).closest('dialog'));})()`),true);
  // Exercise actual browser pointer capture and Shift modifiers on both axes.
  const pointerOrigin=await evaluate(`(() => {
    const v=document.querySelector('symbiosim-vessel');v.camera.yaw=0;v.sim.vessel.tilt=v.sim.vessel.tiltZ=0;v.draw();
    const r=v.canvas.getBoundingClientRect();return {x:r.left+r.width/2,y:r.top+r.height/2};
  })()`);
  for(const [dx,dy,key] of [[60,0,'tilt'],[0,60,'tiltZ']]){
    await evaluate(`(() => {const v=document.querySelector('symbiosim-vessel');v.sim.vessel.tilt=v.sim.vessel.tiltZ=0;})()`);
    await command('Input.dispatchMouseEvent',{type:'mousePressed',x:pointerOrigin.x,y:pointerOrigin.y,button:'left',clickCount:1,modifiers:8});
    await command('Input.dispatchMouseEvent',{type:'mouseMoved',x:pointerOrigin.x+dx,y:pointerOrigin.y+dy,button:'left',buttons:1,modifiers:8});
    await command('Input.dispatchMouseEvent',{type:'mouseReleased',x:pointerOrigin.x+dx,y:pointerOrigin.y+dy,button:'left',clickCount:1,modifiers:8});
    assert.ok(await evaluate(`document.querySelector('symbiosim-vessel').sim.vessel.${key}>4`),`Shift drag must change ${key}`);
  }
  await evaluate(`document.querySelector('symbiosim-vessel').$('#upright-jar').click()`);
  if (layoutOnly) {
    await evaluate(`document.querySelector('symbiosim-vessel').setViewMode('voxel')`);
    for (const width of [320,390,640,768,900,1024,1365]) {
      await metrics(width,844);await pause(100);
      const layout=await evaluate(`(() => {
        const v=document.querySelector('symbiosim-vessel');v.sim.playing=false;v.updateReadings();
        const controls=[...v.$$('nav button,.fluid-actions button,.stats button,.exchange')].filter(e=>e.getClientRects().length>0);
        return { width:document.documentElement.clientWidth,scroll:document.documentElement.scrollWidth,
          field:v.canvas.clientHeight,voxel:Math.min(...Object.values(v.voxelCanvases).map(c=>c.clientHeight)),ph:v.$('#ph').textContent,thickness:v.$('#film-thickness').textContent,
          overflow:controls.some(e=>{const r=e.getBoundingClientRect();return r.left<0||r.right>innerWidth+1;}),
          touch:controls.every(e=>e.getBoundingClientRect().height>=43),lens:Boolean(v.$('.lens')) };
      })()`);
      assert.equal(layout.width,layout.scroll);assert.equal(layout.overflow,false);assert.equal((await checkTrackingLayout()).overlap,false);
      assert.match(layout.ph,/^\d+\.\d{2}$/);assert.match(layout.thickness,/mm$/);assert.equal(layout.lens,false);
      if(width<=1100){assert.ok(layout.field>=380,`Vessel must remain visible below 1100px even if voxel view mode was active (${width}px: field ${layout.field})`);assert.ok(layout.voxel>=150,`Voxel too small at ${width}px: ${layout.voxel}`);}
      if(width<=640){assert.ok(layout.touch);assert.ok(layout.field>=380&&layout.field<=650);}
    }
    await evaluate(`document.querySelector('symbiosim-vessel').setViewMode('split')`);
    await screenshot('care-layout-phone');
    assert.equal(await evaluate(`(() => {
      const v=document.querySelector('symbiosim-vessel');
      for(const btn of v.$$('[data-preset]')){btn.click();v.advance(.01);}
      v.$('#auto-skim').checked=false;
      v.$('#auto-skim').dispatchEvent(new Event('change'));
      return v.sim.care.autoSkim === false && Number.isFinite(v.sim.headspace.oxygen) && Number.isFinite(v.sim.meanTemperature());
    })()`),true);
    const embedFit = await evaluate(`(async () => {
      const box = document.createElement('div');
      box.style.cssText = 'width: 260px; height: 220px; overflow: hidden;';
      document.body.appendChild(box);
      const v = document.querySelector('symbiosim-vessel');
      box.appendChild(v); v.style.minHeight = '0';
      v.setAttribute('embed', '');
      v.setAttribute('transparent', '');
      v.setAttribute('width', '420');
      v.setAttribute('height', '520');
      // Re-parenting a shadow host can briefly reload its linked stylesheet.
      for (let i = 0; i < 40 && getComputedStyle(v.$('.layout')).display !== 'grid'; i++) await new Promise(r => setTimeout(r, 50));
      const hostRect = v.getBoundingClientRect(), layoutRect = v.$('.layout').getBoundingClientRect(), canvasRect = v.canvas.getBoundingClientRect();
      const hiddenUi = ['.masthead', '.left-rail', '.instruments', '.hud', '.vessel-tools', '.field-footer'].every(sel => v.$(sel).getClientRects().length === 0);
      const bg = getComputedStyle(v).backgroundColor;
      v.removeAttribute('embed'); v.removeAttribute('transparent'); v.removeAttribute('width'); v.removeAttribute('height');
      v.style.minHeight = ''; document.body.appendChild(v); box.remove();
      return { hostW: Math.round(hostRect.width), hostH: Math.round(hostRect.height), layoutH: Math.round(layoutRect.height), canvasH: Math.round(canvasRect.height), hiddenUi, bg };
    })()`);
    assert.deepEqual(embedFit, { hostW: 260, hostH: 220, layoutH: 220, canvasH: 220, hiddenUi: true, bg: 'rgba(0, 0, 0, 0)' });
    assert.deepEqual(errors,[]);
    console.log('PASS: responsive layout at seven widths (including voxel-mode resize and embed container fit), readable stats, touch targets, presets, no zoom overlay and auto-skim control. GPU rendering was disabled.');
  } else {
  const fresh=await inspect();
  assert.equal(fresh.error,undefined);assert.equal(fresh.backend,'webgl2');assert.ok(fresh.particles>=fresh.organisms&&fresh.film>1000);
  assert.ok(fresh.particles<=fresh.organisms+200,'Default culture view keeps chemical clutter out of the vessel');
  assert.equal(fresh.gl,0);assert.equal(fresh.width,fresh.scroll);
  await evaluate(`document.querySelector('symbiosim-vessel').setAttribute('theme','dark')`);
  const redraw = await evaluate(`(() => {
    const v=document.querySelector('symbiosim-vessel'),s=v.sceneRenderer,g=s.gl,yaw=v.camera.yaw;
    const capture=()=>{v.draw();const pixels=new Uint8Array(s.canvas.width*s.canvas.height*4);g.readPixels(0,0,s.canvas.width,s.canvas.height,g.RGBA,g.UNSIGNED_BYTE,pixels);return pixels;};
    const before=capture();let changed=0;
    for(const angle of[-50,-10,40,90]){v.camera.yaw=angle;v.draw();}
    const turned=capture();
    for(let i=0;i<before.length;i++)if(before[i]!==turned[i])changed++;
    v.camera.yaw=yaw;const after=capture();let residual=0,occupied=0;
    for(let i=0;i<before.length;i++)if(before[i]!==after[i])residual++;
    for(let i=3;i<before.length;i+=4)if(before[i])occupied++;
    return {changed,residual,occupied,error:g.getError()};
  })()`);
  assert.ok(redraw.changed>100&&redraw.occupied>1000,'Orbit must move actual rendered geometry');
  assert.equal(redraw.error,0);assert.equal(redraw.residual,0,'Returning the camera must leave no old-frame geometry');
  await screenshot('rework-desktop-dark');
  for (const field of ['flow','oxygen','sugar','temperature']) {
    await evaluate(`document.querySelector('symbiosim-vessel').selectField('${field}')`);
    await screenshot('field-'+field);
  }
  await evaluate(`document.querySelector('symbiosim-vessel').selectField('liquid')`);
  await evaluate(`document.querySelector('symbiosim-vessel').setViewMode('voxel')`);
  await screenshot('tracked-cells-expanded');
  await evaluate(`document.querySelector('symbiosim-vessel').setViewMode('split')`);
  await evaluate(`document.querySelector('symbiosim-vessel').setAttribute('theme','light')`);
  await screenshot('rework-desktop-light');
  const hot=await evaluate(`(() => {
    const v=document.querySelector('symbiosim-vessel');v.command('w');v.command('h');v.sim.playing=false;
    for(let i=0;i<45;i++)v.advance(.12/90,.2/30);
    v.draw();return { stream:v.sceneRenderer.streams.count,hot:Math.max(...v.sim.temperature),error:v.sceneError };
  })()`);
  assert.equal(hot.error,undefined);assert.ok(hot.stream>500&&hot.hot>40);
  await screenshot('rework-hot-pour');
  await evaluate(`(() => {
    const v=document.querySelector('symbiosim-vessel');v.sim.vessel.tilt=7;v.sim.vessel.tiltZ=7;v.camera.yaw=65;v.camera.elevation=32;v.updateCamera();v.draw();
  })()`);
  assert.equal((await inspect()).gl,0);await screenshot('rework-orbit-tilt');
  await evaluate(`(() => {
    const v=document.querySelector('symbiosim-vessel');v.sim.stepCare(.12);v.sim.startTransfer('drain',.15);v.sim.stepCare(.06);v.draw();
  })()`);
  assert.equal((await inspect()).error,undefined);await screenshot('rework-spigot');
  assert.equal(await evaluate(`(() => {
    const v=document.querySelector('symbiosim-vessel');v.canvas.click();return Boolean(v.$('.lens'));
  })()`),false,'Clicking must not open a zoom overlay');
  const embedCheck = await evaluate(`(() => {
    const box = document.createElement('div');
    box.style.cssText = 'width: 260px; height: 220px; overflow: hidden;';
    document.body.appendChild(box);
    const v = document.querySelector('symbiosim-vessel');
    box.appendChild(v); v.style.minHeight = '0';
    v.setAttribute('embed', '');
    v.setAttribute('transparent', '');
    v.setAttribute('width', '420');
    v.setAttribute('height', '520');
    v.draw();
    const s = v.sceneRenderer, g = s.gl, pixels = new Uint8Array(4);
    g.readPixels(0, 0, 1, 1, g.RGBA, g.UNSIGNED_BYTE, pixels);
    const hostRect = v.getBoundingClientRect(), layoutRect = v.$('.layout').getBoundingClientRect(), canvasRect = v.canvas.getBoundingClientRect();
    const hiddenUi = ['.masthead', '.left-rail', '.instruments', '.hud', '.vessel-tools', '.field-footer'].every(sel => v.$(sel).getClientRects().length === 0);
    const bg = getComputedStyle(v).backgroundColor;
    v.removeAttribute('embed'); v.removeAttribute('transparent'); v.removeAttribute('width'); v.removeAttribute('height');
    v.style.minHeight = ''; document.body.appendChild(v); box.remove(); v.draw();
    return { hostW: Math.round(hostRect.width), hostH: Math.round(hostRect.height), layoutH: Math.round(layoutRect.height), canvasH: Math.round(canvasRect.height), hiddenUi, bg, cornerAlpha: pixels[3], gl: g.getError() };
  })()`);
  assert.deepEqual(embedCheck, { hostW: 260, hostH: 220, layoutH: 220, canvasH: 220, hiddenUi: true, bg: 'rgba(0, 0, 0, 0)', cornerAlpha: 0, gl: 0 });
  for(const width of[320,390,640,768,1024]){
    await metrics(width,844);await pause(100);const p=await inspect();assert.equal(p.width,p.scroll);assert.equal(p.gl,0);assert.equal((await checkTrackingLayout()).overlap,false);
  }
  await metrics(390,844);await command('Page.reload');await pause(800);
  const phone=await inspect();assert.equal(phone.depth,5);assert.equal(phone.backend,'webgl2');assert.equal(phone.gl,0);
  await screenshot('rework-phone');
  assert.deepEqual(errors,[],'No browser exceptions or missing modules');
  console.log(JSON.stringify({fresh,phone,hot,redraw,screenshots:artifacts}));
  console.log('PASS: native scene shaders, shared depth/refraction, visible particles, hot pour, spigot, orbit and five viewport sizes.');
  }
  }
  // Test the hosted entry itself, including options before custom-element upgrade.
  await metrics(420, 520);
  const embedQuery = '?room=20&preset=convection&swing=1&permeability=10&theme=dark&field=ethanol&speed=4&autoplay=false&transparent=true';
  await command('Page.navigate', { url: siteUrl + '/embed' + embedQuery });
  for (let i = 0; i < 100; i++) {
    if (await evaluate(`location.pathname === '/embed/' && Boolean(document.querySelector('symbiosim-vessel')?.sim)`)) break;
    await pause(100);
  }
  // Allow the component's linked stylesheet to load before measuring its layout.
  await pause(200);
  const embed = await evaluate(`(() => {
    const v = document.querySelector('symbiosim-vessel');
    v.draw();
    const bounds = v.canvas.getBoundingClientRect();
    return {
      path: location.pathname, search: location.search,
      room: v.sim.settings.room, swing: v.sim.settings.swing, permeability: v.sim.settings.permeability,
      speed: v.sim.speed, playing: v.sim.playing, field: v.overlay, theme: v.getAttribute('theme'),
      hiddenUi: ['.masthead', '.left-rail', '.instruments', '.hud', '.vessel-tools'].every(sel => v.$(sel).getClientRects().length === 0),
      background: getComputedStyle(v).backgroundColor, autofocus: v.hasAttribute('autofocus'),
      width: Math.round(bounds.width), height: Math.round(bounds.height),
      overflow: document.documentElement.scrollWidth > innerWidth || document.documentElement.scrollHeight > innerHeight,
      error: v.sceneError, backend: v.sceneRenderer?.backend, gl: v.sceneRenderer?.gl.getError()
    };
  })()`);
  assert.equal(embed.path, '/embed/'); assert.equal(embed.search, embedQuery);
  assert.equal(embed.room, 20); assert.equal(embed.swing, 1); assert.equal(embed.permeability, .1);
  assert.equal(embed.speed, 4); assert.equal(embed.playing, false); assert.equal(embed.field, 'ethanol');
  assert.equal(embed.theme, 'dark'); assert.equal(embed.hiddenUi, true); assert.equal(embed.autofocus, false);
  assert.equal(embed.background, 'rgba(0, 0, 0, 0)');
  assert.equal(embed.width, 420); assert.equal(embed.height, 520); assert.equal(embed.overflow, false);
  if (!layoutOnly) { assert.equal(embed.error, undefined); assert.equal(embed.backend, 'webgl2'); assert.equal(embed.gl, 0); }
  assert.deepEqual(errors, [], 'Hosted embed has no browser exceptions or missing assets');
  await screenshot('hosted-embed');
  console.log('PASS: hosted /embed redirect, query controls, paused startup, transparent layout and assets.');
  pageSession=undefined;await command('Browser.close');
} finally {
  socket?.close();browser.kill();server.kill();
}
