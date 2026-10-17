import { describe, expect, it } from 'vitest';
import { KInverse, KMatrix, centredIntrinsics, projectCamPoint, reprojectionRms } from './camera';
import { mat3Mul } from './linalg';

describe('camera helpers (mutation-tested)', () => {
  const K = centredIntrinsics(1000, 1280, 720);

  it('builds K and its inverse', () => {
    expect(KMatrix(K)).toEqual([1000, 0, 640, 0, 1000, 360, 0, 0, 1]);
    mat3Mul(KMatrix(K), KInverse(K)).forEach((v, i) => expect(v).toBeCloseTo([1, 0, 0, 0, 1, 0, 0, 0, 1][i], 12));
  });

  it('projects only points in front of the camera', () => {
    expect(projectCamPoint(K, [0.1, -0.2, 1])).toEqual([740, 160]);
    expect(projectCamPoint(K, [0.1, -0.2, 0])).toBeNull();
    expect(projectCamPoint(K, [0.1, -0.2, -1])).toBeNull();
  });

  it('scores a pose with a corner behind the camera as Infinity', () => {
    const pose = { R: [1, 0, 0, 0, 1, 0, 0, 0, 1], t: [0, 0, 0.05] as [number, number, number] };
    const obj: [number, number, number][] = [[0, 0, 0], [0, 0, -0.1]];
    expect(reprojectionRms(K, pose, obj, [[640, 360], [640, 360]])).toBe(Infinity);
    expect(reprojectionRms(K, pose, [obj[0]], [[643, 364]])).toBeCloseTo(5, 12);
  });
});
