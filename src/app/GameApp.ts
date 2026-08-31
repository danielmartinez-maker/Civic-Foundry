import { SimulationCore } from '../simulation/core/SimulationCore.ts';
import type { CellCoord, SpeedMode, ZoneType } from '../simulation/core/types.ts';
import { hydrateCore, serializeCore } from '../save/save.ts';
import { createPresentationRenderer, resolvePresentationBackend } from '../rendering/PresentationRendererFactory.ts';
import type { CellSelection, PresentationRenderer } from '../rendering/PresentationRenderer.ts';
import type { TrafficOverlayMode } from '../rendering/TrafficOverlayLayer.ts';
import { mapServiceOverlay, type ServiceOverlayMode } from '../rendering/ServiceOverlayLayer.ts';
import { mapTransitOverlay, type TransitOverlayMode } from '../rendering/TransitOverlayLayer.ts';
import type { ServiceDepartment } from '../data/services.ts';
import type { TransitMode } from '../data/transit.ts';
import { collectHudMetrics, HudView } from '../ui/Hud.ts';
import { inspectCell, inspectTransitLine, inspectTransitVehicle, type Inspection } from '../ui/Inspector.ts';
import { ToolController, type ToolId } from '../ui/ToolController.ts';
import { collectTransitPanelState, TransitPanelController } from '../ui/TransitPanel.ts';
import { EconomyPanel } from '../ui/EconomyPanel.ts';
import { escapeHtml } from '../ui/escapeHtml.ts';
import { mapEconomyOverlay, type EconomyOverlayMode } from '../rendering/EconomyOverlayLayer.ts';

const STORAGE_KEY = 'civic-foundry-save-v7';
const LEGACY_STORAGE_KEY = 'civic-foundry-save-v6';
const SERVICE_DEPARTMENT_LABELS: Readonly<Record<ServiceDepartment, string>> = Object.freeze({
  fire: 'Fire',
  police: 'Police',
  healthcare: 'Healthcare',
  education: 'Education',
  garbage: 'Waste',
});
const TOOLS: readonly [ToolId, string, string][] = [
  ['inspect', 'Inspect', 'I'], ['road-local', 'Local', 'R'], ['road-collector', 'Collector', 'C'], ['road-arterial', 'Arterial', 'A'],
  ['zone-residential', 'Residential', '1'], ['zone-commercial', 'Commercial', '2'], ['zone-industrial', 'Industrial', '3'],
  ['power', 'Power', 'P'], ['water', 'Water', 'W'], ['landfill', 'Legacy landfill', 'G'],
  ['service-fire', 'Fire Station', '4'], ['service-police', 'Police Station', '5'], ['service-clinic', 'Clinic', '6'],
  ['service-school', 'Elementary School', '7'], ['service-landfill', 'Service Landfill', '8'], ['service-recycling', 'Recycling Center', '9'],
  ['transit-stop', 'Transit Stop', 'T'], ['transit-metro-station', 'Metro Station', 'M'],
  ['bulldoze', 'Bulldoze', 'B'],
];

export class GameApp {
  core: SimulationCore;
  readonly tools = new ToolController();
  readonly renderer: PresentationRenderer;
  private readonly hud: HudView;
  private readonly inspector: HTMLElement;
  private readonly notification: HTMLElement;
  private readonly overlayLegend: HTMLElement;
  private readonly root: HTMLElement;
  private overlayMode: TrafficOverlayMode = 'none';
  private serviceOverlayMode: ServiceOverlayMode = 'none';
  private transitOverlayMode: TransitOverlayMode = 'none';
  private economyOverlayMode: EconomyOverlayMode = 'none';
  private readonly activeAlertKeys = new Set<string>();
  private selected: CellSelection = null;
  private dragRoadStart: CellCoord | null = null;
  private previewPath: CellCoord[] = [];
  private panPointer: { x: number; y: number } | null = null;
  private lastFrame = performance.now();
  private tickAccumulator = 0;
  private fallbackSave: string | null = null;
  private lastTransitStatusTick = -1;

  constructor(root: HTMLElement) {
    this.root = root;
    this.core = new SimulationCore({ width: 40, height: 24, seed: 42, startingFunds: 250_000 });
    root.innerHTML = this.layoutHtml();
    const canvas = this.required<HTMLCanvasElement>('#world');
    const backend = resolvePresentationBackend(window.location.search);
    this.renderer = createPresentationRenderer(canvas, backend);
    this.hud = new HudView(this.required('#hud'));
    this.inspector = this.required('#inspector-content');
    this.notification = this.required('#notification');
    this.overlayLegend = this.required('#overlay-legend');
    this.bindTools();
    this.bindControls();
    this.bindCanvas(canvas);
    this.selectTool('inspect');
    this.renderTransitPanel();
    this.renderEconomyPanel();
    this.updateOverlayLegend();
    requestAnimationFrame((time) => this.frame(time));
  }

