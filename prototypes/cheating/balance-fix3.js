/**
 * 平衡性调优 — 精细调优（在 A6 基础上微调）
 *
 * A6 基线：4骰 + 增强被动(贪×1.5 + 连横+5 + 牌型+15含三条) + 激进低目标
 * 结果：0.7% 胜率，R8 P75=90 vs target=100（差10分）
 *
 * 策略：微调目标曲线和被动强度，找到 5-25% 甜蜜点
 */

const { PASSIVE_IDS, createRng, DicePool } = require("./cheating");
const CONSUMABLE = { id: "face_change", effectType: "set_dice_value", cost: 2 };

function getRules(r) {
  return [[], [], ["block_pair"], ["zero_lowest"], ["swap_dice"], ["seal_passive"], ["suppress_all"], []][r] || [];
}

function calcScore(dv, passives, greedMult, chainPer, pmBonus, pmCats, opts = {}) {
  const { findBestCategory, calcChainLinkBonus } = require("../scoring/scoring");
  const loose = passives.includes("loose_eye");
  const blocked = opts.blocked || [];
  const { category, matchInfo } = findBestCategory(dv, { blockedCategories: blocked, looseConsecutive: loose });
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

const SHOP_PRIO = ["greed", "loaded_dice", "chain_link", "pattern_master", "loose_eye", "clone_dice"];
const PASSIVE_COSTS = { greed: 3, loaded_dice: 4, chain_link: 4, pattern_master: 4, loose_eye: 4, clone_dice: 5 };

function simulate(initialDice, targets, tokens, greedMult, chainPer, pmBonus, pmCats, initCons, games) {
  let wins = 0;
  const rW = new Array(8).fill(0), rA = new Array(8).fill(0);
  const rS = Array.from({ length: 8 }, () => []);

  for (let seed = 1; seed <= games; seed++) {
    const rng = createRng(seed);
    const pl = {
      dp: new DicePool(initialDice, rng), passives: [],
      consumables: Array.from({ length: initCons }, () => ({ ...CONSUMABLE })),
      tokens: 0, dc: initialDice,
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
        let ft = 0;
        if (new Set(pl.passives).has("chain_link")) ft += require("../scoring/scoring").calcChainLinkBonus(dv, cat, r.matchInfo, chainPer);
        if (new Set(pl.passives).has("pattern_master") && pmCats.includes(cat.id)) ft += pmBonus;
        let mt = 1.0; if (new Set(pl.passives).has("greed")) mt *= greedMult;
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
        for (const pid of SHOP_PRIO) { if (avail.includes(pid) && pl.tokens >= PASSIVE_COSTS[pid]) { pl.passives.push(pid); pl.tokens -= PASSIVE_COSTS[pid]; } }
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

const G = 5000; // More games for precision
const BK = [5, 5, 6, 6, 7, 7, 8, 9];

console.log("=".repeat(90));
console.log(`精细调优 — 基于 A6 基线微调（${G}局/方案）`);
console.log("基线: 4骰 | 贪×1.5 + 连横+5 + 牌型+15(含三条) | 加量代币 | 1消耗品");
console.log("=".repeat(90));

// ===== 维度1：微调目标曲线 =====
console.log("\n===== 目标曲线微调 =====\n");

// A6基线复现
pr("基线(A6复现)", simulate(4, [8,12,18,28,40,55,75,100], BK, 1.5, 5, 15,
  ["full_house","yahtzee","three_of_a_kind"], 1, G), [8,12,18,28,40,55,75,100]);

// 降R7-R8
pr("降R7-8", simulate(4, [8,12,18,28,40,55,68,88], BK, 1.5, 5, 15,
  ["full_house","yahtzee","three_of_a_kind"], 1, G), [8,12,18,28,40,55,68,88]);

// 降R6-R8
pr("降R6-8", simulate(4, [8,12,18,28,40,48,65,85], BK, 1.5, 5, 15,
  ["full_house","yahtzee","three_of_a_kind"], 1, G), [8,12,18,28,40,48,65,85]);

// 全温和降
pr("全温和降", simulate(4, [8,12,18,28,38,50,65,82], BK, 1.5, 5, 15,
  ["full_house","yahtzee","three_of_a_kind"], 1, G), [8,12,18,28,38,50,65,82]);

// 全激进降
pr("全激进降", simulate(4, [8,10,16,25,35,45,58,75], BK, 1.5, 5, 15,
  ["full_house","yahtzee","three_of_a_kind"], 1, G), [8,10,16,25,35,45,58,75]);

// ===== 维度2：增强被动强度 =====
console.log("\n===== 被动强度增强 =====\n");

// 贪欲×2.0 + 原A6目标
pr("贪×2.0+A6目标", simulate(4, [8,12,18,28,40,55,75,100], BK, 2.0, 5, 15,
  ["full_house","yahtzee","three_of_a_kind"], 1, G), [8,12,18,28,40,55,75,100]);

// 贪欲×1.5 + 连横+7 + 降R7-8
pr("贪×1.5+连+7+降", simulate(4, [8,12,18,28,40,55,68,88], BK, 1.5, 7, 15,
  ["full_house","yahtzee","three_of_a_kind"], 1, G), [8,12,18,28,40,55,68,88]);

// 贪欲×2.0 + 连横+5 + 降R7-8
pr("贪×2.0+连+5+降", simulate(4, [8,12,18,28,40,55,68,88], BK, 2.0, 5, 15,
  ["full_house","yahtzee","three_of_a_kind"], 1, G), [8,12,18,28,40,55,68,88]);

// ===== 维度3：2初始消耗品 =====
console.log("\n===== 2初始消耗品 =====\n");

pr("2消耗+基线", simulate(4, [8,12,18,28,40,55,75,100], BK, 1.5, 5, 15,
  ["full_house","yahtzee","three_of_a_kind"], 2, G), [8,12,18,28,40,55,75,100]);

pr("2消耗+降R7-8", simulate(4, [8,12,18,28,40,55,68,88], BK, 1.5, 5, 15,
  ["full_house","yahtzee","three_of_a_kind"], 2, G), [8,12,18,28,40,55,68,88]);

// ===== 维度4：组合最优 =====
console.log("\n===== 最优组合 =====\n");

// 贪×2.0 + 2消耗 + 降目标
pr("贪×2.0+2耗+降R7-8", simulate(4, [8,12,18,28,40,55,68,88], BK, 2.0, 5, 15,
  ["full_house","yahtzee","three_of_a_kind"], 2, G), [8,12,18,28,40,55,68,88]);

// 贪×2.0 + 2消耗 + 全降
pr("贪×2.0+2耗+全降", simulate(4, [8,12,18,28,38,50,65,82], BK, 2.0, 5, 15,
  ["full_house","yahtzee","three_of_a_kind"], 2, G), [8,12,18,28,38,50,65,82]);

// 贪×1.5 + 2消耗 + 全温和降
pr("贪×1.5+2耗+全温和降", simulate(4, [8,12,18,28,38,50,65,82], BK, 1.5, 5, 15,
  ["full_house","yahtzee","three_of_a_kind"], 2, G), [8,12,18,28,38,50,65,82]);

// ===== 维度5：验证3骰是否也可行 =====
console.log("\n===== 3骰对比（同样增强被动）=====\n");

pr("3骰+贪×2.0+全降", simulate(3, [8,12,18,28,38,50,65,82], BK, 2.0, 5, 15,
  ["full_house","yahtzee","three_of_a_kind"], 1, G), [8,12,18,28,38,50,65,82]);

pr("3骰+贪×2.0+2耗+全降", simulate(3, [8,12,18,28,38,50,65,82], BK, 2.0, 5, 15,
  ["full_house","yahtzee","three_of_a_kind"], 2, G), [8,12,18,28,38,50,65,82]);

console.log("\n" + "=".repeat(90));
console.log("★ = 5-25% 胜率（理想范围）");
console.log("○ = >0% 但不在理想范围");
console.log("✗ = 0% 胜率");
console.log("=".repeat(90));
