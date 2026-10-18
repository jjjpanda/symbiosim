import { Simulation, REGIMES } from './engine.js';
import { draw } from './renderer.js';
import { vesselTemplate, OVERLAYS, THEME_ICONS } from './template.js';
import { readingDeltas } from './charts.js';
import { advanceParticles } from './render/particles.js';
import { exchangeSpeed } from './sim/transfer-clock.js';
import { bindCamera, defaultCamera, turnCamera, tipVessel } from './render/camera.js';
import { vesselTilt } from './sim/vessel.js';
import { pellicleStats, SKIM_THICKNESS } from './sim/pellicle.js';
import { teaColor } from './render/objects.js';
import { pickVoxel, renderVoxel } from './render/voxel.js';
import { fieldView, fieldRange, formatFieldValue } from './fields.js';
import { temperatureRange, cssColor } from './render/palette.js';
import { CHEMICAL_COLORS } from './metabolism.js';
import { updateFieldHistory, updateHistoryDialog } from './history.js';
import { bindSwirl, startSwirl, stopSwirl, advanceSwirl, updateSwirlSpeed } from './swirl.js';

const SPEEDS = [1, 4, 12, 30, 60];
const SETTINGS = [['room', 1], ['swing', 1], ['permeability', 100]];
const OUTPUTS = [['room', 'room', '°C'], ['swing', 'swing', '°C'], ['permeability', 'permeability', '%'], ['drain', 'drain-amount', '%'], ['pour', 'pour-amount', '%'], ['tea-temp', 'tea-temp', '°C'], ['tea-sugar', 'tea-sugar', ' g/L'], ['starter', 'starter-amount', '%'], ['starter-balance', 'starter-balance', '%']];
const fmt = (v, digits = 1) => Number(v).toFixed(digits);
const seed = () => crypto.getRandomValues(new Uint32Array(1))[0];

export class SymbiosimVessel extends HTMLElement {
  static observedAttributes = ['theme'];

  constructor() {
    super();
    const phone = matchMedia('(max-width: 640px)').matches;
    this.sim = new Simulation({ seed: seed(), width: phone ? 16 : 22, height: phone ? 24 : 30, depth: phone ? 5 : 8 });
    this.voxels = { yeast: pickVoxel(this.sim, 'yeast'), bacteria: pickVoxel(this.sim, 'bacteria') };
    this.viewMode = 'split';
    this.overlay = 'liquid';
    this.camera = defaultCamera();
    this.dark = matchMedia('(prefers-color-scheme: dark)');
    this.reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
    this.motion = !this.reducedMotion.matches;
    this.attachShadow({ mode: 'open' }).innerHTML = vesselTemplate();
    this.$ = selector => this.shadowRoot.querySelector(selector);
    this.$$ = selector => this.shadowRoot.querySelectorAll(selector);
    this.canvas = this.$('#canvas');
    this.voxelCanvases = { yeast: this.$('#yeast-canvas'), bacteria: this.$('#bacteria-canvas') };
    this.ctx = this.canvas.getContext('2d');
    this.$('link').onload = () => { this.readPalette(); this.resize(); };
    this.bind();
  }

  connectedCallback() {
    this.lastFrame = 0; this.pending = 0;
    this.motion = !this.reducedMotion.matches;
    if (!this.hasAttribute('tabindex')) this.tabIndex = 0;
    if (this.hasAttribute('autofocus')) this.focus();
    this.readPalette(); this.updateControls();
    this.resizeObserver = new ResizeObserver(() => this.resize()); this.resizeObserver.observe(this.canvas);
    this.dark.addEventListener('change', this.paletteHandler = () => { this.readPalette(); this.updateControls(); });
    this.reducedMotion.addEventListener('change', this.motionHandler = () => {
      this.motion = !this.reducedMotion.matches;
      this.draw();
    });
    document.addEventListener('visibilitychange', this.visibilityHandler = () => { this.lastFrame = 0; this.pending = 0; stopSwirl(this); });
    this.ownerDocument?.defaultView?.addEventListener('blur', this.blurHandler = () => stopSwirl(this));
    this.frameHandle = requestAnimationFrame(t => this.frame(t));
  }

