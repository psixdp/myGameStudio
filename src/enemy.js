'use strict';

/**
 * Enemy — manages the enemy entity for the current round.
 *
 * The enemy system is a "rule provider" not a "rule executor" — it loads
 * enemy data and exposes rule information for the combat system to apply.
 *
 * Dependencies (injected via constructor):
 *   - dataConfig: DataConfig instance for reading enemy data
 *   - enemyStream: RandomStream from RNG.getStream('enemy') for boss rules
 */
class Enemy {
  /**
   * @param {object} opts
   * @param {import('./data-config.js').DataConfig} opts.dataConfig
   * @param {import('./rng.js').RandomStream} opts.enemyStream
   */
  constructor(opts = {}) {
    this._dataConfig = opts.dataConfig;
    this._enemyStream = opts.enemyStream;

    /** @type {object|null} Current enemy data */
    this._current = null;

    /** @type {Array<object>} Resolved rule definitions for current enemy */
    this._rules = [];
  }

  // ---------------------------------------------------------------------------
  // Loading
  // ---------------------------------------------------------------------------

  /**
   * Load enemy for a specific round.
   * For boss (round 8), randomly selects rules from the pool.
   * @param {number} round - round number (1-8)
   */
  loadForRound(round) {
    const enemy = this._dataConfig.getEnemy(round);
    if (!enemy) {
      throw new Error(`No enemy found for round ${round}`);
    }

    this._current = enemy;

    // Handle boss random rules
    if (enemy.bossRule) {
      this._loadBossRules(enemy.bossRule);
    } else {
      this._loadFixedRules(enemy.rules);
    }
  }

  /**
   * Load fixed rules by ID.
   * @param {string[]} ruleIds
   */
  _loadFixedRules(ruleIds) {
    this._rules = ruleIds.map(id => this._dataConfig.getEnemyRule(id)).filter(r => r != null);
  }

  /**
   * Load random boss rules from pool.
   * @param {object} bossRuleConfig - {pool: "all", count: number}
   */
  _loadBossRules(bossRuleConfig) {
    const allRules = this._dataConfig.getEnemyRules();
    const count = bossRuleConfig.count || 2;

    // Randomly pick 'count' unique rules
    const selected = [];
    const available = [...allRules]; // copy
    for (let i = 0; i < count && available.length > 0; i++) {
      const idx = this._enemyStream.nextInt(0, available.length - 1);
      selected.push(available[idx]);
      available.splice(idx, 1); // remove to avoid duplicates
    }
    this._rules = selected;
  }

  // ---------------------------------------------------------------------------
  // Query
  // ---------------------------------------------------------------------------

  /** Get current enemy ID. */
  getId() {
    return this._current?.id ?? null;
  }

  /** Get current enemy name. */
  getName() {
    return this._current?.name ?? '';
  }

  /** Get target score for this round. */
  getTargetScore() {
    return this._current?.targetScore ?? 0;
  }

  /** Get round number (1-based). */
  getRound() {
    return this._current?.round ?? 0;
  }

  /** Check if current enemy is boss (round 8). */
  isBoss() {
    return this._current?.bossRule != null;
  }

  /**
   * Get all active rule definitions for this enemy.
   * Each rule contains id, name, description, effectType, params.
   */
  getRules() {
    return this._rules.map(r => ({ ...r }));
  }

  /**
   * Check if enemy has a specific rule by effect type.
   * @param {string} effectType - e.g. "block_category", "reroll_random"
   * @returns {boolean}
   */
  hasRuleType(effectType) {
    return this._rules.some(r => r.effectType === effectType);
  }

  /**
   * Get first rule with specific effect type.
   * @param {string} effectType
   * @returns {object|null} rule definition with params
   */
  getRuleByType(effectType) {
    const rule = this._rules.find(r => r.effectType === effectType);
    if (!rule) return null;
    // Deep copy to prevent external modification
    return {
      id: rule.id,
      name: rule.name,
      description: rule.description,
      effectType: rule.effectType,
      targetCategory: rule.targetCategory,
      params: rule.params ? { ...rule.params } : undefined
    };
  }

  /**
   * Get categories blocked by enemy rules.
   * Used by scoring system to skip matching these categories.
   * @returns {string[]} array of category IDs (e.g. ["pair"])
   */
  getBlockedCategories() {
    const blocked = [];
    for (const rule of this._rules) {
      if (rule.effectType === 'block_category' && rule.targetCategory) {
        blocked.push(rule.targetCategory);
      }
    }
    return blocked;
  }

  /**
   * Check if enemy has "zero_lowest_dice" rule.
   * Used by scoring system to zero out lowest die in base score.
   * @returns {boolean}
   */
  hasZeroLowestRule() {
    return this.hasRuleType('zero_lowest_dice');
  }

  /**
   * Get params for "reroll_random" rule (狸猫换子).
   * Used by combat system to trigger dice reroll.
   * @returns {{count: number, phase: string}|null}
   */
  getRerollParams() {
    const rule = this.getRuleByType('reroll_random');
    return rule?.params ?? null;
  }

  /**
   * Check if enemy has "seal_most_expensive_passive" rule.
   * Used by cheating system to disable most expensive passive.
   * @returns {boolean}
   */
  hasSealPassiveRule() {
    return this.hasRuleType('seal_most_expensive_passive');
  }

  /**
   * Get params for "dice_decrease" rule (全面压制).
   * Used by combat system to decrease all dice values.
   * @returns {{amount: number, minValue: number}|null}
   */
  getDecreaseParams() {
    const rule = this.getRuleByType('dice_decrease');
    return rule?.params ?? null;
  }

  // ---------------------------------------------------------------------------
  // Reset
  // ---------------------------------------------------------------------------

  /** Clear current enemy (for new game). */
  reset() {
    this._current = null;
    this._rules = [];
  }
}

module.exports = { Enemy };
