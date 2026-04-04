'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { CheatingAbilities } = require('../src/cheating');
const { DataConfig } = require('../src/data-config');
const { Economy } = require('../src/economy');
const { RNG } = require('../src/rng');

// Helpers
function makeCheatingSystem() {
  const rng = new RNG(); rng.seed(42);
  const dataConfig = new DataConfig().loadFromObject({
    abilities: [
      { id: 'face_change', name: '换面', type: 'consumable', cost: 2, effectType: 'set_dice_value', params: { min: 1, max: 6 }, description: '换面' },
      { id: 'insight', name: '透视', type: 'consumable', cost: 1, effectType: 'reveal_weakness', params: { bonusFlat: 10 }, description: '透视' },
      { id: 'loaded_dice', name: '铅骰', type: 'passive', cost: 4, effectType: 'dice_floor', params: { minValue: 2 }, description: '铅骰' },
      { id: 'chain_link', name: '连横术', type: 'passive', cost: 4, effectType: 'excess_bonus', params: { perExcess: 5 }, description: '连横术' },
      { id: 'pattern_master', name: '牌型大师', type: 'passive', cost: 4, effectType: 'category_bonus', params: { categories: ['full_house', 'yahtzee', 'three_of_a_kind'], bonus: 20 }, description: '牌型大师' },
      { id: 'greed', name: '贪欲', type: 'passive', cost: 3, effectType: 'score_multiplier', params: { multiplier: 2.0 }, description: '贪欲' }
    ],
    scoringCategories: [
      { id: 'pair', name: '对子', matchType: 'count', target: 2, minDice: 2, priority: 6 },
      { id: 'three_of_a_kind', name: '三条', matchType: 'count', target: 3, minDice: 3, priority: 5 },
      { id: 'full_house', name: '满堂红', matchType: 'full_house', minDice: 5, priority: 2 },
      { id: 'yahtzee', name: '豹子', matchType: 'all_same', minDice: 3, priority: 1, multiplier: 3 },
      { id: 'bust', name: '散牌', matchType: 'fallback', minDice: 0, priority: 7 }
    ],
    // Minimal required data
    globalConfig: { dice: { initialCount: 4, maxCount: 7 } },
    enemies: [],
    enemyRules: [],
    economy: { tokenRewards: [5, 5, 6, 6, 7, 7, 8, 9] }
  });
  const economy = new Economy({ dataConfig });
  return new CheatingAbilities({
    dataConfig,
    economy,
    cloneStream: rng.getStream('clone')
  });
}

// Mock dice pool for bonus calculation
function makeMockDicePool(values) {
  return { getValues: () => values };
}

// ---------------------------------------------------------------------------
// AC-1: Add consumable
// ---------------------------------------------------------------------------
describe('AC-1: Add consumable', () => {
  it('adds to inventory', () => {
    const sys = makeCheatingSystem();
    sys.addConsumable('face_change');
    assert.strictEqual(sys.getConsumables().length, 1);
    assert.strictEqual(sys.getConsumables()[0].id, 'face_change');
  });

  it('returns false for invalid ID', () => {
    const sys = makeCheatingSystem();
    assert.strictEqual(sys.addConsumable('fake_id'), false);
  });

  it('returns false for non-consumable', () => {
    const sys = makeCheatingSystem();
    assert.strictEqual(sys.addConsumable('loaded_dice'), false);
  });
});

// ---------------------------------------------------------------------------
// AC-2: Add passive
// ---------------------------------------------------------------------------
describe('AC-2: Add passive', () => {
  it('adds to passives list', () => {
    const sys = makeCheatingSystem();
    sys.addPassive('loaded_dice', 4);
    assert.strictEqual(sys.getPassives().length, 1);
    assert.strictEqual(sys.getPassives()[0].id, 'loaded_dice');
  });

  it('stores actual cost', () => {
    const sys = makeCheatingSystem();
    sys.addPassive('greed', 5); // cost modified by greed itself
    assert.strictEqual(sys.getPassives()[0].actualCost, 5);
  });
});

