const EPSILON = 1e-12;

function assertFinite(value, label) {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`${label} must be finite`);
  }
}

function assertVector(value, label) {
  if (typeof value !== 'object' || value === null) {
    throw new Error(`${label} must be a vector`);
  }
  for (const axis of ['x', 'y', 'z']) {
    assertFinite(value[axis], `${label}.${axis}`);
  }
}

function assertPositiveVector(value, label) {
  assertVector(value, label);
  for (const axis of ['x', 'y', 'z']) {
    if (value[axis] <= 0) {
      throw new Error(`${label}.${axis} must be > 0`);
    }
  }
}

function normalize(vector) {
  const length = Math.hypot(vector[0], vector[1], vector[2]);
  if (length <= EPSILON) {
    throw new Error('geometry face is degenerate');
  }
  return vector.map((value) => value / length);
}

function faceNormal(a, b, c) {
  const ab = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
  const ac = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
  return normalize([
    ab[1] * ac[2] - ab[2] * ac[1],
    ab[2] * ac[0] - ab[0] * ac[2],
    ab[0] * ac[1] - ab[1] * ac[0],
  ]);
}

function geometryFromFaces(faces) {
  const positions = [];
  const normals = [];
  const indices = [];

  for (const face of faces) {
    if (!Array.isArray(face) || face.length < 3) {
      throw new Error('geometry face must contain at least three vertices');
    }
    const normal = faceNormal(face[0], face[1], face[2]);
    const base = positions.length / 3;
    for (const vertex of face) {
      positions.push(vertex[0], vertex[1], vertex[2]);
      normals.push(normal[0], normal[1], normal[2]);
    }
    for (let index = 1; index < face.length - 1; index += 1) {
      indices.push(base, base + index, base + index + 1);
    }
  }

  return { positions, normals, indices };
}

export function boxGeometry(size, center) {
  assertPositiveVector(size, 'size');
  assertVector(center, 'center');

  const x0 = center.x - size.x / 2;
  const x1 = center.x + size.x / 2;
  const y0 = center.y - size.y / 2;
  const y1 = center.y + size.y / 2;
  const z0 = center.z - size.z / 2;
  const z1 = center.z + size.z / 2;

  return geometryFromFaces([
    [
      [x0, y0, z0],
      [x0, y1, z0],
      [x1, y1, z0],
      [x1, y0, z0],
    ],
    [
      [x0, y0, z1],
      [x1, y0, z1],
      [x1, y1, z1],
      [x0, y1, z1],
    ],
    [
      [x0, y0, z0],
      [x0, y0, z1],
      [x0, y1, z1],
      [x0, y1, z0],
    ],
    [
      [x1, y0, z0],
      [x1, y1, z0],
      [x1, y1, z1],
      [x1, y0, z1],
    ],
    [
      [x0, y0, z0],
      [x1, y0, z0],
      [x1, y0, z1],
      [x0, y0, z1],
    ],
    [
      [x0, y1, z0],
      [x0, y1, z1],
      [x1, y1, z1],
      [x1, y1, z0],
    ],
  ]);
}

export function wedgeGeometry(size, center, axis = 'x') {
  assertPositiveVector(size, 'size');
  assertVector(center, 'center');
  if (axis !== 'x' && axis !== 'z') {
    throw new Error("wedge axis must be 'x' or 'z'");
  }

  const x0 = center.x - size.x / 2;
  const x1 = center.x + size.x / 2;
  const xm = center.x;
  const y0 = center.y - size.y / 2;
  const y1 = center.y + size.y / 2;
  const z0 = center.z - size.z / 2;
  const z1 = center.z + size.z / 2;
  const zm = center.z;

  if (axis === 'x') {
    return geometryFromFaces([
      [
        [x0, y0, z0],
        [x0, y0, z1],
        [x0, y1, zm],
      ],
      [
        [x1, y0, z0],
        [x1, y1, zm],
        [x1, y0, z1],
      ],
      [
        [x0, y0, z0],
        [x1, y0, z0],
        [x1, y0, z1],
        [x0, y0, z1],
      ],
      [
        [x0, y0, z0],
        [x0, y1, zm],
        [x1, y1, zm],
        [x1, y0, z0],
      ],
      [
        [x0, y0, z1],
        [x1, y0, z1],
        [x1, y1, zm],
        [x0, y1, zm],
      ],
    ]);
  }

  return geometryFromFaces([
    [
      [x0, y0, z0],
      [xm, y1, z0],
      [x1, y0, z0],
    ],
    [
      [x0, y0, z1],
      [x1, y0, z1],
      [xm, y1, z1],
    ],
    [
      [x0, y0, z0],
      [x1, y0, z0],
      [x1, y0, z1],
      [x0, y0, z1],
    ],
    [
      [x0, y0, z0],
      [x0, y0, z1],
      [xm, y1, z1],
      [xm, y1, z0],
    ],
    [
      [x1, y0, z0],
      [xm, y1, z0],
      [xm, y1, z1],
      [x1, y0, z1],
    ],
  ]);
}

