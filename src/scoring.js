'use strict';

/**
 * ScoringEngine — pure-function scoring system.
 *
 * Given dice values, scoring categories, passive abilities, and enemy rules,
 * computes the final score deterministically. No internal state.
 *
 * Typical usage:
 *   const result = ScoringEngine.score(diceValues, categories, { passives, enemyRules });
 */

// ---------------------------------------------------------------------------
// Category matchers
// ---------------------------------------------------------------------------

/** All dice same value. */
function isAllSame(values) {
  if (values.length < 3) return false;
  const first = values[0];
  return values.every(v => v === first);
}

/** Exactly two distinct values with frequencies >=2 and >=3. */
function isFullHouse(values) {
  if (values.length < 5) return false;
  const freq = countFreq(values);
  const counts = Object.values(freq).sort((a, b) => a - b);
  return counts.length === 2 && counts[0] >= 2 && counts[1] >= 3;
}

/** Has at least `len` consecutive values in the unique sorted set. */
function hasConsecutive(values, len) {
  const sorted = [...new Set(values)].sort((a, b) => a - b);
  if (sorted.length < len) return false;
  let run = 1;
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i] === sorted[i - 1] + 1) {
      run++;
      if (run >= len) return true;
    } else {
      run = 1;
    }
  }
  return false;
}

/** Has `n` or more dice with the same value. */
function hasSameValue(values, n) {
  const freq = countFreq(values);
  return Object.values(freq).some(c => c >= n);
}

/** Frequency map: value → count. */
function countFreq(values) {
  const freq = {};
  for (const v of values) {
    freq[v] = (freq[v] || 0) + 1;
  }
  return freq;
}

// ---------------------------------------------------------------------------
// Matching
// ---------------------------------------------------------------------------

/**
 * Check if dice values match a category definition.
 * @param {number[]} values - dice values
 * @param {object} cat - category config object
 * @returns {boolean}
 */
function matchesCategory(values, cat) {
  if (values.length < cat.minDice) return false;

  switch (cat.matchType) {
    case 'all_same':
      return isAllSame(values);
    case 'full_house':
      return isFullHouse(values);
    case 'consecutive':
      return hasConsecutive(values, cat.consecutiveCount);
    case 'same_value':
      return hasSameValue(values, cat.matchCount);
    case 'fallback':
      return true;
    default:
      return false;
  }
}

/**
 * Find the best matching category for the given dice.
 * @param {number[]} values - dice values
 * @param {object[]} categories - sorted by priority (ascending)
 * @param {Set<string>} blockedIds - category IDs to skip (enemy rules)
 * @returns {object|null} matched category, or null
 */
