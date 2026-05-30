'use strict';

/**
 * Monte Carlo 数值模拟 — 千王骰局通关曲线验证
 *
 * 模拟多种流派构筑策略，通过大量自动对局来验证：
 * 1. 各流派的通关率
 * 2. 平均推进轮次
 * 3. 分数分布曲线
 * 4. 各流派在不同敌人面前的表现
 *
 * 用法：node tests/monte-carlo-sim.js
 */

import { GameFlow, GameState } from '../src/game-flow.js';

// ---------------------------------------------------------------------------
// 策略配置
// ---------------------------------------------------------------------------

/**
 * 定义不同构筑流派的策略。
 * 每个策略规定：
 *   - 被动优先购买列表
 *   - 消耗品使用策略
 *   - 商店购买倾向
 */
const STRATEGIES = {
  // 基线：无特殊流派，只买基础能力
  baseline: {
    name: '基线（无流派）',
    passivePriority: ['greed', 'loaded_dice', 'chain_link'],
    consumablePriority: ['face_change', 'double_roll', 'loaded_shot'],
    description: '无特殊流派，优先购买贪欲/铅骰/连横术',
  },

  // 奇偶流
  parity: {
    name: '奇偶交响乐',
    passivePriority: ['odd_fanatic', 'even_order', 'greed'],
    consumablePriority: ['parity_shift', 'face_change', 'extremes_fission'],
    description: '追求奇数加分或全偶数倍率',
  },

  // 重掷流
  reroll: {
    name: '赌徒的狂欢',
    passivePriority: ['gamblers_fallacy', 'cheat_rebound', 'greed'],
    consumablePriority: ['fate_roulette', 'double_roll', 'loaded_shot'],
    description: '大量重掷堆叠倍率，命运左轮高风险高回报',
  },

  // 极值流
  extremes: {
    name: '极值与虚无',
    passivePriority: ['bottom_out', 'bipolar_resonance', 'greed'],
    consumablePriority: ['extremes_fission', 'face_change', 'parity_shift'],
    description: '追求全1和6的极端骰面，爆发式得分',
  },

  // 黑市流
  blackMarket: {
    name: '黑市规则改写',
    passivePriority: ['blind_judge', 'cheat_rebound', 'greed'],
    consumablePriority: ['black_market_deal', 'face_change', 'double_roll'],
    description: '无视敌方规则，大量借贷消耗品',
  },

  // 综合流：极值 + 黑市混搭
  hybrid_extreme_market: {
    name: '极值黑市混搭',
    passivePriority: ['bipolar_resonance', 'blind_judge', 'bottom_out'],
    consumablePriority: ['extremes_fission', 'black_market_deal', 'face_change'],
    description: '极值骰面 + 规则免疫，后期爆发最强',
  },

  // 原有强力流
  legacy_power: {
    name: '经典强力流',
    passivePriority: ['greed', 'pattern_master', 'loaded_dice'],
    consumablePriority: ['face_change', 'double_roll', 'replace_lowest_card'],
    description: '经典倍率 + 牌型大师组合',
  },
};

// ---------------------------------------------------------------------------
// 模拟参数
// ---------------------------------------------------------------------------
const SIMULATIONS_PER_STRATEGY = 2000;
const TOTAL_ROUNDS = 8;

// ---------------------------------------------------------------------------
// AI 策略执行器
// ---------------------------------------------------------------------------

/**
 * 模拟一局完整游戏，使用指定策略进行购买和消耗品使用。
 *
 * @param {GameFlow} game - 已加载数据的 GameFlow 实例
 * @param {number} seed - RNG seed
 * @param {object} strategy - 策略配置
 * @returns {object} { victory, roundReached, scores[], totalScore }
 */
