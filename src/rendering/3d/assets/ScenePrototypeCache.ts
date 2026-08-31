export type DisposableScenePrototype = Readonly<{
  dispose(): void;
}>;

export class ScenePrototypeCache<T extends DisposableScenePrototype> {
  private readonly prototypes = new Map<string, T>();

  get size(): number {
    return this.prototypes.size;
  }

  has(key: string): boolean {
    return this.prototypes.has(key);
  }

  get(key: string): T | undefined {
    return this.prototypes.get(key);
  }

  set(key: string, prototype: T): void {
    const existing = this.prototypes.get(key);
    if (existing) {
      if (existing !== prototype) throw new Error(`Scene prototype key '${key}' is already occupied`);
      return;
    }
    this.prototypes.set(key, prototype);
  }

  evict(key: string): boolean {
    const prototype = this.prototypes.get(key);
    if (!prototype) return false;
    this.prototypes.delete(key);
    prototype.dispose();
    return true;
  }

  clear(): void {
    for (const prototype of this.prototypes.values()) prototype.dispose();
    this.prototypes.clear();
  }
}