  private layoutHtml(): string {
    const toolButtons = TOOLS.map(([id, label, key]) => `<button class="tool-btn" data-tool="${id}" data-testid="tool-${id}"><span>${label}</span><kbd>${key}</kbd></button>`).join('');
    const speedButtons = [0, 1, 2, 4].map((speed) => `<button data-speed="${speed}" data-testid="speed-${speed}">${speed === 0 ? 'Pause' : `${speed}×`}</button>`).join('');
    const taxRows = (['residential', 'commercial', 'industrial'] as ZoneType[]).map((zone) => `<label class="tax-row"><span>${zone[0]!.toUpperCase()}</span><input data-tax="${zone}" type="number" min="0" max="25" step="0.5" value="10"><b>%</b></label>`).join('');
    const serviceBudgetRows = (['fire', 'police', 'healthcare', 'education', 'garbage'] as ServiceDepartment[]).map((department) => `<label class="tax-row"><span>${SERVICE_DEPARTMENT_LABELS[department]}</span><input data-service-budget="${department}" data-testid="budget-${department}" type="number" min="50" max="150" step="5" value="100"><b>%</b></label>`).join('');
    return `<div class="game-shell">
      <header class="topbar"><div><div class="eyebrow">URBAN FABRIC 2.0 · DESKTOP GPU RUNTIME</div><h1>CIVIC FOUNDRY</h1></div>
        <div class="top-actions"><button data-action="save" data-testid="save">Save V9</button><button data-action="load" data-testid="load">Load</button></div></header>
      <section id="hud" class="hud"></section>
      <main class="workspace">
        <aside class="toolbox"><h2>Build</h2>${toolButtons}
          <div class="panel-section"><h3>Speed</h3><div class="segmented">${speedButtons}</div></div>
          <div class="panel-section"><h3>Traffic</h3><select id="overlay" data-testid="traffic-overlay"><option value="none">Off</option><option value="congestion">Congestion</option><option value="speed">Speed</option><option value="volume">Volume</option><option value="bottlenecks">Bottlenecks</option></select></div>
          <div class="panel-section"><h3>Services</h3><select id="service-overlay" data-testid="service-overlay"><option value="none">Off</option><option value="quality">Combined quality</option><option value="fire">Fire</option><option value="police">Police</option><option value="healthcare">Healthcare</option><option value="education">Education</option><option value="garbage">Waste</option></select></div>
          <div class="panel-section"><h3>Transit overlay</h3><select id="transit-overlay" data-testid="transit-overlay"><option value="none">Off</option><option value="routes">Routes / modes</option><option value="access">Stop access</option><option value="ridership">Ridership</option><option value="crowding">Crowding</option><option value="wait">Average wait</option><option value="reliability">Reliability</option><option value="mode-share">Mode share</option><option value="accessibility">Person accessibility</option></select></div>
          <div class="panel-section"><h3>Economy / freight</h3><select id="economy-overlay" data-testid="economy-overlay"><option value="none">Off</option><option value="firm-health">Firm health</option><option value="jobs">Jobs</option><option value="production">Production stock</option><option value="shortages">Shortages</option><option value="freight-volume">Freight volume</option><option value="freight-routes">Freight routes</option><option value="logistics-delay">Logistics delay</option><option value="gateways">Gateways</option><option value="trade-flow">Trade flow</option></select><p id="overlay-legend" class="legend"></p><div data-economy-summary data-testid="economy-panel" class="economy-summary"></div></div>
          <div class="panel-section transit-panel" data-testid="transit-panel"><h3>Transit lines</h3>
            <label class="field-row"><span>Mode</span><select data-transit-mode data-testid="transit-mode"><option value="bus">Bus</option><option value="brt">BRT</option><option value="tram">Tram</option><option value="metro">Metro</option></select></label>
            <label class="field-row"><span>Name</span><input data-transit-name data-testid="transit-name" value="Crosstown"></label>
            <button data-action="create-transit-line" data-testid="create-transit-line">Create line</button>
            <label class="field-row"><span>Line</span><select data-transit-line data-testid="transit-line"></select></label>
            <div class="route-editor"><label><span>From</span><select data-transit-origin data-testid="transit-origin"></select></label><label><span>To</span><select data-transit-destination data-testid="transit-destination"></select></label></div>
            <button data-action="set-transit-route" data-testid="set-transit-route">Set initial route</button>
            <label class="field-row"><span>Add stop</span><select data-transit-append-stop data-testid="transit-append-stop"></select></label><button data-action="append-transit-stop" data-testid="append-transit-stop">Append stop</button>
            <label class="field-row"><span>Remove</span><select data-transit-remove-stop data-testid="transit-remove-stop"></select></label><button data-action="remove-transit-stop" data-testid="remove-transit-stop">Remove stop</button>
            <div class="transit-config"><label><span>Headway</span><input data-transit-headway data-testid="transit-headway" type="number" min="20" max="600" step="5"></label><label><span>Fare</span><input data-transit-fare data-testid="transit-fare" type="number" min="0" max="20" step="0.25"></label><label><span>Fleet</span><input data-transit-fleet data-testid="transit-fleet" type="number" min="0" max="50" step="1"></label></div>
            <label class="toggle-row"><input data-transit-enabled data-testid="transit-enabled" type="checkbox"><span>Line enabled</span></label>
            <button data-action="apply-transit-config" data-testid="apply-transit-config">Apply service settings</button>
            <div class="transit-inspect-actions"><button data-action="inspect-transit-line" data-testid="inspect-transit-line">Inspect line</button><select data-transit-vehicle data-testid="transit-vehicle"></select><button data-action="inspect-transit-vehicle" data-testid="inspect-transit-vehicle">Inspect vehicle</button></div>
            <div class="transit-summary" data-transit-summary data-testid="transit-summary">No transit lines.</div>
          </div>
          <div class="panel-section"><h3>Service budgets</h3>${serviceBudgetRows}</div>
          <div class="panel-section"><h3>Tax rates</h3>${taxRows}</div>
        </aside>
        <section class="canvas-wrap"><canvas id="world" data-testid="world-canvas"></canvas><div class="canvas-hint">Drag roads · wheel zoom · right/middle drag pan · Q/E rotate</div></section>
        <aside class="inspector"><h2>Inspector</h2><div id="inspector-content">Select a cell.</div><div class="debug"><h3>Traffic diagnostics</h3><div data-debug="pathfinding"></div><div data-debug="traffic"></div></div></aside>
      </main>
      <div id="notification" class="notification" role="status"></div>
    </div>`;
  }

