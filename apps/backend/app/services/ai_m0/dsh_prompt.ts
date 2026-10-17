/** Default persona from DSH sdk-minimal/cordis.patch.yml (0.1.5-rc.1). */
export const DSH_MINIMAL_SYSTEM_PROMPT = 'You are a helpful software engineer assistant.'

/** Keep the original business instructions verbatim after the minimal persona. */
export function withDshMinimalPrompt(originalPrompt = ''): string {
  if (
    !originalPrompt ||
    originalPrompt === DSH_MINIMAL_SYSTEM_PROMPT ||
    originalPrompt.startsWith(`${DSH_MINIMAL_SYSTEM_PROMPT}\n\n`)
  ) {
    return originalPrompt || DSH_MINIMAL_SYSTEM_PROMPT
  }
  return `${DSH_MINIMAL_SYSTEM_PROMPT}\n\n${originalPrompt}`
}