  disconnectedCallback() {
    stopSwirl(this);
    cancelAnimationFrame(this.frameHandle); this.resizeObserver?.disconnect();
    this.dark.removeEventListener('change', this.paletteHandler); document.removeEventListener('visibilitychange', this.visibilityHandler);
    this.reducedMotion.removeEventListener('change', this.motionHandler);
    this.ownerDocument?.defaultView?.removeEventListener('blur', this.blurHandler);
    this.sceneRenderer?.dispose(); this.sceneRenderer = undefined;
  }

  attributeChangedCallback() { this.readPalette(); this.updateControls(); }
  isDark() { return this.getAttribute('theme') === 'dark' || (!this.hasAttribute('theme') && this.dark.matches); }
  readPalette() {
    const style = getComputedStyle(this);
    this.palette = Object.fromEntries(['fg', 'warm', 'cool', 'gas'].map(key => [key, style.getPropertyValue('--' + key).trim()]));
    for (const [chemical, color] of Object.entries(CHEMICAL_COLORS)) this.palette[chemical] = cssColor(color);
    this.updateReadings(); this.draw();
  }
  announce(text) { this.$('[role=status]').textContent = text; }

  selectField(id) {
    if (!OVERLAYS.includes(id)) return;
    this.overlay = id;
    this.updateField(); this.updateFieldHistory(); this.draw();
  }

  updateField() {
    const field = fieldView(this.overlay);
    this.$('#overlay').value = field.id;
    this.$('#field-title').textContent = field.name;
    this.$('#field-description').textContent = field.note;
    this.$('#field-key').textContent = field.key;
    this.$('#field-low').textContent = field.ends[0];
    this.$('#field-high').textContent = field.ends[1];
    const scale = this.$('#field-scale');
    scale.hidden = field.id === 'liquid' || field.id === 'organisms';
    scale.style?.setProperty('--field-gradient', field.gradient);
    let reading = '';
    if (field.chemical || field.id === 'flow') {
      const { mean, peak, low, high, span } = fieldRange(this.sim, field.id);
      this.$('#field-low').textContent = `${formatFieldValue(low, span)} ${field.unit}`;
      this.$('#field-high').textContent = `${formatFieldValue(high, span)} ${field.unit}`;
      reading = `Mean ${formatFieldValue(mean, span)} · peak ${formatFieldValue(peak, span)} ${field.unit} · relative color scale`;
      if (peak === 0) reading += ' · absent';
      else if (peak < 1e-6) reading += ' · trace amounts';
    } else if (field.id === 'temperature') {
      const { low, high } = temperatureRange(this.sim);
      this.$('#field-low').textContent = `${fmt(low)}°C`;
      this.$('#field-high').textContent = `${fmt(high)}°C`;
      reading = `${fmt(this.sim.meanTemperature())}°C in tea · ${fmt(this.sim.settings.room)}°C room average`;
    }
    this.$('#field-reading').textContent = reading;
  }

  setViewMode(mode) {
    this.viewMode = mode;
    const layout = this.$('.layout');
    if (layout?.dataset) layout.dataset.view = mode;
    this.$$('[data-view-mode]').forEach(btn => {
      const active = btn.dataset.viewMode === mode;
      btn.classList?.toggle('on', active);
      btn.setAttribute?.('aria-pressed', String(active));
    });
    this.resize();
  }

