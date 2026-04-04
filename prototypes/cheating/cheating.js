/**
 * 出千能力联动原型 — 千王骰局
 *
 * 验证目标：能力叠加不会导致数值失控
 *
 * 核心职责：
 * 1. 枚举所有被动组合，验证叠加行为
 * 2. 模拟完整对局，统计分数分布和胜率
 * 3. 计算理论最大分数，验证不超上限
 * 4. 验证 cheating.md AC-6 ~ AC-12
 */

const {
  findBestCategory,
  calcChainLinkBonus,
  applyZeroLowest,
  CATEGORIES,
} = require("../scoring/scoring");

// ============================================================
// 能力定义
// ============================================================

const PASSIVE_DEFS = {
  loaded_dice:    { id: "loaded_dice",    name: "铅骰",   effectType: "dice_floor",       cost: 4, params: { minValue: 2 } },
  clone_dice:     { id: "clone_dice",     name: "分身术", effectType: "clone_dice",       cost: 5, params: {} },
  chain_link:     { id: "chain_link",     name: "连横术", effectType: "excess_bonus",     cost: 4, params: { perExcess: 3 } },
  loose_eye:      { id: "loose_eye",      name: "顺子眼", effectType: "loose_consecutive", cost: 4, params: {} },
  greed:          { id: "greed",          name: "贪欲",   effectType: "score_multiplier", cost: 3, params: { multiplier: 1.2 } },
  pattern_master: { id: "pattern_master", name: "牌型大师", effectType: "category_bonus",  cost: 4, params: { categories: ["full_house", "yahtzee"], bonus: 10 } },
};

const CONSUMABLE_DEFS = {
  face_change: { id: "face_change", name: "换面",     effectType: "set_dice_value", cost: 2, params: { min: 1, max: 6 } },
  loaded_roll: { id: "loaded_roll", name: "加料",     effectType: "reroll_min",     cost: 2, params: { min: 4 } },
  reveal:      { id: "reveal",      name: "透视",     effectType: "reveal_weakness", cost: 1, params: {} },
  extra_roll:  { id: "extra_roll",  name: "双投",     effectType: "extra_roll",     cost: 3, params: {} },
  swap_lowest: { id: "swap_lowest", name: "偷梁换柱", effectType: "replace_lowest", cost: 3, params: { value: 6 } },
};

const PASSIVE_IDS = Object.keys(PASSIVE_DEFS);

const ENEMIES = [
  { round: 1, name: "街头混混", targetScore: 12,  rules: [] },
  { round: 2, name: "地痞赌徒", targetScore: 20,  rules: [] },
  { round: 3, name: "地下庄家", targetScore: 40,  rules: ["block_pair"] },
  { round: 4, name: "赌场荷官", targetScore: 65,  rules: ["zero_lowest"] },
  { round: 5, name: "老千同行", targetScore: 95,  rules: ["swap_dice"] },
  { round: 6, name: "赌场经理", targetScore: 130, rules: ["seal_passive"] },
  { round: 7, name: "地下赌王", targetScore: 175, rules: ["suppress_all"] },
  { round: 8, name: "千王之王", targetScore: 250, rules: [] },
];

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

