'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { Economy } = require('../src/economy');
const { DataConfig } = require('../src/data-config');

// Helpers
function makeEconomy() {
  const dataConfig = new DataConfig().loadFromObject({
    economy: {
      tokenRewards: [5, 5, 6, 6, 7, 7, 8, 9],
      shop: { itemsPerRefresh: 3, refreshCost: 1 },
      diceExpansion: { bonusRounds: [1, 2, 3], bonusWeight: 2.0 }
    },
    // Minimal required data for DataConfig
    globalConfig: { dice: { initialCount: 4, maxCount: 7, minFace: 1, maxFace: 6 } },
    scoringCategories: [],
    abilities: [],
    enemies: [],
    enemyRules: []
  });
  return new Economy({ dataConfig });
}

// ---------------------------------------------------------------------------
// AC-1: Initial balance is 0
// ---------------------------------------------------------------------------
describe('AC-1: Initial balance', () => {
  it('starts with balance 0', () => {
    const econ = makeEconomy();
    assert.strictEqual(econ.getBalance(), 0);
  });
});

// ---------------------------------------------------------------------------
// AC-2: earn adds to balance
// ---------------------------------------------------------------------------
describe('AC-2: earn adds to balance', () => {
  it('earn(5) results in balance 5', () => {
    const econ = makeEconomy();
    const newBalance = econ.earn(5);
    assert.strictEqual(newBalance, 5);
    assert.strictEqual(econ.getBalance(), 5);
  });

  it('earn can be called multiple times', () => {
    const econ = makeEconomy();
    econ.earn(5);
    econ.earn(3);
    assert.strictEqual(econ.getBalance(), 8);
  });

  it('earn(0) does not change balance', () => {
    const econ = makeEconomy();
    econ.earn(5);
    econ.earn(0);
    assert.strictEqual(econ.getBalance(), 5);
  });

  it('earn throws on negative amount', () => {
    const econ = makeEconomy();
    assert.throws(() => econ.earn(-1), /earn\(\) requires non-negative amount/);
  });
});

// ---------------------------------------------------------------------------
// AC-3: spend deducts from balance
// ---------------------------------------------------------------------------
describe('AC-3: spend deducts from balance', () => {
  it('spend(3) from balance 10 leaves 7', () => {
    const econ = makeEconomy();
    econ.earn(10);
    const ok = econ.spend(3);
    assert.strictEqual(ok, true);
    assert.strictEqual(econ.getBalance(), 7);
  });

  it('spending exact balance leaves 0', () => {
    const econ = makeEconomy();
    econ.earn(5);
    const ok = econ.spend(5);
    assert.strictEqual(ok, true);
    assert.strictEqual(econ.getBalance(), 0);
  });

  it('spend(0) succeeds with no change', () => {
    const econ = makeEconomy();
    econ.earn(5);
    const ok = econ.spend(0);
    assert.strictEqual(ok, true);
    assert.strictEqual(econ.getBalance(), 5);
  });

  it('spend throws on negative cost', () => {
    const econ = makeEconomy();
    assert.throws(() => econ.spend(-1), /spend\(\) requires non-negative cost/);
  });
});

// ---------------------------------------------------------------------------
// AC-4: spend fails when insufficient balance
// ---------------------------------------------------------------------------
describe('AC-4: spend fails when insufficient', () => {
  it('spend(3) with balance 2 returns false, balance unchanged', () => {
    const econ = makeEconomy();
    econ.earn(2);
    const ok = econ.spend(3);
    assert.strictEqual(ok, false);
    assert.strictEqual(econ.getBalance(), 2);
  });

  it('spend(1) with balance 0 returns false', () => {
    const econ = makeEconomy();
    const ok = econ.spend(1);
    assert.strictEqual(ok, false);
    assert.strictEqual(econ.getBalance(), 0);
  });
});

// ---------------------------------------------------------------------------
// AC-5: Full game cumulative tokens
// ---------------------------------------------------------------------------
describe('AC-5: Full game cumulative tokens', () => {
  it('cumulative through round 8 equals 53', () => {
    const econ = makeEconomy();
    assert.strictEqual(econ.getCumulativeReward(8), 53);
  });

  it('cumulative through round 3 equals 5+5+6=16', () => {
    const econ = makeEconomy();
    assert.strictEqual(econ.getCumulativeReward(3), 16);
  });

  it('cumulative through round 1 equals 5', () => {
    const econ = makeEconomy();
    assert.strictEqual(econ.getCumulativeReward(1), 5);
  });
});

