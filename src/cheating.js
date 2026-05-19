'use strict';

/**
 * CheatingAbilities — manages consumables, passives, and dice expansions.
 *
 * This is the "cheat toolbox" — players buy abilities from shops to break
 * the dice rules. Consumables are used per-round, passives last all game.
 *
 * Dependencies (injected via constructor):
 *   - dataConfig: DataConfig instance for reading ability definitions
 *   - economy: Economy instance for checking affordability
 *   - cloneStream: RandomStream from RNG.getStream('clone') for tie-breaking seals
 */
class CheatingAbilities {
  /**
   * @param {object} opts
   * @param {import('./data-config.js').DataConfig} opts.dataConfig
   * @param {import('./economy.js').Economy} opts.economy
   * @param {import('./rng.js').RandomStream} opts.cloneStream
   */
  constructor(opts = {}) {
    this._dataConfig = opts.dataConfig;
    this._economy = opts.economy;
    this._cloneStream = opts.cloneStream;

    /** @type {Array<object>} Consumables in inventory */
    this._consumableSlots = [];

    /** @type {Array<object>} Owned passive abilities with actual cost paid */
    this._passives = [];

    /** @type {number} Consumables used this round (reset each round) */
    this._usedThisRound = 0;

    /** @type {number} Max consumables per round */
    this._maxPerRound = 2;

    /** @type {string|null} ID of sealed passive (by enemy rule) */
    this._sealedPassiveId = null;

    /** @type {string|null} Weakness category revealed by insight consumable */
    this._weaknessCategory = null;

    /** @type {number} Temporary round multiplier (from consumables like 魔鬼契约) */
    this._roundMultiplier = 1.0;

    /** @type {number} Temporary round flat bonus (from consumables like 孤注一掷) */
    this._roundFlatBonus = 0;

    /** @type {number} Target score increase ratio for next round (from 魔鬼契约) */
    this._nextRoundTargetIncrease = 0;
  }

  // ---------------------------------------------------------------------------
  // Query
  // ---------------------------------------------------------------------------

  /** Get all consumables in slots. */
  getConsumables() {
    return this._consumableSlots.map(c => ({ ...c }));
  }

  /** Get all owned passives. */
  getPassives() {
    return this._passives.map(p => ({ ...p }));
  }

  /** Get current passive count. */
  getPassiveCount() {
    return this._passives.length;
  }

  /**
   * Remove a passive by index.
   * @param {number} index - index in _passives array
   * @returns {object|null} removed passive, or null if invalid index
   */
  removePassive(index) {
    if (index < 0 || index >= this._passives.length) return null;
    return this._passives.splice(index, 1)[0];
  }

  /** Check if player has a specific passive by ID. */
  hasPassive(id) {
    return this._passives.some(p => p.id === id);
  }

  /** Get number of consumables used this round. */
  getUsedCount() {
    return this._usedThisRound;
  }

  /** Check if can use another consumable this round. */
  canUseConsumable() {
    return this._usedThisRound < this._maxPerRound;
  }

  /** Get weakness category (revealed by insight). */
  getWeaknessCategory() {
    return this._weaknessCategory;
  }

  // ---------------------------------------------------------------------------
  // Acquisition
  // ---------------------------------------------------------------------------

  /**
   * Add a consumable to inventory (from shop or starting gift).
   * @param {string} abilityId - ability ID from abilities.json
   * @returns {boolean} success
   */
  addConsumable(abilityId) {
    const ability = this._dataConfig.getAbility(abilityId);
    if (!ability || ability.type !== 'consumable') return false;

    this._consumableSlots.push({ ...ability });
    return true;
  }

  /**
   * Add a passive ability (from shop).
   * Cannot own duplicates of the same passive.
   * For decree_override (强夺令), randomize the forced category.
   * @param {string} abilityId - ability ID
   * @param {number} actualCost - actual cost paid (for seal judgment)
   * @returns {boolean} success (false if already owned)
   */
  addPassive(abilityId, actualCost) {
    // Check for duplicate
    if (this.hasPassive(abilityId)) return false;

    const ability = this._dataConfig.getAbility(abilityId);
    if (!ability || ability.type !== 'passive') return false;

    const passiveToAdd = { ...ability, actualCost };

    // Special handling for decree_override: randomize forced category
    if (abilityId === 'decree_override') {
      const categories = this._dataConfig.getCategories().filter(c => c.matchType !== 'fallback');
      if (categories.length > 0) {
        const idx = this._cloneStream.nextInt(0, categories.length - 1);
        const forcedCat = categories[idx];
        passiveToAdd.params = {
          ...ability.params,
          forceCategory: forcedCat.id,
          forcedCategoryName: forcedCat.name  // For UI display
        };
      }
    }

    this._passives.push(passiveToAdd);
    return true;
  }

