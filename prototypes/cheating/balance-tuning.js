/**
 * 平衡性调优脚本 — 千王骰局
 *
 * 基于 Monte Carlo 模拟测试不同参数组合的胜率和分数分布
 * 目标：找到使游戏有 ~10-30% 通关率（最优策略下）的参数
 */

const {
  PASSIVE_DEFS, CONSUMABLE_DEFS, PASSIVE_IDS,
  createRng, DicePool, calcBonuses, scoreWithPassives,
} = require("./cheating");

// ============================================================
// 可调参数
// ============================================================

function createConfig(overrides = {}) {
  return {
    initialDice: overrides.initialDice ?? 3,
    maxDice: overrides.maxDice ?? 7,
    initialConsumables: overrides.initialConsumables ?? ["face_change"],
    targetScores: overrides.targetScores ?? [12, 20, 40, 65, 95, 130, 175, 250],
    tokenRewards: overrides.tokenRewards ?? [4, 4, 5, 5, 6, 6, 7, 8],
    maxConsumablesPerRound: overrides.maxConsumablesPerRound ?? 2,
  };
}

const BASE_CONFIG = createConfig();

// ============================================================
// 模拟引擎（参数化版本）
// ============================================================

function simulateGameWithConfig(seed, config, shopStrategy) {
  const rng = createRng(seed);
  const player = {
    dicePool: new DicePool(config.initialDice, rng),
    passives: [],
    consumables: config.initialConsumables.map(id => ({ ...CONSUMABLE_DEFS[id] })),
    tokens: 0,
    diceCount: config.initialDice,
  };

  const roundResults = [];

  for (let round = 0; round < 8; round++) {
    const targetScore = config.targetScores[round];
    const enemyRules = getEnemyRules(round);

    // ---- 战斗 ----
    player.dicePool.baseSize = player.diceCount;
    player.dicePool.dice = new Array(player.diceCount).fill(1);
    player.dicePool.clearTemp();
    let diceValues = player.dicePool.rollAll();

    // 分身术
    if (player.passives.includes("clone_dice")) {
      player.dicePool.cloneRandom();
      diceValues = player.dicePool.getAllValues();
    }

    // 敌人规则
    if (enemyRules.includes("swap_dice")) {
      player.dicePool.rerollRandom(1);
      diceValues = player.dicePool.getAllValues();
    }
    if (enemyRules.includes("suppress_all")) {
      player.dicePool.decreaseAll(1, 1);
      diceValues = player.dicePool.getAllValues();
    }

    // ---- 消耗品使用 ----
    let used = 0;
    while (used < config.maxConsumablesPerRound && player.consumables.length > 0) {
      const c = player.consumables.shift();
      used++;
      if (c.effectType === "set_dice_value") {
        const vals = player.dicePool.dice;
        let minIdx = 0;
        for (let i = 1; i < vals.length; i++) {
          if (vals[i] < vals[minIdx]) minIdx = i;
        }
        if (vals[minIdx] < 6) player.dicePool.setDie(minIdx, 6);
      } else if (c.effectType === "replace_lowest") {
        player.dicePool.replaceLowest(6);
      } else if (c.effectType === "reroll_min") {
        const vals = player.dicePool.dice;
        let minIdx = 0;
        for (let i = 1; i < vals.length; i++) {
          if (vals[i] < vals[minIdx]) minIdx = i;
        }
        player.dicePool.setDie(minIdx, Math.max(4, rng()));
      } else if (c.effectType === "extra_roll") {
        player.dicePool.clearTemp();
        diceValues = player.dicePool.rollAll();
        if (player.passives.includes("clone_dice")) player.dicePool.cloneRandom();
        if (enemyRules.includes("swap_dice")) player.dicePool.rerollRandom(1);
        if (enemyRules.includes("suppress_all")) player.dicePool.decreaseAll(1, 1);
      }
      diceValues = player.dicePool.getAllValues();
    }

    // 铅骰托底
    if (player.passives.includes("loaded_dice")) {
      player.dicePool.setFloor(2);
      diceValues = player.dicePool.getAllValues();
    }

    // ---- 计分 ----
    const blockedCats = enemyRules.includes("block_pair") ? ["pair"] : [];
    const result = scoreWithPassives(diceValues, player.passives, { blockedCategories: blockedCats });
    let finalScore = result.finalScore;

    // 最低点归零
    if (enemyRules.includes("zero_lowest")) {
      const adjustedSum = diceValues.reduce((s, v) => s + v, 0) - Math.min(...diceValues);
      const cat = result.category;
      const catBase = cat.bonusType === "multiplier"
        ? adjustedSum * cat.bonusValue
        : adjustedSum + cat.bonusValue;
      const { flatTotal, multiplierTotal } = calcBonuses(player.passives, cat, result.matchInfo, diceValues);
      finalScore = Math.max(0, Math.floor((catBase + flatTotal) * multiplierTotal + 1e-9));
    }

    // 封印被动
    if (enemyRules.includes("seal_passive") && player.passives.length > 0) {
      let maxCost = -1, sealedId = null;
      for (const pid of player.passives) {
        if (PASSIVE_DEFS[pid].cost > maxCost) { maxCost = PASSIVE_DEFS[pid].cost; sealedId = pid; }
      }
      const reduced = player.passives.filter(p => p !== sealedId);
      const r2 = scoreWithPassives(diceValues, reduced, { blockedCategories: blockedCats });
      finalScore = r2.finalScore;
    }

    const victory = finalScore >= targetScore;
    const tokensEarned = victory ? config.tokenRewards[round] : 0;
    player.tokens += tokensEarned;

    roundResults.push({
      round: round + 1, dice: [...diceValues], category: result.category.name,
      finalScore, targetScore, victory, tokensEarned, passives: [...player.passives],
    });

    if (!victory) {
      return { completed: false, defeatedAt: round + 1, roundResults };
    }

    // ---- 商店 ----
    shopStrategy(player, round, rng, config);
  }

  return { completed: true, defeatedAt: 0, roundResults };
}

