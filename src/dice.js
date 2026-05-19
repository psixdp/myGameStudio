'use strict';

/**
 * DicePool — manages an ordered pool of dice with roll, rewrite, and temp-die support.
 *
 * Dependencies (injected via constructor):
 *   - diceStream: RandomStream from RNG.getStream('dice')
 *   - cloneStream: RandomStream from RNG.getStream('clone')
 *   - config: { minFace, maxFace, initialCount, maxCount }
 */
class DicePool {
  /**
   * @param {object} opts
   * @param {import('./rng.js').RandomStream} opts.diceStream
   * @param {import('./rng.js').RandomStream} opts.cloneStream
   * @param {number} opts.minFace - lowest face value (default 1)
   * @param {number} opts.maxFace - highest face value (default 6)
   * @param {number} opts.initialCount - starting dice count (default 4)
   * @param {number} opts.maxCount - permanent dice cap (default 7)
   */
  constructor(opts = {}) {
    this._diceStream = opts.diceStream;
    this._cloneStream = opts.cloneStream;
    this._minFace = opts.minFace ?? 1;
    this._maxFace = opts.maxFace ?? 6;
    this._initialCount = opts.initialCount ?? 4;
    this._maxCount = opts.maxCount ?? 7;

    /** @type {Array<{value: number, isTemp: boolean, isFrozen: boolean}>} */
    this._dice = [];
    this._rolled = false;

    // Create initial dice (un-rolled, value 0)
    for (let i = 0; i < this._initialCount; i++) {
      this._dice.push({ value: 0, isTemp: false, isFrozen: false, isHeld: false });
    }
  }

  // ---------------------------------------------------------------------------
  // Read-only accessors
  // ---------------------------------------------------------------------------

  /** Current dice values (including temp). Each entry: {value, isTemp}. */
  getDice() {
    return this._dice.map(d => ({ ...d }));
  }

  /** Dice values as a flat number array (for scoring convenience). */
  getValues() {
    return this._dice.map(d => d.value);
  }

  /** Number of permanent dice (excl. temp). */
  getPermanentCount() {
    return this._dice.filter(d => !d.isTemp).length;
  }

  /** Total dice count (incl. temp). */
  getTotalCount() {
    return this._dice.length;
  }

  /** Whether roll() has been called at least once. */
  isRolled() {
    return this._rolled;
  }

  // ---------------------------------------------------------------------------
  // Hold / Reroll (留骰/重掷)
  // ---------------------------------------------------------------------------

  /**
   * Mark dice as "held" (to be kept during reroll).
   * Temporary dice (isTemp) cannot be held.
   * @param {number[]} indices - indices to hold
   */
  hold(indices) {
    for (const i of indices) {
      if (i < 0 || i >= this._dice.length) continue;
      if (this._dice[i].isTemp) continue;
      this._dice[i].isHeld = true;
    }
  }

  /**
   * Reroll all dice that are NOT held (and not frozen).
   * Uses the dice random stream.
   */
  rerollUnheld() {
    for (const die of this._dice) {
      if (die.isHeld || die.isFrozen) continue;
      die.value = this._diceStream.nextInt(this._minFace, this._maxFace);
    }
  }

  /**
   * Clear all held states (call at start of each round).
   */
  clearHolds() {
    for (const die of this._dice) {
      die.isHeld = false;
    }
  }

  /**
   * Get indices of currently held dice.
   * @returns {number[]}
   */
  getHeldIndices() {
    const held = [];
    for (let i = 0; i < this._dice.length; i++) {
      if (this._dice[i].isHeld) held.push(i);
    }
    return held;
  }

  // ---------------------------------------------------------------------------
  // Roll
  // ---------------------------------------------------------------------------

  /**
   * Roll all dice (atomic — all at once).
   * Resets to un-rolled state first if needed.
   * Frozen dice are skipped and retain their values.
   */
  roll() {
    for (const die of this._dice) {
      if (die.isFrozen) continue; // Skip frozen dice
      die.value = this._diceStream.nextInt(this._minFace, this._maxFace);
    }
    this._rolled = true;
  }

  // ---------------------------------------------------------------------------
  // Rewrite operations (called by abilities & enemy rules)
  // ---------------------------------------------------------------------------

  /**
   * Set a specific die to an exact value (clamped to face range).
   * @param {number} index - 0-based
   * @param {number} value
   */
  setDie(index, value) {
    if (index < 0 || index >= this._dice.length) return;
    this._dice[index].value = this._clampFace(value);
  }

  /**
   * Reroll a specific die, guaranteeing result >= minValue.
   * @param {number} index
   * @param {number} minValue
   */
  rerollDie(index, minValue) {
    if (index < 0 || index >= this._dice.length) return;
    const lo = Math.max(this._minFace, minValue);
    this._dice[index].value = this._diceStream.nextInt(lo, this._maxFace);
  }