  private bindTools(): void {
    this.root.querySelectorAll<HTMLButtonElement>('[data-tool]').forEach((button) => {
      button.addEventListener('click', () => this.selectTool(button.dataset.tool as ToolId));
    });
  }

  private bindControls(): void {
    this.root.querySelector('[data-action="save"]')?.addEventListener('click', () => this.save());
    this.root.querySelector('[data-action="load"]')?.addEventListener('click', () => this.load());
    this.root.querySelectorAll<HTMLButtonElement>('[data-speed]').forEach((button) => button.addEventListener('click', () => {
      this.core.clock.setSpeed(Number(button.dataset.speed) as SpeedMode);
      this.updateSpeedButtons();
    }));
    this.root.querySelectorAll<HTMLInputElement>('[data-tax]').forEach((input) => input.addEventListener('change', () => {
      this.core.taxes.setRate(input.dataset.tax as ZoneType, Number(input.value) / 100);
      input.value = String(this.core.taxes.getRate(input.dataset.tax as ZoneType) * 100);
    }));
    this.required<HTMLSelectElement>('#overlay').addEventListener('change', (event) => {
      this.overlayMode = (event.currentTarget as HTMLSelectElement).value as TrafficOverlayMode;
      if (this.overlayMode !== 'none') { this.serviceOverlayMode = 'none'; this.transitOverlayMode = 'none'; this.economyOverlayMode = 'none'; this.required<HTMLSelectElement>('#service-overlay').value = 'none'; this.required<HTMLSelectElement>('#transit-overlay').value = 'none'; this.required<HTMLSelectElement>('#economy-overlay').value = 'none'; }
      this.updateOverlayLegend();
    });
    this.required<HTMLSelectElement>('#service-overlay').addEventListener('change', (event) => {
      this.serviceOverlayMode = (event.currentTarget as HTMLSelectElement).value as ServiceOverlayMode;
      if (this.serviceOverlayMode !== 'none') { this.overlayMode = 'none'; this.transitOverlayMode = 'none'; this.economyOverlayMode = 'none'; this.required<HTMLSelectElement>('#overlay').value = 'none'; this.required<HTMLSelectElement>('#transit-overlay').value = 'none'; this.required<HTMLSelectElement>('#economy-overlay').value = 'none'; }
      this.updateOverlayLegend();
    });
    this.required<HTMLSelectElement>('#transit-overlay').addEventListener('change', (event) => {
      this.transitOverlayMode = (event.currentTarget as HTMLSelectElement).value as TransitOverlayMode;
      if (this.transitOverlayMode !== 'none') { this.overlayMode = 'none'; this.serviceOverlayMode = 'none'; this.economyOverlayMode = 'none'; this.required<HTMLSelectElement>('#overlay').value = 'none'; this.required<HTMLSelectElement>('#service-overlay').value = 'none'; this.required<HTMLSelectElement>('#economy-overlay').value = 'none'; }
      this.updateOverlayLegend();
    });
    this.required<HTMLSelectElement>('#economy-overlay').addEventListener('change', (event) => {
      this.economyOverlayMode = (event.currentTarget as HTMLSelectElement).value as EconomyOverlayMode;
      if (this.economyOverlayMode !== 'none') { this.overlayMode = 'none'; this.serviceOverlayMode = 'none'; this.transitOverlayMode = 'none'; this.required<HTMLSelectElement>('#overlay').value = 'none'; this.required<HTMLSelectElement>('#service-overlay').value = 'none'; this.required<HTMLSelectElement>('#transit-overlay').value = 'none'; }
      this.updateOverlayLegend();
    });
    this.root.querySelectorAll<HTMLInputElement>('[data-service-budget]').forEach((input) => input.addEventListener('change', () => {
      const department = input.dataset.serviceBudget as ServiceDepartment;
      const result = this.core.setServiceFunding(department, Number(input.value));
      input.value = String(result);
      this.flash(`${department} funding set to ${result}%.`, 'ok');
    }));
    this.bindTransitControls();
    window.addEventListener('keydown', (event) => this.keydown(event));
    this.updateSpeedButtons();
  }

