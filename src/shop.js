'use strict';

/**
 * Shop — manages the post-battle shop where players buy cheating abilities.
 *
 * After each battle victory, the shop opens and randomly selects items from
 * the ability pool. Players spend tokens to buy consumables, passives, or
 * dice expansions. Dice expansions have boosted weight in early rounds.
 *
 * Dependencies (injected via constructor):
 *   - dataConfig: DataConfig instance for reading ability/economy config
 *   - economy: Economy instance for spend() / canAfford()
 *   - cheating: CheatingAbilities instance for hasPassive() / addConsumable() / addPassive()
 *   - dicePool: DicePool instance for getPermanentCount() / addPermanentDie()
 *   - shopStream: RandomStream from RNG.getStream('shop')
 *   - enemy: Enemy instance for loading next round preview
 */
class Shop {
  /**
   * @param {object} opts
   * @param {import('./data-config.js').DataConfig} opts.dataConfig
   * @param {import('./economy.js').Economy} opts.economy
   * @param {import('./cheating.js').CheatingAbilities} opts.cheating
   * @param {import('./dice.js').DicePool} opts.dicePool
   * @param {import('./rng.js').RandomStream} opts.shopStream
   * @param {import('./enemy.js').Enemy} opts.enemy
   */
  constructor(opts = {}) {
    this._dataConfig = opts.dataConfig;
    this._economy = opts.economy;
    this._cheating = opts.cheating;
    this._dicePool = opts.dicePool;
    this._shopStream = opts.shopStream;
    this._enemy = opts.enemy;

    /** @type {boolean} Whether the shop is currently open */
    this._open = false;

    /** @type {number} Current round (set on open) */
    this._round = 0;

    /** @type {Array<object|null>} Displayed items (null = sold slot) */
    this._display = [];

    /** @type {object|null} Next round enemy preview */
    this._nextEnemyPreview = null;

    // Pre-load config
    this._shopConfig = null;
    this._expansionConfig = null;
  }

  // ---------------------------------------------------------------------------
  // Lifecycle
  // ---------------------------------------------------------------------------

  /**
   * Open the shop for a given round. Draws initial items.
   * @param {number} round - current round number (1-8)
   */
  open(round) {
    this._round = round;
    this._open = true;
    this._display = [];

    // Lazy-load config
    const econ = this._dataConfig.getEconomy();
    this._shopConfig = econ.shop || { itemsPerRefresh: 3, refreshCost: 1 };
    this._expansionConfig = econ.diceExpansion || { bonusRounds: [1, 2, 3], bonusWeight: 2.0 };

    // Load next round enemy preview
    const totalRounds = this._dataConfig.getGlobal().rounds?.total ?? 8;
    if (round < totalRounds) {
      this._nextEnemyPreview = this._enemy.loadPreviewForRound(round + 1);
    } else {
      this._nextEnemyPreview = null; // No next round after final
    }

    this._drawItems();
  }

  /** Close the shop. Clears display. */
  close() {
    this._open = false;
    this._display = [];
    this._round = 0;
  }

  /** Whether the shop is open. */
  isOpen() {
    return this._open;
  }

  // ---------------------------------------------------------------------------
  // Query
  // ---------------------------------------------------------------------------

  /**
   * Get currently displayed items.
   * Sold slots appear as null.
   * @returns {Array<object|null>}
   */
  getDisplayItems() {
    return this._display.map(item => (item === null ? null : { ...item }));
  }

  /**
   * Get next round enemy preview.
   * @returns {object|null} {id, name, round, targetScore, rules, isBoss}
   */
  getNextEnemyPreview() {
    return this._nextEnemyPreview ? { ...this._nextEnemyPreview } : null;
  }

  /**
   * Check if the player can afford the item at a given slot.
   * @param {number} slotIndex
   * @returns {boolean}
   */
  canBuy(slotIndex) {
    const item = this._getItem(slotIndex);
    if (!item) return false;
    return this._economy.canAfford(item.cost);
  }

  /**
   * Check if the player can afford to refresh.
   * @returns {boolean}
   */
  canRefresh() {
    const cost = this._shopConfig.refreshCost ?? 1;
    return this._economy.canAfford(cost);
  }

  // ---------------------------------------------------------------------------
  // Operations
  // ---------------------------------------------------------------------------

