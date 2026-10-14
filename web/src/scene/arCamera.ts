import type { PerspectiveCamera } from 'three'

/**
 * Set the AR camera's projection from a column-major matrix (pose/projection.ts projectionMatrixGL).
 * Also updates the inverse, which the Raycaster uses. Never call updateProjectionMatrix() on this
 * camera afterwards: it would overwrite the projection with one built from fov/aspect.
 */
export function applyProjection(camera: PerspectiveCamera, colMajor: number[]): void {
  camera.projectionMatrix.fromArray(colMajor)
  camera.projectionMatrixInverse.copy(camera.projectionMatrix).invert()
}
