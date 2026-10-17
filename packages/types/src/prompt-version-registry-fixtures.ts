/**
 * v3-prompt-version-registry —— 注册表 fixtures。
 *
 * 覆盖四态：已注册、未注册、hash 不符、多生效范围。
 * 全部为低敏确定性数据；不包含 prompt 全文。
 */

import type { PromptVersionEntry, PromptVersionScope } from './prompt-version-registry.js'
import { computePromptContentHash } from './prompt-version-registry.js'

// ---------------------------------------------------------------------------
// 固定 hash（由确定性内容推导，用于 fixture）
// ---------------------------------------------------------------------------

/** 已知 prompt 内容 'You are a risk suggestion assistant.' 的 hash。 */
export const KNOWN_PROMPT_CONTENT = 'You are a risk suggestion assistant.'
export const KNOWN_PROMPT_HASH = computePromptContentHash(KNOWN_PROMPT_CONTENT)

/** 已知 prompt 内容 'You are a TRIZ contradiction analyst.' 的 hash。 */
export const TRIZ_PROMPT_CONTENT = 'You are a TRIZ contradiction analyst.'
export const TRIZ_PROMPT_HASH = computePromptContentHash(TRIZ_PROMPT_CONTENT)

/** 与已注册 hash 不同的 hash（模拟运行时变体）。 */
export const MISMATCH_HASH = '0000000000000000'

// ---------------------------------------------------------------------------
// 作用域 fixtures
// ---------------------------------------------------------------------------

export const SCOPE_RISK: PromptVersionScope = {
  capabilities: ['risk'],
  strategies: ['copilot', 'compiler'],
}

export const SCOPE_TRIZ: PromptVersionScope = {
  capabilities: ['triz'],
  strategies: ['copilot'],
}

export const SCOPE_GLOBAL: PromptVersionScope = {
  capabilities: [],
  strategies: [],
}

export const SCOPE_MULTI_CAPABILITY: PromptVersionScope = {
  capabilities: ['risk', 'draft', 'triz'],
  strategies: ['copilot'],
}

// ---------------------------------------------------------------------------
// 条目 fixtures
// ---------------------------------------------------------------------------

const BASE_TIME = '2026-08-01T00:00:00.000Z'

/** 已注册条目 — 风险建议 prompt。 */
export const REGISTERED_RISK_ENTRY: PromptVersionEntry = {
  promptName: 'risk-suggest',
  version: '1.0.0',
  contentHash: KNOWN_PROMPT_HASH,
  effectiveScope: SCOPE_RISK,
  createdAt: BASE_TIME,
}

/** 已注册条目 — TRIZ 矛盾分析 prompt。 */
export const REGISTERED_TRIZ_ENTRY: PromptVersionEntry = {
  promptName: 'triz-contradiction',
  version: '2.1.0',
  contentHash: TRIZ_PROMPT_HASH,
  effectiveScope: SCOPE_TRIZ,
  createdAt: BASE_TIME,
}

/** 已注册条目 — 多能力面生效范围。 */
export const REGISTERED_MULTI_SCOPE_ENTRY: PromptVersionEntry = {
  promptName: 'risk-suggest',
  version: '2.0.0',
  contentHash: KNOWN_PROMPT_HASH,
  effectiveScope: SCOPE_MULTI_CAPABILITY,
  createdAt: '2026-08-15T00:00:00.000Z',
}

/** 已注册条目 — 全局生效范围。 */
export const REGISTERED_GLOBAL_ENTRY: PromptVersionEntry = {
  promptName: 'general-purpose',
  version: '1.0.0',
  contentHash: KNOWN_PROMPT_HASH,
  effectiveScope: SCOPE_GLOBAL,
  createdAt: BASE_TIME,
}

// ---------------------------------------------------------------------------
// 完整注册表 fixtures（四态覆盖）
// ---------------------------------------------------------------------------

export const PROMPT_VERSION_REGISTRY_FIXTURES: PromptVersionEntry[] = [
  REGISTERED_RISK_ENTRY,
  REGISTERED_TRIZ_ENTRY,
  REGISTERED_MULTI_SCOPE_ENTRY,
  REGISTERED_GLOBAL_ENTRY,
]
