/**
 * 平衡性调优 — 甜蜜点搜索：贪×2.0 + P75校准目标曲线
 *
 * 方案B基线：贪×2.0 + [8,12,18,28,38,50,65,82] = 79.8% → 太容易
 * 方案C1：贪×2.0 + [10,16,28,42,58,78,100,130] = 0.8% → 太难
 *
 * P75数据显示贪×2.0在各轮的实际分数：
 *   R1=23, R2=26, R3=33, R4=68, R5=72, R6=74, R7=100, R8=118
 *
 * 甜蜜点目标 = P75 × 0.85~0.95（让75%的玩家能过，但不轻松）
 */

const { PASSIVE_IDS, createRng, DicePool } = require("./cheating");
const { findBestCategory, calcChainLinkBonus } = require("../scoring/scoring");

const CONSUMABLE = { id: "face_change", effectType: "set_dice_value", cost: 2 };
const SHOP_PRIO = ["greed", "loaded_dice", "chain_link", "pattern_master", "loose_eye", "clone_dice"];
const PASSIVE_COSTS = { greed: 3, loaded_dice: 4, chain_link: 4, pattern_master: 4, loose_eye: 4, clone_dice: 5 };

function getRules(r) {
  return [[], [], ["block_pair"], ["zero_lowest"], ["swap_dice"], ["seal_passive"], ["suppress_all"], []][r] || [];
}

function calcScore(dv, passives, greedMult, chainPer, pmBonus, pmCats, opts = {}) {
  const { category, matchInfo } = findBestCategory(dv, {
    blockedCategories: opts.blocked || [],
    looseConsecutive: passives.includes("loose_eye")
  });
  let sum = dv.reduce((s, v) => s + v, 0);
  let base = category.bonusType === "multiplier" ? sum * category.bonusValue : sum + category.bonusValue;
  const ps = new Set(passives);
  let flat = 0;
  if (ps.has("chain_link")) flat += calcChainLinkBonus(dv, category, matchInfo, chainPer);
  if (ps.has("pattern_master") && pmCats.includes(category.id)) flat += pmBonus;
  let mult = 1.0;
  if (ps.has("greed")) mult *= greedMult;
  return { score: Math.max(0, Math.floor((base + flat) * mult + 1e-9)), category, matchInfo };
}

function simulate(initialDice, targets, tokens, greedMult, chainPer, pmBonus, pmCats, games) {
  let wins = 0;
  const rW = new Array(8).fill(0), rA = new Array(8).fill(0);
  const rS = Array.from({ length: 8 }, () => []);

  for (let seed = 1; seed <= games; seed++) {
    const rng = createRng(seed);
    const pl = {
      dp: new DicePool(initialDice, rng), passives: [],
      consumables: [{ ...CONSUMABLE }], tokens: 0, dc: initialDice,
    };
    let dead = false;

    for (let rd = 0; rd < 8; rd++) {
      const rules = getRules(rd);
      pl.dp.baseSize = pl.dc;
      pl.dp.dice = new Array(pl.dc).fill(1);
      pl.dp.clearTemp();
      let dv = pl.dp.rollAll();

      if (pl.passives.includes("clone_dice")) { pl.dp.cloneRandom(); dv = pl.dp.getAllValues(); }
      if (rules.includes("swap_dice")) { pl.dp.rerollRandom(1); dv = pl.dp.getAllValues(); }
      if (rules.includes("suppress_all")) { pl.dp.decreaseAll(1, 1); dv = pl.dp.getAllValues(); }

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
          else { let mi = 0; for (let i = 1; i < vals.length; i++) if (vals[i] < vals[mi]) mi = i; if (vals[mi] < 6) pl.dp.setDie(mi, 6); }
        }
        dv = pl.dp.getAllValues();
      }
      if (pl.passives.includes("loaded_dice")) { pl.dp.setFloor(2); dv = pl.dp.getAllValues(); }

      const blocked = rules.includes("block_pair") ? ["pair"] : [];
      let r = calcScore(dv, pl.passives, greedMult, chainPer, pmBonus, pmCats, { blocked });

      if (rules.includes("zero_lowest")) {
        const adj = dv.reduce((s, v) => s + v, 0) - Math.min(...dv);
        const cat = r.category;
        const cb = cat.bonusType === "multiplier" ? adj * cat.bonusValue : adj + cat.bonusValue;
        const ps = new Set(pl.passives);
        let ft = 0;
        if (ps.has("chain_link")) ft += calcChainLinkBonus(dv, cat, r.matchInfo, chainPer);
        if (ps.has("pattern_master") && pmCats.includes(cat.id)) ft += pmBonus;
        let mt = 1.0; if (ps.has("greed")) mt *= greedMult;
        r = { score: Math.max(0, Math.floor((cb + ft) * mt + 1e-9)), category: cat, matchInfo: r.matchInfo };
      }
      if (rules.includes("seal_passive") && pl.passives.length > 0) {
        let mc = -1, si = null;
        for (const p of pl.passives) { if ((PASSIVE_COSTS[p] || 3) > mc) { mc = PASSIVE_COSTS[p] || 3; si = p; } }
        r = calcScore(dv, pl.passives.filter(p => p !== si), greedMult, chainPer, pmBonus, pmCats, { blocked });
      }

      rA[rd]++; rS[rd].push(r.score);
      if (r.score >= targets[rd]) {
        rW[rd]++; pl.tokens += tokens[rd];
        const avail = PASSIVE_IDS.filter(id => !pl.passives.includes(id));
        if (rd < 2 && pl.dc < 7 && pl.tokens >= 4) { pl.dc++; pl.tokens -= 4; }
        if (pl.tokens >= 2 && pl.consumables.length < 2) { pl.consumables.push({ ...CONSUMABLE }); pl.tokens -= 2; }
        for (const pid of SHOP_PRIO) {
          if (avail.includes(pid) && pl.tokens >= PASSIVE_COSTS[pid]) { pl.passives.push(pid); pl.tokens -= PASSIVE_COSTS[pid]; }
        }
        if (rd >= 2 && pl.dc < 7 && pl.tokens >= 4) { pl.dc++; pl.tokens -= 4; }
      } else { dead = true; break; }
    }
    if (!dead) wins++;
  }

  return {
    wins, games, winRate: (wins / games * 100),
    rounds: rW.map((w, i) => ({
      pr: rA[i] > 0 ? (w / rA[i] * 100) : 0,
      p75: rS[i].length > 0 ? [...rS[i]].sort((a, b) => a - b)[Math.floor(rS[i].length * 0.75)] : 0,
      avg: rS[i].length > 0 ? (rS[i].reduce((s, v) => s + v, 0) / rS[i].length) : 0,
    })),
  };
}

