/**
 * 平衡性调优 — 强化被动能力测试
 *
 * 测试不同被动强化方案对胜率的影响
 * 保持"先加后乘"公式不变，只调数值
 */

const {
  PASSIVE_IDS, createRng, DicePool,
} = require("./cheating");

const { findBestCategory, calcChainLinkBonus, CATEGORIES } = require("../scoring/scoring");

// ============================================================
// 被动参数配置
// ============================================================

function makePassives(cfg) {
  return {
    loaded_dice:    { id: "loaded_dice",    cost: 4, minValue: cfg.loadedDiceMin ?? 2 },
    clone_dice:     { id: "clone_dice",     cost: 5, count: cfg.cloneCount ?? 1 },
    chain_link:     { id: "chain_link",     cost: 4, perExcess: cfg.chainPerExcess ?? 3 },
    loose_eye:      { id: "loose_eye",      cost: 4 },
    greed:          { id: "greed",           cost: 3, multiplier: cfg.greedMult ?? 1.2 },
    pattern_master: { id: "pattern_master", cost: 4, categories: cfg.pmCategories ?? ["full_house", "yahtzee"], bonus: cfg.pmBonus ?? 10 },
  };
}

// ============================================================
// 计分（内联，用自定义被动参数）
// ============================================================

function calcScore(diceValues, passiveIds, pDefs, blockedCategories = []) {
  const looseConsecutive = passiveIds.includes("loose_eye");
  const { category, matchInfo } = findBestCategory(diceValues, { blockedCategories, looseConsecutive });

  let sumDice = diceValues.reduce((s, v) => s + v, 0);
  let categoryBase = category.bonusType === "multiplier"
    ? sumDice * category.bonusValue
    : sumDice + category.bonusValue;

  const ps = new Set(passiveIds);

  // 加法加成
  let flatTotal = 0;
  if (ps.has("chain_link")) {
    const excess = calcChainLinkBonus(diceValues, category, matchInfo, pDefs.chain_link.perExcess);
    flatTotal += excess;
  }
  if (ps.has("pattern_master")) {
    const pm = pDefs.pattern_master;
    if (pm.categories.includes(category.id)) flatTotal += pm.bonus;
  }

  // 乘法倍率
  let multiplierTotal = 1.0;
  if (ps.has("greed")) multiplierTotal *= pDefs.greed.multiplier;

  const raw = (categoryBase + flatTotal) * multiplierTotal;
  return { finalScore: Math.max(0, Math.floor(raw + 1e-9)), category };
}

// ============================================================
// 模拟引擎
// ============================================================

function getEnemyRules(round) {
  return [[], [], ["block_pair"], ["zero_lowest"], ["swap_dice"], ["seal_passive"], ["suppress_all"], []][round] || [];
}

