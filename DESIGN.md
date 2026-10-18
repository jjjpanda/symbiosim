# Architecture

The simulation owns state and time; the renderer reads that state. One 3D scene owns visible geometry, perspective, lighting, depth and transparency. No runtime packages are required.

## Simulation

`engine.js` owns seeded organisms, interventions, automatic care, stepping and snapshots. `sim/fluid.js` advances a coarse 3D velocity grid, projects face flux through a separable Neumann pressure solve, and transports temperature and eight dissolved fields conservatively. Midpoint tracing and 3D vorticity confinement retain resolved circulation. Scalar substeps obey their measured outgoing-flux CFL bound.

`sim/chemistry.js` handles local reactions, growth, survival, thermal injury and excess-ethanol toxicity (where acetic acid bacteria tolerate much higher alcohol than kombucha yeasts). Incoming tea uses conservative volume remapping and local parcel exchange under its inlet. The shared oxygen budget prevents bacteria from spending the same oxygen twice. Refills add no organisms. Automatic skimming reuses the manual removal path above 2.1 illustrative mm mean thickness; it exports 80% of each cellulose layer and records the removal.

`sim/surface.js` evolves a zero-mean height field around the tipped vessel's gravity equilibrium. Pour impacts, gas releases and upper currents force it. Currents advect its disturbances; slopes feed momentum into the upper liquid. Rising gas samples also add localized buoyant wakes before pressure projection supplies return flow.

`sim/film-body.js` maps material to the circular vessel using an explicit translating and rotating pose plus small elastic residual offsets. Its inverse first removes the rigid pose, then solves the bounded residual map. Fluid drag supplies translation and torque; circular wall contacts resolve outward motion. The layer arrays remain material inventory. `sim/pellicle.js` supplies vertical inertia, buoyancy, tension, inlet loading, thermal softening and maturation. Mesh spacing and surface-cell area scale tension and gas pressure. Wet load increases with density, span and cooling; retained gas contributes body lift and local pressure. Bubble interception uses the actual film depth. Opposing wall contacts are resolved together to avoid order-dependent drift. Wall contact, drag, gas trapping, pocket migration, outlets and pocket sprites share `FILM_CUTOFF`; surface bubbles in open water vent at their moving positions. Forward material points resolve against the circular wall before the inverse disc transform, and the render mesh respects the inner foot and shoulder at both thickness bounds.

Gas pockets store inventory. Their pressure, load capacities and connected-region threshold account for cell area. Intact cellulose blocks gas; escape needs a real lifted edge or wall opening. Storage pressure alone does not create a hole.

`sim/mold.js` tracks *Aspergillus* / *Penicillium* surface particulates in pellicle material coordinates (`ppm`). Local pH, temperature, oxygen, sugar, ethanol and immersion gate incubation, rare spore arrival (`20 ppm` local patch) and neighbor spread on the biological clock using an independent seeded RNG. Active colonies consume local surface dissolved $\text{O}_2$ and sugar. Low pH and ethanol kill nascent spores before takeover; exceeding `100 ppm` overall latches failure, stops stepping and prompts a restart through `mold-ui.js`. Green film tint, attached spore sprites, the Mold field and history read this state in `ppm`.

All six presets in `sim/constants.js` configure environmental settings through `applySettings`; Pure vinegar and Mold growing also update `care` options (`harvestPh`, `fraction`, recipe and toggles) while preserving liquid, organisms, film, history and Pause. Manual and automatic drains share `care.fraction` (% of current liquid), whereas pour and starter amounts remain fractions of full capacity.

`sim/transfer-clock.js` compresses displayed transfer duration to about 1–3 seconds while retaining differences in amount and hydraulic head. `main.js` uses that clock independently of biological speed. `swirl.js` owns the accelerating press-and-hold lifecycle; `history.js` shares history formatting and observation caches between the field card and dialog. `fields.js` defines adaptive scalar ranges, field statistics and history mappings for both UI and rendering. The engine still advances each exchange through a bounded .12-day biological phase; displayed jet flow is a hydraulic approximation of that conservative exchange, not a resolved outlet boundary condition.

Version-14 snapshots persist mold state; earlier versions start without contamination. Version 13 added auto-skimming preferences, count and exported material; `harvestPh` defaults to 3.52 when absent. Vessel orientation includes an optional depth tilt (`tiltZ`); older snapshots restore it as zero. A radial tilt limit applies across both axes, and the surface, buoyancy, bubble rise and shared scene transform use the same orientation. Version 12 added the mother pose and momentum; versions 1–11 migrate to an identity pose. State arrays are copied on snapshot/restore; render geometry and solver scratch are not persisted. Continuation is deterministic within the current implementation.

## One renderer

`renderer.js` presents one offscreen WebGL canvas. The main view uses the available space. Wheel and button zoom share the perspective matrix and particle size scale; Reset view restores orbit and zoom. `render/scene.js` owns its resources and render order. It draws opaque objects and particles to one scene framebuffer, copies colour into a second target sharing the same depth attachment, then draws transparent water, glass and streams using the scene colour for refraction. It presents colour only to the browser. The camera and depth tests are shared by every object.

The small render modules have separate roles:

| Module | Responsibility |
| --- | --- |
| `space.js` | World units, camera matrix, perspective projection |
| `geometry.js` | Bounded interleaved triangle buffers, surfaces of revolution and tubes |
| `objects.js` | Jar/tap geometry, water surface, material-contour film mesh, chemical colours |
| `streams.js` | Ballistic 3D parcels, continuity-based radius, breakup and droplets |
| `scene-shaders.js` | Shared mesh and point materials |
| `particles.js` | Bounded midpoint-advection tracer arrays |
| `camera.js` | Orbit, camera-relative two-axis tilt and pointer/keyboard controls |
| `voxel.js` | Two organism ID locks, actual spatial neighbors, bounded simulation-time paths, molecular reaction flows and local readings |
| `palette.js` | Shared organism colors for the vessel and tracking views |
| `activity.js` | Bounded visual reaction pace without changing simulation metabolism |
| `webgl.js` | Shader compilation and program linking |

The jar profile includes the inner wall, shoulder, rolled rim and base. The film clips its actual density contour and uses material UVs, so camera orbit cannot slide its texture across the surface. Particles have a minimum readable point size and meaningful opacity; cells and gas use the same scene depth. Chemical and thermal fields are sampled in 3D rather than drawn as projected Canvas strips.

Static meshes persist. Dynamic geometry uses fixed-capacity typed buffers and uploads into existing GPU storage. Water and film rebuild on state changes, not camera-only frames. One framebuffer colour texture supplies refraction; colour/depth storage reallocates on resize. Disconnection disposes resources. WebGL absence/failure produces an explicit error instead of constructing a second approximate renderer.

## Limits and verification

The bulk flow is coarse and the free surface cannot overturn. Airborne streams, capillary breakup, bubble optics and wall adhesion are approximations. The film does not split into independently simulated fragments. Optical materials use narrow studio reflections, absorption through tea and scene-space refraction, not spectral light transport. Thickness and buoyancy parameters are illustrative.

Keep conservation, positive fields, closed-wall pressure flux, local heat and ethanol injury, material inventory, pose/inverse consistency, hydraulic timing and restore continuation covered by tests. Geometry tests check actual wall thickness, film contours and shared perspective. Mock GPU tests check buffer reuse and resource lifecycle; they cannot compile shaders or establish visual quality. Native browser screenshots and representative devices remain necessary for those claims.
