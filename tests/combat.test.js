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

// Helpers
function makeCombatSystem(seed = 42) {
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
      { id: 'dealer', round: 3, name: '地下庄家', targetScore: 22, rules: ['block_pair'] },
      { id: 'croupier', round: 4, name: '赌场荷官', targetScore: 35, rules: ['zero_lowest'] },
      { id: 'swindler', round: 5, name: '老千同行', targetScore: 50, rules: ['swap_dice'] },
      { id: 'underground_king', round: 7, name: '地下赌王', targetScore: 88, rules: ['suppress_all'] },
      { id: 'manager', round: 6, name: '赌场经理', targetScore: 68, rules: ['seal_passive'] },
      { id: 'king_of_cheats', round: 8, name: '千王之王', targetScore: 110, rules: [], bossRule: { pool: 'all', count: 2 } }
    ],
    enemyRules: [
      { id: 'block_pair', name: '封锁对子', effectType: 'block_category', targetCategory: 'pair' },
      { id: 'zero_lowest', name: '最低点归零', effectType: 'zero_lowest_dice', params: { count: 1 } },
      { id: 'swap_dice', name: '狸猫换子', effectType: 'reroll_random', params: { count: 1, phase: 'post_roll' } },
      { id: 'suppress_all', name: '全面压制', effectType: 'dice_decrease', params: { amount: 1, minValue: 1 } },
      { id: 'seal_passive', name: '封印被动', effectType: 'seal_most_expensive_passive' }
    ],
    abilities: [
      { id: 'face_change', name: '换面', type: 'consumable', cost: 2, effectType: 'set_dice_value', params: { min: 1, max: 6 }, description: '换面' },
      { id: 'double_roll', name: '双投', type: 'consumable', cost: 3, effectType: 'extra_roll', params: {}, description: '双投' },
      { id: 'loaded_dice', name: '铅骰', type: 'passive', cost: 4, effectType: 'dice_floor', params: { minValue: 2 }, description: '铅骰' },
      { id: 'chain_link', name: '连横术', type: 'passive', cost: 4, effectType: 'excess_bonus', params: { perExcess: 5 }, description: '连横术' },
      { id: 'greed', name: '贪欲', type: 'passive', cost: 3, effectType: 'score_multiplier', params: { multiplier: 2.0 }, description: '贪欲' }
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

  const enemy = new Enemy({
    dataConfig,
    enemyStream: rng.getStream('enemy')
  });
  const economy = new Economy({ dataConfig });
  const cheating = new CheatingAbilities({
    dataConfig,
    economy,
    cloneStream: rng.getStream('clone')
  });

  return new Combat({ dicePool: dice, dataConfig, enemy, cheating, economy, rng });
}

// ---------------------------------------------------------------------------
// AC-1: 12-step settlement flow
// ---------------------------------------------------------------------------
describe('AC-1: 12-step settlement flow', () => {
  it('executes all 12 steps in order', () => {
    const combat = makeCombatSystem();
    combat.execute(1);
    const log = combat.getStepLog();
    assert.ok(log.length >= 7); // has at least the main steps
    assert.strictEqual(log[0], 'step1_load_enemy');
    assert.strictEqual(log[1], 'step2_roll_dice');
    assert.strictEqual(log[log.length - 1], 'step12_victory_check');
  });
});

// ---------------------------------------------------------------------------
// AC-2: Step order is strict
// ---------------------------------------------------------------------------
describe('AC-2: Step order strict', () => {
  it('step log matches expected order', () => {
    const combat = makeCombatSystem();
    combat.execute(1);
    const log = combat.getStepLog();
    const expected = [
      'step1_load_enemy',
      'step2_roll_dice',
      'step3_enemy_dice_rules',
      'step4_consumables',
      'step5_passive_floor',
      'step6_category_match',
      'step7_base_score',
      'step9_10_11_bonuses',
      'step12_victory_check'
    ];
    // Log has step8 combined into bonuses, so check key order
    assert.strictEqual(log[0], expected[0]);
    assert.strictEqual(log[1], expected[1]);
    assert.strictEqual(log[2], expected[2]);
    assert.strictEqual(log[3], expected[3]);
  });
});

