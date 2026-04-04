'use strict';

import { GameFlow, GameState } from './game-flow.js';

/**
 * GameUI — 连接 GameFlow 和 DOM 的 UI 控制器
 *
 * 负责：
 * - 绑定事件处理器
 * - 渲染游戏状态到 DOM
 * - 处理用户输入并调用 GameFlow 方法
 */
class GameUI {
  constructor() {
    this._gameFlow = null;
    this._elements = {};
    this._selectedConsumableIndex = null;
    this._isRolling = false;
  }

  /**
   * 初始化：加载资源、创建 GameFlow、绑定事件
   */
  async init() {
    this._cacheElements();
    this._bindEvents();

    this._gameFlow = new GameFlow({ dataDir: 'assets/data' });
    const loaded = await this._gameFlow.load();
    if (!loaded) {
      throw new Error('Failed to load game data');
    }

    this._gameFlow.newGame();
    this._render();
  }

  /** 缓存 DOM 元素引用 */
  _cacheElements() {
    this._elements = {
      // Header
      roundDisplay: document.getElementById('round-display'),
      tokensDisplay: document.getElementById('tokens-display'),

      // Enemy
      enemyName: document.getElementById('enemy-name'),
      targetScore: document.getElementById('target-score'),
      enemyRules: document.getElementById('enemy-rules'),

      // Battle
      diceContainer: document.getElementById('dice-container'),
      currentScore: document.getElementById('current-score'),
      categoryName: document.getElementById('category-name'),

      // Inventory
      consumablesList: document.getElementById('consumables-list'),
      passivesList: document.getElementById('passives-list'),

      // Actions
      btnRoll: document.getElementById('btn-roll'),
      btnUseConsumable: document.getElementById('btn-use-consumable'),

      // Shop
      shopOverlay: document.getElementById('shop-overlay'),
      shopTokens: document.getElementById('shop-tokens'),
      shopItems: document.getElementById('shop-items'),
      btnRefreshShop: document.getElementById('btn-refresh-shop'),
      btnCloseShop: document.getElementById('btn-close-shop'),

      // Game Over
      gameoverOverlay: document.getElementById('gameover-overlay'),
      gameoverContent: document.querySelector('.gameover-content'),
      gameoverTitle: document.getElementById('gameover-title'),
      finalRound: document.getElementById('final-round'),
      finalScore: document.getElementById('final-score'),
      gameoverMessage: document.getElementById('gameover-message'),
      btnRestart: document.getElementById('btn-restart'),
    };
  }

  /** 绑定事件处理器 */
  _bindEvents() {
    this._elements.btnRoll.addEventListener('click', () => this._onRoll());
    this._elements.btnUseConsumable.addEventListener('click', () => this._onUseConsumable());
    this._elements.btnRefreshShop.addEventListener('click', () => this._onRefreshShop());
    this._elements.btnCloseShop.addEventListener('click', () => this._onCloseShop());
    this._elements.btnRestart.addEventListener('click', () => this._onRestart());
  }

  /** ==================== 渲染主入口 ==================== */
  _render() {
    const state = this._gameFlow.getState();

    switch (state) {
      case GameState.BATTLE:
        this._renderBattle();
        break;
      case GameState.SHOP:
        this._renderShop();
        break;
      case GameState.VICTORY:
      case GameState.DEFEAT:
        this._renderGameOver();
        break;
    }

    this._updateButtons();
  }

  /** ==================== 战斗状态渲染 ==================== */
  _renderBattle() {
    const round = this._gameFlow.getCurrentRound();
    const total = this._gameFlow.getTotalRounds();
    const economy = this._gameFlow.getEconomy();
    const enemy = this._gameFlow.getEnemy();
    const cheating = this._gameFlow.getCheating();
    const dicePool = this._gameFlow.getDicePool();

    // 顶部信息
    this._elements.roundDisplay.innerHTML = `Round <strong>${round}</strong>/${total}`;
    this._elements.tokensDisplay.innerHTML = `Tokens: <strong>${economy.getBalance()}</strong>`;

    // 敌人信息
    this._elements.enemyName.textContent = enemy.getName();
    this._elements.targetScore.textContent = enemy.getTargetScore();
    this._renderEnemyRules(enemy);

    // 骰子
    this._renderDice(dicePool.getDice());

    // 分数（战斗后显示）
    const combat = this._gameFlow.getCombat();
    const result = combat.getResult();
    if (result) {
      this._elements.currentScore.textContent = result.score;
      this._elements.categoryName.textContent = this._getCategoryDisplayName(result.matchedCategory);
    } else {
      this._elements.currentScore.textContent = '0';
      this._elements.categoryName.textContent = '准备投掷';
    }

    // 消耗品和被动
    this._renderConsumables(cheating.getConsumables());
    this._renderPassives(cheating.getPassives());

    // 隐藏遮罩
    this._elements.shopOverlay.classList.add('hidden');
    this._elements.gameoverOverlay.classList.add('hidden');
  }

