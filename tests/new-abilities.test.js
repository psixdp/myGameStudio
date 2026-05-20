'use strict';

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { Combat } from '../src/combat.js';
import { DicePool } from '../src/dice.js';
import { Enemy } from '../src/enemy.js';
import { CheatingAbilities } from '../src/cheating.js';
import { Economy } from '../src/economy.js';
import { RNG } from '../src/rng.js';
import { DataConfig } from '../src/data-config.js';

function makeCombatSystem(seed = 42) {
  const rng = new RNG();
  rng.seed(seed);
  const dataConfig = new DataConfig().loadFromObject({
    globalConfig: { dice: { initialCount: 4, maxCount: 7, minFace: 1, maxFace: 6 } },
    scoringCategories: [
      { id: 'pair', name: '对子', matchType: 'same_value', matchCount: 2, minDice: 2, bonusType: 'fixed', bonusValue: 0, priority: 6 },
      { id: 'three_of_a_kind', name: '三条', matchType: 'same_value', matchCount: 3, minDice: 3, bonusType: 'fixed', bonusValue: 5, priority: 5 },
      { id: 'yahtzee', name: '豹子', matchType: 'all_same', minDice: 3, bonusType: 'multiplier', bonusValue: 3, priority: 1 },
      { id: 'bust', name: '散牌', matchType: 'fallback', minDice: 0, bonusType: 'fixed', bonusValue: 0, priority: 7 }
    ],
    enemies: [
      { id: 'thug', round: 1, name: '街头混混', targetScore: 8, rules: [] },
      { id: 'dealer', round: 3, name: '地下庄家', targetScore: 22, rules: ['block_pair'] },
      { id: 'croupier', round: 4, name: '赌场荷官', targetScore: 35, rules: ['zero_lowest'] },
      { id: 'underground_king', round: 7, name: '地下赌王', targetScore: 88, rules: ['suppress_all'] },
      { id: 'manager', round: 6, name: '赌场经理', targetScore: 68, rules: ['seal_passive'] }
    ],
    enemyRules: [
      { id: 'block_pair', name: '封锁对子', effectType: 'block_category', targetCategory: 'pair' },
      { id: 'zero_lowest', name: '最低点归零', effectType: 'zero_lowest_dice', params: { count: 1 } },
      { id: 'suppress_all', name: '全面压制', effectType: 'dice_decrease', params: { amount: 1, minValue: 1 } },
      { id: 'seal_passive', name: '封印被动', effectType: 'seal_most_expensive_passive' }
    ],
    abilities: [
      { id: 'mimic', name: '模仿', type: 'consumable', cost: 2, effectType: 'copy_dice_value', params: {}, description: '模仿' },
      {
        id: 'odd_fanatic',
        name: '奇数狂热',
        type: 'passive',
        cost: 4,
        effectType: 'odd_dice_bonus',
        params: { perOddFlat: 6, perOddMultiplier: 0.05 }
      },
      {
        id: 'even_order',
        name: '偶数秩序',
        type: 'passive',
        cost: 4,
        effectType: 'all_even_multiplier',
        params: { multiplier: 1.8 }
      },
      {
        id: 'parity_shift',
        name: '微调戏法',
        type: 'consumable',
        cost: 1,
        effectType: 'shift_dice_parity',
        params: { amount: 1 }
      },
      {
        id: 'gamblers_fallacy',
        name: '赌徒谬误',
        type: 'passive',
        cost: 4,
        effectType: 'reroll_momentum',
        params: { perRerollMultiplier: 0.15 }
      },
      {
        id: 'fate_roulette',
        name: '命运左轮',
        type: 'consumable',
        cost: 2,
        effectType: 'high_risk_reroll',
        params: { successValue: 6, failValue: 1, successMultiplier: 2.0, failMultiplier: 0.5 }
      },
      {
        id: 'bottom_out',
        name: '否极泰来',
        type: 'passive',
        cost: 3,
        effectType: 'low_value_bonus',
        params: { value: 1, flatBonus: 12, fallbackDoubled: true }
      },
      {
        id: 'bipolar_resonance',
        name: '双极共鸣',
        type: 'passive',
        cost: 5,
        effectType: 'polar_multiplier',
        params: { allowedValues: [1, 6], multiplier: 2.0 }
      },
      {
        id: 'extremes_fission',
        name: '两极分化',
        type: 'consumable',
        cost: 2,
        effectType: 'split_to_extremes',
        params: { targetValues: [2, 3, 4, 5], outcomes: [1, 6] }
      },
      {
        id: 'blind_judge',
        name: '盲眼法官',
        type: 'passive',
        cost: 5,
        effectType: 'negate_enemy_rule',
        params: { bonusFlat: 15 }
      },
      {
        id: 'black_market_deal',
        name: '黑市交易',
        type: 'consumable',
        cost: 2,
        effectType: 'loan_consumables',
        params: { count: 3, turnLimit: 2, penaltyGold: 6 }
      },
      {
        id: 'cheat_rebound',
        name: '出千回弹',
        type: 'passive',
        cost: 4,
        effectType: 'save_consumable_chance',
        params: { chance: 0.25 }
      }
    ],
    economy: { tokenRewards: [5, 5, 6, 6, 7, 7, 8, 9] }
  });

  const dice = new DicePool({
    diceStream: rng.getStream('dice'),
    cloneStream: rng.getStream('clone'),
    minFace: 1,
    maxFace: 6,
    initialCount: 4,
    maxCount: 7
  });

  const enemy = new Enemy({
    dataConfig,
    enemyStream: rng.getStream('enemy')
  });
  const economy = new Economy({ dataConfig });
  const cheating = new CheatingAbilities({
    dataConfig,
    economy,
    cloneStream: rng.getStream('clone')
  });

  return new Combat({ dicePool: dice, dataConfig, enemy, cheating, economy, rng });
}

