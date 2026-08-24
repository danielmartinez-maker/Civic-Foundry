import test from 'node:test';
import assert from 'node:assert/strict';
import { DevelopmentPolicyPanel } from '../src/ui/DevelopmentPolicyPanel.ts';

const state = {
  densityBonus: 1 as const,
  affordableHousingShare: 0.20,
  developmentFeeRate: 0.05,
  permittingCostReduction: 0.25,
  redevelopmentAffordableFloor: 0.95,
  lowerIncomeRelocationProtection: 0.90,
};

test('development policy panel exposes all approved player controls and current values', () => {
  const html = new DevelopmentPolicyPanel().render(state);
  for (const label of [
    'Density bonus',
    'Affordable housing',
    'Development fee',
    'Permitting incentive',
    'Redevelopment affordability floor',
    'Lower-income relocation protection',
  ]) {
    assert.match(html, new RegExp(label, 'i'));
  }
  assert.match(html, /data-policy="densityBonus"/);
  assert.match(html, /data-policy="affordableHousingShare"/);
  assert.match(html, /data-policy="developmentFeeRate"/);
  assert.match(html, /data-policy="permittingCostReduction"/);
  assert.match(html, /data-policy="redevelopmentAffordableFloor"/);
  assert.match(html, /data-policy="lowerIncomeRelocationProtection"/);
  assert.match(html, /data-testid="policy-lower-income-relocation"/);
  assert.match(html, /value="20"/);
  assert.match(html, /value="5"/);
  assert.match(html, /value="25"/);
  assert.match(html, /value="95"/);
  assert.match(html, /value="90"/);
  assert.match(html, /Apply policy/i);
});
