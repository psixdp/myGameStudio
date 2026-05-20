'use strict';

import { DataConfig } from './data-config.js';
import { RNG } from './rng.js';
import { DicePool } from './dice.js';
import { Economy } from './economy.js';
import { CheatingAbilities } from './cheating.js';
import { Enemy } from './enemy.js';
import { Combat } from './combat.js';
import { Shop } from './shop.js';
import { GameLog } from './game-log.js';

/**
 * Game state enumeration.
 * @enum {string}
 */
const GameState = {
  MENU: 'MENU',
  INITIALIZING: 'INITIALIZING',
  BATTLE: 'BATTLE',
  HOLD_DECISION: 'HOLD_DECISION',    // 第一次投掷后，留骰决策阶段
  BOWL_COVERED: 'BOWL_COVERED',  // 投掷后、确认前（盖碗阶段）
  CATEGORY_SELECT: 'CATEGORY_SELECT', // 分类选择阶段
  ROLL_RESULT: 'ROLL_RESULT',  // 兼容保留：映射为 BOWL_COVERED 阶段
  SHOP: 'SHOP',
  VICTORY: 'VICTORY',
  DEFEAT: 'DEFEAT',
};

/**
 * GameFlow — orchestrates the complete game lifecycle.
 *
 * This is the top-level system that manages all subsystems and coordinates
 * the flow from menu through 8 rounds of battle+shop to victory/defeat.
 */
class GameFlow {
  /**
   * @param {object} opts
   * @param {string} opts.dataDir - path to assets/data/
   */
  constructor(opts = {}) {
    this._dataDir = opts.dataDir || 'assets/data';

    // State
    /** @type {string} One of GameState values */
    this._state = GameState.MENU;
    /** @type {number} Current round (1-8) */
    this._round = 1;
    /** @type {number|null} Seed used for current game */
    this._seed = null;
    /** @type {object|null} Game result {result: 'VICTORY'|'DEFEAT', round, score} */
    this._gameResult = null;

    // Create subsystems
    this._dataConfig = new DataConfig();
    this._rng = new RNG();
    this._dicePool = null; // created in newGame
    this._economy = null;
    this._cheating = null;
    this._enemy = null;
    this._combat = null;
    this._shop = null;
    this._log = new GameLog();
  }

  // ---------------------------------------------------------------------------
  // Public API - Lifecycle
  // ---------------------------------------------------------------------------

  /**
   * Load config data. Call once before newGame().
   * @returns {Promise<boolean>} success
   */
  async load() {
    try {
      await this._dataConfig.load(this._dataDir);
      const errors = this._dataConfig.validate();
      if (errors.length > 0) {
        console.error('Data validation errors:', errors);
        return false;
      }
      return true;
    } catch (err) {
      console.error('Failed to load data:', err.message);
      return false;
    }
  }

  /**
   * Start a new game with optional seed.
   * Only allowed from MENU, VICTORY, or DEFEAT states.
   * @param {number} [seed] - optional seed (uses random if not provided)
   * @returns {boolean} success
   */
  newGame(seed) {
    // Validate state
    if (
      this._state !== GameState.MENU &&
      this._state !== GameState.VICTORY &&
      this._state !== GameState.DEFEAT
    ) {
      return false;
    }

    this._state = GameState.INITIALIZING;

    // Generate or use provided seed
    this._seed = (seed != null && seed !== '')
      ? Math.abs(Math.floor(Number(seed))) || 1
      : Date.now();

    // Initialize RNG
    this._rng.seed(this._seed);

    // Create or reset subsystems
    const diceStream = this._rng.getStream('dice');
    const cloneStream = this._rng.getStream('clone');
    const shopStream = this._rng.getStream('shop');
    const enemyStream = this._rng.getStream('enemy');

    const diceConfig = this._dataConfig.getGlobal().dice || {};

    this._dicePool = new DicePool({
      diceStream,
      cloneStream,
      minFace: diceConfig.minValue ?? 1,
      maxFace: diceConfig.maxValue ?? 6,
      initialCount: diceConfig.initialCount ?? 4,
      maxCount: diceConfig.maxCount ?? 7,
    });

    this._economy = new Economy({ dataConfig: this._dataConfig });
    this._cheating = new CheatingAbilities({
      dataConfig: this._dataConfig,
      economy: this._economy,
      cloneStream,
    });
    this._enemy = new Enemy({
      dataConfig: this._dataConfig,
      enemyStream,
    });
    this._combat = new Combat({
      dicePool: this._dicePool,
      dataConfig: this._dataConfig,
      enemy: this._enemy,
      cheating: this._cheating,
      economy: this._economy,
      rng: this._rng,
    });
    this._shop = new Shop({
      dataConfig: this._dataConfig,
      economy: this._economy,
      cheating: this._cheating,
      dicePool: this._dicePool,
      shopStream,
      enemy: this._enemy,
    });

    // Apply starting items (free consumable)
    const startingItems = this._dataConfig.getGlobal().startingItems || {};
    if (startingItems.freeConsumable) {
      this._cheating.addConsumable(startingItems.freeConsumable);
    }

    // Reset game state
    this._round = 1;
    this._gameResult = null;

    // Reset and start game log
    this._log.clear();
    this._log.setRound(this._round);
    this._log.logGameStart(this._seed);

    // Pre-load first enemy so UI can display info before first roll
    this._enemy.loadForRound(this._round);

    // Transition to BATTLE
    this._state = GameState.BATTLE;
    return true;
  }

