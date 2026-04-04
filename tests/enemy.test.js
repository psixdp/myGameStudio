'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { Enemy } = require('../src/enemy');
const { DataConfig } = require('../src/data-config');
const { RNG } = require('../src/rng');

// Helpers
function makeEnemySystem(seed = 42) {
  const rng = new RNG(); rng.seed(seed);
  const dataConfig = new DataConfig().loadFromObject({
    enemies: [
      { id: 'thug', round: 1, name: '街头混混', targetScore: 8, rules: [] },
      { id: 'hustler', round: 2, name: '地痞赌徒', targetScore: 14, rules: [] },
      { id: 'dealer', round: 3, name: '地下庄家', targetScore: 22, rules: ['block_pair'] },
      { id: 'croupier', round: 4, name: '赌场荷官', targetScore: 35, rules: ['zero_lowest'] },
      { id: 'swindler', round: 5, name: '老千同行', targetScore: 50, rules: ['swap_dice'] },
      { id: 'manager', round: 6, name: '赌场经理', targetScore: 68, rules: ['seal_passive'] },
      { id: 'underground_king', round: 7, name: '地下赌王', targetScore: 88, rules: ['suppress_all'] },
      { id: 'king_of_cheats', round: 8, name: '千王之王', targetScore: 110, rules: [], bossRule: { pool: 'all', count: 2 } }
    ],
    enemyRules: [
      { id: 'block_pair', name: '封锁对子', description: '对子分类无法匹配', targetCategory: 'pair', effectType: 'block_category' },
      { id: 'zero_lowest', name: '最低点归零', description: '最低点骰子计分时视为0', effectType: 'zero_lowest_dice', params: { count: 1 } },
      { id: 'swap_dice', name: '狸猫换子', description: '敌人重掷你1颗骰子', effectType: 'reroll_random', params: { count: 1, phase: 'post_roll' } },
      { id: 'seal_passive', name: '封印被动', description: '最贵的被动本轮不生效', effectType: 'seal_most_expensive_passive' },
      { id: 'suppress_all', name: '全面压制', description: '所有骰子点数-1', effectType: 'dice_decrease', params: { amount: 1, minValue: 1 } }
    ],
    // Minimal required data for DataConfig
    globalConfig: { dice: { initialCount: 4, maxCount: 7 } },
    scoringCategories: [],
    abilities: [],
    economy: { tokenRewards: [5, 5, 6, 6, 7, 7, 8, 9] }
  });
  return new Enemy({
    dataConfig,
    enemyStream: rng.getStream('enemy')
  });
}

// ---------------------------------------------------------------------------
// AC-1: Load correct enemy by round
// ---------------------------------------------------------------------------
describe('AC-1: Load correct enemy by round', () => {
  it('round 1 loads thug', () => {
    const enemy = makeEnemySystem();
    enemy.loadForRound(1);
    assert.strictEqual(enemy.getId(), 'thug');
    assert.strictEqual(enemy.getName(), '街头混混');
    assert.strictEqual(enemy.getRound(), 1);
  });

  it('round 3 loads dealer', () => {
    const enemy = makeEnemySystem();
    enemy.loadForRound(3);
    assert.strictEqual(enemy.getId(), 'dealer');
    assert.strictEqual(enemy.getName(), '地下庄家');
  });

  it('round 8 loads boss', () => {
    const enemy = makeEnemySystem();
    enemy.loadForRound(8);
    assert.strictEqual(enemy.getId(), 'king_of_cheats');
    assert.strictEqual(enemy.getName(), '千王之王');
    assert.strictEqual(enemy.isBoss(), true);
  });

  it('throws on invalid round', () => {
    const enemy = makeEnemySystem();
    assert.throws(() => enemy.loadForRound(99), /No enemy found for round 99/);
  });
});