  /** 渲染敌人规则 */
  _renderEnemyRules(enemy) {
    const rules = enemy.getRules();
    if (rules.length === 0) {
      this._elements.enemyRules.textContent = '';
      this._elements.enemyRules.classList.add('hidden');
      return;
    }

    this._elements.enemyRules.classList.remove('hidden');
    this._elements.enemyRules.innerHTML = rules
      .map(r => `<div>⚠️ ${r.name}: ${r.description}</div>`)
      .join('');
  }

  /** 渲染骰子 */
  _renderDice(dice) {
    this._elements.diceContainer.innerHTML = '';

    for (const d of dice) {
      const die = document.createElement('div');
      die.className = 'die';
      if (d.isTemp) die.classList.add('temp');
      die.textContent = d.value;
      this._elements.diceContainer.appendChild(die);
    }
  }

  /** 渲染消耗品 */
  _renderConsumables(consumables) {
    this._elements.consumablesList.innerHTML = '';
    this._selectedConsumableIndex = null;

    if (consumables.length === 0) {
      this._elements.consumablesList.innerHTML = '<span style="color:#666;font-style:italic;">（空）</span>';
      return;
    }

    consumables.forEach((item, index) => {
      const card = document.createElement('div');
      card.className = 'item-card';
      if (index === this._selectedConsumableIndex) {
        card.classList.add('selected');
      }
      card.innerHTML = `<span>${item.name}</span> <span class="cost">×${item.cost || 1}</span>`;
      card.addEventListener('click', () => this._onSelectConsumable(index));
      this._elements.consumablesList.appendChild(card);
    });
  }

  /** 渲染被动能力 */
  _renderPassives(passives) {
    this._elements.passivesList.innerHTML = '';

    if (passives.length === 0) {
      this._elements.passivesList.innerHTML = '<span style="color:#666;font-style:italic;">（空）</span>';
      return;
    }

    passives.forEach(p => {
      const card = document.createElement('div');
      card.className = 'item-card';
      card.innerHTML = `<span>${p.name}</span>`;
      this._elements.passivesList.appendChild(card);
    });
  }

  /** ==================== 商店渲染 ==================== */
  _renderShop() {
    const shop = this._gameFlow.getShop();
    const economy = this._gameFlow.getEconomy();

    // 显示代币
    this._elements.shopTokens.innerHTML = `Tokens: <strong>${economy.getBalance()}</strong>`;

    // 渲染商店物品
    const items = shop.getDisplayItems();
    this._elements.shopItems.innerHTML = '';

    if (items.length === 0) {
      this._elements.shopItems.innerHTML = '<p style="text-align:center;color:#666;">已售罄</p>';
    } else {
      items.forEach((item, index) => {
        if (item === null) return; // 已售出的槽位

        const div = document.createElement('div');
        div.className = 'shop-item';
        div.innerHTML = `
          <div class="shop-item-info">
            <div class="shop-item-name">${item.name}</div>
            <div class="shop-item-desc">${item.description}</div>
          </div>
          <div class="shop-item-cost">${item.cost}代币</div>
        `;
        div.addEventListener('click', () => this._onBuyShopItem(index));
        this._elements.shopItems.appendChild(div);
      });
    }

    // 显示遮罩
    this._elements.shopOverlay.classList.remove('hidden');
    this._elements.gameoverOverlay.classList.add('hidden');

    // 更新刷新按钮状态
    this._elements.btnRefreshShop.disabled = !shop.canRefresh();
  }