  /**
   * Forfeit the current game (player surrenders).
   * Ends game in DEFEAT.
   * @returns {boolean} success
   */
  surrender() {
    if (this._state !== GameState.BATTLE && this._state !== GameState.SHOP) {
      return false;
    }

    this._gameResult = {
      result: 'DEFEAT',
      round: this._round,
      score: 0,
      surrendered: true,
    };
    this._state = GameState.DEFEAT;
    return true;
  }

  // ---------------------------------------------------------------------------
  // Public API - Phase Control
  // ---------------------------------------------------------------------------

  /**
   * Phase 1: Execute roll phase only (steps 1-8).
   * Returns roll result WITHOUT determining victory/defeat.
   * Player can use consumables after seeing the result.
   * @returns {object|null} roll result or null if invalid state
   */
  executeRollPhase() {
    if (this._state !== GameState.BATTLE) {
      return null;
    }

    const rollResult = this._combat.executeRollPhase(this._round);
    this._log.setRound(this._round);
    this._state = GameState.BOWL_COVERED;
    return rollResult;
  }

  /**
   * New two-phase flow: Execute first roll only (steps 1-3).
   * Transitions to HOLD_DECISION state for the hold/reroll phase.
   * @returns {object|null} first roll result { dice, diceValues, targetScore } or null
   */
  executeFirstRoll() {
    if (this._state !== GameState.BATTLE) {
      return null;
    }

    const result = this._combat.executeFirstRoll(this._round);
    this._state = GameState.HOLD_DECISION;
    return result;
  }

  /**
   * New two-phase flow: Confirm hold selection, execute second roll + scoring.
   * Transitions from HOLD_DECISION to BOWL_COVERED.
   * @param {number[]} heldIndices - indices of dice to keep
   * @returns {object|null} score result or null if invalid state
   */
  confirmHold(heldIndices) {
    if (this._state !== GameState.HOLD_DECISION) {
      return null;
    }

    const result = this._combat.executeHoldAndReroll(heldIndices);
    this._state = GameState.BOWL_COVERED;
    return result;
  }

  /**
   * Enter category selection phase. Returns available categories for UI.
   * If 强夺令 is active, skips selection and returns null.
   * @returns {Array|null} available categories or null if skipped
   */
  enterCategorySelect() {
    if (this._state !== GameState.BOWL_COVERED) return null;

    // 强夺令跳过分类选择
    const overridePassive = this._cheating.getPassiveByEffect('category_override');
    if (overridePassive) return null;

    const available = this._combat.getAvailableCategories();
    this._state = GameState.CATEGORY_SELECT;
    return available;
  }

  /**
   * Confirm category selection and finalize battle.
   * @param {string} categoryId
   * @param {Array} [availableCategories]
   * @returns {object|null} battle result or null
   */
  confirmCategory(categoryId, availableCategories) {
    if (this._state !== GameState.CATEGORY_SELECT) return null;

    this._combat.selectCategory(categoryId, availableCategories);

    // 直接进入结算
    this._state = GameState.BOWL_COVERED;
    return this.finalizeBattle();
  }

  /**
   * Phase 2: Finalize battle result (steps 9-12).
   * Applies bonuses, determines victory/defeat, and transitions state.
   * @returns {object|null} final combat result or null if invalid state
   */
  finalizeBattle() {
    if (this._state !== GameState.BOWL_COVERED &&
        this._state !== GameState.CATEGORY_SELECT &&
        this._state !== GameState.ROLL_RESULT) {
      return null;
    }

    const result = this._combat.finalizeResult();

    // Log battle result
    this._log.logBattleResult(result.victory, result.score, result.targetScore, result.tokensEarned);

    // Determine next state
    if (result.victory) {
      if (this._round >= this.getTotalRounds()) {
        // Final victory
        this._gameResult = {
          result: 'VICTORY',
          round: this._round,
          score: result.score,
        };
        this._state = GameState.VICTORY;
        this._log.logGameEnd('VICTORY', this._round);
      } else {
        // Enter shop
        this._shop.open(this._round);
        this._state = GameState.SHOP;
      }
    } else {
      // Defeat
      this._gameResult = {
        result: 'DEFEAT',
        round: this._round,
        score: result.score,
      };
      this._state = GameState.DEFEAT;
      this._log.logGameEnd('DEFEAT', this._round);
    }

    return result;
  }

