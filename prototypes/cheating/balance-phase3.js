/**
 * 平衡性调优 — 第三轮：匹配实际分数分布
 *
 * 发现：平均分从R3(24)到R5(35)几乎不增长，被动增长太慢
 * 策略：将目标分数对齐实际分数的中位数/75分位，而非假设的理想值
 */

const {
  PASSIVE_DEFS, CONSUMABLE_DEFS, PASSIVE_IDS,
  createRng, DicePool, calcBonuses, scoreWithPassives,
} = require("./cheating");

function createConfig(o = {}) {
  return {
    initialDice: o.initialDice ?? 4,
    maxDice: o.maxDice ?? 7,
    initialConsumables: o.initialConsumables ?? ["face_change", "face_change"],
    targetScores: o.targetScores ?? [12, 20, 40, 65, 95, 130, 175, 250],
    tokenRewards: o.tokenRewards ?? [5, 5, 6, 6, 7, 7, 8, 10],
    maxConsumablesPerRound: o.maxConsumablesPerRound ?? 2,
    diceExpansionCost: o.diceExpansionCost ?? 3,
  };
}

const CONSUMABLE_DEFS_LOCAL = {
  face_change: { id: "face_change", name: "换面", effectType: "set_dice_value", cost: 2, params: { min: 1, max: 6 } },
  swap_lowest: { id: "swap_lowest", name: "偷梁换柱", effectType: "replace_lowest", cost: 3, params: { value: 6 } },
};

function getEnemyRules(round) {
  return [[], [], ["block_pair"], ["zero_lowest"], ["swap_dice"], ["seal_passive"], ["suppress_all"], []][round] || [];
}

function simulateDetailed(seed, config, strategy) {
  const rng = createRng(seed);
  const player = {
    dicePool: new DicePool(config.initialDice, rng),
    passives: [],
    consumables: config.initialConsumables.map(id => ({ ...CONSUMABLE_DEFS_LOCAL[id] })),
    tokens: 0,
    diceCount: config.initialDice,
  };
  const rounds = [];

  for (let round = 0; round < 8; round++) {
    const targetScore = config.targetScores[round];
    const enemyRules = getEnemyRules(round);

    player.dicePool.baseSize = player.diceCount;
    player.dicePool.dice = new Array(player.diceCount).fill(1);
    player.dicePool.clearTemp();
    let diceValues = player.dicePool.rollAll();

    if (player.passives.includes("clone_dice")) { player.dicePool.cloneRandom(); diceValues = player.dicePool.getAllValues(); }
    if (enemyRules.includes("swap_dice")) { player.dicePool.rerollRandom(1); diceValues = player.dicePool.getAllValues(); }
    if (enemyRules.includes("suppress_all")) { player.dicePool.decreaseAll(1, 1); diceValues = player.dicePool.getAllValues(); }

    let used = 0;
    while (used < config.maxConsumablesPerRound && player.consumables.length > 0) {
      const c = player.consumables.shift(); used++;
      if (c.effectType === "set_dice_value") {
        const vals = player.dicePool.dice;
        const freq = {};
        for (const v of vals) freq[v] = (freq[v] || 0) + 1;
        let bestVal = 6, bestCount = 0;
        for (const [v, cnt] of Object.entries(freq)) {
          if (cnt > bestCount || (cnt === bestCount && Number(v) > bestVal)) { bestCount = cnt; bestVal = Number(v); }
        }
        let target = -1, minV = 7;
        for (let i = 0; i < vals.length; i++) { if (vals[i] !== bestVal && vals[i] < minV) { minV = vals[i]; target = i; } }
        if (target >= 0) player.dicePool.setDie(target, bestVal);
        else { let mi = 0; for (let i = 1; i < vals.length; i++) if (vals[i] < vals[mi]) mi = i; if (vals[mi] < 6) player.dicePool.setDie(mi, 6); }
      } else if (c.effectType === "replace_lowest") {
        player.dicePool.replaceLowest(6);
      } else if (c.effectType === "extra_roll") {
        player.dicePool.clearTemp(); diceValues = player.dicePool.rollAll();
        if (player.passives.includes("clone_dice")) player.dicePool.cloneRandom();
        if (enemyRules.includes("swap_dice")) player.dicePool.rerollRandom(1);
        if (enemyRules.includes("suppress_all")) player.dicePool.decreaseAll(1, 1);
      }
      diceValues = player.dicePool.getAllValues();
    }

    if (player.passives.includes("loaded_dice")) { player.dicePool.setFloor(2); diceValues = player.dicePool.getAllValues(); }

    const blockedCats = enemyRules.includes("block_pair") ? ["pair"] : [];
    const result = scoreWithPassives(diceValues, player.passives, { blockedCategories: blockedCats });
    let finalScore = result.finalScore;
    if (enemyRules.includes("zero_lowest")) {
      const adj = diceValues.reduce((s, v) => s + v, 0) - Math.min(...diceValues);
      const cat = result.category;
      const cb = cat.bonusType === "multiplier" ? adj * cat.bonusValue : adj + cat.bonusValue;
      const { flatTotal, multiplierTotal } = calcBonuses(player.passives, cat, result.matchInfo, diceValues);
      finalScore = Math.max(0, Math.floor((cb + flatTotal) * multiplierTotal + 1e-9));
    }
    if (enemyRules.includes("seal_passive") && player.passives.length > 0) {
      let mc = -1, si = null;
      for (const pid of player.passives) { if (PASSIVE_DEFS[pid].cost > mc) { mc = PASSIVE_DEFS[pid].cost; si = pid; } }
      finalScore = scoreWithPassives(diceValues, player.passives.filter(p => p !== si), { blockedCategories: blockedCats }).finalScore;
    }

    const victory = finalScore >= targetScore;
    const tokensEarned = victory ? config.tokenRewards[round] : 0;
    player.tokens += tokensEarned;

    rounds.push({
      round: round + 1, finalScore, targetScore, victory, tokensEarned,
      diceCount: player.diceCount, passives: [...player.passives],
      consumablesLeft: player.consumables.length, tokensLeft: player.tokens - tokensEarned,
    });

    if (!victory) return { completed: false, defeatedAt: round + 1, rounds };
    strategy(player, round, rng, config);
  }
  return { completed: true, defeatedAt: 0, rounds };
}

