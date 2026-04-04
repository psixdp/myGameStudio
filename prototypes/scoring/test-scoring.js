/**
 * 计分系统原型测试套件
 *
 * 覆盖设计文档 scoring.md 中的16个验收条件（AC-1 ~ AC-16）
 * 加上穷举验证和边界情况测试
 */

const {
  CATEGORIES,
  countFrequency,
  hasConsecutive,
  isAllSame,
  isFullHouse,
  findBestCategory,
  calculateScore,
  calcChainLinkBonus,
  applyZeroLowest,
} = require("./scoring.js");

// ============================================================
// 测试框架
// ============================================================

let totalTests = 0;
let passedTests = 0;
let failedTests = 0;
const failures = [];

function assert(condition, message) {
  totalTests++;
  if (condition) {
    passedTests++;
  } else {
    failedTests++;
    failures.push(message);
    console.log(`  FAIL: ${message}`);
  }
}

function assertEqual(actual, expected, message) {
  totalTests++;
  if (actual === expected) {
    passedTests++;
  } else {
    failedTests++;
    failures.push(`${message} — expected: ${expected}, got: ${actual}`);
    console.log(`  FAIL: ${message} — expected: ${expected}, got: ${actual}`);
  }
}

function assertApprox(actual, expected, message) {
  totalTests++;
  if (Math.abs(actual - expected) < 0.001) {
    passedTests++;
  } else {
    failedTests++;
    failures.push(`${message} — expected: ~${expected}, got: ${actual}`);
    console.log(`  FAIL: ${message} — expected: ~${expected}, got: ${actual}`);
  }
}

function section(title) {
  console.log(`\n=== ${title} ===`);
}

// ============================================================
// 辅助：穷举骰子组合
// ============================================================

/** 生成 n 颗骰子的所有组合（每颗1-6） */
function generateAllCombinations(n) {
  if (n === 0) return [[]];
  const prev = generateAllCombinations(n - 1);
  const result = [];
  for (const combo of prev) {
    for (let face = 1; face <= 6; face++) {
      result.push([...combo, face]);
    }
  }
  return result;
}

/** 手动判定分类（用于穷举验证的参考实现） */
function manualClassify(dice) {
  const n = dice.length;
  const freq = countFrequency(dice);
  const counts = Object.values(freq).sort((a, b) => a - b);
  const values = Object.keys(freq);

  // 豹子：所有骰子相同
  if (values.length === 1 && n >= 3) return "yahtzee";

  // 满堂红：恰好两组值，小组≥2，大组≥3
  if (values.length === 2 && counts[0] >= 2 && counts[1] >= 3) return "full_house";

  // 大顺：5个连续值
  if (n >= 5 && hasConsecutive(dice, 5)) return "large_straight";

  // 小顺：4个连续值
  if (n >= 4 && hasConsecutive(dice, 4)) return "small_straight";

  // 三条：存在≥3个相同
  if (Math.max(...Object.values(freq)) >= 3) return "three_of_a_kind";

  // 对子：存在≥2个相同
  if (Math.max(...Object.values(freq)) >= 2) return "pair";

  return "bust";
}

// ============================================================
// AC-1: 3颗骰子的所有分类匹配正确（穷举 6³=216）
// ============================================================

function testAC1() {
  section("AC-1: 3颗骰子穷举验证 (216种)");
  const combos = generateAllCombinations(3);
  let errors = 0;

  for (const dice of combos) {
    const expected = manualClassify(dice);
    const { category } = findBestCategory(dice);
    assertEqual(
      category.id, expected,
      `3骰子 [${dice}] 匹配: 期望=${expected}, 实际=${category.id}`
    );
    if (category.id !== expected) errors++;
  }

  console.log(`  3骰子穷举: ${combos.length - errors}/${combos.length} 正确`);
}

// ============================================================
// AC-2: 4颗骰子的所有分类匹配正确（穷举 6⁴=1296）
// ============================================================

function testAC2() {
  section("AC-2: 4颗骰子穷举验证 (1296种)");
  const combos = generateAllCombinations(4);
  let errors = 0;

  for (const dice of combos) {
    const expected = manualClassify(dice);
    const { category } = findBestCategory(dice);
    assertEqual(
      category.id, expected,
      `4骰子 [${dice}] 匹配: 期望=${expected}, 实际=${category.id}`
    );
    if (category.id !== expected) errors++;
  }

  console.log(`  4骰子穷举: ${combos.length - errors}/${combos.length} 正确`);
}

