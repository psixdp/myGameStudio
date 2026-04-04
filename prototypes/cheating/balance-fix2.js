/**
 * 平衡性调优 — 双管齐下方案验证
 *
 * 问题：被动叠加不够强 + 目标曲线太陡 → 0%胜率
 * 方案：增强关键被动 + 大幅降低目标 + 初始4骰
 *
 * 被动增强：
 *   - 贪欲：×1.2 → ×1.5
 *   - 连横术：+3/颗 → +5/颗
 *   - 牌型大师：+10 → +15（且扩展到含三条）
 *
 * 同时测试"仅降目标不增强被动"方案作为对比
 */

const { PASSIVE_IDS, createRng, DicePool } = require("./cheating");

const CONSUMABLE = { id: "face_change", effectType: "set_dice_value", cost: 2 };

// 被动增强定义
const BOOSTED = {
  greed: { mult: 1.5 },           // ×1.2 → ×1.5
  chain_link: { per: 5 },          // +3 → +5 per extra
  pattern_master: { bonus: 15, cats: ["full_house", "yahtzee", "three_of_a_kind"] },  // +10 → +15, add three_of_a_kind
};

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

// 商店被动优先级
const SHOP_PRIO = ["greed", "loaded_dice", "chain_link", "pattern_master", "loose_eye", "clone_dice"];
const PASSIVE_COSTS = { greed: 3, loaded_dice: 4, chain_link: 4, pattern_master: 4, loose_eye: 4, clone_dice: 5 };