function simulate(pCfg, targets, tokens, initDice, games = 2000) {
  const pDefs = makePassives(pCfg);
  let wins = 0;
  const rW = new Array(8).fill(0), rA = new Array(8).fill(0);
  const rScores = new Array(8).fill(null).map(() => []);

  for (let seed = 1; seed <= games; seed++) {
    const rng = createRng(seed);
    const pl = {
      dp: new DicePool(initDice, rng),
      passives: [],
      consumables: [{ effectType: "set_dice_value" }],
      tokens: 0,
      diceCount: initDice,
    };

    let dead = false;
    for (let rd = 0; rd < 8; rd++) {
      const rules = getEnemyRules(rd);

      pl.dp.baseSize = pl.diceCount;
      pl.dp.dice = new Array(pl.diceCount).fill(1);
      pl.dp.clearTemp();
      let dv = pl.dp.rollAll();

      // 分身术
      if (pl.passives.includes("clone_dice")) {
        for (let c = 0; c < pDefs.clone_dice.count; c++) pl.dp.cloneRandom();
        dv = pl.dp.getAllValues();
      }

      if (rules.includes("swap_dice")) { pl.dp.rerollRandom(1); dv = pl.dp.getAllValues(); }
      if (rules.includes("suppress_all")) { pl.dp.decreaseAll(1, 1); dv = pl.dp.getAllValues(); }

      // 消耗品：智能换面
      let used = 0;
      while (used < 2 && pl.consumables.length > 0) {
        const c = pl.consumables.shift(); used++;
        if (c.effectType === "set_dice_value") {
          const vals = pl.dp.dice;
          const freq = {};
          for (const v of vals) freq[v] = (freq[v] || 0) + 1;
          let bestV = 6, bestC = 0;
          for (const [v, cnt] of Object.entries(freq)) {
            if (cnt > bestC || (cnt === bestC && Number(v) > bestV)) { bestC = cnt; bestV = Number(v); }
          }
          let tgt = -1, minV = 7;
          for (let i = 0; i < vals.length; i++) { if (vals[i] !== bestV && vals[i] < minV) { minV = vals[i]; tgt = i; } }
          if (tgt >= 0) pl.dp.setDie(tgt, bestV);
          else { let mi = 0; for (let i = 1; i < vals.length; i++) if (vals[i] < vals[mi]) mi = i; if (vals[mi] < 6) pl.dp.setDie(mi, 6); }
        }
        dv = pl.dp.getAllValues();
      }

      // 铅骰
      if (pl.passives.includes("loaded_dice")) { pl.dp.setFloor(pDefs.loaded_dice.minValue); dv = pl.dp.getAllValues(); }

      const blocked = rules.includes("block_pair") ? ["pair"] : [];
      let { finalScore } = calcScore(dv, pl.passives, pDefs, blocked);

      // 最低点归零
      if (rules.includes("zero_lowest")) {
        const adj = dv.reduce((s, v) => s + v, 0) - Math.min(...dv);
        const { category } = findBestCategory(dv, { blockedCategories: blocked, looseConsecutive: pl.passives.includes("loose_eye") });
        const cb = category.bonusType === "multiplier" ? adj * category.bonusValue : adj + category.bonusValue;
        let ft = 0;
        const ps = new Set(pl.passives);
        if (ps.has("chain_link")) ft += calcChainLinkBonus(dv, category, {}, pDefs.chain_link.perExcess);
        if (ps.has("pattern_master") && pDefs.pattern_master.categories.includes(category.id)) ft += pDefs.pattern_master.bonus;
        let mt = 1.0;
        if (ps.has("greed")) mt *= pDefs.greed.multiplier;
        finalScore = Math.max(0, Math.floor((cb + ft) * mt + 1e-9));
      }

      // 封印被动
      if (rules.includes("seal_passive") && pl.passives.length > 0) {
        let mc = -1, si = null;
        for (const pid of pl.passives) { if (pDefs[pid].cost > mc) { mc = pDefs[pid].cost; si = pid; } }
        finalScore = calcScore(dv, pl.passives.filter(p => p !== si), pDefs, blocked).finalScore;
      }

      rA[rd]++;
      rScores[rd].push(finalScore);

      if (finalScore >= targets[rd]) {
        rW[rd]++;
        pl.tokens += tokens[rd];

        // 商店
        const avail = Object.keys(pDefs).filter(id => !pl.passives.includes(id));
        if (rd < 2 && pl.diceCount < 7 && pl.tokens >= 4) { pl.diceCount++; pl.tokens -= 4; }
        if (pl.tokens >= 2 && pl.consumables.length < 2) { pl.consumables.push({ effectType: "set_dice_value" }); pl.tokens -= 2; }
        const prio = ["greed", "loaded_dice", "chain_link", "pattern_master", "loose_eye", "clone_dice"];
        for (const pid of prio) { if (avail.includes(pid) && pl.tokens >= pDefs[pid].cost) { pl.passives.push(pid); pl.tokens -= pDefs[pid].cost; } }
        if (rd >= 2 && pl.diceCount < 7 && pl.tokens >= 4) { pl.diceCount++; pl.tokens -= 4; }
      } else {
        dead = true;
        break;
      }
    }
    if (!dead) wins++;
  }

  return {
    wins, games, winRate: (wins / games * 100).toFixed(1),
    rounds: rW.map((w, i) => ({
      pr: rA[i] > 0 ? (w / rA[i] * 100).toFixed(1) : "—",
      avg: rScores[i].length > 0 ? (rScores[i].reduce((s, v) => s + v, 0) / rScores[i].length).toFixed(1) : "—",
    })),
  };
}