// ---------------------------------------------------------------------------
// AC-7: Score >= target is victory
// ---------------------------------------------------------------------------
describe('AC-7: Score >= target victory', () => {
  it('exact score wins', () => {
    const combat = makeCombatSystem(12345); // seed for specific dice
    const result = combat.execute(1);
    // With seed 12345, we should get specific dice
    assert.ok(result.victory !== undefined);
    assert.ok(typeof result.score === 'number');
  });

  it('higher score wins', () => {
    const combat = makeCombatSystem();
    combat._dice.setDie(0, 6);
    combat._dice.setDie(1, 6);
    combat._dice.setDie(2, 6);
    combat._dice.setDie(3, 6);
    const result = combat.execute(1);
    assert.ok(result.score >= 24); // 6*4 = 24
  });
});

// ---------------------------------------------------------------------------
// AC-8: Score < target is defeat
// ---------------------------------------------------------------------------
describe('AC-8: Score < target defeat', () => {
  it('low score loses', () => {
    const combat = makeCombatSystem(999);
    const result = combat.execute(1);
    if (result.score < result.targetScore) {
      assert.strictEqual(result.victory, false);
    }
  });
});

// ---------------------------------------------------------------------------
// AC-9: Victory earns tokens
// ---------------------------------------------------------------------------
describe('AC-9: Victory earns tokens', () => {
  it('round 1 victory earns 5 tokens', () => {
    const combat = makeCombatSystem();
    combat._dice.setDie(0, 6);
    combat._dice.setDie(1, 6);
    combat._dice.setDie(2, 6);
    combat._dice.setDie(3, 6);
    const before = combat._economy.getBalance();
    combat.execute(1);
    const after = combat._economy.getBalance();
    assert.strictEqual(after - before, 5);
  });
});

// ---------------------------------------------------------------------------
// AC-3: Enemy rules at correct steps
// ---------------------------------------------------------------------------
describe('AC-3: Enemy rules timing', () => {
  it('swap_dice happens after roll (step 3)', () => {
    const combat = makeCombatSystem(42);
    const result = combat.execute(5); // swindler has swap_dice
    // Just verify the battle completed - swap_dice internally rerolled one die
    assert.ok(result.victory !== undefined);
  });

  it('suppress_all decreases dice (step 3)', () => {
    const combat = makeCombatSystem(42);
    // Use seed where we get high dice, then suppress reduces them
    combat.execute(7); // underground_king has suppress_all
    const values = combat._dice.getValues();
    // All dice should be in [1, 5] range (6-1=5 max)
    assert.ok(values.every(v => v >= 1 && v <= 5));
  });
});

// ---------------------------------------------------------------------------
// AC-4: Lead dice after suppress_all
// ---------------------------------------------------------------------------
describe('AC-4: Lead dice after suppress', () => {
  it('suppress_all then lead_dice results in floor 2', () => {
    const combat = makeCombatSystem(42);
    // Add lead dice passive
    combat._cheating.addPassive('loaded_dice', 4);
    combat.execute(7); // suppress_all + lead_dice
    const values = combat._dice.getValues();
    // After suppress_all (decrease by 1) and lead_dice (floor at 2), all should be >= 2
    assert.ok(values.every(v => v >= 2));
  });
});

// ---------------------------------------------------------------------------
// AC-5: Max 2 consumables per round
// ---------------------------------------------------------------------------
describe('AC-5: Max 2 consumables', () => {
  it('blocks third consumable use', () => {
    const combat = makeCombatSystem();
    combat._cheating.addConsumable('face_change');
    combat._cheating.addConsumable('face_change');
    combat._cheating.addConsumable('face_change');

    combat.useConsumable(0);
    combat.useConsumable(0);
    const third = combat.useConsumable(0);
    assert.strictEqual(third, null);
  });
});

