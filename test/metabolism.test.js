import test from 'node:test';
import assert from 'node:assert/strict';
import { reactionPackets } from '../src/metabolism.js';

test('reaction directions remain stable when another substrate is exhausted', () => {
  const agent = { id: 4, type: 'bacteria', metabolism: { ethanol: 6, oxygen: .08, sugar: .8, acid: 5.82, turnover: 2 } };
  const before = reactionPackets(agent).find(packet => packet.name === 'oxygen');
  agent.metabolism.ethanol = 0;
  const after = reactionPackets(agent).find(packet => packet.name === 'oxygen');
  assert.equal(after.angle, before.angle);
  assert.equal(after.phase, before.phase);
});

test('yeast takes in sugar and releases ethanol and CO2 only when reacting', () => {
  const agent = { id: 1, type: 'yeast', metabolism: { sugar: 12, ethanol: 5.76, co2: 5.52, turnover: 1 } };
  const packets = reactionPackets(agent);
  assert.deepEqual(packets.map(p => [p.name, p.intake]), [['sugar', true], ['ethanol', false], ['co2', false]]);
  agent.metabolism.turnover += .1;
  assert.notEqual(reactionPackets(agent)[0].phase, packets[0].phase);
  assert.deepEqual(reactionPackets({ id: 2, type: 'yeast', metabolism: { sugar: 0, ethanol: 0, co2: 0, turnover: 2 } }), []);
});

test('bacteria visibly take in ethanol and oxygen and exude acid', () => {
  const agent = { id: 4, type: 'bacteria', metabolism: { ethanol: 6, oxygen: .08, sugar: .8, acid: 5.82, turnover: 2 } };
  assert.deepEqual(reactionPackets(agent).map(p => [p.name, p.intake]), [['ethanol', true], ['oxygen', true], ['sugar', true], ['acid', false]]);
  assert.ok(reactionPackets(agent, false).every(p => p.phase === .5));
  assert.deepEqual(reactionPackets({ id: 5, type: 'bacteria' }), []);
});
