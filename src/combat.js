'use strict';

/**
 * Combat — orchestrates a single battle using the 12-step settlement flow.
 *
 * Combat coordinates dice, scoring, enemy, cheating, and economy systems.
 * It executes the 12 steps in strict order, passing outputs between steps.
 *
 * Dependencies (injected via constructor):
 *   - dicePool: DicePool instance
 *   - dataConfig: DataConfig instance
 *   - enemy: Enemy instance
 *   - cheating: CheatingAbilities instance
 *   - economy: Economy instance
 *   - rng: RNG instance (for dice re-roll on double_roll consumable)
 */
class Combat {
  /**
   * @param {object} opts
   * @param {import('./dice.js').DicePool} opts.dicePool
   * @param {import('./data-config.js').DataConfig} opts.dataConfig
   * @param {import('./enemy.js').Enemy} opts.enemy
   * @param {import('./cheating.js').CheatingAbilities} opts.cheating
   * @param {import('./economy.js').Economy} opts.economy
   * @param {import('./rng.js').RNG} opts.rng
   */
  constructor(opts = {}) {
    this._dice = opts.dicePool;
    this._dataConfig = opts.dataConfig;
    this._enemy = opts.enemy;
    this._cheating = opts.cheating;
    this._economy = opts.economy;
    this._rng = opts.rng;

    /** @type {object|null} Combat result after execute() */
    this._result = null;

    /** @type {Array<string>} Step log for debugging/testing */
    this._stepLog = [];
  }

  /** Get the result of the last combat. */
  getResult() {
    return this._result;
  }

  /** Get step log (for testing). */
  getStepLog() {
    return [...this._stepLog];
  }

  /**
   * Execute a full battle for the given round.
   * This runs steps 1-12 in sequence.
   * @param {number} round - round number (1-8)
   * @returns {object} { victory: boolean, score: number, targetScore: number, tokensEarned: number }
   */
  execute(round) {
    this._stepLog = [];
    this._cheating.resetRoundState();
    this._cheating.clearSealedPassive();

    // Step 1: Load and show enemy info
    this._stepLog.push('step1_load_enemy');
    this._enemy.loadForRound(round);
    const targetScore = this._enemy.getTargetScore();

    // Handle seal_passive rule (step 1 extension)
    if (this._enemy.hasSealPassiveRule()) {
      this._cheating.sealMostExpensivePassive();
    }

    // Handle clone_dice passive (pre-roll setup)
    // Step 2: Roll dice
    this._stepLog.push('step2_roll_dice');
    this._rollWithClone();

    // Step 3: Enemy dice-modifying rules
    this._stepLog.push('step3_enemy_dice_rules');
    this._applyEnemyDiceRules();

    // Step 4: Player consumables (simplified - no UI loop, just mark used)
    // For testing, we'll allow external code to call useConsumable() directly
    this._stepLog.push('step4_consumables');

    // Step 5: Passive floor (铅骰)
    this._stepLog.push('step5_passive_floor');
    this._applyPassiveFloor();

    // Step 6: Category matching
    this._stepLog.push('step6_category_match');
    const blockedCategories = this._enemy.getBlockedCategories();
    const categories = this._dataConfig.getCategories();
    const matchedCategory = this._matchCategory(this._dice.getValues(), categories, blockedCategories);

    // Step 7: Base score calculation
    this._stepLog.push('step7_base_score');
    const baseScore = this._calculateBase(this._dice.getValues(), matchedCategory);

    // Step 8: Enemy scoring rules (zero_lowest)
    this._stepLog.push('step8_enemy_scoring_rules');
    let adjustedBase = baseScore;
    if (this._enemy.hasZeroLowestRule()) {
      adjustedBase = this._applyZeroLowest(this._dice.getValues(), baseScore);
    }

    // Step 9-11: Bonus calculation and final score
    this._stepLog.push('step9_10_11_bonuses');
    const matchedCount = this._calcMatchedCount(matchedCategory, this._dice.getValues());
    const flatBonus = this._cheating.getFlatBonuses(
      matchedCategory,
      this._dice,
      matchedCount
    );
    const multiplier = this._cheating.getMultipliers();
    const finalScore = Math.floor((adjustedBase + flatBonus) * multiplier);

    // Step 12: Victory determination
    this._stepLog.push('step12_victory_check');
    const victory = finalScore >= targetScore;
    let tokensEarned = 0;
    if (victory) {
      tokensEarned = this._economy.getRewardForRound(round);
      this._economy.earn(tokensEarned);
    }

    this._result = {
      victory,
      score: finalScore,
      targetScore,
      tokensEarned,
      round,
      matchedCategory: matchedCategory.id,
      baseScore,
      adjustedBase,
      flatBonus,
      multiplier
    };

    return this._result;
  }

  /**
   * Roll dice with clone_dice passive effect.
   */
  _rollWithClone() {
    this._dice.roll();

    const clonePassive = this._cheating.getPassiveByEffect('clone_dice');
    if (clonePassive) {
      this._dice.addTempDie();
    }
  }

  /**
   * Apply enemy dice-modifying rules (step 3).
   */
  _applyEnemyDiceRules() {
    // 狸猫换子 - reroll random dice
    const rerollParams = this._enemy.getRerollParams();
    if (rerollParams) {
      this._dice.rerollRandom(rerollParams.count);
    }

    // 全面压制 - decrease all dice
    const decreaseParams = this._enemy.getDecreaseParams();
    if (decreaseParams) {
      this._dice.decreaseAll(decreaseParams.amount, decreaseParams.minValue);
    }
  }