// ============================================================
// AC-3: 5颗骰子抽样验证
// ============================================================

function testAC3() {
  section("AC-3: 5颗骰子等价类抽样验证");

  // 按等价类设计测试用例
  const cases = [
    // 豹子
    { dice: [1,1,1,1,1], expect: "yahtzee" },
    { dice: [6,6,6,6,6], expect: "yahtzee" },
    // 满堂红
    { dice: [3,3,3,5,5], expect: "full_house" },
    { dice: [2,2,4,4,4], expect: "full_house" },
    { dice: [6,6,6,1,1], expect: "full_house" },
    // 大顺
    { dice: [1,2,3,4,5], expect: "large_straight" },
    { dice: [2,3,4,5,6], expect: "large_straight" },
    { dice: [1,2,3,4,5,5], expect: "large_straight", n: 6 },
    // 小顺
    { dice: [1,2,3,4,6], expect: "small_straight" },
    { dice: [2,3,4,5,2], expect: "small_straight" },
    { dice: [3,4,5,6,1], expect: "small_straight" },
    // 三条
    { dice: [4,4,4,2,3], expect: "three_of_a_kind" },
    { dice: [1,1,1,2,3], expect: "three_of_a_kind" },
    { dice: [4,4,4,4,2], expect: "three_of_a_kind" },  // 4个相同也是三条（无满堂红因为只有2组值但不满足3+2）
    // 对子（不含顺子）
    { dice: [5,5,1,3,6], expect: "pair" },
    { dice: [1,2,3,4,5], expect: "large_straight" },  // 1-2-3-4-5是大顺!
    { dice: [1,2,3,4,6], expect: "small_straight" },
    { dice: [1,2,6,4,3], expect: "small_straight" },
    // 散牌
    { dice: [1,3,5,2,6], expect: "small_straight" },
    { dice: [1,3,6,2,5], expect: "small_straight" },  // 1-2-3 + 5-6: 包含1-2-3-4? 不，是1,2,3,5,6 → 无4连续
    // 修正：1,3,6,2,5 排序为 1,2,3,5,6 → 有2,3连续但无4连续 → 不，1,2,3连续3个，5,6连续2个 → 无4连续 → 检查三条/对子 → 3,5,6,1,2无重复 → 散牌
  ];

  // 修正后
  const testCases = [
    { dice: [1,1,1,1,1], expect: "yahtzee" },
    { dice: [6,6,6,6,6], expect: "yahtzee" },
    { dice: [3,3,3,5,5], expect: "full_house" },
    { dice: [2,2,4,4,4], expect: "full_house" },
    { dice: [6,6,6,1,1], expect: "full_house" },
    { dice: [1,2,3,4,5], expect: "large_straight" },
    { dice: [2,3,4,5,6], expect: "large_straight" },
    { dice: [1,2,3,4,6], expect: "small_straight" },
    { dice: [2,3,4,5,2], expect: "small_straight" },
    { dice: [3,4,5,6,1], expect: "small_straight" },
    { dice: [4,4,4,2,3], expect: "three_of_a_kind" },
    { dice: [1,1,1,2,3], expect: "three_of_a_kind" },
    { dice: [4,4,4,4,2], expect: "three_of_a_kind" },
    { dice: [5,5,2,3,4], expect: "small_straight" },  // 包含2,3,4,5连续
    { dice: [1,3,5,2,6], expect: "bust" },  // 1,2,3,5,6 无4连续，无重复 → 散牌
    { dice: [1,3,6,2,5], expect: "bust" },  // 同上
    { dice: [2,4,6,1,3], expect: "bust" },  // 1,2,3,4,6 → 有1-2-3-4连续 → 小顺!
    // 修正
    { dice: [2,5,6,1,3], expect: "bust" },  // 1,2,3,5,6 → 无4连续，无重复 → 散牌
  ];

  // 再修正: 2,4,6,1,3 = 1,2,3,4,6 → 1-2-3-4连续4个 → 小顺
  const finalCases = [
    { dice: [1,1,1,1,1], expect: "yahtzee" },
    { dice: [6,6,6,6,6], expect: "yahtzee" },
    { dice: [3,3,3,5,5], expect: "full_house" },
    { dice: [2,2,4,4,4], expect: "full_house" },
    { dice: [6,6,6,1,1], expect: "full_house" },
    { dice: [1,2,3,4,5], expect: "large_straight" },
    { dice: [2,3,4,5,6], expect: "large_straight" },
    { dice: [1,2,3,4,6], expect: "small_straight" },
    { dice: [2,3,4,5,2], expect: "small_straight" },
    { dice: [3,4,5,6,1], expect: "small_straight" },
    { dice: [4,4,4,2,3], expect: "three_of_a_kind" },
    { dice: [1,1,1,2,3], expect: "three_of_a_kind" },
    { dice: [4,4,4,4,2], expect: "three_of_a_kind" },
    { dice: [5,5,2,3,4], expect: "small_straight" },  // 包含2,3,4,5连续
    { dice: [1,3,5,2,6], expect: "bust" },
    { dice: [2,5,6,1,3], expect: "bust" },
  ];

  for (const tc of finalCases) {
    const { category } = findBestCategory(tc.dice);
    assertEqual(
      category.id, tc.expect,
      `5骰子 [${tc.dice}] 匹配: 期望=${tc.expect}, 实际=${category.id}`
    );
  }
}

