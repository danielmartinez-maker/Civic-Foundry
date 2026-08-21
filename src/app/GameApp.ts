import { SimulationCore } from '../simulation/core/SimulationCore.ts';
import type { CellCoord, SpeedMode, ZoneType } from '../simulation/core/types.ts';
import { hydrateCore, serializeCore } from '../save/save.ts';
import { WorldRenderer, type CellSelection } from '../rendering/WorldRenderer.ts';
import type { TrafficOverlayMode } from '../rendering/TrafficOverlayLayer.ts';
import { mapServiceOverlay, type ServiceOverlayMode } from '../rendering/ServiceOverlayLayer.ts';
import type { ServiceDepartment } from '../data/services.ts';
import { collectHudMetrics, HudView } from '../ui/Hud.ts';
import { inspectCell } from '../ui/Inspector.ts';
import { ToolController, type ToolId } from '../ui/ToolController.ts';

const STORAGE_KEY = 'civic-foundry-save-v4';
const TOOLS: readonly [ToolId, string, string][] = [
  ['inspect', 'Inspect', 'I'], ['road-local', 'Local', 'R'], ['road-collector', 'Collector', 'C'], ['road-arterial', 'Arterial', 'A'],
  ['zone-residential', 'Residential', '1'], ['zone-commercial', 'Commercial', '2'], ['zone-industrial', 'Industrial', '3'],
  ['power', 'Power', 'P'], ['water', 'Water', 'W'], ['landfill', 'Legacy landfill', 'G'],
  ['service-fire', 'Fire Station', '4'], ['service-police', 'Police Station', '5'], ['service-clinic', 'Clinic', '6'],
  ['service-school', 'Elementary School', '7'], ['service-landfill', 'Service Landfill', '8'], ['service-recycling', 'Recycling Center', '9'],
  ['bulldoze', 'Bulldoze', 'B'],
];

export class GameApp {
  core: SimulationCore;
  readonly tools = new ToolController();
  readonly renderer: WorldRenderer;
  private readonly hud: HudView;
  private readonly inspector: HTMLElement;
  private readonly notification: HTMLElement;
  private readonly overlayLegend: HTMLElement;
  private readonly root: HTMLElement;
  private overlayMode: TrafficOverlayMode = 'none';
  private serviceOverlayMode: ServiceOverlayMode = 'none';
  private readonly activeAlertKeys = new Set<string>();
  private selected: CellSelection = null;
  private dragRoadStart: CellCoord | null = null;
  private previewPath: CellCoord[] = [];
  private panPointer: { x: number; y: number } | null = null;
  private lastFrame = performance.now();
  private tickAccumulator = 0;
  private fallbackSave: string | null = null;

  constructor(root: HTMLElement) {
    this.root = root;
    this.core = new SimulationCore({ width: 40, height: 24, seed: 42, startingFunds: 250_000 });
    root.innerHTML = this.layoutHtml();
    const canvas = this.required<HTMLCanvasElement>('#world');
    this.renderer = new WorldRenderer(canvas);
    this.hud = new HudView(this.required('#hud'));
    this.inspector = this.required('#inspector-content');
    this.notification = this.required('#notification');
    this.overlayLegend = this.required('#overlay-legend');
    this.bindTools();
    this.bindControls();
    this.bindCanvas(canvas);
    this.selectTool('inspect');
    this.updateOverlayLegend();
    requestAnimationFrame((time) => this.frame(time));
  }

