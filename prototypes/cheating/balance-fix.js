/**
 * 平衡性调优 — 聚焦 R3+ 瓶颈修复
 *
 * 目标：找到使游戏通关率 5-25% 的参数组合
 * 策略：系统扫描初始骰子数 × 目标曲线 × 初始消耗品 的组合矩阵
 */

const {
  PASSIVE_DEFS, CONSUMABLE_DEFS, PASSIVE_IDS,
  createRng, DicePool, calcBonuses, scoreWithPassives,
} = require("./cheating");

const CONSUMABLE = { id: "face_change", effectType: "set_dice_value", cost: 2 };

// ============================================================
// 目标曲线候选
// ============================================================
const TARGET_CURVES = {
  // 基线（当前）
  original:    { label: "原版",         targets: [12, 20, 40, 65, 95, 130, 175, 250] },
  // 温和降低
  gentle:      { label: "温和降",       targets: [10, 16, 30, 48, 72, 100, 140, 195] },
  // 大幅扁平化
  flat:        { label: "大幅扁平",     targets: [8, 14, 22, 35, 55, 80, 115, 160] },
  // 极度扁平（前期超友好）
  very_flat:   { label: "极度扁平",     targets: [8, 12, 18, 28, 45, 65, 95, 135] },
  // 渐进式（前期低，后期保留挑战）
  progressive: { label: "渐进式",       targets: [8, 14, 24, 38, 58, 85, 120, 175] },
  // 保守渐进
  safe_prog:   { label: "保守渐进",     targets: [8, 12, 20, 32, 50, 75, 108, 155] },
};

// ============================================================
// 代币方案
// ============================================================
const TOKEN_SCHEMES = {
  original: { label: "原版代币", tokens: [4, 4, 5, 5, 6, 6, 7, 8] },
  boosted:  { label: "加量代币", tokens: [5, 5, 6, 6, 7, 7, 8, 9] },
};

function getRules(r) {
  return [[], [], ["block_pair"], ["zero_lowest"], ["swap_dice"], ["seal_passive"], ["suppress_all"], []][r] || [];
}

