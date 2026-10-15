/** Calls `onStall` once when no frame has arrived for `staleMs` while started; a new frame re-arms it. */
export function createFrameWatchdog(onStall: () => void, staleMs = 1000, checkMs = 250): { start(): void; stop(): void; frame(): void } {
  let timer: ReturnType<typeof setInterval> | null = null
  let lastFrame = 0
  let stalled = false
  return {
    start() {
      lastFrame = Date.now()
      stalled = false
      timer ??= setInterval(() => {
        if (!stalled && Date.now() - lastFrame > staleMs) {
          stalled = true
          onStall()
        }
      }, checkMs)
    },
    stop() {
      if (timer !== null) clearInterval(timer)
      timer = null
    },
    frame() {
      lastFrame = Date.now()
      stalled = false
    },
  }
}