  /**
   * Apply passive floor (铅骰) - step 5.
   */
  _applyPassiveFloor() {
    const floorPassive = this._cheating.getPassiveByEffect('dice_floor');
    if (floorPassive) {
      this._dice.setFloor(floorPassive.params.minValue);
    }
  }

  /**
   * Apply zero_lowest enemy rule (step 8).
   * @param {number[]} diceValues
   * @param {number} baseScore
   * @returns {number} adjusted score
   */
  _applyZeroLowest(diceValues, baseScore) {
    // Find minimum value
    let minVal = Infinity;
    for (const v of diceValues) {
      if (v < minVal) minVal = v;
    }
    // Subtract minVal from base score (treating lowest die as 0)
    return baseScore - minVal;
  }

  /**
   * Calculate matched count for a category.
   * @param {object} category - matched category
   * @param {number[]} values - dice values
   * @returns {number} count of dice that matched
   */
  _calcMatchedCount(category, values) {
    if (category.matchType === 'all_same') return values.length;
    if (category.matchType === 'same_value') {
      const freq = {};
      for (const v of values) freq[v] = (freq[v] || 0) + 1;
      return Math.max(...Object.values(freq));
    }
    if (category.matchType === 'full_house') {
      const freq = {};
      for (const v of values) freq[v] = (freq[v] || 0) + 1;
      const counts = Object.values(freq).sort((a, b) => b - a);
      return counts[0] || 0;
    }
    if (category.matchType === 'consecutive') {
      // For straights, count the consecutive run
      const sorted = [...new Set(values)].sort((a, b) => a - b);
      let maxRun = 1, run = 1;
      for (let i = 1; i < sorted.length; i++) {
        if (sorted[i] === sorted[i - 1] + 1) {
          run++;
          maxRun = Math.max(maxRun, run);
        } else {
          run = 1;
        }
      }
      return maxRun;
    }
    // fallback or unknown: return 0
    return 0;
  }

  /**
   * Use a consumable (called by UI/external code during step 4).
   * This is a simplified interface for testing; real game will have UI-driven loop.
   * @param {number} slotIndex
   * @returns {object|null} consumable effect if used
   */
  useConsumable(slotIndex) {
    if (!this._cheating.canUseConsumable()) return null;

    const ability = this._cheating.useConsumable(slotIndex);
    if (!ability) return null;

    // Apply consumable effect
    switch (ability.effectType) {
      case 'set_dice_value':
        // For testing, assume we set die 0 to max value
        // Real game will have UI to select die and value
        this._dice.setDie(0, ability.params.max);
        break;

      case 'reroll_min':
        this._dice.rerollDie(0, ability.params.minValue);
        break;

      case 'replace_lowest':
        this._dice.replaceLowest(ability.params.value);
        break;

      case 'extra_roll':
        // Re-roll all dice (goes back to step 2)
        this._rollWithClone();
        break;

      case 'reveal_weakness':
        // Already handled in cheating.useConsumable()
        break;
    }

    return ability;
  }

  /**
   * Reset combat state (for new game).
   */
  reset() {
    this._result = null;
    this._stepLog = [];
  }

  // ---------------------------------------------------------------------------
  // Internal scoring helpers
  // ---------------------------------------------------------------------------

  /** Find best matching category (simplified from scoring system). */
  _matchCategory(values, categories, blockedIds) {
    const blocked = new Set(blockedIds);
    for (const cat of categories) {
      if (blocked.has(cat.id)) continue;
      if (this._matchesCategory(values, cat)) return cat;
    }
    // Return fallback (bust)
    return categories.find(c => c.matchType === 'fallback') || categories[categories.length - 1];
  }

  /** Check if values match a category. */
  _matchesCategory(values, cat) {
    if (values.length < cat.minDice) return false;

    switch (cat.matchType) {
      case 'all_same':
        return values.length >= 3 && values.every(v => v === values[0]);
      case 'full_house':
        if (values.length < 5) return false;
        const freq = {};
        for (const v of values) freq[v] = (freq[v] || 0) + 1;
        const counts = Object.values(freq).sort((a, b) => a - b);
        return counts.length === 2 && counts[0] >= 2 && counts[1] >= 3;
      case 'same_value':
        const freq2 = {};
        for (const v of values) freq2[v] = (freq2[v] || 0) + 1;
        return Object.values(freq2).some(c => c >= (cat.matchCount || 2));
      case 'consecutive':
        const sorted = [...new Set(values)].sort((a, b) => a - b);
        let run = 1;
        for (let i = 1; i < sorted.length; i++) {
          if (sorted[i] === sorted[i - 1] + 1) {
            run++;
            if (run >= (cat.matchCount || 4)) return true;
          } else {
            run = 1;
          }
        }
        return false;
      case 'fallback':
        return true;
      default:
        return false;
    }
  }

  /** Calculate base score for a category. */
  _calculateBase(values, category) {
    const sum = values.reduce((a, b) => a + b, 0);
    if (category.bonusType === 'multiplier') {
      return sum * category.bonusValue;
    }
    return sum + category.bonusValue;
  }
}

module.exports = { Combat };