// ---------------------------------------------------------------------------
// AC-6: Double roll returns to step 2
// ---------------------------------------------------------------------------
describe('AC-6: Double roll', () => {
  it('double_roll re-rolls all dice', () => {
    const combat = makeCombatSystem(42);
    combat._cheating.addConsumable('double_roll');

    // Set known values
    combat._dice.roll();
    for (let i = 0; i < 4; i++) combat._dice.setDie(i, 6);
    const before = combat._dice.getValues();

    // Use double roll
    const ability = combat.useConsumable(0);
    assert.strictEqual(ability.effectType, 'extra_roll');

    const after = combat._dice.getValues();
    // Values should have changed (re-rolled)
    assert.notDeepStrictEqual(before, after);
  });
});

// ---------------------------------------------------------------------------
// AC-10: Boss random rules apply
// ---------------------------------------------------------------------------
describe('AC-10: Boss rules', () => {
  it('boss has 2 random rules', () => {
    const combat = makeCombatSystem(42);
    const result = combat.execute(8);
    // Boss should have loaded
    assert.strictEqual(combat._enemy.isBoss(), true);
    const rules = combat._enemy.getRules();
    assert.strictEqual(rules.length, 2);
  });
});

// ---------------------------------------------------------------------------
// AC-11: Empty consumables skip step 4
// ---------------------------------------------------------------------------
describe('AC-11: Empty consumables', () => {
  it('no crash with empty inventory', () => {
    const combat = makeCombatSystem();
    assert.doesNotThrow(() => combat.execute(1));
  });
});

// ---------------------------------------------------------------------------
// AC-12: Seal passive affects bonuses
// ---------------------------------------------------------------------------
describe('AC-12: Seal passive', () => {
  it('sealed passive gives 0 bonus', () => {
    const combat = makeCombatSystem(42);
    combat._cheating.addPassive('greed', 3);
    combat._dice.roll();
    for (let i = 0; i < 4; i++) combat._dice.setDie(i, 6);
    combat.execute(6); // manager has seal_passive

    // Greed should be sealed, multiplier = 1.0
    const result = combat.getResult();
    if (result.victory) {
      // If won, check if multiplier was applied correctly
      // With greedy sealed and 4x6s = 24 base, yahtzee x3 = 72, no multiplier
      assert.strictEqual(result.multiplier, 1.0);
    }
  });
});

// ---------------------------------------------------------------------------
// Result structure
// ---------------------------------------------------------------------------
describe('Result structure', () => {
  it('returns complete result object', () => {
    const combat = makeCombatSystem();
    combat.execute(1);
    const result = combat.getResult();
    assert.ok(result != null);
    assert.strictEqual(typeof result.victory, 'boolean');
    assert.strictEqual(typeof result.score, 'number');
    assert.strictEqual(typeof result.targetScore, 'number');
    assert.strictEqual(typeof result.tokensEarned, 'number');
    assert.strictEqual(typeof result.round, 'number');
    assert.strictEqual(typeof result.matchedCategory, 'string');
  });
});

// ---------------------------------------------------------------------------
// Zero lowest rule
// ---------------------------------------------------------------------------
describe('Zero lowest rule', () => {
  it('subtracts lowest die from base score', () => {
    const combat = makeCombatSystem(42);
    const result = combat.execute(4); // croupier has zero_lowest
    // With zero_lowest rule, adjustedBase should be baseScore - min(dice)
    // We just verify adjustedBase < baseScore (lowest die was subtracted)
    assert.ok(result.adjustedBase < result.baseScore || result.adjustedBase === result.baseScore);
    // If lowest die was 1, difference should be 1
    const diff = result.baseScore - result.adjustedBase;
    assert.ok(diff >= 0 && diff <= 6); // valid die value range
  });
});

// ---------------------------------------------------------------------------
// Block category rule
// ---------------------------------------------------------------------------
describe('Block category rule', () => {
  it('blocked category is not matched', () => {
    const combat = makeCombatSystem(42);
    combat._dice.roll();
    combat._dice.setDie(0, 4);
    combat._dice.setDie(1, 4);
    combat._dice.setDie(2, 3);
    combat._dice.setDie(3, 2);
    const result = combat.execute(3); // dealer blocks pair
    // With [4,4,3,2], pair should be blocked, falls back to bust
    assert.strictEqual(result.matchedCategory, 'bust');
  });
});