// ============================================================
// AC-4: 基础分计算与手算一致
// ============================================================

function testAC4() {
  section("AC-4: 基础分计算验证");

  // 示例1: [6,6,3] 无被动 → 对子, flat bonusValue=0
  let r = calculateScore([6, 6, 3]);
  assertEqual(r.breakdown.category.id, "pair", "[6,6,3] 匹配对子");
  assertEqual(r.breakdown.sumDice, 15, "[6,6,3] sumDice=15");
  assertEqual(r.breakdown.categoryBase, 15, "[6,6,3] categoryBase=15");
  assertEqual(r.finalScore, 15, "[6,6,3] 最终分=15");

  // 示例2: [6,6,6] 牌型大师+贪欲 → 豹子 ×3, +10, ×1.2
  r = calculateScore([6, 6, 6], {
    flatBonuses: [{ source: "pattern_master", value: 10 }],
    multipliers: [1.2],
  });
  assertEqual(r.breakdown.category.id, "yahtzee", "[6,6,6] 匹配豹子");
  assertEqual(r.breakdown.sumDice, 18, "[6,6,6] sumDice=18");
  assertEqual(r.breakdown.categoryBase, 54, "[6,6,6] categoryBase=54 (18×3)");
  assertEqual(r.breakdown.flatTotal, 10, "[6,6,6] flatTotal=10");
  assertApprox(r.breakdown.multiplierTotal, 1.2, "[6,6,6] multiplier=1.2");
  assertEqual(r.finalScore, 76, "[6,6,6] 最终分=76 (floor(64×1.2))");

  // 示例3: [5,5,5,5,2] 连横术 → 三条
  const { category: cat3, matchInfo: info3 } = findBestCategory([5,5,5,5,2]);
  const chainBonus = calcChainLinkBonus([5,5,5,5,2], cat3, info3);
  assertEqual(cat3.id, "three_of_a_kind", "[5,5,5,5,2] 匹配三条");
  assertEqual(chainBonus, 3, "连横术超出1颗 ×3 = +3");

  r = calculateScore([5, 5, 5, 5, 2], {
    flatBonuses: [{ source: "chain_link", value: chainBonus }],
  });
  assertEqual(r.breakdown.sumDice, 22, "[5,5,5,5,2] sumDice=22");
  assertEqual(r.breakdown.categoryBase, 27, "[5,5,5,5,2] categoryBase=27 (22+5)");
  assertEqual(r.finalScore, 30, "[5,5,5,5,2] 最终分=30 (27+3)");

  // [4,4,4,2] 三条
  r = calculateScore([4, 4, 4, 2]);
  assertEqual(r.breakdown.category.id, "three_of_a_kind", "[4,4,4,2] 匹配三条");
  assertEqual(r.breakdown.sumDice, 14, "[4,4,4,2] sumDice=14");
  assertEqual(r.breakdown.categoryBase, 19, "[4,4,4,2] categoryBase=19 (14+5)");
  assertEqual(r.finalScore, 19, "[4,4,4,2] 最终分=19");
}

// ============================================================
// AC-5: 加法加成正确叠加
// ============================================================

