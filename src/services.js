export function startServices({ startBot, startCompletions, log = () => {} }) {
  const completionsDone = Promise.resolve()
    .then(startCompletions)
    .catch((error) => log(`completion tracker stopped: ${error.message}`))
  const botDone = Promise.resolve()
    .then(startBot)
    .catch((error) => log(`bot stopped: ${error.message}`))
  return { completionsDone, botDone }
}
