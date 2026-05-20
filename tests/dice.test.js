'use strict';

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { DicePool } from '../src/dice.js';
import { RNG } from '../src/rng.js';

// Helpers
function makePool(seed = 42, overrides = {}) {
  const rng = new RNG(); rng.seed(seed);
  return new DicePool({
    diceStream: rng.getStream('dice'),
    cloneStream: rng.getStream('clone'),
    minFace: 1,
    maxFace: 6,
    initialCount: 4,
    maxCount: 7,
    ...overrides,
  });
}

// ---------------------------------------------------------------------------
// AC-1: Initial dice count
// ---------------------------------------------------------------------------
describe('AC-1: Initial dice pool', () => {
  it('starts with configured number of dice', () => {
    const pool = makePool();
    assert.strictEqual(pool.getTotalCount(), 4);
    assert.strictEqual(pool.getPermanentCount(), 4);
  });

  it('dice start un-rolled (value 0)', () => {
    const pool = makePool();
    assert.strictEqual(pool.isRolled(), false);
    assert.deepStrictEqual(pool.getValues(), [0, 0, 0, 0]);
  });

  it('respects custom initialCount', () => {
    const pool = makePool(42, { initialCount: 3 });
    assert.strictEqual(pool.getTotalCount(), 3);
  });
});

// ---------------------------------------------------------------------------
// AC-2: Roll produces legal values
// ---------------------------------------------------------------------------
describe('AC-2: Roll produces legal values', () => {
  it('all values in [1, 6] over 10000 rolls', () => {
    const pool = makePool(999);
    for (let i = 0; i < 10000; i++) {
      pool.roll();
      for (const v of pool.getValues()) {
        assert.ok(v >= 1 && v <= 6, `Value ${v} out of range`);
      }
    }
  });

  it('both extremes appear within 10000 rolls', () => {
    const pool = makePool(12345);
    let saw1 = false, saw6 = false;
    for (let i = 0; i < 10000; i++) {
      pool.roll();
      for (const v of pool.getValues()) {
        if (v === 1) saw1 = true;
        if (v === 6) saw6 = true;
      }
    }
    assert.ok(saw1, 'value 1 should appear');
    assert.ok(saw6, 'value 6 should appear');
  });

  it('roll sets isRolled to true', () => {
    const pool = makePool();
    pool.roll();
    assert.strictEqual(pool.isRolled(), true);
  });
});

// ---------------------------------------------------------------------------
// AC-3: setDie
// ---------------------------------------------------------------------------
describe('AC-3: setDie', () => {
  it('sets specific die to exact value', () => {
    const pool = makePool();
    pool.roll();
    pool.setDie(2, 5);
    const vals = pool.getValues();
    assert.strictEqual(vals[2], 5);
  });

  it('clamps value above maxFace', () => {
    const pool = makePool();
    pool.roll();
    pool.setDie(0, 99);
    assert.strictEqual(pool.getValues()[0], 6);
  });

  it('clamps value below minFace', () => {
    const pool = makePool();
    pool.roll();
    pool.setDie(0, -5);
    assert.strictEqual(pool.getValues()[0], 1);
  });

  it('ignores out-of-bounds index', () => {
    const pool = makePool();
    pool.roll();
    const before = pool.getValues();
    pool.setDie(100, 6);
    pool.setDie(-1, 6);
    assert.deepStrictEqual(pool.getValues(), before);
  });
});

// ---------------------------------------------------------------------------
// AC-4: rerollDie with minimum guarantee
// ---------------------------------------------------------------------------
describe('AC-4: rerollDie', () => {
  it('result always >= minValue over 100 calls', () => {
    const pool = makePool();
    pool.roll();
    for (let i = 0; i < 100; i++) {
      pool.rerollDie(0, 4);
      const v = pool.getValues()[0];
      assert.ok(v >= 4, `rerollDie result ${v} < 4`);
    }
  });
});

// ---------------------------------------------------------------------------
// AC-5: setFloor
// ---------------------------------------------------------------------------
describe('AC-5: setFloor', () => {
  it('raises all dice below floor to floor', () => {
    const pool = makePool(7);
    pool.roll();
    pool.setDie(0, 1);
    pool.setDie(1, 1);
    pool.setDie(2, 3);
    pool.setDie(3, 6);
    pool.setFloor(2);
    const vals = pool.getValues();
    for (const v of vals) {
      assert.ok(v >= 2, `Value ${v} below floor`);
    }
  });
});