function testAC5() {
  section("AC-5: 加法加成叠加验证");

  const r = calculateScore([3, 3, 3, 1], {
    flatBonuses: [
      { source: "bonus_a", value: 5 },
      { source: "bonus_b", value: 10 },
      { source: "bonus_c", value: 3 },
    ],
  });
  // 三条: sumDice=10, categoryBase=10+5=15, flatTotal=18
  assertEqual(r.breakdown.flatTotal, 18, "加法加成总和=5+10+3=18");
  assertEqual(r.finalScore, 33, "最终分=floor((15+18)×1.0)=33");
}

// ============================================================
// AC-6: 乘法倍率正确叠加（积）
// ============================================================

function testAC6() {
  section("AC-6: 乘法倍率叠加验证");

  const r = calculateScore([5, 5, 5], {
    multipliers: [1.2, 1.5],
  });
  // 豹子: sumDice=15, categoryBase=15×3=45
  // multiplierTotal = 1.2 × 1.5 = 1.8
  // finalScore = floor((45+0) × 1.8) = floor(81) = 81
  assertApprox(r.breakdown.multiplierTotal, 1.8, "乘法倍率=1.2×1.5=1.8");
  assertEqual(r.finalScore, 81, "最终分=floor(45×1.8)=81");
}

// ============================================================
// AC-7: 最终分数向下取整
// ============================================================

function testAC7() {
  section("AC-7: 向下取整验证");

  const r = calculateScore([6, 6, 6], {
    multipliers: [1.2],
  });
  // 豹子: 18×3=54, floor(54×1.2)=floor(64.8)=64
  assertEqual(r.finalScore, 64, "floor(64.8)=64");

  const r2 = calculateScore([1, 1, 1], {
    multipliers: [1.15],
  });
  // 豹子: 3×3=9, floor(9×1.15)=floor(10.35)=10
  assertEqual(r2.finalScore, 10, "floor(10.35)=10");
}

// ============================================================
// AC-8: 分数不会为负
// ============================================================

function testAC8() {
  section("AC-8: 最低分保底为0");

  // 极端情况：全1骰子 + 负加成
  const r = calculateScore([1, 1, 1], {
    flatBonuses: [{ source: "negative", value: -100 }],
  });
  // 豹子: 3×3=9, 9+(-100)=-91, floor(-91) → max(0, -91) = 0
  assertEqual(r.finalScore, 0, "极端负加成 → 分数为0（保底）");
}

// ============================================================
// AC-9: 散牌始终可匹配
// ============================================================

function testAC9() {
  section("AC-9: 散牌始终兜底");

  // 完全不同的骰子（3颗）
  let { category } = findBestCategory([1, 3, 5]);
  assertEqual(category.id, "bust", "[1,3,5] → 散牌");

  // 4颗无重复无顺
  ({ category } = findBestCategory([1, 3, 5, 6]));
  assertEqual(category.id, "bust", "[1,3,5,6] → 散牌");

  // 7颗：无重复但1-6只有6个值，第7颗必然重复
  // 实际上7颗骰子不可能全部不同（只有6个面），所以必然至少有对子
  // 但可以验证封锁所有非散牌分类后散牌兜底
  const allBlocked = ["yahtzee", "full_house", "large_straight", "small_straight", "three_of_a_kind", "pair"];
  ({ category } = findBestCategory([1, 2, 3], { blockedCategories: allBlocked }));
  assertEqual(category.id, "bust", "封锁所有分类后 → 散牌兜底");
}

// ============================================================
// AC-10: 封锁对子后不匹配对子
// ============================================================

function testAC10() {
  section("AC-10: 封锁对子验证");

  // [5,5,3] 正常匹配对子，封锁后 → 散牌
  let { category } = findBestCategory([5, 5, 3], { blockedCategories: ["pair"] });
  assertEqual(category.id, "bust", "[5,5,3] 封锁对子 → 散牌");

  // [4,4,4,2] 正常匹配三条，封锁对子不影响
  ({ category } = findBestCategory([4, 4, 4, 2], { blockedCategories: ["pair"] }));
  assertEqual(category.id, "three_of_a_kind", "[4,4,4,2] 封锁对子仍匹配三条");

  // [3,3,3] 封锁对子后匹配豹子（优先级更高）
  ({ category } = findBestCategory([3, 3, 3], { blockedCategories: ["pair"] }));
  assertEqual(category.id, "yahtzee", "[3,3,3] 封锁对子仍匹配豹子");
}

