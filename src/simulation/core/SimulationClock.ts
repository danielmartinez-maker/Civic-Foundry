import type { SpeedMode } from './types.ts';

export class SimulationClock {
  tick = 0;
  speed: SpeedMode = 1;

  setSpeed(speed: SpeedMode): void {
    this.speed = speed;
  }

  step(ticks = 1): void {
    if (!Number.isInteger(ticks) || ticks < 0) throw new Error('ticks must be a non-negative integer');
    this.tick += ticks;
  }

  restore(tick: number, speed: SpeedMode): void {
    if (!Number.isInteger(tick) || tick < 0) throw new Error('invalid tick');
    this.tick = tick;
    this.speed = speed;
  }
}