// ---------------------------------------------------------------------------
// AC-6: decreaseAll
// ---------------------------------------------------------------------------
describe('AC-6: decreaseAll', () => {
  it('decreases all dice by amount', () => {
    const pool = makePool();
    // Force known values
    pool.roll();
    pool.setDie(0, 6);
    pool.setDie(1, 5);
    pool.setDie(2, 4);
    pool.setDie(3, 3);
    pool.decreaseAll(1, 1);
    assert.deepStrictEqual(pool.getValues(), [5, 4, 3, 2]);
  });

  it('does not go below floor', () => {
    const pool = makePool();
    pool.roll();
    pool.setDie(0, 1);
    pool.setDie(1, 1);
    pool.setDie(2, 1);
    pool.setDie(3, 1);
    pool.decreaseAll(1, 1);
    assert.deepStrictEqual(pool.getValues(), [1, 1, 1, 1]);
  });

  it('decreaseAll with floor 1 on all-1s stays all-1s', () => {
    const pool = makePool();
    pool.roll();
    for (let i = 0; i < 4; i++) pool.setDie(i, 1);
    pool.decreaseAll(1, 1);
    assert.deepStrictEqual(pool.getValues(), [1, 1, 1, 1]);
  });
});

// ---------------------------------------------------------------------------
// AC-7: Temp dice add & auto-remove
// ---------------------------------------------------------------------------
describe('AC-7: Temp dice', () => {
  it('addTempDie increases count by 1', () => {
    const pool = makePool();
    pool.roll();
    const before = pool.getTotalCount();
    const ok = pool.addTempDie();
    assert.strictEqual(ok, true);
    assert.strictEqual(pool.getTotalCount(), before + 1);
    // Last die is temp
    const dice = pool.getDice();
    assert.strictEqual(dice[dice.length - 1].isTemp, true);
    // Temp die has valid value
    assert.ok(dice[dice.length - 1].value >= 1 && dice[dice.length - 1].value <= 6);
  });

  it('clearTempDice removes all temp dice', () => {
    const pool = makePool();
    pool.roll();
    const permCount = pool.getPermanentCount();
    pool.addTempDie();
    pool.addTempDie();
    assert.strictEqual(pool.getTotalCount(), permCount + 2);
    pool.clearTempDice();
    assert.strictEqual(pool.getTotalCount(), permCount);
  });

  it('temp die value is in valid range', () => {
    const pool = makePool(42);
    pool.roll();
    for (let i = 0; i < 100; i++) {
      pool.clearTempDice();
      pool.addTempDie();
      const dice = pool.getDice();
      const temp = dice[dice.length - 1];
      assert.ok(temp.value >= 1 && temp.value <= 6);
    }
  });
});

// ---------------------------------------------------------------------------
// AC-8: Full pool rejects permanent add
// ---------------------------------------------------------------------------
describe('AC-8: Full pool permanent rejection', () => {
  it('addPermanentDie returns false at maxCount', () => {
    const pool = makePool(42, { initialCount: 7, maxCount: 7 });
    pool.roll();
    assert.strictEqual(pool.addPermanentDie(6), false);
    assert.strictEqual(pool.getPermanentCount(), 7);
  });
});

// ---------------------------------------------------------------------------
// AC-9: Temp die can exceed max
// ---------------------------------------------------------------------------
describe('AC-9: Temp die exceeds max', () => {
  it('addTempDie succeeds when pool is at maxCount', () => {
    const pool = makePool(42, { initialCount: 7, maxCount: 7 });
    pool.roll();
    assert.strictEqual(pool.getTotalCount(), 7);
    const ok = pool.addTempDie();
    assert.strictEqual(ok, true);
    assert.strictEqual(pool.getTotalCount(), 8);
  });

  it('addTempDie fails when already at maxCount+1', () => {
    const pool = makePool(42, { initialCount: 7, maxCount: 7 });
    pool.roll();
    pool.addTempDie();
    assert.strictEqual(pool.getTotalCount(), 8);
    const ok = pool.addTempDie();
    assert.strictEqual(ok, false);
  });
});

// ---------------------------------------------------------------------------
// AC-10: Seed reproducibility
// ---------------------------------------------------------------------------
describe('AC-10: Seed reproducibility', () => {
  it('same seed produces identical roll sequences', () => {
    const pool1 = makePool(31415);
    const pool2 = makePool(31415);
    for (let i = 0; i < 50; i++) {
      pool1.roll();
      pool2.roll();
      assert.deepStrictEqual(pool1.getValues(), pool2.getValues());
    }
  });
});

// ---------------------------------------------------------------------------
// Other operations
// ---------------------------------------------------------------------------
describe('rerollRandom', () => {
  it('rerolls exactly the specified count of dice', () => {
    const pool = makePool(42);
    pool.roll();
    // Set known values
    for (let i = 0; i < 4; i++) pool.setDie(i, i + 1);
    const before = pool.getValues();
    pool.rerollRandom(2);
    const after = pool.getValues();
    // At most 2 dice should have changed (could be same by luck)
    let changed = 0;
    for (let i = 0; i < 4; i++) {
      if (before[i] !== after[i]) changed++;
    }
    assert.ok(changed <= 2, `Too many dice changed: ${changed}`);
  });
});