// ============================================================
// AC-11: 最低点归零正确影响分数但不影响匹配
// ============================================================

function testAC11() {
  section("AC-11: 最低点归零验证");

  // [1,5,5] + zero_lowest: 匹配对子（用原始值判断），sum=0+5+5=10
  const r = calculateScore([1, 5, 5], {
    diceSumModifier: applyZeroLowest,
  });
  assertEqual(r.breakdown.category.id, "pair", "[1,5,5] 匹配对子（不受归零影响）");
  assertEqual(r.breakdown.sumDice, 10, "最低点归零后 sum=0+5+5=10");
  assertEqual(r.finalScore, 10, "最终分=10");
}

// ============================================================
// AC-12: 连横术超出部分计算正确
// ============================================================

function testAC12() {
  section("AC-12: 连横术超出部分验证");

  // [4,4,4,4,2] 三条(matchCount=3), 匹配值4出现4次, 超出=4-3=1, bonus=3
  let { category, matchInfo } = findBestCategory([4, 4, 4, 4, 2]);
  let bonus = calcChainLinkBonus([4, 4, 4, 4, 2], category, matchInfo);
  assertEqual(bonus, 3, "连横术: 4-3=1颗超出, 1×3=3");

  // [5,5,5,5,5] 三条(5颗全5), 匹配值5出现5次, 超出=5-3=2, bonus=6
  ({ category, matchInfo } = findBestCategory([5, 5, 5, 5, 5]));
  // 5颗全是5 → 豹子！不是三条
  assertEqual(category.id, "yahtzee", "[5,5,5,5,5] 匹配豹子");
  bonus = calcChainLinkBonus([5, 5, 5, 5, 5], category, matchInfo);
  assertEqual(bonus, 0, "豹子+连横术=0（所有骰子一致无超出）");

  // [2,2,2,3,3,3] 6骰子：检查匹配
  ({ category, matchInfo } = findBestCategory([2, 2, 2, 3, 3, 3]));
  // 2出现3次，3出现3次 → 满堂红？不！满堂红要求恰好两组值，小组≥2，大组≥3
  // {2:3, 3:3} → counts=[3,3], groups=2, 3≥2 && 3≥3 → 满堂红！
  assertEqual(category.id, "full_house", "[2,2,2,3,3,3] 匹配满堂红");
  bonus = calcChainLinkBonus([2, 2, 2, 3, 3, 3], category, matchInfo);
  assertEqual(bonus, 0, "满堂红+连横术=0（满堂红无超出概念）");

  // [3,3,3,3,3] 5骰子全是3 → 豹子
  ({ category, matchInfo } = findBestCategory([3, 3, 3, 3, 3]));
  assertEqual(category.id, "yahtzee", "[3,3,3,3,3] 匹配豹子");

  // [6,6,6,2,4,1] 6骰子: 6出现3次 → 三条, 超出=3-3=0
  ({ category, matchInfo } = findBestCategory([6, 6, 6, 2, 4, 1]));
  assertEqual(category.id, "three_of_a_kind", "[6,6,6,2,4,1] 匹配三条");
  bonus = calcChainLinkBonus([6, 6, 6, 2, 4, 1], category, matchInfo);
  assertEqual(bonus, 0, "连横术: 3-3=0颗超出, bonus=0");

  // [6,6,6,6,2,4] 6骰子: 6出现4次 → 三条, 超出=4-3=1, bonus=3
  ({ category, matchInfo } = findBestCategory([6, 6, 6, 6, 2, 4]));
  assertEqual(category.id, "three_of_a_kind", "[6,6,6,6,2,4] 匹配三条");
  bonus = calcChainLinkBonus([6, 6, 6, 6, 2, 4], category, matchInfo);
  assertEqual(bonus, 3, "连横术: 4-3=1颗超出, bonus=3");

  // [6,6,6,6,6,2] 6骰子: 6出现5次 → 三条, 超出=5-3=2, bonus=6
  ({ category, matchInfo } = findBestCategory([6, 6, 6, 6, 6, 2]));
  assertEqual(category.id, "three_of_a_kind", "[6,6,6,6,6,2] 匹配三条");
  bonus = calcChainLinkBonus([6, 6, 6, 6, 6, 2], category, matchInfo);
  assertEqual(bonus, 6, "连横术: 5-3=2颗超出, bonus=6");
}

