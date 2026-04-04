/**
 * 战斗12步结算原型 — 千王骰局
 *
 * 验证目标：结算流程完整可运行，步骤顺序严格正确
 *
 * 核心职责：
 * 1. 按严格12步顺序编排骰子/计分/敌人/出千/经济系统
 * 2. 处理特殊流程（双投跳回、Boss随机规则、封印被动）
 * 3. 记录步骤日志用于测试验证
 */

const {
  findBestCategory,
  calcChainLinkBonus,
  applyZeroLowest,
  CATEGORIES,
} = require("../scoring/scoring");

// ============================================================
// 数据配置（原型中硬编码）
// ============================================================

const ENEMIES = [
  { id: "thug",         round: 1, name: "街头混混",  targetScore: 12,  rules: [],              bossRule: null },
  { id: "punk",         round: 2, name: "地痞赌徒",  targetScore: 20,  rules: [],              bossRule: null },
  { id: "dealer",       round: 3, name: "地下庄家",  targetScore: 40,  rules: ["block_pair"],  bossRule: null },
  { id: "croupier",     round: 4, name: "赌场荷官",  targetScore: 65,  rules: ["zero_lowest"], bossRule: null },
  { id: "cheater",      round: 5, name: "老千同行",  targetScore: 95,  rules: ["swap_dice"],   bossRule: null },
  { id: "manager",      round: 6, name: "赌场经理",  targetScore: 130, rules: ["seal_passive"],bossRule: null },
  { id: "kingpin",      round: 7, name: "地下赌王",  targetScore: 175, rules: ["suppress_all"],bossRule: null },
  { id: "king_of_kings",round: 8, name: "千王之王",  targetScore: 250, rules: [],
    bossRule: { pool: ["block_pair","zero_lowest","swap_dice","seal_passive","suppress_all"], count: 2 } },
];

const ENEMY_RULES = {
  block_pair:   { id: "block_pair",   name: "封锁对子",   effectType: "category_block", phase: "scoring",     params: { blockedCategories: ["pair"] } },
  zero_lowest:  { id: "zero_lowest",  name: "最低点归零", effectType: "zero_lowest",    phase: "scoring_post", params: { count: 1 } },
  swap_dice:    { id: "swap_dice",    name: "狸猫换子",   effectType: "reroll_random",  phase: "dice",         params: { count: 1 } },
  seal_passive: { id: "seal_passive", name: "封印被动",   effectType: "seal_passive",   phase: "pre",          params: {} },
  suppress_all: { id: "suppress_all", name: "全面压制",   effectType: "dice_decrease",  phase: "dice",         params: { amount: 1, minValue: 1 } },
};

const TOKEN_REWARDS = [4, 4, 5, 5, 6, 6, 7, 8];

// ============================================================
// 简易种子随机数
// ============================================================

function createRng(seed) {
  let s = seed | 0;
  return function next() {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    return (s % 6) + 1;
  };
}

/** 返回 0..n-1 的整数 */
function randIndex(rng, n) {
  // 利用 rng() 的变化来产生范围随机
  return (rng() + rng() + rng()) % n;
}

// ============================================================
// 骰子池
// ============================================================

class DicePool {
  constructor(size, rng) {
    this.baseSize = size;
    this.dice = new Array(size).fill(1);
    this.tempDice = [];
    this.rng = rng;
  }

  rollAll() {
    this.tempDice = [];
    for (let i = 0; i < this.baseSize; i++) {
      this.dice[i] = this.rng();
    }
    return this.getAllValues();
  }

  getAllValues() {
    return [...this.dice, ...this.tempDice];
  }

  rerollRandom(count, indexRng) {
    const indices = [];
    const _rng = indexRng || this.rng;
    for (let i = 0; i < count && i < this.dice.length; i++) {
      const idx = randIndex(_rng, this.dice.length);
      this.dice[idx] = this.rng();
      indices.push(idx);
    }
    return indices;
  }

  decreaseAll(amount, minValue) {
    for (let i = 0; i < this.dice.length; i++) {
      this.dice[i] = Math.max(minValue, this.dice[i] - amount);
    }
    for (let i = 0; i < this.tempDice.length; i++) {
      this.tempDice[i] = Math.max(minValue, this.tempDice[i] - amount);
    }
  }

  setFloor(minValue) {
    for (let i = 0; i < this.dice.length; i++) {
      this.dice[i] = Math.max(minValue, this.dice[i]);
    }
    for (let i = 0; i < this.tempDice.length; i++) {
      this.tempDice[i] = Math.max(minValue, this.tempDice[i]);
    }
  }

  setDie(index, value) {
    if (index < this.dice.length) {
      this.dice[index] = value;
    } else {
      this.tempDice[index - this.dice.length] = value;
    }
  }

