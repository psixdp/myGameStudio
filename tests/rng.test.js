'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { RNG, RandomStream, mulberry32, hashString } = require('../src/rng');

// ---------------------------------------------------------------------------
// AC-1: Same seed produces identical sequences
// ---------------------------------------------------------------------------
describe('RNG determinism', () => {
  it('AC-1: same seed produces identical nextInt sequence', () => {
    const rng1 = new RNG(); rng1.seed(12345);
    const rng2 = new RNG(); rng2.seed(12345);
    const s1 = rng1.getStream('dice');
    const s2 = rng2.getStream('dice');
    for (let i = 0; i < 200; i++) {
      assert.strictEqual(s1.nextInt(1, 6), s2.nextInt(1, 6));
    }
  });

  it('AC-1: same seed produces identical nextFloat sequence', () => {
    const rng1 = new RNG(); rng1.seed(99);
    const rng2 = new RNG(); rng2.seed(99);
    const s1 = rng1.getStream('dice');
    const s2 = rng2.getStream('dice');
    for (let i = 0; i < 200; i++) {
      assert.strictEqual(s1.nextFloat(), s2.nextFloat());
    }
  });

  it('AC-1: different seeds produce different sequences', () => {
    const rng1 = new RNG(); rng1.seed(1);
    const rng2 = new RNG(); rng2.seed(2);
    const s1 = rng1.getStream('dice');
    const s2 = rng2.getStream('dice');
    let diff = 0;
    for (let i = 0; i < 100; i++) {
      if (s1.nextInt(1, 1000) !== s2.nextInt(1, 1000)) diff++;
    }
    assert.ok(diff > 90, 'Different seeds should produce mostly different values');
  });
});

// ---------------------------------------------------------------------------
// AC-2: Independent streams don't interfere
// ---------------------------------------------------------------------------
describe('Stream independence', () => {
  it('AC-2: dice stream calls do not affect shop stream output', () => {
    const rng = new RNG(); rng.seed(42);

    // Snapshot shop stream before consuming dice stream
    const shopBefore = [];
    const shopA = rng.getStream('shop');
    for (let i = 0; i < 20; i++) shopBefore.push(shopA.nextInt(1, 100));

    // Consume dice stream heavily
    const dice = rng.getStream('dice');
    for (let i = 0; i < 100; i++) dice.nextInt(1, 6);

    // Snapshot shop stream again (new RNG same seed)
    const rng2 = new RNG(); rng2.seed(42);
    const shopB = rng2.getStream('shop');
    const shopAfter = [];
    for (let i = 0; i < 20; i++) shopAfter.push(shopB.nextInt(1, 100));

    assert.deepStrictEqual(shopBefore, shopAfter);
  });

  it('AC-2: multiple streams from same seed are all different', () => {
    const rng = new RNG(); rng.seed(77);
    const streams = ['dice', 'shop', 'enemy', 'clone'].map(n => rng.getStream(n));
    const vals = streams.map(s => s.nextInt(1, 1000000));
    const unique = new Set(vals);
    assert.strictEqual(unique.size, 4, 'Each stream should produce different values');
  });
});

// ---------------------------------------------------------------------------
// AC-3: nextInt range correctness
// ---------------------------------------------------------------------------
describe('nextInt range', () => {
  it('AC-3: both min and max appear in 10000 calls', () => {
    const rng = new RNG(); rng.seed(31415);
    const s = rng.getStream('dice');
    let sawMin = false, sawMax = false;
    for (let i = 0; i < 10000; i++) {
      const v = s.nextInt(1, 6);
      assert.ok(v >= 1 && v <= 6, `Value ${v} out of range`);
      if (v === 1) sawMin = true;
      if (v === 6) sawMax = true;
    }
    assert.ok(sawMin, 'min value 1 should appear');
    assert.ok(sawMax, 'max value 6 should appear');
  });

  it('nextInt swaps when min > max', () => {
    const s = new RandomStream(999);
    const v = s.nextInt(10, 1);
    assert.ok(v >= 1 && v <= 10, 'Should still produce valid range');
  });

  it('nextInt(min, min) always returns min', () => {
    const s = new RandomStream(1234);
    for (let i = 0; i < 50; i++) {
      assert.strictEqual(s.nextInt(5, 5), 5);
    }
  });
});