function findBestCategory(values, categories, blockedIds) {
  for (const cat of categories) {
    if (blockedIds.has(cat.id)) continue;
    if (matchesCategory(values, cat)) return cat;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Scoring
// ---------------------------------------------------------------------------

/**
 * Compute the match count for a given category (used by 连横术).
 * Returns the max frequency of any single value.
 */
function getMatchCount(values, cat) {
  if (cat.matchType === 'all_same') return values.length;
  if (cat.matchType === 'same_value') {
    const freq = countFreq(values);
    return Math.max(...Object.values(freq));
  }
  if (cat.matchType === 'full_house') {
    const freq = countFreq(values);
    const counts = Object.values(freq).sort((a, b) => b - a);
    return counts[0]; // the triple group count
  }
  // Straights and fallback don't have a meaningful "match count"
  return 0;
}

/**
 * Calculate link bonus (连横术).
 * Excess dice beyond the category's minimum requirement.
 */
function calcLinkBonus(values, cat, perExcess) {
  if (cat.matchType === 'all_same') return 0; // 豹子 never has excess

  if (cat.matchType === 'same_value') {
    const freq = countFreq(values);
    const maxCount = Math.max(...Object.values(freq));
    const excess = Math.max(0, maxCount - cat.matchCount);
    return excess * perExcess;
  }

  if (cat.matchType === 'full_house') {
    // For full house, excess is tricky — the triple group can exceed 3
    const freq = countFreq(values);
    const counts = Object.values(freq).sort((a, b) => b - a);
    const tripleCount = counts[0];
    const excess = Math.max(0, tripleCount - 3);
    return excess * perExcess;
  }

  return 0;
}

/**
 * Apply enemy rule "lowest_zero" — return modified values where the single
 * lowest die counts as 0 for scoring (does not affect matching).
 * @param {number[]} values
 * @returns {number[]}
 */
function applyLowestZero(values) {
  if (values.length === 0) return values;
  const result = [...values];
  let minIdx = 0;
  for (let i = 1; i < result.length; i++) {
    if (result[i] < result[minIdx]) minIdx = i;
  }
  result[minIdx] = 0;
  return result;
}

/**
 * Compute the full score breakdown.
 *
 * @param {object} opts
 * @param {number[]} opts.diceValues - raw dice values (for matching)
 * @param {object[]} opts.categories - sorted by priority (from DataConfig.getCategories())
 * @param {string[]} [opts.blockedCategories] - category IDs blocked by enemy rules
 * @param {object[]} [opts.passives] - active passive abilities
 * @param {object[]} [opts.enemyRules] - enemy rules affecting scoring
 * @returns {{ finalScore: number, category: object|null, breakdown: object }}
 */
function score(opts) {
  const { diceValues, categories, blockedCategories, passives, enemyRules } = opts;
  const blocked = new Set(blockedCategories || []);

  // --- Step 1: Match category (uses RAW dice values) ---
  const matchedCat = findBestCategory(diceValues, categories, blocked) ||
    categories.find(c => c.matchType === 'fallback');

  // --- Step 2: Compute scoring dice (enemy rules may modify for scoring) ---
  let scoringValues = [...diceValues];
  const ruleEffects = [];
  if (enemyRules) {
    for (const rule of enemyRules) {
      if (rule.id === 'lowest_zero') {
        scoringValues = applyLowestZero(scoringValues);
        ruleEffects.push({ rule: rule.id, description: '最低点归零' });
      }
    }
  }

  // --- Step 3: Category base score ---
  const diceSum = scoringValues.reduce((s, v) => s + v, 0);
  let categoryBase;
  if (matchedCat.bonusType === 'multiplier') {
    categoryBase = diceSum * matchedCat.bonusValue;
  } else {
    categoryBase = diceSum + matchedCat.bonusValue;
  }

  // --- Step 4: Flat bonuses (加法加成) ---
  let flatBonusTotal = 0;
  const flatBonuses = [];

  if (passives) {
    for (const p of passives) {
      if (p.bonusType === 'flat' && p.active !== false) {
        // Check category applicability
        if (appliesToCategory(p, matchedCat)) {
          flatBonusTotal += p.bonusValue;
          flatBonuses.push({ id: p.id, value: p.bonusValue });
        }
      }
    }
  }

  // 连横术 special handling
  if (passives) {
    const linkPassive = passives.find(p => p.id === 'chain_link' && p.active !== false);
    if (linkPassive && matchedCat.matchType !== 'fallback') {
      const linkBonus = calcLinkBonus(diceValues, matchedCat, linkPassive.perExcess || 5);
      if (linkBonus > 0) {
        flatBonusTotal += linkBonus;
        flatBonuses.push({ id: 'chain_link', value: linkBonus });
      }
    }
  }

  // --- Step 5: Multiplier bonuses (乘法倍率) ---
  let totalMultiplier = 1.0;
  const multipliers = [];
  if (passives) {
    for (const p of passives) {
      if (p.bonusType === 'multiplier' && p.active !== false) {
        totalMultiplier *= p.bonusValue;
        multipliers.push({ id: p.id, value: p.bonusValue });
      }
    }
  }

  // --- Step 6: Final score ---
  let finalScore = Math.floor((categoryBase + flatBonusTotal) * totalMultiplier);

  // Negative score protection
  if (finalScore < 0) finalScore = 0;

  return {
    finalScore,
    category: matchedCat,
    breakdown: {
      diceSum,
      categoryBase,
      categoryBonus: matchedCat.bonusValue,
      bonusType: matchedCat.bonusType,
      flatBonuses,
      flatBonusTotal,
      multipliers,
      totalMultiplier,
      ruleEffects,
    },
  };
}

/**
 * Check if a passive ability applies to the matched category.
 */
function appliesToCategory(passive, cat) {
  // chain_link is handled separately
  if (passive.id === 'chain_link') return false;

  // If passive has a categories list, check inclusion
  if (passive.categories && passive.categories.length > 0) {
    return passive.categories.includes(cat.id);
  }
  // Otherwise applies to all
  return true;
}

module.exports = {
  ScoringEngine: { score },
  // Export internals for testing
  _internals: {
    isAllSame, isFullHouse, hasConsecutive, hasSameValue,
    matchesCategory, findBestCategory, calcLinkBonus,
    applyLowestZero, countFreq, getMatchCount, appliesToCategory,
  },
};