  replaceLowest(value) {
    let minIdx = 0;
    let minVal = this.dice[0];
    for (let i = 1; i < this.dice.length; i++) {
      if (this.dice[i] < minVal) { minVal = this.dice[i]; minIdx = i; }
    }
    this.dice[minIdx] = value;
    return minIdx;
  }

  cloneRandom(indexRng) {
    if (this.dice.length === 0) return null;
    const idx = randIndex(indexRng, this.dice.length);
    const val = this.dice[idx];
    this.tempDice.push(val);
    return val;
  }

  clearTemp() {
    this.tempDice = [];
  }
}

// ============================================================
// 玩家状态
// ============================================================

class PlayerState {
  constructor(diceCount, rng) {
    this.dicePool = new DicePool(diceCount, rng);
    this.consumables = [];
    this.passives = [];
    this.tokens = 0;
    this.consumablesUsedThisRound = 0;
    this.maxConsumablesPerRound = 2;
    this.sealedPassiveId = null;
    this.weaknessCategory = null;
  }

  addConsumable(item) { this.consumables.push(item); }

  addPassive(item) { this.passives.push(item); }

  removeConsumable(index) { return this.consumables.splice(index, 1)[0]; }

  hasPassive(id) {
    return this.passives.some(p => p.id === id && p.id !== this.sealedPassiveId);
  }

  getPassive(id) {
    if (this.sealedPassiveId === id) return null;
    return this.passives.find(p => p.id === id) || null;
  }

  sealMostExpensive(rng) {
    if (this.passives.length === 0) return null;
    let maxCost = -1;
    let candidates = [];
    for (const p of this.passives) {
      if (p.cost > maxCost) { maxCost = p.cost; candidates = [p]; }
      else if (p.cost === maxCost) { candidates.push(p); }
    }
    const sealed = candidates.length === 1
      ? candidates[0]
      : candidates[randIndex(rng, candidates.length)];
    this.sealedPassiveId = sealed.id;
    return sealed;
  }

  resetRound() {
    this.consumablesUsedThisRound = 0;
    this.sealedPassiveId = null;
    this.weaknessCategory = null;
  }

  canUseConsumable() {
    return this.consumablesUsedThisRound < this.maxConsumablesPerRound;
  }

  useConsumable() { this.consumablesUsedThisRound++; }
}

// ============================================================
// 战斗引擎 — 12步编排器
// ============================================================

class CombatEngine {
  constructor() {
    this.stepLog = [];
  }

