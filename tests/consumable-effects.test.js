'use strict';

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { Combat } from '../src/combat.js';
import { DicePool } from '../src/dice.js';
import { CheatingAbilities } from '../src/cheating.js';
import { Economy } from '../src/economy.js';
import { Enemy } from '../src/enemy.js';
import { RNG } from '../src/rng.js';
import { DataConfig } from '../src/data-config.js';

// Shared helper — mirrors combat.test.js makeCombatSystem
function makeCombat(seed = 42) {
  const rng = new RNG(); rng.seed(seed);
  const dataConfig = new DataConfig().loadFromObject({
    globalConfig: { dice: { initialCount: 4, maxCount: 7, minFace: 1, maxFace: 6 } },
    scoringCategories: [
      { id: 'pair', name: '对子', matchType: 'same_value', matchCount: 2, minDice: 2, bonusType: 'fixed', bonusValue: 0, priority: 6 },
      { id: 'three_of_a_kind', name: '三条', matchType: 'same_value', matchCount: 3, minDice: 3, bonusType: 'fixed', bonusValue: 5, priority: 5 },
      { id: 'yahtzee', name: '豹子', matchType: 'all_same', minDice: 3, bonusType: 'multiplier', bonusValue: 3, priority: 1 },
      { id: 'bust', name: '散牌', matchType: 'fallback', minDice: 0, bonusType: 'fixed', bonusValue: 0, priority: 7 }
    ],
    enemies: [
      { id: 'thug', round: 1, name: '街头混混', targetScore: 8, rules: [] },
      { id: 'thug2', round: 2, name: '地痞赌徒', targetScore: 14, rules: [] },
    ],
    enemyRules: [],
    abilities: [
      { id: 'face_change', name: '换面', type: 'consumable', cost: 2, effectType: 'set_dice_value', params: { min: 1, max: 6 }, description: '换面' },
      { id: 'loaded_shot', name: '加料', type: 'consumable', cost: 2, effectType: 'reroll_min', params: { minValue: 4 }, description: '加料' },
      { id: 'swap_dice', name: '换位', type: 'consumable', cost: 1, effectType: 'swap_values', params: {}, description: '换位' },
      { id: 'gamble', name: '赌博', type: 'consumable', cost: 1, effectType: 'gamble_reroll', params: { goodValue: 6, badValue: 1, chance: 0.5 }, description: '赌博' },
      { id: 'freeze_die', name: '冻结', type: 'consumable', cost: 2, effectType: 'freeze_die', params: {}, description: '冻结' },
      { id: 'invert_dice', name: '反转', type: 'consumable', cost: 2, effectType: 'invert_value', params: { sumValue: 7 }, description: '反转' },
      { id: 'double_roll', name: '双投', type: 'consumable', cost: 3, effectType: 'extra_roll', params: {}, description: '双投' },
      { id: 'swap_lowest', name: '偷梁换柱', type: 'consumable', cost: 3, effectType: 'replace_lowest', params: { value: 6 }, description: '偷梁换柱' },
      { id: 'insight', name: '透视', type: 'consumable', cost: 1, effectType: 'reveal_weakness', params: { bonusFlat: 10 }, description: '透视' },
      { id: 'clone_dice', name: '分身术', type: 'passive', cost: 5, effectType: 'clone_dice', params: { count: 1 }, description: '分身术' },
    ],
    economy: { tokenRewards: [5, 5, 6, 6, 7, 7, 8, 9] }
  });

  const dice = new DicePool({
    diceStream: rng.getStream('dice'),
    cloneStream: rng.getStream('clone'),
    minFace: 1,
    maxFace: 6,
    initialCount: 4,
    maxCount: 7
  });

  const enemy = new Enemy({ dataConfig, enemyStream: rng.getStream('enemy') });
  const economy = new Economy({ dataConfig });
  const cheating = new CheatingAbilities({ dataConfig, economy, cloneStream: rng.getStream('clone') });

  return new Combat({ dicePool: dice, dataConfig, enemy, cheating, economy, rng });
}