  private bindTransitControls(): void {
    this.root.querySelector('[data-action="create-transit-line"]')?.addEventListener('click', () => {
      const mode = this.required<HTMLSelectElement>('[data-transit-mode]').value as TransitMode;
      const name = this.required<HTMLInputElement>('[data-transit-name]').value;
      const lineId = new TransitPanelController(this.core).createLine(mode, name);
      this.renderTransitPanel(lineId);
      this.flash(`Created ${mode} line.`, 'ok');
    });
    this.required<HTMLSelectElement>('[data-transit-line]').addEventListener('change', () => this.syncTransitLineInputs());
    this.root.querySelector('[data-action="set-transit-route"]')?.addEventListener('click', () => {
      const lineId = this.selectedTransitLineId();
      const origin = this.required<HTMLSelectElement>('[data-transit-origin]').value;
      const destination = this.required<HTMLSelectElement>('[data-transit-destination]').value;
      if (!lineId || !origin || !destination || origin === destination) { this.flash('Choose a line and two different compatible stops.', 'error'); return; }
      this.applyTransitCommand(new TransitPanelController(this.core).setLineStops(lineId, [origin, destination]), 'Route updated.');
    });
    this.root.querySelector('[data-action="append-transit-stop"]')?.addEventListener('click', () => {
      const lineId = this.selectedTransitLineId();
      const stopId = this.required<HTMLSelectElement>('[data-transit-append-stop]').value;
      if (!lineId || !stopId) { this.flash('Choose a line and stop.', 'error'); return; }
      this.applyTransitCommand(new TransitPanelController(this.core).appendStop(lineId, stopId), 'Stop appended.');
    });
    this.root.querySelector('[data-action="remove-transit-stop"]')?.addEventListener('click', () => {
      const lineId = this.selectedTransitLineId();
      const stopId = this.required<HTMLSelectElement>('[data-transit-remove-stop]').value;
      if (!lineId || !stopId) { this.flash('Choose a line and route stop.', 'error'); return; }
      this.applyTransitCommand(new TransitPanelController(this.core).removeStop(lineId, stopId), 'Stop removed.');
    });
    this.root.querySelector('[data-action="apply-transit-config"]')?.addEventListener('click', () => {
      const lineId = this.selectedTransitLineId();
      if (!lineId) { this.flash('Create or select a transit line first.', 'error'); return; }
      const result = new TransitPanelController(this.core).applyLineConfig(lineId, {
        headwayTicks: Number(this.required<HTMLInputElement>('[data-transit-headway]').value),
        fare: Number(this.required<HTMLInputElement>('[data-transit-fare]').value),
        fleetLimit: Number(this.required<HTMLInputElement>('[data-transit-fleet]').value),
        enabled: this.required<HTMLInputElement>('[data-transit-enabled]').checked,
      });
      this.applyTransitCommand(result, 'Transit service settings applied.');
    });
    this.root.querySelector('[data-action="inspect-transit-line"]')?.addEventListener('click', () => {
      const lineId = this.selectedTransitLineId();
      if (lineId) this.renderInspection(inspectTransitLine(this.core, lineId));
    });
    this.root.querySelector('[data-action="inspect-transit-vehicle"]')?.addEventListener('click', () => {
      const vehicleId = this.required<HTMLSelectElement>('[data-transit-vehicle]').value;
      if (vehicleId) this.renderInspection(inspectTransitVehicle(this.core, vehicleId));
    });
  }

