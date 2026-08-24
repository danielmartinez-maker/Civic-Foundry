import type { DevelopmentPolicyState } from '../simulation/development/DevelopmentPolicySystem.ts';

const percent = (value: number): number => Math.round(value * 100);

export class DevelopmentPolicyPanel {
  render(state: DevelopmentPolicyState): string {
    return `<div class="development-policy" data-testid="development-policy-controls">
      <div class="policy-heading">Housing / development policy</div>
      <label class="policy-select-row"><span>Density bonus</span><select data-policy="densityBonus" data-testid="policy-density-bonus">
        <option value="0"${state.densityBonus === 0 ? ' selected' : ''}>Off</option>
        <option value="1"${state.densityBonus === 1 ? ' selected' : ''}>+1 residential intensity tier</option>
      </select></label>
      <label class="tax-row policy-row"><span>Affordable housing</span><input data-policy="affordableHousingShare" data-testid="policy-affordable-share" type="number" min="0" max="30" step="1" value="${percent(state.affordableHousingShare)}"><b>%</b></label>
      <label class="tax-row policy-row"><span>Development fee</span><input data-policy="developmentFeeRate" data-testid="policy-development-fee" type="number" min="0" max="20" step="1" value="${percent(state.developmentFeeRate)}"><b>%</b></label>
      <label class="tax-row policy-row"><span>Permitting incentive</span><input data-policy="permittingCostReduction" data-testid="policy-permitting-incentive" type="number" min="0" max="50" step="5" value="${percent(state.permittingCostReduction)}"><b>%</b></label>
      <label class="tax-row policy-row"><span>Redevelopment affordability floor</span><input data-policy="redevelopmentAffordableFloor" data-testid="policy-redevelopment-floor" type="number" min="75" max="100" step="1" value="${percent(state.redevelopmentAffordableFloor)}"><b>%</b></label>
      <button data-action="apply-development-policy" data-testid="apply-development-policy">Apply policy</button>
      <p class="legend" data-policy-status>Defaults preserve baseline economics. Policies affect future underwriting and current aggregate affordability.</p>
    </div>`;
  }
}
