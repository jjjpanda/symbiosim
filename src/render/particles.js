const reflect = value => {
  const phase = ((value - .005) % 1.98 + 1.98) % 1.98;
  return .005 + (phase <= .99 ? phase : 1.98 - phase);
};

// Bounded visual samples of the scalar fields; these carry no chemical mass.
// Their movement follows the solver and never consumes the biological RNG.
export function advanceParticles(view, dt) {
  const count = view.overlay === 'organisms' ? 0 : view.overlay === 'liquid' ? (view.sim.nx < 20 ? 400 : 1200) : view.sim.nx < 20 ? 1600 : 4800;
  if (!view.particles || view.particles.length !== count * 3) {
    view.particles = new Float32Array(count * 3);
    view.particlePrevious = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      view.particles[i * 3] = (i * .754877666 + .13) % 1;
      view.particles[i * 3 + 1] = (i * .569840296 + .31) % 1;
      view.particles[i * 3 + 2] = (i * .438579021 + .19) % 1;
    }
    view.particlePrevious.set(view.particles);
  }
  if (!view.motion || !(dt > 0)) return;
  const velocity = view.particleVelocity ||= [0, 0, 0];
  view.particlePrevious.set(view.particles);
  for (let i = 0; i < view.particles.length; i += 3) {
    const x = view.particles[i], y = view.particles[i + 1], z = view.particles[i + 2];
    const [vx, vy, vz] = view.sim.velocity(x, y, velocity, z);
    // Midpoint tracing follows curved streamlines without the outward drift
    // of Euler steps, especially when the playback clock takes larger steps.
    view.sim.velocity(reflect(x + vx * dt * .5), reflect(y + vy * dt * .5), velocity, reflect(z + vz * dt * .5));
    view.particles[i] = reflect(x + velocity[0] * dt);
    view.particles[i + 1] = reflect(y + velocity[1] * dt);
    view.particles[i + 2] = reflect(z + velocity[2] * dt);
  }
}
