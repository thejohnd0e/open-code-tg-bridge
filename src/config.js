export function buildConfig(env = process.env) {
  return {
    ownerID: env.OWNER_TELEGRAM_ID ? Number(env.OWNER_TELEGRAM_ID) : null,
    lightDir: env.LIGHT_DIR ?? process.cwd(),
    lightModel: env.LIGHT_MODEL ?? 'opencode-go/gpt-6-luna',
  }
}
