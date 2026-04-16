'use strict';

/**
 * GameLog — 记录单局游戏的所有事件信息。
 *
 * 独立于其他游戏系统，提供语义化的日志方法和格式化输出。
 * 日志条目以中文输出，包含轮次前缀和详细的分数计算过程。
 */

/** 分类 ID → 中文名映射 */
const CATEGORY_NAMES = {
  'bust': '散牌',
  'pair': '对子',
  'three_of_a_kind': '三条',
  'small_straight': '小顺',
  'full_house': '满堂红',
  'large_straight': '大顺',
  'yahtzee': '豹子',
};

/** 日志条目类型 → CSS 类名 */
const ENTRY_TYPES = {
  system: 'log-system',
  roll: 'log-roll',
  recalc: 'log-roll',
  consumable: 'log-consumable',
  victory: 'log-victory',
  defeat: 'log-defeat',
  shop: 'log-shop',
};

class GameLog {
  constructor() {
    /** @type {Array<{text: string, type: string}>} */
    this._entries = [];
    /** @type {number} */
    this._round = 0;
  }

  /** 设置当前轮次（用于日志前缀） */
  setRound(round) {
    this._round = round;
  }

  /** 获取轮次前缀字符串 */
  _prefix() {
    return `[第${this._round}轮]`;
  }

  /** 获取分类中文名 */
  _catName(categoryId) {
    return CATEGORY_NAMES[categoryId] || categoryId;
  }

  /** 格式化分数计算过程 */
  _scoreBreakdown(baseScore, adjustedBase, flatBonus, multiplier, score) {
    const adj = adjustedBase !== baseScore ? `→调整${adjustedBase}` : '';
    return `基础${baseScore}${adj} + 加成${flatBonus} × 倍率${multiplier} = ${score}`;
  }

  // ---- 日志方法 ----

  /**
   * 记录游戏开始。
   * @param {number} seed
   */
  logGameStart(seed) {
    this._entries.push({
      text: `${this._prefix()} 游戏开始 | 种子: ${seed}`,
      type: 'system',
    });
  }

  /**
   * 记录投掷结果及分数计算过程。
   */
  logRoll(diceValues, categoryId, baseScore, adjustedBase, flatBonus, multiplier, score, targetScore) {
    const dice = `[${diceValues.join(',')}]`;
    const cat = this._catName(categoryId);
    const breakdown = this._scoreBreakdown(baseScore, adjustedBase, flatBonus, multiplier, score);
    this._entries.push({
      text: `${this._prefix()} 投掷 ${dice} → ${cat} | ${breakdown} | 目标 ${targetScore}`,
      type: 'roll',
    });
  }

  /**
   * 记录消耗品使用后的重算结果。
   */
  logRecalculation(diceValues, categoryId, baseScore, adjustedBase, flatBonus, multiplier, score, targetScore) {
    const dice = `[${diceValues.join(',')}]`;
    const cat = this._catName(categoryId);
    const breakdown = this._scoreBreakdown(baseScore, adjustedBase, flatBonus, multiplier, score);
    this._entries.push({
      text: `${this._prefix()} 重算 ${dice} → ${cat} | ${breakdown} | 目标 ${targetScore}`,
      type: 'recalc',
    });
  }

  /**
   * 记录消耗品使用。
   * @param {string} name - 消耗品名称
   * @param {string} effectMsg - 效果描述
   */
  logConsumableUse(name, effectMsg) {
    this._entries.push({
      text: `${this._prefix()} 使用「${name}」→ ${effectMsg}`,
      type: 'consumable',
    });
  }

  /**
   * 记录战斗结算结果。
   */
  logBattleResult(victory, score, targetScore, tokensEarned) {
    if (victory) {
      this._entries.push({
        text: `${this._prefix()} 胜利！${score} ≥ ${targetScore} | +${tokensEarned}代币`,
        type: 'victory',
      });
    } else {
      this._entries.push({
        text: `${this._prefix()} 失败。${score} < ${targetScore}`,
        type: 'defeat',
      });
    }
  }

  /**
   * 记录商店购买。
   * @param {string} name - 道具名称
   * @param {number} cost - 花费代币
   * @param {string} type - 道具类型 (consumable/passive/dice)
   */
  logShopPurchase(name, cost, type) {
    const typeLabel = type === 'consumable' ? '消耗品' : type === 'passive' ? '被动' : type === 'dice' ? '骰子扩展' : type;
    this._entries.push({
      text: `${this._prefix()} 商店购买「${name}」(${typeLabel}) -${cost}代币`,
      type: 'shop',
    });
  }

  /**
   * 记录商店刷新。
   * @param {number} cost - 刷新花费
   */
  logShopRefresh(cost) {
    this._entries.push({
      text: `${this._prefix()} 商店刷新 -${cost}代币`,
      type: 'shop',
    });
  }

  /**
   * 记录游戏结束。
   * @param {string} result - 'VICTORY' 或 'DEFEAT'
   * @param {number} round - 结束轮次
   */
  logGameEnd(result, round) {
    const label = result === 'VICTORY' ? '通关胜利' : '游戏失败';
    this._entries.push({
      text: `游戏结束 — ${label} | 第${round}轮`,
      type: result === 'VICTORY' ? 'victory' : 'defeat',
    });
  }

  // ---- 输出方法 ----

  /**
   * 获取所有日志条目文本。
   * @returns {string[]}
   */
  getEntries() {
    return this._entries.map(e => e.text);
  }

  /**
   * 渲染为 HTML（用于 UI 显示）。
   * @returns {string}
   */
  renderToHTML() {
    return this._entries.map(e => {
      const cls = ENTRY_TYPES[e.type] || 'log-system';
      return `<div class="log-entry ${cls}">${this._escapeHTML(e.text)}</div>`;
    }).join('');
  }

  /**
   * 导出为纯文本（用于文件下载）。
   * @returns {string}
   */
  exportAsText() {
    const header = `千王骰局 游戏日志 — ${new Date().toLocaleString('zh-CN')}\n${'='.repeat(50)}\n\n`;
    return header + this._entries.map(e => e.text).join('\n') + '\n';
  }

  /** 清除所有日志（新游戏时调用） */
  clear() {
    this._entries = [];
    this._round = 0;
  }

  /** HTML 转义 */
  _escapeHTML(str) {
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }
}

export { GameLog };
