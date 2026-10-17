// Molecule packets are schematic: their phase advances only when the cell
// actually processes food. No wall-clock animation or renderer RNG is used.
export const CHEMICAL_COLORS = {
  sugar: [.85, .67, .35],
  oxygen: [.42, .66, .74],
  ethanol: [.77, .49, .30],
  acid: [.69, .40, .36],
  co2: [.64, .73, .73]
};

const YEAST_CHANNELS = [['sugar', true, 1], ['ethanol', false, 1], ['co2', false, 1]];
const BACTERIA_CHANNELS = [['ethanol', true, 1], ['oxygen', true, 90], ['sugar', true, 1], ['acid', false, 1]];
const YEAST_ANGLES = [-2.6, .4, -1.05];
const BACTERIA_ANGLES = [2.8, -2, 1.9, -.2];

export function reactionPackets(agent, motion = true) {
  const m = agent.metabolism;
  if (!m) return [];
  const yeast = agent.type === 'yeast';
  const channels = yeast ? YEAST_CHANNELS : BACTERIA_CHANNELS;
  const angles = yeast ? YEAST_ANGLES : BACTERIA_ANGLES;
  const packets = [];
  for (let index = 0; index < channels.length; index++) {
    const [name, intake, scale] = channels[index];
    if (!(m[name] > 1e-8))
      continue;
    const phase = motion ? (m.turnover * .22 + agent.id * .618034 + index * .27) % 1 : .5;
    packets.push({
      name,
      color: CHEMICAL_COLORS[name],
      intake,
      phase,
      strength: Math.min(1, m[name] * scale / (yeast ? 12 : 5)),
      angle: angles[index] + Math.sin(agent.id * 2.4) * .35
    });
  }
  return packets;
}