// ---------------------------------------------------------------------------
// AC-3: Use consumable removes from inventory
// ---------------------------------------------------------------------------
describe('AC-3: Use consumable', () => {
  it('removes from slot after use', () => {
    const sys = makeCheatingSystem();
    sys.addConsumable('face_change');
    assert.strictEqual(sys.getConsumables().length, 1);
    sys.useConsumable(0);
    assert.strictEqual(sys.getConsumables().length, 0);
  });

  it('increments used count', () => {
    const sys = makeCheatingSystem();
    sys.addConsumable('face_change');
    sys.useConsumable(0);
    assert.strictEqual(sys.getUsedCount(), 1);
  });
});

// ---------------------------------------------------------------------------
// AC-4: Max 2 consumables per round
// ---------------------------------------------------------------------------
describe('AC-4: Max 2 consumables per round', () => {
  it('allows first use', () => {
    const sys = makeCheatingSystem();
    sys.addConsumable('face_change');
    const result = sys.useConsumable(0);
    assert.ok(result != null);
  });

  it('allows second use', () => {
    const sys = makeCheatingSystem();
    sys.addConsumable('face_change');
    sys.addConsumable('face_change');
    sys.useConsumable(0);
    const result = sys.useConsumable(0);
    assert.ok(result != null);
  });

  it('blocks third use', () => {
    const sys = makeCheatingSystem();
    sys.addConsumable('face_change');
    sys.addConsumable('face_change');
    sys.addConsumable('face_change');
    sys.useConsumable(0);
    sys.useConsumable(0);
    const result = sys.useConsumable(0);
    assert.strictEqual(result, null);
    assert.strictEqual(sys.getUsedCount(), 2);
  });

  it('resetRoundState clears used count', () => {
    const sys = makeCheatingSystem();
    sys.addConsumable('face_change');
    sys.useConsumable(0);
    sys.resetRoundState();
    assert.strictEqual(sys.getUsedCount(), 0);
    assert.strictEqual(sys.canUseConsumable(), true);
  });
});

// ---------------------------------------------------------------------------
// AC-5: No passives returns 0 bonuses
// ---------------------------------------------------------------------------
describe('AC-5: No passives returns 0', () => {
  it('getFlatBonuses returns 0', () => {
    const sys = makeCheatingSystem();
    const bonus = sys.getFlatBonuses({ id: 'pair', minDice: 2 }, makeMockDicePool([3, 3, 4, 5]), 2);
    assert.strictEqual(bonus, 0);
  });

  it('getMultipliers returns 1.0', () => {
    const sys = makeCheatingSystem();
    assert.strictEqual(sys.getMultipliers(), 1.0);
  });
});

// ---------------------------------------------------------------------------
// AC-6: Chain link excess calculation
// ---------------------------------------------------------------------------
describe('AC-6: Chain link excess', () => {
  it('calculates bonus for 4-match with minDice=3', () => {
    const sys = makeCheatingSystem();
    sys.addPassive('chain_link', 4);
    const category = { id: 'three_of_a_kind', minDice: 3 };
    const bonus = sys.getFlatBonuses(category, makeMockDicePool([4, 4, 4, 4, 2]), 4);
    assert.strictEqual(bonus, 5); // (4-3) * 5 = 5
  });

  it('returns 0 when matchedCount equals minDice', () => {
    const sys = makeCheatingSystem();
    sys.addPassive('chain_link', 4);
    const category = { id: 'three_of_a_kind', minDice: 3 };
    const bonus = sys.getFlatBonuses(category, makeMockDicePool([4, 4, 4, 2]), 3);
    assert.strictEqual(bonus, 0);
  });

  it('returns 0 when matchedCount less than minDice', () => {
    const sys = makeCheatingSystem();
    sys.addPassive('chain_link', 4);
    const category = { id: 'three_of_a_kind', minDice: 3 };
    const bonus = sys.getFlatBonuses(category, makeMockDicePool([4, 4, 2, 1]), 2);
    assert.strictEqual(bonus, 0);
  });
});

