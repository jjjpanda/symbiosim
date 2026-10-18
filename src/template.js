import { HISTORY_CHARTS } from './charts.js';
import { FIELD_VIEWS } from './fields.js';

export { OVERLAYS } from './fields.js';

const icon = path => `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="${path}"/></svg>`;
export const THEME_ICONS = {
  sun: 'M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8ZM12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4',
  moon: 'M20.7 13A9 9 0 0 1 11 3.3 9 9 0 1 0 20.7 13Z'
};
const icons = {
  pause: icon('M9 5v14M15 5v14'),
  step: icon('m5 5 10 7-10 7zM19 5v14'),
  theme: icon(THEME_ICONS.moon),
  conditions: icon('M4 7h16M4 17h16M9 4v6M15 14v6')
};

export function vesselTemplate() {
  return `<link rel="stylesheet" href="${new URL('./style.css', import.meta.url)}">
<div class="layout" data-view="split">
  <header class="masthead">
    <div class="identity"><h1>symbiosim<span class="identity-dot" aria-hidden="true"></span></h1></div>
    <nav class="glass" aria-label="Simulation controls">
      <button data-k=" " class="play-button" title="Run or pause · Space">${icons.pause}<span id="play"></span></button>
      <button data-k="s" title="Pause and advance 0.08 days · S">${icons.step}<span>Step</span></button>
      <button data-k="t">${icons.theme}<span>Theme</span></button>
      <button data-k="c" aria-label="Conditions" title="Conditions · C">${icons.conditions}<span>Conditions</span></button>
    </nav>
  </header>
  <aside class="left-rail" aria-label="Tracked organisms">
    <div class="cell-samples" aria-label="Live organism close-ups">
      ${[['yeast', 'Yeast', 'Sugar → ethanol + CO₂'], ['bacteria', 'Acetic acid bacterium', 'Ethanol + oxygen → acids']].map(([type, name, reaction]) => `
      <section class="voxel-card glass-card" aria-label="${name} tracking voxel">
        <div class="voxel-header"><div><span class="section-label ${type === 'yeast' ? 'warm' : 'cool'}">${name}</span><small id="${type}-coords">Finding a cell…</small></div><span class="tracking-label">LIVE</span></div>
        <canvas id="${type}-canvas" class="voxel-canvas" tabindex="0" role="img" aria-label="Close-up following one ${name.toLowerCase()}. Drag or use arrow keys to rotate; R resets."></canvas>
        <div class="voxel-footer"><span class="reaction-caption">${reaction}</span><span id="${type}-summary"></span></div>
      </section>`).join('')}
      <p class="sample-hint">The ring follows one cell; nearby cells and its path give context. Molecule shapes show active uptake and products.</p>
    </div>

    <div class="legend" aria-label="Organism legend"><span><b class="yeast-mark warm" aria-hidden="true"></b> yeast</span><span><b class="bacteria-mark cool" aria-hidden="true"></b> bacteria</span><span><b class="film-mark warm" aria-hidden="true"></b> cellulose</span><span>◎ tracked cell</span></div>
  </aside>
  <section class="field" aria-label="Fermentation vessel">
    <canvas id="canvas" tabindex="0" role="img" aria-label="Drag to orbit; Shift-drag to tip the jar. Arrow keys turn the view; Shift + arrow keys tip the jar; Scroll or use + / − to zoom; R resets the view and zoom."></canvas>
    <div class="hud"><span id="day"></span><span id="state"></span></div>
    <div class="mobile-readings" aria-hidden="true"><span>Tea <b id="mobile-temperature"></b></span><span>Sugar <b id="mobile-sugar"></b></span><span>pH <b id="mobile-ph"></b></span></div>
    <div class="vessel-tools" role="group" aria-label="Camera and vessel interaction">
      <span class="camera-label">Camera</span>
      <button type="button" data-camera="left" aria-label="Turn camera left" title="Turn left">←</button>
      <button type="button" data-camera="up" aria-label="Raise camera" title="Raise view">↑</button>
      <button type="button" data-camera="down" aria-label="Lower camera" title="Lower view">↓</button>
      <button type="button" data-camera="right" aria-label="Turn camera right" title="Turn right">→</button>
      <button type="button" data-zoom="1.25" aria-label="Zoom into jar" title="Zoom in">+</button>
      <button type="button" data-zoom="0.8" aria-label="Zoom out of jar" title="Zoom out">−</button>
      <output id="camera-zoom" aria-label="Camera zoom">1×</output>
      <button id="tilt-mode" type="button" aria-pressed="false" title="Switch dragging and direction buttons between orbiting and tipping the jar">Tilt jar</button>
      <button id="upright-jar" type="button">Set upright</button>
      <button id="reset-camera" type="button">Reset view</button>
      <output id="jar-tilt-output" aria-label="Current jar tilt"></output>
    </div>
    <div class="field-footer"><span>KOMBUCHA</span><span>drag orbit · scroll zoom · shift-drag tilt</span></div>
  </section>
  <aside class="instruments" aria-label="Controls and readings">

    <div class="stats glass-card" aria-label="Current readings">
      <button data-chart="temperature"><span>Temp</span><strong id="temperature"></strong><small id="temperature-delta" title="Change over the last simulated day; available after day 1."></small></button>
      <button data-chart="sugar"><span>Sugar</span><strong id="sugar"></strong><small id="sugar-delta" title="Change over the last simulated day; available after day 1."></small></button>
      <button data-chart="ph"><span><i class="ph-dot" id="ph-swatch" aria-hidden="true"></i>pH</span><strong id="ph"></strong><small id="ph-delta" title="Change over the last simulated day; available after day 1."></small></button>
    </div>
    <div class="settings glass-card">
      <label><span>Pace</span><output id="speed-output" for="speed"></output><input id="speed" type="range" min="1" max="60" step="1" aria-label="Simulated days per minute"></label>
    </div>
    <section class="field-browser glass-card" aria-label="Visualization">
      <label class="field-select"><span>Field</span><select id="overlay" aria-label="Vessel visualization">${FIELD_VIEWS.map(({id,name}) => `<option value="${id}">${name}</option>`).join('')}</select></label>
      <div id="field-scale" class="field-scale" aria-hidden="true"></div><div class="field-scale-labels"><span id="field-low"></span><span id="field-high"></span></div>
      <output id="field-reading" aria-live="off"></output>
      <section class="field-history" aria-labelledby="field-history-title">
        <div class="section-label"><span id="field-history-title"></span><button id="field-history-open" class="pill-btn">Expand</button></div>
        <output id="field-history-reading" aria-live="off"></output>
        <svg id="field-history-chart" viewBox="0 0 320 160" role="img" aria-labelledby="field-history-title"></svg>
        <p id="field-history-note" class="hint"></p>
      </section>
      <details class="field-guide"><summary>Reading the field</summary><h3 id="field-title">Living tea</h3><p id="field-description"></p><p id="field-key"></p><p>Muted yellow ovals are yeast; blue rods are bacteria. Rings mark the cells followed in the close-ups. Cell activity shows active uptake, products and exchanges.</p></details>
    </section>
    <section class="care-card glass-card" aria-label="Vessel actions">
      <div class="care-heading"><span class="section-label">Vessel actions</span></div>
      <div class="fluid-actions" aria-label="Interact with the tea">
        <button id="pour" title="Pour the configured tea recipe">Pour 15%</button>
        <button id="drain" title="Drain from the lower outlet">Drain 15%</button>
        <button id="starter" title="Add the starter amount and yeast share set in Conditions">Add starter 8%</button>
        <button id="skim" title="Remove 80% of the film; the rest can regrow">Skim film</button>
      </div>
      <button id="swirl" aria-pressed="false" class="swirl-button" title="Press and hold to build rotational momentum · W"><span>Hold to swirl tea</span><output id="swirl-speed" aria-live="off" aria-label="Estimated liquid rotational speed" title="Estimated visible rotations per minute from the liquid velocity. Paused readings are queued until Resume or Step.">0.0 rpm</output></button>
      <div class="culture-notes"><span id="care-status"></span><span id="exchange-count"></span></div>
      <section class="film-readings" aria-label="Pellicle readings"><div class="section-label">Pellicle <strong id="film-thickness" title="Mean thickness of covered patches, using the illustrative visual scale."></strong></div><progress id="film-load" max="2.4" value="0" aria-label="Mean pellicle thickness in illustrative millimeters"></progress><span id="pellicle-status"></span><span id="film-care"></span></section>
    </section>

    <p class="action-status" role="status" aria-live="polite"></p>
  </aside>
</div>
<dialog id="panel" class="panel glass" aria-labelledby="panel-title">
  <div class="panel-top"><div><p class="eyebrow">Shape the culture</p><h2 id="panel-title">Conditions</h2></div><button id="close-panel" type="button" aria-label="Close conditions">×</button></div>
  <section><h3>Quick presets</h3><div class="preset-pills" role="group" aria-label="Fermentation presets"><button type="button" data-preset="balanced">Balanced</button><button type="button" data-preset="convection">High convection</button><button type="button" data-preset="tangy">Tangy low-pH</button><button type="button" data-preset="cool">Cool slow</button></div></section>
  <section><h3>Room cycle</h3><label>Average temperature <output id="room-output" for="room"></output><input id="room" type="range" min="15" max="35" step=".5"></label><label>Day / night swing <output id="swing-output" for="swing"></output><input id="swing" type="range" min="0" max="12" step=".5"></label></section>
  <section><h3>Gas exchange</h3><label>Permeability <output id="permeability-output" for="permeability"></output><input id="permeability" type="range" min="0" max="100" step="1"></label><p class="hint">0% seals the vessel. Higher values admit more oxygen and let dissolved gas escape; 100% is fully open.</p></section>
  <section id="exchange-section"><h3>Tea recipe &amp; care</h3><div class="care-controls" role="group" aria-label="Automatic tea care"><label><input id="auto-drain" type="checkbox"> Auto harvest</label><label><input id="tea-mode" type="checkbox"> Auto refill</label><label><input id="auto-skim" type="checkbox"> Auto skim</label></div><p class="hint">Auto harvest retains 35% as starter at pH below 3.52 or sugar below 40 g/L. Auto refill tops up to 72% with this recipe; auto skim acts above 2.1 mm. Turn these off for manual care. Amounts below are percentages of full capacity; Pour and Drain use these amounts. Use the vessel action buttons to pour or drain; Resume or Step advances a paused transfer. Hot tea can injure exposed cells.</p><label>Drain amount <output id="drain-output" for="drain-amount"></output><input id="drain-amount" type="range" min="0" max="50" value="15"></label><label>Pour amount <output id="pour-output" for="pour-amount"></output><input id="pour-amount" type="range" min="0" max="50" value="15"></label><label>Tea temperature <output id="tea-temp-output" for="tea-temp"></output><input id="tea-temp" type="range" min="10" max="95" value="24"></label><label>Tea sugar <output id="tea-sugar-output" for="tea-sugar"></output><input id="tea-sugar" type="range" min="0" max="160" value="80"></label></section>
  <details><summary>Add starter culture</summary><label>Starter liquid <output id="starter-output" for="starter-amount"></output><input id="starter-amount" type="range" min="1" max="30" value="8"></label><label>Yeast share <output id="starter-balance-output" for="starter-balance"></output><input id="starter-balance" type="range" min="0" max="100" value="50"></label><p class="hint">Use Add starter in the vessel actions to add this mixture.</p></details>
  <section><h3>Session</h3><div class="session-actions"><button data-k="n" class="pill-btn">New vessel</button></div></section>
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
  <p class="hint">Each graph has its own value scale; time axes show simulated days. Culture: solid muted yellow yeast, dashed blue bacteria. Concentrations are illustrative model readings.</p>
</dialog>`;
}
