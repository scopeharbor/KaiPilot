'use client'

import type { CopilotStreamPhase } from '@/stores/copilot-store'

/**
 * 演示流式游标（任务 4.9：刷新后续接进行中会话）。
 *
 * 复用既有 progress-cursor 的机制与纪律（见 `lib/ai-draft/progress-cursor.ts`）：
 * - 只保存低敏标识：sessionId + 阶段 + 时间戳，**不保存** prompt、消息或任何正文；
 * - sessionStorage 存储 + 24h TTL + 结构校验，损坏/过期即清除；
 * - 生产流式通道接入后，本游标由后端 cursor 语义替换，壳的接续行为不变。
 */
export const COPILOT_DEMO_CURSOR_KEY = 'aiproj-copilot-demo-cursor-v1'
export const COPILOT_DEMO_CURSOR_TTL_MS = 24 * 60 * 60 * 1_000

/** 可接续的流式阶段（idle/done/cancelled/error 为终态，不写游标）。 */
const RESUMABLE_PHASES: ReadonlySet<string> = new Set(['understanding', 'analyzing', 'generating'])

export interface CopilotDemoCursor {
  sessionId: string
  phase: CopilotStreamPhase
  timestamp: number
}

function isCursor(value: unknown): value is CopilotDemoCursor {
  if (!value || typeof value !== 'object') return false
  const c = value as Partial<CopilotDemoCursor>
  return (
    typeof c.sessionId === 'string' &&
    c.sessionId.length > 0 &&
    typeof c.phase === 'string' &&
    RESUMABLE_PHASES.has(c.phase) &&
    typeof c.timestamp === 'number'
  )
}

export function writeCopilotDemoCursor(sessionId: string, phase: CopilotStreamPhase): void {
  if (typeof sessionStorage === 'undefined') return
  try {
    sessionStorage.setItem(
      COPILOT_DEMO_CURSOR_KEY,
      JSON.stringify({ sessionId, phase, timestamp: Date.now() } satisfies CopilotDemoCursor),
    )
  } catch {
    // sessionStorage 不可用 — 静默跳过（接续能力降级，不影响面板主功能）
  }
}

export function readCopilotDemoCursor(): CopilotDemoCursor | null {
  if (typeof sessionStorage === 'undefined') return null
  try {
    const parsed = JSON.parse(sessionStorage.getItem(COPILOT_DEMO_CURSOR_KEY) ?? 'null')
    if (!isCursor(parsed)) {
      sessionStorage.removeItem(COPILOT_DEMO_CURSOR_KEY)
      return null
    }
    if (Date.now() - parsed.timestamp > COPILOT_DEMO_CURSOR_TTL_MS) {
      sessionStorage.removeItem(COPILOT_DEMO_CURSOR_KEY)
      return null
    }
    return parsed
  } catch {
    sessionStorage.removeItem(COPILOT_DEMO_CURSOR_KEY)
    return null
  }
}

export function clearCopilotDemoCursor(): void {
  if (typeof sessionStorage === 'undefined') return
  sessionStorage.removeItem(COPILOT_DEMO_CURSOR_KEY)
}
