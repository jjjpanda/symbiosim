export function createProgram(gl, vertex, fragment, resources) {
  const shaders = [gl.VERTEX_SHADER, gl.FRAGMENT_SHADER].map((type, i) => {
    const shader = gl.createShader(type); resources.shaders.push(shader);
    gl.shaderSource(shader, i ? fragment : vertex); gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(shader));
    return shader;
  });
  const result = gl.createProgram(); resources.programs.push(result);
  for (const shader of shaders) gl.attachShader(result, shader);
  gl.linkProgram(result);
  if (!gl.getProgramParameter(result, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(result));
  return result;
}
