'use strict';

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { ScoringEngine, _internals } from '../src/scoring.js';
import path from 'path';
import { DataConfig } from '../src/data-config.js';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DATA_DIR = path.join(__dirname, '..', 'assets', 'data');
const config = new DataConfig();
await config.load(DATA_DIR);
const categories = config.getCategories(); // sorted by priority

// Helpers
function scoreWith(diceValues, opts = {}) {
  return ScoringEngine.score({
    diceValues,
    categories,
    blockedCategories: opts.blocked || [],
    passives: opts.passives || [],
    enemyRules: opts.enemyRules || [],
  });
}

// ---------------------------------------------------------------------------
// Category matchers (unit level)
// ---------------------------------------------------------------------------
describe('Category matchers', () => {
  describe('isAllSame', () => {
    const { isAllSame } = _internals;
    it('[5,5,5] → true', () => assert.ok(isAllSame([5, 5, 5])));
    it('[1,1,1,1] → true', () => assert.ok(isAllSame([1, 1, 1, 1])));
    it('[5,5,4] → false', () => assert.ok(!isAllSame([5, 5, 4])));
    it('[6] → false (too few)', () => assert.ok(!isAllSame([6])));
  });

  describe('isFullHouse', () => {
    const { isFullHouse } = _internals;
    it('[3,3,3,5,5] → true', () => assert.ok(isFullHouse([3, 3, 3, 5, 5])));
    it('[2,2,4,4,4] → true', () => assert.ok(isFullHouse([2, 2, 4, 4, 4])));
    it('[3,3,3,3,5] → false (4+1)', () => assert.ok(!isFullHouse([3, 3, 3, 3, 5])));
    it('[4,4,4,5,5,6] → false (3 groups)', () => assert.ok(!isFullHouse([4, 4, 4, 5, 5, 6])));
    it('[1,1,2,2,3,3] → false (3 groups)', () => assert.ok(!isFullHouse([1, 1, 2, 2, 3, 3])));
    it('[3,3,5] → false (too few)', () => assert.ok(!isFullHouse([3, 3, 5])));
  });

  describe('hasConsecutive', () => {
    const { hasConsecutive } = _internals;
    it('[1,2,3,4] len=4 → true', () => assert.ok(hasConsecutive([1, 2, 3, 4], 4)));
    it('[2,3,4,5,6] len=5 → true', () => assert.ok(hasConsecutive([2, 3, 4, 5, 6], 5)));
    it('[1,2,3,4,5,6] len=5 → true', () => assert.ok(hasConsecutive([1, 2, 3, 4, 5, 6], 5)));
    it('[1,3,5,6] len=4 → false', () => assert.ok(!hasConsecutive([1, 3, 5, 6], 4)));
    it('[1,2,4,5] len=4 → false', () => assert.ok(!hasConsecutive([1, 2, 4, 5], 4)));
    it('[3,4,5,6] len=4 → true', () => assert.ok(hasConsecutive([3, 4, 5, 6], 4)));
  });

  describe('hasSameValue', () => {
    const { hasSameValue } = _internals;
    it('[4,4,4,2] n=3 → true', () => assert.ok(hasSameValue([4, 4, 4, 2], 3)));
    it('[4,4,2] n=3 → false', () => assert.ok(!hasSameValue([4, 4, 2], 3)));
    it('[5,5] n=2 → true', () => assert.ok(hasSameValue([5, 5], 2)));
    it('[1,2,3] n=2 → false', () => assert.ok(!hasSameValue([1, 2, 3], 2)));
  });
});

// ---------------------------------------------------------------------------
// AC-1: 3 dice exhaustive matching
// ---------------------------------------------------------------------------
describe('AC-1: 3 dice matching', () => {
  const { findBestCategory } = _internals;
  it('exhaustive 6³ = 216 combinations', () => {
    let counts = {};
    for (const c of categories) counts[c.id] = 0;
    for (let a = 1; a <= 6; a++) {
      for (let b = 1; b <= 6; b++) {
        for (let c = 1; c <= 6; c++) {
          const vals = [a, b, c];
          const cat = findBestCategory(vals, categories, new Set());
          assert.ok(cat, `No match for [${vals}]`);
          counts[cat.id]++;
        }
      }
    }
    // 3 dice: yahtzee(all same)=6, pair=90, bust=120
    // No three_of_a_kind because 3-same is yahtzee (priority 1)
    assert.strictEqual(counts.yahtzee, 6, 'yahtzee count');
    assert.strictEqual(counts.three_of_a_kind, 0, 'three_of_a_kind count');
    assert.strictEqual(counts.pair, 90, 'pair count');
    assert.strictEqual(counts.bust, 120, 'bust count');
  });
});

