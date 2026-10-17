import type { AiM0StreamCheckpoint, AiM0Strategy } from '@aiproj/types'

export const AI_M0_STREAM_STORAGE_KEY = 'aiproj:ai-m0:stream:v1'

export function streamRequestFingerprint(input: {
  sentence: string
  strategy: AiM0Strategy
  inputId?: string
  temperature: number
  connectionId?: number | null
}): string {
  const source = JSON.stringify({
    sentence: input.sentence,
    strategy: input.strategy,
    inputId: input.inputId ?? null,
    temperature: input.temperature,
    connectionId: input.connectionId ?? null,
  })
  let hash = 5381
  for (let index = 0; index < source.length; index += 1) {
    hash = ((hash << 5) + hash + source.charCodeAt(index)) >>> 0
  }
  return hash.toString(16).padStart(8, '0')
}

export function saveStreamCheckpoint(
  checkpoint: AiM0StreamCheckpoint,
  storage: Storage = localStorage,
) {
  storage.setItem(AI_M0_STREAM_STORAGE_KEY, JSON.stringify(checkpoint))
}

export function loadStreamCheckpoint(storage: Storage = localStorage): AiM0StreamCheckpoint | null {
  const raw = storage.getItem(AI_M0_STREAM_STORAGE_KEY)
  if (!raw) return null
  try {
    const value = JSON.parse(raw) as AiM0StreamCheckpoint
    return value.schemaVersion === 1 ? value : null
  } catch {
    return null
  }
}

export function clearStreamCheckpoint(storage: Storage = localStorage) {
  storage.removeItem(AI_M0_STREAM_STORAGE_KEY)
}