// ---------------------------------------------------------------------------
// AC-7: Chain link + yahtzee returns 0
// ---------------------------------------------------------------------------
describe('AC-7: Chain link + yahtzee = 0', () => {
  it('no excess when all dice match (yahtzee)', () => {
    const sys = makeCheatingSystem();
    sys.addPassive('chain_link', 4);
    const category = { id: 'yahtzee', minDice: 5 };
    const bonus = sys.getFlatBonuses(category, makeMockDicePool([6, 6, 6, 6, 6]), 5);
    assert.strictEqual(bonus, 0); // all 5 match, no excess
  });
});

// ---------------------------------------------------------------------------
// AC-8: Pattern master only for specific categories
// ---------------------------------------------------------------------------
describe('AC-8: Pattern master category bonus', () => {
  it('does NOT trigger for pair', () => {
    const sys = makeCheatingSystem();
    sys.addPassive('pattern_master', 4);
    const category = { id: 'pair', minDice: 2 };
    const bonus = sys.getFlatBonuses(category, makeMockDicePool([3, 3, 4, 5]), 2);
    assert.strictEqual(bonus, 0);
  });

  it('triggers for three_of_a_kind', () => {
    const sys = makeCheatingSystem();
    sys.addPassive('pattern_master', 4);
    const category = { id: 'three_of_a_kind', minDice: 3 };
    const bonus = sys.getFlatBonuses(category, makeMockDicePool([4, 4, 4, 2]), 3);
    assert.strictEqual(bonus, 20);
  });

  it('triggers for full_house', () => {
    const sys = makeCheatingSystem();
    sys.addPassive('pattern_master', 4);
    const category = { id: 'full_house', minDice: 5 };
    const bonus = sys.getFlatBonuses(category, makeMockDicePool([5, 5, 5, 3, 3]), 5);
    assert.strictEqual(bonus, 20);
  });

  it('triggers for yahtzee', () => {
    const sys = makeCheatingSystem();
    sys.addPassive('pattern_master', 4);
    const category = { id: 'yahtzee', minDice: 5 };
    const bonus = sys.getFlatBonuses(category, makeMockDicePool([6, 6, 6, 6, 6]), 5);
    assert.strictEqual(bonus, 20);
  });
});

// ---------------------------------------------------------------------------
// AC-9: Greed multipliers use product
// ---------------------------------------------------------------------------
describe('AC-9: Multiplier product', () => {
  it('single multiplier returns its value', () => {
    const sys = makeCheatingSystem();
    sys.addPassive('greed', 3);
    assert.strictEqual(sys.getMultipliers(), 2.0);
  });

  it('multiple multipliers multiply', () => {
    const sys = makeCheatingSystem();
    // Add greed twice via hack for testing
    sys._passives.push(
      { id: 'greed', effectType: 'score_multiplier', params: { multiplier: 1.5 }, actualCost: 3 },
      { id: 'greed2', effectType: 'score_multiplier', params: { multiplier: 1.2 }, actualCost: 3 }
    );
    assert.strictEqual(sys.getMultipliers(), 1.5 * 1.2); // 1.8
  });

  it('no passives returns 1.0', () => {
    const sys = makeCheatingSystem();
    assert.strictEqual(sys.getMultipliers(), 1.0);
  });
});

// ---------------------------------------------------------------------------
// AC-10: Seal most expensive passive
// ---------------------------------------------------------------------------
describe('AC-10: Seal most expensive passive', () => {
  it('seals the highest cost passive', () => {
    const sys = makeCheatingSystem();
    sys.addPassive('greed', 3);
    sys.addPassive('chain_link', 4);
    sys.addPassive('loaded_dice', 4);
    sys.sealMostExpensivePassive();
    // One of the cost-4 passives should be sealed
    const sealed = sys._sealedPassiveId;
    assert.ok(sealed === 'chain_link' || sealed === 'loaded_dice');
  });

  it('sealed passive returns 0 bonus', () => {
    const sys = makeCheatingSystem();
    sys.addPassive('pattern_master', 4);
    sys.sealMostExpensivePassive();
    const category = { id: 'three_of_a_kind', minDice: 3 };
    const bonus = sys.getFlatBonuses(category, makeMockDicePool([4, 4, 4, 2]), 3);
    assert.strictEqual(bonus, 0); // sealed, so no bonus
  });

  it('sealed passive excluded from multiplier', () => {
    const sys = makeCheatingSystem();
    sys.addPassive('greed', 3);
    sys.sealMostExpensivePassive();
    assert.strictEqual(sys.getMultipliers(), 1.0); // sealed, so no multiplier
  });

  it('no passives does nothing', () => {
    const sys = makeCheatingSystem();
    sys.sealMostExpensivePassive();
    assert.strictEqual(sys._sealedPassiveId, null);
  });
});