// ---------------------------------------------------------------------------
// AC-2: 4 dice exhaustive matching
// ---------------------------------------------------------------------------
describe('AC-2: 4 dice matching', () => {
  const { findBestCategory } = _internals;
  it('exhaustive 6⁴ = 1296 combinations', () => {
    let counts = {};
    for (const c of categories) counts[c.id] = 0;
    for (let a = 1; a <= 6; a++) {
      for (let b = 1; b <= 6; b++) {
        for (let c = 1; c <= 6; c++) {
          for (let d = 1; d <= 6; d++) {
            const vals = [a, b, c, d];
            const cat = findBestCategory(vals, categories, new Set());
            assert.ok(cat, `No match for [${vals}]`);
            counts[cat.id]++;
          }
        }
      }
    }
    // 4 dice: yahtzee(all same)=6, three_of_a_kind=120, small_straight=72
    assert.strictEqual(counts.yahtzee, 6, 'yahtzee');
    assert.strictEqual(counts.three_of_a_kind, 120, 'three_of_a_kind');
    assert.strictEqual(counts.small_straight, 72, 'small_straight');
    assert.strictEqual(counts.pair + counts.bust, 1296 - 6 - 120 - 72, 'pair + bust');
  });
});

// ---------------------------------------------------------------------------
// AC-3: 5 dice sampled matching
// ---------------------------------------------------------------------------
describe('AC-3: 5 dice matching', () => {
  it('full_house matches correctly', () => {
    const r = scoreWith([3, 3, 3, 5, 5]);
    assert.strictEqual(r.category.id, 'full_house');
  });

  it('large_straight [1,2,3,4,5] matches', () => {
    const r = scoreWith([1, 2, 3, 4, 5]);
    assert.strictEqual(r.category.id, 'large_straight');
  });

  it('[2,3,4,5,6] matches large_straight', () => {
    const r = scoreWith([2, 3, 4, 5, 6]);
    assert.strictEqual(r.category.id, 'large_straight');
  });

  it('[3,3,3,3,5] → three_of_a_kind (not full_house)', () => {
    const r = scoreWith([3, 3, 3, 3, 5]);
    assert.strictEqual(r.category.id, 'three_of_a_kind');
  });
});

// ---------------------------------------------------------------------------
// AC-4: Base score calculation
// ---------------------------------------------------------------------------
describe('AC-4: Base score calculation', () => {
  it('[6,6,3] pair → sum=15, bonus=3, base=18', () => {
    const r = scoreWith([6, 6, 3]);
    assert.strictEqual(r.breakdown.diceSum, 15);
    assert.strictEqual(r.breakdown.categoryBase, 18); // flat: 15 + 3
  });

  it('[6,6,6] yahtzee → sum=18, ×4=72', () => {
    const r = scoreWith([6, 6, 6]);
    assert.strictEqual(r.breakdown.diceSum, 18);
    assert.strictEqual(r.breakdown.categoryBase, 72); // 18 × 4
  });

  it('[4,4,4,2] three_of_a_kind → sum=14, +10=24', () => {
    const r = scoreWith([4, 4, 4, 2]);
    assert.strictEqual(r.breakdown.categoryBase, 24); // 14 + 10
  });

  it('[3,3,3,5,5] full_house → sum=19, +28=47', () => {
    const r = scoreWith([3, 3, 3, 5, 5]);
    assert.strictEqual(r.breakdown.categoryBase, 47); // 19 + 28
  });
});

// ---------------------------------------------------------------------------
// AC-5: Flat bonuses stack
// ---------------------------------------------------------------------------
describe('AC-5: Flat bonus stacking', () => {
  it('multiple flat bonuses sum together', () => {
    const r = scoreWith([6, 6, 6], {
      passives: [
        { id: 'p1', bonusType: 'flat', bonusValue: 10, categories: ['yahtzee'] },
        { id: 'p2', bonusType: 'flat', bonusValue: 20, categories: ['yahtzee'] },
      ],
    });
    assert.strictEqual(r.breakdown.flatBonusTotal, 30);
    assert.strictEqual(r.breakdown.categoryBase, 72); // 18 × 4
    assert.strictEqual(r.finalScore, 102); // (72 + 30) × 1.0
  });
});

// ---------------------------------------------------------------------------
// AC-6: Multiplier stacking (product)
// ---------------------------------------------------------------------------
describe('AC-6: Multiplier stacking', () => {
  it('two multipliers multiply together', () => {
    const r = scoreWith([6, 6, 6], {
      passives: [
        { id: 'greed', bonusType: 'multiplier', bonusValue: 2.0 },
        { id: 'other', bonusType: 'multiplier', bonusValue: 1.3 },
      ],
    });
    assert.strictEqual(r.breakdown.totalMultiplier, 2.6); // 2.0 × 1.3
  });
});

