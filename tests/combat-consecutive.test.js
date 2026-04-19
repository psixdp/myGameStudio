'use strict';

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { Combat } from '../src/combat.js';
import { DicePool } from '../src/dice.js';
import { Enemy } from '../src/enemy.js';
import { CheatingAbilities } from '../src/cheating.js';
import { Economy } from '../src/economy.js';
import { RNG } from '../src/rng.js';
import { DataConfig } from '../src/data-config.js';

function makeCombat(seed = 42) {
  const rng = new RNG();
  rng.seed(seed);

  const dataConfig = new DataConfig().loadFromObject({
    globalConfig: {
      dice: { initialCount: 5, maxCount: 7, minFace: 1, maxFace: 6 },
      rounds: { total: 1 }
    },
    scoringCategories: [
      { id: 'yahtzee', name: 'Yahtzee', matchType: 'all_same', minDice: 3, bonusType: 'multiplier', bonusValue: 3, priority: 1 },
      { id: 'large_straight', name: 'Large Straight', matchType: 'consecutive', consecutiveCount: 5, minDice: 5, bonusType: 'flat', bonusValue: 20, priority: 3 },
      { id: 'small_straight', name: 'Small Straight', matchType: 'consecutive', consecutiveCount: 4, minDice: 4, bonusType: 'flat', bonusValue: 10, priority: 4 },
      { id: 'three_of_a_kind', name: 'Three', matchType: 'same_value', matchCount: 3, minDice: 3, bonusType: 'flat', bonusValue: 5, priority: 5 },
      { id: 'pair', name: 'Pair', matchType: 'same_value', matchCount: 2, minDice: 2, bonusType: 'flat', bonusValue: 0, priority: 6 },
      { id: 'bust', name: 'Bust', matchType: 'fallback', minDice: 0, bonusType: 'flat', bonusValue: 0, priority: 7 }
    ],
    abilities: [
      { id: 'straight_eye', name: 'Straight Eye', type: 'passive', cost: 4, effectType: 'loose_consecutive', params: { maxGap: 1 }, description: '' }
    ],
    enemies: [{ id: 'r1', round: 1, name: 'Round1', targetScore: 0, rules: [] }],
    enemyRules: [],
    economy: { tokenRewards: [0], shop: { itemsPerRefresh: 3, refreshCost: 1 }, diceExpansion: { bonusRounds: [1], bonusWeight: 1 } }
  });

  const dice = new DicePool({
    diceStream: rng.getStream('dice'),
    cloneStream: rng.getStream('clone'),
    minFace: 1,
    maxFace: 6,
    initialCount: 5,
    maxCount: 7
  });
  const enemy = new Enemy({ dataConfig, enemyStream: rng.getStream('enemy') });
  const economy = new Economy({ dataConfig });
  const cheating = new CheatingAbilities({ dataConfig, economy, cloneStream: rng.getStream('clone') });
  const combat = new Combat({ dicePool: dice, dataConfig, enemy, cheating, economy, rng });

  return { combat, cheating, dice };
}

describe('Consecutive matching', () => {
  it('uses consecutiveCount for large/small straight distinction', () => {
    const { combat, dice } = makeCombat();
    combat.executeRollPhase(1);

    [1, 2, 3, 4, 6].forEach((v, i) => dice.setDie(i, v));
    const result = combat.recalculateFromCurrentDice();

    assert.equal(result.matchedCategory.id, 'small_straight');
  });

  it('matches large straight only when 5-length run exists', () => {
    const { combat, dice } = makeCombat();
    combat.executeRollPhase(1);

    [1, 2, 3, 4, 5].forEach((v, i) => dice.setDie(i, v));
    const result = combat.recalculateFromCurrentDice();

    assert.equal(result.matchedCategory.id, 'large_straight');
  });

  it('loose consecutive does not accept huge internal jumps', () => {
    const { combat, cheating, dice } = makeCombat();
    cheating.addPassive('straight_eye', 4);
    combat.executeRollPhase(1);

    [1, 2, 6, 7, 1].forEach((v, i) => dice.setDie(i, v));
    const result = combat.recalculateFromCurrentDice();

    assert.equal(result.matchedCategory.id, 'pair');
  });

  it('loose consecutive allows one-step gaps when gap passive is active', () => {
    const { combat, cheating, dice } = makeCombat();
    cheating.addPassive('straight_eye', 4);
    combat.executeRollPhase(1);

    [1, 3, 4, 5, 1].forEach((v, i) => dice.setDie(i, v));
    const result = combat.recalculateFromCurrentDice();

    assert.equal(result.matchedCategory.id, 'small_straight');
  });
});