  /**
   * 执行完整战斗
   *
   * @param {object} params
   * @param {PlayerState} params.player
   * @param {object} params.enemy - 敌人配置（来自 ENEMIES 数组）
   * @param {Function} params.rng - 种子随机数 () => 1-6
   * @param {Array} params.consumableScript - 预编程消耗品操作序列
   *   每项: { index, target:{dieIndex,value} } 或 null（跳过）
   * @returns {object} { result, finalScore, targetScore, tokensEarned, stepLog, category, breakdown }
   */
  resolve(params) {
    const { player, enemy, rng, consumableScript = [] } = params;
    this.stepLog = [];
    let scriptIdx = 0;

    // 确定本场激活规则
    const activeRules = this._getActiveRules(enemy, rng);

    // ---- Step 1: 展示敌人信息 ----
    this._logStep(1, "展示敌人信息", {
      enemy: enemy.name,
      targetScore: enemy.targetScore,
      rules: activeRules.map(r => r.name),
    });

    player.resetRound();

    // 封印被动（步骤1中确定）
    const sealRule = activeRules.find(r => r.effectType === "seal_passive");
    if (sealRule) {
      const sealed = player.sealMostExpensive(rng);
      this._logAction("封印被动", { sealed: sealed ? sealed.name : null });
    }

    // ---- Step 2: 投掷骰子 + 分身术 ----
    let diceValues = player.dicePool.rollAll();
    this._logStep(2, "投掷骰子", { dice: [...diceValues] });

    if (player.hasPassive("clone_dice")) {
      player.dicePool.cloneRandom(rng);
      diceValues = player.dicePool.getAllValues();
      this._logAction("分身术", { dice: [...diceValues] });
    }

    // ---- Step 3: 敌人规则（骰子类） ----
    const diceRules = activeRules.filter(r => r.phase === "dice");
    if (diceRules.length > 0) {
      for (const rule of diceRules) {
        if (rule.effectType === "reroll_random") {
          player.dicePool.rerollRandom(rule.params.count, rng);
          diceValues = player.dicePool.getAllValues();
          this._logAction(`敌人: ${rule.name}`, { dice: [...diceValues] });
        }
        if (rule.effectType === "dice_decrease") {
          player.dicePool.decreaseAll(rule.params.amount, rule.params.minValue);
          diceValues = player.dicePool.getAllValues();
          this._logAction(`敌人: ${rule.name}`, { dice: [...diceValues] });
        }
      }
      this._logStep(3, "敌人规则(骰子类)", { dice: [...diceValues] });
    } else {
      this._logStep(3, "敌人规则(骰子类)", { skipped: true });
    }

    // ---- Step 4: 消耗品使用 ----
    let hadConsumables = player.consumables.length > 0;
    if (hadConsumables && player.canUseConsumable()) {
      this._runConsumables(player, diceRules, rng, consumableScript, scriptIdx);
      diceValues = player.dicePool.getAllValues();
      this._logStep(4, "消耗品使用", {
        dice: [...diceValues],
        used: player.consumablesUsedThisRound,
      });
    } else {
      this._logStep(4, "消耗品使用", { skipped: true });
    }

    // ---- Step 5: 被动托底 ----
    if (player.hasPassive("loaded_dice")) {
      const p = player.getPassive("loaded_dice");
      player.dicePool.setFloor(p.params.minValue);
      diceValues = player.dicePool.getAllValues();
      this._logStep(5, "被动托底", { minValue: p.params.minValue, dice: [...diceValues] });
    } else {
      this._logStep(5, "被动托底", { skipped: true });
    }

    // ---- Step 6: 分类匹配 ----
    const blockedCategories = activeRules
      .filter(r => r.effectType === "category_block")
      .flatMap(r => r.params.blockedCategories);
    const looseConsecutive = player.hasPassive("loose_eye");

    const { category, matchInfo } = findBestCategory(diceValues, { blockedCategories, looseConsecutive });
    this._logStep(6, "分类匹配", { category: category.name, matchInfo });

    // ---- Step 7: 基础分 ----
    let sumDice = diceValues.reduce((s, v) => s + v, 0);
    let categoryBase = category.bonusType === "multiplier"
      ? sumDice * category.bonusValue
      : sumDice + category.bonusValue;
    this._logStep(7, "基础分计算", { sumDice, categoryBase });

    // ---- Step 8: 敌人规则（计分类） ----
    const scoreRules = activeRules.filter(r => r.phase === "scoring_post");
    let adjustedSum = sumDice;
    if (scoreRules.length > 0) {
      for (const rule of scoreRules) {
        if (rule.effectType === "zero_lowest") {
          adjustedSum = applyZeroLowest(diceValues);
          categoryBase = category.bonusType === "multiplier"
            ? adjustedSum * category.bonusValue
            : adjustedSum + category.bonusValue;
          this._logAction(`敌人: ${rule.name}`, { adjustedSum });
        }
      }
      this._logStep(8, "敌人规则(计分类)", { categoryBase });
    } else {
      this._logStep(8, "敌人规则(计分类)", { skipped: true });
    }

    // ---- Step 9: 加法加成 ----
    const flatBonuses = this._getFlatBonuses(player, category, matchInfo, diceValues);
    const flatTotal = flatBonuses.reduce((s, b) => s + b.value, 0);
    this._logStep(9, "加法加成", { bonuses: flatBonuses.map(b => `${b.source}:+${b.value}`), total: flatTotal });

    // ---- Step 10: 乘法倍率 ----
    const multipliers = this._getMultipliers(player);
    const multiplierTotal = multipliers.length > 0 ? multipliers.reduce((p, m) => p * m, 1) : 1.0;
    this._logStep(10, "乘法倍率", { multipliers, total: multiplierTotal });

    // ---- Step 11: 向下取整 ----
    const rawScore = (categoryBase + flatTotal) * multiplierTotal;
    const finalScore = Math.max(0, Math.floor(rawScore + 1e-9));
    this._logStep(11, "向下取整", { rawScore, finalScore });

    // ---- Step 12: 胜负判定 ----
    const result = finalScore >= enemy.targetScore ? "VICTORY" : "DEFEAT";
    const tokensEarned = result === "VICTORY" ? TOKEN_REWARDS[enemy.round - 1] : 0;
    if (result === "VICTORY") player.tokens += tokensEarned;
    this._logStep(12, "胜负判定", { finalScore, targetScore: enemy.targetScore, result, tokensEarned });

    return {
      result,
      finalScore,
      targetScore: enemy.targetScore,
      tokensEarned,
      stepLog: this.stepLog,
      category,
      matchInfo,
      breakdown: { sumDice, adjustedSum, categoryBase, flatBonuses, flatTotal, multipliers, multiplierTotal, rawScore },
    };
  }

  // ---- 内部方法 ----