function randIndex(rng, n) {
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

  rerollRandom(count) {
    const indices = [];
    for (let i = 0; i < count && i < this.dice.length; i++) {
      const idx = randIndex(this.rng, this.dice.length);
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

  cloneRandom() {
    if (this.dice.length === 0) return null;
    const idx = randIndex(this.rng, this.dice.length);
    const val = this.dice[idx];
    this.tempDice.push(val);
    return val;
  }

  clearTemp() {
    this.tempDice = [];
  }
}

// ============================================================
// 加成计算器
// ============================================================

/**
 * 计算指定被动组合下的加法加成和乘法倍率
 * @param {string[]} passiveIds - 被动ID列表
 * @param {object} category - 匹配到的分类
 * @param {object} matchInfo - 匹配信息
 * @param {number[]} diceValues - 骰子值
 * @returns {{ flatBonuses: Array, flatTotal: number, multipliers: number[], multiplierTotal: number }}
 */
function calcBonuses(passiveIds, category, matchInfo, diceValues) {
  const passiveSet = new Set(passiveIds);
  const flatBonuses = [];

  // 连横术
  if (passiveSet.has("chain_link")) {
    const val = calcChainLinkBonus(diceValues, category, matchInfo, 3);
    if (val > 0) flatBonuses.push({ source: "连横术", value: val });
  }

  // 牌型大师
  if (passiveSet.has("pattern_master")) {
    const p = PASSIVE_DEFS.pattern_master;
    if (p.params.categories.includes(category.id)) {
      flatBonuses.push({ source: "牌型大师", value: p.params.bonus });
    }
  }

  const flatTotal = flatBonuses.reduce((s, b) => s + b.value, 0);

  // 乘法倍率（积叠加）
  const multipliers = [];
  if (passiveSet.has("greed")) {
    multipliers.push(PASSIVE_DEFS.greed.params.multiplier);
  }

  const multiplierTotal = multipliers.length > 0
    ? multipliers.reduce((p, m) => p * m, 1)
    : 1.0;

  return { flatBonuses, flatTotal, multipliers, multiplierTotal };
}

/**
 * 完整计分流程（含被动加成）
 */
function scoreWithPassives(diceValues, passiveIds, options = {}) {
  const { blockedCategories = [] } = options;

  const looseConsecutive = passiveIds.includes("loose_eye");
  const { category, matchInfo } = findBestCategory(diceValues, { blockedCategories, looseConsecutive });

  let sumDice = diceValues.reduce((s, v) => s + v, 0);

  let categoryBase;
  if (category.bonusType === "multiplier") {
    categoryBase = sumDice * category.bonusValue;
  } else {
    categoryBase = sumDice + category.bonusValue;
  }

  const { flatBonuses, flatTotal, multipliers, multiplierTotal } = calcBonuses(passiveIds, category, matchInfo, diceValues);

  const rawScore = (categoryBase + flatTotal) * multiplierTotal;
  const finalScore = Math.max(0, Math.floor(rawScore + 1e-9));

  return {
    finalScore,
    category,
    matchInfo,
    breakdown: { sumDice, categoryBase, flatBonuses, flatTotal, multipliers, multiplierTotal, rawScore },
  };
}

// ============================================================
// 被动组合枚举
// ============================================================

/**
 * 生成所有被动子集（2^n 个）
 */
function allPassiveSubsets() {
  const result = [[]];
  for (const id of PASSIVE_IDS) {
    const len = result.length;
    for (let i = 0; i < len; i++) {
      result.push([...result[i], id]);
    }
  }
  return result;
}

/**
 * 生成测试骰子配置（代表性采样）
 */
function sampleDiceConfigs() {
  return [
    { dice: [1, 2, 3], desc: "3骰散牌" },
    { dice: [3, 3, 5], desc: "3骰对子" },
    { dice: [4, 4, 4], desc: "3骰三条" },
    { dice: [6, 6, 6], desc: "3骰豹子" },
    { dice: [1, 2, 3, 4], desc: "4骰小顺" },
    { dice: [4, 4, 4, 2], desc: "4骰三条" },
    { dice: [5, 5, 5, 5], desc: "4骰四条" },
    { dice: [1, 2, 3, 4, 5], desc: "5骰大顺" },
    { dice: [3, 3, 3, 5, 5], desc: "5骰满堂红" },
    { dice: [4, 4, 4, 4, 2], desc: "5骰四条+1" },
    { dice: [6, 6, 6, 6, 6], desc: "5骰豹子" },
    { dice: [2, 2, 3, 3, 5, 6], desc: "6骰混合" },
    { dice: [4, 4, 4, 4, 4, 4], desc: "6骰六条" },
    { dice: [6, 6, 6, 6, 6, 6, 6], desc: "7骰全6" },
    { dice: [1, 1, 1, 1, 1, 1, 1], desc: "7骰全1" },
    { dice: [3, 3, 3, 3, 3, 3, 3], desc: "7骰全3" },
    { dice: [2, 2, 3, 4, 5, 6, 6], desc: "7骰含顺" },
  ];
}

// ============================================================
// 完整对局模拟器
// ============================================================

/**
 * 模拟一局完整游戏（8轮）
 * @param {number} seed - 随机种子
 * @param {Function} shopStrategy - 商店购买策略
 * @returns {object} 游戏结果
 */
function simulateGame(seed, shopStrategy) {
  const rng = createRng(seed);
  const diceCount = 3;
  const player = {
    dicePool: new DicePool(diceCount, rng),
    passives: [],
    consumables: [{ ...CONSUMABLE_DEFS.face_change }], // 初始免费换面
    tokens: 0,
    diceCount: 3,
  };

  const roundResults = [];

  for (let round = 0; round < 8; round++) {
    const enemy = ENEMIES[round];

    // ---- 战斗 ----
    player.dicePool.baseSize = player.diceCount;
    player.dicePool.dice = new Array(player.diceCount).fill(1);

    player.dicePool.clearTemp();
    let diceValues = player.dicePool.rollAll();

    // ---- 消耗品使用（最优策略：将最低骰子设为6） ----
    let consumablesUsed = 0;
    const maxConsumables = 2;
    while (consumablesUsed < maxConsumables && player.consumables.length > 0) {
      const c = player.consumables.shift();
      consumablesUsed++;

      if (c.effectType === "set_dice_value") {
        // 换面：将最低骰子设为6
        const vals = player.dicePool.dice;
        let minIdx = 0;
        for (let i = 1; i < vals.length; i++) {
          if (vals[i] < vals[minIdx]) minIdx = i;
        }
        if (vals[minIdx] < 6) {
          player.dicePool.setDie(minIdx, 6);
        }
      } else if (c.effectType === "replace_lowest") {
        player.dicePool.replaceLowest(6);
      } else if (c.effectType === "reroll_min") {
        const vals = player.dicePool.dice;
        let minIdx = 0;
        for (let i = 1; i < vals.length; i++) {
          if (vals[i] < vals[minIdx]) minIdx = i;
        }
        const roll = rng();
        player.dicePool.setDie(minIdx, Math.max(4, roll));
      } else if (c.effectType === "extra_roll") {
        player.dicePool.clearTemp();
        diceValues = player.dicePool.rollAll();
        if (player.passives.includes("clone_dice")) {
          player.dicePool.cloneRandom();
        }
        // 重新应用敌人骰子规则
        if (enemy.rules.includes("swap_dice")) player.dicePool.rerollRandom(1);
        if (enemy.rules.includes("suppress_all")) player.dicePool.decreaseAll(1, 1);
      }

      diceValues = player.dicePool.getAllValues();
    }

    // 分身术
    if (player.passives.includes("clone_dice")) {
      player.dicePool.cloneRandom();
      diceValues = player.dicePool.getAllValues();
    }

    // 敌人规则（简化：只处理影响骰子的规则）
    if (enemy.rules.includes("swap_dice")) {
      player.dicePool.rerollRandom(1);
      diceValues = player.dicePool.getAllValues();
    }
    if (enemy.rules.includes("suppress_all")) {
      player.dicePool.decreaseAll(1, 1);
      diceValues = player.dicePool.getAllValues();
    }

    // 铅骰托底
    if (player.passives.includes("loaded_dice")) {
      player.dicePool.setFloor(2);
      diceValues = player.dicePool.getAllValues();
    }

    // 计分
    const blockedCats = enemy.rules.includes("block_pair") ? ["pair"] : [];
    const result = scoreWithPassives(diceValues, player.passives, { blockedCategories: blockedCats });

    let finalScore = result.finalScore;

    // 最低点归零（敌人规则影响计分）
    if (enemy.rules.includes("zero_lowest")) {
      const adjustedSum = applyZeroLowest(diceValues);
      const cat = result.category;
      const catBase = cat.bonusType === "multiplier"
        ? adjustedSum * cat.bonusValue
        : adjustedSum + cat.bonusValue;
      const { flatTotal, multiplierTotal } = calcBonuses(
        player.passives, cat, result.matchInfo, diceValues
      );
      finalScore = Math.max(0, Math.floor((catBase + flatTotal) * multiplierTotal + 1e-9));
    }

    // 封印被动（简化：封印最贵被动，在加成计算时排除）
    if (enemy.rules.includes("seal_passive") && player.passives.length > 0) {
      // 重新计算，排除最贵被动
      let maxCost = -1;
      let sealedId = null;
      for (const pid of player.passives) {
        if (PASSIVE_DEFS[pid].cost > maxCost) {
          maxCost = PASSIVE_DEFS[pid].cost;
          sealedId = pid;
        }
      }
      const reducedPassives = player.passives.filter(p => p !== sealedId);
      const r2 = scoreWithPassives(diceValues, reducedPassives, { blockedCategories: blockedCats });
      finalScore = r2.finalScore;
    }

    const victory = finalScore >= enemy.targetScore;
    const tokensEarned = victory ? TOKEN_REWARDS[round] : 0;
    player.tokens += tokensEarned;

    roundResults.push({
      round: round + 1,
      dice: [...diceValues],
      category: result.category.name,
      finalScore,
      targetScore: enemy.targetScore,
      victory,
      tokensEarned,
      passives: [...player.passives],
    });

    if (!victory) {
      return { completed: false, defeatedAt: round + 1, roundResults, finalRound: round + 1 };
    }

    // ---- 商店 ----
    player.consumables = []; // 消耗品不留到下轮（简化）
    shopStrategy(player, round, rng);
  }

  return { completed: true, defeatedAt: 0, roundResults, finalRound: 8 };
}

/**
 * 贪心商店策略：优先买被动，其次消耗品，最后骰子扩展
 */
function greedyShopStrategy(player, round, rng) {
  const availablePassives = PASSIVE_IDS.filter(id => !player.passives.includes(id));

  // 按优先级购买被动
  const priority = ["greed", "loaded_dice", "chain_link", "loose_eye", "pattern_master", "clone_dice"];
  for (const pid of priority) {
    if (!availablePassives.includes(pid)) continue;
    const cost = PASSIVE_DEFS[pid].cost;
    if (player.tokens >= cost) {
      player.passives.push(pid);
      player.tokens -= cost;
    }
  }

  // 买换面消耗品（每次商店可买1个）
  if (player.tokens >= 2) {
    player.consumables.push({ ...CONSUMABLE_DEFS.face_change });
    player.tokens -= 2;
  }

  // 如果还有代币，买骰子扩展
  if (player.tokens >= 4 && player.diceCount < 7) {
    player.diceCount++;
    player.tokens -= 4;
  }
}

/**
 * 扩展优先策略：前3轮优先买骰子扩展，再买被动和消耗品
 * 模拟游戏概念中"骰子扩展在前3轮出现概率提高"的设计意图
 */
function expansionFirstStrategy(player, round, rng) {
  const availablePassives = PASSIVE_IDS.filter(id => !player.passives.includes(id));

  // 前3轮：优先骰子扩展
  if (round < 3 && player.diceCount < 7 && player.tokens >= 4) {
    player.diceCount++;
    player.tokens -= 4;
  }

  // 买消耗品
  if (player.tokens >= 2) {
    player.consumables.push({ ...CONSUMABLE_DEFS.face_change });
    player.tokens -= 2;
  }

  // 买被动（按优先级）
  const priority = ["greed", "loaded_dice", "chain_link", "loose_eye", "pattern_master", "clone_dice"];
  for (const pid of priority) {
    if (!availablePassives.includes(pid)) continue;
    const cost = PASSIVE_DEFS[pid].cost;
    if (player.tokens >= cost) {
      player.passives.push(pid);
      player.tokens -= cost;
    }
  }

  // 后期再买骰子扩展
  if (round >= 3 && player.diceCount < 7 && player.tokens >= 4) {
    player.diceCount++;
    player.tokens -= 4;
  }
}

/**
 * 随机商店策略：随机购买
 */
function randomShopStrategy(player, round, rng) {
  const availablePassives = PASSIVE_IDS.filter(id => !player.passives.includes(id));

  // 随机打乱
  const shuffled = [...availablePassives].sort(() => (rng() + rng() - 7) > 0 ? 1 : -1);

  for (const pid of shuffled) {
    const cost = PASSIVE_DEFS[pid].cost;
    if (player.tokens >= cost) {
      player.passives.push(pid);
      player.tokens -= cost;
    }
  }

  // 买消耗品
  if (player.tokens >= 2) {
    player.consumables.push({ ...CONSUMABLE_DEFS.face_change });
    player.tokens -= 2;
  }

  // 骰子扩展
  if (player.tokens >= 4 && player.diceCount < 7) {
    player.diceCount++;
    player.tokens -= 4;
  }
}

// ============================================================
// 导出
// ============================================================

if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    PASSIVE_DEFS,
    CONSUMABLE_DEFS,
    PASSIVE_IDS,
    ENEMIES,
    TOKEN_REWARDS,
    createRng,
    DicePool,
    calcBonuses,
    scoreWithPassives,
    allPassiveSubsets,
    sampleDiceConfigs,
    simulateGame,
    greedyShopStrategy,
    expansionFirstStrategy,
    randomShopStrategy,
  };
}
