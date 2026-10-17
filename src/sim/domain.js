export function toDisc(x, z, out = [0, 0], radius = .5) {
  const a = x * 2 - 1, b = z * 2 - 1;
  out[0] = a * Math.sqrt(Math.max(0, 1 - b * b / 2)) * radius;
  out[1] = b * Math.sqrt(Math.max(0, 1 - a * a / 2)) * radius;
  return out;
}
export function fromDisc(x, z, out = [0, 0], radius = .5) {
  const a = x / radius, b = z / radius, u = 2 + a * a - b * b, v = 2 - a * a + b * b, k = 2 * Math.SQRT2;
  out[0] = .5 + (Math.sqrt(Math.max(0, u + k * a)) - Math.sqrt(Math.max(0, u - k * a))) / 4;
  out[1] = .5 + (Math.sqrt(Math.max(0, v + k * b)) - Math.sqrt(Math.max(0, v - k * b))) / 4;
  return out;
}