  bind() {
    this.$$('[data-k]').forEach(button => button.onclick = () => this.command(button.dataset.k));
    this.$$('[data-view-mode]').forEach(button => button.onclick = () => this.setViewMode(button.dataset.viewMode));
    for (const [type, canvas] of Object.entries(this.voxelCanvases)) {
      let drag;
      canvas.onpointerdown = e => {
        if (e.button !== 0 || drag) return;
        canvas.focus();
        const voxel = this.voxels[type];
        drag = { id: e.pointerId, x: e.clientX, y: e.clientY, yaw: voxel.yaw, pitch: voxel.pitch };
        canvas.setPointerCapture(e.pointerId);
      };
      canvas.onpointermove = e => {
        if (!drag || drag.id !== e.pointerId) return;
        const voxel = this.voxels[type];
        voxel.yaw = drag.yaw + (e.clientX - drag.x) * .012;
        voxel.pitch = Math.max(-.85, Math.min(.85, drag.pitch + (e.clientY - drag.y) * .012));
        this.drawVoxel();
      };
      const finish = e => {
        if (!drag || drag.id !== e.pointerId) return;
        drag = null;
        if (canvas.hasPointerCapture(e.pointerId)) canvas.releasePointerCapture(e.pointerId);
      };
      canvas.onpointerup = canvas.onpointercancel = canvas.onlostpointercapture = finish;
      canvas.onkeydown = e => {
        const voxel = this.voxels[type], key = e.key.toLowerCase();
        if (key === 'arrowleft' || key === 'arrowright') voxel.yaw += key === 'arrowleft' ? -.15 : .15;
        else if (key === 'arrowup' || key === 'arrowdown') voxel.pitch = Math.max(-.85, Math.min(.85, voxel.pitch + (key === 'arrowup' ? .12 : -.12)));
        else if (key === 'r') { voxel.yaw = .55; voxel.pitch = .32; }
        else return;
        e.preventDefault(); e.stopPropagation(); this.drawVoxel();
      };
    }
    this.addEventListener('keydown', e => {
      const target = e.composedPath()[0];
      if (e.ctrlKey || e.metaKey || e.altKey || target.matches?.('input, select, summary') || (target.matches?.('button') && [' ', 'Enter'].includes(e.key)) || this.$('#panel').open || this.$('#detail').open) return;
      if (e.key.toLowerCase() === 'w') { startSwirl(this); e.preventDefault(); }
      else if (this.command(e.key.toLowerCase(), e.shiftKey)) e.preventDefault();
    });
    this.$('#speed').oninput = e => { this.sim.speed = Number(e.target.value); this.updateControls(false); };
    this.$$('[data-preset]').forEach(button => button.onclick = () => {
      const name = button.dataset.preset;
      if (!REGIMES[name]) return;
      const regime = this.sim.applyPreset(name);
      this.activePreset = name;
      this.updateControls(); this.updateReadings(); this.draw();
      this.announce(regime.label);
    });
    this.$('#overlay').onchange = e => this.selectField(e.target.value);
    for (const [id, scale] of SETTINGS) this.$('#' + id).oninput = e => {
      this.activePreset = null;
      // The slider is the sole gas-exchange control; a legacy sealed-cover
      // multiplier must not silently override the selected permeability.
      const patch = { [id]: Number(e.target.value) / scale };
      if (id === 'permeability') patch.cover = 'open';
      this.sim.applySettings(patch); this.updateControls(); this.updateField(); this.draw();
    };
    for (const [, id] of OUTPUTS.slice(3)) this.$('#' + id).oninput = () => this.updateControls(false);
    const value = id => Number(this.$('#' + id).value);
    for (const [id, key] of [['auto-drain', 'autoDrain'], ['tea-mode', 'teaMode'], ['auto-skim', 'autoSkim']]) {
      this.$('#' + id).onchange = e => { this.sim.care[key] = e.target.checked; this.updateReadings(); };
    }
    for (const [id, key] of [['tea-temp', 'temperature'], ['tea-sugar', 'sugar']]) {
      this.$('#' + id).oninput = e => { this.sim.care[key] = Number(e.target.value); this.updateControls(false); };
    }
    const transfer = (phase, amount, recipe = { temperature: value('tea-temp'), sugar: value('tea-sugar') }) => {
      const accepted = this.sim.startTransfer(phase, amount, recipe);
      if (accepted) this.$('#panel').close?.();
      this.intervene(accepted, phase === 'drain' ? 'Drawing' : 'Pouring tea');
    };
    this.$('#drain').onclick = () => transfer('drain', value('drain-amount') / 100);
    this.$('#pour').onclick = () => transfer('pour', value('pour-amount') / 100);
    this.$('#starter').onclick = () => this.intervene(this.sim.addStarter(value('starter-amount') / 100, value('starter-balance') / 100), 'Added starter');
    this.$('#skim').onclick = () => {
      const removed = this.sim.skimPellicle();
      this.announce(removed ? 'Skimmed 80% of the surface film. The remaining film can regrow.' : 'No pellicle to skim.');
      this.updateReadings(); this.draw();
    };
    this.$('#close-panel').onclick = () => this.$('#panel').close();
    this.$$('dialog').forEach(dialog => dialog.onclick = e => { if (e.target !== dialog) return; const box = dialog.getBoundingClientRect(); if (e.clientX < box.left || e.clientX > box.right || e.clientY < box.top || e.clientY > box.bottom) dialog.close(); });
    this.$$('[data-close]').forEach(button => button.onclick = () => this.$('#detail').close());
    this.$$('[data-chart]').forEach(button => button.onclick = () => {
      this.openHistory(button.dataset.chart);
    });
    this.$('#field-history-open').onclick = () => this.openHistory(fieldView(this.overlay).history);
    bindSwirl(this); bindCamera(this); this.updateCamera();
  }

