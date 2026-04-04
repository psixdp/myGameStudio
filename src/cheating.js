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
   * @param {string} abilityId - ability ID
   * @param {number} actualCost - actual cost paid (for seal judgment)
   * @returns {boolean} success (false if already owned)
   */
  addPassive(abilityId, actualCost) {
    // Check for duplicate
    if (this.hasPassive(abilityId)) return false;

    const ability = this._dataConfig.getAbility(abilityId);
    if (!ability || ability.type !== 'passive') return false;

    this._passives.push({ ...ability, actualCost });
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
  }

  // ---------------------------------------------------------------------------
  // Sealed Passive (Enemy Rule)
  // ---------------------------------------------------------------------------

  /**
   * Seal the most expensive passive (enemy rule).
   * If multiple passives share the highest cost, randomly pick one.
   */
  sealMostExpensivePassive() {
    if (this._passives.length === 0) {
      this._sealedPassiveId = null;
      return;
    }

    // Find highest cost
    let maxCost = -1;
    for (const p of this._passives) {
      if (p.actualCost > maxCost) maxCost = p.actualCost;
    }

    // Collect all with max cost
    const candidates = this._passives.filter(p => p.actualCost === maxCost);

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
    }

    // 透视 (insight) - weakness category bonus
    if (this._weaknessCategory && matchedCategory.id === this._weaknessCategory) {
      total += 10; // fixed bonus from insight
    }

    return total;
  }

  /**
   * Calculate total multiplier from all passives.
   * Multipliers are multiplied together (product, not sum).
   * @returns {number} total multiplier (1.0 if none)
   */
  getMultipliers() {
    let product = 1.0;

    for (const passive of this._passives) {
      if (this.isPassiveSealed(passive.id)) continue;

      if (passive.effectType === 'score_multiplier') {
        product *= passive.params.multiplier || 1.0;
      }
    }

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
  }
}

module.exports = { CheatingAbilities };
