export type Point2 = Readonly<{ x: number; y: number }>;
export type Segment2 = Readonly<{ a: Point2; b: Point2 }>;
export type Polyline2 = Readonly<{ points: readonly Point2[] }>;
export type Polygon2 = Readonly<{ points: readonly Point2[] }>;
export type BoundingBox2 = Readonly<{ minX: number; minY: number; maxX: number; maxY: number }>;