  openHistory(kind) {
    stopSwirl(this);
    this.updateDetail(); this.$('#detail').showModal();
    this.$('#history-title-' + kind)?.scrollIntoView({ block: 'nearest' });
  }

  command(key, shift = false) {
    if (['arrowleft', 'arrowright', 'arrowup', 'arrowdown'].includes(key)) {
      const horizontal = key === 'arrowleft' ? -1 : key === 'arrowright' ? 1 : 0;
      const vertical = key === 'arrowup' ? -1 : key === 'arrowdown' ? 1 : 0;
      if (shift || this.tiltMode) tipVessel(this, horizontal * 2, vertical * 2);
      else turnCamera(this.camera, horizontal * 10, -vertical * 3);
      this.updateCamera();
    }
    else if (key === 'r') { Object.assign(this.camera, defaultCamera()); this.updateCamera(); }
    else if (key === ' ') { this.sim.playing = !this.sim.playing; }
    else if (key === 's') { this.sim.playing = false; this.advance(.08); }
    else if (key === 'w') { this.sim.stir(); this.announce(this.sim.playing ? 'Swirling the tea.' : 'Swirl queued. Resume or Step to see the tea move.'); }
    else if (key === 'h') {
      const accepted = this.sim.startTransfer('pour', .08, { temperature: 70, sugar: this.sim.care.sugar });
      this.intervene(accepted, 'Pouring hot tea at 70°C');
    }
    else if (key === 'n') {
      if (!confirm('Start a new vessel? The current culture will be replaced.')) return true;
      stopSwirl(this);
      this.sim = new Simulation({ seed: seed(), width: this.sim.nx, height: this.sim.ny, depth: this.sim.nz });
      this.voxels = { yeast: pickVoxel(this.sim, 'yeast'), bacteria: pickVoxel(this.sim, 'bacteria') };
      this.pending = 0; this.particles = null; this.activePreset = null; this.updateControls();
    }
    else if (key === 't') this.setAttribute('theme', this.isDark() ? 'light' : 'dark');
    else if (key === 'c' || key === 'e') { stopSwirl(this); this.$('#panel').showModal(); if (key === 'e') this.$('#exchange-section').scrollIntoView({ block: 'start' }); }
    else if (key === 'f') { this.sim.speed = SPEEDS.find(speed => speed > this.sim.speed) || SPEEDS[0]; this.updateControls(); }
    else if (key === 'v') this.selectField(OVERLAYS[(OVERLAYS.indexOf(this.overlay) + 1) % OVERLAYS.length]);
    else return false;
    this.updateReadings(); this.draw(); return true;
  }