// ---------------------------------------------------------------------------
// AC-6: canAfford
// ---------------------------------------------------------------------------
describe('AC-6: canAfford', () => {
  it('balance 5, canAfford(5) is true', () => {
    const econ = makeEconomy();
    econ.earn(5);
    assert.strictEqual(econ.canAfford(5), true);
  });

  it('balance 5, canAfford(6) is false', () => {
    const econ = makeEconomy();
    econ.earn(5);
    assert.strictEqual(econ.canAfford(6), false);
  });

  it('balance 0, canAfford(0) is true', () => {
    const econ = makeEconomy();
    assert.strictEqual(econ.canAfford(0), true);
  });
});

// ---------------------------------------------------------------------------
// AC-7: reset clears balance
// ---------------------------------------------------------------------------
describe('AC-7: reset clears balance', () => {
  it('reset after earning sets balance to 0', () => {
    const econ = makeEconomy();
    econ.earn(30);
    econ.reset();
    assert.strictEqual(econ.getBalance(), 0);
  });

  it('reset on zero balance stays zero', () => {
    const econ = makeEconomy();
    econ.reset();
    assert.strictEqual(econ.getBalance(), 0);
  });
});

// ---------------------------------------------------------------------------
// AC-8: Balance never negative
// ---------------------------------------------------------------------------
describe('AC-8: Balance never negative', () => {
  it('balance non-negative after earn', () => {
    const econ = makeEconomy();
    for (let i = 0; i < 100; i++) {
      econ.earn(Math.floor(Math.random() * 10));
      assert.ok(econ.getBalance() >= 0);
    }
  });

  it('balance non-negative after failed spend', () => {
    const econ = makeEconomy();
    econ.earn(5);
    econ.spend(10); // fails
    assert.ok(econ.getBalance() >= 0);
  });

  it('balance non-negative after successful spend', () => {
    const econ = makeEconomy();
    econ.earn(20);
    for (let i = 0; i < 10; i++) {
      econ.spend(1);
      assert.ok(econ.getBalance() >= 0);
    }
  });
});

// ---------------------------------------------------------------------------
// Convenience helpers
// ---------------------------------------------------------------------------
describe('getRewardForRound', () => {
  it('returns correct reward for each round', () => {
    const econ = makeEconomy();
    assert.strictEqual(econ.getRewardForRound(1), 5);
    assert.strictEqual(econ.getRewardForRound(2), 5);
    assert.strictEqual(econ.getRewardForRound(3), 6);
    assert.strictEqual(econ.getRewardForRound(4), 6);
    assert.strictEqual(econ.getRewardForRound(5), 7);
    assert.strictEqual(econ.getRewardForRound(6), 7);
    assert.strictEqual(econ.getRewardForRound(7), 8);
    assert.strictEqual(econ.getRewardForRound(8), 9);
  });
});

describe('getPurchasingPower', () => {
  it('balance 10, avg cost 3, can buy 3 items', () => {
    const econ = makeEconomy();
    econ.earn(10);
    assert.strictEqual(econ.getPurchasingPower(3), 3);
  });

  it('balance 10, avg cost 4, can buy 2 items', () => {
    const econ = makeEconomy();
    econ.earn(10);
    assert.strictEqual(econ.getPurchasingPower(4), 2);
  });

  it('balance 0 returns 0', () => {
    const econ = makeEconomy();
    assert.strictEqual(econ.getPurchasingPower(5), 0);
  });

  it('avg cost 0 returns Infinity', () => {
    const econ = makeEconomy();
    econ.earn(10);
    assert.strictEqual(econ.getPurchasingPower(0), Infinity);
  });

  it('avg cost negative treats as negative (still Infinity)', () => {
    const econ = makeEconomy();
    econ.earn(10);
    assert.strictEqual(econ.getPurchasingPower(-1), Infinity);
  });
});
