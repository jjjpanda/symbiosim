import { parseArgs } from 'node:util';

export function parseSoakArgs(args) {
  const { values, positionals } = parseArgs({
    args, allowPositionals: true, options: { playback: { type: 'boolean', default: false } }
  });
  const days = Number(positionals[0] ?? 730);
  if (positionals.length > 1 || !Number.isInteger(days) || days <= 0) {
    throw new Error('Usage: npm run soak -- [positive integer days] [--playback]');
  }
  return { days, playback: values.playback };
}
