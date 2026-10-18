# Symbiosim

A glass kombucha vessel with circulating tea, visible chemical tracers, microorganisms, bubbles and a floating cellulose mother.

## Run

Requires Node 22 or newer. No packages need installing.

```sh
npm run dev
npm test
npm run build
```

Open the URL printed by the server. To serve the production build, run `node scripts/serve.js dist`. Restart an already running development server after updating the source file list. WebGL 2 is required for the 3D view.

## Interact

- Drag to orbit the perspective camera; drag vertically to change elevation. Arrow keys also move the camera. **R** resets it.
- **Shift-drag** physically tips the jar in both directions relative to the current camera. **Tilt jar** below the vessel switches dragging and the direction buttons to tipping; Shift + arrow keys also tip. Set upright restores both axes. Tipping changes gravity and the liquid surface, independently of the camera.
- **Swirl / W** adds rotational momentum to the liquid. The mother can drift, turn and bend with the currents; tea impacts dent it and it rebounds.
- **H** adds 8% of capacity at 70°C. The temperature front can soften the film and injure exposed cells.
- **Pour, Drain, Add starter, Skim film and Swirl tea** are directly available in Vessel actions, alongside the pellicle readings. Recipe & care opens the recipe and automatic-care settings in Conditions. Camera direction, tilt and reset buttons sit below the canvas. Actions preserve Pause; Resume or Step advances a queued transfer. Each phase takes about 1-3 seconds. Outlet speed depends on liquid head, and detached drops follow gravity.
- Two tracking voxels follow one yeast and one acetic acid bacterium by ID. A ring and ID identify the target among actual neighboring cells, with a moving spatial grid, a recorded path, and a small jar locator. Labeled molecular shapes flow toward the cell for uptake and away for products, driven by that cell's actual metabolism. If it leaves the culture, the view acquires the nearest survivor of the same species. Drag each cube to rotate it. The vessel and both cell views stay together in the workspace.
- Pause and Step sit together in the header. Presets, the continuous permeability slider, room-temperature controls, recipe settings and the new-vessel action live in **Conditions**. **Theme** and **History** are directly available in the header. History shows eight labeled graphs with independent value scales and the latest recorded readings.
- The compact **Field** selector offers nine views with legends. **Reading the field** expands beside it for help, outside Conditions. Circulation shows curved paths integrated through the current solver velocity; chemical views show concentration-dependent clouds, tracer points, and mean/peak readings. Trace amounts are identified explicitly. The main view fills the available space; clicking opens no zoom overlay.
- **Space** pauses; **S** steps; **F** cycles biological speed; **V** cycles fields; **C / E** opens Conditions / exchange; **T** changes theme; **N** starts a new culture after confirmation.

Every reload starts a fresh culture: 480 modeled organisms, a free-edged starter pellicle, and automatic care enabled. No browser storage is used. The default biological pace is 12 days/minute. The motion clock keeps a minimum pace of 12 so slow biological playback still shows currents. Reduced motion suppresses trails and rising bubble samples.

Automatic care checks every half day. At pH below 3.52 or sugar below 40 g/L it harvests 65% and retains 35% as living starter, then refills with the selected recipe. Refills contain no organisms. Auto skim removes 80% of the film above 2.1 mm mean thickness, retaining a thin layer for regrowth. Disable it independently in Conditions. The thickness scale is illustrative, not a brewing measurement. Turn all three care modes off for a finite manual batch. This revision passed six seeded 30-day default playback runs without extinction or reseeding; it has not repeated older revisions' 730-day checks.

The readings show temperature, sugar, pH and their changes over one simulated day. Pellicle area coverage, mean thickness, immersion and skim count are separate readings. A compact strip keeps the main readings next to the vessel on phones; controls have touch-sized targets.

## Model and rendering

Desktop grids have 22 × 30 × 8 cells; phone grids have 16 × 24 × 5. A closed-volume pressure projection couples all three velocity components. Conservative transport carries eight chemical fields and temperature. Heat, sugar density, inlet momentum, outlet forcing, bubbles and surface slopes drive circulation. Local chemistry supports yeast, bacteria and glucose-funded cellulose growth.

The pellicle keeps its material inventory, elastic deformation and vertical inertia. A phenomenological wet-load model places thicker, larger and cooler sheets deeper in the liquid; retained gas supports them. Bubbles intercept its actual submerged underside. An explicit body pose adds horizontal translation, rotation and momentum in the circular vessel. Gas collects below intact material and must reach a lifted edge before escaping. The rendered contour has a top, underside and thin exposed edge; its texture follows the material.

One WebGL scene draws the jar, water, film, particles, bubbles, steel spigot and airborne streams with a shared perspective camera and depth buffer. Glass and tea refract the rendered scene. The jar has separate inner and outer walls, a curved shoulder, rolled mouth and heavy foot. The spigot uses continuous sweep rings through its elbow, with a compact mounting bezel and an open bore aligned with the discharged stream. Point sprites retain readable pixel sizes and opacity; they follow the solver without carrying extra chemical mass. The remaining Canvas presents that scene at its displayed size.

The default Living tea view emphasizes amber yeast and teal bacteria over quiet neutral flow tracers. Chemical fields show one substance at a time; Cell activity adds sparse reaction and cross-feeding paths. Temperature uses distributed clouds throughout the liquid, with a shared numeric color scale centered on room temperature and expanded for hot or cold additions; it does not use velocity streaks. Curved current paths use the instantaneous solver field, independent of frame duration; still tea does not invent motion. Larger chemical clouds scale opacity with local concentration. Legends use fixed saturation references, with numeric mean and peak values alongside them. Rings link the vessel to the two tracked cells. Visual offsets, full sprite radii, and trail segments are contained within the glass and liquid; airborne transfer droplets remain free to travel outside it.

The liquid surface is a height field over a coarse 3D solver. It cannot overturn or resolve splashes and air/liquid topology. Stream breakup and bubble optics are bounded approximations. The mother remains one connected material system; it does not tear into independent fragments. Chemistry is illustrative, not calibrated brewing guidance.

## Verify

```sh
npm run benchmark
npm run soak -- 30 --playback
npm run check:browser
```

The soak checks both species, resources, liquid and material bounds, reproduction, exchanges and deterministic restoration. Browser checks use an installed Edge/Chrome through a debugging pipe, and save screenshots in `.artifacts/`. Set `BROWSER_PATH` for another installation. Numerical or mock-WebGL tests do not establish native shader appearance or device frame rate.

See [DESIGN.md](DESIGN.md) for ownership and [REVIEW.md](REVIEW.md) for current validation and limitations.