/** 混合策略：根据轮次平衡骰子扩展和被动 */
function balancedStrategy(player, round, rng, config) {
  const available = PASSIVE_IDS.filter(id => !player.passives.includes(id));
  const expCost = config.diceExpansionCost;

  // 前1轮扩展骰子（如果初始<5）
  if (round === 0 && player.diceCount < 5 && player.tokens >= expCost) {
    player.diceCount++;
    player.tokens -= expCost;
  }

  // 买消耗品
  if (player.tokens >= 2 && player.consumables.length < 2) {
    player.consumables.push({ ...CONSUMABLE_DEFS_LOCAL.face_change });
    player.tokens -= 2;
  }

  // 买被动（按性价比优先）
  const priority = ["greed", "loaded_dice", "chain_link", "loose_eye", "pattern_master", "clone_dice"];
  for (const pid of priority) {
    if (!available.includes(pid)) continue;
    if (player.tokens >= PASSIVE_DEFS[pid].cost) {
      player.passives.push(pid);
      player.tokens -= PASSIVE_DEFS[pid].cost;
      break; // 一次买一个，优先留钱买消耗品
    }
  }

  // 后期扩展
  if (round >= 3 && player.diceCount < config.maxDice && player.tokens >= expCost) {
    player.diceCount++;
    player.tokens -= expCost;
  }
}

function runBatch(config, games = 3000) {
  let wins = 0;
  const rWins = new Array(8).fill(0);
  const rAttempts = new Array(8).fill(0);
  const rScores = Array.from({ length: 8 }, () => []);

  for (let seed = 1; seed <= games; seed++) {
    const res = simulateDetailed(seed, config, balancedStrategy);
    for (const r of res.rounds) {
      const i = r.round - 1;
      rAttempts[i]++;
      rScores[i].push(r.finalScore);
      if (r.victory) rWins[i]++;
    }
    if (res.completed) wins++;
  }

  const pct = (n, d) => d > 0 ? (n / d * 100).toFixed(1) : "—";
  const avg = arr => arr.length > 0 ? (arr.reduce((s, v) => s + v, 0) / arr.length).toFixed(1) : "—";
  const p75 = arr => {
    if (arr.length === 0) return "—";
    const s = [...arr].sort((a, b) => a - b);
    return s[Math.floor(s.length * 0.75)];
  };

  return { wins, games, winRate: pct(wins, games),
    rounds: Array.from({ length: 8 }, (_, i) => ({
      passRate: pct(rWins[i], rAttempts[i]),
      avg: avg(rScores[i]),
      p75: p75(rScores[i]),
      attempts: rAttempts[i],
    }))
  };
}

