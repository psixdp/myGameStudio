'use strict';

/**
 * Economy — manages player's token balance.
 *
 * Tokens are the game's sole currency, earned by defeating enemies
 * and spent in the shop to buy cheating abilities.
 *
 * Dependencies (injected via constructor):
 *   - dataConfig: DataConfig instance for reading token rewards
 */
class Economy {
  /**
   * @param {object} opts
   * @param {import('./data-config.js').DataConfig} opts.dataConfig
   */
  constructor(opts = {}) {
    this._dataConfig = opts.dataConfig;

    /** @type {number} Current token balance (non-negative integer) */
    this._balance = 0;
  }

  // ---------------------------------------------------------------------------
  // Query
  // ---------------------------------------------------------------------------

  /** Current token balance. */
  getBalance() {
    return this._balance;
  }

  /** Check if player can afford a cost. */
  canAfford(cost) {
    return this._balance >= cost;
  }

  // ---------------------------------------------------------------------------
  // Operations
  // ---------------------------------------------------------------------------

  /**
   * Add tokens to balance (called after winning a battle).
   * @param {number} amount - tokens to earn (must be >= 0)
   * @returns {number} new balance
   */
  earn(amount) {
    if (amount < 0) throw new Error('earn() requires non-negative amount');
    this._balance += amount;
    return this._balance;
  }

  /**
   * Spend tokens if affordable.
   * @param {number} cost - tokens to spend (must be >= 0)
   * @returns {boolean} true if spent successfully, false if insufficient balance
   */
  spend(cost) {
    if (cost < 0) throw new Error('spend() requires non-negative cost');
    if (!this.canAfford(cost)) return false;
    this._balance -= cost;
    return true;
  }

  /**
   * Reset balance to zero (called at start of each new run).
   */
  reset() {
    this._balance = 0;
  }

  // ---------------------------------------------------------------------------
  // Convenience helpers
  // ---------------------------------------------------------------------------

  /**
   * Get token reward for a specific round (1-based).
   * Delegates to dataConfig.getTokenReward().
   * @param {number} round - round number (1-8)
   * @returns {number} token reward for this round
   */
  getRewardForRound(round) {
    return this._dataConfig.getTokenReward(round);
  }

  /**
   * Calculate cumulative tokens through a given round.
   * @param {number} round - round number (1-8)
   * @returns {number} total tokens earned from round 1 to this round
   */
  getCumulativeReward(round) {
    let total = 0;
    for (let r = 1; r <= round; r++) {
      total += this.getRewardForRound(r);
    }
    return total;
  }

  /**
   * Calculate purchasing power (how many items can be bought).
   * @param {number} avgItemCost - average cost of items in shop
   * @returns {number} estimated number of affordable items
   */
  getPurchasingPower(avgItemCost) {
    if (avgItemCost <= 0) return Infinity;
    return Math.floor(this._balance / avgItemCost);
  }
}

module.exports = { Economy };
