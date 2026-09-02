import type { GameApp } from '../app/GameApp.ts';
import type { UrbanFabricOverlayMode } from '../rendering/CadastralOverlayLayer.ts';
import { ParcelInspector } from './ParcelInspector.ts';

declare module '../app/GameApp.ts' {
  interface GameApp {
    urbanFabricOverlayMode?: UrbanFabricOverlayMode;
  }
}

const EXCLUSIVE_OVERLAY_SELECTORS = ['#overlay', '#service-overlay', '#transit-overlay', '#economy-overlay'] as const;

const LEGENDS: Record<UrbanFabricOverlayMode, string> = {
  none: 'Overlay off.',
  cadastre: 'Cadastre: canonical parcel boundaries, frontage, access, and block geometry.',
  'zoning-envelope': 'Zoning envelope: selected parcel buildable footprint, setback exclusions, and legal height.',
  redevelopment: 'Redevelopment: canonical parcel redevelopment pressure and constraints.',
};

export class UrbanFabricUiController {
  private readonly select: HTMLSelectElement;
  private readonly legend: HTMLElement;
  private readonly worldCanvas: HTMLCanvasElement;
  private readonly inspector: HTMLElement;
  private readonly section: HTMLElement;
  private readonly abortController = new AbortController();
  private mode: UrbanFabricOverlayMode = 'none';
  private synchronizing = false;
  private selectedParcelId: string | null = null;
  private disposed = false;

  constructor(private readonly app: GameApp, private readonly root: HTMLElement) {
    const economySection = this.required<HTMLElement>('[data-testid="economy-panel"]').closest<HTMLElement>('.panel-section');
    if (!economySection) throw new Error('Missing economy panel section');

    const section = document.createElement('div');
    section.className = 'panel-section';
    section.dataset.urbanFabricSection = '';
    section.innerHTML = `<h3>Urban fabric</h3>
      <select id="urban-fabric-overlay" data-testid="urban-fabric-overlay" aria-label="Urban fabric overlay">
        <option value="none">Off</option>
        <option value="cadastre">Cadastre</option>
        <option value="zoning-envelope">Zoning envelope</option>
        <option value="redevelopment">Redevelopment</option>
      </select>`;
    economySection.insertAdjacentElement('afterend', section);
    this.section = section;

    this.select = this.required<HTMLSelectElement>('#urban-fabric-overlay');
    this.legend = this.required('#overlay-legend');
    this.worldCanvas = this.required<HTMLCanvasElement>('#world');
    this.inspector = this.required<HTMLElement>('#inspector-content');
    Object.defineProperty(this.app, 'urbanFabricOverlayMode', {
      configurable: true,
      enumerable: true,
      get: () => this.mode,
    });

    this.bindControls();
    this.app.renderer.setUrbanFabricOverlay('none');
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.abortController.abort();
    this.mode = 'none';
    this.selectedParcelId = null;
    this.app.renderer.setUrbanFabricOverlay('none');
    delete this.app.urbanFabricOverlayMode;
    this.section.remove();
  }

  private bindControls(): void {
    this.select.addEventListener('change', () => {
      this.mode = this.select.value as UrbanFabricOverlayMode;
      if (this.mode !== 'none') this.disableCompetingOverlays();
      if (this.mode === 'none') this.selectedParcelId = null;
      this.app.renderer.setUrbanFabricOverlay(this.mode, this.selectedParcelId);
      this.legend.textContent = LEGENDS[this.mode];
    }, { signal: this.abortController.signal });

    for (const selector of EXCLUSIVE_OVERLAY_SELECTORS) {
      this.required<HTMLSelectElement>(selector).addEventListener('change', (event) => {
        if (this.synchronizing) return;
        const control = event.currentTarget as HTMLSelectElement;
        if (control.value === 'none' || this.mode === 'none') return;
        this.mode = 'none';
        this.selectedParcelId = null;
        this.select.value = 'none';
        this.app.renderer.setUrbanFabricOverlay('none');
      }, { signal: this.abortController.signal });
    }

    this.worldCanvas.addEventListener('pointerdown', (event) => {
      if (event.button !== 0 || this.mode === 'none') return;
      const cell = this.app.renderer.canvasToCell(event.clientX, event.clientY, this.app.core);
      this.selectedParcelId = cell ? this.app.tools.parcelIdAt(this.app.core, cell.x, cell.y) : null;
      this.app.renderer.setUrbanFabricOverlay(this.mode, this.selectedParcelId);
      if (!this.selectedParcelId || this.app.tools.activeTool !== 'inspect') return;
      this.inspector.innerHTML = new ParcelInspector().render(this.selectedParcelId, this.app.core);
    }, { signal: this.abortController.signal });
  }

  private disableCompetingOverlays(): void {
    this.synchronizing = true;
    for (const selector of EXCLUSIVE_OVERLAY_SELECTORS) {
      const control = this.required<HTMLSelectElement>(selector);
      if (control.value === 'none') continue;
      control.value = 'none';
      control.dispatchEvent(new Event('change', { bubbles: true }));
    }
    this.synchronizing = false;
  }

  private required<T extends Element = HTMLElement>(selector: string): T {
    const element = this.root.querySelector<T>(selector);
    if (!element) throw new Error(`Missing UI element: ${selector}`);
    return element;
  }
}
