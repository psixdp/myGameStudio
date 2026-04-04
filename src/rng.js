'use strict';

/**
 * mulberry32 — fast, deterministic 32-bit PRNG.
 * Returns a raw integer in [0, 2^32).
 */
function mulberry32(seed) {
  return function () {
    seed |= 0;
    seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0);
  };
}

/**
 * Simple string hash to derive sub-seeds from stream names.
 * cyrb53 variant — good distribution for short strings.
 */
function hashString(str) {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)) >>> 0;
}

/**
 * RandomStream — an independent PRNG stream derived from a sub-seed.
 * Each game subsystem gets its own stream so they never interfere.
 */
class RandomStream {
  constructor(subSeed) {
    this._next = mulberry32(subSeed);
  }

  /**
   * Returns an integer in [min, max] (inclusive both ends).
   * @param {number} min
   * @param {number} max
   * @returns {number}
   */
  nextInt(min, max) {
    if (min > max) { const tmp = min; min = max; max = tmp; }
    const range = max - min + 1;
    return min + Math.floor(this._next() / 4294967296 * range);
  }

  /**
   * Returns a float in [0, 1).
   * @returns {number}
   */
  nextFloat() {
    return this._next() / 4294967296;
  }

  /**
   * Pick a random element from an array.
   * @param {Array} arr
   * @returns {*} element or null if empty
   */
  pick(arr) {
    if (!arr || arr.length === 0) return null;
    return arr[this.nextInt(0, arr.length - 1)];
  }

  /**
   * Fisher-Yates shuffle. Returns a new array (does not mutate input).
   * @param {Array} arr
   * @returns {Array}
   */
  shuffle(arr) {
    const result = [...arr];
    for (let i = result.length - 1; i > 0; i--) {
      const j = this.nextInt(0, i);
      const tmp = result[i];
      result[i] = result[j];
      result[j] = tmp;
    }
    return result;
  }

  /**
   * Weighted random pick from an array of objects.
   * @param {Array<object>} items - array of objects
   * @param {string} key - property name holding the weight (positive number)
   * @returns {*} picked item or null if empty
   */
  weightedPick(items, key) {
    if (!items || items.length === 0) return null;

    let totalWeight = 0;
    for (const item of items) {
      totalWeight += Math.max(0, Number(item[key]) || 0);
    }

    // All zero weights → uniform fallback
    if (totalWeight === 0) return this.pick(items);

    let roll = this.nextFloat() * totalWeight;
    for (const item of items) {
      roll -= Math.max(0, Number(item[key]) || 0);
      if (roll < 0) return item;
    }
    // Floating point guard — return last item
    return items[items.length - 1];
  }
}

/**
 * RNG — top-level random number manager.
 *
 * Usage:
 *   RNG.seed(42);
 *   const diceRng = RNG.getStream('dice');
 *   diceRng.nextInt(1, 6);
 */
class RNG {
  constructor() {
    this._streams = {};
    this._seeded = false;
    this._mainSeed = null;
  }

  /**
   * Initialize with a main seed. Derives independent sub-streams on demand.
   * @param {number} seed - any number; normalized to positive integer
   */
  seed(seed) {
    this._mainSeed = (Math.abs(Math.floor(seed)) || 1) + 1;
    this._streams = {};
    this._seeded = true;
  }

  /**
   * Get or create an independent random stream by name.
   * @param {string} name - stream identifier (e.g. 'dice', 'shop')
   * @returns {RandomStream}
   */
  getStream(name) {
    if (!this._seeded) {
      throw new Error('RNG not seeded');
    }
    if (!this._streams[name]) {
      const subSeed = (this._mainSeed + hashString(name)) >>> 0;
      this._streams[name] = new RandomStream(subSeed);
    }
    return this._streams[name];
  }

  /** Whether seed() has been called. */
  isSeeded() {
    return this._seeded;
  }

  /** Get the normalized main seed (for display/debug). */
  getMainSeed() {
    return this._mainSeed;
  }
}

module.exports = { RNG, RandomStream, mulberry32, hashString };