function simulate(initialDice, targets, tokens, greedMult, chainPer, pmBonus, pmCats, games) {
  let wins = 0;
  const rW = new Array(8).fill(0), rA = new Array(8).fill(0);
  const rS = Array.from({ length: 8 }, () => []);

  for (let seed = 1; seed <= games; seed++) {
    const rng = createRng(seed);
    const pl = {
      dp: new DicePool(initialDice, rng),
      passives: [],
      consumables: [{ ...CONSUMABLE }],
      tokens: 0,
      dc: initialDice,
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

      if (pl.passives.includes("loaded_dice")) { pl.dp.setFloor(2); dv = pl.dp.getAllValues(); }

      const blocked = rules.includes("block_pair") ? ["pair"] : [];
      let r = calcScore(dv, pl.passives, greedMult, chainPer, pmBonus, pmCats, { blocked });

      // 最低点归零
      if (rules.includes("zero_lowest")) {
        const adj = dv.reduce((s, v) => s + v, 0) - Math.min(...dv);
        const cat = r.category;
        const cb = cat.bonusType === "multiplier" ? adj * cat.bonusValue : adj + cat.bonusValue;
        let ft = 0;
        const ps = new Set(pl.passives);
        if (ps.has("chain_link")) {
          const { calcChainLinkBonus } = require("../scoring/scoring");
          ft += calcChainLinkBonus(dv, cat, r.matchInfo, chainPer);
        }
        if (ps.has("pattern_master") && pmCats.includes(cat.id)) ft += pmBonus;
        let mt = 1.0;
        if (ps.has("greed")) mt *= greedMult;
        r = { score: Math.max(0, Math.floor((cb + ft) * mt + 1e-9)), category: cat, matchInfo: r.matchInfo };
      }

      // 封印被动
      if (rules.includes("seal_passive") && pl.passives.length > 0) {
        let mc = -1, si = null;
        for (const p of pl.passives) { if ((PASSIVE_COSTS[p] || 3) > mc) { mc = PASSIVE_COSTS[p] || 3; si = p; } }
        const reduced = pl.passives.filter(p => p !== si);
        r = calcScore(dv, reduced, greedMult, chainPer, pmBonus, pmCats, { blocked });
      }

      rA[rd]++;
      rS[rd].push(r.score);

      if (r.score >= targets[rd]) {
        rW[rd]++;
        pl.tokens += tokens[rd];

        // 商店
        const avail = PASSIVE_IDS.filter(id => !pl.passives.includes(id));
        if (rd < 2 && pl.dc < 7 && pl.tokens >= 4) { pl.dc++; pl.tokens -= 4; }
        if (pl.tokens >= 2 && pl.consumables.length < 2) {
          pl.consumables.push({ ...CONSUMABLE });
          pl.tokens -= 2;
        }
        for (const pid of SHOP_PRIO) {
          if (avail.includes(pid) && pl.tokens >= PASSIVE_COSTS[pid]) {
            pl.passives.push(pid);
            pl.tokens -= PASSIVE_COSTS[pid];
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
      avg: rS[i].length > 0 ? (rS[i].reduce((s, v) => s + v, 0) / rS[i].length) : 0,
      p75: rS[i].length > 0 ? [...rS[i]].sort((a, b) => a - b)[Math.floor(rS[i].length * 0.75)] : 0,
    })),
  };
}

function pr(name, r, targets) {
  const icon = r.winRate >= 5 && r.winRate <= 25 ? "★" : r.winRate > 0 ? "○" : "✗";
  console.log(`\n${icon} ${name}: ${r.wins}/${r.games} (${r.winRate.toFixed(1)}%)`);
  let line = "   通过率: ";
  for (let i = 0; i < 8; i++) line += `R${i+1}=${r.rounds[i].pr.toFixed(0)}%  `;
  console.log(line);
  line = "   P75:    ";
  for (let i = 0; i < 8; i++) line += `R${i+1}=${r.rounds[i].p75}(tgt${targets[i]})  `;
  console.log(line);
  line = "   差距:   ";
  for (let i = 0; i < 8; i++) {
    const gap = r.rounds[i].p75 - targets[i];
    line += `R${i+1}=${gap >= 0 ? '+' : ''}${gap}  `;
  }
  console.log(line);
}

const G = 3000;
const OK = [4, 4, 5, 5, 6, 6, 7, 8];
const BK = [5, 5, 6, 6, 7, 7, 8, 9]; // 加量代币

console.log("=".repeat(90));
console.log("双管齐下方案验证 — 3000局/方案");
console.log("增强被动(贪×1.5 + 连横+5 + 牌型+15含三条) × 不同目标曲线");
console.log("=".repeat(90));

// 增强后的被动参数
const G1 = 1.5;   // 贪欲倍率
const C1 = 5;      // 连横每颗加成
const PM = 15;      // 牌型大师加成
const PMC = ["full_house", "yahtzee", "three_of_a_kind"];

// 原版被动参数
const G0 = 1.2;
const C0 = 3;
const PM0 = 10;
const PMC0 = ["full_house", "yahtzee"];

console.log("\n===== A组：增强被动 × 各种目标曲线（初始4骰 + 加量代币）=====\n");

// A1: 增强被动 + 保守渐进目标
const T1 = [8, 12, 20, 32, 50, 75, 108, 155];
pr("A1 增强被动+保守渐进", simulate(4, T1, BK, G1, C1, PM, PMC, G), T1);

// A2: 增强被动 + 极度扁平
const T2 = [8, 12, 18, 28, 45, 65, 95, 135];
pr("A2 增强被动+极度扁平", simulate(4, T2, BK, G1, C1, PM, PMC, G), T2);

// A3: 增强被动 + 大幅扁平
const T3 = [8, 14, 22, 35, 55, 80, 115, 160];
pr("A3 增强被动+大幅扁平", simulate(4, T3, BK, G1, C1, PM, PMC, G), T3);

// A4: 增强被动 + 渐进式
const T4 = [8, 14, 24, 38, 58, 85, 120, 175];
pr("A4 增强被动+渐进式", simulate(4, T4, BK, G1, C1, PM, PMC, G), T4);

// A5: 增强被动 + 新曲线（基于P75数据设计）
const T5 = [8, 12, 20, 32, 48, 68, 92, 120];
pr("A5 增强被动+P75校准", simulate(4, T5, BK, G1, C1, PM, PMC, G), T5);

// A6: 增强被动 + 激进低目标
const T6 = [8, 12, 18, 28, 40, 55, 75, 100];
pr("A6 增强被动+激进低目标", simulate(4, T6, BK, G1, C1, PM, PMC, G), T6);

console.log("\n===== B组：对比 — 仅增强被动 + 原版目标（不改曲线）=====\n");

const T0 = [12, 20, 40, 65, 95, 130, 175, 250];
pr("B1 增强被动+原版目标", simulate(4, T0, BK, G1, C1, PM, PMC, G), T0);
pr("B2 原版被动+原版目标", simulate(4, T0, BK, G0, C0, PM0, PMC0, G), T0);

console.log("\n===== C组：增强被动 × 初始3骰（测试是否可行）=====\n");

pr("C1 3骰+增强被动+P75校准", simulate(3, T5, BK, G1, C1, PM, PMC, G), T5);
pr("C2 3骰+增强被动+激进低目标", simulate(3, T6, BK, G1, C1, PM, PMC, G), T6);
pr("C3 3骰+原版被动+P75校准", simulate(3, T5, BK, G0, C0, PM0, PMC0, G), T5);

console.log("\n" + "=".repeat(90));
console.log("推荐：★ 标记的方案（5-25% 胜率），每轮通过率 >40%");
console.log("=".repeat(90));