function getEnemyRules(round) {
  const rules = [[], [], ["block_pair"], ["zero_lowest"], ["swap_dice"], ["seal_passive"], ["suppress_all"], []];
  return rules[round] || [];
}

// ============================================================
// 商店策略
// ============================================================

/** 扩展优先：前2轮买骰子扩展，之后买被动 */
function smartStrategy(player, round, rng, config) {
  const available = PASSIVE_IDS.filter(id => !player.passives.includes(id));

  // 前2轮优先骰子扩展
  if (round < 2 && player.diceCount < config.maxDice && player.tokens >= 4) {
    player.diceCount++;
    player.tokens -= 4;
  }

  // 买消耗品
  if (player.tokens >= 2) {
    player.consumables.push({ ...CONSUMABLE_DEFS.face_change });
    player.tokens -= 2;
  }

  // 买被动
  const priority = ["greed", "loaded_dice", "chain_link", "loose_eye", "pattern_master", "clone_dice"];
  for (const pid of priority) {
    if (!available.includes(pid)) continue;
    if (player.tokens >= PASSIVE_DEFS[pid].cost) {
      player.passives.push(pid);
      player.tokens -= PASSIVE_DEFS[pid].cost;
    }
  }

  // 后期骰子扩展
  if (round >= 2 && player.diceCount < config.maxDice && player.tokens >= 4) {
    player.diceCount++;
    player.tokens -= 4;
  }
}

// ============================================================
// 参数扫描
// ============================================================

function runSimulation(config, strategy, gameCount = 2000) {
  let wins = 0;
  let maxScore = 0;
  const roundWins = new Array(8).fill(0);
  const roundAttempts = new Array(8).fill(0);

  for (let seed = 1; seed <= gameCount; seed++) {
    const result = simulateGameWithConfig(seed, config, strategy);
    if (result.completed) wins++;

    for (const r of result.roundResults) {
      roundAttempts[r.round - 1]++;
      if (r.victory) roundWins[r.round - 1]++;
      maxScore = Math.max(maxScore, r.finalScore);
    }
  }

  const roundPassRates = roundWins.map((w, i) =>
    roundAttempts[i] > 0 ? (w / roundAttempts[i] * 100).toFixed(1) : "—"
  );

  return { wins, gameCount, winRate: (wins / gameCount * 100).toFixed(1), maxScore, roundPassRates };
}

function printResult(name, result) {
  console.log(`  ${name}: ${result.wins}/${result.gameCount} (${result.winRate}%) | 最高分=${result.maxScore} | 各轮: ${result.roundPassRates.join(", ")}`);
}

