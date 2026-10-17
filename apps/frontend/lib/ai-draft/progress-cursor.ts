import { CURRENT_PROJECT_CONTRACT_VERSION } from '@aiproj/types'

export const AI_DRAFT_PROGRESS_CURSOR_KEY = 'aiproj-ai-draft-progress-cursor-v1'
export const AI_DRAFT_PROGRESS_CURSOR_TTL_MS = 24 * 60 * 60 * 1_000

export interface DraftProgressCursor {
  userId: number
  organizationId: number
  draftId: string
  version: number
  lastSequence: number
  contractVersion: typeof CURRENT_PROJECT_CONTRACT_VERSION
  timestamp: number
}

export type DraftProgressCursorInput = Omit<DraftProgressCursor, 'contractVersion' | 'timestamp'>

function isCursor(value: unknown): value is DraftProgressCursor {
  if (!value || typeof value !== 'object') return false
  const cursor = value as Partial<DraftProgressCursor>
  return (
    Number.isInteger(cursor.userId) &&
    Number.isInteger(cursor.organizationId) &&
    typeof cursor.draftId === 'string' &&
    cursor.draftId.length > 0 &&
    Number.isInteger(cursor.version) &&
    Number.isInteger(cursor.lastSequence) &&
    Number(cursor.lastSequence) >= 0 &&
    cursor.contractVersion === CURRENT_PROJECT_CONTRACT_VERSION &&
    typeof cursor.timestamp === 'number'
  )
}

/** 只保存恢复所需的低敏标识，不保存 prompt、chunk、模块正文或完整事件。 */
export function writeDraftProgressCursor(cursor: DraftProgressCursorInput): void {
  if (typeof sessionStorage === 'undefined') return
  sessionStorage.setItem(
    AI_DRAFT_PROGRESS_CURSOR_KEY,
    JSON.stringify({
      ...cursor,
      contractVersion: CURRENT_PROJECT_CONTRACT_VERSION,
      timestamp: Date.now(),
    } satisfies DraftProgressCursor),
  )
}

export function readDraftProgressCursor(scope: {
  userId: number | null
  organizationId: number | null
}): DraftProgressCursor | null {
  if (
    typeof sessionStorage === 'undefined' ||
    scope.userId === null ||
    scope.organizationId === null
  ) {
    return null
  }
  try {
    const parsed = JSON.parse(sessionStorage.getItem(AI_DRAFT_PROGRESS_CURSOR_KEY) ?? 'null')
    if (!isCursor(parsed)) {
      sessionStorage.removeItem(AI_DRAFT_PROGRESS_CURSOR_KEY)
      return null
    }
    if (Date.now() - parsed.timestamp > AI_DRAFT_PROGRESS_CURSOR_TTL_MS) {
      sessionStorage.removeItem(AI_DRAFT_PROGRESS_CURSOR_KEY)
      return null
    }
    if (parsed.userId !== scope.userId || parsed.organizationId !== scope.organizationId) {
      sessionStorage.removeItem(AI_DRAFT_PROGRESS_CURSOR_KEY)
      return null
    }
    return parsed
  } catch {
    sessionStorage.removeItem(AI_DRAFT_PROGRESS_CURSOR_KEY)
    return null
  }
}

export function clearDraftProgressCursor(): void {
  if (typeof sessionStorage === 'undefined') return
  sessionStorage.removeItem(AI_DRAFT_PROGRESS_CURSOR_KEY)
}
