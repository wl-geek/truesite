/**
 * Public API of the pose module (pure TypeScript, no DOM, no dependencies).
 * Conventions: camera.ts. Column-major outputs for three.js: projection.ts,
 * modelMatrix.ts.
 */
export * from './camera';
export * from './linalg';
export * from './rotation';
export { homographyDLT, applyHomography } from './homography';
export { poseFromHomography } from './poseFromHomography';
export { refinePose } from './refinePose';
export type { RefinedPose, RefineOptions } from './refinePose';
export { ippeCandidates, ippeRotations, chooseCandidate, facesCamera } from './planarPose';
export type { Choice, ChooseOptions } from './planarPose';
export { estimatePose, isValidQuad } from './estimatePose';
export type { PoseEstimate, EstimateOptions } from './estimatePose';
export { gradeQuality, codeWidthPx, QUALITY_THRESHOLDS } from './quality';
export type { Quality } from './quality';
export { selfCalibrateFocal, focalFromHomography, viewTiltDeg } from './selfCalibrate';
export type { CalibrationOptions, CalibrationResult } from './selfCalibrate';
export { OneEuroFilter, OneEuroVector, OneEuroQuaternion, PoseSmoother, DEFAULT_ROTATION_PARAMS, DEFAULT_TRANSLATION_PARAMS } from './oneEuro';
export type { OneEuroParams } from './oneEuro';
export { projectionMatrixGL, fitTransform, videoToViewport, viewportToVideo, viewportIntrinsics } from './projection';
export type { ObjectFit, FitTransform, ProjectionInput } from './projection';
export { modelMatrixIfc, modelMatrixGltf, markerAxesInModel, markerFromModel, CV_TO_GL, GLTF_FROM_IFC, IFC_FROM_GLTF, IFC_FROM_GLTF_MAT4 } from './modelMatrix';
export type { Anchor } from './modelMatrix';
export { PoseTracker } from './tracker';
export type { TrackedPose, TrackerOptions } from './tracker';
