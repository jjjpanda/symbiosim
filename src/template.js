import { PRESETS } from './sim/constants.js';

export const OVERLAYS = ['liquid', 'organisms', 'flow', 'temperature', 'sugar', 'oxygen', 'ethanol', 'acidity', 'co2'];

const icon = path => `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="${path}"/></svg>`;
const icons = {
  pause: icon('M9 5v14M15 5v14'),
  step: icon('m6 5 10 7-10 7zM19 5v14'),
  new: icon('M12 5v14M5 12h14'),
  theme: icon('M12 3a9 9 0 1 0 0 18V3z'),
  conditions: icon('M4 7h16M4 17h16M9 4v6M15 14v6')
};

export function vesselTemplate() {
  return `<link rel="stylesheet" href="${new URL('./style.css', import.meta.url)}">
<div class="layout" data-view="split">
  <header class="masthead">
    <div class="identity"><h1>symbiosim<span class="identity-dot" aria-hidden="true"></span></h1><p>A living fermentation</p></div>
    <div class="view-modes glass" role="group" aria-label="Viewport layout">
      <button type="button" data-view-mode="split" class="on" aria-pressed="true" title="Side-by-side vessel and 3D micro-voxel view">Split view</button>
      <button type="button" data-view-mode="jar" aria-pressed="false" title="Focus on macroscopic vessel">Vessel</button>
      <button type="button" data-view-mode="voxel" aria-pressed="false" title="Focus on zoomed-in 3D micro-voxel">3D Voxel</button>
    </div>
    <nav class="glass" aria-label="Simulation controls">
      <button data-k=" " class="play-button" title="Run or pause · Space">${icons.pause}<span id="play"></span></button>
      <button data-k="s" class="icon-button" aria-label="Pause and step" title="Step · S">${icons.step}</button>
      <button data-k="n" class="icon-button" aria-label="Start a new vessel" title="New vessel · N">${icons.new}</button>
      <span class="nav-divider" aria-hidden="true"></span>
      <button data-k="t" class="icon-button" title="Switch theme · T">${icons.theme}<span id="theme-name" class="sr-only"></span></button>
      <button data-k="c" aria-label="Conditions" title="Conditions · C">${icons.conditions}<span>Conditions</span></button>
    </nav>
  </header>
  <aside class="left-rail" aria-label="Micro-voxel sample and culture">
    <section class="voxel-card glass-card" aria-label="Zoomed 3D voxel sample">
      <div class="voxel-header">
        <div><span class="section-label">3D Voxel Sample</span><small id="voxel-coords">(11, 6, 4)</small></div>
        <div class="voxel-actions">
          <button type="button" id="resample-voxel" class="pill-btn" title="Sample another active 3D voxel in the jar">Resample</button>
          <button type="button" id="toggle-voxel-view" class="pill-btn desktop-only" aria-pressed="false" title="Expand or dock 3D voxel view">Expand</button>
        </div>
      </div>
      <canvas id="voxel-canvas" tabindex="0" role="img" aria-label="Zoomed 3D voxel showing yeast, bacteria, and chemical reactions. Drag or use arrow keys to rotate; R resets."></canvas>
      <div class="voxel-footer">
        <span id="voxel-summary">pH 4.20 · O₂ 0.20 · 80 g/L</span>
        <span class="voxel-key"><i class="warm">●</i> yeast <i class="cool">▬</i> bacteria <i class="m-acid">●</i> H⁺/EtOH</span>
      </div>
    </section>
    <button class="trend glass-card" data-chart="culture" aria-label="Open culture population history"><span class="section-label">Culture <span aria-hidden="true">↗</span></span><span id="counts"></span><svg id="culture-chart" viewBox="0 0 120 30" preserveAspectRatio="none" aria-hidden="true"></svg></button>
    <section class="film-readings glass-card" aria-label="Pellicle readings"><div class="section-label">Pellicle <strong id="film-thickness" title="Mean thickness of covered patches, using the illustrative visual scale."></strong></div><progress id="film-load" max="2.4" value="0" aria-label="Mean pellicle thickness in illustrative millimeters"></progress><span id="pellicle-status"></span><span id="film-care"></span></section>
    <div class="legend" aria-label="Organism legend"><span><b class="yeast-mark warm" aria-hidden="true"></b> yeast</span><span><b class="bacteria-mark cool" aria-hidden="true"></b> bacteria</span><span><b class="film-mark warm" aria-hidden="true"></b> cellulose</span></div>
  </aside>
  <section class="field" aria-label="Fermentation vessel">
    <canvas id="canvas" tabindex="0" role="img" aria-label="Drag to orbit; Shift-drag to tip the jar. Arrow keys turn the view; R resets it."></canvas>
    <div class="hud"><span id="day"></span><span id="state"></span></div>
    <div class="mobile-readings" aria-hidden="true"><span>Tea <b id="mobile-temperature"></b></span><span>Sugar <b id="mobile-sugar"></b></span><span>pH <b id="mobile-ph"></b></span></div>
    <div class="fluid-actions glass" aria-label="Interact with the tea"><button data-k="w" title="Swirl the liquid — W">Swirl</button><button data-k="h" title="Pour 8% of capacity at 70°C — H">Pour hot tea</button><button data-action="quick-drain" class="desktop-only" title="Draw 20% from the lower spigot">Draw 20%</button><button data-action="quick-feed" class="desktop-only" title="Pour 15% sweet tea at 28°C">Feed tea</button></div>
    <div class="field-footer"><span>KOMBUCHA</span><span>drag orbit · shift-drag tilt</span></div>
  </section>
  <aside class="instruments" aria-label="Controls and readings">
    <div class="stats glass-card" aria-label="Current readings">
      <button data-chart="temperature"><span>Temp</span><strong id="temperature"></strong><small id="temperature-delta" title="Change over the last simulated day; available after day 1."></small></button>
      <button data-chart="chemistry"><span>Sugar</span><strong id="sugar"></strong><small id="sugar-delta" title="Change over the last simulated day; available after day 1."></small></button>
      <button data-chart="chemistry"><span><i class="ph-dot" id="ph-swatch" aria-hidden="true"></i>pH</span><strong id="ph"></strong><small id="ph-delta" title="Change over the last simulated day; available after day 1."></small></button>
    </div>
    <div class="settings glass-card">
      <label><span>Pace</span><output id="speed-output" for="speed"></output><input id="speed" type="range" min="1" max="60" step="1" aria-label="Simulated days per minute"></label>
      <label class="view-control"><span>Field</span><select id="overlay">${OVERLAYS.map(id => `<option value="${id}">${id === 'co2' ? 'Dissolved CO2' : id[0].toUpperCase() + id.slice(1)}</option>`).join('')}</select></label>
    </div>
    <details class="quick-tweaks glass-card" open>
      <summary>Quick tweak <span id="quick-summary"></span></summary>
      <div class="tweak-body">
        <div class="preset-pills" role="group" aria-label="Fermentation presets">
          <button type="button" data-preset="balanced" title="Self-sustaining balanced culture (24°C, breathable cover)">Balanced</button>
          <button type="button" data-preset="convection" title="Strong thermal plumes &amp; Rayleigh-Bénard roll (28°C, 240% convection)">Plumes</button>
          <button type="button" data-preset="tangy" title="High oxygen &amp; warm brew for rapid acidification and golden-citrine pH shift">Tangy pH</button>
          <button type="button" data-preset="cool" title="Cool 19°C slow fermentation">Cool</button>
        </div>
        <label><span>Room temp</span><output id="quick-room-output" for="quick-room"></output><input id="quick-room" type="range" min="15" max="35" step=".5" aria-label="Quick room temperature"></label>
        <label><span>Convection</span><output id="quick-convection-output" for="quick-convection"></output><input id="quick-convection" type="range" min="0" max="250" step="5" aria-label="Quick convection strength"></label>
      </div>
    </details>
    <div class="care-card glass-card">
      <div class="culture-notes"><button data-k="c" id="environment-summary" title="Adjust room and cover"></button><span id="care-status"></span><span id="exchange-count"></span></div>
      <button class="exchange glass" data-k="e"><span>Drain / add tea</span><span aria-hidden="true">↗</span></button>
    </div>
    <details class="camera-controls glass-card"><summary>Jar &amp; view</summary><label>Jar tilt <output id="jar-tilt-output" for="jar-tilt"></output><input id="jar-tilt" type="range" min="-12" max="12" step=".5"></label><p class="hint">Shift-drag to tip. The angle stays within the rim.</p><button id="upright-jar" type="button" class="action">Set upright</button><label>View rotation <output id="camera-yaw-output" for="camera-yaw"></output><input id="camera-yaw" type="range" min="-180" max="180" step="1"></label><label>View elevation <output id="camera-elevation-output" for="camera-elevation"></output><input id="camera-elevation" type="range" min="8" max="48" step="1"></label><button id="reset-camera" type="button" class="action">Reset view · R</button></details>
    <p class="footnote">A living model of fermentation.<br>Let it evolve, or change its conditions.</p>
  </aside>
</div>
<dialog id="panel" class="panel glass" aria-labelledby="panel-title">
  <div class="panel-top"><div><p class="eyebrow">Shape the culture</p><h2 id="panel-title">Conditions</h2></div><button id="close-panel" type="button" aria-label="Close conditions">×</button></div>
  <section><h3>Quick presets</h3><div class="preset-pills" role="group" aria-label="Fermentation presets"><button type="button" data-preset="balanced">Balanced</button><button type="button" data-preset="convection">High convection</button><button type="button" data-preset="tangy">Tangy low-pH</button><button type="button" data-preset="cool">Cool slow</button></div></section>
  <section><h3>Room cycle</h3><label>Average temperature <output id="room-output" for="room"></output><input id="room" type="range" min="15" max="35" step=".5"></label><label>Day / night swing <output id="swing-output" for="swing"></output><input id="swing" type="range" min="0" max="12" step=".5"></label></section>
  <section><h3>Cover / gas exchange</h3><div class="segmented" role="group" aria-label="Cover type">${Object.keys(PRESETS).map(id => `<button type="button" data-cover="${id}">${id}</button>`).join('')}</div><label>Permeability <output id="permeability-output" for="permeability"></output><input id="permeability" type="range" min="0" max="100" step="1"></label></section>
  <section id="exchange-section"><h3>Tea exchange</h3><div class="care-controls" role="group" aria-label="Automatic tea care"><label><input id="auto-drain" type="checkbox"> Auto drain</label><label><input id="tea-mode" type="checkbox"> Tea mode</label></div><p class="hint">Auto drain harvests at pH below 3.52 or sugar below 40 g/L, keeping 35% as a living starter. Tea mode refills with the recipe below. Drain and refill each take about one to three seconds. Manual amounts are fractions of full capacity. Hot tea plunges into the brew, softens the wet film, and can injure cells in its path.</p><label>Drain <output id="drain-output" for="drain-amount"></output><input id="drain-amount" type="range" min="0" max="50" value="15"></label><button id="drain" class="action" type="button">Drain from lower outlet</button><label>Fresh tea <output id="pour-output" for="pour-amount"></output><input id="pour-amount" type="range" min="0" max="50" value="15"></label><label>Tea temperature <output id="tea-temp-output" for="tea-temp"></output><input id="tea-temp" type="range" min="10" max="95" value="24"></label><label>Tea sugar <output id="tea-sugar-output" for="tea-sugar"></output><input id="tea-sugar" type="range" min="0" max="160" value="80"></label><button id="pour" class="action action-filled" type="button">Pour fresh tea</button></section>
  <section><h3>Surface film</h3><div class="care-controls"><label><input id="auto-skim" type="checkbox"> Auto skim when thick</label></div><p class="hint">Fresh cellulose consolidates into three connected layers. Trapped gas lifts the film and escapes around an exposed edge. Auto skim removes 80% above 2.1 mm mean thickness (illustrative scale). Larger, cooler sheets sit deeper unless trapped gas supports them. Skimming removes 80% of the material; the thinner remaining layers bend more easily and can regrow.</p><button id="skim" class="action" type="button" title="Remove 80% of the surface film; liquid and organisms remain. Film can regrow.">Skim pellicle</button></section>
  <section><h3>Starter culture</h3><label>Starter liquid <output id="starter-output" for="starter-amount"></output><input id="starter-amount" type="range" min="1" max="30" value="8"></label><label>Yeast share <output id="starter-balance-output" for="starter-balance"></output><input id="starter-balance" type="range" min="0" max="100" value="50"></label><button id="starter" class="action" type="button">Add starter</button></section>
  <details open><summary>Advanced model controls</summary><div class="advanced"><label>Convection strength <output id="convection-output" for="convection"></output><input id="convection" type="range" min="0" max="250" value="120"></label><label>Inherited trait variation <output id="variation-output" for="variation"></output><input id="variation" type="range" min="0" max="30" value="8"></label></div></details>
  <details><summary>Reading the field</summary><div class="reaction-key"><span><i class="m-sugar">Sugar</i> feeds <b class="warm">yeast</b>, releasing ethanol and CO2.</span><span><b class="cool">Bacteria</b> use ethanol, glucose, and oxygen to make acids and cellulose.</span><p class="hint">Round cells are yeast; rods are bacteria. Glowing filaments link nearby metabolically active yeast and bacteria; animated packets show local substrate turnover. Swirl or pour tea to disturb the culture.</p></div></details>
  <p class="panel-note">An illustrative simulation of microbial relationships, not a brewing guide.</p>
</dialog>
<dialog id="detail" class="glass" aria-labelledby="detail-title"><button data-close="detail" aria-label="Close chart">×</button><p class="eyebrow">Vessel history</p><h2 id="detail-title"></h2><div id="detail-legend"></div><svg id="detail-chart" viewBox="0 0 240 90" preserveAspectRatio="none" role="img"></svg><div class="chart-axis"><span id="chart-start"></span><span id="chart-end"></span></div><p id="detail-copy"></p></dialog>
<div class="sr-only" role="status" aria-live="polite"></div>`;
}
