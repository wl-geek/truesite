// Messages between the main thread and the QR worker, and the detection shape.
// Coordinates are in the pixels of the ImageData that was sent (pixel-edge convention).

export interface Point {
  x: number
  y: number
}

export interface QrDetection {
  /** decoded payload, e.g. https://<host>/a/room1/A1 */
  text: string
  /** outer corners of the symbol in SYMBOL order: TL, TR, BR, BL (an upside-down code's TL is at the image bottom-right) */
  corners: [Point, Point, Point, Point]
  version: number
  /** modules per side: 17 + 4 * version */
  dimension: number
}

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
