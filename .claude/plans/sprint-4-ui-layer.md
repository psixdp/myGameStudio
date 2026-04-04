# Sprint 4：表现层 — UI 系统实现计划

## Context

Sprint 1-3 已完成所有核心系统（基础层、核心层、功能层、整合层、流程层）。
现在需要实现表现层，让游戏可通过浏览器游玩。

技术方案：网页浏览器（HTML/CSS/JS），基于 DOM 渲染。

---

## 实现方案

### 文件结构

```
/
├── index.html          # 游戏主页面（新建）
├── css/
│   └── style.css       # 样式和骰子动画（新建）
├── src/
│   └── ui.js          # UI 控制器（新建）
└── tests/
    └── ui.test.js     # UI 测试（可选）
```

### 1. HTML 结构 (`index.html`)

```html
<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>千王骰局</title>
  <link rel="stylesheet" href="css/style.css">
</head>
<body>
  <div id="app">
    <!-- 顶部信息栏 -->
    <header class="game-header">
      <h1>🎲 千王骰局</h1>
      <div class="stats">
        <span id="round-display">Round 1/8</span>
        <span id="tokens-display">Tokens: 5</span>
      </div>
    </header>

    <!-- 敌人信息面板 -->
    <section class="enemy-panel">
      <h2 id="enemy-name">敌人名称</h2>
      <div class="target-score">目标: <span id="target-score">8</span> 分</div>
      <div id="enemy-rules" class="enemy-rules"></div>
    </section>

    <!-- 战斗区域 -->
    <section class="battle-area">
      <!-- 骰子容器 -->
      <div id="dice-container" class="dice-container">
        <!-- 动态生成骰子 -->
      </div>

      <!-- 分数显示 -->
      <div class="score-display">
        <span>分数: <strong id="current-score">0</strong></span>
        <span id="category-name">散牌</span>
      </div>
    </section>

    <!-- 库存面板 -->
    <section class="inventory-panel">
      <h3>🎒 消耗品</h3>
      <div id="consumables-list" class="consumables-list"></div>

      <h3>⚡ 被动能力</h3>
      <div id="passives-list" class="passives-list"></div>
    </section>

    <!-- 操作按钮 -->
    <section class="actions">
      <button id="btn-roll" class="btn-primary">🎲 投掷</button>
      <button id="btn-use-consumable" class="btn-secondary">📦 使用消耗品</button>
    </section>

    <!-- 商店遮罩（默认隐藏） -->
    <div id="shop-overlay" class="overlay hidden">
      <div class="shop-content">
        <h2>🏪 商店</h2>
        <div id="shop-items" class="shop-items"></div>
        <div class="shop-actions">
          <button id="btn-refresh-shop" class="btn-secondary">刷新 (1代币)</button>
          <button id="btn-close-shop" class="btn-primary">离开</button>
        </div>
      </div>
    </div>

    <!-- 游戏结束遮罩（默认隐藏） -->
    <div id="gameover-overlay" class="overlay hidden">
      <div class="gameover-content">
        <h2 id="gameover-title">游戏结束</h2>
        <p id="gameover-message"></p>
        <button id="btn-restart" class="btn-primary">再来一局</button>
      </div>
    </div>
  </div>

  <script type="module">
    import { GameUI } from './src/ui.js';
    const game = new GameUI();
    game.init();
  </script>
</body>
</html>
```

---

### 2. CSS 样式 (`css/style.css`)

#### 核心样式