describe('replaceLowest', () => {
  it('replaces the lowest die with the given value', () => {
    const pool = makePool();
    pool.roll();
    pool.setDie(0, 5);
    pool.setDie(1, 2);
    pool.setDie(2, 4);
    pool.setDie(3, 3);
    pool.replaceLowest(6);
    assert.strictEqual(pool.getValues()[1], 6);
  });

  it('replaces first lowest when tied', () => {
    const pool = makePool();
    pool.roll();
    pool.setDie(0, 1);
    pool.setDie(1, 1);
    pool.setDie(2, 3);
    pool.setDie(3, 5);
    pool.replaceLowest(6);
    assert.strictEqual(pool.getValues()[0], 6);
  });

  it('clamps replacement value', () => {
    const pool = makePool();
    pool.roll();
    pool.setDie(0, 2);
    pool.replaceLowest(99);
    assert.strictEqual(pool.getValues()[0], 6);
  });
});

describe('getDice returns copies', () => {
  it('modifying returned array does not affect pool', () => {
    const pool = makePool();
    pool.roll();
    const dice = pool.getDice();
    dice[0].value = 99;
    assert.notStrictEqual(pool.getValues()[0], 99);
  });
});

// ---------------------------------------------------------------------------
// Hold / Reroll (留骰/重掷)
// ---------------------------------------------------------------------------
describe('Hold and reroll', () => {
  it('hold marks dice as held', () => {
    const pool = makePool();
    pool.roll();
    pool.hold([0, 2]);
    assert.deepStrictEqual(pool.getHeldIndices(), [0, 2]);
  });

  it('hold ignores out-of-range indices', () => {
    const pool = makePool();
    pool.roll();
    pool.hold([-1, 99]);
    assert.deepStrictEqual(pool.getHeldIndices(), []);
  });

  it('hold ignores temp dice', () => {
    const pool = makePool();
    pool.roll();
    pool.addTempDie(); // index 4 is temp
    pool.hold([0, 4]); // index 4 should be ignored
    assert.deepStrictEqual(pool.getHeldIndices(), [0]);
  });

  it('rerollUnheld only rerolls unheld dice', () => {
    const pool = makePool(42);
    pool.roll();
    const valuesBefore = pool.getValues();
    pool.hold([1, 3]);
    pool.rerollUnheld();
    const valuesAfter = pool.getValues();
    // Held dice should not change
    assert.strictEqual(valuesAfter[1], valuesBefore[1]);
    assert.strictEqual(valuesAfter[3], valuesBefore[3]);
  });

  it('rerollUnheld produces valid values (1-6)', () => {
    const pool = makePool();
    pool.roll();
    pool.hold([0]);
    pool.rerollUnheld();
    const values = pool.getValues();
    for (const v of values) {
      assert.ok(v >= 1 && v <= 6, `value ${v} out of range`);
    }
  });

  it('clearHolds resets all held states', () => {
    const pool = makePool();
    pool.roll();
    pool.hold([0, 1, 2]);
    assert.deepStrictEqual(pool.getHeldIndices(), [0, 1, 2]);
    pool.clearHolds();
    assert.deepStrictEqual(pool.getHeldIndices(), []);
  });

  it('getHeldIndices returns empty array when nothing held', () => {
    const pool = makePool();
    pool.roll();
    assert.deepStrictEqual(pool.getHeldIndices(), []);
  });

  it('hold all dice then rerollUnheld changes nothing', () => {
    const pool = makePool(42);
    pool.roll();
    const valuesBefore = [...pool.getValues()];
    pool.hold([0, 1, 2, 3]);
    pool.rerollUnheld();
    assert.deepStrictEqual(pool.getValues(), valuesBefore);
  });

  it('hold none then rerollUnheld rerolls all', () => {
    const pool = makePool(42);
    pool.roll();
    const valuesBefore = [...pool.getValues()];
    // Use different seed to ensure different values
    const pool2 = makePool(42);
    pool2.roll();
    pool2.rerollUnheld();
    // Reroll uses next random values, so some should differ
    // (statistical: could theoretically be same but extremely unlikely for 4 dice)
    const same = pool2.getValues().every((v, i) => v === valuesBefore[i]);
    assert.ok(!same, 'rerolling all dice should produce different values');
  });
});

// ---------------------------------------------------------------------------
// copyValue (模仿)
// ---------------------------------------------------------------------------
describe('copyValue', () => {
  it('copies value from one die to another', () => {
    const pool = makePool();
    pool.roll();
    pool.setDie(0, 5);
    pool.setDie(1, 2);
    pool.copyValue(0, 1);
    assert.strictEqual(pool.getValues()[1], 5, 'target die should have source value');
    // 源骰子不变
    assert.strictEqual(pool.getValues()[0], 5, 'source die should be unchanged');
  });

  it('ignores out-of-range indices', () => {
    const pool = makePool();
    pool.roll();
    pool.setDie(0, 3);
    pool.setDie(1, 4);
    const before = [...pool.getValues()];
    pool.copyValue(-1, 0);
    pool.copyValue(0, 99);
    pool.copyValue(100, -5);
    assert.deepStrictEqual(pool.getValues(), before, 'values should not change with bad indices');
  });
});
