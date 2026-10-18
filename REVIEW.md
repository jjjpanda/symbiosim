# Symbiosim rework — 2026-10-16

## Mold, ethanol tolerance and field visibility update — 2026-10-18

Surface mold (*Aspergillus* / *Penicillium*) arrives rarely after sustained low-acid, aerobic conditions on exposed pellicle, consumes local surface $\text{O}_2$ and sugar, and is tracked in `ppm`. Low pH and ethanol kill nascent spores before takeover; exceeding `100 ppm` latches failure, pauses the vessel, and offers restart or inspection. Excess ethanol inhibits and kills kombucha yeast above ~4–6% ABV while acetic acid bacteria remain tolerant into the ~8–12% ABV vinegar range. Mold state uses a separate RNG stream and version-14 snapshots; old saves migrate cleanly.

All six presets adjust environmental settings; Pure vinegar and Mold growing also configure care while preserving the current culture and history. One Drain amount slider controls manual and automatic removal as a percentage of current liquid. The pellicle contour resolves against the circular wall and respects the inner shoulder and foot; gas trapping and pocket sprites share `FILM_CUTOFF`. All 168 tests and the production build pass. Browser appearance and native dialog behavior remain unverified.

The renderer now uses one perspective WebGL scene for the vessel, mother, particles, glass, tea and streams. The former Canvas layer/fallback renderers are removed. Fixed buffers and a shared camera/depth pipeline replace the competing projection paths.

## Interaction and appearance

- The tap mounts radially through the glass. Its vertical nozzle, bore, lip and discharged jet share one mouth position; the jet fits within the opening.
- Drain/refill playback takes about 1–3 seconds independently of biological pace. The outlet velocity still depends on liquid head. Tea impact loading dents the mother, then its own inertia and buoyancy produce rebound.
- The main view is larger; click inspection and its drawing/DOM paths are removed. Flow view owns tracer trails. Unused organism trails, tracer history buffers and link arrays are removed.
- Tea absorption replaces the uniform amber veil. Narrower reflections, smaller refraction offsets and reduced thermal haze preserve contrast in the jar. Native appearance still needs checking.
- Stats distinguish area coverage, illustrative mean thickness, immersion, skim count and rolling daily changes. pH has its own label. Mobile uses a compact vessel/readout strip, stacked panels, touch targets and viewport-bounded dialogs.

## Pellicle and care

A phenomenological load model lets thicker, broader and cooler wet sheets settle below the surface. Trapped gas supplies body lift and local pressure; bubbles meet the actual submerged underside. Unloading permits sinking and rebound. Opposing wall contacts resolve together, avoiding the prior ordering-dependent sideways drift.

Auto skim is enabled by default. At 2.1 mm mean thickness it exports 80% of every cellulose layer through the existing skim operation, leaves regrowth material, and counts the exported amount. It does not alter dissolved resources, liquid volume or organism counts. Version-13 snapshots validate/persist this policy and migrate older saves. Thickness and buoyancy are illustrative scales, not calibrated measurements.

## Verification

The current numerical/UI-control suite covers conservation, pressure, thermal injury, survival, material inventory, gas escape, submerged bubble contact, wet-load buoyancy, impact/rebound, auto skim, save migration, preset validation, translated film coordinate contracts, capacity reservation and 3D voxel sampling. Gas deformation assertions compare against each sheet's unloaded depth instead of assuming every sheet floats exactly at the surface. Daily-stat checks use interpolated history.

All 115 tests passed. The final camera adjustment also passed the scene/playback checks, including keeping the tilted jar and nozzle within a narrow viewport. Production build and whitespace checks passed. Engine scratch storage remains 1,181 KiB desktop / 435 KiB phone; benchmark timing in `.artifacts/care-benchmark.txt` was collected alongside tests and is not a frame-rate measurement.

Six seeded 30-day default playback soaks passed without extinction or reseeding: minimum daily populations remained above 50 yeast and 75 bacteria. Material/volume/resource bounds, reproduction and restored continuations passed. Older 730-day results do not validate this revision.

GPU control tests reject all depth blits and direct on-screen geometry draws. Two offscreen targets share depth; presentation copies colour only. This avoids the incompatible default-depth copy that could leave old tap/stream geometry behind. Resource reuse, resizing, point capacity reservation, reduced-motion trail suppression and disposal are checked. The native checker compares pixels before/after a camera round trip, exercises presets, and checks responsive layouts across six viewport widths.

## Limits

The bulk flow is coarse and its height-field surface cannot overturn or resolve free-surface topology. The mother remains a connected material system, with no independently simulated torn fragments. Chemistry, buoyancy, gas samples, stream breakup and outlet/adhesion parameters are illustrative approximations. Displayed jet hydraulics approximate the scheduled conservative liquid exchange.
