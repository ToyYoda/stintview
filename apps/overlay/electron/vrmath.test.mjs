import { describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';

const { anchorFromPose, IDENTITY, mul34, panelTransform } = createRequire(import.meta.url)('./vrmath.cjs');

const close = (a, b) => a.forEach((v, i) => expect(v).toBeCloseTo(b[i], 6));
const yawPose = (yaw, x, y, z) => {
  const c = Math.cos(yaw), s = Math.sin(yaw);
  return [c, 0, s, x, 0, 1, 0, y, -s, 0, c, z];
};

describe('VR panel anchor', () => {
  it('identity anchor keeps the panel where it was', () => {
    const p = panelTransform({ distance: 0.8, down: 0.3, right: 0.2 });
    close(mul34(IDENTITY, p), p);
  });

  it('takes position and turn of the head, not its tilt', () => {
    // head turned 90° left (looking along -X), tilted down 20°, at (0.1, 0.05, -0.2)
    const tilt = -20 * Math.PI / 180;
    const ry = yawPose(Math.PI / 2, 0, 0, 0), rx = [1, 0, 0, 0, 0, Math.cos(tilt), -Math.sin(tilt), 0, 0, Math.sin(tilt), Math.cos(tilt), 0];
    const head = mul34(ry, rx);
    head[3] = 0.1; head[7] = 0.05; head[11] = -0.2;
    close(anchorFromPose(head), yawPose(Math.PI / 2, 0.1, 0.05, -0.2));
  });

  it('a panel straight ahead ends up in front of the turned head', () => {
    const anchor = anchorFromPose(yawPose(Math.PI / 2, 0.1, 0, 0));
    const m = mul34(anchor, panelTransform({ distance: 0.8, down: 0, right: 0 }));
    // looking along -X: 0.8 m in front = x 0.1 − 0.8
    close([m[3], m[7], m[11]], [-0.7, 0, 0]);
  });
});