  private applyTransitCommand(result: Readonly<{ ok: boolean; reason?: string }>, success: string): void {
    this.flash(result.ok ? success : result.reason ?? 'Transit command failed.', result.ok ? 'ok' : 'error');
    this.renderTransitPanel(this.selectedTransitLineId() ?? undefined);
    this.updateOverlayLegend();
  }

  private selectedTransitLineId(): string | null {
    const value = this.root.querySelector<HTMLSelectElement>('[data-transit-line]')?.value ?? '';
    return value || null;
  }

  private renderTransitPanel(preferredLineId?: string): void {
    const currentLineId = preferredLineId ?? this.selectedTransitLineId();
    const lines = this.core.transit.listLines();
    const stops = this.core.transit.listStops();
    const lineSelect = this.required<HTMLSelectElement>('[data-transit-line]');
    lineSelect.innerHTML = lines.length > 0 ? lines.map((line) => `<option value="${line.id}">${escapeHtml(line.name)} · ${line.mode}</option>`).join('') : '<option value="">No lines</option>';
    if (currentLineId && lines.some((line) => line.id === currentLineId)) lineSelect.value = currentLineId;
    const stopOptions = stops.length > 0 ? stops.map((stop) => `<option value="${stop.id}">${stop.id} · ${stop.type} (${stop.x},${stop.y})</option>`).join('') : '<option value="">No stops</option>';
    for (const selector of ['[data-transit-origin]', '[data-transit-destination]', '[data-transit-append-stop]']) this.required<HTMLSelectElement>(selector).innerHTML = stopOptions;
    if (stops.length > 1) this.required<HTMLSelectElement>('[data-transit-destination]').value = stops[1]!.id;
    this.syncTransitLineInputs();
  }

  private syncTransitLineInputs(): void {
    const lineId = this.selectedTransitLineId();
    const line = lineId ? this.core.transit.getLine(lineId) : undefined;
    const remove = this.required<HTMLSelectElement>('[data-transit-remove-stop]');
    if (!line) {
      this.required<HTMLInputElement>('[data-transit-headway]').value = '80';
      this.required<HTMLInputElement>('[data-transit-fare]').value = '2';
      this.required<HTMLInputElement>('[data-transit-fleet]').value = '2';
      this.required<HTMLInputElement>('[data-transit-enabled]').checked = false;
      remove.innerHTML = '<option value="">No route stops</option>';
      this.renderTransitStatus();
      return;
    }
    const operations = this.core.mobility.operations.snapshotLineWithVehicles(line.id, this.core.mobility.vehicles);
    this.required<HTMLInputElement>('[data-transit-headway]').value = String(line.headwayTicks);
    this.required<HTMLInputElement>('[data-transit-fare]').value = String(line.fare);
    this.required<HTMLInputElement>('[data-transit-fleet]').value = String(operations.fleetLimit);
    this.required<HTMLInputElement>('[data-transit-enabled]').checked = line.enabled;
    remove.innerHTML = line.stopIds.length > 0 ? line.stopIds.map((stopId, index) => `<option value="${stopId}">${index + 1}. ${stopId}</option>`).join('') : '<option value="">No route stops</option>';
    this.renderTransitStatus();
  }

  private renderTransitStatus(): void {
    const state = collectTransitPanelState(this.core);
    const lineId = this.selectedTransitLineId();
    const line = state.lines.find((candidate) => candidate.id === lineId);
    const summary = this.required<HTMLElement>('[data-transit-summary]');
    summary.innerHTML = line ? `<strong>${escapeHtml(line.name)}</strong><span>${line.mode} · ${line.stopIds.length} stops · ${line.activeVehicles}/${line.fleetLimit} vehicles</span><span>Ridership ${line.ridership.toFixed(0)} · reliability ${Math.round(line.reliability * 100)}% · recovery ${Math.round(line.costRecovery * 100)}%</span><span>City transit share ${Math.round(state.modeShare * 100)}% · access ${Math.round(state.personAccessibility * 100)}% · wait ${state.meanWaitTicks.toFixed(1)} ticks</span>` : `No transit lines · ${state.stops.length} stops placed.`;
    const vehicleSelect = this.required<HTMLSelectElement>('[data-transit-vehicle]');
    const priorVehicle = vehicleSelect.value;
    const vehicles = this.core.mobility.vehicles.listVehicles();
    vehicleSelect.innerHTML = vehicles.length > 0 ? vehicles.map((vehicle) => `<option value="${vehicle.id}">${vehicle.id} · ${vehicle.mode}</option>`).join('') : '<option value="">No active vehicles</option>';
    if (vehicles.some((vehicle) => vehicle.id === priorVehicle)) vehicleSelect.value = priorVehicle;
  }