// ---------------------------------------------------------------------------
// AC-11: Duplicate passives rejected
// ---------------------------------------------------------------------------
describe('AC-11: Duplicate passives rejected', () => {
  it('addPassive returns false for duplicate', () => {
    const sys = makeCheatingSystem();
    assert.strictEqual(sys.addPassive('greed', 3), true);
    assert.strictEqual(sys.addPassive('greed', 3), false);
    assert.strictEqual(sys.getPassives().length, 1);
  });
});

// ---------------------------------------------------------------------------
// AC-12: Double roll clears previous effects
// ---------------------------------------------------------------------------
describe('AC-12: Insight reveals weakness', () => {
  it('sets weaknessCategory when used', () => {
    const sys = makeCheatingSystem();
    sys.addConsumable('insight');
    sys.useConsumable(0);
    const weakness = sys.getWeaknessCategory();
    assert.ok(weakness != null);
    // Should be one of the categories
    assert.ok(['pair', 'three_of_a_kind', 'full_house', 'yahtzee', 'bust'].includes(weakness));
  });

  it('weakness bonus adds to flat bonuses', () => {
    const sys = makeCheatingSystem();
    sys.addConsumable('insight');
    sys.useConsumable(0);
    const weakness = sys.getWeaknessCategory();
    const category = { id: weakness, minDice: 2 };
    const bonus = sys.getFlatBonuses(category, makeMockDicePool([3, 3, 4, 5]), 2);
    assert.strictEqual(bonus, 10); // insight bonus
  });
});

// ---------------------------------------------------------------------------
// Other tests
// ---------------------------------------------------------------------------
describe('hasPassive', () => {
  it('returns true when owned', () => {
    const sys = makeCheatingSystem();
    sys.addPassive('greed', 3);
    assert.strictEqual(sys.hasPassive('greed'), true);
  });

  it('returns false when not owned', () => {
    const sys = makeCheatingSystem();
    assert.strictEqual(sys.hasPassive('greed'), false);
  });
});

describe('getPassiveByEffect', () => {
  it('returns passive with effect type', () => {
    const sys = makeCheatingSystem();
    sys.addPassive('loaded_dice', 4);
    const passive = sys.getPassiveByEffect('dice_floor');
    assert.ok(passive != null);
    assert.strictEqual(passive.id, 'loaded_dice');
  });

  it('returns null when not found', () => {
    const sys = makeCheatingSystem();
    assert.strictEqual(sys.getPassiveByEffect('fake_effect'), null);
  });

  it('returns null when sealed', () => {
    const sys = makeCheatingSystem();
    sys.addPassive('loaded_dice', 4);
    sys.sealMostExpensivePassive();
    assert.strictEqual(sys.getPassiveByEffect('dice_floor'), null);
  });
});

describe('clearSealedPassive', () => {
  it('clears the sealed passive', () => {
    const sys = makeCheatingSystem();
    sys.addPassive('greed', 3);
    sys.sealMostExpensivePassive();
    assert.ok(sys._sealedPassiveId != null);
    sys.clearSealedPassive();
    assert.strictEqual(sys._sealedPassiveId, null);
  });
});

describe('reset', () => {
  it('clears all state', () => {
    const sys = makeCheatingSystem();
    sys.addConsumable('face_change');
    sys.addPassive('greed', 3);
    sys.sealMostExpensivePassive();
    sys.reset();
    assert.strictEqual(sys.getConsumables().length, 0);
    assert.strictEqual(sys.getPassives().length, 0);
    assert.strictEqual(sys._sealedPassiveId, null);
  });
});
