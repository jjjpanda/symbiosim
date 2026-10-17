import test from 'node:test';
import assert from 'node:assert/strict';
import { parseSoakArgs } from '../scripts/soak-options.js';

test('soak accepts optional days independently of the playback flag', () => {
  assert.deepEqual(parseSoakArgs([]), { days: 730, playback: false });
  assert.deepEqual(parseSoakArgs(['--playback']), { days: 730, playback: true });
  assert.deepEqual(parseSoakArgs(['2', '--playback']), { days: 2, playback: true });
  assert.deepEqual(parseSoakArgs(['--playback', '2']), { days: 2, playback: true });
  for (const args of [['0'], ['-2'], ['bad'], ['1.5'], ['2', '3'], ['--unknown']]) {
    assert.throws(() => parseSoakArgs(args));
  }
});
