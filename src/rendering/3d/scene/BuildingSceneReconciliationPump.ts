import type { WorldPresentationSnapshot } from '../presentation/PresentationTypes.ts';

export type BuildingSceneCameraPosition = Readonly<{
  x: number;
  y: number;
  z: number;
}>;

export type BuildingSceneReconciliationPumpOptions = Readonly<{
  applySnapshot(
    snapshot: WorldPresentationSnapshot,
    cameraPositionM: BuildingSceneCameraPosition,
  ): Promise<void>;
  onError?: (error: unknown) => void;
}>;

type PendingWork = Readonly<{
  snapshot: WorldPresentationSnapshot;
  cameraPositionM: BuildingSceneCameraPosition;
}>;

export class BuildingSceneReconciliationPump {
  private readonly applySnapshot: BuildingSceneReconciliationPumpOptions['applySnapshot'];
  private readonly onError: ((error: unknown) => void) | undefined;
  private pending: PendingWork | null = null;
  private running: Promise<void> | null = null;
  private disposed = false;

  constructor(options: BuildingSceneReconciliationPumpOptions) {
    this.applySnapshot = options.applySnapshot;
    this.onError = options.onError;
  }

  submit(
    snapshot: WorldPresentationSnapshot,
    cameraPositionM: BuildingSceneCameraPosition,
  ): void {
    if (this.disposed) return;
    this.pending = Object.freeze({ snapshot, cameraPositionM });
    this.ensureRunning();
  }

  async whenIdle(): Promise<void> {
    while (true) {
      const running = this.running;
      if (running) {
        await running;
        continue;
      }
      if (this.disposed || !this.pending) return;
      this.ensureRunning();
    }
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.pending = null;
  }

  private ensureRunning(): void {
    if (this.disposed || this.running || !this.pending) return;

    const run = this.drain();
    this.running = run;
    void run.then(
      (): void => this.finishRun(run),
      (error: unknown): void => {
        this.onError?.(error);
        this.finishRun(run);
      },
    );
  }

  private async drain(): Promise<void> {
    while (!this.disposed) {
      const work = this.pending;
      if (!work) return;
      this.pending = null;

      try {
        await this.applySnapshot(work.snapshot, work.cameraPositionM);
      } catch (error) {
        this.onError?.(error);
      }
    }
  }

  private finishRun(run: Promise<void>): void {
    if (this.running !== run) return;
    this.running = null;
    if (!this.disposed && this.pending) this.ensureRunning();
  }
}