// ============================================================
// AC-13: 6颗骰子分类匹配正确
// ============================================================

function testAC13() {
  section("AC-13: 6颗骰子验证");

  // 满堂红不匹配3组值
  let { category } = findBestCategory([4, 4, 4, 5, 5, 6]);
  assertEqual(category.id, "three_of_a_kind", "[4,4,4,5,5,6] 3组值不匹配满堂红 → 三条");

  // 大顺包含5连续
  ({ category } = findBestCategory([1, 2, 3, 4, 5, 6]));
  assertEqual(category.id, "large_straight", "[1,2,3,4,5,6] 包含5连续 → 大顺");

  // 满堂红正确匹配
  ({ category } = findBestCategory([3, 3, 3, 5, 5, 5]));
  // {3:3, 5:3} → counts=[3,3], 3≥2 && 3≥3 → 满堂红
  assertEqual(category.id, "full_house", "[3,3,3,5,5,5] 满堂红(3+3)");

  ({ category } = findBestCategory([2, 2, 2, 4, 4, 4]));
  assertEqual(category.id, "full_house", "[2,2,2,4,4,4] 满堂红(3+3)");

  // 满堂红: {3:4, 6:2} → counts=[2,4] → 满足
  ({ category } = findBestCategory([3, 3, 3, 3, 6, 6]));
  assertEqual(category.id, "full_house", "[3,3,3,3,6,6] 满堂红(4+2)");

  // 6颗全是同一值 → 豹子
  ({ category } = findBestCategory([4, 4, 4, 4, 4, 4]));
  assertEqual(category.id, "yahtzee", "[4,4,4,4,4,4] 豹子");
}

// ============================================================
// AC-14: 7颗骰子分类匹配正确（含临时骰子场景）
// ============================================================

function testAC14() {
  section("AC-14: 7颗骰子验证（含临时骰子）");

  // 7颗不同值不可能（只有6面），必有重复
  // 基本验证
  let { category } = findBestCategory([1, 1, 1, 1, 1, 1, 1]);
  assertEqual(category.id, "yahtzee", "[1×7] 豹子");

  ({ category } = findBestCategory([2, 2, 2, 5, 5, 5, 3]));
  // {2:3, 5:3, 3:1} → 3组值 → 不匹配满堂红 → 三条
  assertEqual(category.id, "three_of_a_kind", "[2,2,2,5,5,5,3] 3组值 → 三条");

  ({ category } = findBestCategory([4, 4, 4, 6, 6, 6, 6]));
  // {4:3, 6:4} → 2组值, counts=[3,4], 3≥2 && 4≥3 → 满堂红
  assertEqual(category.id, "full_house", "[4,4,4,6,6,6,6] 满堂红(3+4)");

  // 大顺
  ({ category } = findBestCategory([1, 2, 3, 4, 5, 6, 6]));
  assertEqual(category.id, "large_straight", "[1,2,3,4,5,6,6] 大顺");
}

// ============================================================
// AC-15: 豹子 + 连横术加成为 0
// ============================================================

function testAC15() {
  section("AC-15: 豹子+连横术=0");

  const cases = [
    [6, 6, 6],
    [1, 1, 1],
    [4, 4, 4, 4, 4],
    [3, 3, 3, 3, 3, 3, 3],
  ];

  for (const dice of cases) {
    const { category, matchInfo } = findBestCategory(dice);
    assertEqual(category.id, "yahtzee", `[${dice}] 匹配豹子`);
    const bonus = calcChainLinkBonus(dice, category, matchInfo);
    assertEqual(bonus, 0, `[${dice}] 豹子+连横术=0`);
  }
}

// ============================================================
// AC-16: 满堂红6颗骰子严格3+2
// ============================================================