  private renderEconomyPanel(): void {
    const panel = this.root.querySelector<HTMLElement>('[data-economy-summary]');
    if (panel) panel.innerHTML = new EconomyPanel().render(this.core.economyDomain.snapshot(this.core.clock.tick));
  }

  private renderInspection(inspection: Inspection): void {
    this.inspector.innerHTML = `<h3>${escapeHtml(inspection.title)}</h3>${inspection.lines.map((line) => `<p>${escapeHtml(line)}</p>`).join('')}`;
  }

  private bindCanvas(canvas: HTMLCanvasElement): void {
    canvas.addEventListener('contextmenu', (event) => event.preventDefault());
    canvas.addEventListener('wheel', (event) => {
      if (this.renderer.cameraInputOwner !== 'app') return;
      event.preventDefault();
      const rect = canvas.getBoundingClientRect();
      this.renderer.zoomBy(event.deltaY < 0 ? 1.12 : 0.89, event.clientX - rect.left, event.clientY - rect.top);
    }, { passive: false });
    canvas.addEventListener('pointerdown', (event) => {
      if (this.renderer.cameraInputOwner === 'app') {
        if (event.button === 1 || event.button === 2) {
          this.panPointer = { x: event.clientX, y: event.clientY };
          canvas.setPointerCapture(event.pointerId);
          return;
        }
      }
      if (event.button !== 0) return;
      const cell = this.renderer.canvasToCell(event.clientX, event.clientY, this.core);
      if (!cell) return;
      if (this.tools.activeTool.startsWith('road-')) {
        this.dragRoadStart = cell;
        this.previewPath = [cell];
        canvas.setPointerCapture(event.pointerId);
      } else {
        this.applyCell(cell);
      }
    });
    canvas.addEventListener('pointermove', (event) => {
      if (this.renderer.cameraInputOwner === 'app' && this.panPointer) {
        this.renderer.pan(event.clientX - this.panPointer.x, event.clientY - this.panPointer.y);
        this.panPointer = { x: event.clientX, y: event.clientY };
        return;
      }
      if (!this.dragRoadStart) return;
      const cell = this.renderer.canvasToCell(event.clientX, event.clientY, this.core);
      if (cell) this.previewPath = manhattanPath(this.dragRoadStart, cell);
    });
    canvas.addEventListener('pointerup', (event) => {
      if (this.renderer.cameraInputOwner === 'app' && this.panPointer) {
        this.panPointer = null;
        if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
        return;
      }
      if (!this.dragRoadStart) return;
      const cell = this.renderer.canvasToCell(event.clientX, event.clientY, this.core) ?? this.dragRoadStart;
      const path = manhattanPath(this.dragRoadStart, cell);
      const result = this.tools.applyPath(this.core, path);
      this.flash(result.ok ? `Built ${path.length} road cells.` : result.reason ?? 'Road placement failed.', result.ok ? 'ok' : 'error');
      this.dragRoadStart = null;
      this.previewPath = [];
      if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
    });
  }

  private applyCell(cell: CellCoord): void {
    this.selected = cell;
    if (this.tools.activeTool === 'inspect') {
      this.renderInspector();
      return;
    }
    const result = this.tools.applyCell(this.core, cell.x, cell.y);
    this.flash(result.ok ? `${this.tools.activeTool} applied.` : result.reason ?? 'Action failed.', result.ok ? 'ok' : 'error');
    if (this.tools.activeTool === 'transit-stop' || this.tools.activeTool === 'transit-metro-station') this.renderTransitPanel();
    this.renderInspector();
  }

