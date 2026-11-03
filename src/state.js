import { readFileSync, writeFileSync, renameSync } from 'node:fs'

export function createStore(filePath, defaults = {}) {
  let data = { ...defaults }
  try {
    data = { ...defaults, ...JSON.parse(readFileSync(filePath, 'utf8')) }
  } catch {
    data = { ...defaults }
  }
  return {
    get: () => data,
    set(patch) {
      data = { ...data, ...patch }
    },
    async flush() {
      const tmp = `${filePath}.tmp`
      writeFileSync(tmp, JSON.stringify(data))
      renameSync(tmp, filePath)
    },
  }
}
