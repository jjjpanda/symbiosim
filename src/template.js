import { PRESETS } from './sim/constants.js';
import { HISTORY_CHARTS } from './charts.js';

export const OVERLAYS = ['liquid', 'organisms', 'flow', 'temperature', 'sugar', 'oxygen', 'ethanol', 'acidity', 'co2'];

const icon = path => `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="${path}"/></svg>`;
const icons = {
  pause: icon('M9 5v14M15 5v14'),
  conditions: icon('M4 7h16M4 17h16M9 4v6M15 14v6')
};

export function vesselTemplate() {
  return `<link rel="stylesheet" href="${new URL('./style.css', import.meta.url)}">
<div class="layout" data-view="split">
  <header class="masthead">
    <div class="identity"><h1>symbiosim<span class="identity-dot" aria-hidden="true"></span></h1><p>A living fermentation</p></div>
    <div class="view-modes glass" role="group" aria-label="Viewport layout">
      <button type="button" data-view-mode="split" class="on" aria-pressed="true" title="Show the vessel and both tracked cells">Vessel + cells</button>
      <button type="button" data-view-mode="jar" aria-pressed="false" title="Focus on macroscopic vessel">Vessel</button>
      <button type="button" data-view-mode="voxel" aria-pressed="false" title="Enlarge both tracked cell views">Cells</button>
    </div>
    <nav class="glass" aria-label="Simulation controls">
      <button data-k=" " class="play-button" title="Run or pause · Space">${icons.pause}<span id="play"></span></button>
      <button data-k="s" title="Pause and advance 0.08 days · S">Step</button>
      <button data-chart="all">History</button>
      <button data-k="c" aria-label="Conditions" title="Conditions · C">${icons.conditions}<span>Conditions</span></button>
    </nav>
  </header>
  <aside class="left-rail" aria-label="Tracked organisms and culture">
    <div class="cell-samples" aria-label="Live organism close-ups">
      ${[['yeast', 'Yeast', 'Sugar → ethanol + CO₂'], ['bacteria', 'Acetic acid bacterium', 'Ethanol + oxygen → acids']].map(([type, name, reaction]) => `
      <section class="voxel-card glass-card" aria-label="${name} tracking voxel">
        <div class="voxel-header"><div><span class="section-label ${type === 'yeast' ? 'warm' : 'cool'}">${name}</span><small id="${type}-coords">Finding a cell…</small></div><span class="tracking-label">LIVE</span></div>
        <canvas id="${type}-canvas" class="voxel-canvas" tabindex="0" role="img" aria-label="Close-up following one ${name.toLowerCase()}. Drag or use arrow keys to rotate; R resets."></canvas>
        <div class="voxel-footer"><span class="reaction-caption">${reaction}</span><span id="${type}-summary"></span></div>
      </section>`).join('')}
      <p class="sample-hint">The ring follows one cell; nearby cells and its path give context. Molecule shapes show active uptake and products.</p>
    </div>
    <button class="trend glass-card" data-chart="culture" aria-label="Open culture population history"><span class="section-label">Culture <span aria-hidden="true">↗</span></span><span id="counts"></span><svg id="culture-chart" viewBox="0 0 120 30" preserveAspectRatio="none" aria-hidden="true"></svg></button>
    <section class="film-readings glass-card" aria-label="Pellicle readings"><div class="section-label">Pellicle <strong id="film-thickness" title="Mean thickness of covered patches, using the illustrative visual scale."></strong></div><progress id="film-load" max="2.4" value="0" aria-label="Mean pellicle thickness in illustrative millimeters"></progress><span id="pellicle-status"></span><span id="film-care"></span><button id="skim" class="pill-btn" title="Remove 80% of the film; the rest can regrow">Skim film</button></section>
    <div class="legend" aria-label="Organism legend"><span><b class="yeast-mark warm" aria-hidden="true"></b> yeast</span><span><b class="bacteria-mark cool" aria-hidden="true"></b> bacteria</span><span><b class="film-mark warm" aria-hidden="true"></b> cellulose</span><span>◎ tracked cell</span></div>
  </aside>
  <section class="field" aria-label="Fermentation vessel">
    <canvas id="canvas" tabindex="0" role="img" aria-label="Drag to orbit; Shift-drag to tip the jar. Arrow keys turn the view; Shift + arrow keys tip the jar; R resets the view."></canvas>
    <div class="hud"><span id="day"></span><span id="state"></span></div>
    <div class="mobile-readings" aria-hidden="true"><span>Tea <b id="mobile-temperature"></b></span><span>Sugar <b id="mobile-sugar"></b></span><span>pH <b id="mobile-ph"></b></span></div>

    <div class="field-footer"><span>KOMBUCHA</span><span>drag orbit · shift-drag tilt</span></div>
  </section>
  <aside class="instruments" aria-label="Controls and readings">
    <div class="stats glass-card" aria-label="Current readings">
      <button data-chart="temperature"><span>Temp</span><strong id="temperature"></strong><small id="temperature-delta" title="Change over the last simulated day; available after day 1."></small></button>
      <button data-chart="sugar"><span>Sugar</span><strong id="sugar"></strong><small id="sugar-delta" title="Change over the last simulated day; available after day 1."></small></button>
      <button data-chart="ph"><span><i class="ph-dot" id="ph-swatch" aria-hidden="true"></i>pH</span><strong id="ph"></strong><small id="ph-delta" title="Change over the last simulated day; available after day 1."></small></button>
    </div>
    <div class="settings glass-card">
      <label><span>Pace</span><output id="speed-output" for="speed"></output><input id="speed" type="range" min="1" max="60" step="1" aria-label="Simulated days per minute"></label>
      <label class="view-control"><span>Field</span><select id="overlay">${OVERLAYS.map(id => `<option value="${id}">${id === 'co2' ? 'Dissolved CO2' : id[0].toUpperCase() + id.slice(1)}</option>`).join('')}</select></label>
    </div>
    <div class="care-card glass-card">
      <div class="culture-notes"><span id="care-status"></span><span id="exchange-count"></span></div>
      <div class="fluid-actions" aria-label="Interact with the tea">
        <button id="pour" title="Pour the configured tea recipe">Pour 15%</button>
        <button id="drain" title="Drain from the lower outlet">Drain 15%</button>
        <button data-k="w" title="Swirl the liquid — W">Swirl</button>
      </div>
      <button class="exchange glass" data-k="e"><span>Tea recipe &amp; care</span><span aria-hidden="true">↗</span></button>
      <p class="action-status" role="status" aria-live="polite">Actions preserve Pause.</p>
    </div>
    <details class="camera-controls glass-card"><summary>View &amp; session</summary>
      <p class="hint">Drag to orbit. Shift-drag or enable Tilt jar to tip in any direction. Shift + arrow keys also tip.</p>
      <div class="view-actions"><button id="tilt-mode" type="button" class="pill-btn" aria-pressed="false">Tilt jar</button><button id="upright-jar" type="button" class="pill-btn">Set upright</button><button id="reset-camera" type="button" class="pill-btn">Reset view</button></div>
      <output id="jar-tilt-output" aria-label="Current jar tilt"></output>
      <div class="session-actions"><button data-k="t" class="pill-btn" title="Switch theme · T">Theme</button><button data-k="n" class="pill-btn" title="Start a new vessel · N">New vessel</button></div>
    </details>
  </aside>
</div>
<dialog id="panel" class="panel glass" aria-labelledby="panel-title">
  <div class="panel-top"><div><p class="eyebrow">Shape the culture</p><h2 id="panel-title">Conditions</h2></div><button id="close-panel" type="button" aria-label="Close conditions">×</button></div>
  <section><h3>Quick presets</h3><div class="preset-pills" role="group" aria-label="Fermentation presets"><button type="button" data-preset="balanced">Balanced</button><button type="button" data-preset="convection">High convection</button><button type="button" data-preset="tangy">Tangy low-pH</button><button type="button" data-preset="cool">Cool slow</button></div></section>
  <section><h3>Room cycle</h3><label>Average temperature <output id="room-output" for="room"></output><input id="room" type="range" min="15" max="35" step=".5"></label><label>Day / night swing <output id="swing-output" for="swing"></output><input id="swing" type="range" min="0" max="12" step=".5"></label></section>
  <section><h3>Cover / gas exchange</h3><div class="segmented" role="group" aria-label="Cover type">${Object.keys(PRESETS).map(id => `<button type="button" data-cover="${id}">${id}</button>`).join('')}</div><label>Permeability <output id="permeability-output" for="permeability"></output><input id="permeability" type="range" min="0" max="100" step="1"></label></section>
  <section id="exchange-section"><h3>Tea recipe &amp; automatic care</h3><div class="care-controls" role="group" aria-label="Automatic tea care"><label><input id="auto-drain" type="checkbox"> Auto harvest</label><label><input id="tea-mode" type="checkbox"> Auto refill</label><label><input id="auto-skim" type="checkbox"> Auto skim</label></div><p class="hint">Auto harvest retains 35% as starter at pH below 3.52 or sugar below 40 g/L. Auto refill tops up to 72% with this recipe; auto skim acts above 2.1 mm. Turn these off for manual care. Amounts below are percentages of full capacity; Pour and Drain use them in the workspace. Hot tea can injure exposed cells.</p><label>Drain amount <output id="drain-output" for="drain-amount"></output><input id="drain-amount" type="range" min="0" max="50" value="15"></label><label>Pour amount <output id="pour-output" for="pour-amount"></output><input id="pour-amount" type="range" min="0" max="50" value="15"></label><label>Tea temperature <output id="tea-temp-output" for="tea-temp"></output><input id="tea-temp" type="range" min="10" max="95" value="24"></label><label>Tea sugar <output id="tea-sugar-output" for="tea-sugar"></output><input id="tea-sugar" type="range" min="0" max="160" value="80"></label></section>
  <details><summary>Add starter culture</summary><label>Starter liquid <output id="starter-output" for="starter-amount"></output><input id="starter-amount" type="range" min="1" max="30" value="8"></label><label>Yeast share <output id="starter-balance-output" for="starter-balance"></output><input id="starter-balance" type="range" min="0" max="100" value="50"></label><button id="starter" class="action" type="button">Add starter</button></details>
  <details><summary>Advanced model controls</summary><div class="advanced"><label>Convection strength <output id="convection-output" for="convection"></output><input id="convection" type="range" min="0" max="250" value="120"></label><label>Inherited trait variation <output id="variation-output" for="variation"></output><input id="variation" type="range" min="0" max="30" value="8"></label></div></details>
  <details><summary>Reading the field</summary><div class="reaction-key"><span><i class="m-sugar">Sugar</i> feeds <b class="warm">yeast</b>, releasing ethanol and CO2.</span><span><b class="cool">Bacteria</b> use ethanol, glucose, and oxygen to make acids and cellulose.</span><p class="hint">Round amber cells are yeast; teal rods are bacteria. Rings mark the cells followed in the close-ups. Liquid shows the culture with quiet flow tracers. Choose a chemical field to see that substance alone, or Organisms for sparse reaction and cross-feeding paths. Close-ups show the tracked cell's active reactions.</p></div></details>
  <p class="panel-note">An illustrative simulation of microbial relationships, not a brewing guide.</p>
</dialog>
<dialog id="detail" class="glass history-dialog" aria-labelledby="detail-title">
  <div class="panel-top"><h2 id="detail-title">Vessel history</h2><button data-close="detail" aria-label="Close history">×</button></div>
  <p id="history-window" class="hint"></p>
  <div class="history-grid">${HISTORY_CHARTS.map(({kind,title,unit,note}) => `
    <section class="history-card">
      <h3 id="history-title-${kind}">${title} <small>${unit}</small></h3>
      <output id="history-reading-${kind}"></output>
      <svg id="history-chart-${kind}" viewBox="0 0 320 160" role="img" aria-describedby="history-note-${kind}"></svg>
      <p id="history-note-${kind}" class="hint">${note}</p>
    </section>`).join('')}
  </div>
  <p class="hint">Each graph has its own value scale; time axes show simulated days. Culture: solid amber yeast, dashed teal bacteria. Concentrations are illustrative model readings.</p>
</dialog>`;
}
