import { clamp } from '../sim/constants.js';

export const defaultCamera = () => ({ yaw: 0, elevation: Math.asin(.34) * 180 / Math.PI });

export function turnCamera(camera, horizontal, vertical) {
  camera.yaw = ((camera.yaw + horizontal + 180) % 360 + 360) % 360 - 180;
  camera.elevation = clamp(camera.elevation + vertical, 8, 48);
}

export function bindCamera(view) {
  const canvas = view.canvas;
  let drag;
  const changed = () => { view.updateCamera(); view.draw(); };
  canvas.onpointerdown = e => {
    if (e.button !== 0 || drag) return;
    canvas.focus();
    drag = { id: e.pointerId, x: e.clientX, y: e.clientY, yaw: view.camera.yaw, elevation: view.camera.elevation,
      tilt: view.sim.vessel.tilt, tipping: e.shiftKey, moved: false };
    canvas.setPointerCapture(e.pointerId);
  };
  canvas.onpointermove = e => {
    if (!drag || e.pointerId !== drag.id) return;
    const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
    if (!drag.moved && Math.hypot(dx, dy) < 6) return;
    drag.moved = true;
    if (drag.tipping) view.sim.vessel.tilt = clamp(drag.tilt + dx * .08, -12, 12);
    else {
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
  for (const key of ['yaw', 'elevation']) view.$('#camera-' + key).oninput = e => {
    view.camera[key] = Number(e.target.value); changed();
  };
  view.$('#reset-camera').onclick = () => { Object.assign(view.camera, defaultCamera()); changed(); };
  view.$('#jar-tilt').oninput = e => { view.sim.vessel.tilt = Number(e.target.value); changed(); };
  view.$('#upright-jar').onclick = () => { view.sim.vessel.tilt = 0; changed(); };
}