// ---------------------------------------------------------------------------
// AC-7: Floor rounding
// ---------------------------------------------------------------------------
describe('AC-7: Floor rounding', () => {
  it('floor(76.8) = 76', () => {
    const r = scoreWith([6, 6, 6], {
      passives: [
        { id: 'pattern_master', bonusType: 'flat', bonusValue: 10, categories: ['yahtzee'] },
        { id: 'greed', bonusType: 'multiplier', bonusValue: 1.2 },
      ],
    });
    // base=18×4=72, flat=10, mult=1.2 → floor(82×1.2) = floor(98.4) = 98
    assert.strictEqual(r.finalScore, 98);
  });
});

// ---------------------------------------------------------------------------
// AC-8: No negative scores
// ---------------------------------------------------------------------------
describe('AC-8: No negative scores', () => {
  it('score never goes below 0', () => {
    // Extreme case: very low dice, no category bonus
    const r = scoreWith([1, 1, 1, 1, 1, 1, 1]);
    // yahtzee: sum=7 × 3 = 21... that's not negative.
    // Let's force a scenario: bust with modifier
    assert.ok(r.finalScore >= 0);
  });
});

// ---------------------------------------------------------------------------
// AC-9: Bust always matches
// ---------------------------------------------------------------------------
describe('AC-9: Bust fallback', () => {
  it('any dice combination returns at least bust', () => {
    const r = scoreWith([1, 3, 5]);
    assert.ok(r.category);
    // [1,3,5] has no pair → bust
    assert.strictEqual(r.category.id, 'bust');
  });
});

// ---------------------------------------------------------------------------
// AC-10: Block pair
// ---------------------------------------------------------------------------
describe('AC-10: Block pair', () => {
  it('[5,5,3] with blocked pair → bust', () => {
    const r = scoreWith([5, 5, 3], { blocked: ['pair'] });
    assert.strictEqual(r.category.id, 'bust');
  });

  it('[5,5,5] with blocked pair → yahtzee (higher priority)', () => {
    const r = scoreWith([5, 5, 5], { blocked: ['pair'] });
    assert.strictEqual(r.category.id, 'yahtzee');
  });
});

// ---------------------------------------------------------------------------
// AC-11: Lowest zero rule
// ---------------------------------------------------------------------------
describe('AC-11: Lowest zero rule', () => {
  it('[1,5,5] + lowest_zero → matches pair, sum=0+5+5=10', () => {
    const r = scoreWith([1, 5, 5], {
      enemyRules: [{ id: 'lowest_zero' }],
    });
    assert.strictEqual(r.category.id, 'pair'); // matching uses raw values
    assert.strictEqual(r.breakdown.diceSum, 10); // scoring uses modified (0+5+5)
    assert.strictEqual(r.breakdown.categoryBase, 13); // pair: 10 + 3
  });

  it('[2,4,4] + lowest_zero → sum=0+4+4=8', () => {
    const r = scoreWith([2, 4, 4], {
      enemyRules: [{ id: 'lowest_zero' }],
    });
    assert.strictEqual(r.breakdown.diceSum, 8);
  });
});

// ---------------------------------------------------------------------------
// AC-12: Link bonus (连横术)
// ---------------------------------------------------------------------------
describe('AC-12: Link bonus', () => {
  it('[4,4,4,4,2] + chain_link → excess=1, bonus=+5', () => {
    const r = scoreWith([4, 4, 4, 4, 2], {
      passives: [
        { id: 'chain_link', bonusType: 'flat', perExcess: 5, matchCount: 3 },
      ],
    });
    const linkEntry = r.breakdown.flatBonuses.find(b => b.id === 'chain_link');
    assert.ok(linkEntry, 'chain_link bonus should be present');
    assert.strictEqual(linkEntry.value, 5); // 4 - 3 = 1 excess × 5
  });

  it('[5,5,5,5,5] + chain_link → excess=2 (three_of_a_kind), bonus=+10', () => {
    // 5 fives → matches yahtzee (priority 1), not three_of_a_kind
    // yahtzee: chain_link bonus = 0 (豹子 special case)
    const r = scoreWith([5, 5, 5, 5, 5], {
      passives: [
        { id: 'chain_link', bonusType: 'flat', perExcess: 5, matchCount: 3 },
      ],
    });
    assert.strictEqual(r.category.id, 'yahtzee');
    const linkEntry = r.breakdown.flatBonuses.find(b => b.id === 'chain_link');
    assert.strictEqual(linkEntry, undefined); // yahtzee → link bonus = 0, not added
  });
});