  // ---------------------------------------------------------------------------
  // Consumable Usage
  // ---------------------------------------------------------------------------

  /**
   * Use a consumable from inventory.
   * Returns the ability definition with effectType and params.
   * @param {number} slotIndex - index in consumableSlots
   * @returns {object|null} ability definition if used, null if failed
   */
  useConsumable(slotIndex) {
    if (slotIndex < 0 || slotIndex >= this._consumableSlots.length) return null;
    if (!this.canUseConsumable()) return null;

    const ability = this._consumableSlots[slotIndex];
    this._consumableSlots.splice(slotIndex, 1);
    this._usedThisRound++;

    // Handle reveal_weakness (透视) immediately
    if (ability.effectType === 'reveal_weakness') {
      // Randomly pick a scoring category as weakness
      const categories = this._dataConfig.getCategories().filter(c => c.matchType !== 'fallback');
      if (categories.length > 0) {
        const idx = this._cloneStream.nextInt(0, categories.length - 1);
        this._weaknessCategory = categories[idx].id;
      }
    }

    return { ...ability };
  }

  /**
   * Reset round state (call at start of each round).
   */
  resetRoundState() {
    this._usedThisRound = 0;
    this._weaknessCategory = null;
    this._roundMultiplier = 1.0;
    this._roundFlatBonus = 0;
  }

  /**
   * Get and consume next round target increase (from 魔鬼契约).
   * Returns the increase ratio and resets it to 0.
   * @returns {number} increase ratio (e.g. 0.25 for +25%)
   */
  consumeNextRoundTargetIncrease() {
    const increase = this._nextRoundTargetIncrease;
    this._nextRoundTargetIncrease = 0;
    return increase;
  }

  /**
   * Add temporary round multiplier (from consumable).
   * @param {number} multiplier
   */
  addRoundMultiplier(multiplier) {
    this._roundMultiplier *= multiplier;
  }

  /**
   * Add next round target increase (from consumable).
   * @param {number} increase - ratio (e.g. 0.25 for +25%)
   */
  addNextRoundTargetIncrease(increase) {
    this._nextRoundTargetIncrease += increase;
  }

  /**
   * Sacrifice all remaining consumables, returning the count destroyed.
   * @returns {number} number of consumables destroyed
   */
  sacrificeAllConsumables() {
    const count = this._consumableSlots.length;
    this._consumableSlots = [];
    return count;
  }

  /**
   * Add temporary round flat bonus (from consumable).
   * @param {number} bonus
   */
  addRoundFlatBonus(bonus) {
    this._roundFlatBonus += bonus;
  }

  // ---------------------------------------------------------------------------
  // Sealed Passive (Enemy Rule)
  // ---------------------------------------------------------------------------

  /**
   * Seal the most expensive passive (enemy rule).
   * If multiple passives share the highest cost, randomly pick one.
   * Passives with unsealable: true are excluded from sealing.
   */
  sealMostExpensivePassive() {
    if (this._passives.length === 0) {
      this._sealedPassiveId = null;
      return;
    }

    // Filter out unsealable passives - rule break!
    const sealable = this._passives.filter(p => {
      const def = this._dataConfig.getAbility(p.id);
      return def && !def.unsealable;
    });

    if (sealable.length === 0) {
      this._sealedPassiveId = null;
      return;
    }

    // Find highest cost among sealable passives
    let maxCost = -1;
    for (const p of sealable) {
      if (p.actualCost > maxCost) maxCost = p.actualCost;
    }

    // Collect all with max cost
    const candidates = sealable.filter(p => p.actualCost === maxCost);

    // Pick one (randomly if multiple)
    const sealed = candidates.length === 1
      ? candidates[0]
      : candidates[this._cloneStream.nextInt(0, candidates.length - 1)];

    this._sealedPassiveId = sealed.id;
  }

  /** Clear sealed passive (call at start of each round). */
  clearSealedPassive() {
    this._sealedPassiveId = null;
  }

  /**
   * Check if a passive is sealed.
   * @param {string} passiveId
   * @returns {boolean}
   */
  isPassiveSealed(passiveId) {
    return this._sealedPassiveId === passiveId;
  }

  // ---------------------------------------------------------------------------
  // Bonus Calculation (for Scoring System)
  // ---------------------------------------------------------------------------