function simulateGame(game, seed, strategy) {
  game.newGame(seed);

  const roundScores = [];
  let roundReached = 0;

  for (let round = 1; round <= TOTAL_ROUNDS; round++) {
    if (game.isGameOver()) break;
    if (game.getState() !== GameState.BATTLE) break;

    roundReached = round;

    // Phase 1: 第一次投掷
    const firstRoll = game.executeFirstRoll();
    if (!firstRoll) break;

    // AI 决策：留骰策略 — 保留高价值骰子
    const heldIndices = decideHold(firstRoll.diceValues, strategy);

    // Phase 2: 留骰 + 第二次投掷
    const rollResult = game.confirmHold(heldIndices);
    if (!rollResult) break;

    // Phase 3: 使用消耗品（简化 AI：每轮使用前 2 个可用的消耗品）
    useConsumablesAI(game, strategy);

    // Phase 4: 重新计算
    game.recalculateRollResult();

    // Phase 5: 分类选择 — 让 AI 选择最优分类
    const available = game.enterCategorySelect();
    if (available && available.length > 0) {
      // 选择 preview 得分最高的分类
      const best = available.reduce((a, b) => (b.preview > a.preview ? b : a), available[0]);
      game.confirmCategory(best.id, available);
    } else {
      // 强夺令或无可选分类，直接结算
      game.finalizeBattle();
    }

    // 记录本轮分数
    const combatResult = game.getCombat().getResult();
    if (combatResult) {
      roundScores.push({
        round,
        score: combatResult.score,
        target: combatResult.targetScore,
        victory: combatResult.victory,
        category: typeof combatResult.matchedCategory === 'string'
          ? combatResult.matchedCategory
          : combatResult.matchedCategory?.id || 'unknown',
      });
    }

    // Phase 6: 如果进入商店，执行购买策略
    if (game.getState() === GameState.SHOP) {
      shopAI(game, strategy);
      game.closeShop();
    }
  }

  const result = game.getResult();
  return {
    victory: result?.result === 'VICTORY',
    roundReached,
    scores: roundScores,
    totalScore: roundScores.reduce((sum, r) => sum + r.score, 0),
    defeatRound: result?.result === 'DEFEAT' ? result.round : null,
  };
}

/**
 * 留骰决策 AI：保留点数 >= 4 的骰子。
 */
function decideHold(diceValues, strategy) {
  const held = [];
  for (let i = 0; i < diceValues.length; i++) {
    if (diceValues[i] >= 4) {
      held.push(i);
    }
  }
  return held;
}

/**
 * 消耗品使用 AI：按策略优先级使用前 2 个消耗品。
 */
function useConsumablesAI(game, strategy) {
  const combat = game.getCombat();
  const cheating = game.getCheating();
  const consumables = cheating.getConsumables();

  let used = 0;
  for (let i = 0; i < consumables.length && used < 2; i++) {
    const c = consumables[i];
    if (!c) continue;

    // 跳过透视（对 AI 没意义）
    if (c.effectType === 'reveal_weakness') continue;

    // 对于需要目标的消耗品，选择合适的目标
    const options = {};
    switch (c.effectType) {
      case 'set_dice_value':
        options.targetIndex = findLowestDieIndex(game);
        options.targetValue = 6;
        break;
      case 'reroll_min':
      case 'high_risk_reroll':
        options.targetIndex = findLowestDieIndex(game);
        break;
      case 'shift_dice_parity':
        options.targetIndex = findLowestDieIndex(game);
        break;
      case 'copy_dice_value':
        options.targetIndex = findHighestDieIndex(game);
        options.targetIndex2 = findLowestDieIndex(game);
        break;
      case 'swap_values':
        options.targetIndex = 0;
        options.targetIndex2 = 1;
        break;
      case 'invert_value':
        options.targetIndex = findLowestDieIndex(game);
        break;
      case 'freeze_die':
        options.targetIndex = findHighestDieIndex(game);
        break;
      // 黑市交易、两极分化、双投等无需特殊目标
      default:
        break;
    }

    const result = combat.useConsumable(i - used, options);
    if (result) {
      used++;
    }
  }
}

/**
 * 商店购买 AI：按策略优先级购买。
 */
