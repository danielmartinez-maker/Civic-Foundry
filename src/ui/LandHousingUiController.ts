import type { GameApp } from '../app/GameApp.ts';
import { mapLandHousingOverlay, type LandHousingOverlayMode } from '../rendering/LandHousingOverlayLayer.ts';
import { DevelopmentPolicyPanel } from './DevelopmentPolicyPanel.ts';
import { LandHousingPanel } from './LandHousingPanel.ts';

const EXISTING_OVERLAY_SELECTORS = ['#overlay', '#service-overlay', '#transit-overlay', '#economy-overlay'] as const;

export class LandHousingUiController {
  private readonly panel: HTMLElement;
  private readonly policyHost: HTMLElement;
  private readonly select: HTMLSelectElement;
  private readonly overlayCanvas: HTMLCanvasElement;
  private readonly overlayContext: CanvasRenderingContext2D;
  private readonly worldCanvas: HTMLCanvasElement;
  private readonly legend: HTMLElement;
  private readonly panelRenderer = new LandHousingPanel();
  private readonly policyRenderer = new DevelopmentPolicyPanel();
  private mode: LandHousingOverlayMode = 'none';
  private synchronizing = false;
  private lastPanelBucket = -1;
  private lastCore: GameApp['core'] | null = null;

  constructor(private readonly app: GameApp, private readonly root: HTMLElement) {
    const economySection = this.required<HTMLElement>('[data-testid="economy-panel"]').closest<HTMLElement>('.panel-section');
    if (!economySection) throw new Error('Missing economy panel section');

    const section = document.createElement('div');
    section.className = 'panel-section';
    section.dataset.landHousingSection = '';
    section.innerHTML = `<h3>Land / housing</h3>
      <select data-testid="land-housing-overlay" aria-label="Land and housing overlay">
        <option value="none">Off</option>
        <option value="affordability">Housing affordability</option>
        <option value="occupancy">Residential occupancy</option>
        <option value="redevelopment-pressure">Redevelopment pressure</option>
      </select>
      <div data-testid="land-housing-panel" class="economy-summary"></div>
      <div data-policy-host></div>`;
    economySection.insertAdjacentElement('afterend', section);
    this.panel = this.required('[data-testid="land-housing-panel"]');
    this.policyHost = this.required('[data-policy-host]');
    this.select = this.required<HTMLSelectElement>('[data-testid="land-housing-overlay"]');
    this.legend = this.required('#overlay-legend');
    this.worldCanvas = this.required<HTMLCanvasElement>('#world');

    const canvasWrap = this.worldCanvas.parentElement;
    if (!canvasWrap?.classList.contains('canvas-wrap')) throw new Error('Missing canvas wrapper');
    this.overlayCanvas = document.createElement('canvas');
    this.overlayCanvas.dataset.testid = 'land-housing-overlay-canvas';
    this.overlayCanvas.setAttribute('aria-hidden', 'true');
    Object.assign(this.overlayCanvas.style, {
      position: 'absolute',
      inset: '0',
      width: '100%',
      height: '100%',
      pointerEvents: 'none',
    });
    const hint = canvasWrap.querySelector('.canvas-hint');
    canvasWrap.insertBefore(this.overlayCanvas, hint);
    const context = this.overlayCanvas.getContext('2d');
    if (!context) throw new Error('Canvas 2D is unavailable for land/housing overlay');
    this.overlayContext = context;

    this.policyHost.innerHTML = this.policyRenderer.render(this.app.core.developmentPolicySnapshot);
    this.bindOverlayControls();
    this.bindPolicyControls();
    this.renderPanel();
    this.lastCore = this.app.core;
    this.lastPanelBucket = Math.floor(this.app.core.clock.tick / 10);
    this.renderOverlay();
    requestAnimationFrame(() => this.frame());
  }

  renderPanel(): void {
    this.panel.innerHTML = this.panelRenderer.render(
      this.app.core.landHousingMarketSnapshot,
      this.app.core.housingChoiceSnapshot,
      this.app.core.redevelopmentPressureSnapshot,
      this.app.core.redevelopmentExecutionSnapshot,
    );
  }

  renderOverlay(): void {
    this.resizeOverlay();
    const rect = this.worldCanvas.getBoundingClientRect();
    this.overlayContext.clearRect(0, 0, rect.width, rect.height);
    if (this.mode === 'none') return;

    const snapshot = mapLandHousingOverlay(this.app.core, this.mode);
    for (const item of snapshot.cells) {
      const point = this.app.renderer.worldToCanvas(item.x, item.y, this.app.core);
      const size = this.app.renderer.cellSize;
      const inset = Math.max(1, size * 0.05);
      const normalized = Math.max(0, Math.min(1, item.value));
      const hue = this.mode === 'affordability'
        ? Math.round(normalized * 120)
        : this.mode === 'occupancy'
          ? Math.round(210 - normalized * 170)
          : Math.round(45 - normalized * 45);

      this.overlayContext.save();
      this.overlayContext.fillStyle = `hsla(${hue}, 82%, 52%, ${0.20 + normalized * 0.42})`;
      this.overlayContext.fillRect(point.x + inset, point.y + inset, size - inset * 2, size - inset * 2);
      if (size >= 20) {
        this.overlayContext.fillStyle = '#ffffff';
        this.overlayContext.strokeStyle = 'rgba(0,0,0,.72)';
        this.overlayContext.lineWidth = 2;
        this.overlayContext.font = `700 ${Math.max(8, size * 0.27)}px system-ui`;
        this.overlayContext.textAlign = 'center';
        this.overlayContext.textBaseline = 'middle';
        this.overlayContext.strokeText(item.label, point.x + size / 2, point.y + size / 2);
        this.overlayContext.fillText(item.label, point.x + size / 2, point.y + size / 2);
      }
      this.overlayContext.restore();
    }
  }