function pr(name, pCfg, targets, tokens) {
  const r = simulate(pCfg, targets, tokens, 3, 2000);
  console.log(`\n  ${name}: ${r.wins}/${r.games} (${r.winRate}%)`);
  const tag = `${pCfg.greedMult ?? 1.2}x ${pCfg.chainPerExcess ?? 3}/e +${pCfg.pmBonus ?? 10} min${pCfg.loadedDiceMin ?? 2} cl${pCfg.cloneCount ?? 1}`;
  console.log(`    [${tag}]`);
  process.stdout.write("    ");
  for (let i = 0; i < 8; i++) {
    if (r.rounds[i].pr === "—") break;
    process.stdout.write(`R${i + 1}=${r.rounds[i].pr}%(${r.rounds[i].avg})  `);
  }
  console.log();
}

// ============================================================
// 测试
// ============================================================

const ORIG_T = [12, 20, 40, 65, 95, 130, 175, 250];
const ORIG_K = [4, 4, 5, 5, 6, 6, 7, 8];
const MILD_T = [10, 15, 28, 45, 65, 90, 125, 180];
const MILD_K = [5, 5, 6, 6, 7, 7, 8, 10];

console.log("=".repeat(80));
console.log("被动能力强化方案测试 — 2000局/方案");
console.log("=".repeat(80));

console.log("\n--- 基线（原版被动 + 原版目标） ---");
pr("基线", {}, ORIG_T, ORIG_K);

console.log("\n--- 单项强化 + 原版目标 ---");
pr("贪欲×1.5", { greedMult: 1.5 }, ORIG_T, ORIG_K);
pr("贪欲×2.0", { greedMult: 2.0 }, ORIG_T, ORIG_K);
pr("连横+5/颗", { chainPerExcess: 5 }, ORIG_T, ORIG_K);
pr("连横+8/颗", { chainPerExcess: 8 }, ORIG_T, ORIG_K);
pr("牌型+20", { pmBonus: 20 }, ORIG_T, ORIG_K);
pr("牌型+20+含三条", { pmBonus: 20, pmCategories: ["full_house", "yahtzee", "three_of_a_kind"] }, ORIG_T, ORIG_K);
pr("铅骰min3", { loadedDiceMin: 3 }, ORIG_T, ORIG_K);
pr("分身×2", { cloneCount: 2 }, ORIG_T, ORIG_K);

console.log("\n--- 单项强化 + 温和目标 ---");
pr("贪欲×1.5+温和", { greedMult: 1.5 }, MILD_T, MILD_K);
pr("连横+5+温和", { chainPerExcess: 5 }, MILD_T, MILD_K);
pr("牌型+20+三条+温和", { pmBonus: 20, pmCategories: ["full_house", "yahtzee", "three_of_a_kind"] }, MILD_T, MILD_K);
pr("分身×2+温和", { cloneCount: 2 }, MILD_T, MILD_K);

console.log("\n--- 组合强化 ---");
pr("贪欲1.5+连横5", { greedMult: 1.5, chainPerExcess: 5 }, ORIG_T, ORIG_K);
pr("贪欲1.5+连横5+温和", { greedMult: 1.5, chainPerExcess: 5 }, MILD_T, MILD_K);
pr("贪欲1.5+牌型20+三条+温和", { greedMult: 1.5, pmBonus: 20, pmCategories: ["full_house", "yahtzee", "three_of_a_kind"] }, MILD_T, MILD_K);
pr("贪欲1.5+分身×2+温和", { greedMult: 1.5, cloneCount: 2 }, MILD_T, MILD_K);

console.log("\n--- 全面组合 ---");
pr("全面A(温和目标)", { greedMult: 1.5, chainPerExcess: 5, pmBonus: 20, pmCategories: ["full_house", "yahtzee", "three_of_a_kind"], loadedDiceMin: 3, cloneCount: 2 }, MILD_T, MILD_K);
pr("全面B(贪欲2+温和)", { greedMult: 2.0, chainPerExcess: 5, pmBonus: 20, pmCategories: ["full_house", "yahtzee", "three_of_a_kind"] }, MILD_T, MILD_K);
pr("全面C(贪欲1.5+连横8+温和)", { greedMult: 1.5, chainPerExcess: 8, pmBonus: 20, pmCategories: ["full_house", "yahtzee", "three_of_a_kind"] }, MILD_T, MILD_K);

console.log("\n" + "=".repeat(80));
console.log("目标：找到通关率 5-30% 的方案");
console.log("=".repeat(80));