function shopAI(game, strategy) {
  const shop = game.getShop();
  const economy = game.getEconomy();

  // 最多尝试购买 2 次（含刷新）
  for (let attempt = 0; attempt < 2; attempt++) {
    const items = shop.getDisplayItems();

    // 查找优先被动
    for (const priorityId of strategy.passivePriority) {
      const idx = items.findIndex(item => item && item.id === priorityId);
      if (idx >= 0 && shop.canBuy(idx)) {
        const buyResult = shop.buy(idx);
        if (buyResult === true) return; // 购买成功
      }
    }

    // 查找优先消耗品
    for (const priorityId of strategy.consumablePriority) {
      const idx = items.findIndex(item => item && item.id === priorityId);
      if (idx >= 0 && shop.canBuy(idx)) {
        const buyResult = shop.buy(idx);
        if (buyResult === true) return;
      }
    }

    // 买任何买得起的
    for (let i = 0; i < items.length; i++) {
      if (items[i] && shop.canBuy(i)) {
        const buyResult = shop.buy(i);
        if (buyResult === true) return;
      }
    }

    // 没买到，刷新一次
    if (shop.canRefresh()) {
      shop.refresh();
    } else {
      break;
    }
  }
}

function findLowestDieIndex(game) {
  const values = game.getDicePool().getValues();
  let minIdx = 0;
  for (let i = 1; i < values.length; i++) {
    if (values[i] < values[minIdx]) minIdx = i;
  }
  return minIdx;
}

function findHighestDieIndex(game) {
  const values = game.getDicePool().getValues();
  let maxIdx = 0;
  for (let i = 1; i < values.length; i++) {
    if (values[i] > values[maxIdx]) maxIdx = i;
  }
  return maxIdx;
}

// ---------------------------------------------------------------------------
// 统计报告
// ---------------------------------------------------------------------------

function generateReport(strategyName, strategyConfig, results) {
  const total = results.length;
  const wins = results.filter(r => r.victory).length;
  const winRate = (wins / total * 100).toFixed(1);

  // 平均推进轮次
  const avgRound = (results.reduce((s, r) => s + r.roundReached, 0) / total).toFixed(2);

  // 败场分布
  const defeatDistribution = {};
  for (let i = 1; i <= TOTAL_ROUNDS; i++) defeatDistribution[i] = 0;
  results.filter(r => !r.victory).forEach(r => {
    if (r.defeatRound) defeatDistribution[r.defeatRound]++;
  });

  // 各轮平均得分
  const roundAvgScores = [];
  for (let round = 1; round <= TOTAL_ROUNDS; round++) {
    const roundData = results.flatMap(r => r.scores.filter(s => s.round === round));
    if (roundData.length > 0) {
      const avgScore = (roundData.reduce((s, d) => s + d.score, 0) / roundData.length).toFixed(1);
      const avgTarget = (roundData.reduce((s, d) => s + d.target, 0) / roundData.length).toFixed(1);
      const roundWinRate = (roundData.filter(d => d.victory).length / roundData.length * 100).toFixed(1);
      roundAvgScores.push({ round, avgScore, avgTarget, roundWinRate, sampleSize: roundData.length });
    }
  }

  return {
    strategy: strategyName,
    description: strategyConfig.description,
    total,
    wins,
    winRate: `${winRate}%`,
    avgRound,
    defeatDistribution,
    roundAvgScores,
  };
}

function printReport(report) {
  console.log(`\n${'═'.repeat(60)}`);
  console.log(`  策略: ${report.strategy}`);
  console.log(`  描述: ${report.description}`);
  console.log(`${'═'.repeat(60)}`);
  console.log(`  总局数: ${report.total}  |  胜利: ${report.wins}  |  通关率: ${report.winRate}`);
  console.log(`  平均推进轮次: ${report.avgRound} / ${TOTAL_ROUNDS}`);

  // 败场分布
  console.log(`\n  败场轮次分布:`);
  const defeatRounds = Object.entries(report.defeatDistribution)
    .filter(([, count]) => count > 0)
    .map(([round, count]) => `R${round}: ${count}`);
  console.log(`    ${defeatRounds.length > 0 ? defeatRounds.join('  |  ') : '（无败场）'}`);

  // 各轮得分曲线
  console.log(`\n  轮次  |  样本数  |  平均分  |  目标分  |  单轮胜率`);
  console.log(`  ${'─'.repeat(52)}`);
  for (const r of report.roundAvgScores) {
    const pad = (s, w) => String(s).padStart(w);
    console.log(`   R${r.round}   |  ${pad(r.sampleSize, 5)}  |  ${pad(r.avgScore, 6)}  |  ${pad(r.avgTarget, 6)}  |  ${pad(r.roundWinRate, 5)}%`);
  }
}

