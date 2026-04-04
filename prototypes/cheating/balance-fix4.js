/**
 * 平衡性调优 — 方案C精细搜索
 *
 * 贪×2.0 P75够高(R8=130)，但目标曲线需在 82-130 之间找到甜蜜点
 * 目标：胜率 5-25%，R8目标有意义(100+)，前期不卡死
 */

const { PASSIVE_IDS, createRng, DicePool } = require("./cheating");
const { findBestCategory, calcChainLinkBonus } = require("../scoring/scoring");

const CONSUMABLE = { id: "face_change", effectType: "set_dice_value", cost: 2 };
const SHOP_PRIO = ["greed", "loaded_dice", "chain_link", "pattern_master", "loose_eye", "clone_dice"];
const PASSIVE_COSTS = { greed: 3, loaded_dice: 4, chain_link: 4, pattern_master: 4, loose_eye: 4, clone_dice: 5 };

function getRules(r) {
  return [[], [], ["block_pair"], ["zero_lowest"], ["swap_dice"], ["seal_passive"], ["suppress_all"], []][r] || [];
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

      // 消耗品
      let used = 0;
      while (used < 2 && pl.consumables.length > 0) {
        const c = pl.consumables.shift(); used++;
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
        dv = pl.dp.getAllValues();
      }

      if (pl.passives.includes("loaded_dice")) { pl.dp.setFloor(2); dv = pl.dp.getAllValues(); }

      // 计分
      const loose = pl.passives.includes("loose_eye");
      const blocked = rules.includes("block_pair") ? ["pair"] : [];
      const { category, matchInfo } = findBestCategory(dv, { blockedCategories: blocked, looseConsecutive: loose });
      let sum = dv.reduce((s, v) => s + v, 0);
      let base = category.bonusType === "multiplier" ? sum * category.bonusValue : sum + category.bonusValue;
      const ps = new Set(pl.passives);
      let flat = 0;
      if (ps.has("chain_link")) flat += calcChainLinkBonus(dv, category, matchInfo, chainPer);
      if (ps.has("pattern_master") && pmCats.includes(category.id)) flat += pmBonus;
      let mult = 1.0;
      if (ps.has("greed")) mult *= greedMult;

      // 敌人规则对分数的影响
      let finalScore;
      if (rules.includes("zero_lowest")) {
        const adj = sum - Math.min(...dv);
        const cb = category.bonusType === "multiplier" ? adj * category.bonusValue : adj + category.bonusValue;
        let ft = 0;
        if (ps.has("chain_link")) ft += calcChainLinkBonus(dv, category, matchInfo, chainPer);
        if (ps.has("pattern_master") && pmCats.includes(category.id)) ft += pmBonus;
        let mt = 1.0; if (ps.has("greed")) mt *= greedMult;
        finalScore = Math.max(0, Math.floor((cb + ft) * mt + 1e-9));
      } else if (rules.includes("seal_passive") && pl.passives.length > 0) {
        let mc = -1, si = null;
        for (const p of pl.passives) { if ((PASSIVE_COSTS[p] || 3) > mc) { mc = PASSIVE_COSTS[p] || 3; si = p; } }
        const reduced = pl.passives.filter(p => p !== si);
        const ps2 = new Set(reduced);
        let flat2 = 0;
        if (ps2.has("chain_link")) flat2 += calcChainLinkBonus(dv, category, matchInfo, chainPer);
        if (ps2.has("pattern_master") && pmCats.includes(category.id)) flat2 += pmBonus;
        let mult2 = 1.0; if (ps2.has("greed")) mult2 *= greedMult;
        finalScore = Math.max(0, Math.floor((base + flat2) * mult2 + 1e-9));
      } else {
        finalScore = Math.max(0, Math.floor((base + flat) * mult + 1e-9));
      }

      rA[rd]++; rS[rd].push(finalScore);
      if (finalScore >= targets[rd]) {
        rW[rd]++; pl.tokens += tokens[rd];
        const avail = PASSIVE_IDS.filter(id => !pl.passives.includes(id));
        if (rd < 2 && pl.dc < 7 && pl.tokens >= 4) { pl.dc++; pl.tokens -= 4; }
        if (pl.tokens >= 2 && pl.consumables.length < 2) { pl.consumables.push({ ...CONSUMABLE }); pl.tokens -= 2; }
        for (const pid of SHOP_PRIO) {
          if (avail.includes(pid) && pl.tokens >= PASSIVE_COSTS[pid]) {
            pl.passives.push(pid); pl.tokens -= PASSIVE_COSTS[pid];
          }
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
const C_PARAMS = { g: 2.0, c: 5, pm: 20, pmc: ["full_house", "yahtzee", "three_of_a_kind"] };

console.log("=".repeat(90));
console.log(`方案C精细搜索 — 贪×2.0 + 牌型+20 + 连横+5 (${G}局/方案)`);
console.log("搜索空间：R8目标 82-130 之间，寻找 5-25% 胜率");
console.log("=".repeat(90));

// ===== 策略：以方案B的低目标为基底，逐步提高后期目标 =====
console.log("\n===== 逐步提高目标曲线 =====\n");

// 基线：方案B（完全低目标）
pr("基线B [8,12,18,28,38,50,65,82]", simulate(4, [8,12,18,28,38,50,65,82], BK, C_PARAMS.g, C_PARAMS.c, C_PARAMS.pm, C_PARAMS.pmc, G), [8,12,18,28,38,50,65,82]);

// 逐步提高 R7-R8
pr("C10: 仅提R8→100", simulate(4, [8,12,18,28,38,50,65,100], BK, C_PARAMS.g, C_PARAMS.c, C_PARAMS.pm, C_PARAMS.pmc, G), [8,12,18,28,38,50,65,100]);
pr("C11: R7→75 R8→100", simulate(4, [8,12,18,28,38,50,75,100], BK, C_PARAMS.g, C_PARAMS.c, C_PARAMS.pm, C_PARAMS.pmc, G), [8,12,18,28,38,50,75,100]);
pr("C12: R7→80 R8→108", simulate(4, [8,12,18,28,38,50,80,108], BK, C_PARAMS.g, C_PARAMS.c, C_PARAMS.pm, C_PARAMS.pmc, G), [8,12,18,28,38,50,80,108]);
pr("C13: R7→85 R8→115", simulate(4, [8,12,18,28,38,50,85,115], BK, C_PARAMS.g, C_PARAMS.c, C_PARAMS.pm, C_PARAMS.pmc, G), [8,12,18,28,38,50,85,115]);

// 同时提高 R5-R6
console.log("\n===== 同时提高中期 =====\n");

pr("C20: R5→42 R6→55 R7→75 R8→100", simulate(4, [8,12,18,28,42,55,75,100], BK, C_PARAMS.g, C_PARAMS.c, C_PARAMS.pm, C_PARAMS.pmc, G), [8,12,18,28,42,55,75,100]);
pr("C21: R5→42 R6→58 R7→80 R8→108", simulate(4, [8,12,18,28,42,58,80,108], BK, C_PARAMS.g, C_PARAMS.c, C_PARAMS.pm, C_PARAMS.pmc, G), [8,12,18,28,42,58,80,108]);
pr("C22: R5→45 R6→60 R7→85 R8→115", simulate(4, [8,12,18,28,45,60,85,115], BK, C_PARAMS.g, C_PARAMS.c, C_PARAMS.pm, C_PARAMS.pmc, G), [8,12,18,28,45,60,85,115]);

// 全曲线提高（但保持前期友好）
console.log("\n===== 全曲线渐进提高 =====\n");

pr("C30: [8,14,22,35,50,68,88,110]", simulate(4, [8,14,22,35,50,68,88,110], BK, C_PARAMS.g, C_PARAMS.c, C_PARAMS.pm, C_PARAMS.pmc, G), [8,14,22,35,50,68,88,110]);
pr("C31: [8,14,24,38,52,68,88,110]", simulate(4, [8,14,24,38,52,68,88,110], BK, C_PARAMS.g, C_PARAMS.c, C_PARAMS.pm, C_PARAMS.pmc, G), [8,14,24,38,52,68,88,110]);
pr("C32: [8,14,24,38,55,72,92,115]", simulate(4, [8,14,24,38,55,72,92,115], BK, C_PARAMS.g, C_PARAMS.c, C_PARAMS.pm, C_PARAMS.pmc, G), [8,14,24,38,55,72,92,115]);
pr("C33: [8,14,24,38,55,72,95,120]", simulate(4, [8,14,24,38,55,72,95,120], BK, C_PARAMS.g, C_PARAMS.c, C_PARAMS.pm, C_PARAMS.pmc, G), [8,14,24,38,55,72,95,120]);

// ===== 对比：贪×1.5 vs ×2.0 在同一目标下 =====
console.log("\n===== 贪×1.5 vs ×2.0 对比（同一目标曲线）=====\n");

const T_COMP = [8,14,24,38,55,72,92,115];
pr("贪×1.5 + C32目标", simulate(4, T_COMP, BK, 1.5, 5, 15, ["full_house","yahtzee","three_of_a_kind"], G), T_COMP);
pr("贪×2.0 + C32目标", simulate(4, T_COMP, BK, 2.0, 5, 20, ["full_house","yahtzee","three_of_a_kind"], G), T_COMP);

// ===== 方案A复现（对比基线）=====
console.log("\n===== 方案A基线 =====\n");
pr("A: 贪×1.5 + [8,12,18,28,38,50,65,82]", simulate(4, [8,12,18,28,38,50,65,82], BK, 1.5, 5, 15, ["full_house","yahtzee","three_of_a_kind"], G), [8,12,18,28,38,50,65,82]);

console.log("\n" + "=".repeat(90));
console.log("★ = 5-25% 胜率 | 找到R8≥100 且胜率合理的方案即为最终方案");
console.log("=".repeat(90));