// ---------------------------------------------------------------------------
// AC-2: Target score matches config
// ---------------------------------------------------------------------------
describe('AC-2: Target score matches config', () => {
  it('round 1 target is 8', () => {
    const enemy = makeEnemySystem();
    enemy.loadForRound(1);
    assert.strictEqual(enemy.getTargetScore(), 8);
  });

  it('round 3 target is 22', () => {
    const enemy = makeEnemySystem();
    enemy.loadForRound(3);
    assert.strictEqual(enemy.getTargetScore(), 22);
  });

  it('round 8 target is 110', () => {
    const enemy = makeEnemySystem();
    enemy.loadForRound(8);
    assert.strictEqual(enemy.getTargetScore(), 110);
  });
});

// ---------------------------------------------------------------------------
// AC-3: Normal enemies return correct fixed rules
// ---------------------------------------------------------------------------
describe('AC-3: Normal enemies return correct fixed rules', () => {
  it('round 3 (dealer) has block_pair rule', () => {
    const enemy = makeEnemySystem();
    enemy.loadForRound(3);
    assert.strictEqual(enemy.hasRuleType('block_category'), true);
    const blocked = enemy.getBlockedCategories();
    assert.deepStrictEqual(blocked, ['pair']);
  });

  it('round 4 (croupier) has zero_lowest rule', () => {
    const enemy = makeEnemySystem();
    enemy.loadForRound(4);
    assert.strictEqual(enemy.hasZeroLowestRule(), true);
  });

  it('round 5 (swindler) has reroll_random rule', () => {
    const enemy = makeEnemySystem();
    enemy.loadForRound(5);
    assert.strictEqual(enemy.hasRuleType('reroll_random'), true);
    const params = enemy.getRerollParams();
    assert.deepStrictEqual(params, { count: 1, phase: 'post_roll' });
  });

  it('round 6 (manager) has seal_passive rule', () => {
    const enemy = makeEnemySystem();
    enemy.loadForRound(6);
    assert.strictEqual(enemy.hasSealPassiveRule(), true);
  });

  it('round 7 (underground_king) has dice_decrease rule', () => {
    const enemy = makeEnemySystem();
    enemy.loadForRound(7);
    const params = enemy.getDecreaseParams();
    assert.deepStrictEqual(params, { amount: 1, minValue: 1 });
  });
});

// ---------------------------------------------------------------------------
// AC-4: First 2 rounds have no special rules
// ---------------------------------------------------------------------------
describe('AC-4: First 2 rounds have no special rules', () => {
  it('round 1 has no rules', () => {
    const enemy = makeEnemySystem();
    enemy.loadForRound(1);
    assert.deepStrictEqual(enemy.getRules(), []);
    assert.strictEqual(enemy.getBlockedCategories().length, 0);
  });

  it('round 2 has no rules', () => {
    const enemy = makeEnemySystem();
    enemy.loadForRound(2);
    assert.deepStrictEqual(enemy.getRules(), []);
    assert.strictEqual(enemy.hasZeroLowestRule(), false);
  });
});

// ---------------------------------------------------------------------------
// AC-5: Boss random rules are not duplicated
// ---------------------------------------------------------------------------
describe('AC-5: Boss random rules are unique', () => {
  it('boss always has exactly 2 different rules', () => {
    const enemy = makeEnemySystem(42);
    for (let i = 0; i < 100; i++) {
      enemy.reset();
      enemy.loadForRound(8);
      const rules = enemy.getRules();
      assert.strictEqual(rules.length, 2, `Iteration ${i}: should have 2 rules`);
      assert.notStrictEqual(rules[0].id, rules[1].id, `Iteration ${i}: rules should be different`);
    }
  });
});

