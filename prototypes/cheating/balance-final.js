/**
 * 平衡性调优 — 最终方案验证
 *
 * 方案：贪欲×1.5 + 连横术+5/颗 + 降低目标曲线
 * 理由：单项强化中贪欲×1.5效果最显著（不破坏乘法公式），
 *       连横+5对三条/对子有实际提升，中期目标适度降低
 */

const { PASSIVE_IDS, createRng, DicePool } = require("./cheating");
const { findBestCategory, calcChainLinkBonus } = require("../scoring/scoring");

const CONSUMABLE = { id: "face_change", effectType: "set_dice_value", cost: 2 };

function getRules(r) {
  return [[], [], ["block_pair"], ["zero_lowest"], ["swap_dice"], ["seal_passive"], ["suppress_all"], []][r] || [];
}

function calcScore(dv, passives, greedMult, chainPer, pmBonus, pmCats, opts = {}) {
  const loose = passives.includes("loose_eye");
  const blocked = opts.blocked || [];
  const { category, matchInfo } = findBestCategory(dv, { blockedCategories: blocked, looseConsecutive: loose });

  let sum = dv.reduce((s, v) => s + v, 0);
  let base = category.bonusType === "multiplier" ? sum * category.bonusValue : sum + category.bonusValue;

  const ps = new Set(passives);
  let flat = 0;

  if (ps.has("chain_link")) {
    flat += calcChainLinkBonus(dv, category, matchInfo, chainPer);
  }
  if (ps.has("pattern_master")) {
    if (pmCats.includes(category.id)) flat += pmBonus;
  }

  let mult = 1.0;
  if (ps.has("greed")) mult *= greedMult;

  return { score: Math.max(0, Math.floor((base + flat) * mult + 1e-9)), category, matchInfo };
}

function simulate(greedMult, chainPer, targets, tokens, pmBonus, pmCats, games) {
  let wins = 0;
  const rW = new Array(8).fill(0), rA = new Array(8).fill(0), rS = new Array(8).fill(null).map(() => []);

  for (let seed = 1; seed <= games; seed++) {
    const rng = createRng(seed);
    const pl = { dp: new DicePool(3, rng), passives: [], consumables: [{ ...CONSUMABLE }], tokens: 0, dc: 3 };
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
          for (const [v, cnt] of Object.entries(freq)) { if (cnt > bC || (cnt === bC && Number(v) > bV)) { bC = cnt; bV = Number(v); } }
          let t = -1, mV = 7;
          for (let i = 0; i < vals.length; i++) { if (vals[i] !== bV && vals[i] < mV) { mV = vals[i]; t = i; } }
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
        if (pl.passives.includes("chain_link")) ft += calcChainLinkBonus(dv, cat, r.matchInfo, chainPer);
        if (pl.passives.includes("pattern_master") && pmCats.includes(cat.id)) ft += pmBonus;
        let mt = 1.0;
        if (pl.passives.includes("greed")) mt *= greedMult;
        r = { score: Math.max(0, Math.floor((cb + ft) * mt + 1e-9)), category: cat, matchInfo: r.matchInfo };
      }

      if (rules.includes("seal_passive") && pl.passives.length > 0) {
        const costs = { greed: 3, loaded_dice: 4, chain_link: 4, loose_eye: 4, pattern_master: 4, clone_dice: 5 };
        let mc = -1, si = null;
        for (const p of pl.passives) { if ((costs[p] || 3) > mc) { mc = costs[p] || 3; si = p; } }
        const reduced = pl.passives.filter(p => p !== si);
        r = calcScore(dv, reduced, greedMult, chainPer, pmBonus, pmCats, { blocked });
      }

      rA[rd]++;
      rS[rd].push(r.score);

      if (r.score >= targets[rd]) {
        rW[rd]++;
        pl.tokens += tokens[rd];

        // 商店：前2轮优先扩展
        const avail = ["greed", "loaded_dice", "chain_link", "loose_eye", "pattern_master", "clone_dice"].filter(id => !pl.passives.includes(id));
        if (rd < 2 && pl.dc < 7 && pl.tokens >= 4) { pl.dc++; pl.tokens -= 4; }
        if (pl.tokens >= 2 && pl.consumables.length < 2) { pl.consumables.push({ ...CONSUMABLE }); pl.tokens -= 2; }
        const prio = ["greed", "loaded_dice", "chain_link", "pattern_master", "loose_eye", "clone_dice"];
        for (const pid of prio) { if (avail.includes(pid) && pl.tokens >= (pid === "greed" ? 3 : pid === "clone_dice" ? 5 : 4)) { pl.passives.push(pid); pl.tokens -= pid === "greed" ? 3 : pid === "clone_dice" ? 5 : 4; } }
        if (rd >= 2 && pl.dc < 7 && pl.tokens >= 4) { pl.dc++; pl.tokens -= 4; }
      } else { dead = true; break; }
    }
    if (!dead) wins++;
  }

  return {
    wins, games, winRate: (wins / games * 100).toFixed(1),
    rounds: rW.map((w, i) => ({
      pr: rA[i] > 0 ? (w / rA[i] * 100).toFixed(1) : "—",
      avg: rS[i].length > 0 ? (rS[i].reduce((s, v) => s + v, 0) / rS[i].length).toFixed(1) : "—",
      p75: rS[i].length > 0 ? [...rS[i]].sort((a, b) => a - b)[Math.floor(rS[i].length * 0.75)] : "—",
    })),
  };
}

