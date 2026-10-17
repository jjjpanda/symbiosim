import { createScene } from './render/scene.js';
// Canvas presents the single 3D scene.
export function draw(view) {
  const width = view.canvas.clientWidth, height = view.canvas.clientHeight;
  if (!width || !height || !view.palette?.warm)
    return;
  if (!view.sceneRenderer && !view.sceneError) {
    try {
      view.sceneRenderer = createScene(document.createElement('canvas'));
    }
    catch (error) {
      view.sceneError = error.message;
    }
  }
  view.ctx.clearRect(0, 0, width, height);
  if (view.sceneRenderer) {
    try {
      if (view.sceneRenderer.invalid) {
        view.sceneRenderer.dispose();
        view.sceneRenderer = createScene(document.createElement('canvas'));
      }
      if (view.sceneRenderer.render(view))
        view.ctx.drawImage(view.sceneRenderer.canvas, 0, 0, width, height);
    }
    catch (error) {
      view.sceneError = error.message;
      view.sceneRenderer.dispose();
      view.sceneRenderer = undefined;
    }
  }
  if (view.sceneError) {
    view.ctx.fillStyle = view.palette.fg || '#8ab8b2';
    view.ctx.font = '14px system-ui';
    view.ctx.fillText(view.sceneError, 24, height / 2);
  }
}