  private layoutHtml(): string {
    const toolButtons = TOOLS.map(([id, label, key]) => `<button class="tool-btn" data-tool="${id}" data-testid="tool-${id}"><span>${label}</span><kbd>${key}</kbd></button>`).join('');
    const speedButtons = [0, 1, 2, 4].map((speed) => `<button data-speed="${speed}" data-testid="speed-${speed}">${speed === 0 ? 'Pause' : `${speed}×`}</button>`).join('');
    const taxRows = (['residential', 'commercial', 'industrial'] as ZoneType[]).map((zone) => `<label class="tax-row"><span>${zone[0]!.toUpperCase()}</span><input data-tax="${zone}" type="number" min="0" max="25" step="0.5" value="10"><b>%</b></label>`).join('');
    const serviceBudgetRows = (['fire', 'police', 'healthcare', 'education', 'garbage'] as ServiceDepartment[]).map((department) => `<label class="tax-row"><span>${department[0]!.toUpperCase()}${department.slice(1, 4)}</span><input data-service-budget="${department}" data-testid="budget-${department}" type="number" min="50" max="150" step="5" value="100"><b>%</b></label>`).join('');
    return `<div class="game-shell">
      <header class="topbar"><div><div class="eyebrow">PHASE IV · PUBLIC SERVICES</div><h1>CIVIC FOUNDRY</h1></div>
        <div class="top-actions"><button data-action="save" data-testid="save">Save V4</button><button data-action="load" data-testid="load">Load</button></div></header>
      <section id="hud" class="hud"></section>
      <main class="workspace">
        <aside class="toolbox"><h2>Build</h2>${toolButtons}
          <div class="panel-section"><h3>Speed</h3><div class="segmented">${speedButtons}</div></div>
          <div class="panel-section"><h3>Traffic</h3><select id="overlay" data-testid="traffic-overlay"><option value="none">Off</option><option value="congestion">Congestion</option><option value="speed">Speed</option><option value="volume">Volume</option><option value="bottlenecks">Bottlenecks</option></select></div>
          <div class="panel-section"><h3>Services</h3><select id="service-overlay" data-testid="service-overlay"><option value="none">Off</option><option value="quality">Combined quality</option><option value="fire">Fire</option><option value="police">Police</option><option value="healthcare">Healthcare</option><option value="education">Education</option><option value="garbage">Garbage</option></select><p id="overlay-legend" class="legend"></p></div>
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
      if (this.overlayMode !== 'none') { this.serviceOverlayMode = 'none'; this.required<HTMLSelectElement>('#service-overlay').value = 'none'; }
      this.updateOverlayLegend();
    });
    this.required<HTMLSelectElement>('#service-overlay').addEventListener('change', (event) => {
      this.serviceOverlayMode = (event.currentTarget as HTMLSelectElement).value as ServiceOverlayMode;
      if (this.serviceOverlayMode !== 'none') { this.overlayMode = 'none'; this.required<HTMLSelectElement>('#overlay').value = 'none'; }
      this.updateOverlayLegend();
    });
    this.root.querySelectorAll<HTMLInputElement>('[data-service-budget]').forEach((input) => input.addEventListener('change', () => {
      const department = input.dataset.serviceBudget as ServiceDepartment;
      const result = this.core.setServiceFunding(department, Number(input.value));
      input.value = String(result);
      this.flash(`${department} funding set to ${result}%.`, 'ok');
    }));
    window.addEventListener('keydown', (event) => this.keydown(event));
    this.updateSpeedButtons();
  }

  private bindCanvas(canvas: HTMLCanvasElement): void {
    canvas.addEventListener('contextmenu', (event) => event.preventDefault());
    canvas.addEventListener('wheel', (event) => {
      event.preventDefault();
      const rect = canvas.getBoundingClientRect();
      this.renderer.zoomBy(event.deltaY < 0 ? 1.12 : 0.89, event.clientX - rect.left, event.clientY - rect.top);
    }, { passive: false });
    canvas.addEventListener('pointerdown', (event) => {
      if (event.button === 1 || event.button === 2) {
        this.panPointer = { x: event.clientX, y: event.clientY };
        canvas.setPointerCapture(event.pointerId);
        return;
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
      if (this.panPointer) {
        this.renderer.pan(event.clientX - this.panPointer.x, event.clientY - this.panPointer.y);
        this.panPointer = { x: event.clientX, y: event.clientY };
        return;
      }
      if (!this.dragRoadStart) return;
      const cell = this.renderer.canvasToCell(event.clientX, event.clientY, this.core);
      if (cell) this.previewPath = manhattanPath(this.dragRoadStart, cell);
    });
    canvas.addEventListener('pointerup', (event) => {
      if (this.panPointer) {
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
    this.renderInspector();
  }

  private keydown(event: KeyboardEvent): void {
    if (event.target instanceof HTMLInputElement || event.target instanceof HTMLSelectElement) return;
    const key = event.key.toLowerCase();
    const shortcut: Record<string, ToolId> = { i: 'inspect', r: 'road-local', c: 'road-collector', a: 'road-arterial', '1': 'zone-residential', '2': 'zone-commercial', '3': 'zone-industrial', '4': 'service-fire', '5': 'service-police', '6': 'service-clinic', '7': 'service-school', '8': 'service-landfill', '9': 'service-recycling', p: 'power', w: 'water', g: 'landfill', b: 'bulldoze' };
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
    this.renderer.draw(this.core, this.overlayMode, this.selected, this.previewPath, this.serviceOverlayMode);
    this.renderDebug();
    this.renderServiceAlerts();
    requestAnimationFrame((next) => this.frame(next));
  }

  private renderInspector(): void {
    if (!this.selected) {
      this.inspector.textContent = 'Select a cell.';
      return;
    }
    const inspection = inspectCell(this.core, this.selected.x, this.selected.y);
    this.inspector.innerHTML = `<h3>${inspection.title}</h3>${inspection.lines.map((line) => `<p>${line}</p>`).join('')}`;
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
    this.overlayLegend.textContent = this.serviceOverlayMode !== 'none' ? mapServiceOverlay(this.core, this.serviceOverlayMode).legend : labels[this.overlayMode];
  }

  private renderServiceAlerts(): void {
    const waiting = this.core.serviceDispatch.listJobs().filter((job) => job.status === 'waiting').length;
    const conditions: Array<[string, boolean, string]> = [
      ['waiting-jobs', waiting > 0, `${waiting} public-service call${waiting === 1 ? '' : 's'} waiting for dispatch.`],
      ['school-overcrowding', this.core.educationSnapshot.overcrowdedStudents > 0, `${this.core.educationSnapshot.overcrowdedStudents} students lack effective school seats.`],
      ['service-quality', this.core.neighborhoodSnapshot.citywideServiceQuality < 0.55, `Service quality is ${Math.round(this.core.neighborhoodSnapshot.citywideServiceQuality * 100)}%; inspect the service overlay for the weakest department.`],
      ['waste-backlog', this.core.garbageSnapshot.backlog > 25, `Waste backlog is ${this.core.garbageSnapshot.backlog.toFixed(0)}; add collection/processing capacity or improve access.`],
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
    this.flash(`Saved V4 at tick ${this.core.clock.tick}.`, 'ok');
  }

  private load(): void {
    try {
      let json = this.fallbackSave;
      try { json = localStorage.getItem(STORAGE_KEY) ?? json; } catch { /* use fallback */ }
      if (!json) throw new Error('No save exists');
      this.core = hydrateCore(JSON.parse(json));
      this.syncInputsFromCore();
      this.flash(`Loaded V4 at tick ${this.core.clock.tick}.`, 'ok');
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
