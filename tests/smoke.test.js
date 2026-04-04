'use strict';

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { RNG } from '../src/rng.js';
import { DicePool } from '../src/dice.js';
import { ScoringEngine } from '../src/scoring.js';
import { DataConfig } from '../src/data-config.js';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DATA_DIR = path.join(__dirname, '..', 'assets', 'data');
const config = new DataConfig();
await config.load(DATA_DIR);
const categories = config.getCategories();
const globalCfg = config.getGlobal();

// ---------------------------------------------------------------------------
// Helper: full roll → score pipeline
// ---------------------------------------------------------------------------

function rollAndScore(rng, opts = {}) {
  const { passiveList, blockedCats, enemyRuleList } = opts;

  const pool = new DicePool({
    diceStream: rng.getStream('dice'),
    cloneStream: rng.getStream('clone'),
    minFace: globalCfg.dice.minValue,
    maxFace: globalCfg.dice.maxValue,
    initialCount: globalCfg.dice.initialCount,
    maxCount: globalCfg.dice.maxCount,
  });

  pool.roll();
  const diceValues = pool.getValues();

  const result = ScoringEngine.score({
    diceValues,
    categories,
    blockedCategories: blockedCats || [],
    passives: passiveList || [],
    enemyRules: enemyRuleList || [],
  });

  return { diceValues, result, pool };
}

// ---------------------------------------------------------------------------
// Basic pipeline: 100 random rolls
// ---------------------------------------------------------------------------

describe('Smoke: 100 random rolls → score', () => {
  it('all produce valid non-negative scores with categories', () => {
    const rng = new RNG();
    rng.seed(42);

    for (let i = 0; i < 100; i++) {
      const { diceValues, result } = rollAndScore(rng);

      assert.ok(result.category, `Roll ${i}: no category`);
      assert.ok(result.finalScore >= 0, `Roll ${i}: score ${result.finalScore} < 0`);
      assert.strictEqual(diceValues.length, globalCfg.dice.initialCount, `Roll ${i}: wrong dice count`);
    }
  });

  it('same seed produces identical results', () => {
    function run100(seed) {
      const rng = new RNG(); rng.seed(seed);
      const scores = [];
      for (let i = 0; i < 100; i++) {
        const { result } = rollAndScore(rng);
        scores.push({ cat: result.category.id, score: result.finalScore });
      }
      return scores;
    }
    assert.deepStrictEqual(run100(12345), run100(12345));
  });
});

// ---------------------------------------------------------------------------
// Pipeline with passives
// ---------------------------------------------------------------------------

describe('Smoke: rolls with passive abilities', () => {
  it('greed doubles all scores', () => {
    const rng1 = new RNG(); rng1.seed(99);
    const rng2 = new RNG(); rng2.seed(99);

    for (let i = 0; i < 50; i++) {
      const bare = rollAndScore(rng1).result;
      const boosted = rollAndScore(rng2, {
        passiveList: [{ id: 'greed', bonusType: 'multiplier', bonusValue: 2.0 }],
      }).result;

      // Same category, doubled score (approximately — floor rounding)
      assert.strictEqual(bare.category.id, boosted.category.id, `Roll ${i}: category changed`);
      const expected = Math.floor(bare.finalScore * 2.0);
      assert.strictEqual(boosted.finalScore, expected, `Roll ${i}: ${bare.finalScore}×2 ≠ ${boosted.finalScore}`);
    }
  });

  it('pattern_master adds 20 to yahtzee/three_of_a_kind/full_house', () => {
    const rng = new RNG(); rng.seed(777);
    let sawRelevant = false;

    for (let i = 0; i < 200; i++) {
      const { result } = rollAndScore(rng, {
        passiveList: [{
          id: 'pattern_master', bonusType: 'flat', bonusValue: 20,
          categories: ['yahtzee', 'three_of_a_kind', 'full_house'],
        }],
      });

      if (['yahtzee', 'three_of_a_kind', 'full_house'].includes(result.category.id)) {
        sawRelevant = true;
        assert.ok(result.breakdown.flatBonusTotal >= 20,
          `Roll ${i}: pattern_master should add 20, got ${result.breakdown.flatBonusTotal}`);
      }
    }
    assert.ok(sawRelevant, 'Should see at least one yahtzee/three/full_house in 200 rolls');
  });
});

// ---------------------------------------------------------------------------
// Pipeline with enemy rules
// ---------------------------------------------------------------------------

