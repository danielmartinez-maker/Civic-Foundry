import type { GameApp } from '../app/GameApp.ts';
import { mapLandHousingOverlay, type LandHousingOverlayMode } from '../rendering/LandHousingOverlayLayer.ts';
import { DevelopmentPolicyPanel } from './DevelopmentPolicyPanel.ts';
import { LandHousingPanel } from './LandHousingPanel.ts';

const EXISTING_OVERLAY_SELECTORS = ['#overlay', '#service-overlay', '#transit-overlay', '#economy-overlay', '#urban-fabric-overlay'] as const;

export class LandHousingUiController {
  private readonly panel: HTMLElement;
  private readonly policyHost: HTMLElement;
  private readonly select: HTMLSelectElement;
  private readonly overlayCanvas: HTMLCanvasElement;
  private readonly overlayContext: CanvasRenderingContext2D;
  private readonly worldCanvas: HTMLCanvasElement;
  private readonly legend: HTMLElement;
  private readonly section: HTMLElement;
  private readonly abortController = new AbortController();
  private readonly panelRenderer = new LandHousingPanel();
  private readonly policyRenderer = new DevelopmentPolicyPanel();
  private mode: LandHousingOverlayMode = 'none';
  private synchronizing = false;
  private lastPanelBucket = -1;
  private lastCore: GameApp['core'] | null = null;
  private frameRequest: number | null = null;
  private disposed = false;

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
        <option value="tenure">Owner / renter tenure</option>
        <option value="relocation-pressure">Relocation pressure</option>
        <option value="redevelopment-pressure">Redevelopment pressure</option>
      </select>
      <div data-testid="land-housing-panel" class="economy-summary"></div>
      <div data-policy-host></div>`;
    economySection.insertAdjacentElement('afterend', section);
    this.section = section;
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
    this.scheduleFrame();
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.abortController.abort();
    if (this.frameRequest !== null) cancelAnimationFrame(this.frameRequest);
    this.frameRequest = null;
    this.overlayCanvas.remove();
    this.section.remove();
  }

  renderPanel(): void {
    if (this.disposed) return;
    this.panel.innerHTML = this.panelRenderer.render(
      this.app.core.landHousingMarketSnapshot,
      this.app.core.housingChoiceSnapshot,
      this.app.core.housingTenureSnapshot,
      this.app.core.housingRelocationSnapshot,
      this.app.core.redevelopmentPressureSnapshot,
      this.app.core.redevelopmentExecutionSnapshot,
    );
  }

  renderOverlay(): void {
    if (this.disposed) return;
    this.resizeOverlay();
    const rect = this.worldCanvas.getBoundingClientRect();
    this.overlayContext.clearRect(0, 0, rect.width, rect.height);
    if (this.mode === 'none') return;

    const snapshot = mapLandHousingOverlay(this.app.core, this.mode);
    const tileWidth = this.app.renderer.tileWidth;
    for (const item of snapshot.cells) {
      const center = this.app.renderer.worldToCanvas(item.x, item.y, this.app.core);
      const polygon = this.app.renderer.tilePolygon(item.x, item.y, this.app.core);
      const normalized = Math.max(0, Math.min(1, item.value));
      const hue = this.mode === 'affordability'
        ? Math.round(normalized * 120)
        : this.mode === 'occupancy'
          ? Math.round(210 - normalized * 170)
          : this.mode === 'tenure'
            ? Math.round(215 + normalized * 65)
            : Math.round(45 - normalized * 45);
      const insetPolygon = polygon.map((point) => ({
        x: center.x + (point.x - center.x) * 0.92,
        y: center.y + (point.y - center.y) * 0.92,
      }));

      this.overlayContext.save();
      this.overlayContext.fillStyle = `hsla(${hue}, 82%, 52%, ${0.20 + normalized * 0.42})`;
      this.overlayContext.beginPath();
      this.overlayContext.moveTo(insetPolygon[0]!.x, insetPolygon[0]!.y);
      for (let i = 1; i < insetPolygon.length; i += 1) this.overlayContext.lineTo(insetPolygon[i]!.x, insetPolygon[i]!.y);
      this.overlayContext.closePath();
      this.overlayContext.fill();
      if (tileWidth >= 40) {
        this.overlayContext.fillStyle = '#ffffff';
        this.overlayContext.strokeStyle = 'rgba(0,0,0,.72)';
        this.overlayContext.lineWidth = 2;
        this.overlayContext.font = `700 ${Math.max(8, tileWidth * 0.14)}px system-ui`;
        this.overlayContext.textAlign = 'center';
        this.overlayContext.textBaseline = 'middle';
        this.overlayContext.strokeText(item.label, center.x, center.y);
        this.overlayContext.fillText(item.label, center.x, center.y);
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
          lowerIncomeRelocationProtection: Number(this.required<HTMLInputElement>('[data-policy="lowerIncomeRelocationProtection"]').value) / 100,
        });
        this.syncPolicyControls();
        this.renderPanel();
        this.renderOverlay();
        status.textContent = `Policy applied: ${Math.round(state.affordableHousingShare * 100)}% affordable share · ${Math.round(state.redevelopmentAffordableFloor * 100)}% redevelopment floor · ${Math.round(state.lowerIncomeRelocationProtection * 100)}% lower-income relocation protection.`;
      } catch (error) {
        status.textContent = error instanceof Error ? error.message : 'Policy update failed.';
      }
    }, { signal: this.abortController.signal });
  }

  private syncPolicyControls(): void {
    const state = this.app.core.developmentPolicySnapshot;
    this.required<HTMLSelectElement>('[data-policy="densityBonus"]').value = String(state.densityBonus);
    this.required<HTMLInputElement>('[data-policy="affordableHousingShare"]').value = String(Math.round(state.affordableHousingShare * 100));
    this.required<HTMLInputElement>('[data-policy="developmentFeeRate"]').value = String(Math.round(state.developmentFeeRate * 100));
    this.required<HTMLInputElement>('[data-policy="permittingCostReduction"]').value = String(Math.round(state.permittingCostReduction * 100));
    this.required<HTMLInputElement>('[data-policy="redevelopmentAffordableFloor"]').value = String(Math.round(state.redevelopmentAffordableFloor * 100));
    this.required<HTMLInputElement>('[data-policy="lowerIncomeRelocationProtection"]').value = String(Math.round(state.lowerIncomeRelocationProtection * 100));
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
    }, { signal: this.abortController.signal });

    for (const selector of EXISTING_OVERLAY_SELECTORS) {
      this.required<HTMLSelectElement>(selector).addEventListener('change', (event) => {
        if (this.synchronizing) return;
        const control = event.currentTarget as HTMLSelectElement;
        if (control.value === 'none' || this.mode === 'none') return;
        this.mode = 'none';
        this.select.value = 'none';
        this.renderOverlay();
      }, { signal: this.abortController.signal });
    }
  }

  private scheduleFrame(): void {
    if (this.disposed) return;
    this.frameRequest = requestAnimationFrame(() => this.frame());
  }

  private frame(): void {
    if (this.disposed) return;
    this.frameRequest = null;
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
    this.scheduleFrame();
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