  /**
   * Reroll a random subset of dice (used by enemy "狸猫换子").
   * @param {number} count - how many dice to reroll
   */
  rerollRandom(count) {
    const indices = this._dice.map((_, i) => i);
    // Fisher-Yates partial shuffle to pick `count` random indices
    for (let i = indices.length - 1; i > 0 && count > 0; i--) {
      const j = this._diceStream.nextInt(0, i);
      [indices[i], indices[j]] = [indices[j], indices[i]];
    }
    const chosen = indices.slice(-count);
    for (const idx of chosen) {
      this._dice[idx].value = this._diceStream.nextInt(this._minFace, this._maxFace);
    }
  }

  /**
   * Set a floor for all dice values (铅骰 passive).
   * @param {number} minValue
   */
  setFloor(minValue) {
    for (const die of this._dice) {
      if (die.value < minValue) die.value = minValue;
    }
  }

  /**
   * Decrease all dice by amount, with a floor (全面压制 enemy rule).
   * @param {number} amount
   * @param {number} floor - minimum value after decrease
   */
  decreaseAll(amount, floor) {
    for (const die of this._dice) {
      die.value = Math.max(floor, die.value - amount);
    }
  }

  /**
   * Replace the lowest-value die with a given value (偷梁换柱 consumable).
   * If multiple dice share the lowest value, replaces the first one.
   * @param {number} value
   */
  replaceLowest(value) {
    if (this._dice.length === 0) return;
    let minIdx = 0;
    for (let i = 1; i < this._dice.length; i++) {
      if (this._dice[i].value < this._dice[minIdx].value) minIdx = i;
    }
    this._dice[minIdx].value = this._clampFace(value);
  }

  /**
   * Add a temporary die with a random value (分身术).
   * Temp dice can exceed maxCount (up to maxCount + 1).
   * Uses the clone stream, not the dice stream.
   * @returns {boolean} success
   */
  addTempDie() {
    // Allow one beyond max
    if (this._dice.length >= this._maxCount + 1) return false;
    const value = this._cloneStream.nextInt(this._minFace, this._maxFace);
    this._dice.push({ value, isTemp: true, isFrozen: false, isHeld: false });
    return true;
  }

  /**
   * Add a permanent die (备用骰/千王骰 from shop).
   * @param {number} [initialValue] - optional fixed initial value
   * @returns {boolean} success (false if pool is full)
   */
  addPermanentDie(initialValue) {
    if (this.getPermanentCount() >= this._maxCount) return false;
    const value = initialValue ?? 0;
    this._dice.push({ value: this._clampFace(value), isTemp: false, isFrozen: false, isHeld: false });
    return true;
  }

  /**
   * Swap values of two dice (换位 consumable).
   * @param {number} index1 - 0-based index of first die
   * @param {number} index2 - 0-based index of second die
   */
  swapDice(index1, index2) {
    if (index1 < 0 || index1 >= this._dice.length) return;
    if (index2 < 0 || index2 >= this._dice.length) return;
    const temp = this._dice[index1].value;
    this._dice[index1].value = this._dice[index2].value;
    this._dice[index2].value = temp;
  }

  /**
   * Invert a die's value (反转 consumable).
   * Value becomes (sumValue - originalValue), e.g., 7-1=6, 7-3=4.
   * @param {number} index - 0-based index
   * @param {number} sumValue - sum value for inversion (default 7 for 6-sided dice)
   */
  invertDie(index, sumValue = 7) {
    if (index < 0 || index >= this._dice.length) return;
    const current = this._dice[index].value;
    this._dice[index].value = this._clampFace(sumValue - current);
  }

  /**
   * Freeze a die so it retains its value in the next roll (冻结 consumable).
   * @param {number} index - 0-based index
   */
  freezeDie(index) {
    if (index < 0 || index >= this._dice.length) return;
    this._dice[index].isFrozen = true;
  }

  /**
   * Clear frozen state from all dice (call at start of each roll).
   * Frozen dice will be rolled normally next time.
   */
  clearFrozenDice() {
    for (const die of this._dice) {
      die.isFrozen = false;
    }
  }

  // ---------------------------------------------------------------------------
  // Temp die cleanup
  // ---------------------------------------------------------------------------

  /** Remove all temporary dice. Call after each round's scoring. */
  clearTempDice() {
    this._dice = this._dice.filter(d => !d.isTemp);
  }

  // ---------------------------------------------------------------------------
  // Internal
  // ---------------------------------------------------------------------------

  _clampFace(value) {
    return Math.max(this._minFace, Math.min(this._maxFace, value));
  }
}

export { DicePool };
