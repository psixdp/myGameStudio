/**
 * 计分系统原型 — 千王骰局
 *
 * 验证目标：可变骰子数(3-7) × 7种分类的自动匹配和分数计算
 *
 * 核心职责：
 * 1. 分类匹配：给定骰子池，自动判断最高优先级分类
 * 2. 分数计算：基础分 + 加法加成 × 乘法倍率
 * 3. 敌人规则影响：封锁分类、最低点归零等
 */

// ============================================================
// 数据配置（从 JSON 配置读取，原型中硬编码）
// ============================================================

const CATEGORIES = [
  { id: "yahtzee",          name: "豹子",   priority: 1, minDice: 3, matchType: "all_same",     matchCount: 0, bonusType: "multiplier", bonusValue: 3 },
  { id: "full_house",       name: "满堂红", priority: 2, minDice: 5, matchType: "full_house",   matchCount: 0, bonusType: "flat",       bonusValue: 15 },
  { id: "large_straight",   name: "大顺",   priority: 3, minDice: 5, matchType: "consecutive",  consecutiveCount: 5, bonusType: "flat", bonusValue: 20 },
  { id: "small_straight",   name: "小顺",   priority: 4, minDice: 4, matchType: "consecutive",  consecutiveCount: 4, bonusType: "flat", bonusValue: 10 },
  { id: "three_of_a_kind",  name: "三条",   priority: 5, minDice: 3, matchType: "same_value",   matchCount: 3, bonusType: "flat",       bonusValue: 5 },
  { id: "pair",             name: "对子",   priority: 6, minDice: 2, matchType: "same_value",   matchCount: 2, bonusType: "flat",       bonusValue: 0 },
  { id: "bust",             name: "散牌",   priority: 7, minDice: 0, matchType: "fallback",     matchCount: 0, bonusType: "flat",       bonusValue: 0 },
];

// ============================================================
// 辅助函数
// ============================================================

/** 统计每个值出现的频率 */
function countFrequency(values) {
  const freq = {};
  for (const v of values) {
    freq[v] = (freq[v] || 0) + 1;
  }
  return freq;
}

/** 去重并排序 */
function uniqueSorted(values) {
  return [...new Set(values)].sort((a, b) => a - b);
}

/** 检查去重后是否存在 length 个连续整数 */
function hasConsecutive(values, length) {
  const sorted = uniqueSorted(values);
  if (sorted.length < length) return false;
  let count = 1;
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i] === sorted[i - 1] + 1) {
      count++;
      if (count >= length) return true;
    } else {
      count = 1;
    }
  }
  return false;
}

// ============================================================
// 分类匹配
// ============================================================

/** 检查豹子：所有骰子值相同 */
function isAllSame(values) {
  return values.length >= 3 && values.every(v => v === values[0]);
}

/** 检查满堂红：恰好两组值，小组≥2，大组≥3 */
function isFullHouse(values) {
  const freq = countFrequency(values);
  const counts = Object.values(freq).sort((a, b) => a - b);
  const groups = Object.keys(freq);
  return groups.length === 2 && counts[0] >= 2 && counts[1] >= 3;
}

/** 获取某值出现的次数（用于三条/对子） */
function getMaxFrequency(values) {
  const freq = countFrequency(values);
  return Math.max(...Object.values(freq));
}

/** 获取出现次数≥minCount的最高值（用于对子多组情况） */
function getBestMatchValue(values, minCount) {
  const freq = countFrequency(values);
  let bestValue = -1;
  for (const [val, count] of Object.entries(freq)) {
    if (count >= minCount && Number(val) > bestValue) {
      bestValue = Number(val);
    }
  }
  return bestValue;
}

/**
 * 给定骰子值数组，找到最佳匹配分类
 *
 * @param {number[]} diceValues - 骰子值数组
 * @param {object} options - 可选参数
 * @param {string[]} options.blockedCategories - 被封锁的分类ID列表
 * @param {boolean} options.looseConsecutive - 是否启用顺子眼（允许间隔1）
 * @returns {object} { category, matchInfo }
 */