  /** 消耗品执行循环 */
  _runConsumables(player, diceRules, rng, script, scriptIdx) {
    let idx = typeof scriptIdx === "object" ? 0 : (scriptIdx || 0);
    // Actually scriptIdx is always 0 for now since we pass the whole script
    idx = 0;

    while (player.canUseConsumable() && player.consumables.length > 0 && idx < script.length) {
      const action = script[idx++];

      // null = 玩家选择不使用了
      if (action === null) break;

      const consumable = player.removeConsumable(action.index);
      if (!consumable) break;
      player.useConsumable();

      // 双投特殊：跳回步骤2
      if (consumable.effectType === "extra_roll") {
        this._logAction("消耗品: 双投", {});
        player.dicePool.clearTemp();
        let diceValues = player.dicePool.rollAll();
        this._logAction("双投重掷", { dice: [...diceValues] });

        // 重新触发分身术
        if (player.hasPassive("clone_dice")) {
          player.dicePool.cloneRandom(rng);
          diceValues = player.dicePool.getAllValues();
          this._logAction("分身术(双投后)", { dice: [...diceValues] });
        }

        // 重新应用敌人骰子类规则
        for (const rule of diceRules) {
          if (rule.effectType === "reroll_random") {
            player.dicePool.rerollRandom(rule.params.count, rng);
            diceValues = player.dicePool.getAllValues();
            this._logAction(`双投后敌人: ${rule.name}`, { dice: [...diceValues] });
          }
          if (rule.effectType === "dice_decrease") {
            player.dicePool.decreaseAll(rule.params.amount, rule.params.minValue);
            diceValues = player.dicePool.getAllValues();
            this._logAction(`双投后敌人: ${rule.name}`, { dice: [...diceValues] });
          }
        }
        continue;
      }

      // 透视特殊：标记弱点分类
      if (consumable.effectType === "reveal_weakness") {
        const eligible = CATEGORIES.filter(c => c.id !== "bust");
        player.weaknessCategory = eligible[randIndex(rng, eligible.length)].id;
        this._logAction("消耗品: 透视", { weakness: player.weaknessCategory });
        continue;
      }

      // 常规消耗品
      this._executeConsumable(player, consumable, action.target);
      this._logAction(`消耗品: ${consumable.name}`, { dice: [...player.dicePool.getAllValues()] });
    }
  }

  /** 执行单个消耗品效果 */
  _executeConsumable(player, consumable, target) {
    switch (consumable.effectType) {
      case "set_dice_value":
        player.dicePool.setDie(target.dieIndex, target.value);
        break;
      case "reroll_min": {
        const roll = player.dicePool.rng();
        player.dicePool.setDie(target.dieIndex, Math.max(consumable.params.min, roll));
        break;
      }
      case "replace_lowest":
        player.dicePool.replaceLowest(consumable.params.value);
        break;
    }
  }

  /** 获取本场激活的规则 */
  _getActiveRules(enemy, rng) {
    const fixed = enemy.rules.map(r => ENEMY_RULES[r]);
    if (!enemy.bossRule) return fixed;

    const pool = [...enemy.bossRule.pool];
    const selected = [];
    for (let i = 0; i < enemy.bossRule.count && pool.length > 0; i++) {
      const idx = randIndex(rng, pool.length);
      selected.push(ENEMY_RULES[pool[idx]]);
      pool.splice(idx, 1);
    }
    return [...fixed, ...selected];
  }

  /** 计算加法加成 */
  _getFlatBonuses(player, category, matchInfo, diceValues) {
    const bonuses = [];

    if (player.hasPassive("chain_link")) {
      const p = player.getPassive("chain_link");
      const val = calcChainLinkBonus(diceValues, category, matchInfo, p.params.perExcess);
      if (val > 0) bonuses.push({ source: "连横术", value: val });
    }

    if (player.hasPassive("pattern_master")) {
      const p = player.getPassive("pattern_master");
      if (p.params.categories.includes(category.id)) {
        bonuses.push({ source: "牌型大师", value: p.params.bonus });
      }
    }

    if (player.weaknessCategory === category.id) {
      bonuses.push({ source: "透视", value: 10 });
    }

    return bonuses;
  }

  /** 计算乘法倍率 */
  _getMultipliers(player) {
    const mults = [];
    if (player.hasPassive("greed")) {
      mults.push(player.getPassive("greed").params.multiplier);
    }
    return mults;
  }

  _logStep(step, name, data) {
    this.stepLog.push({ step, name, data });
  }

  _logAction(name, data) {
    this.stepLog.push({ action: name, data });
  }
}

// ============================================================
// 导出
// ============================================================

if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    CATEGORIES,
    ENEMIES,
    ENEMY_RULES,
    TOKEN_REWARDS,
    createRng,
    DicePool,
    PlayerState,
    CombatEngine,
  };
}
