# Symbiosim

A 3D simulation of a kombucha vessel with circulating tea, yeast, acetic acid bacteria, dissolved chemistry, and a floating cellulose pellicle, packaged as a web component.

![Symbiosim](screenshots/symbiosim.png)

## Culture

A coarse 3D fluid solver (22 × 30 × 8 on desktop, 16 × 24 × 5 on phones) couples velocity components through a closed-volume Neumann pressure projection and conservatively transports temperature and eight chemical fields (`sucrose`, `glucose`, `fructose`, `ethanol`, `oxygen`, `acetic`, `gluconic`, `co2`). Heat, sugar density, inlet momentum, outlet forcing, rising bubbles, and free-surface waves drive circulation.

| Role / Material | Behavior |
| --- | --- |
| Yeast | Ferments sugars into ethanol and $\text{CO}_2$; inhibited and killed by excess ethanol above ~4–6% ABV. |
| Acetic acid bacteria | Oxidize ethanol and glucose into acetic and gluconic acids using a shared $\text{O}_2$ budget; tolerate ~8–12% ABV. |
| Pellicle (mother) | Glucose-funded cellulose sheet with wet-load buoyancy, elastic deformation, 2D translation/rotation, and gas trapping under `FILM_CUTOFF`. |
| Surface mold | Rare *Aspergillus* / *Penicillium* particulate (`ppm`) on exposed film under warm, low-acid aerobic conditions; latches failure above `100 ppm`. |

Automatic care checks every half day: by default it harvests 65% below pH 3.52 or 40 g/L sugar, refills to 72% capacity, and skims 80% of the pellicle above 2.1 mm mean thickness. Displayed pour/drain jets compress 0.12-day conservative exchanges into ~1–3s hydraulic animations. One perspective WebGL 2 scene renders the inner/outer glass walls, steel spigot, refracting tea, contoured pellicle, and point sprites with shared offscreen depth.

## Embed

```sh
npm install ../symbiosim
```

```js
import 'symbiosim';
```

```html
<symbiosim-vessel embed transparent width="420" height="520" preset="balanced" theme="dark"></symbiosim-vessel>
```

Adding `embed` hides the masthead, organism close-up rails, instrument panels, HUD, and camera toolbar so only the interactive 3D jar is displayed. Adding `transparent` removes the component backdrop and prevents glass/tea refraction from compositing an opaque room fill behind the vessel.

## Options

Set options with HTML attributes or `setAttribute()`.

| Attribute | Default | Purpose |
| --- | --- | --- |
| `embed` | absent | Show only the 3D jar canvas without surrounding UI panels, HUD, or toolbars. |
| `transparent` | absent | Transparent host background and alpha-preserving glass/liquid refraction. |
| `width`, `height` | automatic | Requested component size in pixels, constrained to `min(100%, <px>)`. |
| `theme` | system | `light` or `dark` (falls back to `prefers-color-scheme`). |
| `preset` | custom | `balanced`, `convection`, `tangy`, `cool`, `vinegar`, or `mold`. |
| `field` | `liquid` | `liquid`, `organisms`, `flow`, `temperature`, `mold`, `sugar`, `oxygen`, `ethanol`, `acidity`, or `co2`. |
| `speed` | `12` | Simulated biological pace in days per minute (`1`–`60`). |
| `room` | `24` | Average room temperature in °C (`15`–`35`). |
| `swing` | `4` | Day/night temperature swing in °C (`0`–`12`). |
| `permeability` | `45` | Gas exchange permeability percentage (`0`–`100`). |
| `autoplay` | on | Set to `false` to start paused. |
| `autofocus` | absent | Focus the component when connected. |

## Controls

Drag the vessel to orbit, scroll or use `+` / `−` to zoom up to 3×, and **Shift-drag** (or toggle **Tilt jar**) to physically tip the vessel and shift gravity. Drag either tracking voxel to rotate its 3D close-up.

| Key | Action |
| --- | --- |
| Space / S | Run or pause / step 0.08 days |
| Hold W | Swirl tea (accelerates rotational momentum while held) |
| H | Pour 8% hot tea at 70°C |
| F / V | Cycle biological speed / visualization field |
| C / E | Open Conditions / Tea recipe & care |
| T / N | Toggle theme / start a new vessel |
| Arrows / R | Orbit camera (`Shift` + arrows tips jar) / reset view |

## Development

Requires Node 22 or newer and WebGL 2. No runtime packages are required.

```sh
npm run dev
npm test
npm run build
```

`npm run benchmark` times solver steps, `npm run soak -- 30 --playback` verifies multi-week culture stability and snapshot restoration, and `npm run check:browser` runs headless Chromium WebGL and layout checks.
