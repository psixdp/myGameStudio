/**
 * 平衡性调优 — 第二轮扫描
 *
 * 第一轮发现：所有方案卡在R3，目标分数曲线太陡
 * 本轮：测试大幅降低的分数曲线，找到合理区间
 */

const {
  PASSIVE_DEFS, CONSUMABLE_DEFS, PASSIVE_IDS,
  createRng, DicePool, calcBonuses, scoreWithPassives,
} = require("./cheating");

function createConfig(o = {}) {
  return {
    initialDice: o.initialDice ?? 3,
    maxDice: o.maxDice ?? 7,
    initialConsumables: o.initialConsumables ?? ["face_change"],
    targetScores: o.targetScores ?? [12, 20, 40, 65, 95, 130, 175, 250],
    tokenRewards: o.tokenRewards ?? [4, 4, 5, 5, 6, 6, 7, 8],
    maxConsumablesPerRound: o.maxConsumablesPerRound ?? 2,
  };
}

function getEnemyRules(round) {
  return [[], [], ["block_pair"], ["zero_lowest"], ["swap_dice"], ["seal_passive"], ["suppress_all"], []][round] || [];
}

const CONSUMABLE_DEFS_LOCAL = {
  face_change: { id: "face_change", name: "换面", effectType: "set_dice_value", cost: 2, params: { min: 1, max: 6 } },
  swap_lowest: { id: "swap_lowest", name: "偷梁换柱", effectType: "replace_lowest", cost: 3, params: { value: 6 } },
};

function simulateGame(seed, config, strategy) {
  const rng = createRng(seed);
  const player = {
    dicePool: new DicePool(config.initialDice, rng),
    passives: [],
    consumables: config.initialConsumables.map(id => ({ ...CONSUMABLE_DEFS_LOCAL[id] })),
    tokens: 0,
    diceCount: config.initialDice,
  };

  for (let round = 0; round < 8; round++) {
    const targetScore = config.targetScores[round];
    const enemyRules = getEnemyRules(round);

    player.dicePool.baseSize = player.diceCount;
    player.dicePool.dice = new Array(player.diceCount).fill(1);
    player.dicePool.clearTemp();
    let diceValues = player.dicePool.rollAll();

    if (player.passives.includes("clone_dice")) {
      player.dicePool.cloneRandom();
      diceValues = player.dicePool.getAllValues();
    }

    if (enemyRules.includes("swap_dice")) {
      player.dicePool.rerollRandom(1);
      diceValues = player.dicePool.getAllValues();
    }
    if (enemyRules.includes("suppress_all")) {
      player.dicePool.decreaseAll(1, 1);
      diceValues = player.dicePool.getAllValues();
    }

    // 消耗品：智能使用 — 造对子/三条而非简单设6
    let used = 0;
    while (used < config.maxConsumablesPerRound && player.consumables.length > 0) {
      const c = player.consumables.shift();
      used++;

      if (c.effectType === "set_dice_value") {
        // 智能换面：找到出现次数最多的值，把最低骰子变成那个值（造三条/对子）
        const vals = player.dicePool.dice;
        const freq = {};
        for (const v of vals) freq[v] = (freq[v] || 0) + 1;
        let bestVal = 6, bestCount = 0;
        for (const [v, c] of Object.entries(freq)) {
          if (c > bestCount || (c === bestCount && Number(v) > bestVal)) {
            bestCount = c; bestVal = Number(v);
          }
        }
        // 找一个不是bestVal的最低骰子
        let target = -1, minV = 7;
        for (let i = 0; i < vals.length; i++) {
          if (vals[i] !== bestVal && vals[i] < minV) { minV = vals[i]; target = i; }
        }
        if (target >= 0) player.dicePool.setDie(target, bestVal);
        else {
          // 全一样或没有不是bestVal的，设最低为6
          let minIdx = 0;
          for (let i = 1; i < vals.length; i++) if (vals[i] < vals[minIdx]) minIdx = i;
          if (vals[minIdx] < 6) player.dicePool.setDie(minIdx, 6);
        }
      } else if (c.effectType === "replace_lowest") {
        player.dicePool.replaceLowest(6);
      } else if (c.effectType === "extra_roll") {
        player.dicePool.clearTemp();
        diceValues = player.dicePool.rollAll();
        if (player.passives.includes("clone_dice")) player.dicePool.cloneRandom();
        if (enemyRules.includes("swap_dice")) player.dicePool.rerollRandom(1);
        if (enemyRules.includes("suppress_all")) player.dicePool.decreaseAll(1, 1);
      }
      diceValues = player.dicePool.getAllValues();
    }

    if (player.passives.includes("loaded_dice")) {
      player.dicePool.setFloor(2);
      diceValues = player.dicePool.getAllValues();
    }

    const blockedCats = enemyRules.includes("block_pair") ? ["pair"] : [];
    const result = scoreWithPassives(diceValues, player.passives, { blockedCategories: blockedCats });
    let finalScore = result.finalScore;

    if (enemyRules.includes("zero_lowest")) {
      const adjustedSum = diceValues.reduce((s, v) => s + v, 0) - Math.min(...diceValues);
      const cat = result.category;
      const catBase = cat.bonusType === "multiplier" ? adjustedSum * cat.bonusValue : adjustedSum + cat.bonusValue;
      const { flatTotal, multiplierTotal } = calcBonuses(player.passives, cat, result.matchInfo, diceValues);
      finalScore = Math.max(0, Math.floor((catBase + flatTotal) * multiplierTotal + 1e-9));
    }

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

    if (!victory) {
      return { completed: false, defeatedAt: round + 1, finalScore, targetScore };
    }

    // 商店
    strategy(player, round, rng, config);
  }

  return { completed: true, defeatedAt: 0, finalScore: 0, targetScore: 0 };
}