describe('新构筑流派与能力测试', () => {

  describe('奇偶交响乐流派', () => {
    it('奇数狂热 (odd_fanatic) - 奇数点数增加固定加分和最终倍率', () => {
      const combat = makeCombatSystem();
      combat._cheating.addPassive('odd_fanatic', 4);

      // 设置 3 个奇数骰子 (1, 3, 5) 和 1 个偶数骰子 (2) -> 共 3 个奇数
      combat.executeFirstRoll(1);
      combat._dice.setDie(0, 1);
      combat._dice.setDie(1, 3);
      combat._dice.setDie(2, 5);
      combat._dice.setDie(3, 2);

      const result = combat.executeHoldAndReroll([0, 1, 2, 3]); // 全部保留
      // 匹配为 bust，底分：1+3+5+2 = 11分
      // 奇数狂热 flat 加分：3 * 6 = 18
      // 最终乘数：1.0 + 3 * 0.05 = 1.15
      // 理论分数：Math.floor((11 + 18) * 1.15) = Math.floor(29 * 1.15) = 33分
      assert.strictEqual(result.flatBonus, 18);
      assert.ok(Math.abs(result.multiplier - 1.15) < 0.001);
      assert.strictEqual(result.score, 33);
    });

    it('偶数秩序 (even_order) - 全偶数点数时倍率提升', () => {
      const combat = makeCombatSystem();
      combat._cheating.addPassive('even_order', 4);

      // 设置全偶数 (2, 4, 6, 2)
      combat.executeFirstRoll(1);
      combat._dice.setDie(0, 2);
      combat._dice.setDie(1, 4);
      combat._dice.setDie(2, 6);
      combat._dice.setDie(3, 2);

      const result = combat.executeHoldAndReroll([0, 1, 2, 3]);
      // 匹配 pair (优先度高)，对2。底分：所有骰子总和 = 2+4+6+2 = 14
      // 最终乘数：1.8
      // 理论分数：Math.floor(14 * 1.8) = 25
      assert.ok(Math.abs(result.multiplier - 1.8) < 0.001);
      assert.strictEqual(result.score, 25);
    });

    it('微调戏法 (parity_shift) - 修改骰子使其奇偶反转', () => {
      const combat = makeCombatSystem();
      combat._cheating.addConsumable('parity_shift');

      combat.executeFirstRoll(1);
      combat._dice.setDie(0, 6);
      combat._dice.setDie(1, 1);
      combat._dice.setDie(2, 3);

      // 6 只能变 5
      combat.useConsumable(0, { targetIndex: 0, targetValue: 5 });
      assert.strictEqual(combat._dice.getValues()[0], 5);

      // 1 只能变 2
      combat._cheating.addConsumable('parity_shift');
      combat.useConsumable(0, { targetIndex: 1, targetValue: 2 });
      assert.strictEqual(combat._dice.getValues()[1], 2);

      // 3 默认 +1 变 4
      combat._cheating._usedThisRound = 0; // 重置本轮已使用消耗品数
      combat._cheating.addConsumable('parity_shift');
      combat.useConsumable(0, { targetIndex: 2 });
      assert.strictEqual(combat._dice.getValues()[2], 4);
    });
  });

  describe('赌徒的狂欢流派', () => {
    it('赌徒谬误 (gamblers_fallacy) - 每次重掷后最终倍率增加', () => {
      const combat = makeCombatSystem();
      combat._cheating.addPassive('gamblers_fallacy', 4);

      combat.executeFirstRoll(1);
      // 第一次投掷后重掷次数应为 0
      assert.strictEqual(combat._cheating.getRerollsCount(), 0);

      // 强制执行保留并重掷
      combat.executeHoldAndReroll([]);
      // 重掷次数应变为 1
      assert.strictEqual(combat._cheating.getRerollsCount(), 1);

      // 最终倍率计算：1.0 + 1 * 0.15 = 1.15
      const result = combat.finalizeResult();
      assert.ok(Math.abs(result.multiplier - 1.15) < 0.001);
    });

    it('命运左轮 (fate_roulette) - 重掷点数为6时倍率翻倍，为1时减半', () => {
      const combat = makeCombatSystem(999);
      combat.executeFirstRoll(1);

      let gotSix = false;
      let gotOne = false;

      for (let i = 0; i < 40; i++) {
        combat._cheating._consumableSlots = [];
        combat._cheating.addConsumable('fate_roulette');
        combat._cheating._roundMultiplier = 1.0;
        combat._cheating._usedThisRound = 0; // 重置已使用数以防受限

        combat.useConsumable(0, { targetIndex: 0 }); // 对第 0 颗骰子使用
        const newVal = combat._dice.getValues()[0];
        if (newVal === 6) {
          assert.strictEqual(combat._cheating._roundMultiplier, 2.0);
          gotSix = true;
        } else if (newVal === 1) {
          assert.strictEqual(combat._cheating._roundMultiplier, 0.5);
          gotOne = true;
        }
        if (gotSix && gotOne) break;
      }
      assert.ok(gotSix, '命运左轮成功投出过 6');
      assert.ok(gotOne, '命运左轮成功投出过 1');
    });
  });

  describe('极值与虚无流派', () => {
    it('否极泰来 (bottom_out) - 收集点数为1的加成，散牌下翻倍', () => {
      const combat = makeCombatSystem();
      combat._cheating.addPassive('bottom_out', 3);

      combat.executeFirstRoll(1);
      // 对子牌型：[1, 1, 2, 3] -> 2颗1，匹配对子
      combat._dice.setDie(0, 1);
      combat._dice.setDie(1, 1);
      combat._dice.setDie(2, 2);
      combat._dice.setDie(3, 3);

      let result = combat.executeHoldAndReroll([0, 1, 2, 3]);
      // 理论上 flatBonus = 2 * 12 = 24
      assert.strictEqual(result.flatBonus, 24);

      // 散牌牌型：[1, 1, 2, 4] -> dealer 封锁 pair
      // 我们用 round 3 (dealer 封锁对子) 来逼出 bust 散牌
      const combat2 = makeCombatSystem();
      combat2._cheating.addPassive('bottom_out', 3);
      combat2.executeFirstRoll(3);
      combat2._dice.setDie(0, 1);
      combat2._dice.setDie(1, 1);
      combat2._dice.setDie(2, 2);
      combat2._dice.setDie(3, 4);

      result = combat2.executeHoldAndReroll([0, 1, 2, 3]);
      // 匹配为 bust，底分：1+1+2+4 = 8
      // 由于是散牌（fallback），否极泰来加成翻倍：2 * 12 * 2 = 48
      assert.strictEqual(result.flatBonus, 48);
    });

    it('双极共鸣 (bipolar_resonance) - 全骰子只有1和6时倍率翻倍', () => {
      const combat = makeCombatSystem();
      combat._cheating.addPassive('bipolar_resonance', 5);

      combat.executeFirstRoll(1);
      // 设置 [1, 1, 6, 6] -> 成功触发
      combat._dice.setDie(0, 1);
      combat._dice.setDie(1, 1);
      combat._dice.setDie(2, 6);
      combat._dice.setDie(3, 6);

      let result = combat.executeHoldAndReroll([0, 1, 2, 3]);
      assert.strictEqual(result.multiplier, 2.0);

      // 设置 [1, 1, 1, 1] -> 不触发，因为没有6
      const combat2 = makeCombatSystem();
      combat2._cheating.addPassive('bipolar_resonance', 5);
      combat2.executeFirstRoll(1);
      combat2._dice.setDie(0, 1);
      combat2._dice.setDie(1, 1);
      combat2._dice.setDie(2, 1);
      combat2._dice.setDie(3, 1);
      result = combat2.executeHoldAndReroll([0, 1, 2, 3]);
      assert.strictEqual(result.multiplier, 1.0);
    });

    it('两极分化 (extremes_fission) - 中间态骰子转化为1或6', () => {
      const combat = makeCombatSystem();
      combat.executeFirstRoll(1);
      combat._cheating.addConsumable('extremes_fission');

      // 设置骰子为 [2, 3, 4, 5]
      combat._dice.setDie(0, 2);
      combat._dice.setDie(1, 3);
      combat._dice.setDie(2, 4);
      combat._dice.setDie(3, 5);

      combat.useConsumable(0);
      const values = combat._dice.getValues();
      // 所有值必须都是 1 或 6
      assert.ok(values.every(v => v === 1 || v === 6));
    });
  });

  describe('黑市与规则改写流派', () => {
    it('盲眼法官 (blind_judge) - 忽略敌方封锁、最低点归零、全面压制、被动封印', () => {
      // 测试 1: 忽略封锁对子 (Round 3 dealer)
      const combat1 = makeCombatSystem();
      combat1._cheating.addPassive('blind_judge', 5);
      combat1.executeFirstRoll(3); // dealer 封锁 pair
      combat1._dice.setDie(0, 3);
      combat1._dice.setDie(1, 3);
      combat1._dice.setDie(2, 4);
      combat1._dice.setDie(3, 5);
      let result = combat1.executeHoldAndReroll([0, 1, 2, 3]);
      // 由于盲眼法官，应该正常匹配对子
      assert.strictEqual(result.matchedCategory.id, 'pair');
      // 且自带 +15 分
      assert.strictEqual(result.flatBonus, 15);

      // 测试 2: 忽略最低点归零 (Round 4 croupier)
      const combat2 = makeCombatSystem();
      combat2._cheating.addPassive('blind_judge', 5);
      combat2.executeFirstRoll(4); // croupier 最低归零
      combat2._dice.setDie(0, 2);
      combat2._dice.setDie(1, 3);
      combat2._dice.setDie(2, 4);
      combat2._dice.setDie(3, 5);
      result = combat2.executeHoldAndReroll([0, 1, 2, 3]);
      // 应该没有被最低点扣分 (2没归零，底分 2+3+4+5=14)
      assert.strictEqual(result.adjustedBase, result.baseScore);

      // 测试 3: 忽略全面压制 (Round 7 underground_king)
      const combat3 = makeCombatSystem();
      combat3._cheating.addPassive('blind_judge', 5);
      combat3.executeFirstRoll(7); // underground_king 全面压制所有骰子-1
      const values = combat3._dice.getValues();
      // 因为忽略了全面压制，所以不应该全是1-5
      // 只要有一个骰子是6，证明全面压制被拦截了
      const hasSix = values.includes(6);
      assert.ok(hasSix, '应该拥有未被压制的 6 点骰子');

      // 测试 4: 忽略被动封印 (Round 6 manager 封印最贵被动)
      const combat4 = makeCombatSystem();
      combat4._cheating.addPassive('even_order', 4); // 4费用被动
      combat4._cheating.addPassive('blind_judge', 5); // 5费用，按规则经理要封印 blind_judge，但盲眼法官会拦截封印！
      combat4.executeFirstRoll(6);
      // 检查 blind_judge 是否被封印
      assert.ok(!combat4._cheating.isPassiveSealed('blind_judge'));
    });

    it('黑市交易 (black_market_deal) - 借贷消耗品并在结算时扣金币/自动清理', () => {
      const combat = makeCombatSystem();
      combat._economy._balance = 20; // 20 余额
      combat.executeFirstRoll(1);
      combat._cheating.addConsumable('black_market_deal');

      // 此时背包有 1 个消耗品
      assert.strictEqual(combat._cheating.getConsumables().length, 1);

      // 使用黑市交易
      combat.useConsumable(0);

      // 应当得到 3 个借贷的消耗品，加上出千回弹概率可能多留，但至少包含借贷物
      const slots = combat._cheating.getConsumables();
      const loaned = slots.filter(c => c.loaned);
      assert.strictEqual(loaned.length, 3);

      // 强制战斗获胜，赚 5 代币，理应 20+5 = 25 代币。但每个未用的借贷物罚 6 代币，3 个扣 18 代币，最终应为 7 代币。
      combat._dice.setDie(0, 6);
      combat._dice.setDie(1, 6);
      combat._dice.setDie(2, 6);
      combat._dice.setDie(3, 6);
      combat.executeHoldAndReroll([0, 1, 2, 3]);
      combat.finalizeResult(); // 调用结算处罚和清理

      assert.strictEqual(combat._economy.getBalance(), 7); // 20 + 5 - 18 = 7
      // 且战斗结束后，借贷消耗品被完全清空
      const slotsAfter = combat._cheating.getConsumables();
      assert.strictEqual(slotsAfter.filter(c => c.loaned).length, 0);
    });

    it('出千回弹 (cheat_rebound) - 使用消耗品有25%的概率保留', () => {
      const combat = makeCombatSystem(100); // 调整 seed 找到触发保留的情况
      combat.executeFirstRoll(1);
      
      // 使用多次来测试概率保留
      let savedCount = 0;
      for (let i = 0; i < 50; i++) {
        combat._cheating._consumableSlots = [];
        combat._cheating._passives = [];
        combat._cheating.addPassive('cheat_rebound', 4);
        combat._cheating.addConsumable('parity_shift');
        combat._cheating._usedThisRound = 0;

        combat.useConsumable(0, { targetIndex: 0 }); // 使用它
        if (combat._cheating.getConsumables().length === 1) {
          savedCount++;
        }
      }
      // 在 50 次使用里应该有成功触发过保留
      assert.ok(savedCount > 0, `应该发生过出千回弹保留 (实际保留了 ${savedCount} 次)`);
    });
  });
});