  private keydown(event: KeyboardEvent): void {
    if (event.target instanceof HTMLInputElement || event.target instanceof HTMLSelectElement) return;
    const key = event.key.toLowerCase();
    const shortcut: Record<string, ToolId> = { i: 'inspect', r: 'road-local', c: 'road-collector', a: 'road-arterial', '1': 'zone-residential', '2': 'zone-commercial', '3': 'zone-industrial', '4': 'service-fire', '5': 'service-police', '6': 'service-clinic', '7': 'service-school', '8': 'service-landfill', '9': 'service-recycling', p: 'power', w: 'water', g: 'landfill', t: 'transit-stop', m: 'transit-metro-station', b: 'bulldoze' };
    if (shortcut[key]) this.selectTool(shortcut[key]);
    if (key === 'q') this.renderer.rotate(-1);
    if (key === 'e') this.renderer.rotate(1);
    if (event.code === 'Space') {
      event.preventDefault();
      this.core.clock.setSpeed(this.core.clock.speed === 0 ? 1 : 0);
      this.updateSpeedButtons();
    }
    const pan = 28;
    if (event.key === 'ArrowLeft') this.renderer.pan(pan, 0);
    if (event.key === 'ArrowRight') this.renderer.pan(-pan, 0);
    if (event.key === 'ArrowUp') this.renderer.pan(0, pan);
    if (event.key === 'ArrowDown') this.renderer.pan(0, -pan);
  }

  private selectTool(tool: ToolId): void {
    this.tools.setTool(tool);
    this.root.querySelectorAll<HTMLElement>('[data-tool]').forEach((button) => button.classList.toggle('active', button.dataset.tool === tool));
  }

  private frame(time: number): void {
    const delta = Math.min(250, time - this.lastFrame);
    this.lastFrame = time;
    if (this.core.clock.speed > 0) {
      this.tickAccumulator += delta * 0.01 * this.core.clock.speed;
      const ticks = Math.floor(this.tickAccumulator);
      if (ticks > 0) {
        this.tickAccumulator -= ticks;
        this.core.step(ticks);
      }
    }
    this.hud.update(collectHudMetrics(this.core));
    this.renderer.draw(this.core, this.overlayMode, this.selected, this.previewPath, this.serviceOverlayMode, this.transitOverlayMode, this.economyOverlayMode);
    if (Math.floor(this.core.clock.tick / 10) !== this.lastTransitStatusTick) {
      this.lastTransitStatusTick = Math.floor(this.core.clock.tick / 10);
      this.renderTransitStatus();
      this.renderEconomyPanel();
    }
    this.renderDebug();
    this.renderServiceAlerts();
    requestAnimationFrame((next) => this.frame(next));
  }

  private renderInspector(): void {
    if (!this.selected) {
      this.inspector.textContent = 'Select a cell.';
      return;
    }
    this.renderInspection(inspectCell(this.core, this.selected.x, this.selected.y));
  }

  private renderDebug(): void {
    const pathfinding = this.root.querySelector<HTMLElement>('[data-debug="pathfinding"]');
    const traffic = this.root.querySelector<HTMLElement>('[data-debug="traffic"]');
    if (pathfinding) pathfinding.textContent = `Routes: ${this.core.pathfinding.diagnostics.requests} · cache ${this.core.pathfinding.diagnostics.cacheHits}/${this.core.pathfinding.diagnostics.requests}`;
    if (traffic) traffic.textContent = `Edges ${this.core.transportationGraph.edges.length} · active ${this.core.traffic.activeVehicles.length} · completed ${this.core.traffic.completedTrips} · failed ${this.core.traffic.failedTrips}`;
  }

  private updateOverlayLegend(): void {
    const labels: Record<TrafficOverlayMode, string> = {
      none: 'Overlay off.',
      congestion: 'Congestion: numeric road delay, 0% free-flow → 100% severe.',
      speed: 'Speed: actual cells/second; lower is slower.',
      volume: 'Volume: weighted vehicles currently on each edge.',
      bottlenecks: 'Bottlenecks: highest congestion × traffic-volume edges.',
    };
    this.overlayLegend.textContent = this.economyOverlayMode !== 'none' ? mapEconomyOverlay(this.core, this.economyOverlayMode).legend
      : this.transitOverlayMode !== 'none' ? mapTransitOverlay(this.core, this.transitOverlayMode).legend
      : this.serviceOverlayMode !== 'none' ? mapServiceOverlay(this.core, this.serviceOverlayMode).legend
      : labels[this.overlayMode];
  }

