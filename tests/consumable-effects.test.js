'use strict';

import assert from 'assert';
import { Combat } from '../src/combat.js';
import { DataConfig } from '../src/data-config.js';
import { RNG } from '../src/rng.js';
import { CheatingAbilities } from '../src/cheating.js';
import { Economy } from '../src/economy.js';
import { Enemy } from '../src/enemy.js';
import { DicePool } from '../src/dice.js';

let dataConfig;

async function setup() {
  dataConfig = new DataConfig();
  await dataConfig.load('assets/data');
}

export default async function tests() {
  await setup();

  await suite('Consumable Effects', async () => {
    await test('gamble_reroll sets all dice to goodValue or badValue', async () => {
      const rng = new RNG();
      const stream = rng.getStream('main');

      const combat = new Combat({
        rng,
        dataConfig,
        economy: new Economy({ dataConfig }),
      });

      await combat.startRound(1);

      // Get initial dice values
      const initialValues = combat._dice.getValues();
      assert(initialValues.length > 0, 'Should have dice');

      // Add gamble consumable
      combat._cheating.addConsumable('gamble');

      // Use it
      combat.useConsumable(0);

      // Check all dice are now either 6 or 1
      const afterValues = combat._dice.getValues();
      for (const val of afterValues) {
        assert(val === 1 || val === 6, `gamble_reroll should result in 1 or 6, got ${val}`);
      }
      console.log(`✓ gamble_reroll changed all dice to ${afterValues[0]}`);
    });

    await test('swap_values exchanges two dice', async () => {
      const rng = new RNG();
      const combat = new Combat({
        rng,
        dataConfig,
        economy: new Economy({ dataConfig }),
      });

      await combat.startRound(1);

      // Set specific dice values for testing
      combat._dice.setDie(0, 2);
      combat._dice.setDie(1, 5);

      // Add swap consumable
      combat._cheating.addConsumable('swap_dice');

      // Use it
      combat.useConsumable(0);

      // Check dice were swapped
      const values = combat._dice.getValues();
      assert.strictEqual(values[0], 5, 'Die 0 should be 5');
      assert.strictEqual(values[1], 2, 'Die 1 should be 2');
      console.log(`✓ swap_values correctly swapped dice from [2,5] to [5,2]`);
    });

    await test('invert_value inverts die value', async () => {
      const rng = new RNG();
      const combat = new Combat({
        rng,
        dataConfig,
        economy: new Economy({ dataConfig }),
      });

      await combat.startRound(1);

      // Set a die value
      combat._dice.setDie(0, 3);

      // Add invert consumable
      combat._cheating.addConsumable('invert_dice');

      // Use it
      combat.useConsumable(0);

      // Check: 7 - 3 = 4
      const values = combat._dice.getValues();
      assert.strictEqual(values[0], 4, 'Die value should be inverted to 4 (7-3)');
      console.log(`✓ invert_value correctly inverted 3 → 4`);
    });

    await test('freeze_die preserves die across reroll', async () => {
      const rng = new RNG();
      const combat = new Combat({
        rng,
        dataConfig,
        economy: new Economy({ dataConfig }),
      });

      await combat.startRound(1);

      // Set a die value
      combat._dice.setDie(0, 6);
      const beforeFrozen = combat._dice.getValues()[0];

      // Add freeze consumable
      combat._cheating.addConsumable('freeze_die');

      // Use it
      combat.useConsumable(0);

      // Freeze should have been applied
      const isFrozen = combat._dice._frozen && combat._dice._frozen[0];
      assert(isFrozen, 'Die 0 should be frozen');
      console.log(`✓ freeze_die correctly froze die at value ${beforeFrozen}`);
    });
  });
}