  /**
   * Buy the item at the given slot.
   * Deducts cost, adds ability to inventory, removes from display.
   * @param {number} slotIndex
   * @returns {boolean} success
   */
  buy(slotIndex) {
    const item = this._getItem(slotIndex);
    if (!item) return false;
    if (!this._economy.canAfford(item.cost)) return false;

    // Deduct cost
    this._economy.spend(item.cost);

    // Add to inventory based on type
    if (item.type === 'consumable') {
      this._cheating.addConsumable(item.id);
    } else if (item.type === 'passive') {
      this._cheating.addPassive(item.id, item.cost);
    } else if (item.type === 'dice_expansion') {
      const initialValue = item.params.initialValue;
      const initVal = (initialValue === 'random' || initialValue == null)
        ? undefined
        : Number(initialValue);
      this._dicePool.addPermanentDie(initVal);
    }

    // Remove from display (mark slot as sold)
    this._display[slotIndex] = null;
    return true;
  }

  /**
   * Refresh the shop display. Costs 1 token (configurable).
   * Draws a fresh set of items, replacing all current items.
   * @returns {boolean} success
   */
  refresh() {
    const cost = this._shopConfig.refreshCost ?? 1;
    if (!this._economy.canAfford(cost)) return false;

    this._economy.spend(cost);
    this._display = [];
    this._drawItems();
    return true;
  }

  // ---------------------------------------------------------------------------
  // Reset
  // ---------------------------------------------------------------------------

  /** Reset shop state for a new game. */
  reset() {
    this._open = false;
    this._round = 0;
    this._display = [];
  }

  // ---------------------------------------------------------------------------
  // Internal: item drawing
  // ---------------------------------------------------------------------------

  /** Draw items from the ability pool into the display. */
  _drawItems() {
    const candidates = this._getCandidates();
    if (candidates.length === 0) return;

    const count = Math.min(
      this._shopConfig.itemsPerRefresh ?? 3,
      candidates.length
    );

    const picked = this._weightedPickMulti(candidates, count);
    this._display = picked;
  }

  /**
   * Get candidate items for display.
   * Excludes owned passives and dice expansions when pool is full.
   * @returns {Array<object>}
   */
  _getCandidates() {
    let abilities = this._dataConfig.getAbilities();

    // Exclude owned passives
    abilities = abilities.filter(a => {
      if (a.type === 'passive') return !this._cheating.hasPassive(a.id);
      return true;
    });

    // Exclude dice expansions when pool is full
    const maxCount = this._dataConfig.getGlobal().dice?.maxCount ?? 7;
    if (this._dicePool.getPermanentCount() >= maxCount) {
      abilities = abilities.filter(a => a.type !== 'dice_expansion');
    }

    return abilities;
  }

  /**
   * Weighted random pick without replacement.
   * Dice expansions get bonus weight in early rounds.
   * @param {Array<object>} candidates
   * @param {number} count
   * @returns {Array<object>}
   */
  _weightedPickMulti(candidates, count) {
    // Build weighted entries
    const bonusRounds = this._expansionConfig.bonusRounds || [1, 2, 3];
    const bonusWeight = this._expansionConfig.bonusWeight || 2.0;

    const entries = candidates.map(item => {
      let weight = 1.0;
      if (item.type === 'dice_expansion' && bonusRounds.includes(this._round)) {
        weight = bonusWeight;
      }
      return { item, weight };
    });

    // Pick without replacement
    const result = [];
    const remaining = [...entries];

    for (let i = 0; i < count && remaining.length > 0; i++) {
      const picked = this._weightedPickOne(remaining);
      result.push(picked.item);
      // Remove picked from remaining
      const idx = remaining.indexOf(picked);
      remaining.splice(idx, 1);
    }

    return result;
  }

  /**
   * Single weighted random pick from an array of {item, weight}.
   * @param {Array<{item: object, weight: number}>} entries
   * @returns {{item: object, weight: number}}
   */
  _weightedPickOne(entries) {
    let totalWeight = 0;
    for (const e of entries) {
      totalWeight += Math.max(0, e.weight);
    }

    if (totalWeight === 0) {
      // Uniform fallback
      return entries[this._shopStream.nextInt(0, entries.length - 1)];
    }

    let roll = this._shopStream.nextFloat() * totalWeight;
    for (const e of entries) {
      roll -= Math.max(0, e.weight);
      if (roll < 0) return e;
    }
    return entries[entries.length - 1];
  }

  /**
   * Get item at slot, validating index and that slot isn't sold.
   * @param {number} slotIndex
   * @returns {object|null}
   */
  _getItem(slotIndex) {
    if (slotIndex < 0 || slotIndex >= this._display.length) return null;
    return this._display[slotIndex];
  }
}

export { Shop };
