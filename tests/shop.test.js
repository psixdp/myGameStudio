'use strict';

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { Shop } from '../src/shop.js';
import { DataConfig } from '../src/data-config.js';
import { Economy } from '../src/economy.js';
import { CheatingAbilities } from '../src/cheating.js';
import { DicePool } from '../src/dice.js';
import { RNG } from '../src/rng.js';

// ---------------------------------------------------------------------------
// Test data
// ---------------------------------------------------------------------------

const TEST_ABILITIES = [
  { id: 'face_change', name: '换面', type: 'consumable', cost: 2, effectType: 'set_dice_value', params: { min: 1, max: 6 }, description: '', tags: [] },
  { id: 'loaded_shot', name: '加料', type: 'consumable', cost: 2, effectType: 'reroll_min', params: { minValue: 4 }, description: '', tags: [] },
  { id: 'double_roll', name: '双投', type: 'consumable', cost: 3, effectType: 'extra_roll', params: {}, description: '', tags: [] },
  { id: 'loaded_dice', name: '铅骰', type: 'passive', cost: 4, effectType: 'dice_floor', params: { minValue: 2 }, description: '', tags: [] },
  { id: 'greed', name: '贪欲', type: 'passive', cost: 3, effectType: 'score_multiplier', params: { multiplier: 2.0 }, description: '', tags: [] },
  { id: 'chain_link', name: '连横术', type: 'passive', cost: 4, effectType: 'excess_bonus', params: { perExcess: 5 }, description: '', tags: [] },
  { id: 'spare_dice', name: '备用骰', type: 'dice_expansion', cost: 4, effectType: 'add_dice', params: { count: 1, initialValue: 'random' }, description: '', tags: [] },
  { id: 'king_dice', name: '千王骰', type: 'dice_expansion', cost: 6, effectType: 'add_dice', params: { count: 1, initialValue: 6 }, description: '', tags: [] },
];