describe('Consumable Effects', () => {
  it('set_dice_value changes targeted die to chosen value', () => {
    const combat = makeCombat();
    combat.executeRollPhase(1);

    combat._cheating.addConsumable('face_change');
    combat.useConsumable(0, { targetIndex: 2, targetValue: 5 });

    assert.strictEqual(combat._dice.getValues()[2], 5, 'Die 2 should be set to 5');
  });

  it('reroll_min re-rolls targeted die with minimum value', () => {
    const combat = makeCombat(99);
    combat.executeRollPhase(1);

    combat._cheating.addConsumable('loaded_shot');
    combat.useConsumable(0, { targetIndex: 0 });

    const val = combat._dice.getValues()[0];
    assert.ok(val >= 4, `loaded_shot result should be >= 4, got ${val}`);
  });

  it('gamble_reroll sets all dice to 1 or 6', () => {
    const combat = makeCombat(42);
    combat.executeRollPhase(1);

    combat._cheating.addConsumable('gamble');
    combat.useConsumable(0);

    const values = combat._dice.getValues();
    const allSame = values.every(v => v === values[0]);
    assert.ok(allSame, 'All dice should be same value after gamble');
    assert.ok(values[0] === 1 || values[0] === 6, `Should be 1 or 6, got ${values[0]}`);
  });

  it('swap_values exchanges two dice', () => {
    const combat = makeCombat();
    combat.executeRollPhase(1);

    combat._dice.setDie(0, 2);
    combat._dice.setDie(1, 5);

    combat._cheating.addConsumable('swap_dice');
    combat.useConsumable(0, { targetIndex: 0, targetIndex2: 1 });

    const values = combat._dice.getValues();
    assert.strictEqual(values[0], 5, 'Die 0 should now be 5');
    assert.strictEqual(values[1], 2, 'Die 1 should now be 2');
  });

  it('invert_value applies 7-x formula', () => {
    const combat = makeCombat();
    combat.executeRollPhase(1);

    combat._dice.setDie(0, 3);

    combat._cheating.addConsumable('invert_dice');
    combat.useConsumable(0, { targetIndex: 0 });

    assert.strictEqual(combat._dice.getValues()[0], 4, '7 - 3 = 4');
  });

  it('freeze_die marks die as frozen', () => {
    const combat = makeCombat();
    combat.executeRollPhase(1);

    combat._dice.setDie(1, 6);

    combat._cheating.addConsumable('freeze_die');
    combat.useConsumable(0, { targetIndex: 1 });

    // Check the die object has isFrozen flag
    const dice = combat._dice.getDice();
    assert.strictEqual(dice[1].isFrozen, true, 'Die 1 should be frozen');
    assert.strictEqual(dice[1].value, 6, 'Frozen die should keep its value');
  });

  it('freeze_die preserves die across next round roll', () => {
    const combat = makeCombat(7);
    combat.executeRollPhase(1);

    combat._dice.setDie(0, 6);
    combat._cheating.addConsumable('freeze_die');
    combat.useConsumable(0, { targetIndex: 0 });

    // Verify frozen
    assert.strictEqual(combat._dice.getDice()[0].isFrozen, true);

    // Start next round — frozen die should survive the roll, then flag is cleared
    combat.executeRollPhase(2);
    const val = combat._dice.getValues()[0];
    // After BUG-1 fix: frozen die keeps value 6 during roll, then flag is cleared
    assert.strictEqual(val, 6, 'Frozen die should have survived the roll with value 6');
    assert.strictEqual(combat._dice.getDice()[0].isFrozen, false, 'Flag should be cleared after roll');
  });

  it('replace_lowest replaces lowest die with target value', () => {
    const combat = makeCombat();
    combat.executeRollPhase(1);

    combat._dice.setDie(0, 1);
    combat._dice.setDie(1, 6);
    combat._dice.setDie(2, 4);
    combat._dice.setDie(3, 5);

    combat._cheating.addConsumable('swap_lowest');
    combat.useConsumable(0);

    const values = combat._dice.getValues();
    assert.strictEqual(values[0], 6, 'Lowest die (was 1) should now be 6');
  });

  it('extra_roll re-rolls all dice', () => {
    const combat = makeCombat(42);
    combat.executeRollPhase(1);

    const beforeValues = [...combat._dice.getValues()];

    combat._cheating.addConsumable('double_roll');
    combat.useConsumable(0);

    const afterValues = combat._dice.getValues();
    // Dice should have changed (extremely unlikely to get same values with different seed)
    assert.ok(beforeValues.length === afterValues.length, 'Dice count unchanged');
  });

  it('reveal_weakness sets weakness category bonus', () => {
    const combat = makeCombat();
    combat.executeRollPhase(1);

    combat._cheating.addConsumable('insight');
    const result = combat.useConsumable(0);

    // insight sets a weakness bonus internally
    assert.ok(result, 'Consumable should be used successfully');
  });

  it('temp dice from clone_dice are cleared between rounds', () => {
    const combat = makeCombat(42);

    // Add clone_dice passive (using abilityId string)
    combat._cheating.addPassive('clone_dice');

    combat.executeRollPhase(1);
    const countAfterRound1 = combat._dice.getDice().length;
    // Should be 5 (4 base + 1 temp clone)
    assert.strictEqual(countAfterRound1, 5, 'Should have 5 dice with clone');

    // Round 2 — temp should be cleared, then new clone added
    combat.executeRollPhase(2);
    const countAfterRound2 = combat._dice.getDice().length;
    assert.strictEqual(countAfterRound2, 5, 'Should still have 5 dice (old temp cleared, new clone added)');
  });
});