  /**
   * Recalculate roll result after consumables modify dice.
   * Must be in ROLL_RESULT state.
   * @returns {object|null} updated roll result or null if invalid state
   */
  recalculateRollResult() {
    if (this._state !== GameState.BOWL_COVERED &&
        this._state !== GameState.CATEGORY_SELECT &&
        this._state !== GameState.ROLL_RESULT) {
      return null;
    }
    return this._combat.recalculateFromCurrentDice();
  }

  /**
   * Execute the battle for the current round.
   * Must be in BATTLE state.
   * @returns {object|null} combat result or null if invalid state
   */
  executeBattle() {
    if (this._state !== GameState.BATTLE) {
      return null;
    }

    const result = this._combat.execute(this._round);

    // Determine next state
    if (result.victory) {
      if (this._round >= this.getTotalRounds()) {
        // Final victory
        this._gameResult = {
          result: 'VICTORY',
          round: this._round,
          score: result.score,
        };
        this._state = GameState.VICTORY;
      } else {
        // Enter shop
        this._shop.open(this._round);
        this._state = GameState.SHOP;
      }
    } else {
      // Defeat
      this._gameResult = {
        result: 'DEFEAT',
        round: this._round,
        score: result.score,
      };
      this._state = GameState.DEFEAT;
    }

    return result;
  }

  /**
   * Close the shop and advance to next round.
   * Must be in SHOP state.
   * @returns {boolean} success
   */
  closeShop() {
    if (this._state !== GameState.SHOP) {
      return false;
    }

    this._shop.close();
    this._round++;
    this._log.setRound(this._round);

    // Clear previous round's combat result so UI doesn't show stale data
    this._combat.reset();

    // Pre-load enemy for the new round so UI can display info before roll
    this._enemy.loadForRound(this._round);

    this._state = GameState.BATTLE;
    return true;
  }

  // ---------------------------------------------------------------------------
  // Public API - Query
  // ---------------------------------------------------------------------------

  /** Get current game state. */
  getState() {
    return this._state;
  }

  /** Check if state matches a given value. */
  isState(state) {
    return this._state === state;
  }

  /** Get current round number (1-8). */
  getCurrentRound() {
    return this._round;
  }

  /** Get total rounds for the game. */
  getTotalRounds() {
    return this._dataConfig.getGlobal().rounds?.total ?? 8;
  }

  /** Get the seed used for current game. */
  getSeed() {
    return this._seed;
  }

  /** Check if game is over (VICTORY or DEFEAT). */
  isGameOver() {
    return (
      this._state === GameState.VICTORY ||
      this._state === GameState.DEFEAT
    );
  }

  /**
   * Get game result.
   * @returns {object|null} {result: 'VICTORY'|'DEFEAT', round, score, surrendered?}
   */
  getResult() {
    return this._gameResult ? { ...this._gameResult } : null;
  }

  // ---------------------------------------------------------------------------
  // Public API - Subsystem Access (for UI, testing, etc.)
  // ---------------------------------------------------------------------------

  /** Get DataConfig instance. */
  getDataConfig() { return this._dataConfig; }

  /** Get RNG instance. */
  getRNG() { return this._rng; }

  /** Get DicePool instance. */
  getDicePool() { return this._dicePool; }

  /** Get DataConfig instance. */
  getDataConfig() { return this._dataConfig; }

  /** Get Economy instance. */
  getEconomy() { return this._economy; }

  /** Get CheatingAbilities instance. */
  getCheating() { return this._cheating; }

  /** Get Enemy instance. */
  getEnemy() { return this._enemy; }

  /** Get Combat instance. */
  getCombat() { return this._combat; }

  /** Get Shop instance. */
  getShop() { return this._shop; }

  /** Get GameLog instance. */
  getLog() { return this._log; }

  // ---------------------------------------------------------------------------
  // Internal
  // ---------------------------------------------------------------------------

  /**
   * Check if current round is the last round.
   * @returns {boolean}
   */
  _isLastRound() {
    return this._round >= this.getTotalRounds();
  }
}

// Export GameState enum for external use
GameFlow.GameState = GameState;

export { GameFlow, GameState };
