'use strict';

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { Shop } from '../src/shop.js';
import { DataConfig } from '../src/data-config.js';
import { Economy } from '../src/economy.js';
import { CheatingAbilities } from '../src/cheating.js';
import { DicePool } from '../src/dice.js';
import { RNG } from '../src/rng.js';
import { Enemy } from '../src/enemy.js';

function makeShop(seed = 7) {
  const rng = new RNG();
  rng.seed(seed);

  const dataConfig = new DataConfig().loadFromObject({
    globalConfig: {
      dice: { initialCount: 4, maxCount: 7, minFace: 1, maxFace: 6 },
      rounds: { total: 1 }
    },
    scoringCategories: [{ id: 'bust', matchType: 'fallback', minDice: 0, bonusType: 'flat', bonusValue: 0, priority: 1 }],
    abilities: [
      { id: 'spare_dice', name: 'Spare', type: 'dice_expansion', cost: 4, effectType: 'add_dice', params: { count: 1, initialValue: 'random' }, description: '' },
      { id: 'king_dice', name: 'King', type: 'dice_expansion', cost: 6, effectType: 'add_dice', params: { count: 1, initialValue: 6 }, description: '' },
      { id: 'face_change', name: 'Face', type: 'consumable', cost: 2, effectType: 'set_dice_value', params: { min: 1, max: 6 }, description: '' }
    ],
    enemies: [],
    enemyRules: [],
    economy: {
      tokenRewards: [0],
      shop: { itemsPerRefresh: 3, refreshCost: 1 },
      diceExpansion: { bonusRounds: [1], bonusWeight: 2.0 }
    }
  });

  const economy = new Economy({ dataConfig });
  const dicePool = new DicePool({
    diceStream: rng.getStream('dice'),
    cloneStream: rng.getStream('clone'),
    minFace: 1,
    maxFace: 6,
    initialCount: 4,
    maxCount: 7
  });
  const cheating = new CheatingAbilities({
    dataConfig,
    economy,
    cloneStream: rng.getStream('clone')
  });
  const enemy = new Enemy({ dataConfig, enemyStream: rng.getStream('enemy') });
  const shop = new Shop({
    dataConfig,
    economy,
    cheating,
    dicePool,
    shopStream: rng.getStream('shop'),
    enemy
  });

  return { shop, economy, dicePool };
}

describe('Shop capacity safety', () => {
  it('does not charge for stale expansion slot after pool reaches max', () => {
    const { shop, economy, dicePool } = makeShop();

    // Bring permanent dice to 6 so first expansion can still succeed.
    dicePool.addPermanentDie(1);
    dicePool.addPermanentDie(1);
    assert.equal(dicePool.getPermanentCount(), 6);

    economy.earn(30);
    shop.open(1);

    const items = shop.getDisplayItems();
    const expansionSlots = items
      .map((item, idx) => ({ item, idx }))
      .filter(x => x.item && x.item.type === 'dice_expansion')
      .map(x => x.idx);

    assert.equal(expansionSlots.length, 2);

    const firstSlot = expansionSlots[0];
    const secondSlot = expansionSlots[1];

    const beforeFirst = economy.getBalance();
    const firstOk = shop.buy(firstSlot);
    assert.equal(firstOk, true);
    assert.equal(dicePool.getPermanentCount(), 7);
    assert.ok(economy.getBalance() < beforeFirst);

    const beforeSecond = economy.getBalance();
    const secondOk = shop.buy(secondSlot);
    assert.equal(secondOk, false);
    assert.equal(economy.getBalance(), beforeSecond);
    assert.equal(dicePool.getPermanentCount(), 7);
  });
});
