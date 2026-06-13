import { describe, it, before, beforeEach } from 'node:test';
import assert from 'assert';
import { CheatingAbilities } from '../src/cheating.js';
import { DataConfig } from '../src/data-config.js';
import { DicePool } from '../src/dice.js';

describe('Synergy Logic', () => {
  let dataConfig;
  let cheating;
  let dicePool;

  before(async () => {
    dataConfig = new DataConfig();
    await dataConfig.load('./assets/data');
    dicePool = new DicePool({ dataConfig });
  });

  beforeEach(() => {
    cheating = new CheatingAbilities({ dataConfig });
  });

  it('should detect power_synergy (loaded_dice + heaven_dice)', () => {
    cheating.addPassive('loaded_dice', 4);
    cheating.addPassive('heaven_dice', 5);
    
    const synergies = cheating._getActiveSynergies();
    assert.ok(synergies.some(s => s.id === 'power_synergy'), 'Power synergy should be active');
    
    // Check flat bonus
    const matchedCategory = dataConfig.getCategory('pair');
    const flatBonus = cheating.getFlatBonuses(matchedCategory, dicePool, 2);
    // heaven_dice (+15) + power_synergy (+5) = 20
    assert.strictEqual(flatBonus, 20);
  });

  it('should detect excess_synergy (chain_link + hidden_strength)', () => {
    cheating.addPassive('chain_link', 4);
    cheating.addPassive('hidden_strength', 4);
    
    const synergies = cheating._getActiveSynergies();
    assert.ok(synergies.some(s => s.id === 'excess_synergy'), 'Excess synergy should be active');
    
    // Set downgrade bonus manually for testing (as it's usually computed in Combat)
    cheating._downgradeBonus = 8; // 1 level
    
    const matchedCategory = dataConfig.getCategory('pair');
    const flatBonus = cheating.getFlatBonuses(matchedCategory, dicePool, 2);
    // hidden_strength (8) + excess_synergy (+2) = 10
    // Note: chain_link bonus only applies if matchedCount > minDice, which is not the case for pair with 2 dice.
    assert.strictEqual(flatBonus, 10);
  });

  it('should detect universal_synergy (greed + judgment_flip)', () => {
    cheating.addPassive('greed', 3);
    cheating.addPassive('judgment_flip', 4);
    
    const synergies = cheating._getActiveSynergies();
    assert.ok(synergies.some(s => s.id === 'universal_synergy'), 'Universal synergy should be active');
    
    const reduction = cheating.getVictoryThresholdReduction();
    assert.strictEqual(reduction, 0.05);
  });

  it('should not activate synergy if one component is missing', () => {
    cheating.addPassive('loaded_dice', 4);
    const synergies = cheating._getActiveSynergies();
    assert.strictEqual(synergies.length, 0);
  });

  it('should not activate synergy if one component is sealed', () => {
    cheating.addPassive('loaded_dice', 4);
    cheating.addPassive('heaven_dice', 5);
    cheating.sealPassive('loaded_dice');
    
    const synergies = cheating._getActiveSynergies();
    assert.strictEqual(synergies.length, 0);
  });
});