  private bindPolicyControls(): void {
    this.required<HTMLButtonElement>('[data-action="apply-development-policy"]').addEventListener('click', () => {
      const status = this.required<HTMLElement>('[data-policy-status]');
      try {
        const state = this.app.core.setDevelopmentPolicy({
          densityBonus: Number(this.required<HTMLSelectElement>('[data-policy="densityBonus"]').value) as 0 | 1,
          affordableHousingShare: Number(this.required<HTMLInputElement>('[data-policy="affordableHousingShare"]').value) / 100,
          developmentFeeRate: Number(this.required<HTMLInputElement>('[data-policy="developmentFeeRate"]').value) / 100,
          permittingCostReduction: Number(this.required<HTMLInputElement>('[data-policy="permittingCostReduction"]').value) / 100,
          redevelopmentAffordableFloor: Number(this.required<HTMLInputElement>('[data-policy="redevelopmentAffordableFloor"]').value) / 100,
        });
        this.syncPolicyControls();
        this.renderPanel();
        this.renderOverlay();
        status.textContent = `Policy applied: ${Math.round(state.affordableHousingShare * 100)}% affordable share · ${Math.round(state.redevelopmentAffordableFloor * 100)}% redevelopment floor.`;
      } catch (error) {
        status.textContent = error instanceof Error ? error.message : 'Policy update failed.';
      }
    });
  }

  private syncPolicyControls(): void {
    const state = this.app.core.developmentPolicySnapshot;
    this.required<HTMLSelectElement>('[data-policy="densityBonus"]').value = String(state.densityBonus);
    this.required<HTMLInputElement>('[data-policy="affordableHousingShare"]').value = String(Math.round(state.affordableHousingShare * 100));
    this.required<HTMLInputElement>('[data-policy="developmentFeeRate"]').value = String(Math.round(state.developmentFeeRate * 100));
    this.required<HTMLInputElement>('[data-policy="permittingCostReduction"]').value = String(Math.round(state.permittingCostReduction * 100));
    this.required<HTMLInputElement>('[data-policy="redevelopmentAffordableFloor"]').value = String(Math.round(state.redevelopmentAffordableFloor * 100));
  }

  private bindOverlayControls(): void {
    this.select.addEventListener('change', () => {
      this.mode = this.select.value as LandHousingOverlayMode;
      if (this.mode !== 'none') {
        this.synchronizing = true;
        for (const selector of EXISTING_OVERLAY_SELECTORS) {
          const control = this.required<HTMLSelectElement>(selector);
          if (control.value === 'none') continue;
          control.value = 'none';
          control.dispatchEvent(new Event('change', { bubbles: true }));
        }
        this.synchronizing = false;
      }
      this.legend.textContent = mapLandHousingOverlay(this.app.core, this.mode).legend;
      this.renderOverlay();
    });

    for (const selector of EXISTING_OVERLAY_SELECTORS) {
      this.required<HTMLSelectElement>(selector).addEventListener('change', (event) => {
        if (this.synchronizing) return;
        const control = event.currentTarget as HTMLSelectElement;
        if (control.value === 'none' || this.mode === 'none') return;
        this.mode = 'none';
        this.select.value = 'none';
        this.renderOverlay();
      });
    }
  }

  private frame(): void {
    const currentCore = this.app.core;
    const bucket = Math.floor(currentCore.clock.tick / 10);
    if (currentCore !== this.lastCore || bucket !== this.lastPanelBucket) {
      const coreChanged = currentCore !== this.lastCore;
      this.lastCore = currentCore;
      this.lastPanelBucket = bucket;
      this.renderPanel();
      if (coreChanged) this.syncPolicyControls();
    }
    if (this.mode !== 'none') this.renderOverlay();
    requestAnimationFrame(() => this.frame());
  }

  private resizeOverlay(): void {
    const rect = this.worldCanvas.getBoundingClientRect();
    const dpr = Math.max(1, window.devicePixelRatio || 1);
    const width = Math.max(1, Math.round(rect.width * dpr));
    const height = Math.max(1, Math.round(rect.height * dpr));
    if (this.overlayCanvas.width !== width || this.overlayCanvas.height !== height) {
      this.overlayCanvas.width = width;
      this.overlayCanvas.height = height;
    }
    this.overlayContext.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  private required<T extends Element = HTMLElement>(selector: string): T {
    const element = this.root.querySelector<T>(selector);
    if (!element) throw new Error(`Missing UI element: ${selector}`);
    return element;
  }
}
