export async function startWithRetry(startFn, { log = () => {}, delayMs = 10_000, setTimeoutImpl = setTimeout } = {}) {
  try {
    await startFn()
  } catch (error) {
    log(`bot start failed: ${error.message}`)
    setTimeoutImpl(() => startWithRetry(startFn, { log, delayMs, setTimeoutImpl }), delayMs)
  }
}
