export type NativeHandle = object;
export type DomainHash = Readonly<{
  ownership: 1 | 2;
  version: number;
  value: bigint;
}>;
export function createEngine(
  config?: Readonly<{
    seed?: number;
    startTick?: number;
    speed?: 0 | 1 | 2 | 4;
  }>,
): NativeHandle;
export function destroyEngine(handle: NativeHandle): void;
export function submitCommands(
  handle: NativeHandle,
  commandsJson: string,
): void;
export function step(handle: NativeHandle, ticks: number): void;
export function loadV9(handle: NativeHandle, saveJson: string): void;
export function saveV9(handle: NativeHandle): string;
export function getSnapshot(handle: NativeHandle): string;
export function getEvents(handle: NativeHandle): string;
export function getDomainHash(handle: NativeHandle, domain: string): DomainHash;
export function createWorld(handle: NativeHandle, requestJson: string): string;
export function restoreWorld(
  handle: NativeHandle,
  snapshotJson: string,
): string;
export function createLegacyWorld(
  handle: NativeHandle,
  requestJson: string,
): string;
export function runDesignStorm(
  handle: NativeHandle,
  requestJson: string,
): string;
export function rebuildUrbanLegacy(
  handle: NativeHandle,
  requestJson: string,
): string;
export function restoreUrbanState(
  handle: NativeHandle,
  snapshotJson: string,
): string;
export function applyUrbanCommand(
  handle: NativeHandle,
  requestJson: string,
): string;
export function getUrbanSnapshot(handle: NativeHandle): string;
