'use strict';

const fs = require('fs');
const path = require('path');

/**
 * DataConfig — loads and validates all JSON config files at startup,
 * then provides a read-only query interface for other game systems.
 */
class DataConfig {
  constructor() {
    this._data = {};
    this._warnings = [];
  }

  /**
   * Load all JSON config files from the given directory.
   * @param {string} dataDir - path to assets/data/
   * @returns {DataConfig} this (for chaining)
   */
  load(dataDir) {
    const files = [
      'global-config.json',
      'scoring-categories.json',
      'abilities.json',
      'enemies.json',
      'enemy-rules.json',
      'economy.json',
    ];

    for (const file of files) {
      const filePath = path.join(dataDir, file);
      const raw = fs.readFileSync(filePath, 'utf-8');
      const parsed = JSON.parse(raw); // throws on invalid JSON
      const key = file.replace('.json', '').replace(/-([a-z])/g, (_, c) => c.toUpperCase());
      this._data[key] = parsed;
    }

    this._buildIndices();
    return this;
  }

  /** Build lookup indices for fast querying. */
  _buildIndices() {
    // Index abilities by id, group by type; detect duplicates
    this._abilityById = {};
    this._abilitiesByType = {};
    for (const a of this._data.abilities) {
      if (this._abilityById[a.id]) this._warnings.push(`Duplicate id "${a.id}" in abilities`);
      this._abilityById[a.id] = a;
      if (!this._abilitiesByType[a.type]) this._abilitiesByType[a.type] = [];
      this._abilitiesByType[a.type].push(a);
    }

    // Index enemies by round; detect duplicates
    this._enemyByRound = {};
    for (const e of this._data.enemies) {
      if (this._enemyByRound[e.round]) this._warnings.push(`Duplicate round ${e.round} in enemies`);
      this._enemyByRound[e.round] = e;
    }

    // Index enemy rules by id; detect duplicates
    this._ruleById = {};
    for (const r of this._data.enemyRules) {
      if (this._ruleById[r.id]) this._warnings.push(`Duplicate id "${r.id}" in enemyRules`);
      this._ruleById[r.id] = r;
    }

    // Index scoring categories by id; detect duplicates
    this._categoryById = {};
    for (const c of this._data.scoringCategories) {
      if (this._categoryById[c.id]) this._warnings.push(`Duplicate id "${c.id}" in scoringCategories`);
      this._categoryById[c.id] = c;
    }
  }

  /**
   * Generic query by dot-separated path.
   * @param {string} queryPath - e.g. "globalConfig.dice.initialCount"
   * @returns {*} the value, or undefined if not found
   */
  get(queryPath) {
    const parts = queryPath.split('.');
    let current = this._data;
    for (const part of parts) {
      if (current == null || typeof current !== 'object') return undefined;
      current = current[part];
    }
    return current;
  }

  /** Get scoring categories sorted by priority (ascending = highest first). */
  getCategories() {
    return [...this._data.scoringCategories].sort((a, b) => a.priority - b.priority);
  }

  /** Get a single scoring category by id. */
  getCategory(id) {
    return this._categoryById[id] || null;
  }

  /** Get abilities, optionally filtered by type. */
  getAbilities(type) {
    if (type) return (this._abilitiesByType[type] || []).map(a => ({ ...a }));
    return this._data.abilities.map(a => ({ ...a }));
  }

  /** Get a single ability by id. */
  getAbility(id) {
    return this._abilityById[id] ? { ...this._abilityById[id] } : null;
  }

  /** Get enemy definition by round number (1-based). */
  getEnemy(round) {
    return this._enemyByRound[round] ? { ...this._enemyByRound[round] } : null;
  }

  /** Get all enemies. */
  getEnemies() {
    return this._data.enemies.map(e => ({ ...e }));
  }

  /** Get an enemy rule definition by id. */
  getEnemyRule(id) {
    return this._ruleById[id] ? { ...this._ruleById[id] } : null;
  }

  /** Get token reward for a given round (1-based). */
  getTokenReward(round) {
    return this._data.economy.tokenRewards[round - 1];
  }

  /** Get full economy config. */
  getEconomy() {
    return { ...this._data.economy };
  }

  /** Get global config section. */
  getGlobal() {
    return { ...this._data.globalConfig };
  }

  /**
   * Validate data integrity. Returns an array of error strings (empty = valid).
   */
  validate() {
    const errors = [];

    // Check enemies reference valid rule IDs
    for (const enemy of this._data.enemies) {
      for (const ruleId of enemy.rules) {
        if (!this._ruleById[ruleId]) {
          errors.push(`Enemy "${enemy.id}" references unknown rule "${ruleId}"`);
        }
      }
    }

    // Check bust category exists and is fallback
    const bust = this._categoryById['bust'];
    if (!bust) {
      errors.push('Missing required "bust" (fallback) scoring category');
    } else if (bust.matchType !== 'fallback') {
      errors.push('"bust" category must have matchType "fallback"');
    }

    return errors;
  }

  /** Get warnings collected during load/validation. */
  getWarnings() {
    return [...this._warnings];
  }

  /**
   * Load from raw data objects (for testing without filesystem).
   * @param {object} dataMap - keys are file stems, values are parsed objects
   * @returns {DataConfig} this
   */
  loadFromObject(dataMap) {
    this._data = dataMap;
    this._buildIndices();
    return this;
  }
}

module.exports = { DataConfig };
