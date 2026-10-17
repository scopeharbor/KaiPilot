import type AiConnectionModel from '#models/ai_connection_model'

type Clock = () => number

interface WindowState {
  requests: number[]
  tokens: Array<{ at: number; tokens: number }>
}

const WINDOW_MS = 60_000
const states = new Map<number, WindowState>()

function stateFor(modelId: number): WindowState {
  const existing = states.get(modelId)
  if (existing) return existing
  const state = { requests: [], tokens: [] }
  states.set(modelId, state)
  return state
}

function prune(state: WindowState, now: number) {
  const min = now - WINDOW_MS
  state.requests = state.requests.filter((at) => at > min)
  state.tokens = state.tokens.filter((entry) => entry.at > min)
}

function delay(ms: number): Promise<void> {
  if (ms <= 0) return Promise.resolve()
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export async function throttleModelCall(
  model: Pick<AiConnectionModel, 'id' | 'rpmLimit' | 'tpmLimit'>,
  estimatedTokens: number,
  clock: Clock = Date.now,
): Promise<number> {
  const rpm = model.rpmLimit
  const tpm = model.tpmLimit
  if (!rpm && !tpm) return 0

  const state = stateFor(Number(model.id))
  let waitedMs = 0

  while (true) {
    const now = clock()
    prune(state, now)

    const rpmWait = rpm && state.requests.length >= rpm ? WINDOW_MS - (now - state.requests[0]) : 0
    const usedTokens = state.tokens.reduce((sum, entry) => sum + entry.tokens, 0)
    const tpmWait =
      tpm && usedTokens + estimatedTokens > tpm && state.tokens.length > 0
        ? WINDOW_MS - (now - state.tokens[0].at)
        : 0
    const waitMs = Math.max(rpmWait ?? 0, tpmWait ?? 0, 0)
    if (waitMs <= 0) {
      state.requests.push(now)
      state.tokens.push({ at: now, tokens: Math.max(0, estimatedTokens) })
      return waitedMs
    }
    waitedMs += waitMs
    await delay(waitMs)
  }
}

export function clearModelRateLimiterForTests() {
  states.clear()
}