function printComparisonTable(reports) {
  console.log(`\n\n${'█'.repeat(60)}`);
  console.log(`  ██  各流派通关率对比总表  ██`);
  console.log(`${'█'.repeat(60)}\n`);

  // 排序：通关率从高到低
  const sorted = [...reports].sort((a, b) => parseFloat(b.winRate) - parseFloat(a.winRate));

  console.log(`  排名  |  策略名称              |  通关率  |  平均轮次  |  胜场`);
  console.log(`  ${'─'.repeat(62)}`);
  for (let i = 0; i < sorted.length; i++) {
    const r = sorted[i];
    const name = r.strategy.padEnd(18);
    console.log(`   #${i + 1}   |  ${name}  |  ${r.winRate.padStart(5)}  |   ${r.avgRound.padStart(5)}   |  ${String(r.wins).padStart(5)}`);
  }

  // 数值健康度判断
  console.log(`\n\n  ▶ 数值健康度评估：`);
  const topRate = parseFloat(sorted[0].winRate);
  const bottomRate = parseFloat(sorted[sorted.length - 1].winRate);
  const spread = topRate - bottomRate;

  if (topRate > 80) {
    console.log(`  ⚠️  最高通关率 ${sorted[0].winRate} 偏高，游戏可能太简单`);
  } else if (topRate < 10) {
    console.log(`  ⚠️  最高通关率 ${sorted[0].winRate} 偏低，游戏可能太难`);
  } else {
    console.log(`  ✅  最高通关率 ${sorted[0].winRate} 在合理区间 (10%-80%)`);
  }

  if (spread > 40) {
    console.log(`  ⚠️  流派间差距 ${spread.toFixed(1)}% 过大，可能存在某流派过于强势`);
  } else {
    console.log(`  ✅  流派间差距 ${spread.toFixed(1)}%，平衡性良好`);
  }

  if (bottomRate < 1) {
    console.log(`  ⚠️  ${sorted[sorted.length - 1].strategy} 通关率仅 ${sorted[sorted.length - 1].winRate}，需要加强`);
  }
}

// ---------------------------------------------------------------------------
// 主执行
// ---------------------------------------------------------------------------

async function main() {
  console.log('千王骰局 — Monte Carlo 数值模拟');
  console.log(`每流派模拟 ${SIMULATIONS_PER_STRATEGY} 局, 共 ${Object.keys(STRATEGIES).length} 种策略\n`);

  // 加载游戏数据
  const game = new GameFlow({ dataDir: 'assets/data' });
  const loaded = await game.load();
  if (!loaded) {
    console.error('数据加载失败！');
    process.exit(1);
  }

  const allReports = [];

  for (const [strategyKey, strategyConfig] of Object.entries(STRATEGIES)) {
    process.stdout.write(`  正在模拟: ${strategyConfig.name} ...`);

    const results = [];
    for (let i = 0; i < SIMULATIONS_PER_STRATEGY; i++) {
      const seed = 10000 + i;
      try {
        const result = simulateGame(game, seed, strategyConfig);
        results.push(result);
      } catch (err) {
        // 跳过单局错误
      }
    }

    process.stdout.write(` 完成 (${results.length} 局)\n`);

    const report = generateReport(strategyConfig.name, strategyConfig, results);
    allReports.push(report);
    printReport(report);
  }

  // 总览比对
  printComparisonTable(allReports);

  console.log(`\n模拟完成。`);
}

main().catch(err => {
  console.error('模拟出错:', err);
  process.exit(1);
});
