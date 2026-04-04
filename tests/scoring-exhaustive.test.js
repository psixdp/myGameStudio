'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { ScoringEngine, _internals } = require('../src/scoring');
const { DataConfig } = require('../src/data-config');
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', 'assets', 'data');
const config = new DataConfig().load(DATA_DIR);
const categories = config.getCategories();
const { findBestCategory, countFreq, hasConsecutive } = _internals;

// ---------------------------------------------------------------------------
// Reference classifier (independent implementation for cross-validation)
// ---------------------------------------------------------------------------

function manualClassify(dice) {
  const n = dice.length;
  const freq = countFreq(dice);
  const counts = Object.values(freq).sort((a, b) => a - b);
  const values = Object.keys(freq);

  if (values.length === 1 && n >= 3) return 'yahtzee';
  if (values.length === 2 && counts[0] >= 2 && counts[1] >= 3) return 'full_house';
  if (n >= 5 && hasConsecutive(dice, 5)) return 'large_straight';
  if (n >= 4 && hasConsecutive(dice, 4)) return 'small_straight';
  if (Math.max(...Object.values(freq)) >= 3) return 'three_of_a_kind';
  if (Math.max(...Object.values(freq)) >= 2) return 'pair';
  return 'bust';
}

// ---------------------------------------------------------------------------
// 3 dice exhaustive (216)
// ---------------------------------------------------------------------------

describe('Exhaustive: 3 dice (6³ = 216)', () => {
  it('every combination matches reference classifier', () => {
    let errors = 0;
    for (let a = 1; a <= 6; a++) {
      for (let b = 1; b <= 6; b++) {
        for (let c = 1; c <= 6; c++) {
          const dice = [a, b, c];
          const expected = manualClassify(dice);
          const cat = findBestCategory(dice, categories, new Set());
          if (cat.id !== expected) {
            errors++;
            if (errors <= 5) {
              console.log(`  MISMATCH [${dice}]: expected=${expected}, got=${cat.id}`);
            }
          }
        }
      }
    }
    assert.strictEqual(errors, 0, `${errors} mismatches in 3-dice exhaustive`);
  });
});

// ---------------------------------------------------------------------------
// 4 dice exhaustive (1296)
// ---------------------------------------------------------------------------

describe('Exhaustive: 4 dice (6⁴ = 1296)', () => {
  it('every combination matches reference classifier', () => {
    let errors = 0;
    for (let a = 1; a <= 6; a++) {
      for (let b = 1; b <= 6; b++) {
        for (let c = 1; c <= 6; c++) {
          for (let d = 1; d <= 6; d++) {
            const dice = [a, b, c, d];
            const expected = manualClassify(dice);
            const cat = findBestCategory(dice, categories, new Set());
            if (cat.id !== expected) {
              errors++;
              if (errors <= 5) {
                console.log(`  MISMATCH [${dice}]: expected=${expected}, got=${cat.id}`);
              }
            }
          }
        }
      }
    }
    assert.strictEqual(errors, 0, `${errors} mismatches in 4-dice exhaustive`);
  });
});

// ---------------------------------------------------------------------------
// 5 dice exhaustive (7776)
// ---------------------------------------------------------------------------

describe('Exhaustive: 5 dice (6⁵ = 7776)', () => {
  it('every combination matches reference classifier', () => {
    let errors = 0;
    for (let a = 1; a <= 6; a++) {
      for (let b = 1; b <= 6; b++) {
        for (let c = 1; c <= 6; c++) {
          for (let d = 1; d <= 6; d++) {
            for (let e = 1; e <= 6; e++) {
              const dice = [a, b, c, d, e];
              const expected = manualClassify(dice);
              const cat = findBestCategory(dice, categories, new Set());
              if (cat.id !== expected) {
                errors++;
                if (errors <= 5) {
                  console.log(`  MISMATCH [${dice}]: expected=${expected}, got=${cat.id}`);
                }
              }
            }
          }
        }
      }
    }
    assert.strictEqual(errors, 0, `${errors} mismatches in 5-dice exhaustive`);
  });
});

// ---------------------------------------------------------------------------
// 6 dice exhaustive (46656)
// ---------------------------------------------------------------------------

describe('Exhaustive: 6 dice (6⁶ = 46656)', () => {
  it('every combination matches reference classifier', () => {
    let errors = 0;
    for (let a = 1; a <= 6; a++) {
      for (let b = 1; b <= 6; b++) {
        for (let c = 1; c <= 6; c++) {
          for (let d = 1; d <= 6; d++) {
            for (let e = 1; e <= 6; e++) {
              for (let f = 1; f <= 6; f++) {
                const dice = [a, b, c, d, e, f];
                const expected = manualClassify(dice);
                const cat = findBestCategory(dice, categories, new Set());
                if (cat.id !== expected) {
                  errors++;
                  if (errors <= 5) {
                    console.log(`  MISMATCH [${dice}]: expected=${expected}, got=${cat.id}`);
                  }
                }
              }
            }
          }
        }
      }
    }
    assert.strictEqual(errors, 0, `${errors} mismatches in 6-dice exhaustive`);
  });
});

// ---------------------------------------------------------------------------
// 7 dice exhaustive (279936) — runs in ~2s
// ---------------------------------------------------------------------------

