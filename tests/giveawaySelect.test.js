import test from 'node:test';
import assert from 'node:assert/strict';
import { selectWinnersWithDisclosedChoice } from '../src/services/giveawayService.js';

test('disclosed selection works for single-winner giveaways', () => {
  const winners = selectWinnersWithDisclosedChoice(['a', 'b', 'c'], 1, 'b');
  assert.deepEqual(winners, ['b']);
});

test('disclosed selection fills remaining slots randomly without duplicates', () => {
  const winners = selectWinnersWithDisclosedChoice(['a', 'b', 'c', 'd'], 3, 'a');
  assert.equal(winners.length, 3);
  assert.equal(winners[0], 'a');
  assert.equal(new Set(winners).size, 3);
  assert.ok(winners.every((id) => ['a', 'b', 'c', 'd'].includes(id)));
});

test('disclosed selection rejects non-entrants', () => {
  assert.throws(
    () => selectWinnersWithDisclosedChoice(['a', 'b'], 1, 'z'),
    /Selected giveaway winner is not an entrant/,
  );
});