// ---------------------------------------------------------------------------
// AC-6: Boss random rules come from rule pool
// ---------------------------------------------------------------------------
describe('AC-6: Boss random rules from rule pool', () => {
  it('all boss rules are valid rule IDs', () => {
    const validIds = ['block_pair', 'zero_lowest', 'swap_dice', 'seal_passive', 'suppress_all'];
    const enemy = makeEnemySystem(12345);
    for (let i = 0; i < 50; i++) {
      enemy.reset();
      enemy.loadForRound(8);
      const rules = enemy.getRules();
      for (const rule of rules) {
        assert.ok(validIds.includes(rule.id), `Unknown rule ID: ${rule.id}`);
      }
    }
  });
});

// ---------------------------------------------------------------------------
// AC-7: Same seed produces same boss rules
// ---------------------------------------------------------------------------
describe('AC-7: Same seed produces same boss rules', () => {
  it('seed 42 produces identical boss rules', () => {
    const enemy1 = makeEnemySystem(42);
    const enemy2 = makeEnemySystem(42);
    enemy1.loadForRound(8);
    enemy2.loadForRound(8);
    const rules1 = enemy1.getRules();
    const rules2 = enemy2.getRules();
    assert.strictEqual(rules1.length, rules2.length);
    assert.strictEqual(rules1[0].id, rules2[0].id);
    assert.strictEqual(rules1[1].id, rules2[1].id);
  });

  it('different seeds produce different boss rules', () => {
    const enemy1 = makeEnemySystem(111);
    const enemy2 = makeEnemySystem(999);
    enemy1.loadForRound(8);
    enemy2.loadForRound(8);
    const rules1 = enemy1.getRules().map(r => r.id).sort();
    const rules2 = enemy2.getRules().map(r => r.id).sort();
    // Seeds 111 and 999 produce different rules
    assert.deepStrictEqual(rules1, ['block_pair', 'zero_lowest']);
    assert.deepStrictEqual(rules2, ['swap_dice', 'zero_lowest']);
  });
});

// ---------------------------------------------------------------------------
// AC-8: No-rule enemies work correctly
// ---------------------------------------------------------------------------
describe('AC-8: No-rule enemies work correctly', () => {
  it('round 1 enemy has all query methods return safe defaults', () => {
    const enemy = makeEnemySystem();
    enemy.loadForRound(1);
    assert.strictEqual(enemy.getRules().length, 0);
    assert.strictEqual(enemy.getBlockedCategories().length, 0);
    assert.strictEqual(enemy.hasZeroLowestRule(), false);
    assert.strictEqual(enemy.getRerollParams(), null);
    assert.strictEqual(enemy.hasSealPassiveRule(), false);
    assert.strictEqual(enemy.getDecreaseParams(), null);
  });
});

// ---------------------------------------------------------------------------
// Rule query edge cases
// ---------------------------------------------------------------------------
describe('getRuleByType', () => {
  it('returns null for non-existent effect type', () => {
    const enemy = makeEnemySystem();
    enemy.loadForRound(1);
    assert.strictEqual(enemy.getRuleByType('fake_effect'), null);
  });

  it('returns copy of rule, not reference', () => {
    const enemy = makeEnemySystem();
    enemy.loadForRound(5);
    const rule = enemy.getRuleByType('reroll_random');
    rule.params.count = 999; // modify returned copy
    const original = enemy.getRuleByType('reroll_random');
    assert.strictEqual(original.params.count, 1); // original unchanged
  });
});

describe('getRules returns copies', () => {
  it('modifying returned array does not affect internal state', () => {
    const enemy = makeEnemySystem();
    enemy.loadForRound(3);
    const rules = enemy.getRules();
    rules.push({ id: 'fake' });
    assert.strictEqual(enemy.getRules().length, 1);
  });
});

describe('reset', () => {
  it('clears current enemy', () => {
    const enemy = makeEnemySystem();
    enemy.loadForRound(3);
    assert.strictEqual(enemy.getId(), 'dealer');
    enemy.reset();
    assert.strictEqual(enemy.getId(), null);
    assert.strictEqual(enemy.getName(), '');
  });
});