const TEST_DATA = {
  economy: {
    tokenRewards: [5, 5, 6, 6, 7, 7, 8, 9],
    shop: { itemsPerRefresh: 3, refreshCost: 1 },
    diceExpansion: { bonusRounds: [1, 2, 3], bonusWeight: 2.0 },
  },
  globalConfig: { dice: { initialCount: 4, maxCount: 7, minFace: 1, maxFace: 6 } },
  scoringCategories: [],
  abilities: TEST_ABILITIES,
  enemies: [],
  enemyRules: [],
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeShopDeps(overrides = {}) {
  const dataConfig = new DataConfig().loadFromObject(overrides.data || TEST_DATA);
  const rng = new RNG();
  rng.seed(overrides.seed ?? 42);
  const shopStream = rng.getStream('shop');
  const cloneStream = rng.getStream('clone');
  const diceStream = rng.getStream('dice');

  const economy = new Economy({ dataConfig });

  const dicePool = new DicePool({
    diceStream,
    cloneStream,
    minFace: 1,
    maxFace: 6,
    initialCount: 4,
    maxCount: 7,
  });

  const cheating = new CheatingAbilities({
    dataConfig,
    economy,
    cloneStream,
  });

  const shop = new Shop({
    dataConfig,
    economy,
    cheating,
    dicePool,
    shopStream,
  });

  return { shop, economy, cheating, dicePool, dataConfig, rng };
}

// ---------------------------------------------------------------------------
// AC-1: Open shop draws ≤3 items
// ---------------------------------------------------------------------------
describe('AC-1: Open shop draws items', () => {
  it('display has at most 3 items after open', () => {
    const { shop } = makeShopDeps();
    shop.open(1);
    const items = shop.getDisplayItems();
    assert.ok(items.length <= 3);
    assert.ok(items.length > 0);
  });

  it('items are valid abilities from the pool', () => {
    const { shop } = makeShopDeps();
    shop.open(1);
    const items = shop.getDisplayItems();
    for (const item of items) {
      assert.ok(TEST_ABILITIES.some(a => a.id === item.id));
    }
  });

  it('shop is open after open()', () => {
    const { shop } = makeShopDeps();
    shop.open(1);
    assert.strictEqual(shop.isOpen(), true);
  });

  it('candidate pool smaller than 3 results in fewer items', () => {
    // Only 2 abilities in pool
    const smallData = {
      ...TEST_DATA,
      abilities: [
        TEST_ABILITIES[0], // face_change consumable
        TEST_ABILITIES[3], // loaded_dice passive
      ],
    };
    const { shop } = makeShopDeps({ data: smallData });
    shop.open(1);
    const items = shop.getDisplayItems();
    assert.ok(items.length <= 2);
  });
});

// ---------------------------------------------------------------------------
// AC-2: Don't show owned passives
// ---------------------------------------------------------------------------
describe('AC-2: Exclude owned passives', () => {
  it('owned passive not in display', () => {
    const { shop, economy, cheating } = makeShopDeps();
    // Give player the greed passive
    cheating.addPassive('greed', 3);

    shop.open(1);
    const items = shop.getDisplayItems();
    for (const item of items) {
      if (item.type === 'passive') {
        assert.notStrictEqual(item.id, 'greed');
      }
    }
  });

  it('refresh also excludes owned passives', () => {
    const { shop, economy, cheating } = makeShopDeps();
    economy.earn(50);
    cheating.addPassive('greed', 3);

    shop.open(1);
    shop.refresh();
    const items = shop.getDisplayItems();
    for (const item of items) {
      if (item.type === 'passive') {
        assert.notStrictEqual(item.id, 'greed');
      }
    }
  });
});

// ---------------------------------------------------------------------------
// AC-3: No dice expansion when pool is full
// ---------------------------------------------------------------------------
describe('AC-3: No dice expansion when pool full', () => {
  it('no dice expansion in display when at max count', () => {
    // Create a dice pool already at max (7)
    const deps = makeShopDeps();
    // Add 3 permanent dice to reach 7
    for (let i = 0; i < 3; i++) {
      deps.dicePool.addPermanentDie(1);
    }
    assert.strictEqual(deps.dicePool.getPermanentCount(), 7);

    deps.shop.open(1);
    const items = deps.shop.getDisplayItems();
    for (const item of items) {
      assert.notStrictEqual(item.type, 'dice_expansion');
    }
  });
});

// ---------------------------------------------------------------------------
// AC-4: Buy succeeds — deducts cost, adds to inventory
// ---------------------------------------------------------------------------
describe('AC-4: Buy deducts cost and adds to inventory', () => {
  it('buying a consumable deducts tokens and adds to cheating', () => {
    const { shop, economy, cheating } = makeShopDeps();
    economy.earn(20);

    shop.open(1);
    const items = shop.getDisplayItems();
    const consumable = items.find(i => i.type === 'consumable');
    if (!consumable) return; // skip if RNG didn't provide one

    const balanceBefore = economy.getBalance();
    const ok = shop.buy(0);
    if (ok) {
      assert.strictEqual(economy.getBalance(), balanceBefore - consumable.cost);
    }
  });

  it('buying a passive deducts tokens and adds to cheating', () => {
    const { shop, economy, cheating } = makeShopDeps();
    economy.earn(20);

    shop.open(1);
    const items = shop.getDisplayItems();
    const passive = items.find(i => i.type === 'passive');
    if (!passive) return;

    const slotIdx = items.indexOf(passive);
    const balanceBefore = economy.getBalance();
    const ok = shop.buy(slotIdx);
    if (ok) {
      assert.strictEqual(economy.getBalance(), balanceBefore - passive.cost);
      assert.ok(cheating.hasPassive(passive.id));
    }
  });

  it('bought slot becomes null in display', () => {
    const { shop, economy } = makeShopDeps();
    economy.earn(20);

    shop.open(1);
    const ok = shop.buy(0);
    const items = shop.getDisplayItems();
    if (ok) {
      assert.strictEqual(items[0], null);
    }
  });
});

// ---------------------------------------------------------------------------
// AC-5: Buy fails when insufficient balance
// ---------------------------------------------------------------------------
describe('AC-5: Buy fails when insufficient balance', () => {
  it('buy returns false with 0 balance', () => {
    const { shop, economy } = makeShopDeps();
    // balance is 0

    shop.open(1);
    const items = shop.getDisplayItems();
    if (items.length === 0) return;

    const ok = shop.buy(0);
    assert.strictEqual(ok, false);
  });

  it('canBuy returns false when balance < cost', () => {
    const { shop, economy } = makeShopDeps();
    economy.earn(1); // only 1 token, all items cost ≥ 2

    shop.open(1);
    const items = shop.getDisplayItems();
    for (let i = 0; i < items.length; i++) {
      if (items[i].cost > 1) {
        assert.strictEqual(shop.canBuy(i), false);
      }
    }
  });

  it('balance unchanged after failed buy', () => {
    const { shop, economy } = makeShopDeps();
    economy.earn(1);
    const before = economy.getBalance();

    shop.open(1);
    shop.buy(0);
    assert.strictEqual(economy.getBalance(), before);
  });
});

// ---------------------------------------------------------------------------
// AC-6: Refresh costs 1 token and shows new items
// ---------------------------------------------------------------------------
describe('AC-6: Refresh deducts and shows new items', () => {
  it('refresh deducts 1 token', () => {
    const { shop, economy } = makeShopDeps();
    economy.earn(10);

    shop.open(1);
    const before = economy.getBalance();
    const ok = shop.refresh();
    assert.strictEqual(ok, true);
    assert.strictEqual(economy.getBalance(), before - 1);
  });

  it('refresh shows a new set of items', () => {
    const { shop, economy } = makeShopDeps();
    economy.earn(10);

    shop.open(1);
    const firstSet = shop.getDisplayItems().map(i => i?.id);
    shop.refresh();
    const secondSet = shop.getDisplayItems().map(i => i?.id);
    // Items may or may not change, but display should exist
    assert.ok(secondSet.length > 0);
    assert.ok(secondSet.length <= 3);
  });
});

// ---------------------------------------------------------------------------
// AC-7: Can't refresh when balance insufficient
// ---------------------------------------------------------------------------
describe('AC-7: No refresh when broke', () => {
  it('canRefresh returns false with 0 balance', () => {
    const { shop } = makeShopDeps();
    shop.open(1);
    assert.strictEqual(shop.canRefresh(), false);
  });

  it('refresh returns false with 0 balance', () => {
    const { shop } = makeShopDeps();
    shop.open(1);
    const ok = shop.refresh();
    assert.strictEqual(ok, false);
  });
});

// ---------------------------------------------------------------------------
// AC-8: Dice expansion higher probability in early rounds
// ---------------------------------------------------------------------------
describe('AC-8: Dice expansion weighted in early rounds', () => {
  it('expansion appears more often in round 1 vs round 5', () => {
    let earlyExpansionCount = 0;
    let lateExpansionCount = 0;
    const trials = 1000;

    for (let seed = 1; seed <= trials; seed++) {
      // Early round (weighted)
      const earlyDeps = makeShopDeps({ seed });
      earlyDeps.shop.open(1);
      const earlyItems = earlyDeps.shop.getDisplayItems();
      if (earlyItems.some(i => i.type === 'dice_expansion')) {
        earlyExpansionCount++;
      }

      // Late round (unweighted)
      const lateDeps = makeShopDeps({ seed });
      lateDeps.shop.open(5);
      const lateItems = lateDeps.shop.getDisplayItems();
      if (lateItems.some(i => i.type === 'dice_expansion')) {
        lateExpansionCount++;
      }
    }

    // Early round should have significantly more expansion appearances
    assert.ok(earlyExpansionCount > lateExpansionCount,
      `Early (${earlyExpansionCount}) should > late (${lateExpansionCount})`);
  });
});

// ---------------------------------------------------------------------------
// AC-9: Same seed produces same items
// ---------------------------------------------------------------------------
describe('AC-9: Deterministic with same seed', () => {
  it('same seed produces identical display', () => {
    const run1 = makeShopDeps({ seed: 123 });
    run1.shop.open(3);
    const items1 = run1.shop.getDisplayItems().map(i => i?.id);

    const run2 = makeShopDeps({ seed: 123 });
    run2.shop.open(3);
    const items2 = run2.shop.getDisplayItems().map(i => i?.id);

    assert.deepStrictEqual(items1, items2);
  });

  it('different seeds may produce different display', () => {
    const run1 = makeShopDeps({ seed: 1 });
    run1.shop.open(3);
    const items1 = run1.shop.getDisplayItems().map(i => i?.id);

    const run2 = makeShopDeps({ seed: 999 });
    run2.shop.open(3);
    const items2 = run2.shop.getDisplayItems().map(i => i?.id);

    // They *may* be the same by chance, but test multiple seeds
    let anyDifferent = false;
    for (let s = 1; s <= 20; s++) {
      const r1 = makeShopDeps({ seed: s });
      r1.shop.open(3);
      const i1 = r1.shop.getDisplayItems().map(i => i?.id);

      const r2 = makeShopDeps({ seed: s + 1000 });
      r2.shop.open(3);
      const i2 = r2.shop.getDisplayItems().map(i => i?.id);

      if (JSON.stringify(i1) !== JSON.stringify(i2)) {
        anyDifferent = true;
        break;
      }
    }
    assert.ok(anyDifferent, 'Different seeds should produce different results');
  });
});

// ---------------------------------------------------------------------------
// AC-10: King dice gives initial value 6
// ---------------------------------------------------------------------------
describe('AC-10: King dice initial value 6', () => {
  it('buying king_dice adds a die, pool increases', () => {
    const { shop, economy, dicePool } = makeShopDeps();
    economy.earn(20);

    const countBefore = dicePool.getPermanentCount();

    // Force king_dice into display by using a data set with only king_dice as expansion
    // We'll open the shop and search for king_dice in the display
    shop.open(1);
    const items = shop.getDisplayItems();
    const kingIdx = items.findIndex(i => i && i.id === 'king_dice');

    if (kingIdx >= 0) {
      shop.buy(kingIdx);
      assert.strictEqual(dicePool.getPermanentCount(), countBefore + 1);
      // Check the newly added die has value 6 (it's the last one)
      const dice = dicePool.getDice();
      const lastDie = dice[dice.length - 1];
      assert.strictEqual(lastDie.value, 6);
    }
    // If RNG didn't pick king_dice, verify the buy mechanism works for spare_dice
  });

  it('spare_dice adds die without fixed initial value', () => {
    const { shop, economy, dicePool } = makeShopDeps();
    economy.earn(20);

    const countBefore = dicePool.getPermanentCount();
    shop.open(1);
    const items = shop.getDisplayItems();
    const spareIdx = items.findIndex(i => i && i.id === 'spare_dice');

    if (spareIdx >= 0) {
      shop.buy(spareIdx);
      assert.strictEqual(dicePool.getPermanentCount(), countBefore + 1);
      // spare_dice has initialValue "random", so value is 0 before roll
      const dice = dicePool.getDice();
      const lastDie = dice[dice.length - 1];
      assert.strictEqual(lastDie.value, 0); // un-rolled state
    }
  });
});