function pr(name, r, targets) {
  const icon = r.winRate >= 5 && r.winRate <= 25 ? "★" : r.winRate > 0 ? "○" : "✗";
  console.log(`\n${icon} ${name}: ${r.wins}/${r.games} (${r.winRate.toFixed(1)}%)`);
  let line = "   通过率: ";
  for (let i = 0; i < 8; i++) line += `R${i+1}=${r.rounds[i].pr.toFixed(0)}%  `;
  console.log(line);
  line = "   P75/tgt: ";
  for (let i = 0; i < 8; i++) line += `${r.rounds[i].p75}/${targets[i]}  `;
  console.log(line);
}

const G = 5000;
const BK = [5, 5, 6, 6, 7, 7, 8, 9];
const PMC = ["full_house", "yahtzee", "three_of_a_kind"];

console.log("=".repeat(90));
console.log(`甜蜜点搜索 — 贪×2.0 + P75校准目标 (${G}局/方案)`);
console.log("基于 B基线 P75: R1=23, R2=26, R3=33, R4=68, R5=72, R6=74, R7=100, R8=118");
console.log("=".repeat(90));

// ===== 贪×2.0 + 牌型+20(含三条) + 连横+5 =====
console.log("\n===== 贪×2.0 + 牌型+20(含三条) + 连横+5 + 4骰 =====\n");

const P = { g: 2.0, c: 5, pm: 20 };

// P75 data: [23, 26, 33, 68, 72, 74, 100, 118]
// P75×0.85: [20, 22, 28, 58, 61, 63, 85, 100]
// P75×0.90: [21, 23, 30, 61, 65, 67, 90, 106]

// D1: P75×0.90
pr("D1 [8,12,20,42,60,68,88,106]", simulate(4, [8,12,20,42,60,68,88,106], BK, P.g, P.c, P.pm, PMC, G), [8,12,20,42,60,68,88,106]);

// D2: P75×0.85 (更激进)
pr("D2 [8,14,22,48,62,70,92,108]", simulate(4, [8,14,22,48,62,70,92,108], BK, P.g, P.c, P.pm, PMC, G), [8,14,22,48,62,70,92,108]);

// D3: 保守起步 + 激进后期
pr("D3 [8,12,20,38,58,68,92,115]", simulate(4, [8,12,20,38,58,68,92,115], BK, P.g, P.c, P.pm, PMC, G), [8,12,20,38,58,68,92,115]);

// D4: 均匀提升
pr("D4 [8,14,22,45,60,70,90,110]", simulate(4, [8,14,22,45,60,70,90,110], BK, P.g, P.c, P.pm, PMC, G), [8,14,22,45,60,70,90,110]);

// D5: 最接近方案A的提升版
pr("D5 [8,12,20,35,52,65,85,105]", simulate(4, [8,12,20,35,52,65,85,105], BK, P.g, P.c, P.pm, PMC, G), [8,12,20,35,52,65,85,105]);

// ===== 也试贪×2.0 + 牌型+15（看差异） =====
console.log("\n===== 贪×2.0 + 牌型+15(含三条) — 牌型降级对比 =====\n");

pr("D3+牌型15", simulate(4, [8,12,20,38,58,68,92,115], BK, 2.0, 5, 15, PMC, G), [8,12,20,38,58,68,92,115]);
pr("D5+牌型15", simulate(4, [8,12,20,35,52,65,85,105], BK, 2.0, 5, 15, PMC, G), [8,12,20,35,52,65,85,105]);

// ===== 基线对比 =====
console.log("\n===== 基线对比 =====\n");

pr("A基线 贪×1.5+降[8,12,18,28,38,50,65,82]", simulate(4, [8,12,18,28,38,50,65,82], BK, 1.5, 5, 15, PMC, G), [8,12,18,28,38,50,65,82]);
pr("B基线 贪×2.0+降[8,12,18,28,38,50,65,82]", simulate(4, [8,12,18,28,38,50,65,82], BK, 2.0, 5, 15, PMC, G), [8,12,18,28,38,50,65,82]);

console.log("\n" + "=".repeat(90));
console.log("★ = 5-25% 胜率 | 寻找 R8>100 且胜率在理想范围的方案");
console.log("=".repeat(90));