  intervene(amount, action) { this.announce(amount ? `${action}: ${Math.round(amount * 100)}% of capacity.${this.sim.playing ? '' : ' Paused; Resume or Step to advance.'}` : 'No volume available.'); this.updateReadings(); this.draw(); }
  updateCamera() {
    this.$('#camera-zoom').value = `${fmt(this.camera.zoom || 1, 2)}×`;
    this.$$('[data-zoom]').forEach(button => { button.disabled = Number(button.dataset.zoom) > 1 ? this.camera.zoom >= 3 : this.camera.zoom <= 1; });
    const tilt = Math.abs(vesselTilt(this.sim));
    this.$('#jar-tilt-output').value = `${Math.round(tilt * 180 / Math.PI)}° tilt`;
    this.$('#jar-tilt-output').hidden = tilt < .008;
    this.$('#upright-jar').hidden = tilt < .008;
    this.$('#tilt-mode').setAttribute('aria-pressed', String(Boolean(this.tiltMode)));
    this.canvas.classList?.toggle('tilting', Boolean(this.tiltMode));
  }
  updateControls(reset = true) {
    const s = this.sim;
    if (reset) {
      this.$('#speed').value = s.speed;
      this.$('#auto-skim').checked = s.care.autoSkim; this.$('#auto-drain').checked = s.care.autoDrain; this.$('#tea-mode').checked = s.care.teaMode;
      this.$('#tea-temp').value = s.care.temperature; this.$('#tea-sugar').value = s.care.sugar;
      for (const [id, scale] of SETTINGS) this.$('#' + id).value = s.settings[id] * scale;
    }
    this.$('#speed-output').textContent = `${fmt(s.speed, 0)} days/min`;
    this.$('[data-k="t"]').setAttribute('aria-label', `Switch to ${this.isDark() ? 'light' : 'dark'} theme`);
    this.$('[data-k="t"] path').setAttribute('d', this.isDark() ? THEME_ICONS.sun : THEME_ICONS.moon);
    this.$$('[data-preset]').forEach(button => {
      const active = button.dataset.preset === this.activePreset;
      button.classList?.toggle('on', active);
      button.setAttribute?.('aria-pressed', String(active));
    });
    for (const [id, input, unit] of OUTPUTS) this.$('#' + id + '-output').value = this.$('#' + input).value + unit;
    for (const id of ['pour', 'drain']) this.$('#' + id).textContent = `${id === 'pour' ? 'Pour' : 'Drain'} ${this.$('#' + id + '-amount').value}%`;
    this.$('#starter').textContent = `Add starter ${this.$('#starter-amount').value}%`;
  }

  updateReadings() {
    if (this.camera) this.updateCamera();
    this.updateField(); updateSwirlSpeed(this);
    const s = this.sim, counts = s.counts();
    for (const id of ['drain', 'pour', 'starter']) this.$('#' + id).disabled = Boolean(s.care.transfer);
    const film = pellicleStats(s);
    const immersion = film.depth * (4 / 3) * 100;
    const position = !film.area ? 'no film' : immersion > .8 ? 'submerged' : immersion > .2 ? 'partly submerged' : 'at surface';
    this.$('#film-thickness').textContent = `${fmt(film.thickness)} mm`;
    this.$('#film-load').value = film.thickness;
    this.$('#pellicle-status').textContent = `${Math.round(film.area * 100)}% coverage · ${position}`;
    this.$('#film-care').textContent = `${s.care.autoSkim ? `Auto skim above ${SKIM_THICKNESS} mm` : 'Manual skimming'} · ${s.care.skims} skims`;
    this.$('#skim').disabled = s.coverage() < .001;
    this.$('#exchange-count').textContent = `${s.care.exchanges} auto exchanges · ${Math.round(s.volume * 100)}% full`;
    this.$('#care-status').textContent = s.care.autoDrain && s.care.teaMode ? 'Automatic tea care' : s.care.autoDrain ? 'Auto drain · refill off' : s.care.teaMode ? 'Automatic top-up' : 'Manual tea care';
    this.$('#care-status').title = `Check every half day: harvest ${Math.round(s.care.fraction * 100)}% at pH below 3.52 or sugar below 40 g/L. Retain a living starter. Timing follows the amount and liquid head. Recipe in Conditions.`;
    if (s.care.transfer) this.$('#care-status').textContent = `${s.care.transfer.phase === 'drain' ? 'harvesting' : 'pouring tea'} / ${Math.round((1 - s.care.transfer.remaining / s.care.transfer.total) * 100)}%`;
    this.$('#play').textContent = s.playing ? 'Pause' : 'Resume'; this.$('#day').textContent = `DAY ${fmt(s.day, 2)} · ${Math.round(s.volume * 100)}% full`;
    this.$('.play-button path').setAttribute('d', s.playing ? 'M9 5v14M15 5v14' : 'm8 5 11 7-11 7z');
    this.$('#state').textContent = !counts.yeast && !counts.bacteria ? 'culture lost' : s.playing ? '' : 'paused';
    const readings = { day: s.day, temperature: s.meanTemperature(), sugar: s.sugar(), ph: s.ph() };
    const [pr, pg, pb] = teaColor(readings.ph, 0, 'liquid');
    const phHex = `rgb(${Math.round(pr * 255)}, ${Math.round(pg * 255)}, ${Math.round(pb * 255)})`;
    this.style?.setProperty?.('--ph-color', phHex);
    const values = { temperature: `${fmt(readings.temperature)}°C`, sugar: `${fmt(readings.sugar, 0)} g/L`, ph: fmt(readings.ph, 2) };
    const deltas = readingDeltas(s.history, readings);
    for (const key of ['temperature', 'sugar', 'ph']) {
      this.$('#' + key).textContent = values[key];
      this.$('#mobile-' + key).textContent = values[key];
      const change = deltas?.[key], digits = key === 'ph' ? 2 : 1, unit = key === 'temperature' ? '°C' : key === 'sugar' ? ' g/L' : '';
      const rounded = Number(change?.toFixed(digits));
      this.$('#' + key + '-delta').textContent = deltas ? `${rounded > 0 ? '+' : ''}${fmt(rounded, digits)}${unit} / day` : '— / day';
    }
    this.updateFieldHistory();
    if (this.$('#detail').open) this.updateDetail();
  }

