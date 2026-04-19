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
    this._pendingRollResult = null;  // 待确认的投掷结果
    this._activeDetail = null;  // 当前打开的详情 { type, index }

    // Target selection state
    this._isSelectingTarget = false;  // 是否正在选择骰子目标
    this._selectedDieIndex = null;    // 选中的骰子索引
    this._selectedDieIndex2 = null;   // 第二个选中的骰子索引（用于换位）
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
      weaknessDisplay: document.getElementById('weakness-display'),
      weaknessCategory: document.getElementById('weakness-category'),
      enemyRules: document.getElementById('enemy-rules'),
      decreeOverrideDisplay: document.getElementById('decree-override-display'),

      // Battle
      diceContainer: document.getElementById('dice-container'),
      diceBowl: document.getElementById('dice-bowl'),
      bowlStatusText: document.getElementById('bowl-status-text'),
      currentScore: document.getElementById('current-score'),
      targetScoreDisplay: document.getElementById('target-score-display'),
      resultStatus: document.getElementById('result-status'),
      categoryName: document.getElementById('category-name'),

      // Inventory
      consumablesList: document.getElementById('consumables-list'),
      passivesList: document.getElementById('passives-list'),

      // Detail overlay
      detailOverlay: document.getElementById('detail-overlay'),
      detailPanel: document.getElementById('detail-panel'),
      btnCloseDetail: document.getElementById('btn-close-detail'),
      detailTitle: document.getElementById('detail-title'),
      detailSubtitle: document.getElementById('detail-subtitle'),
      detailDescription: document.getElementById('detail-description'),
      detailEffect: document.getElementById('detail-effect'),

      // Value picker (face change)
      valuePickerOverlay: document.getElementById('value-picker-overlay'),
      valuePickerButtons: document.getElementById('value-picker-buttons'),

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

      // Scoring Rules
      btnScoringRules: document.getElementById('btn-scoring-rules'),
      scoringRulesOverlay: document.getElementById('scoring-rules-overlay'),
      btnCloseScoringRules: document.getElementById('btn-close-scoring-rules'),
      scoringDiceValues: document.getElementById('scoring-dice-values'),
      scoringPassives: document.getElementById('scoring-passives'),
      scoringTableBody: document.getElementById('scoring-table-body'),
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
    this._elements.btnScoringRules.addEventListener('click', () => this._onShowScoringRules());
    this._elements.btnCloseScoringRules.addEventListener('click', () => this._onCloseScoringRules());
    this._elements.btnCloseDetail.addEventListener('click', () => this._closeDetail());
    this._elements.detailOverlay.addEventListener('click', (e) => {
      if (e.target === this._elements.detailOverlay) this._closeDetail();
    });
    document.addEventListener('keydown', (e) => this._onGlobalKeydown(e));

    // Value picker
    this._pendingFaceChange = null; // { dieIndex, ability }
    this._elements.valuePickerOverlay.addEventListener('click', (e) => {
      if (e.target === this._elements.valuePickerOverlay) this._hideValuePicker();
    });
    document.getElementById('btn-cancel-picker').addEventListener('click', () => this._hideValuePicker());
  }

  /** ==================== 渲染主入口 ==================== */
  async _render() {
    const state = this._gameFlow.getState();

    if (state === GameState.SHOP || state === GameState.VICTORY || state === GameState.DEFEAT) {
      this._closeDetail();
    }

    // 清理选择模式（如果不在投掷后中间状态）
    if (!this._isPostRollState(state)) {
      this._isSelectingTarget = false;
      this._selectedDieIndex = null;
      this._selectedDieIndex2 = null;
      this._elements.diceBowl.classList.add('hidden');
      this._elements.diceBowl.classList.remove('covered', 'revealing');
    }

    switch (state) {
      case GameState.BATTLE:
        this._renderBattle();
        break;
      case GameState.BOWL_COVERED:
      case GameState.ROLL_RESULT:
        // 投掷后、确认前：显示分数对比和可使用消耗品
        await this._renderRollResult();
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
  async _renderRollResult() {
    const result = this._pendingRollResult;
    if (!result) return;

    const round = this._gameFlow.getCurrentRound();
    const total = this._gameFlow.getTotalRounds();
    const economy = this._gameFlow.getEconomy();
    const enemy = this._gameFlow.getEnemy();
    const cheating = this._gameFlow.getCheating();

    // 顶部信息
    this._elements.roundDisplay.innerHTML = `Round <strong>${round}</strong>/${total}`;
    this._elements.tokensDisplay.innerHTML = `Tokens: <strong>${economy.getBalance()}</strong>`;

    // 敌人信息
    this._elements.enemyName.textContent = enemy.getName();
    this._elements.targetScore.textContent = enemy.getTargetScore();
    this._renderWeakness(cheating);
    this._renderEnemyRules(enemy);

    // 骰子（显示投掷后的结果）
    this._renderDice(result.dice);

    // 分数对比（显示提示信息）- 使用滚动动画
    // Bug fix: display final score (with multipliers) not adjustedBase
    await this._animateNumber(this._elements.currentScore, result.score, 400);
    this._elements.targetScoreDisplay.textContent = result.targetScore;

    const gap = result.targetScore - result.score;
    if (gap > 0) {
      this._elements.resultStatus.innerHTML = `⚠️ 还差 ${gap} 分，可出千改写`;
      this._elements.resultStatus.className = 'result-status warning';
    } else {
      this._elements.resultStatus.innerHTML = `✓ 分数已达标！`;
      this._elements.resultStatus.className = 'result-status success';
    }

    this._elements.categoryName.textContent = this._getCategoryDisplayName(result.matchedCategory.id);

    // 消耗品和被动
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
    this._renderWeakness(cheating);
    this._renderEnemyRules(enemy);
    this._renderDecreeOverride(cheating);  // 显示强夺令强制分类

    // 骰子
    this._renderDice(dicePool.getDice());

    // 分数显示
    const combat = this._gameFlow.getCombat();
    const result = combat.getResult();

    if (result && !this._resultConfirmed) {
      // 投掷完成但未确认：只显示分数对比，不显示胜负
      this._elements.currentScore.textContent = result.score;
      this._elements.targetScoreDisplay.textContent = result.targetScore;
      this._elements.resultStatus.textContent = '可继续使用消耗品后再确认结果';
      this._elements.resultStatus.className = 'result-status placeholder';
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
      this._elements.resultStatus.textContent = '等待投掷';
      this._elements.resultStatus.className = 'result-status placeholder';
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
  _renderWeakness(cheating) {
    const weaknessCategory = cheating.getWeaknessCategory();
    if (weaknessCategory) {
      this._elements.weaknessCategory.textContent = this._getCategoryDisplayName(weaknessCategory);
      this._elements.weaknessDisplay.classList.remove('muted');
    } else {
      this._elements.weaknessCategory.textContent = '未揭示';
      this._elements.weaknessDisplay.classList.add('muted');
    }
  }

  /** 渲染敌人规则 */
  _renderEnemyRules(enemy) {
    const rules = enemy.getRules();
    if (rules.length === 0) {
      this._elements.enemyRules.textContent = '⚠️ 本轮无特殊规则';
      this._elements.enemyRules.classList.add('muted');
      return;
    }

    this._elements.enemyRules.classList.remove('muted');
    this._elements.enemyRules.textContent = rules
      .map(r => `⚠️ ${r.name}: ${r.description}`)
      .join(' ｜ ');
  }

  /** 渲染强夺令强制分类 */
  _renderDecreeOverride(cheating) {
    const decreePassive = cheating.getPassiveByEffect('category_override');
    if (decreePassive && decreePassive.params.forcedCategoryName) {
      this._elements.decreeOverrideDisplay.textContent = `💪 强夺令：强制匹配${decreePassive.params.forcedCategoryName}`;
      this._elements.decreeOverrideDisplay.classList.remove('muted');
    } else {
      this._elements.decreeOverrideDisplay.classList.add('muted');
    }
  }

  /** 渲染骰子 */
  _renderDice(dice) {
    this._elements.diceContainer.innerHTML = '';

    for (let i = 0; i < dice.length; i++) {
      const d = dice[i];
      const die = document.createElement('div');
      die.className = 'die';
      if (d.isTemp) die.classList.add('temp');
      if (d.isFrozen) die.classList.add('frozen');

      // 添加可选择样式
      if (this._isSelectingTarget) {
        die.classList.add('selectable');
        die.addEventListener('click', () => this._onSelectDie(i));
      }

      // 添加已选中样式
      if (this._selectedDieIndex === i) {
        die.classList.add('selected');
      }
      // 添加第二个选中样式（用于换位）
      if (this._selectedDieIndex2 === i) {
        die.classList.add('selected-2');
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
      if (this._activeDetail?.type === 'consumable') this._closeDetail();
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

    if (this._activeDetail?.type === 'consumable') {
      this._renderDetailOverlay();
    }
  }

  /** 渲染被动能力 */
  _renderPassives(passives) {
    this._elements.passivesList.innerHTML = '';

    if (passives.length === 0) {
      this._elements.passivesList.innerHTML = '<span style="color:#666;font-style:italic;">（空）</span>';
      if (this._activeDetail?.type === 'passive') this._closeDetail();
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

    if (this._activeDetail?.type === 'passive') {
      this._renderDetailOverlay();
    }
  }

  /** 选择被动能力 */
  _onSelectPassive(index) {
    this._selectedPassiveIndex = index;
    this._renderPassives(this._gameFlow.getCheating().getPassives());
    this._openDetail('passive', index);
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

    // 投掷后中间状态：显示动态按钮，允许使用消耗品
    if (this._isPostRollState(state)) {
      this._elements.btnRoll.disabled = true;
      this._elements.btnConfirmResult.classList.remove('hidden');

      // 根据分数动态调整按钮文本和样式
      const result = this._pendingRollResult;
      if (result) {
        // Bug fix: use final score (with multipliers) not adjustedBase
        const isWinning = result.score >= result.targetScore;
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

    // 获取骰子元素
    const diceElements = this._elements.diceContainer.querySelectorAll('.die');

    // 骰子滚动动画 - 持续1.5秒，期间骰子值随机变化
    const rollDuration = 1500;

    // 添加滚动动画类
    diceElements.forEach(d => d.classList.add('rolling'));

    // 滚动期间不断更新骰子值，营造紧张感
    const rollInterval = setInterval(() => {
      diceElements.forEach(d => {
        const randomValue = Math.floor(Math.random() * 6) + 1;
        d.textContent = randomValue;
      });
    }, 100);

    // 等待滚动完成
    await new Promise(resolve => setTimeout(resolve, rollDuration));

    // 停止随机变化
    clearInterval(rollInterval);
    diceElements.forEach(d => d.classList.remove('rolling'));

    // Phase 1: 执行投掷阶段（不判定胜负）
    const rollResult = this._gameFlow.executeRollPhase();

    // 显示碗盖扣下动画
    await this._showBowlStatus();

    // 存储投掷结果用于显示（此时还未判定胜负）
    this._pendingRollResult = rollResult;
    this._isRolling = false;
    this._render();  // 将显示分数对比和可使用消耗品
  }

  /** 显示“可出千”状态徽标（不遮挡 UI） */
  async _showBowlStatus() {
    this._elements.diceBowl.classList.remove('hidden');
    this._elements.diceBowl.classList.remove('revealing');
    this._elements.diceBowl.classList.add('covered');

    if (this._elements.bowlStatusText) {
      this._elements.bowlStatusText.textContent = '盖碗中 · 可出千';
    }

    await new Promise(resolve => setTimeout(resolve, 180));
  }

  /** 隐藏“可出千”状态徽标（揭晓时） */
  async _hideBowlStatus() {
    if (this._elements.diceBowl.classList.contains('hidden')) return;

    this._elements.diceBowl.classList.remove('covered');
    this._elements.diceBowl.classList.add('revealing');

    if (this._elements.bowlStatusText) {
      this._elements.bowlStatusText.textContent = '揭晓中...';
    }

    await new Promise(resolve => setTimeout(resolve, 220));

    this._elements.diceBowl.classList.add('hidden');
    this._elements.diceBowl.classList.remove('covered', 'revealing');
  }

  /** 确认结果 - 进入最终结算 */
  async _onConfirmResult() {
    // 揭晓时刻：先掀开碗盖，再结算
    if (!this._elements.diceBowl.classList.contains('hidden')) {
      await this._hideBowlStatus();
    }

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
    this._selectedDieIndex2 = null;

    this._selectedConsumableIndex = index;
    this._renderConsumables(consumables);
    this._openDetail('consumable', index);

    // 检查是否是需要选择目标的消耗品
    const selected = consumables[index];
    const needsTarget = selected && selected.tags &&
      (selected.tags.includes('targeted') || selected.tags.includes('universal'));
    const needsDualTarget = selected && selected.tags && selected.tags.includes('targeted_dual');

    if (needsDualTarget) {
      this._isSelectingTarget = true;
      this._showToast(`${selected.name}: 请依次选择两个骰子`);
    } else if (needsTarget) {
      this._isSelectingTarget = true;
      this._showToast(`${selected.name}: 请点击选择一个骰子`);
    }

    this._render();
    this._updateButtons();
  }

  /** 选择骰子作为目标 */
  _onSelectDie(dieIndex) {
    if (!this._isSelectingTarget) return;

    const cheating = this._gameFlow.getCheating();
    const consumables = cheating.getConsumables();
    const selected = consumables[this._selectedConsumableIndex];
    const dice = this._gameFlow.getDicePool().getDice();
    const diceValue = dice[dieIndex].value;

    // 检查是否是双目标选择
    const isDualTarget = selected && selected.tags && selected.tags.includes('targeted_dual');

    if (isDualTarget) {
      // 双目标选择逻辑
      if (this._selectedDieIndex === null) {
        // 选择第一个目标
        this._selectedDieIndex = dieIndex;
        this._showToast(`已选择第1个骰子 ${diceValue}，请选择第2个`);
      } else if (this._selectedDieIndex2 === null && dieIndex !== this._selectedDieIndex) {
        // 选择第二个目标
        this._selectedDieIndex2 = dieIndex;
        this._showToast(`已选择第2个骰子 ${diceValue}，请点击"使用消耗品"确认`);
      } else {
        // 重新开始选择
        this._selectedDieIndex = dieIndex;
        this._selectedDieIndex2 = null;
        this._showToast(`已重新选择第1个骰子 ${diceValue}，请选择第2个`);
      }
    } else {
      // 单目标选择逻辑
      this._selectedDieIndex = dieIndex;
      this._showToast(`已选择骰子 ${diceValue}，请点击"使用消耗品"确认`);
    }

    this._render();
  }

  async _onUseConsumable() {
    if (this._selectedConsumableIndex === null) return;

    const cheating = this._gameFlow.getCheating();
    const consumables = cheating.getConsumables();
    const selectedConsumable = consumables[this._selectedConsumableIndex];
    if (!selectedConsumable) return;

    // 检查是否需要选择目标
    const tags = selectedConsumable.tags || [];
    const isTargeted = tags.includes('targeted') || tags.includes('universal');
    const isDualTarget = tags.includes('targeted_dual');

    if (isDualTarget && (this._selectedDieIndex === null || this._selectedDieIndex2 === null)) {
      this._showToast('请先选择两个骰子');
      return;
    } else if (isTargeted && this._selectedDieIndex === null) {
      this._showToast('请先选择一个骰子');
      return;
    }

    // 换面消耗品：先弹出选值器，用户确认后才消耗
    if (selectedConsumable.effectType === 'set_dice_value') {
      this._showValuePicker(this._selectedDieIndex);
      return;
    }

    const combat = this._gameFlow.getCombat();
    const dicePool = this._gameFlow.getDicePool();
    const beforeValues = dicePool.getValues();
    const ability = combat.useConsumable(this._selectedConsumableIndex, {
      targetIndex: this._selectedDieIndex ?? 0,
      targetIndex2: this._selectedDieIndex2 ?? 1
    });

    if (ability) {
      // 应用消耗品效果
      const diceElements = this._elements.diceContainer.querySelectorAll('.die');
      const afterValues = dicePool.getValues();

      let effectMessage = `使用了 ${ability.name}`;
      let affectedDieIndex = -1;

      switch (ability.effectType) {
        case 'reroll_min':
          // 加料：使用选中的骰子
          affectedDieIndex = this._selectedDieIndex ?? 0;
          effectMessage = `加料：重掷骰子（最小${ability.params.minValue}）`;
          break;
        case 'replace_lowest':
          // 偷梁换柱：自动替换最低骰子（不需要选择）
          effectMessage = `偷梁换柱：最低骰子变为 ${ability.params.value}`;
          // 找到最低骰子的索引
          let minVal = Infinity;
          for (let i = 0; i < beforeValues.length; i++) {
            if (beforeValues[i] < minVal) {
              minVal = beforeValues[i];
              affectedDieIndex = i;
            }
          }
          break;
        case 'swap_values':
          // 换位：交换两个骰子的值
          effectMessage = `换位：交换了两个骰子`;
          affectedDieIndex = this._selectedDieIndex;
          break;
        case 'gamble_reroll':
          // 赌博：50%概率全6，50%概率全1
          const allSame = afterValues.length > 0 && afterValues.every(v => v === afterValues[0]);
          const isLucky = allSame && afterValues[0] === ability.params.goodValue;
          effectMessage = isLucky ? `赌博：大成功！全骰变为6` : `赌博：失败...全骰变为1`;
          // 对所有骰子添加微调动画
          diceElements.forEach(d => d.classList.add('nudge'));
          await new Promise(resolve => setTimeout(resolve, 300));
          diceElements.forEach(d => d.classList.remove('nudge'));
          break;
        case 'freeze_die':
          // 冻结：骰子下轮保留值
          affectedDieIndex = this._selectedDieIndex;
          effectMessage = `冻结：骰子下轮保留`;
          break;
        case 'invert_value':
          // 反转：骰子值变为 (7-原值)
          affectedDieIndex = this._selectedDieIndex;
          effectMessage = `反转：骰子值已反转`;
          break;
        case 'extra_roll':
          effectMessage = `双投：重新投掷全部骰子`;
          // 对所有骰子添加微调动画
          diceElements.forEach(d => d.classList.add('nudge'));
          await new Promise(resolve => setTimeout(resolve, 300));
          diceElements.forEach(d => d.classList.remove('nudge'));
          break;
        case 'reveal_weakness':
          effectMessage = `透视：已显示弱点分类`;
          break;
        case 'temp_multiplier_penalty':
          // 魔鬼契约：本轮×1.5，下轮目标+25%
          effectMessage = `魔鬼契约：本轮×${ability.params.multiplier}，下轮目标+${(ability.params.nextRoundTargetIncrease * 100)}%`;
          break;
        case 'sacrifice_consumables':
          // 孤注一掷：销毁全部消耗品，每个+8
          {
            const sacrificed = Math.max(0, consumables.length - 1);
            const bonusPerSac = ability.params.bonusPerSacrifice || 8;
            effectMessage = `孤注一掷：销毁${sacrificed}个消耗品，+${sacrificed * bonusPerSac}分`;
          }
          break;
      }

      this._showToast(effectMessage);

      // 如果有单个骰子被修改，播放微调动画
      if (affectedDieIndex >= 0 && affectedDieIndex < diceElements.length && diceElements[affectedDieIndex]) {
        const dieElement = diceElements[affectedDieIndex];
        dieElement.classList.add('nudge');
        await new Promise(resolve => setTimeout(resolve, 300));
        dieElement.classList.remove('nudge');
      }

      // 重新计算分数并更新缓存的结果
      this._pendingRollResult = this._gameFlow.recalculateRollResult();

      // 重置选择状态
      this._selectedConsumableIndex = null;
      this._selectedDieIndex = null;
      this._selectedDieIndex2 = null;
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
    this._closeDetail();
    this._render();
  }

  /** ==================== 辅助方法 ==================== */
  _isPostRollState(state) {
    return state === GameState.BOWL_COVERED || state === GameState.ROLL_RESULT;
  }

  /**
   * 数字滚动动画
   * @param {HTMLElement} element - 要更新的DOM元素
   * @param {number} targetValue - 目标值
   * @param {number} duration - 动画时长（毫秒）
   */
  async _animateNumber(element, targetValue, duration = 500) {
    const startValue = parseInt(element.textContent) || 0;
    const diff = targetValue - startValue;
    const steps = 20;
    const stepDuration = duration / steps;
    const stepValue = diff / steps;

    for (let i = 0; i < steps; i++) {
      await new Promise(resolve => setTimeout(resolve, stepDuration));
      const currentValue = Math.round(startValue + stepValue * (i + 1));
      element.textContent = currentValue;
    }
    element.textContent = targetValue; // 确保最终值准确
  }

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

  /** ==================== 点数选择器（换面消耗品） ==================== */

  /**
   * 显示点数选择器。此时道具尚未消耗，玩家取消不会丢失道具。
   * @param {number} dieIndex - 目标骰子索引
   */
  _showValuePicker(dieIndex) {
    // 记住上下文，但不消耗道具
    this._pendingFaceChange = {
      dieIndex,
      slotIndex: this._selectedConsumableIndex
    };
    const container = this._elements.valuePickerButtons;
    container.innerHTML = '';
    for (let v = 1; v <= 6; v++) {
      const btn = document.createElement('button');
      btn.className = `dice-face-picker face-${v}`;
      btn.textContent = v;
      btn.addEventListener('click', () => this._onValuePicked(v));
      container.appendChild(btn);
    }
    this._elements.valuePickerOverlay.classList.remove('hidden');
  }

  /** 取消选择器 — 不消耗道具 */
  _hideValuePicker() {
    this._elements.valuePickerOverlay.classList.add('hidden');
    this._pendingFaceChange = null;
  }

  /**
   * 玩家确认选值后：消耗道具 → 应用效果 → 渲染
   * @param {number} value - 玩家选择的点数(1-6)
   */
  _onValuePicked(value) {
    if (!this._pendingFaceChange) return;
    const { dieIndex, slotIndex } = this._pendingFaceChange;
    this._elements.valuePickerOverlay.classList.add('hidden');
    this._pendingFaceChange = null;

    // 现在才消耗道具
    const combat = this._gameFlow.getCombat();
    const ability = combat.useConsumable(slotIndex, {
      targetIndex: dieIndex,
      targetValue: value
    });
    if (!ability) {
      this._showToast('使用失败');
      return;
    }

    this._showToast(`换面：骰子设为 ${value}`);
    this._selectedConsumableIndex = null;
    this._selectedDieIndex = null;
    this._selectedDieIndex2 = null;
    this._isSelectingTarget = false;

    // 重新计算并渲染
    this._pendingRollResult = this._gameFlow.recalculateRollResult();
    this._render();
  }

  _onGlobalKeydown(e) {
    if (e.key !== 'Escape') return;
    if (!this._elements.detailOverlay.classList.contains('hidden')) {
      this._closeDetail();
      return;
    }
    if (!this._elements.scoringRulesOverlay.classList.contains('hidden')) {
      this._onCloseScoringRules();
    }
  }

  _openDetail(type, index) {
    this._activeDetail = { type, index };
    this._renderDetailOverlay();
    this._elements.detailOverlay.classList.remove('hidden');
  }

  _closeDetail() {
    this._activeDetail = null;
    this._elements.detailOverlay.classList.add('hidden');
  }

  _renderDetailOverlay() {
    if (!this._activeDetail) return;
    const cheating = this._gameFlow.getCheating();
    const pool = this._activeDetail.type === 'consumable'
      ? cheating.getConsumables()
      : cheating.getPassives();
    const item = pool[this._activeDetail.index];

    if (!item) {
      this._closeDetail();
      return;
    }

    this._elements.detailTitle.textContent = item.name;
    this._elements.detailSubtitle.textContent =
      `${this._activeDetail.type === 'consumable' ? '消耗品' : '被动能力'} · 成本 ${item.cost ?? '-'}`;
    this._elements.detailDescription.textContent = item.description || '无描述';
    this._elements.detailEffect.textContent = this._getItemEffectHint(item);
  }

  _getItemEffectHint(item) {
    if (!item) return '-';
    // 被动能力直接使用 description，已包含完整效果描述
    if (item.type === 'passive') {
      if (item.description) return `效果：${item.description}`;
      return '-';
    }
    // 消耗品：根据 effectType 提供可读提示
    switch (item.effectType) {
      case 'set_dice_value': return `效果：选择一个骰子，将其改为任意点数(1-6)`;
      case 'reroll_min': return `效果：重掷一个骰子，结果保证≥${item.params?.minValue ?? 4}`;
      case 'reveal_weakness': return `效果：查看本场弱点分类，该分类+10分`;
      case 'extra_roll': return `效果：重新投掷所有骰子`;
      case 'replace_lowest': return `效果：将最低点数的骰子替换为${item.params?.value ?? 6}`;
      case 'swap_values': return `效果：选择两个骰子，交换它们的值`;
      case 'gamble_reroll': return `效果：50%概率全骰变6，50%概率全骰变1`;
      case 'freeze_die': return `效果：冻结一个骰子，下轮保留其值`;
      case 'invert_value': return `效果：骰子值变为 (7-原值)`;
      case 'temp_multiplier_penalty': return `效果：本轮分数×${item.params?.multiplier ?? 1.5}，但下轮目标+${((item.params?.nextRoundTargetIncrease ?? 0.25) * 100)}%`;
      case 'sacrifice_consumables': return `效果：销毁全部消耗品，每个+${item.params?.bonusPerSacrifice ?? 8}分`;
      case 'flat_bonus': return `效果：基础分 +${item.params?.bonus ?? 0}`;
      case 'score_multiplier': return `效果：最终分数 ×${item.params?.multiplier ?? 1}`;
      default:
        if (item.tags?.includes('targeted_dual')) return '效果：需要选择两个骰子作为目标';
        if (item.tags?.includes('targeted')) return '效果：需要选择一个骰子作为目标';
        if (item.description) return `效果：${item.description}`;
        return '-';
    }
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

  /** ==================== 记分规则弹窗 ==================== */

  /**
   * 显示记分规则弹窗
   */
  _onShowScoringRules() {
    this._renderScoringRules();
    this._elements.scoringRulesOverlay.classList.remove('hidden');
  }

  /**
   * 关闭记分规则弹窗
   */
  _onCloseScoringRules() {
    this._elements.scoringRulesOverlay.classList.add('hidden');
  }

  /**
   * 渲染记分规则表格（基础规则版本）
   */
  _renderScoringRules() {
    const dataConfig = this._gameFlow.getDataConfig();
    const cheating = this._gameFlow.getCheating();

    // 隐藏当前骰子显示（基础规则不需要）- 如果元素存在
    if (this._elements.scoringDiceValues) {
      this._elements.scoringDiceValues.textContent = '';
    }

    // 显示被动能力列表
    const passives = cheating.getPassives();
    if (passives.length === 0) {
      this._elements.scoringPassives.innerHTML = '<span class="none">（无被动能力）</span>';
    } else {
      this._elements.scoringPassives.innerHTML = passives.map(p =>
        `<span class="passive-item">${p.name}: ${p.description}</span>`
      ).join('');
    }

    // 获取所有分类
    const categories = dataConfig.getCategories();

    // 渲染表格（基础规则，不含动态计算）
    this._elements.scoringTableBody.innerHTML = categories.map(category => {
      // 基础分公式
      const baseFormula = this._getBaseFormulaText(category);

      // 被动影响说明
      const passiveEffect = this._getPassiveEffectText(category, cheating);

      return `
        <tr>
          <td>${this._getCategoryDisplayName(category.id)}</td>
          <td><span class="match-condition">${this._getCategoryConditionText(category)}</span></td>
          <td><span class="base-score">${baseFormula}</span></td>
          <td class="passive-bonus">${passiveEffect}</td>
          <td><span class="multiplier">-</span></td>
          <td><span class="final-score">-</span></td>
        </tr>
      `;
    }).join('');
  }

  /**
   * 获取基础分公式描述
   */
  _getBaseFormulaText(category) {
    const sumPart = '骰子之和';

    if (category.bonusType === 'multiplier') {
      return `${sumPart} × ${category.bonusValue}`;
    } else if (category.bonusType === 'flat') {
      const bonus = category.bonusValue || 0;
      return bonus > 0 ? `${sumPart} + ${bonus}` : sumPart;
    }
    return sumPart;
  }

  /**
   * 获取被动对分类的影响描述
   */
  _getPassiveEffectText(category, cheating) {
    const effects = [];
    const passives = cheating.getPassives();

    for (const passive of passives) {
      // 跳过被封印的被动
      if (cheating.isPassiveSealed(passive.id)) continue;

      // 牌型大师加成
      if (passive.effectType === 'category_bonus') {
        const cats = passive.params.categories || [];
        if (cats.includes(category.id)) {
          effects.push(`${passive.name} +${passive.params.bonus}`);
        }
      }

      // 连横术加成
      if (passive.effectType === 'excess_bonus') {
        effects.push(`${passive.name} 超额+${passive.params.perExcess}`);
      }

      // 贪欲倍率（所有分类）
      if (passive.effectType === 'score_multiplier') {
        effects.push(`${passive.name} ×${passive.params.multiplier}`);
      }

      // 反转审判
      if (passive.effectType === 'victory_reverse') {
        effects.push(`${passive.name} 目标×${passive.params.threshold}`);
      }

      // 强夺令
      if (passive.effectType === 'category_override') {
        effects.push(`${passive.name} 强制${passive.params.forceCategory}`);
      }
    }

    return effects.length > 0
      ? effects.map(e => `<span class="has-bonus">${e}</span>`).join('<br>')
      : '<span class="none">-</span>';
  }

  /**
   * 获取分类匹配条件描述
   */
  _getCategoryConditionText(category) {
    switch (category.matchType) {
      case 'all_same':
        return `全部相同`;
      case 'same_value':
        return `${category.matchCount}+个相同`;
      case 'full_house':
        return `3个相同 + 2个相同`;
      case 'consecutive':
        return `${category.consecutiveCount}个连续`;
      case 'fallback':
        return `任意`;
      default:
        return `-`;
    }
  }
}

export { GameUI };
