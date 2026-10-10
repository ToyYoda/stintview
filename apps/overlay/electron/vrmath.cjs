// Placement maths for the VR panels: OpenVR 3x4 row-major transforms (rotation | translation).

/**
 * Transform for a panel `distance` m in front of the seated origin, `down` m below
 * eye height and `right` m to the side, turned and tilted so it faces the eyes.
 */
function panelTransform({ distance, down, right }) {
  // Panel normal is +Z; point it from the panel towards the origin.
  const yaw = Math.atan2(-right, distance);
  const pitch = -Math.atan2(down, Math.hypot(distance, right));
  const cy = Math.cos(yaw), sy = Math.sin(yaw), cp = Math.cos(pitch), sp = Math.sin(pitch);
  // R = Ry(yaw) * Rx(pitch); OpenVR: -Z is forward, +Y up.
  return [
    cy, sy * sp, sy * cp, right,
    0, cp, -sp, -down,
    -sy, cy * sp, cy * cp, -distance,
  ];
}

const IDENTITY = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0];

/** a · b for two 3x4 affine transforms (b applied first). */
function mul34(a, b) {
  const out = new Array(12);
  for (let r = 0; r < 3; r++) {
    for (let c = 0; c < 4; c++) {
      let v = a[r * 4] * b[c] + a[r * 4 + 1] * b[4 + c] + a[r * 4 + 2] * b[8 + c];
      if (c === 3) v += a[r * 4 + 3];
      out[r * 4 + c] = v;
    }
  }
  return out;
}

/**
 * The head pose (seated space) as the panels' new origin, like a recenter: head position,
 * turned to where the head looks, but level (only the turn, no tilt or roll).
 */
function anchorFromPose(m) {
  // Forward is -Z; for Ry(yaw) the -Z column is (-sin, 0, -cos).
  const yaw = Math.atan2(m[2], m[10]);
  const c = Math.cos(yaw), s = Math.sin(yaw);
  return [
    c, 0, s, m[3],
    0, 1, 0, m[7],
    -s, 0, c, m[11],
  ];
}

module.exports = { panelTransform, mul34, anchorFromPose, IDENTITY };
