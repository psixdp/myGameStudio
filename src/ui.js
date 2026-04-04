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
    this._selectedPassiveIndex = null;
    this._isRolling = false;
    this._pendingResult = null;  // 待确认的投掷结果

    // Target selection state
    this._isSelectingTarget = false;  // 是否正在选择骰子目标
    this._selectedDieIndex = null;    // 选中的骰子索引
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
      targetScoreDisplay: document.getElementById('target-score-display'),
      resultStatus: document.getElementById('result-status'),
      categoryName: document.getElementById('category-name'),

      // Inventory
      consumablesList: document.getElementById('consumables-list'),
      consumablePreview: document.getElementById('consumable-preview'),
      consumablePreviewName: document.getElementById('consumable-preview-name'),
      consumablePreviewDesc: document.getElementById('consumable-preview-desc'),
      consumablePreviewEffect: document.getElementById('consumable-preview-effect'),
      passivesList: document.getElementById('passives-list'),
      passivePreview: document.getElementById('passive-preview'),
      passivePreviewName: document.getElementById('passive-preview-name'),
      passivePreviewDesc: document.getElementById('passive-preview-desc'),

      // Actions
      btnRoll: document.getElementById('btn-roll'),
      btnConfirmResult: document.getElementById('btn-confirm-result'),
      btnUseConsumable: document.getElementById('btn-use-consumable'),

      // Shop
      shopOverlay: document.getElementById('shop-overlay'),
      shopTokens: document.getElementById('shop-tokens'),
      shopItems: document.getElementById('shop-items'),
      nextEnemyPreview: document.getElementById('next-enemy-preview'),
      nextEnemyName: document.getElementById('next-enemy-name'),
      nextEnemyTarget: document.getElementById('next-enemy-target'),
      nextEnemyRules: document.getElementById('next-enemy-rules'),
      btnRefreshShop: document.getElementById('btn-refresh-shop'),
      btnCloseShop: document.getElementById('btn-close-shop'),

      // Game Over
      gameoverOverlay: document.getElementById('gameover-overlay'),
      gameoverContent: document.querySelector('.gameover-content'),
      gameoverTitle: document.getElementById('gameover-title'),
      finalRound: document.getElementById('final-round'),
      finalScore: document.getElementById('final-score'),
      enemiesDefeated: document.getElementById('enemies-defeated'),
      totalTokens: document.getElementById('total-tokens'),
      gameoverMessage: document.getElementById('gameover-message'),
      btnRestart: document.getElementById('btn-restart'),
    };
  }

  /** 绑定事件处理器 */
  _bindEvents() {
    this._elements.btnRoll.addEventListener('click', () => this._onRoll());
    this._elements.btnConfirmResult.addEventListener('click', () => this._onConfirmResult());
    this._elements.btnUseConsumable.addEventListener('click', () => this._onUseConsumable());
    this._elements.btnRefreshShop.addEventListener('click', () => this._onRefreshShop());
    this._elements.btnCloseShop.addEventListener('click', () => this._onCloseShop());
    this._elements.btnRestart.addEventListener('click', () => this._onRestart());
  }

  /** ==================== 渲染主入口 ==================== */
  _render() {
    const state = this._gameFlow.getState();

    // 清理选择模式（如果不在 ROLL_RESULT 状态）
    if (state !== GameState.ROLL_RESULT) {
      this._isSelectingTarget = false;
      this._selectedDieIndex = null;
    }

    switch (state) {
      case GameState.BATTLE:
        this._renderBattle();
        break;
      case GameState.ROLL_RESULT:
        // 投掷后、确认前：显示分数对比和可使用消耗品
        this._renderRollResult();
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

  /** ==================== 渲染投掷结果（分数对比阶段） ==================== */
  _renderRollResult() {
    const result = this._pendingRollResult;
    if (!result) return;

    const round = this._gameFlow.getCurrentRound();
    const total = this._gameFlow.getTotalRounds();
    const economy = this._gameFlow.getEconomy();
    const enemy = this._gameFlow.getEnemy();

    // 顶部信息
    this._elements.roundDisplay.innerHTML = `Round <strong>${round}</strong>/${total}`;
    this._elements.tokensDisplay.innerHTML = `Tokens: <strong>${economy.getBalance()}</strong>`;

    // 敌人信息
    this._elements.enemyName.textContent = enemy.getName();
    this._elements.targetScore.textContent = enemy.getTargetScore();
    this._renderEnemyRules(enemy);

    // 骰子（显示投掷后的结果）
    this._renderDice(result.dice);

    // 分数对比（显示提示信息）
    this._elements.currentScore.textContent = result.adjustedBase;
    this._elements.targetScoreDisplay.textContent = result.targetScore;

    const gap = result.targetScore - result.adjustedBase;
    if (gap > 0) {
      this._elements.resultStatus.innerHTML = `⚠️ 还差 ${gap} 分 - 可使用消耗品改写骰子`;
      this._elements.resultStatus.className = 'result-status warning';
    } else {
      this._elements.resultStatus.innerHTML = `✓ 分数已达标！`;
      this._elements.resultStatus.className = 'result-status success';
    }

    this._elements.categoryName.textContent = this._getCategoryDisplayName(result.matchedCategory.id);

    // 消耗品和被动
    const cheating = this._gameFlow.getCheating();
    this._renderConsumables(cheating.getConsumables());
    this._renderPassives(cheating.getPassives());

    // 隐藏遮罩
    this._elements.shopOverlay.classList.add('hidden');
    this._elements.gameoverOverlay.classList.add('hidden');
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

    // 分数显示
    const combat = this._gameFlow.getCombat();
    const result = combat.getResult();

    if (result && !this._resultConfirmed) {
      // 投掷完成但未确认：只显示分数对比，不显示胜负
      this._elements.currentScore.textContent = result.score;
      this._elements.targetScoreDisplay.textContent = result.targetScore;
      this._elements.resultStatus.textContent = '';  // 暂不显示胜负
      this._elements.resultStatus.className = 'result-status';
      this._elements.categoryName.textContent = this._getCategoryDisplayName(result.matchedCategory);
    } else if (result && this._resultConfirmed) {
      // 已确认：显示胜负结果，然后进入下一阶段
      this._elements.currentScore.textContent = result.score;
      this._elements.targetScoreDisplay.textContent = result.targetScore;

      const statusEl = this._elements.resultStatus;
      if (result.victory) {
        statusEl.innerHTML = `✓ 胜利！<span class="result-tokens">+${result.tokensEarned} 代币</span>`;
        statusEl.className = 'result-status success';
      } else {
        const needed = Math.max(0, result.targetScore - result.score);
        statusEl.textContent = `✗ 失败！需要 ${needed} 分`;
        statusEl.className = 'result-status failure';
      }

      this._elements.categoryName.textContent = this._getCategoryDisplayName(result.matchedCategory);

      // 结果已确认，进入下一阶段（商店或游戏结束）
      // 这里不重新渲染，让玩家看到结果
      // 下次点击任意按钮或稍后会自动进入下一阶段
    } else {
      // 未投掷
      this._elements.currentScore.textContent = '0';
      this._elements.targetScoreDisplay.textContent = enemy.getTargetScore();
      this._elements.resultStatus.textContent = '';
      this._elements.resultStatus.className = 'result-status';
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

    for (let i = 0; i < dice.length; i++) {
      const d = dice[i];
      const die = document.createElement('div');
      die.className = 'die';
      if (d.isTemp) die.classList.add('temp');

      // 添加可选择样式
      if (this._isSelectingTarget) {
        die.classList.add('selectable');
        die.addEventListener('click', () => this._onSelectDie(i));
      }

      // 添加已选中样式
      if (this._selectedDieIndex === i) {
        die.classList.add('selected');
      }

      die.textContent = d.value;
      this._elements.diceContainer.appendChild(die);
    }
  }

  /** 渲染消耗品 */
  _renderConsumables(consumables) {
    this._elements.consumablesList.innerHTML = '';

    if (consumables.length === 0) {
      this._elements.consumablesList.innerHTML = '<span style="color:#666;font-style:italic;">（空）</span>';
      this._elements.consumablePreview.classList.add('hidden');
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

    // 渲染选中消耗品的预览
    this._renderConsumablePreview(consumables);
  }

  /** 渲染选中消耗品的预览 */
  _renderConsumablePreview(consumables) {
    if (this._selectedConsumableIndex === null || this._selectedConsumableIndex >= consumables.length) {
      this._elements.consumablePreview.classList.add('hidden');
      return;
    }

    const item = consumables[this._selectedConsumableIndex];
    this._elements.consumablePreview.classList.remove('hidden');
    this._elements.consumablePreviewName.textContent = item.name;
    this._elements.consumablePreviewDesc.textContent = item.description;

    // 显示效果预览
    let effectText = '';
    if (item.tags && item.tags.includes('targeted')) {
      effectText = '🎯 需要选择目标骰子';
    } else if (item.tags && item.tags.includes('universal')) {
      effectText = '🎯 需要选择目标骰子（将设为6点）';
    } else if (item.tags && item.tags.includes('information')) {
      effectText = 'ℹ️ 查看信息';
    } else if (item.tags && item.tags.includes('reroll')) {
      effectText = '🔄 重新投掷全部骰子';
    }

    this._elements.consumablePreviewEffect.textContent = effectText;
  }

  /** 渲染被动能力 */
  _renderPassives(passives) {
    this._elements.passivesList.innerHTML = '';

    if (passives.length === 0) {
      this._elements.passivesList.innerHTML = '<span style="color:#666;font-style:italic;">（空）</span>';
      this._elements.passivePreview?.classList.add('hidden');
      return;
    }

    passives.forEach((p, index) => {
      const card = document.createElement('div');
      card.className = 'item-card';
      if (index === this._selectedPassiveIndex) {
        card.classList.add('selected');
      }
      card.innerHTML = `<span>${p.name}</span>`;
      card.addEventListener('click', () => this._onSelectPassive(index));
      this._elements.passivesList.appendChild(card);
    });

    // 渲染选中被动能力的预览
    this._renderPassivePreview(passives);
  }

  /** 选择被动能力 */
  _onSelectPassive(index) {
    this._selectedPassiveIndex = index;
    this._renderPassives(this._gameFlow.getCheating().getPassives());
  }

  /** 渲染选中被动能力的预览 */
  _renderPassivePreview(passives) {
    if (this._selectedPassiveIndex === null || this._selectedPassiveIndex >= passives.length) {
      this._elements.passivePreview?.classList.add('hidden');
      return;
    }

    const item = passives[this._selectedPassiveIndex];
    this._elements.passivePreview.classList.remove('hidden');
    this._elements.passivePreviewName.textContent = item.name;
    this._elements.passivePreviewDesc.textContent = item.description;
  }

  /** ==================== 商店渲染 ==================== */
  _renderShop() {
    const shop = this._gameFlow.getShop();
    const economy = this._gameFlow.getEconomy();

    // 显示代币
    this._elements.shopTokens.innerHTML = `Tokens: <strong>${economy.getBalance()}</strong>`;

    // 渲染下一关敌人预览
    const enemyPreview = shop.getNextEnemyPreview();
    if (enemyPreview) {
      this._elements.nextEnemyPreview.classList.remove('hidden');
      this._elements.nextEnemyName.textContent = enemyPreview.name;
      this._elements.nextEnemyTarget.textContent = `目标: ${enemyPreview.targetScore}`;

      // 渲染敌人规则
      if (enemyPreview.rules && enemyPreview.rules.length > 0) {
        this._elements.nextEnemyRules.innerHTML = enemyPreview.rules
          .map(r => `<div>⚠️ ${r.name}: ${r.description}</div>`)
          .join('');
      } else {
        this._elements.nextEnemyRules.textContent = '';
      }
    } else {
      // No next round (final round complete)
      this._elements.nextEnemyPreview.classList.add('hidden');
    }

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

    // 统计信息
    const enemiesDefeated = result.result === 'VICTORY' ? 8 : (result.round - 1);
    this._elements.enemiesDefeated.textContent = enemiesDefeated;
    this._elements.totalTokens.textContent = this._gameFlow.getEconomy().getBalance();

    this._elements.gameoverOverlay.classList.remove('hidden');
    this._elements.shopOverlay.classList.add('hidden');
  }

  /** ==================== 更新按钮状态 ==================== */
  _updateButtons() {
    const state = this._gameFlow.getState();
    const cheating = this._gameFlow.getCheating();

    // ROLL_RESULT 状态：显示动态按钮，允许使用消耗品
    if (state === GameState.ROLL_RESULT) {
      this._elements.btnRoll.disabled = true;
      this._elements.btnConfirmResult.classList.remove('hidden');

      // 根据分数动态调整按钮文本和样式
      const result = this._pendingRollResult;
      if (result) {
        const isWinning = result.adjustedBase >= result.targetScore;
        if (isWinning) {
          this._elements.btnConfirmResult.textContent = '🎉 进入商店';
          this._elements.btnConfirmResult.className = 'btn-confirm btn-success';
        } else {
          this._elements.btnConfirmResult.textContent = '🏳️ 认输';
          this._elements.btnConfirmResult.className = 'btn-confirm btn-danger';
        }
      }

      this._elements.btnUseConsumable.disabled =
        !cheating.canUseConsumable() ||
        cheating.getConsumables().length === 0 ||
        this._selectedConsumableIndex === null;
      return;
    }

    // 正常状态的按钮逻辑
    this._elements.btnConfirmResult.classList.add('hidden');
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
    diceElements.forEach(d => d => d.classList.add('rolling'));

    // 等待动画完成
    await new Promise(resolve => setTimeout(resolve, 500));

    diceElements.forEach(d => d.classList.remove('rolling'));

    // Phase 1: 执行投掷阶段（不判定胜负）
    const rollResult = this._gameFlow.executeRollPhase();

    // 存储投掷结果用于显示（此时还未判定胜负）
    this._pendingRollResult = rollResult;
    this._isRolling = false;
    this._render();  // 将显示分数对比和可使用消耗品
  }

  /** 确认结果 - 进入最终结算 */
  _onConfirmResult() {
    // Phase 2: 通过 GameFlow 完成最终结算并转换状态
    this._gameFlow.finalizeBattle();

    this._pendingRollResult = null;  // 清除投掷结果
    this._render();  // 渲染下一阶段（商店/游戏结束）
  }

  _onSelectConsumable(index) {
    const cheating = this._gameFlow.getCheating();
    const consumables = cheating.getConsumables();

    // 退出选择模式
    this._isSelectingTarget = false;
    this._selectedDieIndex = null;

    this._selectedConsumableIndex = index;
    this._renderConsumables(consumables);

    // 检查是否是需要选择目标的消耗品
    const selected = consumables[index];
    const needsTarget = selected && selected.tags &&
      (selected.tags.includes('targeted') || selected.tags.includes('universal'));

    if (needsTarget) {
      this._isSelectingTarget = true;
      this._showToast(`${selected.name}: 请点击选择一个骰子`);
    }

    this._render();
    this._updateButtons();
  }

  /** 选择骰子作为目标 */
  _onSelectDie(dieIndex) {
    if (!this._isSelectingTarget) return;

    this._selectedDieIndex = dieIndex;
    this._render();

    const cheating = this._gameFlow.getCheating();
    const consumables = cheating.getConsumables();
    const selected = consumables[this._selectedConsumableIndex];

    // 显示选中提示，等待点击"使用消耗品"按钮
    const dice = this._gameFlow.getDicePool().getDice();
    const diceValue = dice[dieIndex].value;
    this._showToast(`已选择骰子 ${diceValue}，请点击"使用消耗品"确认`);
  }

  _onUseConsumable() {
    if (this._selectedConsumableIndex === null) return;

    const cheating = this._gameFlow.getCheating();
    const consumables = cheating.getConsumables();
    const selectedConsumable = consumables[this._selectedConsumableIndex];

    // 检查是否需要选择目标
    const isTargeted = selectedConsumable.tags && selectedConsumable.tags.includes('targeted');

    if (isTargeted && this._selectedDieIndex === null) {
      this._showToast('请先选择一个骰子');
      return;
    }

    const ability = cheating.useConsumable(this._selectedConsumableIndex);

    if (ability) {
      // 应用消耗品效果
      const dicePool = this._gameFlow.getDicePool();
      const dice = dicePool.getDice();

      let effectMessage = `使用了 ${ability.name}`;

      switch (ability.effectType) {
        case 'set_dice_value':
          // 换面：使用选中的骰子，设为最大值
          const targetIndex = this._selectedDieIndex ?? 0;
          dicePool.setDie(targetIndex, ability.params.max);
          effectMessage = `换面：骰子设为 ${ability.params.max}`;
          break;
        case 'reroll_min':
          // 加料：使用选中的骰子
          const rerollIndex = this._selectedDieIndex ?? 0;
          dicePool.rerollDie(rerollIndex, ability.params.minValue);
          effectMessage = `加料：重掷骰子（最小${ability.params.minValue}）`;
          break;
        case 'replace_lowest':
          // 偷梁换柱：自动替换最低骰子（不需要选择）
          dicePool.replaceLowest(ability.params.value);
          effectMessage = `偷梁换柱：最低骰子变为 ${ability.params.value}`;
          break;
        case 'extra_roll':
          dicePool.roll();
          const clonePassive = cheating.getPassiveByEffect('clone_dice');
          if (clonePassive) dicePool.addTempDie();
          effectMessage = `双投：重新投掷全部骰子`;
          break;
        case 'reveal_weakness':
          effectMessage = `透视：已显示弱点分类`;
          break;
      }

      this._showToast(effectMessage);

      // 重置选择状态
      this._selectedConsumableIndex = null;
      this._selectedDieIndex = null;
      this._isSelectingTarget = false;
      this._render();
    }
  }

  _onBuyShopItem(index) {
    const shop = this._gameFlow.getShop();
    const items = shop.getDisplayItems();
    const item = items[index];

    if (!item) {
      this._showToast('物品已售罄');
      return;
    }

    const economy = this._gameFlow.getEconomy();

    if (shop.buy(index)) {
      this._showToast(`购买成功：${item.name}`);
      this._renderShop();
    } else {
      if (economy.getBalance() < item.cost) {
        this._showToast('代币不足！');
      } else {
        this._showToast('购买失败');
      }
    }
  }

  _onRefreshShop() {
    const shop = this._gameFlow.getShop();
    if (shop.refresh()) {
      this._showToast('商店已刷新');
      this._renderShop();
    } else {
      this._showToast('代币不足，无法刷新');
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
  /**
   * 显示 Toast 浮动提示
   * @param {string} message - 提示消息
   * @param {number} duration - 显示时长（毫秒），默认 2500
   */
  _showToast(message, duration = 2500) {
    const toast = document.createElement('div');
    toast.className = 'toast';
    toast.textContent = message;
    document.body.appendChild(toast);

    setTimeout(() => {
      if (toast.parentElement) {
        toast.remove();
      }
    }, duration);
  }

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
