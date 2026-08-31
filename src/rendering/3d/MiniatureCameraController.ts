export type MiniatureCameraTarget = Readonly<{ x: number; y: number; z: number }>;

export type MiniatureCameraState = Readonly<{
  target: MiniatureCameraTarget;
  radius: number;
  azimuthRad: number;
  elevationRad: number;
}>;

const TAU = Math.PI * 2;
const MIN_RADIUS = 12;
const MAX_RADIUS = 5000;
const MIN_ELEVATION = 0.2;
const MAX_ELEVATION = 1.45;
const ORBIT_RADIANS_PER_PIXEL = 0.005;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function finite(value: number, label: string): number {
  if (!Number.isFinite(value)) throw new Error(`${label} must be finite`);
  return value;
}

function normalizeAngle(value: number): number {
  const normalized = value % TAU;
  return normalized < 0 ? normalized + TAU : normalized;
}

export class MiniatureCameraController {
  #target: { x: number; y: 0; z: number };
  #radius: number;
  #azimuthRad: number;
  #elevationRad: number;

  constructor(initial: MiniatureCameraState) {
    this.#target = {
      x: finite(initial.target.x, 'target.x'),
      y: 0,
      z: finite(initial.target.z, 'target.z'),
    };
    this.#radius = clamp(finite(initial.radius, 'radius'), MIN_RADIUS, MAX_RADIUS);
    this.#azimuthRad = normalizeAngle(finite(initial.azimuthRad, 'azimuthRad'));
    this.#elevationRad = clamp(finite(initial.elevationRad, 'elevationRad'), MIN_ELEVATION, MAX_ELEVATION);
  }

  get quarterTurns(): number {
    return ((Math.round(this.#azimuthRad / (Math.PI / 2)) % 4) + 4) % 4;
  }

  snapshot(): MiniatureCameraState {
    return Object.freeze({
      target: Object.freeze({ ...this.#target }),
      radius: this.#radius,
      azimuthRad: this.#azimuthRad,
      elevationRad: this.#elevationRad,
    });
  }

  position(): MiniatureCameraTarget {
    const horizontalRadius = this.#radius * Math.cos(this.#elevationRad);
    return Object.freeze({
      x: this.#target.x + horizontalRadius * Math.sin(this.#azimuthRad),
      y: this.#target.y + this.#radius * Math.sin(this.#elevationRad),
      z: this.#target.z + horizontalRadius * Math.cos(this.#azimuthRad),
    });
  }

  focus(target: MiniatureCameraTarget): void {
    this.#target.x = finite(target.x, 'target.x');
    this.#target.y = 0;
    this.#target.z = finite(target.z, 'target.z');
  }

  orbit(deltaX: number, deltaY: number): void {
    this.#azimuthRad = normalizeAngle(
      this.#azimuthRad + finite(deltaX, 'orbit deltaX') * ORBIT_RADIANS_PER_PIXEL,
    );
    this.#elevationRad = clamp(
      this.#elevationRad - finite(deltaY, 'orbit deltaY') * ORBIT_RADIANS_PER_PIXEL,
      MIN_ELEVATION,
      MAX_ELEVATION,
    );
  }

  zoomBy(factor: number): void {
    finite(factor, 'zoom factor');
    if (factor <= 0) throw new Error('zoom factor must be greater than zero');
    this.#radius = clamp(this.#radius * factor, MIN_RADIUS, MAX_RADIUS);
  }

  pan(deltaRight: number, deltaForward: number): void {
    finite(deltaRight, 'pan deltaRight');
    finite(deltaForward, 'pan deltaForward');
    const rightX = Math.cos(this.#azimuthRad);
    const rightZ = -Math.sin(this.#azimuthRad);
    const forwardX = -Math.sin(this.#azimuthRad);
    const forwardZ = -Math.cos(this.#azimuthRad);
    this.#target.x += rightX * deltaRight + forwardX * deltaForward;
    this.#target.z += rightZ * deltaRight + forwardZ * deltaForward;
  }

  rotateQuarterTurn(direction: -1 | 1): void {
    this.#azimuthRad = normalizeAngle(this.#azimuthRad + direction * Math.PI / 2);
  }
}