describe('Exhaustive: 7 dice (6⁷ = 279936)', () => {
  it('every combination matches reference classifier', () => {
    let errors = 0;
    for (let a = 1; a <= 6; a++) {
      for (let b = 1; b <= 6; b++) {
        for (let c = 1; c <= 6; c++) {
          for (let d = 1; d <= 6; d++) {
            for (let e = 1; e <= 6; e++) {
              for (let f = 1; f <= 6; f++) {
                for (let g = 1; g <= 6; g++) {
                  const dice = [a, b, c, d, e, f, g];
                  const expected = manualClassify(dice);
                  const cat = findBestCategory(dice, categories, new Set());
                  if (cat.id !== expected) {
                    errors++;
                    if (errors <= 5) {
                      console.log(`  MISMATCH [${dice}]: expected=${expected}, got=${cat.id}`);
                    }
                  }
                }
              }
            }
          }
        }
      }
    }
    assert.strictEqual(errors, 0, `${errors} mismatches in 7-dice exhaustive`);
  });
});

// ---------------------------------------------------------------------------
// Score calculation exhaustive spot-checks
// ---------------------------------------------------------------------------

describe('Exhaustive: score values for 3 dice', () => {
  it('every 3-dice combo produces valid non-negative score', () => {
    for (let a = 1; a <= 6; a++) {
      for (let b = 1; b <= 6; b++) {
        for (let c = 1; c <= 6; c++) {
          const r = ScoringEngine.score({
            diceValues: [a, b, c],
            categories,
            blockedCategories: [],
            passives: [],
            enemyRules: [],
          });
          assert.ok(r.finalScore >= 0, `[${a},${b},${c}] score=${r.finalScore} < 0`);
          assert.ok(r.category, `[${a},${b},${c}] no category`);
          assert.ok(r.breakdown.diceSum > 0, `[${a},${b},${c}] diceSum=${r.breakdown.diceSum}`);
        }
      }
    }
  });
});

describe('Exhaustive: score values for 4 dice', () => {
  it('every 4-dice combo produces valid non-negative score', () => {
    for (let a = 1; a <= 6; a++) {
      for (let b = 1; b <= 6; b++) {
        for (let c = 1; c <= 6; c++) {
          for (let d = 1; d <= 6; d++) {
            const r = ScoringEngine.score({
              diceValues: [a, b, c, d],
              categories,
              blockedCategories: [],
              passives: [],
              enemyRules: [],
            });
            assert.ok(r.finalScore >= 0);
            assert.ok(r.category);
          }
        }
      }
    }
  });
});

// ---------------------------------------------------------------------------
// Hand-calculated score verification (key representative cases)
// ---------------------------------------------------------------------------

describe('Hand-calculated score verification', () => {
  function scoreSimple(dice) {
    return ScoringEngine.score({
      diceValues: dice, categories,
      blockedCategories: [], passives: [], enemyRules: [],
    });
  }

  it('[6,6,6] yahtzee → 18×3 = 54', () => {
    assert.strictEqual(scoreSimple([6, 6, 6]).finalScore, 54);
  });

  it('[1,1,1] yahtzee → 3×3 = 9', () => {
    assert.strictEqual(scoreSimple([1, 1, 1]).finalScore, 9);
  });

  it('[3,3,3,5,5] full_house → 19+15 = 34', () => {
    assert.strictEqual(scoreSimple([3, 3, 3, 5, 5]).finalScore, 34);
  });

  it('[1,2,3,4,5] large_straight → 15+20 = 35', () => {
    assert.strictEqual(scoreSimple([1, 2, 3, 4, 5]).finalScore, 35);
  });

  it('[3,4,5,6] small_straight → 18+10 = 28', () => {
    assert.strictEqual(scoreSimple([3, 4, 5, 6]).finalScore, 28);
  });

  it('[4,4,4,2] three_of_a_kind → 14+5 = 19', () => {
    assert.strictEqual(scoreSimple([4, 4, 4, 2]).finalScore, 19);
  });

  it('[6,6,3] pair → 15+0 = 15', () => {
    assert.strictEqual(scoreSimple([6, 6, 3]).finalScore, 15);
  });

  it('[1,3,5] bust → 9+0 = 9', () => {
    assert.strictEqual(scoreSimple([1, 3, 5]).finalScore, 9);
  });

  it('[6,6,6,6,6,6] yahtzee → 36×3 = 108', () => {
    assert.strictEqual(scoreSimple([6, 6, 6, 6, 6, 6]).finalScore, 108);
  });

  it('[1,1,1,1,1,1,1] yahtzee → 7×3 = 21', () => {
    assert.strictEqual(scoreSimple([1, 1, 1, 1, 1, 1, 1]).finalScore, 21);
  });

  it('[2,3,4,5,6,6] large_straight → 26+20 = 46', () => {
    assert.strictEqual(scoreSimple([2, 3, 4, 5, 6, 6]).finalScore, 46);
  });

  it('[4,4,4,5,5,5] full_house → 27+15 = 42', () => {
    assert.strictEqual(scoreSimple([4, 4, 4, 5, 5, 5]).finalScore, 42);
  });
});
