import type { GpuOverlayCommand } from './GpuOverlayTypes.ts';

export type RetainedOverlayFamilyOptions<T> = Readonly<{
  maxPoolSize: number;
  create: (command: GpuOverlayCommand) => T;
  apply: (value: T, command: GpuOverlayCommand) => void;
  dispose?: (value: T) => void;
  fingerprint?: (command: GpuOverlayCommand) => string;
}>;

export type RetainedOverlayEntry<T> = Readonly<{
  command: GpuOverlayCommand;
  value: T;
}>;

export type RetainedOverlayFamilyStats = Readonly<{
  active: number;
  created: number;
  updated: number;
  recycled: number;
  pooled: number;
}>;

type ActiveEntry<T> = {
  command: GpuOverlayCommand;
  fingerprint: string;
  value: T;
};

export class RetainedOverlayFamily<T> {
  private options: RetainedOverlayFamilyOptions<T>;
  private activeByKey = new Map<string, ActiveEntry<T>>();
  private pool: T[] = [];
  private createdCount = 0;
  private updatedCount = 0;
  private recycledCount = 0;

  constructor(options: RetainedOverlayFamilyOptions<T>) {
    if (!Number.isInteger(options.maxPoolSize) || options.maxPoolSize < 0) {
      throw new Error(`Overlay pool size must be a non-negative integer, got ${options.maxPoolSize}`);
    }
    this.options = options;
  }

  sync(commands: readonly GpuOverlayCommand[]): readonly RetainedOverlayEntry<T>[] {
    const commandKeys = new Set<string>();
    for (const command of commands) {
      if (commandKeys.has(command.key)) {
        throw new Error(`Duplicate retained overlay key: ${command.key}`);
      }
      commandKeys.add(command.key);
    }

    for (const [key, entry] of this.activeByKey) {
      if (commandKeys.has(key)) continue;
      this.activeByKey.delete(key);
      if (this.pool.length < this.options.maxPoolSize) {
        this.pool.push(entry.value);
      } else {
        this.options.dispose?.(entry.value);
      }
    }

    const result: RetainedOverlayEntry<T>[] = [];
    for (const command of commands) {
      const fingerprint = this.fingerprint(command);
      const existing = this.activeByKey.get(command.key);
      if (existing) {
        if (existing.fingerprint !== fingerprint) {
          this.options.apply(existing.value, command);
          existing.command = command;
          existing.fingerprint = fingerprint;
          this.updatedCount += 1;
        }
        result.push({ command, value: existing.value });
        continue;
      }

      let value: T;
      const pooled = this.pool.pop();
      if (pooled !== undefined) {
        value = pooled;
        this.recycledCount += 1;
      } else {
        value = this.options.create(command);
        this.createdCount += 1;
      }
      this.options.apply(value, command);
      this.activeByKey.set(command.key, { command, fingerprint, value });
      result.push({ command, value });
    }

    return result;
  }

  stats(): RetainedOverlayFamilyStats {
    return {
      active: this.activeByKey.size,
      created: this.createdCount,
      updated: this.updatedCount,
      recycled: this.recycledCount,
      pooled: this.pool.length,
    };
  }

  clear(): void {
    for (const entry of this.activeByKey.values()) {
      this.options.dispose?.(entry.value);
    }
    for (const value of this.pool) {
      this.options.dispose?.(value);
    }
    this.activeByKey.clear();
    this.pool = [];
  }

  private fingerprint(command: GpuOverlayCommand): string {
    return this.options.fingerprint?.(command) ?? JSON.stringify(command);
  }
}