export function cylinderGeometry(radius, height, segments, center) {
  assertFinite(radius, 'radius');
  assertFinite(height, 'height');
  assertVector(center, 'center');
  if (radius <= 0) throw new Error('radius must be > 0');
  if (height <= 0) throw new Error('height must be > 0');
  if (!Number.isInteger(segments) || segments < 3 || segments > 128) {
    throw new Error('segments must be an integer between 3 and 128');
  }

  const y0 = center.y - height / 2;
  const y1 = center.y + height / 2;
  const faces = [];
  for (let index = 0; index < segments; index += 1) {
    const angle0 = (index / segments) * Math.PI * 2;
    const angle1 = ((index + 1) / segments) * Math.PI * 2;
    const p0 = [
      center.x + Math.cos(angle0) * radius,
      y0,
      center.z + Math.sin(angle0) * radius,
    ];
    const p1 = [
      center.x + Math.cos(angle1) * radius,
      y0,
      center.z + Math.sin(angle1) * radius,
    ];
    const t0 = [p0[0], y1, p0[2]];
    const t1 = [p1[0], y1, p1[2]];
    const bottomCenter = [center.x, y0, center.z];
    const topCenter = [center.x, y1, center.z];

    faces.push([p0, t0, t1, p1]);
    faces.push([bottomCenter, p0, p1]);
    faces.push([topCenter, t1, t0]);
  }
  return geometryFromFaces(faces);
}

export function planeGeometry(size, center, orientation) {
  assertVector(size, 'size');
  assertVector(center, 'center');
  if (!['xy', 'xz', 'yz'].includes(orientation)) {
    throw new Error("plane orientation must be 'xy', 'xz', or 'yz'");
  }

  const x0 = center.x - size.x / 2;
  const x1 = center.x + size.x / 2;
  const y0 = center.y - size.y / 2;
  const y1 = center.y + size.y / 2;
  const z0 = center.z - size.z / 2;
  const z1 = center.z + size.z / 2;

  if (orientation === 'xy') {
    if (size.x <= 0 || size.y <= 0) throw new Error('xy plane size must be positive');
    return geometryFromFaces([
      [
        [x0, y0, center.z],
        [x1, y0, center.z],
        [x1, y1, center.z],
        [x0, y1, center.z],
      ],
    ]);
  }
  if (orientation === 'xz') {
    if (size.x <= 0 || size.z <= 0) throw new Error('xz plane size must be positive');
    return geometryFromFaces([
      [
        [x0, center.y, z0],
        [x0, center.y, z1],
        [x1, center.y, z1],
        [x1, center.y, z0],
      ],
    ]);
  }
  if (size.y <= 0 || size.z <= 0) throw new Error('yz plane size must be positive');
  return geometryFromFaces([
    [
      [center.x, y0, z0],
      [center.x, y1, z0],
      [center.x, y1, z1],
      [center.x, y0, z1],
    ],
  ]);
}

export function triangleCount(geometry) {
  if (!geometry || !Array.isArray(geometry.indices)) {
    throw new Error('geometry.indices must be an array');
  }
  if (geometry.indices.length % 3 !== 0) {
    throw new Error('geometry indices must describe triangles');
  }
  return geometry.indices.length / 3;
}

export function geometryBounds(geometry) {
  if (!geometry || !Array.isArray(geometry.positions) || geometry.positions.length % 3 !== 0) {
    throw new Error('geometry.positions must be xyz triples');
  }
  if (geometry.positions.length === 0) {
    throw new Error('geometry must contain positions');
  }

  const min = { x: Infinity, y: Infinity, z: Infinity };
  const max = { x: -Infinity, y: -Infinity, z: -Infinity };
  for (let index = 0; index < geometry.positions.length; index += 3) {
    const x = geometry.positions[index];
    const y = geometry.positions[index + 1];
    const z = geometry.positions[index + 2];
    assertFinite(x, 'position.x');
    assertFinite(y, 'position.y');
    assertFinite(z, 'position.z');
    min.x = Math.min(min.x, x);
    min.y = Math.min(min.y, y);
    min.z = Math.min(min.z, z);
    max.x = Math.max(max.x, x);
    max.y = Math.max(max.y, y);
    max.z = Math.max(max.z, z);
  }
  return { min, max };
}