  private renderServiceAlerts(): void {
    const waiting = this.core.serviceDispatch.listJobs().filter((job) => job.status === 'waiting').length;
    const conditions: Array<[string, boolean, string]> = [
      ['waiting-jobs', waiting > 0, `${waiting} public-service call${waiting === 1 ? '' : 's'} waiting for dispatch.`],
      ['school-overcrowding', this.core.educationSnapshot.overcrowdedStudents > 0, `${this.core.educationSnapshot.overcrowdedStudents} students lack effective school seats.`],
      ['service-quality', this.core.neighborhoodSnapshot.citywideServiceQuality < 0.55, `Service quality is ${Math.round(this.core.neighborhoodSnapshot.citywideServiceQuality * 100)}%; inspect the service overlay for the weakest department.`],
      ['waste-backlog', this.core.garbageSnapshot.backlog > 25, `Waste backlog is ${this.core.garbageSnapshot.backlog.toFixed(0)}; add collection/processing capacity or improve access.`],
      ['transit-crowding', this.core.mobilitySnapshot.crowding > 0.9, `Transit crowding is ${Math.round(this.core.mobilitySnapshot.crowding * 100)}%; increase fleet or reduce headways.`],
      ['transit-reliability', this.core.transit.listLines().length > 0 && this.core.mobilitySnapshot.reliability < 0.6, `Transit reliability is ${Math.round(this.core.mobilitySnapshot.reliability * 100)}%; inspect delayed lines and road congestion.`],
    ];
    for (const [key, active] of conditions) if (!active) this.activeAlertKeys.delete(key);
    const next = conditions.find(([key, active]) => active && !this.activeAlertKeys.has(key));
    if (!next) return;
    this.activeAlertKeys.add(next[0]);
    this.flash(next[2], 'error');
  }

  private updateSpeedButtons(): void {
    this.root.querySelectorAll<HTMLElement>('[data-speed]').forEach((button) => button.classList.toggle('active', Number(button.dataset.speed) === this.core.clock.speed));
  }

  private save(): void {
    const json = JSON.stringify(serializeCore(this.core));
    this.fallbackSave = json;
    try { localStorage.setItem(STORAGE_KEY, json); } catch { /* fallback retained */ }
    this.flash(`Saved V9 at tick ${this.core.clock.tick}.`, 'ok');
  }

  private load(): void {
    try {
      let json = this.fallbackSave;
      let loadedLegacy = false;
      try {
        const current = localStorage.getItem(STORAGE_KEY);
        const legacy = current === null ? localStorage.getItem(LEGACY_STORAGE_KEY) : null;
        if (current !== null) json = current;
        else if (legacy !== null) { json = legacy; loadedLegacy = true; }
      } catch { /* use fallback */ }
      if (!json) throw new Error('No save exists');
      this.core = hydrateCore(JSON.parse(json));
      if (loadedLegacy) {
        const migrated = JSON.stringify(serializeCore(this.core));
        this.fallbackSave = migrated;
        try { localStorage.setItem(STORAGE_KEY, migrated); } catch { /* fallback retained */ }
      }
      this.syncInputsFromCore();
      this.renderTransitPanel();
      this.renderEconomyPanel();
      this.flash(`Loaded V9 at tick ${this.core.clock.tick}.`, 'ok');
      this.renderInspector();
    } catch (error) {
      this.flash(error instanceof Error ? error.message : 'Load failed', 'error');
    }
  }

  private syncInputsFromCore(): void {
    this.root.querySelectorAll<HTMLInputElement>('[data-tax]').forEach((input) => {
      input.value = String(this.core.taxes.getRate(input.dataset.tax as ZoneType) * 100);
    });
    this.root.querySelectorAll<HTMLInputElement>('[data-service-budget]').forEach((input) => {
      input.value = String(this.core.services.getFunding(input.dataset.serviceBudget as ServiceDepartment));
    });
    this.updateSpeedButtons();
    this.renderTransitPanel();
  }

  private flash(message: string, kind: 'ok' | 'error'): void {
    this.notification.textContent = message;
    this.notification.dataset.kind = kind;
    this.notification.classList.add('visible');
    window.setTimeout(() => this.notification.classList.remove('visible'), 2500);
  }

  private required<T extends Element = HTMLElement>(selector: string): T {
    const element = this.root.querySelector<T>(selector);
    if (!element) throw new Error(`Missing UI element: ${selector}`);
    return element;
  }
}

function manhattanPath(start: CellCoord, end: CellCoord): CellCoord[] {
  const cells: CellCoord[] = [];
  const sx = Math.sign(end.x - start.x) || 1;
  for (let x = start.x; x !== end.x; x += sx) cells.push({ x, y: start.y });
  cells.push({ x: end.x, y: start.y });
  const sy = Math.sign(end.y - start.y) || 1;
  for (let y = start.y + sy; sy > 0 ? y <= end.y : y >= end.y; y += sy) cells.push({ x: end.x, y });
  return cells;
}