  /** ==================== 游戏结束渲染 ==================== */
  _renderGameOver() {
    const result = this._gameFlow.getResult();
    if (!result) return;

    if (result.result === 'VICTORY') {
      this._elements.gameoverContent.classList.remove('defeat');
      this._elements.gameoverContent.classList.add('victory');
      this._elements.gameoverTitle.textContent = '🎉 胜利！';
      this._elements.gameoverMessage.textContent = '恭喜你击败了所有敌人，成为真正的千王之王！';
    } else {
      this._elements.gameoverContent.classList.remove('victory');
      this._elements.gameoverContent.classList.add('defeat');
      this._elements.gameoverTitle.textContent = '💀 失败';
      if (result.surrendered) {
        this._elements.gameoverMessage.textContent = '你选择了投降。下次继续挑战！';
      } else {
        this._elements.gameoverMessage.textContent = '很遗憾，你的分数未能达到目标。再试一次吧！';
      }
    }

    this._elements.finalRound.textContent = result.round;
    this._elements.finalScore.textContent = result.score || 0;

    this._elements.gameoverOverlay.classList.remove('hidden');
    this._elements.shopOverlay.classList.add('hidden');
  }

  /** ==================== 更新按钮状态 ==================== */
  _updateButtons() {
    const state = this._gameFlow.getState();
    const cheating = this._gameFlow.getCheating();

    this._elements.btnRoll.disabled = (state !== GameState.BATTLE) || this._isRolling;
    this._elements.btnUseConsumable.disabled =
      (state !== GameState.BATTLE) ||
      !cheating.canUseConsumable() ||
      cheating.getConsumables().length === 0 ||
      this._selectedConsumableIndex === null;
  }

  /** ==================== 事件处理 ==================== */
  async _onRoll() {
    if (this._isRolling) return;

    this._isRolling = true;
    this._updateButtons();

    // 骰子滚动动画
    const diceElements = this._elements.diceContainer.querySelectorAll('.die');
    diceElements.forEach(d => d.classList.add('rolling'));

    // 等待动画完成
    await new Promise(resolve => setTimeout(resolve, 500));

    diceElements.forEach(d => d.classList.remove('rolling'));

    // 执行战斗
    this._gameFlow.executeBattle();
    this._isRolling = false;
    this._render();
  }

  _onSelectConsumable(index) {
    this._selectedConsumableIndex = index;
    this._renderConsumables(this._gameFlow.getCheating().getConsumables());
    this._updateButtons();
  }

  _onUseConsumable() {
    if (this._selectedConsumableIndex === null) return;

    const cheating = this._gameFlow.getCheating();
    const ability = cheating.useConsumable(this._selectedConsumableIndex);

    if (ability) {
      // 应用消耗品效果（简化版：直接修改第一个骰子或执行效果）
      const dicePool = this._gameFlow.getDicePool();
      const dice = dicePool.getDice();

      switch (ability.effectType) {
        case 'set_dice_value':
          // 设置第一个骰子为最大值
          dicePool.setDie(0, ability.params.max);
          break;
        case 'reroll_min':
          dicePool.rerollDie(0, ability.params.minValue);
          break;
        case 'replace_lowest':
          dicePool.replaceLowest(ability.params.value);
          break;
        case 'extra_roll':
          dicePool.roll();
          const clonePassive = cheating.getPassiveByEffect('clone_dice');
          if (clonePassive) dicePool.addTempDie();
          break;
      }

      this._selectedConsumableIndex = null;
      this._render();
    }
  }

  _onBuyShopItem(index) {
    const shop = this._gameFlow.getShop();
    if (shop.buy(index)) {
      this._renderShop();
    }
  }

  _onRefreshShop() {
    const shop = this._gameFlow.getShop();
    if (shop.refresh()) {
      this._renderShop();
    }
  }

  _onCloseShop() {
    this._gameFlow.closeShop();
    this._render();
  }

  _onRestart() {
    this._gameFlow.newGame();
    this._isRolling = false;
    this._selectedConsumableIndex = null;
    this._render();
  }

  /** ==================== 辅助方法 ==================== */
  _getCategoryDisplayName(categoryId) {
    const names = {
      'bust': '散牌',
      'pair': '对子',
      'three_of_a_kind': '三条',
      'small_straight': '小顺',
      'full_house': '满堂红',
      'large_straight': '大顺',
      'yahtzee': '豹子',
    };
    return names[categoryId] || categoryId;
  }
}

export { GameUI };