// ---------------------------------------------------------------------------
// AC-4: weightedPick distribution
// ---------------------------------------------------------------------------
describe('weightedPick', () => {
  it('AC-4: distribution matches weights over 10000 calls', () => {
    const rng = new RNG(); rng.seed(2718);
    const s = rng.getStream('test');
    const items = [
      { name: 'a', w: 10 },
      { name: 'b', w: 30 },
      { name: 'c', w: 60 },
    ];
    const counts = { a: 0, b: 0, c: 0 };
    for (let i = 0; i < 10000; i++) {
      counts[s.weightedPick(items, 'w').name]++;
    }
    // Allow 30% tolerance on each proportion
    assert.ok(Math.abs(counts.a / 10000 - 0.10) < 0.03, `a: ${counts.a / 10000}`);
    assert.ok(Math.abs(counts.b / 10000 - 0.30) < 0.05, `b: ${counts.b / 10000}`);
    assert.ok(Math.abs(counts.c / 10000 - 0.60) < 0.05, `c: ${counts.c / 10000}`);
  });

  it('weightedPick with all-zero weights falls back to uniform', () => {
    const s = new RandomStream(555);
    const items = [{ name: 'x', w: 0 }, { name: 'y', w: 0 }];
    let saw = new Set();
    for (let i = 0; i < 100; i++) saw.add(s.weightedPick(items, 'w').name);
    assert.ok(saw.has('x') && saw.has('y'), 'Both items should appear');
  });

  it('weightedPick with empty array returns null', () => {
    const s = new RandomStream(111);
    assert.strictEqual(s.weightedPick([], 'w'), null);
  });
});

// ---------------------------------------------------------------------------
// AC-5: Uninitialized throws
// ---------------------------------------------------------------------------
describe('Uninitialized error', () => {
  it('AC-5: getStream throws before seed()', () => {
    const rng = new RNG();
    assert.throws(() => rng.getStream('dice'), /RNG not seeded/);
  });

  it('isSeeded returns false before seed', () => {
    const rng = new RNG();
    assert.strictEqual(rng.isSeeded(), false);
  });

  it('isSeeded returns true after seed', () => {
    const rng = new RNG(); rng.seed(1);
    assert.strictEqual(rng.isSeeded(), true);
  });
});

// ---------------------------------------------------------------------------
// AC-6: New stream names work without changes
// ---------------------------------------------------------------------------
describe('Extensibility', () => {
  it('AC-6: getStream with arbitrary name works', () => {
    const rng = new RNG(); rng.seed(42);
    const s = rng.getStream('totally_new_stream');
    const v = s.nextInt(1, 100);
    assert.ok(v >= 1 && v <= 100);
  });

  it('AC-6: same new stream name returns same stream', () => {
    const rng = new RNG(); rng.seed(42);
    const s1 = rng.getStream('custom');
    const s2 = rng.getStream('custom');
    assert.strictEqual(s1, s2, 'Same name should return same stream instance');
  });
});

// ---------------------------------------------------------------------------
// Edge cases
// ---------------------------------------------------------------------------
describe('Edge cases', () => {
  it('seed 0 normalizes to positive', () => {
    const rng = new RNG(); rng.seed(0);
    assert.ok(rng.getMainSeed() > 0);
    const s = rng.getStream('dice');
    assert.ok(Number.isInteger(s.nextInt(1, 6)));
  });

  it('negative seed normalizes to positive', () => {
    const rng = new RNG(); rng.seed(-42);
    assert.ok(rng.getMainSeed() > 0);
  });

  it('pick from empty array returns null', () => {
    const s = new RandomStream(1);
    assert.strictEqual(s.pick([]), null);
  });

  it('pick from non-array returns null', () => {
    const s = new RandomStream(1);
    assert.strictEqual(s.pick(null), null);
  });

  it('shuffle returns new array, does not mutate', () => {
    const s = new RandomStream(42);
    const orig = [1, 2, 3, 4, 5];
    const shuffled = s.shuffle(orig);
    assert.deepStrictEqual(orig, [1, 2, 3, 4, 5], 'Original must not change');
    assert.strictEqual(shuffled.length, 5);
    assert.deepStrictEqual(shuffled.slice().sort(), [1, 2, 3, 4, 5]);
  });

  it('nextFloat is always in [0, 1)', () => {
    const s = new RandomStream(12345);
    for (let i = 0; i < 10000; i++) {
      const f = s.nextFloat();
      assert.ok(f >= 0 && f < 1, `Float ${f} out of range`);
    }
  });

  it('re-seeding resets all streams', () => {
    const rng = new RNG();
    rng.seed(10);
    const first = rng.getStream('dice').nextInt(1, 100);
    rng.seed(10);
    const second = rng.getStream('dice').nextInt(1, 100);
    assert.strictEqual(first, second, 'Re-seeding should reset streams');
  });
});

// ---------------------------------------------------------------------------
// mulberry32 & hashString internals
// ---------------------------------------------------------------------------
describe('Internal helpers', () => {
  it('mulberry32 produces values in [0, 2^32)', () => {
    const next = mulberry32(42);
    for (let i = 0; i < 1000; i++) {
      const v = next();
      assert.ok(Number.isInteger(v));
      assert.ok(v >= 0 && v < 4294967296);
    }
  });

  it('hashString produces different values for different strings', () => {
    const h1 = hashString('dice');
    const h2 = hashString('shop');
    assert.notStrictEqual(h1, h2);
  });

  it('hashString is deterministic', () => {
    assert.strictEqual(hashString('test'), hashString('test'));
  });
});
