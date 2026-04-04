'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { DataConfig } = require('../src/data-config');
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', 'assets', 'data');

// Helper: create a config from the real data files
function loadReal() {
  return new DataConfig().load(DATA_DIR);
}

// Helper: create a config from arbitrary data (for edge case tests)
function fromObject(data) {
  return new DataConfig().loadFromObject(data);
}

// Minimal valid data set for edge case tests
function minimalData(overrides = {}) {
  return {
    globalConfig: { dice: { initialCount: 4, maxCount: 7, sides: 6 } },
    scoringCategories: [
      { id: 'bust', name: '散牌', priority: 7, minDice: 0, matchType: 'fallback', bonusType: 'flat', bonusValue: 0 },
    ],
    abilities: overrides.abilities ?? [],
    enemies: overrides.enemies ?? [],
    enemyRules: overrides.enemyRules ?? [],
    economy: { tokenRewards: [5, 5, 6, 6, 7, 7, 8, 9] },
  };
}

// ============================================================
// AC-1: All JSON files parse correctly
// ============================================================
describe('AC-1: JSON parsing', () => {
  it('loads all 6 config files without error', () => {
    const config = loadReal();
    assert.ok(config.getGlobal());
    assert.ok(config.getCategories().length > 0);
    assert.ok(config.getAbilities().length > 0);
    assert.ok(config.getEnemies().length > 0);
    assert.ok(config.getEconomy());
  });
});

// ============================================================
// AC-2: Reference integrity — enemy rules IDs all exist
// ============================================================
describe('AC-2: Reference integrity', () => {
  it('all enemy rule references are valid', () => {
    const config = loadReal();
    const errors = config.validate();
    for (const e of errors) {
      assert.ok(!e.includes('unknown rule'), `Reference error: ${e}`);
    }
  });

  it('returns empty errors for valid data', () => {
    const config = fromObject(minimalData({
      enemies: [{ id: 'test', round: 1, name: 'Test', targetScore: 5, rules: ['block_pair'] }],
      enemyRules: [{ id: 'block_pair', name: 'Block Pair', description: 'x', targetCategory: 'pair', effectType: 'block_category' }],
    }));
    const errors = config.validate();
    assert.deepEqual(errors, []);
  });

  it('reports error for missing rule reference', () => {
    const config = fromObject(minimalData({
      enemies: [{ id: 'test', round: 1, name: 'Test', targetScore: 5, rules: ['nonexistent'] }],
      enemyRules: [],
    }));
    const errors = config.validate();
    assert.ok(errors.some(e => e.includes('nonexistent')));
  });
});

// ============================================================
// AC-3: Duplicate IDs produce warning, not crash
// ============================================================
describe('AC-3: Duplicate ID handling', () => {
  it('duplicate ability IDs produce warning and last-wins', () => {
    const config = fromObject(minimalData({
      abilities: [
        { id: 'dupe', name: 'First', type: 'passive', cost: 1, effectType: 'test', params: {} },
        { id: 'dupe', name: 'Second', type: 'passive', cost: 2, effectType: 'test', params: {} },
      ],
    }));
    const warnings = config.getWarnings();
    assert.ok(warnings.some(w => w.includes('dupe')));
    // Last-wins: the second entry should be returned
    assert.equal(config.getAbility('dupe').cost, 2);
  });
});

// ============================================================
// AC-4: Unified query interface returns correct data
// ============================================================
describe('AC-4: Unified query interface', () => {
  it('get() returns nested values by dot path', () => {
    const config = loadReal();
    assert.equal(config.get('globalConfig.dice.initialCount'), 4);
    assert.equal(config.get('globalConfig.dice.maxCount'), 7);
    assert.equal(config.get('globalConfig.battle.consumablesPerRound'), 2);
  });

  it('get() returns undefined for missing paths', () => {
    const config = loadReal();
    assert.equal(config.get('nonexistent.path'), undefined);
    assert.equal(config.get('globalConfig.dice.noSuchField'), undefined);
  });

  it('getCategories() returns categories sorted by priority', () => {
    const config = loadReal();
    const cats = config.getCategories();
    assert.equal(cats[0].id, 'yahtzee'); // priority 1
    assert.equal(cats[cats.length - 1].id, 'bust'); // priority 7
  });

  it('getAbilities(type) filters correctly', () => {
    const config = loadReal();
    const consumables = config.getAbilities('consumable');
    const passives = config.getAbilities('passive');
    const expansions = config.getAbilities('dice_expansion');
    assert.equal(consumables.length, 5);
    assert.equal(passives.length, 6);
    assert.equal(expansions.length, 2);
  });

  it('getEnemy(round) returns correct enemy', () => {
    const config = loadReal();
    assert.equal(config.getEnemy(1).name, '街头混混');
    assert.equal(config.getEnemy(8).name, '千王之王');
    assert.equal(config.getEnemy(9), null);
  });

  it('getEnemyRule(id) returns correct rule', () => {
    const config = loadReal();
    assert.equal(config.getEnemyRule('block_pair').name, '封锁对子');
    assert.equal(config.getEnemyRule('nonexistent'), null);
  });
});