```css
/* 全局重置 */
* { box-sizing: border-box; margin: 0; padding: 0; }
body { font-family: system-ui, sans-serif; background: #1a1a2e; color: #eee; }

#app { max-width: 600px; margin: 0 auto; padding: 20px; }

/* 头部 */
.game-header { display: flex; justify-content: space-between; align-items: center; }
.stats { display: flex; gap: 20px; font-size: 14px; }

/* 敌人面板 */
.enemy-panel { background: #16213e; padding: 15px; border-radius: 8px; margin: 20px 0; }
.target-score { font-size: 18px; }
.enemy-rules { margin-top: 10px; font-size: 14px; color: #f39c12; }

/* 骰子容器 */
.dice-container { display: flex; gap: 10px; justify-content: center; margin: 20px 0; min-height: 80px; }

/* 单个骰子 */
.die {
  width: 60px; height: 60px;
  background: #fff; color: #333;
  border-radius: 8px;
  display: flex; align-items: center; justify-content: center;
  font-size: 32px; font-weight: bold;
  box-shadow: 0 4px 8px rgba(0,0,0,0.3);
  transition: transform 0.2s;
}
.die.rolling { animation: roll 0.5s ease-out; }
@keyframes roll {
  0% { transform: rotate(0deg) scale(1); }
  50% { transform: rotate(180deg) scale(1.1); }
  100% { transform: rotate(360deg) scale(1); }
}

/* 分数显示 */
.score-display { text-align: center; font-size: 18px; }
.score-display strong { color: #2ecc71; }

/* 库存 */
.inventory-panel { background: #16213e; padding: 15px; border-radius: 8px; margin: 20px 0; }
.consumables-list, .passives-list { display: flex; flex-wrap: wrap; gap: 10px; min-height: 40px; }

/* 消耗品/被动卡片 */
.item-card {
  background: #0f3460; padding: 8px 12px; border-radius: 4px;
  font-size: 13px; cursor: pointer;
}
.item-card:hover { background: #1a4b8c; }
.item-card.disabled { opacity: 0.5; cursor: not-allowed; }

/* 商店 */
.overlay { position: fixed; inset: 0; background: rgba(0,0,0,0.8); display: flex; align-items: center; justify-content: center; z-index: 100; }
.overlay.hidden { display: none; }
.shop-content, .gameover-content { background: #16213e; padding: 30px; border-radius: 12px; max-width: 400px; width: 90%; }
.shop-items { display: flex; flex-direction: column; gap: 10px; margin: 20px 0; }

/* 按钮 */
.actions { display: flex; gap: 10px; justify-content: center; margin: 20px 0; }
.btn-primary, .btn-secondary {
  padding: 12px 24px; border: none; border-radius: 6px;
  font-size: 16px; cursor: pointer;
}
.btn-primary { background: #e94560; color: #fff; }
.btn-secondary { background: #0f3460; color: #fff; }
.btn-primary:hover { background: #ff6b81; }
.btn-primary:disabled { opacity: 0.5; cursor: not-allowed; }

/* 工具类 */
.hidden { display: none !important; }
```

---

### 3. UI 控制器 (`src/ui.js`)

