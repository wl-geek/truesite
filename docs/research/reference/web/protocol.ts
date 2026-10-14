import type { QrDetection } from './jsqrDetect'

/** main -> worker. `buffer` is ImageData.data.buffer, transferred (zero-copy). */
export interface QrRequest {
  id: number
  width: number
  height: number
  buffer: ArrayBuffer
}

/** worker -> main. The buffer is transferred back so the caller can reuse it. */
export interface QrResponse {
  id: number
  ms: number
  detection: QrDetection | null
  buffer: ArrayBuffer
}
