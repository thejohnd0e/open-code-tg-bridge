export function startServices({ startBot, startMirror, log = () => {} }) {
  const mirrorDone = Promise.resolve()
    .then(startMirror)
    .catch((error) => log(`mirror stopped: ${error.message}`))
  const botDone = Promise.resolve()
    .then(startBot)
    .catch((error) => log(`bot stopped: ${error.message}`))
  return { mirrorDone, botDone }
}
