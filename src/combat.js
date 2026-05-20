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

  /** Get current round info (for UI preview). */
  getCurrentRoundInfo() {
    return this._currentRoundInfo;
  }

  /**
   * Phase 1a: Execute first roll only (steps 1-3 + first clone).
   * Returns dice state for hold decision.
   * @param {number} round - round number (1-8)
   * @returns {object} { dice, diceValues, targetScore }
   */
  executeFirstRoll(round) {
    this._stepLog = [];
    this._cheating.resetRoundState();
    this._cheating.clearSealedPassive();

    // Clear temp dice from previous round
    this._dice.clearTempDice();
    this._dice.clearHolds();

    // Step 1: Load enemy
    this._stepLog.push('step1_load_enemy');
    this._enemy.loadForRound(round);
    let targetScore = this._enemy.getTargetScore();

    // Apply 魔鬼契约 penalty from previous round
    const targetIncrease = this._cheating.consumeNextRoundTargetIncrease();
    if (targetIncrease > 0) {
      targetScore = Math.floor(targetScore * (1 + targetIncrease));
    }

    // Handle seal_passive rule
    if (this._enemy.hasSealPassiveRule() && !this._isBlindJudgeActive()) {
      this._cheating.sealMostExpensivePassive();
    }

    // Step 2: First roll + first clone trigger
    this._stepLog.push('step2_first_roll');
    this._rollWithClone();
    this._dice.clearFrozenDice();

    // Step 3: Enemy dice-modifying rules
    this._stepLog.push('step3_enemy_dice_rules');
    this._applyEnemyDiceRules();

    // Store round info (partial - no scoring yet)
    this._currentRoundInfo = {
      round,
      targetScore,
    };

    return {
      dice: this._dice.getDice(),
      diceValues: this._dice.getValues(),
      targetScore,
    };
  }

  /**
   * Phase 1b: Hold dice + second roll + scoring (new steps 4-5 + steps 6-9).
   * @param {number[]} heldIndices - indices of dice to keep
   * @returns {object} score result for UI display
   */
  executeHoldAndReroll(heldIndices) {
    const info = this._currentRoundInfo;
    if (!info) {
      throw new Error('Cannot hold: executeFirstRoll() must be called first');
    }

    // Step 4: Hold decision
    this._stepLog.push('step4_hold_decision');
    this._dice.hold(heldIndices);

    // Remove temp dice from first clone (they can't be held)
    this._dice.clearTempDice();

    // Step 5: Second roll (only unheld dice) + second clone trigger
    this._stepLog.push('step5_second_roll');
    this._dice.rerollUnheld();
    this._cheating.recordReroll(1);

    // Second clone trigger
    const clonePassive = this._cheating.getPassiveByEffect('clone_dice');
    if (clonePassive) {
      this._dice.addTempDie();
    }
    this._stepLog.push('step5a_second_clone');

    // Clear holds
    this._dice.clearHolds();

    // Step 6: Consumables (skip - player uses them in UI)
    this._stepLog.push('step6_consumables');

    // Step 7: Passive floor
    this._stepLog.push('step7_passive_floor');
    this._applyPassiveFloor();

    // Step 8: Category matching
    this._stepLog.push('step8_category_match');
    const blockedCategories = this._isBlindJudgeActive() ? [] : this._enemy.getBlockedCategories();
    const categories = this._dataConfig.getCategories();
    const matchedCategory = this._matchCategory(this._dice.getValues(), categories, blockedCategories);

    // Step 9: Base score calculation
    this._stepLog.push('step9_base_score');
    const baseScore = this._calculateBase(this._dice.getValues(), matchedCategory);

    // Step 10: Enemy scoring rules
    this._stepLog.push('step10_enemy_scoring_rules');
    let adjustedBase = baseScore;
    if (this._enemy.hasZeroLowestRule() && !this._isBlindJudgeActive()) {
      adjustedBase = this._applyZeroLowest(this._dice.getValues(), baseScore);
    }

    // Update round info with scoring data
    this._currentRoundInfo = {
      ...info,
      matchedCategory,
      baseScore,
      adjustedBase
    };

    // Calculate preliminary score with multipliers (for UI display)
    const matchedCount = this._calcMatchedCount(matchedCategory, this._dice.getValues());
    const flatBonus = this._cheating.getFlatBonuses(matchedCategory, this._dice, matchedCount);
    const multiplier = this._cheating.getMultipliers(matchedCategory, this._dice);
    const score = Math.floor((adjustedBase + flatBonus) * multiplier);

    return {
      dice: this._dice.getDice(),
      diceValues: this._dice.getValues(),
      baseScore,
      adjustedBase,
      matchedCategory,
      targetScore: info.targetScore,
      score,
      flatBonus,
      multiplier
    };
  }

  /**
   * Legacy: Execute full roll phase in one go (no hold/reroll).
   * Used by old execute() and existing tests.
   * @param {number} round - round number (1-8)
   * @returns {object} score result
   */
  executeRollPhase(round) {
    this._stepLog = [];
    this._cheating.resetRoundState();
    this._cheating.clearSealedPassive();
    this._dice.clearTempDice();
    this._dice.clearHolds();

    // Step 1: Load enemy
    this._stepLog.push('step1_load_enemy');
    this._enemy.loadForRound(round);
    let targetScore = this._enemy.getTargetScore();

    const targetIncrease = this._cheating.consumeNextRoundTargetIncrease();
    if (targetIncrease > 0) {
      targetScore = Math.floor(targetScore * (1 + targetIncrease));
    }

    if (this._enemy.hasSealPassiveRule() && !this._isBlindJudgeActive()) {
      this._cheating.sealMostExpensivePassive();
    }

    // Step 2: Roll dice (frozen dice skip their roll, then clear flag)
    this._stepLog.push('step2_roll_dice');
    this._rollWithClone();
    this._dice.clearFrozenDice();

    // Step 3: Enemy dice-modifying rules
    this._stepLog.push('step3_enemy_dice_rules');
    this._applyEnemyDiceRules();

    // Step 4: Consumables (skip here - player uses them in UI)
    this._stepLog.push('step4_consumables');

    // Step 5: Passive floor
    this._stepLog.push('step5_passive_floor');
    this._applyPassiveFloor();

    // Step 6: Category matching
    this._stepLog.push('step6_category_match');
    const blockedCategories = this._isBlindJudgeActive() ? [] : this._enemy.getBlockedCategories();
    const categories = this._dataConfig.getCategories();
    const matchedCategory = this._matchCategory(this._dice.getValues(), categories, blockedCategories);

    // Step 7: Base score calculation
    this._stepLog.push('step7_base_score');
    const baseScore = this._calculateBase(this._dice.getValues(), matchedCategory);

    // Step 8: Enemy scoring rules
    this._stepLog.push('step8_enemy_scoring_rules');
    let adjustedBase = baseScore;
    if (this._enemy.hasZeroLowestRule() && !this._isBlindJudgeActive()) {
      adjustedBase = this._applyZeroLowest(this._dice.getValues(), baseScore);
    }

    this._currentRoundInfo = {
      round,
      targetScore,
      matchedCategory,
      baseScore,
      adjustedBase
    };

    const matchedCount = this._calcMatchedCount(matchedCategory, this._dice.getValues());
    const flatBonus = this._cheating.getFlatBonuses(matchedCategory, this._dice, matchedCount);
    const multiplier = this._cheating.getMultipliers(matchedCategory, this._dice);
    const score = Math.floor((adjustedBase + flatBonus) * multiplier);

    return {
      dice: this._dice.getDice(),
      diceValues: this._dice.getValues(),
      baseScore,
      adjustedBase,
      matchedCategory,
      targetScore,
      score,
      flatBonus,
      multiplier
    };
  }

  /**
   * Phase 2: Finalize result (steps 9-12).
   * This applies passive bonuses and determines victory/defeat.
   * Call this AFTER player has used consumables.
   * @returns {object} { victory: boolean, score: number, targetScore: number, tokensEarned: number }
   */
  finalizeResult() {
    const info = this._currentRoundInfo;
    if (!info) {
      throw new Error('Cannot finalize: executeRollPhase() must be called first');
    }

    // Steps 9-11: Bonus calculation and final score
    this._stepLog.push('step9_10_11_bonuses');
    const matchedCount = this._calcMatchedCount(info.matchedCategory, this._dice.getValues());
    const flatBonus = this._cheating.getFlatBonuses(
      info.matchedCategory,
      this._dice,
      matchedCount
    );
    const multiplier = this._cheating.getMultipliers(info.matchedCategory, this._dice);
    const finalScore = Math.floor((info.adjustedBase + flatBonus) * multiplier);

    // Step 12: Victory determination
    this._stepLog.push('step12_victory_check');

    // Check for victory_reverse passive (反转审判) - rule break!
    let effectiveTargetScore = info.targetScore;
    const reversePassive = this._cheating.getPassiveByEffect('victory_reverse');
    if (reversePassive) {
      effectiveTargetScore = Math.floor(info.targetScore * (reversePassive.params.threshold || 0.85));
    }

    const victory = finalScore >= effectiveTargetScore;
    let tokensEarned = 0;
    if (victory) {
      tokensEarned = this._economy.getRewardForRound(info.round);
      this._economy.earn(tokensEarned);
    }

    // 处理“黑市交易”未使用的借贷消耗品惩罚扣除
    let loanPenalty = 0;
    const loanConsumables = this._cheating.getConsumables().filter(c => c.loaned);
    if (loanConsumables.length > 0) {
      for (const c of loanConsumables) {
        loanPenalty += c.params.penaltyGold || 6;
      }
      if (loanPenalty > 0) {
        this._economy.spend(Math.min(this._economy.getBalance(), loanPenalty));
      }
      this._cheating.clearLoanedConsumables();
    }

    this._result = {
      victory,
      score: finalScore,
      targetScore: info.targetScore,
      tokensEarned,
      round: info.round,
      matchedCategory: info.matchedCategory.id,
      baseScore: info.baseScore,
      adjustedBase: info.adjustedBase,
      flatBonus,
      multiplier
    };

    return this._result;
  }

  /**
   * Execute a full battle for the given round.
   * This runs steps 1-12 in sequence.
   * @param {number} round - round number (1-8)
   * @returns {object} { victory: boolean, score: number, targetScore: number, tokensEarned: number }
   */
  execute(round) {
    // Phase 1: Initial roll (steps 1-8)
    this.executeRollPhase(round);

    // Phase 2: Finalize result (steps 9-12)
    return this.finalizeResult();
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
    if (this._isBlindJudgeActive()) {
      return;
    }
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
   * @param {object} [options] - { targetIndex, targetIndex2, targetValue }
   * @returns {object|null} consumable effect if used
   */
  useConsumable(slotIndex, { targetIndex = 0, targetIndex2 = 1, targetValue } = {}) {
    if (!this._cheating.canUseConsumable()) return null;

    const ability = this._cheating.useConsumable(slotIndex);
    if (!ability) return null;

    // Apply consumable effect
    switch (ability.effectType) {
      case 'set_dice_value':
        this._dice.setDie(targetIndex, targetValue ?? ability.params.max);
        break;

      case 'reroll_min':
        this._dice.rerollDie(targetIndex, ability.params.minValue);
        this._cheating.recordReroll(1);
        break;

      case 'replace_lowest':
        this._dice.replaceLowest(ability.params.value);
        break;

      case 'extra_roll':
        // Re-roll all dice (goes back to step 2)
        // Clear holds so all dice get rerolled
        this._dice.clearHolds();
        this._dice.clearTempDice();
        this._rollWithClone();
        this._cheating.recordReroll(1);
        break;

      case 'gamble_reroll':
        // 50% all dice become goodValue, 50% all dice become badValue
        {
          const stream = this._rng.getStream('gamble');
          const dice = this._dice.getValues();
          const roll = stream.nextFloat();
          const targetValue = roll < ability.params.chance ? ability.params.goodValue : ability.params.badValue;
          for (let i = 0; i < dice.length; i++) {
            this._dice.setDie(i, targetValue);
          }
        }
        break;

      case 'swap_values':
        this._dice.swapDice(targetIndex, targetIndex2);
        break;

      case 'invert_value':
        this._dice.invertDie(targetIndex, ability.params.sumValue);
        break;

      case 'freeze_die':
        this._dice.freezeDie(targetIndex);
        break;

      case 'reveal_weakness':
        // Already handled in cheating.useConsumable()
        break;

      case 'temp_multiplier_penalty':
        // 魔鬼契约: add temporary round multiplier + penalty for next round
        this._cheating.addRoundMultiplier(ability.params.multiplier || 1.5);
        this._cheating.addNextRoundTargetIncrease(ability.params.nextRoundTargetIncrease || 0.25);
        break;

      case 'sacrifice_consumables':
        // 孤注一掷: destroy all remaining consumables for flat bonus
        {
          const sacrificed = this._cheating.sacrificeAllConsumables();
          const bonusPerSac = ability.params.bonusPerSacrifice || 8;
          this._cheating.addRoundFlatBonus(sacrificed * bonusPerSac);
        }
        break;

      case 'copy_dice_value':
        this._dice.copyValue(targetIndex, targetIndex2);
        break;

      case 'shift_dice_parity':
        {
          const current = this._dice.getValues()[targetIndex];
          let newVal = targetValue;
          if (newVal === undefined) {
            newVal = current === 6 ? 5 : current + 1;
          }
          if (Math.abs(newVal - current) === 1 && newVal >= 1 && newVal <= 6) {
            this._dice.setDie(targetIndex, newVal);
          }
        }
        break;

      case 'high_risk_reroll':
        {
          const stream = this._rng.getStream('gamble');
          const newVal = stream.nextInt(1, 6);
          this._dice.setDie(targetIndex, newVal);
          this._cheating.recordReroll(1);

          if (newVal === (ability.params.successValue || 6)) {
            this._cheating.addRoundMultiplier(ability.params.successMultiplier || 2.0);
          } else if (newVal === (ability.params.failValue || 1)) {
            this._cheating.addRoundMultiplier(ability.params.failMultiplier || 0.5);
          }
        }
        break;

      case 'split_to_extremes':
        {
          const stream = this._rng.getStream('gamble');
          const dice = this._dice.getValues();
          const targetVals = ability.params.targetValues || [2, 3, 4, 5];
          const outcomes = ability.params.outcomes || [1, 6];
          for (let i = 0; i < dice.length; i++) {
            if (targetVals.includes(dice[i])) {
              const idx = stream.nextInt(0, outcomes.length - 1);
              this._dice.setDie(i, outcomes[idx]);
            }
          }
        }
        break;

      case 'loan_consumables':
        this._cheating.addRandomConsumables(ability.params.count || 3, ability.id);
        break;
    }

    return ability;
  }

  /**
   * Recalculate score based on current dice state (without re-rolling).
   * Called after consumables modify dice.
   * @returns {object} { dice: array, diceValues: array, baseScore: number, adjustedBase: number, matchedCategory: object, targetScore: number }
   */
  recalculateFromCurrentDice() {
    const info = this._currentRoundInfo;
    if (!info) {
      throw new Error('Cannot recalculate: executeRollPhase() must be called first');
    }

    // Apply passive floor again (in case dice were modified below floor)
    this._applyPassiveFloor();

    // Re-match or preserve category
    const blockedCategories = this._enemy.getBlockedCategories();
    const categories = this._dataConfig.getCategories();
    let matchedCategory;
    if (info.playerSelectedCategory) {
      matchedCategory = info.matchedCategory;
    } else {
      matchedCategory = this._matchCategory(this._dice.getValues(), categories, blockedCategories);
    }

    // Re-calculate base score
    const baseScore = this._calculateBase(this._dice.getValues(), matchedCategory);

    // Apply enemy scoring rules (zero_lowest)
    let adjustedBase = baseScore;
    if (this._enemy.hasZeroLowestRule()) {
      adjustedBase = this._applyZeroLowest(this._dice.getValues(), baseScore);
    }

    // Update current round info
    this._currentRoundInfo = {
      round: info.round,
      targetScore: info.targetScore,
      matchedCategory,
      baseScore,
      adjustedBase,
      playerSelectedCategory: info.playerSelectedCategory || false,
      availableCategories: info.availableCategories || null
    };

    // Calculate score with multipliers (for UI display)
    const matchedCount = this._calcMatchedCount(matchedCategory, this._dice.getValues());
    const flatBonus = this._cheating.getFlatBonuses(matchedCategory, this._dice, matchedCount);
    const multiplier = this._cheating.getMultipliers(matchedCategory, this._dice);
    const score = Math.floor((adjustedBase + flatBonus) * multiplier);

    return {
      dice: this._dice.getDice(),
      diceValues: this._dice.getValues(),
      baseScore,
      adjustedBase,
      matchedCategory,
      targetScore: info.targetScore,
      score,  // Final score with multipliers applied
      flatBonus,
      multiplier
    };
  }

  /**
   * Get all available categories for player selection.
   * Returns categories that match current dice, plus bust as fallback.
   * Each includes a score preview.
   * @param {number[]} [values] - dice values (defaults to current pool)
   * @returns {Array<{id, name, priority, matchType, bonusType, bonusValue, preview: number}>}
   */
  getAvailableCategories(values) {
    values = values || this._dice.getValues();
    const blockedCategories = this._enemy.getBlockedCategories();
    const categories = this._dataConfig.getCategories();
    const blocked = new Set(blockedCategories);
    const available = [];

    for (const cat of categories) {
      if (blocked.has(cat.id)) continue;
      if (cat.matchType === 'fallback') continue; // add bust last
      if (this._matchesCategory(values, cat)) {
        const preview = this._calculateScorePreview(values, cat);
        available.push({ ...cat, preview });
      }
    }

    // 散牌始终兜底
    const bust = categories.find(c => c.matchType === 'fallback');
    if (bust && !blocked.has(bust.id)) {
      const preview = this._calculateScorePreview(values, bust);
      available.push({ ...bust, preview });
    }

    // 按优先级排序（高优先级在前 = 低 priority 数字）
    available.sort((a, b) => a.priority - b.priority);

    return available;
  }

  /**
   * Calculate score preview for a specific category.
   * @param {number[]} values
   * @param {object} category
   * @returns {number}
   */
  _calculateScorePreview(values, category) {
    const baseScore = this._calculateBase(values, category);
    let adjustedBase = baseScore;
    if (this._enemy.hasZeroLowestRule()) {
      adjustedBase = this._applyZeroLowest(values, baseScore);
    }
    const matchedCount = this._calcMatchedCount(category, values);
    const flatBonus = this._cheating.getFlatBonuses(category, this._dice, matchedCount);
    const multiplier = this._cheating.getMultipliers(category, this._dice);
    return Math.floor((adjustedBase + flatBonus) * multiplier);
  }

  /**
   * Player selects a category. Updates round info and calculates downgrade bonus.
   * @param {string} categoryId
   * @param {Array} [availableCategories] - from getAvailableCategories, for 藏拙 calc
   * @returns {object} updated score result
   */
  selectCategory(categoryId, availableCategories) {
    const info = this._currentRoundInfo;
    if (!info) throw new Error('No round info');

    const categories = this._dataConfig.getCategories();
    const cat = categories.find(c => c.id === categoryId);
    if (!cat) return null;

    const values = this._dice.getValues();
    const baseScore = this._calculateBase(values, cat);

    let adjustedBase = baseScore;
    if (this._enemy.hasZeroLowestRule()) {
      adjustedBase = this._applyZeroLowest(values, baseScore);
    }

    // 藏拙：计算降维奖励
    if (availableCategories && availableCategories.length > 0) {
      const bestPriority = Math.min(...availableCategories.map(c => c.priority));
      const levelsBelow = cat.priority - bestPriority;
      if (levelsBelow > 0) {
        const hiddenStrength = this._cheating.getPassiveByEffect('downgrade_bonus');
        if (hiddenStrength) {
          const bonus = levelsBelow * (hiddenStrength.params.perLevel || 8);
          this._cheating.setDowngradeBonus(bonus);
        }
      }
    }

    this._currentRoundInfo = {
      ...info,
      matchedCategory: cat,
      baseScore,
      adjustedBase,
      playerSelectedCategory: true,
      availableCategories
    };

    return this._buildScoreResult();
  }

  /**
   * Build score result from current state.
   * @returns {object}
   */
  _buildScoreResult() {
    const info = this._currentRoundInfo;
    const matchedCategory = info.matchedCategory;
    const values = this._dice.getValues();

    const matchedCount = this._calcMatchedCount(matchedCategory, values);
    const flatBonus = this._cheating.getFlatBonuses(matchedCategory, this._dice, matchedCount);
    const multiplier = this._cheating.getMultipliers(matchedCategory, this._dice);
    const score = Math.floor((info.adjustedBase + flatBonus) * multiplier);

    return {
      dice: this._dice.getDice(),
      diceValues: values,
      baseScore: info.baseScore,
      adjustedBase: info.adjustedBase,
      matchedCategory,
      targetScore: info.targetScore,
      score,
      flatBonus,
      multiplier
    };
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
    // Check for category_override passive (强夺令) - rule break!
    const overridePassive = this._cheating.getPassiveByEffect('category_override');
    if (overridePassive) {
      const forceCat = categories.find(c => c.id === overridePassive.params.forceCategory);
      if (forceCat && values.length >= overridePassive.params.minDice) {
        return forceCat;
      }
    }

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
        if (values.length < 3) return false;
        if (values.every(v => v === values[0])) return true;
        // 豹子猎手：允许1颗不同
        {
          const hunterPassive = this._cheating.getPassiveByEffect('loose_all_same');
          if (hunterPassive) {
            const freq = {};
            for (const v of values) freq[v] = (freq[v] || 0) + 1;
            const maxCount = Math.max(...Object.values(freq));
            return maxCount >= values.length - (hunterPassive.params.allowedDifferent || 1);
          }
        }
        return false;
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
        // Check if loose_consecutive passive is active
        const hasLoose = this._cheating.getPassiveByEffect('loose_consecutive') !== null;
        return this._checkConsecutive(values, cat.consecutiveCount || 4, hasLoose);
      case 'fallback':
        return true;
      default:
        return false;
    }
  }

  /**
   * Check if values form a consecutive sequence.
   * @param {number[]} values - dice values
   * @param {number} length - required consecutive length (4 for small straight, 5 for large)
   * @param {boolean} allowGap - if true, allow gaps (顺子眼)
   * @returns {boolean}
   */
  _checkConsecutive(values, length, allowGap = false) {
    const maxGap = allowGap ? (this._cheating.getPassiveByEffect('loose_consecutive')?.params?.maxGap || 0) : 0;
    const unique = [...new Set(values)].sort((a, b) => a - b);

    // If no gaps allowed, use original logic
    if (maxGap === 0) {
      let run = 1;
      for (let i = 1; i < unique.length; i++) {
        if (unique[i] === unique[i - 1] + 1) {
          run++;
          if (run >= length) return true;
        } else {
          run = 1;
        }
      }
      return false;
    }

    // With gaps allowed, every adjacent step in the chosen run must stay
    // within (1 + maxGap). This avoids false positives like 1,2,6,7.
    if (unique.length < length) return false;

    // Try each start and extend a contiguous run in the sorted unique list.
    for (let i = 0; i <= unique.length - length; i++) {
      let run = 1;
      for (let j = i + 1; j < unique.length && run < length; j++) {
        const step = unique[j] - unique[j - 1];
        if (step <= maxGap + 1) {
          run++;
        } else {
          break;
        }
      }
      if (run >= length) return true;
    }
    return false;
  }

  /** Calculate base score for a category. */
  _calculateBase(values, category) {
    const sum = values.reduce((a, b) => a + b, 0);
    if (category.bonusType === 'multiplier') {
      return sum * category.bonusValue;
    }
    return sum + category.bonusValue;
  }

  /** Check if blind_judge passive is active (negates enemy rules). */
  _isBlindJudgeActive() {
    return this._cheating.hasPassive('blind_judge') && !this._cheating.isPassiveSealed('blind_judge');
  }
}

export { Combat };