/** 扩展优先策略 */
function expansionStrategy(player, round, rng, config) {
  const available = PASSIVE_IDS.filter(id => !player.passives.includes(id));

  // 前2轮优先骰子扩展
  if (round < 2 && player.diceCount < config.maxDice && player.tokens >= 4) {
    player.diceCount++;
    player.tokens -= 4;
  }

  // 买消耗品
  while (player.tokens >= 2 && player.consumables.length < 3) {
    player.consumables.push({ ...CONSUMABLE_DEFS_LOCAL.face_change });
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

function runSim(config, games = 2000) {
  let wins = 0;
  const roundWins = new Array(8).fill(0);
  const roundAttempts = new Array(8).fill(0);
  const roundScores = new Array(8).fill(null).map(() => []);

  for (let seed = 1; seed <= games; seed++) {
    // 手动展开模拟以收集每轮数据
    const rng = createRng(seed);
    const player = {
      dicePool: new DicePool(config.initialDice, rng),
      passives: [],
      consumables: config.initialConsumables.map(id => ({ ...CONSUMABLE_DEFS_LOCAL[id] })),
      tokens: 0,
      diceCount: config.initialDice,
    };
    let defeated = false;

    for (let round = 0; round < 8; round++) {
      const targetScore = config.targetScores[round];
      const enemyRules = getEnemyRules(round);

      player.dicePool.baseSize = player.diceCount;
      player.dicePool.dice = new Array(player.diceCount).fill(1);
      player.dicePool.clearTemp();
      let diceValues = player.dicePool.rollAll();

      if (player.passives.includes("clone_dice")) {
        player.dicePool.cloneRandom();
        diceValues = player.dicePool.getAllValues();
      }
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

      roundAttempts[round]++;
      roundScores[round].push(finalScore);
      if (finalScore >= targetScore) {
        roundWins[round]++;
        player.tokens += config.tokenRewards[round];
        expansionStrategy(player, round, rng, config);
      } else {
        defeated = true;
        break;
      }
    }
    if (!defeated) wins++;
  }

  return {
    wins, games, winRate: (wins / games * 100).toFixed(1),
    roundPassRates: roundWins.map((w, i) => roundAttempts[i] > 0 ? (w / roundAttempts[i] * 100).toFixed(1) : "—"),
    roundAvgScores: roundScores.map(arr => arr.length > 0 ? (arr.reduce((s, v) => s + v, 0) / arr.length).toFixed(1) : "—"),
    roundP50Scores: roundScores.map(arr => {
      if (arr.length === 0) return "—";
      const sorted = [...arr].sort((a, b) => a - b);
      return sorted[Math.floor(sorted.length / 2)];
    }),
  };
}

function printResult(name, r, config) {
  console.log(`\n=== ${name} ===`);
  console.log(`  参数: 骰子=${config.initialDice}, 目标=${config.targetScores}`);
  console.log(`  通关率: ${r.wins}/${r.games} (${r.winRate}%)`);
  console.log("  轮次  目标  通过率   平均分  中位分");
  for (let i = 0; i < 8; i++) {
    if (r.roundPassRates[i] === "—") break;
    console.log(`  R${i + 1}    ${String(config.targetScores[i]).padStart(3)}   ${r.roundPassRates[i].padStart(5)}%   ${r.roundAvgScores[i].padStart(5)}   ${String(r.roundP50Scores[i]).padStart(4)}`);
  }
}

const GAMES = 2000;

// ============================================================
// 诊断：当前参数下各轮实际分数分布
// ============================================================
console.log("=".repeat(80));
console.log("第一部分：诊断当前参数分数分布（2000局）");
console.log("=".repeat(80));

const baseResult = runSim(createConfig(), GAMES);
printResult("基线诊断", baseResult, createConfig());

// ============================================================
// 第二部分：目标分数曲线调整
// ============================================================
console.log("\n" + "=".repeat(80));
console.log("第二部分：目标分数曲线扫描");
console.log("=".repeat(80));

const curves = [
  { name: "曲线1: 温和降低", targets: [12, 18, 35, 55, 80, 110, 155, 220] },
  { name: "曲线2: 中度降低", targets: [12, 15, 30, 50, 75, 105, 145, 200] },
  { name: "曲线3: 大幅降低", targets: [10, 15, 28, 45, 65, 90, 125, 180] },
  { name: "曲线4: 极度降低", targets: [8, 12, 25, 40, 58, 80, 110, 160] },
];

for (const curve of curves) {
  const r = runSim(createConfig({ targetScores: curve.targets }), GAMES);
  printResult(curve.name, r, createConfig({ targetScores: curve.targets }));
}

// ============================================================
// 第三部分：初始骰子数 + 目标曲线组合
// ============================================================
console.log("\n" + "=".repeat(80));
console.log("第三部分：初始骰子×目标曲线组合");
console.log("=".repeat(80));

const combos = [
  { name: "4骰+曲线2", dice: 4, targets: [12, 15, 30, 50, 75, 105, 145, 200] },
  { name: "4骰+曲线3", dice: 4, targets: [10, 15, 28, 45, 65, 90, 125, 180] },
  { name: "4骰+曲线4", dice: 4, targets: [8, 12, 25, 40, 58, 80, 110, 160] },
  { name: "4骰+2消耗品+曲线3", dice: 4, targets: [10, 15, 28, 45, 65, 90, 125, 180], consumables: ["face_change", "face_change"] },
  { name: "4骰+2消耗品+曲线4", dice: 4, targets: [8, 12, 25, 40, 58, 80, 110, 160], consumables: ["face_change", "face_change"] },
];

for (const c of combos) {
  const cfg = createConfig({ initialDice: c.dice, targetScores: c.targets, initialConsumables: c.consumables });
  const r = runSim(cfg, GAMES);
  printResult(c.name, r, cfg);
}

console.log("\n" + "=".repeat(80));
console.log("扫描完成");
console.log("=".repeat(80));