  updateFieldHistory() { updateFieldHistory(this); }
  updateDetail() { updateHistoryDialog(this); }
  resize() {
    const ratio = this.ratio = Math.min(devicePixelRatio || 1, 2);
    if (this.canvas.clientWidth > 0 && this.canvas.clientHeight > 0) {
      this.canvas.width = Math.max(1, Math.round(this.canvas.clientWidth * ratio));
      this.canvas.height = Math.max(1, Math.round(this.canvas.clientHeight * ratio));
    }
    if (this.camera) this.updateCamera();
    this.ctx.setTransform(ratio, 0, 0, ratio, 0, 0); this.draw();
  }
  advance(days, motionDays = days) {
    this.sim.step(days, motionDays);
    advanceParticles(this, motionDays);
  }
  frame(time) {
    const elapsed = this.lastFrame ? Math.min(.1, (time - this.lastFrame) / 1000) : 0; this.lastFrame = time;
    if (!document.hidden) advanceSwirl(this, elapsed);
    this.pending = this.sim.playing && !document.hidden ? (this.pending || 0) + elapsed : 0;
    let advanced = false;
    // Leave room for normal RAF timing jitter without halving a 60 Hz display.
    if (this.pending >= .0125) {
      // Exchanges use a short event clock, independent of biological pace.
      // Fluid and organisms keep moving throughout each phase.
      const speed = this.sim.care.transfer ? exchangeSpeed(this.sim) : this.sim.speed;
      const motionSpeed = Math.max(12, this.sim.speed);
      this.advance(this.pending * speed / 60, this.pending * motionSpeed / 60); this.pending = 0;
      advanced = true;
    }
    if (!document.hidden && this.sim.playing) {
      if (time - (this.lastUi || 0) > 150) { this.updateReadings(); this.lastUi = time; }
      // A second draw of an unchanged solver state repeats every GPU pass,
      // film sort and particle projection. Controls request their own redraw.
      if (advanced && !this.$?.('#detail')?.open) this.draw();
    }
    this.frameHandle = requestAnimationFrame(t => this.frame(t));
  }

  drawVoxel() {
    if (!this.voxelCanvases || (this.viewMode === 'jar' && (this.clientWidth || 1200) > 1100)) return;
    for (const [type, canvas] of Object.entries(this.voxelCanvases)) {
      const info = renderVoxel(canvas, this.sim, this.voxels[type], this.isDark(), this.motion);
      if (!info) continue;
      for (const key of ['coords', 'summary']) {
        const label = this.$('#' + type + '-' + key);
        if (label.textContent !== info[key]) label.textContent = info[key];
      }
    }
  }

  draw() {
    const ok = draw(this);
    this.drawVoxel();
    return ok;
  }

}

if (!customElements.get('symbiosim-vessel')) customElements.define('symbiosim-vessel', SymbiosimVessel);