const G = 3000;

function pr(name, r, targets) {
  console.log(`\n  ${name}: ${r.wins}/${r.games} (${r.winRate}%)`);
  let line = "    ";
  for (let i = 0; i < 8; i++) {
    if (r.rounds[i].pr === "—") break;
    line += `R${i + 1}=${r.rounds[i].pr}%(${r.rounds[i].avg})  `;
  }
  console.log(line);
  line = "    P75: ";
  for (let i = 0; i < 8; i++) {
    if (r.rounds[i].p75 === "—") break;
    line += `R${i + 1}=${r.rounds[i].p75}(tgt=${targets[i]})  `;
  }
  console.log(line);
}

console.log("=".repeat(80));
console.log("最终方案对比 — 3000局/方案");
console.log("=".repeat(80));

// 原版（基线）
const OT = [12, 20, 40, 65, 95, 130, 175, 250];
const OK = [4, 4, 5, 5, 6, 6, 7, 8];
pr("原版", simulate(1.2, 3, OT, OK, 10, ["full_house", "yahtzee"], G), OT);

// 方案1: 贪欲×1.5 + 连横+5 + 降R8=200
const T1 = [12, 20, 40, 65, 95, 130, 175, 200];
pr("方案1(贪1.5+连5+R8=200)", simulate(1.5, 5, T1, OK, 10, ["full_house", "yahtzee"], G), T1);

// 方案2: 贪欲×1.5 + 连横+5 + 降R7=150 R8=200
const T2 = [12, 20, 40, 65, 95, 130, 150, 200];
pr("方案2(贪1.5+连5+R7-8降)", simulate(1.5, 5, T2, OK, 10, ["full_house", "yahtzee"], G), T2);

// 方案3: 贪欲×1.5 + 连横+5 + 全降
const T3 = [12, 18, 35, 55, 80, 110, 145, 200];
pr("方案3(贪1.5+连5+全降)", simulate(1.5, 5, T3, OK, 10, ["full_house", "yahtzee"], G), T3);

// 方案4: 贪欲×1.5 + 连横+5 + 牌型+20含三条 + 全降
pr("方案4(+牌型20含三条)", simulate(1.5, 5, T3, OK, 20, ["full_house", "yahtzee", "three_of_a_kind"], G), T3);

// 方案5: 贪欲×1.5 + 连横+8 + 牌型+20含三条 + 全降
pr("方案5(连横+8)", simulate(1.5, 8, T3, OK, 20, ["full_house", "yahtzee", "three_of_a_kind"], G), T3);

// 方案6: 贪欲×1.5 + 连横+5 + 温和目标
const T4 = [12, 18, 35, 55, 80, 115, 155, 200];
pr("方案6(温和目标)", simulate(1.5, 5, T4, OK, 10, ["full_house", "yahtzee"], G), T4);

// 方案7: 贪欲×1.5 + 连横+5 + 牌型+20含三条 + 温和目标
pr("方案7(+牌型+温和)", simulate(1.5, 5, T4, OK, 20, ["full_house", "yahtzee", "three_of_a_kind"], G), T4);

// 方案8: 原版被动 + 温和目标（纯目标调整）
pr("方案8(仅降目标)", simulate(1.2, 3, T4, OK, 10, ["full_house", "yahtzee"], G), T4);

console.log("\n" + "=".repeat(80));
console.log("推荐：选择通关率 5-25%、各轮通过率 > 50% 的方案");
console.log("=".repeat(80));