function findBestCategory(diceValues, options = {}) {
  const { blockedCategories = [], looseConsecutive = false } = options;
  const blockedSet = new Set(blockedCategories);
  const diceCount = diceValues.length;

  // 按 priority 升序检查
  for (const cat of CATEGORIES) {
    // 跳过骰子数不足的分类
    if (diceCount < cat.minDice) continue;
    // 跳过被封锁的分类
    if (blockedSet.has(cat.id)) continue;
    // 散牌不可被封锁
    if (cat.matchType === "fallback") {
      return { category: cat, matchInfo: {} };
    }

    const matchResult = checkMatch(diceValues, cat, looseConsecutive);
    if (matchResult.matched) {
      return { category: cat, matchInfo: matchResult.info };
    }
  }

  // 理论上不会到达这里（散牌始终兜底）
  return { category: CATEGORIES.find(c => c.id === "bust"), matchInfo: {} };
}

/** 检查单个分类是否匹配 */
function checkMatch(values, category, looseConsecutive) {
  switch (category.matchType) {
    case "all_same":
      return { matched: isAllSame(values), info: { matchValue: values[0], matchCount: values.length } };

    case "full_house":
      if (!isFullHouse(values)) return { matched: false, info: {} };
      const freq = countFrequency(values);
      const entries = Object.entries(freq).sort((a, b) => b[1] - a[1]);
      return {
        matched: true,
        info: { tripleValue: Number(entries[0][0]), pairValue: Number(entries[1][0]) }
      };

    case "consecutive":
      const needed = category.consecutiveCount;
      if (looseConsecutive) {
        return { matched: hasLooseConsecutive(values, needed), info: {} };
      }
      return { matched: hasConsecutive(values, needed), info: {} };

    case "same_value": {
      const needed = category.matchCount;
      const maxFreq = getMaxFrequency(values);
      if (maxFreq < needed) return { matched: false, info: {} };
      const bestVal = getBestMatchValue(values, needed);
      return { matched: true, info: { matchValue: bestVal, matchCount: maxFreq } };
    }

    case "fallback":
      return { matched: true, info: {} };

    default:
      return { matched: false, info: {} };
  }
}

/** 顺子眼：允许间隔1的连续值检测 */
function hasLooseConsecutive(values, length) {
  const sorted = uniqueSorted(values);
  if (sorted.length < length) return false;

  // 用滑动窗口检查：相邻元素差值≤1，且实际连续值≥length
  // 改用计数法：统计窗口内最大连续值数量
  for (let start = 0; start <= sorted.length - length; start++) {
    let consecutiveCount = 1;
    for (let i = start + 1; i < sorted.length; i++) {
      const gap = sorted[i] - sorted[i - 1];
      if (gap <= 1) {
        // gap=0 不可能（已去重），gap=1 正常连续，gap>1 但≤1 不存在
        // 顺子眼允许间隔1：即 1,3 算连续（间隔2不行）
        // 实际上"允许间隔1"意味着 1,2,4,5 中 1-2连续，跳过3（间隔1），4-5连续
        // 重新理解：顺子允许间隔1 = 差值≤1 的都算连续？不对，去重后差值至少为1
        // "允许间隔1" = 允许最大间隔为2（如 1-3 算相邻），但需要连续值数量够
        // 不对，设计文档说"顺子允许间隔1（如1-3-4-5算小顺）"
        // 1,3,4,5：1到3间隔2（跳过了2），但允许间隔1意味着允许跳过1个值
        // 所以判定方式：sorted序列中，相邻元素差值允许为1或2
        const diff = sorted[i] - sorted[i - 1];
        if (diff <= 2) {
          consecutiveCount++;
        } else {
          break;
        }
        if (consecutiveCount >= length) return true;
      } else {
        break;
      }
    }
  }

  // 也可能从任意起点开始
  // 上面的循环只检查了从start开始的，但break后应该换起点
  // 更简单的实现：遍历所有子序列
  return hasLooseConsecutiveBruteForce(sorted, length);
}

function hasLooseConsecutiveBruteForce(sorted, length) {
  if (sorted.length < length) return false;

  for (let i = 0; i < sorted.length; i++) {
    let count = 1;
    let lastVal = sorted[i];
    for (let j = i + 1; j < sorted.length; j++) {
      const diff = sorted[j] - lastVal;
      if (diff === 1 || diff === 2) {
        // diff=1: 正常连续；diff=2: 间隔1（允许）
        count++;
        lastVal = sorted[j];
        if (count >= length) return true;
      } else if (diff > 2) {
        break;
      }
      // diff === 0 不可能（已去重）
    }
  }
  return false;
}

// ============================================================
// 分数计算
// ============================================================