// ============================================================
// 模拟引擎
// ============================================================
function simulate(seed, initialDice, targets, tokens, initialConsumables, maxRound) {
  const rng = createRng(seed);
  const pl = {
    dp: new DicePool(initialDice, rng),
    passives: [],
    consumables: initialConsumables,
    tokens: 0,
    dc: initialDice,
  };

  const maxR = maxRound || 8;
  const results = [];

  for (let rd = 0; rd < maxR; rd++) {
    const rules = getRules(rd);
    pl.dp.baseSize = pl.dc;
    pl.dp.dice = new Array(pl.dc).fill(1);
    pl.dp.clearTemp();
    let dv = pl.dp.rollAll();

    // 分身术
    if (pl.passives.includes("clone_dice")) { pl.dp.cloneRandom(); dv = pl.dp.getAllValues(); }

    // 敌人规则
    if (rules.includes("swap_dice")) { pl.dp.rerollRandom(1); dv = pl.dp.getAllValues(); }
    if (rules.includes("suppress_all")) { pl.dp.decreaseAll(1, 1); dv = pl.dp.getAllValues(); }

    // 消耗品（智能策略：将骰子往高频值靠拢）
    let used = 0;
    while (used < 2 && pl.consumables.length > 0) {
      const c = pl.consumables.shift(); used++;
      if (c.effectType === "set_dice_value") {
        const vals = pl.dp.dice;
        const freq = {};
        for (const v of vals) freq[v] = (freq[v] || 0) + 1;
        let bV = 6, bC = 0;
        for (const [v, cnt] of Object.entries(freq)) {
          if (cnt > bC || (cnt === bC && Number(v) > bV)) { bC = cnt; bV = Number(v); }
        }
        let t = -1, mV = 7;
        for (let i = 0; i < vals.length; i++) {
          if (vals[i] !== bV && vals[i] < mV) { mV = vals[i]; t = i; }
        }
        if (t >= 0) pl.dp.setDie(t, bV);
        else {
          let mi = 0;
          for (let i = 1; i < vals.length; i++) if (vals[i] < vals[mi]) mi = i;
          if (vals[mi] < 6) pl.dp.setDie(mi, 6);
        }
      }
      dv = pl.dp.getAllValues();
    }

    // 铅骰
    if (pl.passives.includes("loaded_dice")) { pl.dp.setFloor(2); dv = pl.dp.getAllValues(); }

    // 计分
    const blocked = rules.includes("block_pair") ? ["pair"] : [];
    const { category, matchInfo } = (() => {
      const { findBestCategory } = require("../scoring/scoring");
      return findBestCategory(dv, { blockedCategories: blocked, looseConsecutive: pl.passives.includes("loose_eye") });
    })();

    let sum = dv.reduce((s, v) => s + v, 0);
    let base = category.bonusType === "multiplier" ? sum * category.bonusValue : sum + category.bonusValue;

    const ps = new Set(pl.passives);
    let flat = 0;
    if (ps.has("chain_link")) {
      const { calcChainLinkBonus } = require("../scoring/scoring");
      flat += calcChainLinkBonus(dv, category, matchInfo, 3);
    }
    if (ps.has("pattern_master") && ["full_house", "yahtzee"].includes(category.id)) flat += 10;

    let mult = 1.0;
    if (ps.has("greed")) mult *= 1.2;

    let finalScore = Math.max(0, Math.floor((base + flat) * mult + 1e-9));

    // 最低点归零
    if (rules.includes("zero_lowest")) {
      const adj = dv.reduce((s, v) => s + v, 0) - Math.min(...dv);
      const cb = category.bonusType === "multiplier" ? adj * category.bonusValue : adj + category.bonusValue;
      let ft = 0;
      if (ps.has("chain_link")) {
        const { calcChainLinkBonus } = require("../scoring/scoring");
        ft += calcChainLinkBonus(dv, category, matchInfo, 3);
      }
      if (ps.has("pattern_master") && ["full_house", "yahtzee"].includes(category.id)) ft += 10;
      let mt = 1.0;
      if (ps.has("greed")) mt *= 1.2;
      finalScore = Math.max(0, Math.floor((cb + ft) * mt + 1e-9));
    }

    // 封印被动
    if (rules.includes("seal_passive") && pl.passives.length > 0) {
      const costs = { greed: 3, loaded_dice: 4, chain_link: 4, loose_eye: 4, pattern_master: 4, clone_dice: 5 };
      let mc = -1, si = null;
      for (const p of pl.passives) { if ((costs[p] || 3) > mc) { mc = costs[p] || 3; si = p; } }
      const reduced = pl.passives.filter(p => p !== si);
      // Recalculate without sealed passive
      const ps2 = new Set(reduced);
      let flat2 = 0;
      if (ps2.has("chain_link")) {
        const { calcChainLinkBonus } = require("../scoring/scoring");
        flat2 += calcChainLinkBonus(dv, category, matchInfo, 3);
      }
      if (ps2.has("pattern_master") && ["full_house", "yahtzee"].includes(category.id)) flat2 += 10;
      let mult2 = 1.0;
      if (ps2.has("greed")) mult2 *= 1.2;
      finalScore = Math.max(0, Math.floor((base + flat2) * mult2 + 1e-9));
    }

    const target = targets[rd];
    const victory = finalScore >= target;

    results.push({
      round: rd + 1, dice: [...dv], category: category.name,
      score: finalScore, target, victory, passives: [...pl.passives],
    });

    if (!victory) return { win: false, defeatedAt: rd + 1, results };

    pl.tokens += tokens[rd];

    // 商店策略：前2轮优先扩展，之后被动优先
    const avail = PASSIVE_IDS.filter(id => !pl.passives.includes(id));

    // 前2轮优先骰子扩展
    if (rd < 2 && pl.dc < 7 && pl.tokens >= 4) { pl.dc++; pl.tokens -= 4; }

    // 买消耗品
    if (pl.tokens >= 2 && pl.consumables.length < 2) {
      pl.consumables.push({ ...CONSUMABLE });
      pl.tokens -= 2;
    }

    // 买被动（优先贪欲→铅骰→连横→牌型→顺子→分身）
    const prio = ["greed", "loaded_dice", "chain_link", "pattern_master", "loose_eye", "clone_dice"];
    for (const pid of prio) {
      if (avail.includes(pid) && pl.tokens >= PASSIVE_DEFS[pid].cost) {
        pl.passives.push(pid);
        pl.tokens -= PASSIVE_DEFS[pid].cost;
      }
    }

    // 后期骰子扩展
    if (rd >= 2 && pl.dc < 7 && pl.tokens >= 4) { pl.dc++; pl.tokens -= 4; }
  }

  return { win: true, defeatedAt: 0, results };
}