// ============================================================
// 扫描方案
// ============================================================

const GAMES = 2000;

console.log("=".repeat(80));
console.log("千王骰局 — 平衡性参数扫描");
console.log(`每方案 ${GAMES} 局 Monte Carlo 模拟`);
console.log("=".repeat(80));

// ---- 方案 A：当前参数（基线） ----
console.log("\n--- A: 基线（当前参数） ---");
console.log("  骰子=3, 目标=[12,20,40,65,95,130,175,250], 初始消耗品=1换面");
printResult("扩展优先", runSimulation(BASE_CONFIG, smartStrategy, GAMES));

// ---- 方案 B：增加初始骰子到4 ----
console.log("\n--- B: 初始骰子=4 ---");
printResult("扩展优先", runSimulation(createConfig({ initialDice: 4 }), smartStrategy, GAMES));

// ---- 方案 C：降低前2轮目标 ----
console.log("\n--- C: 降低前2轮目标 [10,15,...] ---");
printResult("扩展优先", runSimulation(createConfig({ targetScores: [10, 15, 40, 65, 95, 130, 175, 250] }), smartStrategy, GAMES));

// ---- 方案 D：增加初始消耗品到2个 ----
console.log("\n--- D: 初始消耗品=2换面 ---");
printResult("扩展优先", runSimulation(createConfig({ initialConsumables: ["face_change", "face_change"] }), smartStrategy, GAMES));

// ---- 方案 E：增加R1代币 ----
console.log("\n--- E: R1代币=6（更快买扩展） ---");
printResult("扩展优先", runSimulation(createConfig({ tokenRewards: [6, 4, 5, 5, 6, 6, 7, 8] }), smartStrategy, GAMES));

// ---- 方案 F：B+C（初始4骰+降前2轮目标） ----
console.log("\n--- F: 初始4骰+降前2轮目标 ---");
printResult("扩展优先", runSimulation(createConfig({
  initialDice: 4,
  targetScores: [10, 15, 40, 65, 95, 130, 175, 250],
}), smartStrategy, GAMES));

// ---- 方案 G：B+C+D（初始4骰+降目标+2消耗品） ----
console.log("\n--- G: 初始4骰+降目标+2消耗品 ---");
printResult("扩展优先", runSimulation(createConfig({
  initialDice: 4,
  targetScores: [10, 15, 40, 65, 95, 130, 175, 250],
  initialConsumables: ["face_change", "face_change"],
}), smartStrategy, GAMES));

// ---- 方案 H：温和调整（初始4骰+略降目标） ----
console.log("\n--- H: 初始4骰+略降目标[10,18,...] ---");
printResult("扩展优先", runSimulation(createConfig({
  initialDice: 4,
  targetScores: [10, 18, 40, 65, 95, 130, 175, 250],
}), smartStrategy, GAMES));

// ---- 方案 I：全面调整（4骰+降目标+更多代币） ----
console.log("\n--- I: 4骰+降目标+R1代币6 ---");
printResult("扩展优先", runSimulation(createConfig({
  initialDice: 4,
  targetScores: [10, 15, 40, 65, 95, 130, 175, 250],
  tokenRewards: [6, 4, 5, 5, 6, 6, 7, 8],
}), smartStrategy, GAMES));

// ---- 方案 J：激进调整（4骰+大降目标） ----
console.log("\n--- J: 4骰+大降目标+2消耗品+R1代币6 ---");
printResult("扩展优先", runSimulation(createConfig({
  initialDice: 4,
  targetScores: [8, 15, 35, 55, 85, 115, 155, 220],
  initialConsumables: ["face_change", "face_change"],
  tokenRewards: [6, 4, 5, 5, 6, 6, 7, 8],
}), smartStrategy, GAMES));

// ---- 方案 K：仅初始4骰+降R2目标 ----
console.log("\n--- K: 4骰+仅降R2[12,15,...]（最小改动） ---");
printResult("扩展优先", runSimulation(createConfig({
  initialDice: 4,
  targetScores: [12, 15, 40, 65, 95, 130, 175, 250],
}), smartStrategy, GAMES));

console.log("\n" + "=".repeat(80));
console.log("扫描完成");
console.log("=".repeat(80));