```javascript
/**
 * GameUI — 连接 GameFlow 和 DOM 的 UI 控制器。
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
  }

  /**
   * 初始化：加载资源、创建 GameFlow、绑定事件
   */
  async init() {
    // 缓存 DOM 元素
    this._cacheElements();

    // 创建 GameFlow
    this._gameFlow = new GameFlow({ dataDir: 'assets/data' });
    this._gameFlow.load();
    this._gameFlow.newGame();

    // 绑定事件
    this._bindEvents();

    // 初始渲染
    this._render();
  }

  /** 缓存常用 DOM 元素 */
  _cacheElements() {
    this._elements = {
      roundDisplay: document.getElementById('round-display'),
      tokensDisplay: document.getElementById('tokens-display'),
      enemyName: document.getElementById('enemy-name'),
      targetScore: document.getElementById('target-score'),
      enemyRules: document.getElementById('enemy-rules'),
      diceContainer: document.getElementById('dice-container'),
      currentScore: document.getElementById('current-score'),
      categoryName: document.getElementById('category-name'),
      consumablesList: document.getElementById('consumables-list'),
      passivesList: document.getElementById('passives-list'),
      btnRoll: document.getElementById('btn-roll'),
      btnUseConsumable: document.getElementById('btn-use-consumable'),
      shopOverlay: document.getElementById('shop-overlay'),
      shopItems: document.getElementById('shop-items'),
      btnRefreshShop: document.getElementById('btn-refresh-shop'),
      btnCloseShop: document.getElementById('btn-close-shop'),
      gameoverOverlay: document.getElementById('gameover-overlay'),
      gameoverTitle: document.getElementById('gameover-title'),
      gameoverMessage: document.getElementById('gameover-message'),
      btnRestart: document.getElementById('btn-restart'),
    };
  }

  /** 绑定事件处理器 */
  _bindEvents() {
    this._elements.btnRoll.addEventListener('click', () => this._onRoll());
    this._elements.btnRefreshShop.addEventListener('click', () => this._onRefreshShop());
    this._elements.btnCloseShop.addEventListener('click', () => this._onCloseShop());
    this._elements.btnRestart.addEventListener('click', () => this._onRestart());
  }

  /** 渲染当前状态 */
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
  }

  /** 渲染战斗状态 */
  _renderBattle() {
    const round = this._gameFlow.getCurrentRound();
    const total = this._gameFlow.getTotalRounds();
    const economy = this._gameFlow.getEconomy();
    const enemy = this._gameFlow.getEnemy();
    const cheating = this._gameFlow.getCheating();
    const dicePool = this._gameFlow.getDicePool();

    // 顶部信息
    this._elements.roundDisplay.textContent = `Round ${round}/${total}`;
    this._elements.tokensDisplay.textContent = `Tokens: ${economy.getBalance()}`;

    // 敌人信息
    this._elements.enemyName.textContent = enemy.getName();
    this._elements.targetScore.textContent = enemy.getTargetScore();
    this._renderEnemyRules(enemy);

    // 骰子
    this._renderDice(dicePool.getDice());

    // 消耗品和被动
    this._renderConsumables(cheating.getConsumables());
    this._renderPassives(cheating.getPassives());

    // 隐藏遮罩
    this._elements.shopOverlay.classList.add('hidden');
    this._elements.gameoverOverlay.classList.add('hidden');
  }

  /** 渲染骰子 */
  _renderDice(dice) {
    this._elements.diceContainer.innerHTML = '';
    for (const d of dice) {
      const die = document.createElement('div');
      die.className = 'die';
      die.textContent = d.value;
      this._elements.diceContainer.appendChild(die);
    }
  }

  /** ... 其他渲染方法 ... */
}

module.exports = { GameUI };
```

---

### 4. 交互流程

```
玩家点击 [投掷]
  → ui._onRoll()
  → gameFlow.executeBattle()
  → ui._render()

战斗结果:
  → 胜利 → 打开商店遮罩
  → 失败 → 显示游戏结束

商店:
  → 玩家点击购买 → ui._onBuy()
  → 玩家点击刷新 → ui._onRefreshShop()
  → 玩家点击离开 → ui._onCloseShop() → gameFlow.closeShop() → 回到战斗
```

---

## 实现顺序

1. **CSS 样式** (`css/style.css`) — 独立，无依赖
2. **HTML 结构** (`index.html`) — 依赖 CSS
3. **UI 控制器** (`src/ui.js`) — 依赖 GameFlow
4. **集成测试** — 在浏览器中手动测试

---

## 关键文件

| 文件 | 操作 |
|------|------|
| `index.html` | **新建** |
| `css/style.css` | **新建** |
| `src/ui.js` | **新建** |

---

## 验收标准

- [ ] 打开 index.html 能看到游戏界面
- [ ] 点击"投掷"能执行战斗并更新骰子
- [ ] 战斗胜利后进入商店
- [ ] 商店能购买/刷新/离开
- [ ] 战斗失败显示游戏结束
- [ ] 点击"再来一局"能重新开始