function printResult(name, r, config) {
  console.log(`\n=== ${name} ===`);
  console.log(`  参数: 骰子=${config.initialDice}, 目标=[${config.targetScores}], 代币=[${config.tokenRewards}]`);
  console.log(`  消耗品=${config.initialConsumables.length}个, 扩展费=${config.diceExpansionCost}`);
  console.log(`  通关率: ${r.wins}/${r.games} (${r.winRate}%)`);
  console.log("  轮次  目标  通过率   平均分  P75分");
  for (let i = 0; i < 8; i++) {
    if (r.rounds[i].attempts === 0) break;
    const rd = r.rounds[i];
    console.log(`  R${i + 1}    ${String(config.targetScores[i]).padStart(3)}   ${rd.passRate.padStart(5)}%   ${rd.avg.padStart(5)}   ${String(rd.p75).padStart(4)}`);
  }
}

const G = 3000;

console.log("=".repeat(80));
console.log("千王骰局 — 平衡性调优 第三轮");
console.log("匹配实际分数分布，找到合理目标曲线");
console.log(`每方案 ${G} 局`);
console.log("=".repeat(80));

// 方案1：4骰起步 + 高代币 + 降低目标
printResult("方案1: 4骰+高代币+降目标", runBatch(createConfig({
  targetScores: [10, 15, 25, 40, 55, 75, 100, 140],
  tokenRewards: [5, 5, 6, 6, 7, 7, 8, 10],
  initialDice: 4,
  initialConsumables: ["face_change", "face_change"],
  diceExpansionCost: 3,
}), G), createConfig({
  targetScores: [10, 15, 25, 40, 55, 75, 100, 140],
  tokenRewards: [5, 5, 6, 6, 7, 7, 8, 10],
  initialDice: 4,
  initialConsumables: ["face_change", "face_change"],
  diceExpansionCost: 3,
}));

// 方案2：方案1基础上微调R4-R6
printResult("方案2: 降R4-R6", runBatch(createConfig({
  targetScores: [10, 15, 25, 35, 50, 70, 95, 135],
  tokenRewards: [5, 5, 6, 6, 7, 7, 8, 10],
  initialDice: 4,
  initialConsumables: ["face_change", "face_change"],
  diceExpansionCost: 3,
}), G), createConfig({
  targetScores: [10, 15, 25, 35, 50, 70, 95, 135],
  tokenRewards: [5, 5, 6, 6, 7, 7, 8, 10],
  initialDice: 4,
  initialConsumables: ["face_change", "face_change"],
  diceExpansionCost: 3,
}));

// 方案3：更温和的目标增长
printResult("方案3: 更缓曲线", runBatch(createConfig({
  targetScores: [10, 14, 22, 32, 45, 60, 80, 110],
  tokenRewards: [5, 5, 6, 6, 7, 7, 8, 10],
  initialDice: 4,
  initialConsumables: ["face_change", "face_change"],
  diceExpansionCost: 3,
}), G), createConfig({
  targetScores: [10, 14, 22, 32, 45, 60, 80, 110],
  tokenRewards: [5, 5, 6, 6, 7, 7, 8, 10],
  initialDice: 4,
  initialConsumables: ["face_change", "face_change"],
  diceExpansionCost: 3,
}));

// 方案4：原版代币+4骰+降目标
printResult("方案4: 原版代币+4骰", runBatch(createConfig({
  targetScores: [10, 15, 25, 40, 55, 75, 100, 140],
  tokenRewards: [4, 4, 5, 5, 6, 6, 7, 8],
  initialDice: 4,
  initialConsumables: ["face_change"],
  diceExpansionCost: 4,
}), G), createConfig({
  targetScores: [10, 15, 25, 40, 55, 75, 100, 140],
  tokenRewards: [4, 4, 5, 5, 6, 6, 7, 8],
  initialDice: 4,
  initialConsumables: ["face_change"],
  diceExpansionCost: 4,
}));

// 方案5：激进代币+最缓曲线
printResult("方案5: 激进代币+缓曲线", runBatch(createConfig({
  targetScores: [10, 14, 22, 32, 45, 60, 80, 110],
  tokenRewards: [6, 6, 7, 7, 8, 8, 9, 12],
  initialDice: 4,
  initialConsumables: ["face_change", "face_change"],
  diceExpansionCost: 3,
}), G), createConfig({
  targetScores: [10, 14, 22, 32, 45, 60, 80, 110],
  tokenRewards: [6, 6, 7, 7, 8, 8, 9, 12],
  initialDice: 4,
  initialConsumables: ["face_change", "face_change"],
  diceExpansionCost: 3,
}));

console.log("\n" + "=".repeat(80));
console.log("推荐：选择通关率 10-30% 的方案作为最终参数");
console.log("=".repeat(80));