describe('Smoke: rolls with enemy rules', () => {
  it('lowest_zero reduces scores for non-bust categories', () => {
    const rng1 = new RNG(); rng1.seed(555);
    const rng2 = new RNG(); rng2.seed(555);

    let reduced = 0;
    for (let i = 0; i < 100; i++) {
      const normal = rollAndScore(rng1).result;
      const modified = rollAndScore(rng2, {
        enemyRuleList: [{ id: 'lowest_zero' }],
      }).result;

      // Same category (matching uses raw values), but score should be ≤
      assert.strictEqual(normal.category.id, modified.category.id);
      if (modified.finalScore < normal.finalScore) reduced++;
    }
    assert.ok(reduced > 50, `Expected many reductions, got ${reduced}`);
  });

  it('blocked pair forces pair-hands to bust or higher', () => {
    const rng = new RNG(); rng.seed(333);

    for (let i = 0; i < 100; i++) {
      const { result } = rollAndScore(rng, {
        blockedCats: ['pair'],
      });
      assert.notStrictEqual(result.category.id, 'pair', `Roll ${i}: pair should be blocked`);
    }
  });
});

// ---------------------------------------------------------------------------
// Pipeline with dice pool changes
// ---------------------------------------------------------------------------

describe('Smoke: variable dice counts', () => {
  it('5 dice produce valid scores', () => {
    const rng = new RNG(); rng.seed(111);
    for (let i = 0; i < 50; i++) {
      const pool = new DicePool({
        diceStream: rng.getStream('dice'),
        cloneStream: rng.getStream('clone'),
        minFace: 1, maxFace: 6, initialCount: 5, maxCount: 7,
      });
      pool.roll();
      const result = ScoringEngine.score({
        diceValues: pool.getValues(), categories,
        blockedCategories: [], passives: [], enemyRules: [],
      });
      assert.ok(result.finalScore >= 0);
      assert.ok(result.category);
    }
  });

  it('7 dice produce valid scores', () => {
    const rng = new RNG(); rng.seed(222);
    for (let i = 0; i < 50; i++) {
      const pool = new DicePool({
        diceStream: rng.getStream('dice'),
        cloneStream: rng.getStream('clone'),
        minFace: 1, maxFace: 6, initialCount: 7, maxCount: 7,
      });
      pool.roll();
      const result = ScoringEngine.score({
        diceValues: pool.getValues(), categories,
        blockedCategories: [], passives: [], enemyRules: [],
      });
      assert.ok(result.finalScore >= 0);
      assert.ok(result.category);
    }
  });

  it('temp die (分身术) integrates with scoring', () => {
    const rng = new RNG(); rng.seed(444);
    for (let i = 0; i < 50; i++) {
      const pool = new DicePool({
        diceStream: rng.getStream('dice'),
        cloneStream: rng.getStream('clone'),
        minFace: 1, maxFace: 6, initialCount: 4, maxCount: 7,
      });
      pool.roll();
      const added = pool.addTempDie();
      assert.strictEqual(added, true);
      assert.strictEqual(pool.getTotalCount(), 5);

      const result = ScoringEngine.score({
        diceValues: pool.getValues(), categories,
        blockedCategories: [], passives: [], enemyRules: [],
      });
      assert.ok(result.finalScore >= 0);
      assert.strictEqual(result.breakdown.diceSum > 0, true, '5 dice should have positive sum');

      pool.clearTempDice();
      assert.strictEqual(pool.getTotalCount(), 4);
    }
  });
});

// ---------------------------------------------------------------------------
// C30 balance sanity: target scores achievable
// ---------------------------------------------------------------------------

describe('Smoke: C30 balance sanity', () => {
  it('R1 target 8 is reachable (100 rolls, bare)', () => {
    const rng = new RNG(); rng.seed(1001);
    let reached = 0;
    for (let i = 0; i < 100; i++) {
      const { result } = rollAndScore(rng);
      if (result.finalScore >= 8) reached++;
    }
    assert.ok(reached > 50, `Only ${reached}/100 bare rolls reached R1 target 8`);
  });

  it('R1 target 8 easily reachable with greed', () => {
    const rng = new RNG(); rng.seed(2002);
    let reached = 0;
    for (let i = 0; i < 100; i++) {
      const { result } = rollAndScore(rng, {
        passiveList: [{ id: 'greed', bonusType: 'multiplier', bonusValue: 2.0 }],
      });
      if (result.finalScore >= 8) reached++;
    }
    assert.ok(reached > 80, `Only ${reached}/100 greed rolls reached R1 target 8`);
  });
});