// ============================================================
// 批量运行
// ============================================================
function runBatch(initialDice, curveName, tokenScheme, numConsumables, games) {
  const curve = TARGET_CURVES[curveName];
  const token = TOKEN_SCHEMES[tokenScheme];
  const initCons = Array(numConsumables).fill(null).map(() => ({ ...CONSUMABLE }));

  let wins = 0;
  const rW = new Array(8).fill(0), rA = new Array(8).fill(0);
  const rScores = Array.from({ length: 8 }, () => []);

  for (let seed = 1; seed <= games; seed++) {
    const r = simulate(seed, initialDice, curve.targets, token.tokens, initCons.map(c => ({ ...c })));
    if (r.win) wins++;
    for (const rr of r.results) {
      const idx = rr.round - 1;
      rA[idx]++;
      rScores[idx].push(rr.score);
      if (rr.victory) rW[idx]++;
    }
  }

  const roundStats = rW.map((w, i) => ({
    passRate: rA[i] > 0 ? (w / rA[i] * 100) : 0,
    avg: rScores[i].length > 0 ? (rScores[i].reduce((s, v) => s + v, 0) / rScores[i].length) : 0,
    p75: rScores[i].length > 0 ? [...rScores[i]].sort((a, b) => a - b)[Math.floor(rScores[i].length * 0.75)] : 0,
    target: curve.targets[i],
    gap: rScores[i].length > 0
      ? (([...rScores[i]].sort((a, b) => a - b)[Math.floor(rScores[i].length * 0.75)]) - curve.targets[i])
      : -999,
  }));

  return { wins, games, winRate: (wins / games * 100), roundStats };
}

// ============================================================
// 输出
// ============================================================
function printResult(config, result) {
  const { wins, games, winRate, roundStats } = result;
  const icon = winRate >= 5 && winRate <= 25 ? "★" : winRate > 0 ? "○" : "✗";
  console.log(`\n${icon} ${config} — ${wins}/${games} (${winRate.toFixed(1)}%)`);

  let line = "   轮次: ";
  for (let i = 0; i < 8; i++) {
    const s = roundStats[i];
    if (s.passRate === 0 && i > 0) { line += `R${i+1}=--  `; continue; }
    line += `R${i+1}=${s.passRate.toFixed(0)}%  `;
  }
  console.log(line);

  line = "   P75:  ";
  for (let i = 0; i < 8; i++) {
    const s = roundStats[i];
    line += `R${i+1}=${s.p75}(tgt${s.target})  `;
  }
  console.log(line);

  line = "   差距: ";
  for (let i = 0; i < 8; i++) {
    const s = roundStats[i];
    const gapStr = s.gap >= 0 ? `+${s.gap}` : `${s.gap}`;
    line += `R${i+1}=${gapStr}  `;
  }
  console.log(line);
}

// ============================================================
// 系统扫描矩阵
// ============================================================
const GAMES = 3000;
console.log("=".repeat(90));
console.log("千王骰局 — 平衡性修复扫描（聚焦 R3+ 瓶颈）");
console.log(`每方案 ${GAMES} 局 | 目标：通关率 5-25%，各轮通过率 >50%`);
console.log("=".repeat(90));

const tested = [];
let bestConfig = null;
let bestScore = -1;

for (const [diceKey, dice] of [["3骰", 3], ["4骰", 4]]) {
  for (const [curveKey, curve] of Object.entries(TARGET_CURVES)) {
    for (const [tokenKey, token] of Object.entries(TOKEN_SCHEMES)) {
      for (const numCons of [1, 2]) {
        const config = `${diceKey} | ${curve.label} | ${token.label} | ${numCons}消耗品`;
        const result = runBatch(dice, curveKey, tokenKey, numCons, GAMES);
        tested.push({ config, ...result });
        printResult(config, result);

        // 评分：5-25%胜率最高分，距15%越近越好
        if (result.winRate > 0) {
          const distFromIdeal = Math.abs(result.winRate - 15);
          const score = 100 - distFromIdeal;
          if (score > bestScore) { bestScore = score; bestConfig = { config, result }; }
        }
      }
    }
  }
}

// ============================================================
// 推荐方案
// ============================================================
console.log("\n" + "=".repeat(90));
console.log("推荐方案（最接近 5-25% 胜率目标）：");
console.log("=".repeat(90));

// 按胜率排序，显示前5个非零方案
const viable = tested.filter(t => t.winRate > 0).sort((a, b) => Math.abs(a.winRate - 15) - Math.abs(b.winRate - 15));
for (const v of viable.slice(0, 5)) {
  const icon = v.winRate >= 5 && v.winRate <= 25 ? "★" : "○";
  console.log(`\n${icon} ${v.config} — ${v.winRate.toFixed(1)}%`);
  let line = "   各轮: ";
  for (let i = 0; i < 8; i++) {
    const s = v.roundStats[i];
    line += `R${i+1}=${s.passRate.toFixed(0)}%(p75=${s.p75}/t${s.target})  `;
  }
  console.log(line);
}

if (viable.length === 0) {
  console.log("\n⚠ 所有方案胜率=0%，需要更激进的调优或机制修改");
  console.log("\n最佳单轮表现：");
  for (const t of tested.sort((a, b) => {
    const aR3 = a.roundStats[2]?.passRate || 0;
    const bR3 = b.roundStats[2]?.passRate || 0;
    return bR3 - aR3;
  }).slice(0, 3)) {
    console.log(`  ${t.config} — R3通过率=${t.roundStats[2]?.passRate.toFixed(1)}%`);
  }
}