// ============================================================
// AC-5: Unknown fields load without error
// ============================================================
describe('AC-5: Unknown fields', () => {
  it('extra fields in data are preserved and do not cause errors', () => {
    const config = fromObject({
      globalConfig: { dice: { initialCount: 4, maxCount: 7, sides: 6, futureFeature: true } },
      scoringCategories: [{ id: 'bust', name: '散牌', priority: 7, minDice: 0, matchType: 'fallback', bonusType: 'flat', bonusValue: 0 }],
      abilities: [],
      enemies: [],
      enemyRules: [],
      economy: { tokenRewards: [5], shop: { extraSetting: 42 } },
    });
    assert.equal(config.get('globalConfig.dice.futureFeature'), true);
    assert.equal(config.get('economy.shop.extraSetting'), 42);
  });
});

// ============================================================
// AC-6: Empty config degrades gracefully
// ============================================================
describe('AC-6: Empty config graceful degradation', () => {
  it('empty abilities array does not crash', () => {
    const config = fromObject(minimalData());
    assert.deepEqual(config.getAbilities(), []);
    assert.equal(config.getAbility('anything'), null);
  });

  it('empty enemies array does not crash', () => {
    const config = fromObject(minimalData());
    assert.deepEqual(config.getEnemies(), []);
    assert.equal(config.getEnemy(1), null);
  });

  it('validate still passes with minimal data', () => {
    const config = fromObject(minimalData());
    const errors = config.validate();
    assert.deepEqual(errors, []);
  });
});

// ============================================================
// AC-7: Bust category always exists and is fallback
// ============================================================
describe('AC-7: Bust fallback category', () => {
  it('bust category exists with matchType=fallback', () => {
    const config = loadReal();
    const bust = config.getCategory('bust');
    assert.ok(bust);
    assert.equal(bust.matchType, 'fallback');
  });

  it('validation catches missing bust category', () => {
    const config = fromObject({
      globalConfig: {},
      scoringCategories: [], // no bust!
      abilities: [],
      enemies: [],
      enemyRules: [],
      economy: {},
    });
    const errors = config.validate();
    assert.ok(errors.some(e => e.includes('bust')));
  });

  it('validation catches bust with wrong matchType', () => {
    const config = fromObject({
      globalConfig: {},
      scoringCategories: [{ id: 'bust', name: '散牌', priority: 7, minDice: 0, matchType: 'same_value', bonusType: 'flat', bonusValue: 0 }],
      abilities: [],
      enemies: [],
      enemyRules: [],
      economy: {},
    });
    const errors = config.validate();
    assert.ok(errors.some(e => e.includes('fallback')));
  });
});

// ============================================================
// C30 parameter verification
// ============================================================
describe('C30 balance parameters', () => {
  const config = loadReal();

  it('initial dice count = 4', () => {
    assert.equal(config.get('globalConfig.dice.initialCount'), 4);
  });

  it('max dice count = 7', () => {
    assert.equal(config.get('globalConfig.dice.maxCount'), 7);
  });

  it('greed multiplier = 2.0', () => {
    assert.equal(config.getAbility('greed').params.multiplier, 2.0);
  });

  it('pattern master bonus = 20, includes three_of_a_kind', () => {
    const pm = config.getAbility('pattern_master');
    assert.equal(pm.params.bonus, 20);
    assert.ok(pm.params.categories.includes('three_of_a_kind'));
  });

  it('chain link perExcess = 5', () => {
    assert.equal(config.getAbility('chain_link').params.perExcess, 5);
  });

  it('enemy target scores match C30 curve', () => {
    const expected = [8, 14, 22, 35, 50, 68, 88, 110];
    for (let i = 0; i < 8; i++) {
      assert.equal(config.getEnemy(i + 1).targetScore, expected[i], `Round ${i + 1}`);
    }
  });

  it('token rewards match C30', () => {
    const expected = [5, 5, 6, 6, 7, 7, 8, 9];
    assert.deepEqual(config.get('economy.tokenRewards'), expected);
  });

  it('token rewards total = 53', () => {
    const total = config.get('economy.tokenRewards').reduce((s, v) => s + v, 0);
    assert.equal(total, 53);
  });
});