  /**
   * Calculate flat bonuses for a matched category.
   * @param {object} matchedCategory - category definition
   * @param {import('./dice.js').DicePool} dicePool - current dice state
   * @param {number} matchedCount - how many dice matched the category
   * @returns {number} total flat bonus
   */
  getFlatBonuses(matchedCategory, dicePool, matchedCount) {
    let total = 0;

    for (const passive of this._passives) {
      if (this.isPassiveSealed(passive.id)) continue;

      // 连横术 (chain_link) - excess bonus
      if (passive.effectType === 'excess_bonus') {
        const minDice = matchedCategory.minDice || 0;
        if (matchedCount > minDice) {
          const excess = matchedCount - minDice;
          total += excess * (passive.params.perExcess || 0);
        }
      }

      // 牌型大师 (pattern_master) - category bonus
      if (passive.effectType === 'category_bonus') {
        const cats = passive.params.categories || [];
        if (cats.includes(matchedCategory.id)) {
          total += passive.params.bonus || 0;
        }
      }

      // 天降骰 (heaven_dice) - universal flat bonus
      if (passive.effectType === 'flat_bonus') {
        total += passive.params.bonus || 0;
      }

      // 双重视界 (double_vision) - pair value bonus
      if (passive.effectType === 'pair_value_bonus') {
        if (matchedCategory.id === 'pair' || matchedCategory.matchType === 'same_value') {
          const values = dicePool.getValues();
          const freq = {};
          for (const v of values) freq[v] = (freq[v] || 0) + 1;
          const mult = passive.params.perPairMultiplier || 3;
          for (const [val, count] of Object.entries(freq)) {
            if (count >= 2) {
              total += Number(val) * mult;
            }
          }
        }
      }

      // 七彩奖励 (rainbow) - scatter diversity bonus
      if (passive.effectType === 'scatter_diversity_bonus') {
        if (matchedCategory.id === 'bust' || matchedCategory.matchType === 'fallback') {
          const values = dicePool.getValues();
          const uniqueCount = new Set(values).size;
          total += uniqueCount * (passive.params.perUnique || 6);
        }
      }

      // 众骰之力 (dice_army) - per-die flat bonus
      if (passive.effectType === 'dice_count_bonus') {
        const diceCount = dicePool.getValues().length;
        total += diceCount * (passive.params.perDie || 4);
      }
    }

    // 透视 (insight) - weakness category bonus
    if (this._weaknessCategory && matchedCategory.id === this._weaknessCategory) {
      total += 10; // fixed bonus from insight
    }

    // Temporary round flat bonus (from consumables like 孤注一掷)
    total += this._roundFlatBonus;

    return total;
  }

  /**
   * Calculate total multiplier from all passives.
   * Multipliers are multiplied together (product, not sum).
   * @param {object} [matchedCategory] - matched category (for conditional multipliers)
   * @param {object} [dicePool] - dice pool (for conditional multipliers)
   * @returns {number} total multiplier (1.0 if none)
   */
  getMultipliers(matchedCategory = null, dicePool = null) {
    let product = 1.0;

    for (const passive of this._passives) {
      if (this.isPassiveSealed(passive.id)) continue;

      if (passive.effectType === 'score_multiplier') {
        product *= passive.params.multiplier || 1.0;
      }

      // 完美主义者 (perfectionist) - all dice >= minValue
      if (passive.effectType === 'high_dice_multiplier' && dicePool) {
        const minVal = passive.params.minValue || 4;
        const values = dicePool.getValues();
        if (values.length > 0 && values.every(v => v >= minVal)) {
          product *= passive.params.multiplier || 1.5;
        }
      }

      // 顺势而为 (straight_momentum) - straight categories
      if (passive.effectType === 'straight_multiplier' && matchedCategory) {
        const cats = passive.params.categories || [];
        if (cats.includes(matchedCategory.id)) {
          product *= passive.params.multiplier || 1.6;
        }
      }

      // 逢六大吉 (lucky_six) - per-six multiplier
      if (passive.effectType === 'six_count_multiplier' && dicePool) {
        const values = dicePool.getValues();
        const sixCount = values.filter(v => v === 6).length;
        if (sixCount > 0) {
          const perSix = passive.params.perSixMultiplier || 1.15;
          product *= Math.pow(perSix, sixCount);
        }
      }
    }

    // Temporary round multiplier (from consumables like 魔鬼契约)
    product *= this._roundMultiplier;

    return product;
  }

  /**
   * Get passive by effect type.
   * Useful for combat system to apply dice modifications.
   * @param {string} effectType
   * @returns {object|null} passive definition if not sealed
   */
  getPassiveByEffect(effectType) {
    for (const p of this._passives) {
      if (p.effectType === effectType && !this.isPassiveSealed(p.id)) {
        return { ...p };
      }
    }
    return null;
  }

  // ---------------------------------------------------------------------------
  // Reset
  // ---------------------------------------------------------------------------

  /** Reset all state (new game). */
  reset() {
    this._consumableSlots = [];
    this._passives = [];
    this._usedThisRound = 0;
    this._sealedPassiveId = null;
    this._weaknessCategory = null;
    this._roundMultiplier = 1.0;
    this._roundFlatBonus = 0;
    this._nextRoundTargetIncrease = 0;
  }
}

export { CheatingAbilities };