function testAC16() {
  section("AC-16: 满堂红严格3+2验证");

  // 不匹配：3组值
  let { category } = findBestCategory([4, 4, 4, 5, 5, 6]);
  assertEqual(category.id, "three_of_a_kind", "[4,4,4,5,5,6] 3组值不匹配满堂红");

  // 不匹配：{5:5, 2:1} → 2组值但 counts=[1,5], 1<2 → 不满足
  ({ category } = findBestCategory([5, 5, 5, 5, 5, 2]));
  assertEqual(category.id, "three_of_a_kind", "[5,5,5,5,5,2] {5:5, 2:1} 小组只有1 → 三条");

  // 匹配：{3:4, 6:2} → counts=[2,4], 2≥2 && 4≥3 → 满堂红
  ({ category } = findBestCategory([3, 3, 3, 3, 6, 6]));
  assertEqual(category.id, "full_house", "[3,3,3,3,6,6] {3:4, 6:2} → 满堂红");

  // 匹配：{2:3, 5:3} → counts=[3,3], 3≥2 && 3≥3 → 满堂红
  ({ category } = findBestCategory([2, 2, 2, 5, 5, 5]));
  assertEqual(category.id, "full_house", "[2,2,2,5,5,5] {2:3, 5:3} → 满堂红");
}

// ============================================================
// 额外：顺子眼（顺子允许间隔1）验证
// ============================================================

function testLooseConsecutive() {
  section("额外: 顺子眼验证");

  // [1,3,4,5] 间隔1（跳过2）算小顺
  let { category } = findBestCategory([1, 3, 4, 5], { looseConsecutive: true });
  assertEqual(category.id, "small_straight", "顺子眼: [1,3,4,5] 算小顺");

  // 不开顺子眼时 [1,3,4,5] 不是小顺（只有3-4-5连续3个）
  ({ category } = findBestCategory([1, 3, 4, 5], { looseConsecutive: false }));
  assertEqual(category.id, "bust", "无顺子眼: [1,3,4,5] 不算小顺 → 散牌");

  // [1,2,4,5] 间隔1（跳过3）算小顺
  ({ category } = findBestCategory([1, 2, 4, 5], { looseConsecutive: true }));
  assertEqual(category.id, "small_straight", "顺子眼: [1,2,4,5] 算小顺（跳过3）");

  // [1,2,3,4] 正常小顺，顺子眼不影响
  ({ category } = findBestCategory([1, 2, 3, 4], { looseConsecutive: true }));
  assertEqual(category.id, "small_straight", "顺子眼: [1,2,3,4] 正常小顺");
}

// ============================================================
// 额外：多组对子取最高值验证
// ============================================================

function testMultiplePairs() {
  section("额外: 多组对子取最高值");

  // [5,5,2,2] → 对子，以5为准
  let { category, matchInfo } = findBestCategory([5, 5, 2, 2]);
  assertEqual(category.id, "pair", "[5,5,2,2] 匹配对子");
  assertEqual(matchInfo.matchValue, 5, "取5的对子（更高值）");

  // [6,6,3,3] → 对子，以6为准
  ({ category, matchInfo } = findBestCategory([6, 6, 3, 3]));
  assertEqual(category.id, "pair", "[6,6,3,3] 匹配对子");
  assertEqual(matchInfo.matchValue, 6, "取6的对子（更高值）");
}

// ============================================================
// 额外：5颗骰子穷举验证（6⁵=7776种）
// ============================================================

function testExhaustive5Dice() {
  section("额外: 5颗骰子穷举验证 (7776种)");
  const combos = generateAllCombinations(5);
  let errors = 0;

  for (const dice of combos) {
    const expected = manualClassify(dice);
    const { category } = findBestCategory(dice);
    if (category.id !== expected) {
      errors++;
      if (errors <= 5) {
        console.log(`  MISMATCH: [${dice}] 期望=${expected}, 实际=${category.id}`);
      }
    }
  }

  assertEqual(errors, 0, `5骰子穷举: ${combos.length - errors}/${combos.length} 正确`);
}

// ============================================================
// 运行所有测试
// ============================================================

console.log("====================================");
console.log("  千王骰局 — 计分系统原型测试");
console.log("====================================");

testAC1();
testAC2();
testAC3();
testAC4();
testAC5();
testAC6();
testAC7();
testAC8();
testAC9();
testAC10();
testAC11();
testAC12();
testAC13();
testAC14();
testAC15();
testAC16();
testLooseConsecutive();
testMultiplePairs();
testExhaustive5Dice();

// ============================================================
// 结果汇总
// ============================================================

console.log("\n====================================");
console.log(`  总计: ${totalTests} 个测试`);
console.log(`  通过: ${passedTests}`);
console.log(`  失败: ${failedTests}`);
console.log("====================================");

if (failures.length > 0) {
  console.log("\n失败详情:");
  failures.forEach(f => console.log(`  - ${f}`));
}

process.exit(failedTests > 0 ? 1 : 0);
