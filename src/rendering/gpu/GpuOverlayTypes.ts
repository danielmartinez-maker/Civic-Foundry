export type GpuOverlayPoint = Readonly<{ x: number; y: number }>;

export type GpuOverlayCommand =
  | Readonly<{
      kind: 'cell';
      key: string;
      x: number;
      y: number;
      fill: string;
      alpha: number;
      label?: string;
    }>
  | Readonly<{
      kind: 'segment';
      key: string;
      from: GpuOverlayPoint;
      to: GpuOverlayPoint;
      color: string;
      widthFactor: number;
      dash?: readonly number[];
    }>
  | Readonly<{
      kind: 'ring';
      key: string;
      points: readonly GpuOverlayPoint[];
      fill?: string;
      fillAlpha?: number;
      stroke?: string;
      strokeWidth: number;
    }>
  | Readonly<{
      kind: 'marker';
      key: string;
      x: number;
      y: number;
      marker: 'stop' | 'metro-station' | 'gateway';
      color: string;
    }>
  | Readonly<{
      kind: 'label';
      key: string;
      x: number;
      y: number;
      text: string;
      minTileWidth: number;
    }>;