/**
 * 计算最终分数
 *
 * @param {number[]} diceValues - 骰子值数组（原始值，用于匹配）
 * @param {object} options
 * @param {string[]} options.blockedCategories - 被封锁的分类
 * @param {boolean} options.looseConsecutive - 顺子眼
 * @param {Function|null} options.diceSumModifier - 敌人规则修改骰子求和（如最低点归零）
 * @param {object[]} options.flatBonuses - 加法加成 [{source, value}]
 * @param {number[]} options.multipliers - 乘法倍率 [1.2, 1.5, ...]
 * @returns {object} { finalScore, breakdown }
 */
function calculateScore(diceValues, options = {}) {
  const {
    blockedCategories = [],
    looseConsecutive = false,
    diceSumModifier = null,
    flatBonuses = [],
    multipliers = [],
  } = options;

  // 1. 分类匹配（用原始骰子值）
  const { category, matchInfo } = findBestCategory(diceValues, { blockedCategories, looseConsecutive });

  // 2. 骰子求和（可能被敌人规则修改）
  let sumDice = diceValues.reduce((s, v) => s + v, 0);
  if (diceSumModifier) {
    sumDice = diceSumModifier([...diceValues]);
  }

  // 3. 分类基础分
  let categoryBase;
  if (category.bonusType === "multiplier") {
    categoryBase = sumDice * category.bonusValue;
  } else {
    categoryBase = sumDice + category.bonusValue;
  }

  // 4. 加法加成总和
  const flatTotal = flatBonuses.reduce((s, b) => s + b.value, 0);

  // 5. 乘法倍率之积
  const multiplierTotal = multipliers.length > 0
    ? multipliers.reduce((p, m) => p * m, 1)
    : 1.0;

  // 6. 最终分数
  const rawScore = (categoryBase + flatTotal) * multiplierTotal;
  const finalScore = Math.max(0, Math.floor(rawScore + 1e-9));  // 加微小值避免浮点精度问题

  return {
    finalScore,
    breakdown: {
      category,
      matchInfo,
      sumDice,
      categoryBase,
      flatBonuses,
      flatTotal,
      multipliers,
      multiplierTotal,
      rawScore,
      finalScore,
    },
  };
}

// ============================================================
// 连横术加成计算
// ============================================================

/**
 * 计算连横术加成
 * 超出分类最低要求的每颗匹配骰子 +3
 * 豹子特殊：所有骰子一致，无超出部分，加成=0
 *
 * @param {number[]} diceValues - 骰子值
 * @param {object} category - 匹配到的分类
 * @param {object} matchInfo - 匹配信息
 * @param {number} perExcess - 每颗超出骰子的加成（默认3）
 * @returns {number} 连横术加成值
 */
function calcChainLinkBonus(diceValues, category, matchInfo, perExcess = 3) {
  // 豹子：所有骰子一致，无超出
  if (category.id === "yahtzee") return 0;

  // 满堂红：严格要求3+2，无超出概念
  if (category.id === "full_house") return 0;

  // 散牌：无匹配，无超出
  if (category.id === "bust") return 0;

  // 顺子类：无"超出"概念（连续值没有matchCount）
  if (category.id === "small_straight" || category.id === "large_straight") return 0;

  // 三条/对子：超出最低要求的部分
  if (category.matchType === "same_value") {
    const matchedCount = matchInfo.matchCount || 0;
    const requiredCount = category.matchCount;
    const excess = Math.max(0, matchedCount - requiredCount);
    return excess * perExcess;
  }

  return 0;
}

// ============================================================
// 敌人规则辅助函数
// ============================================================

/** 最低点归零：将最低骰子在求和时视为0（不影响分类匹配） */
function applyZeroLowest(diceValues) {
  if (diceValues.length === 0) return 0;
  const minVal = Math.min(...diceValues);
  // 只归零一个最低骰子
  let zeroed = false;
  return diceValues.reduce((sum, v) => {
    if (!zeroed && v === minVal) {
      zeroed = true;
      return sum;
    }
    return sum + v;
  }, 0);
}

// ============================================================
// 导出（Node.js 环境）
// ============================================================

if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    CATEGORIES,
    countFrequency,
    uniqueSorted,
    hasConsecutive,
    isAllSame,
    isFullHouse,
    getMaxFrequency,
    getBestMatchValue,
    findBestCategory,
    calculateScore,
    calcChainLinkBonus,
    applyZeroLowest,
  };
}
