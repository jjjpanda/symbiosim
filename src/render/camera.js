import { clamp } from '../sim/constants.js';
import { vesselOrientation } from '../sim/vessel.js';

export const defaultCamera = () => ({ yaw: 0, elevation: Math.asin(.34) * 180 / Math.PI });

export function turnCamera(camera, horizontal, vertical) {
  camera.yaw = ((camera.yaw + horizontal + 180) % 360 + 360) % 360 - 180;
  camera.elevation = clamp(camera.elevation + vertical, 8, 48);
}

// Translate screen movement into the vessel's horizontal plane at any orbit.
export function tipVessel(view, horizontal, vertical, start = view.sim.vessel) {
  const yaw = view.camera.yaw * Math.PI / 180;
  view.sim.vessel.tilt = start.tilt + horizontal * Math.cos(yaw) + vertical * Math.sin(yaw);
  view.sim.vessel.tiltZ = (start.tiltZ || 0) - horizontal * Math.sin(yaw) + vertical * Math.cos(yaw);
  const pose = vesselOrientation(view.sim), degrees = pose.angle * 180 / Math.PI;
  view.sim.vessel.tilt = degrees * pose.x;
  view.sim.vessel.tiltZ = degrees * pose.z;
}

export function bindCamera(view) {
  const canvas = view.canvas;
  let drag;
  const changed = () => { view.updateCamera(); view.draw(); };
  canvas.onpointerdown = e => {
    if (e.button !== 0 || drag) return;
    canvas.focus();
    const pose = vesselOrientation(view.sim), degrees = pose.angle * 180 / Math.PI;
    drag = { id: e.pointerId, x: e.clientX, y: e.clientY, yaw: view.camera.yaw, elevation: view.camera.elevation,
      tilt: degrees * pose.x, tiltZ: degrees * pose.z, tipping: e.shiftKey || view.tiltMode, moved: false };
    canvas.setPointerCapture(e.pointerId);
  };
  canvas.onpointermove = e => {
    if (!drag || e.pointerId !== drag.id) return;
    const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
    if (!drag.moved && Math.hypot(dx, dy) < 2) return;
    drag.moved = true;
    if (drag.tipping) {
      tipVessel(view, dx * .08, dy * .08, drag);
      // Re-anchor at each move so reversing at the rim limit responds immediately.
      drag.x = e.clientX; drag.y = e.clientY;
      drag.tilt = view.sim.vessel.tilt; drag.tiltZ = view.sim.vessel.tiltZ;
    } else {
      Object.assign(view.camera, { yaw: drag.yaw, elevation: drag.elevation });
      turnCamera(view.camera, dx * .45, -dy * .18);
    }
    changed();
  };
  const finish = e => {
    if (!drag || e.pointerId !== drag.id) return;
    drag = null;
    if (canvas.hasPointerCapture(e.pointerId)) canvas.releasePointerCapture(e.pointerId);
  };
  canvas.onpointerup = canvas.onpointercancel = canvas.onlostpointercapture = finish;
  view.$('#reset-camera').onclick = () => { Object.assign(view.camera, defaultCamera()); changed(); };
  view.$('#tilt-mode').onclick = () => { view.tiltMode = !view.tiltMode; changed(); };
  view.$('#upright-jar').onclick = () => { view.sim.vessel.tilt = 0; view.sim.vessel.tiltZ = 0; changed(); };
  view.$$?.('[data-camera]').forEach(button => button.onclick = () => {
    const horizontal = button.dataset.camera === 'left' ? -1 : button.dataset.camera === 'right' ? 1 : 0;
    const vertical = button.dataset.camera === 'up' ? -1 : button.dataset.camera === 'down' ? 1 : 0;
    if (view.tiltMode) tipVessel(view, horizontal * 2, vertical * 2);
    else turnCamera(view.camera, horizontal * 10, -vertical * 3);
    changed();
  });
}