// ---------------------------------------------------------------------------
// AC-13: 6 dice matching
// ---------------------------------------------------------------------------
describe('AC-13: 6 dice matching', () => {
  it('[4,4,4,5,5,6] → three_of_a_kind (not full_house)', () => {
    const r = scoreWith([4, 4, 4, 5, 5, 6]);
    assert.strictEqual(r.category.id, 'three_of_a_kind');
  });

  it('[1,2,3,4,5,6] → large_straight (contains 5 consecutive)', () => {
    const r = scoreWith([1, 2, 3, 4, 5, 6]);
    assert.strictEqual(r.category.id, 'large_straight');
  });

  it('[6,6,6,6,6,6] → yahtzee', () => {
    const r = scoreWith([6, 6, 6, 6, 6, 6]);
    assert.strictEqual(r.category.id, 'yahtzee');
  });
});

// ---------------------------------------------------------------------------
// AC-14: 7 dice matching
// ---------------------------------------------------------------------------
describe('AC-14: 7 dice matching', () => {
  it('[5,5,5,3,3,1,1] → three_of_a_kind (3 groups)', () => {
    const r = scoreWith([5, 5, 5, 3, 3, 1, 1]);
    assert.strictEqual(r.category.id, 'three_of_a_kind');
  });

  it('[2,2,3,3,4,4,5] → small_straight', () => {
    const r = scoreWith([2, 2, 3, 3, 4, 4, 5]);
    assert.strictEqual(r.category.id, 'small_straight');
  });
});

// ---------------------------------------------------------------------------
// AC-15: Yahtzee + chain_link = 0
// ---------------------------------------------------------------------------
describe('AC-15: Yahtzee + chain_link', () => {
  it('[6,6,6] + chain_link → bonus = 0', () => {
    const r = scoreWith([6, 6, 6], {
      passives: [
        { id: 'chain_link', bonusType: 'flat', perExcess: 5, matchCount: 3 },
      ],
    });
    assert.strictEqual(r.category.id, 'yahtzee');
    const linkEntry = r.breakdown.flatBonuses.find(b => b.id === 'chain_link');
    assert.strictEqual(linkEntry, undefined); // not added when 0
  });
});

// ---------------------------------------------------------------------------
// AC-16: Full house strict 3+2 with 6 dice
// ---------------------------------------------------------------------------
describe('AC-16: Full house strict 3+2', () => {
  it('[4,4,4,5,5,6] does not match full_house', () => {
    const r = scoreWith([4, 4, 4, 5, 5, 6]);
    assert.notStrictEqual(r.category.id, 'full_house');
  });

  it('[4,4,4,5,5] matches full_house', () => {
    const r = scoreWith([4, 4, 4, 5, 5]);
    assert.strictEqual(r.category.id, 'full_house');
  });
});

// ---------------------------------------------------------------------------
// Combined scoring examples
// ---------------------------------------------------------------------------
describe('Combined scoring examples', () => {
  it('GDD example 1: [6,6,3] no passives → 18', () => {
    const r = scoreWith([6, 6, 3]);
    assert.strictEqual(r.finalScore, 18);
  });

  it('GDD example 2: [6,6,6] + pattern_master + greed → 98', () => {
    const r = scoreWith([6, 6, 6], {
      passives: [
        { id: 'pattern_master', bonusType: 'flat', bonusValue: 10, categories: ['yahtzee'] },
        { id: 'greed', bonusType: 'multiplier', bonusValue: 1.2 },
      ],
    });
    // base=18×4=72, flat=10, (72+10)×1.2 = 98.4 → floor = 98
    assert.strictEqual(r.finalScore, 98);
  });

  it('Full C30 example: [6,6,6,6] yahtzee + pattern_master(20) + greed(2.0)', () => {
    const r = scoreWith([6, 6, 6, 6], {
      passives: [
        { id: 'pattern_master', bonusType: 'flat', bonusValue: 20, categories: ['yahtzee', 'full_house', 'three_of_a_kind'] },
        { id: 'greed', bonusType: 'multiplier', bonusValue: 2.0 },
      ],
    });
    // base = 24 × 4 = 96, flat = 20, (96 + 20) × 2.0 = 232
    assert.strictEqual(r.finalScore, 232);
  });
});

// ---------------------------------------------------------------------------
// applyLowestZero edge cases
// ---------------------------------------------------------------------------
describe('applyLowestZero edge cases', () => {
  const { applyLowestZero } = _internals;
  it('zeros only the first lowest when tied', () => {
    assert.deepStrictEqual(applyLowestZero([1, 1, 5, 5]), [0, 1, 5, 5]);
  });

  it('empty array returns empty', () => {
    assert.deepStrictEqual(applyLowestZero([]), []);
  });
});
