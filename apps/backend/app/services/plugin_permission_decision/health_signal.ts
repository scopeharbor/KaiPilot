/**
 * v3-plugin-permission-audit-and-observation — Health Signal（task 4.11-4.12）。
 *
 * 审计存储不可用时的 bounded local health signal。
 * 只含 stable code/counter/bucket；禁止 raw error/stack/input。
 *
 * 红线：
 * - denial 保持 denial
 * - allow 收敛为 audit-unavailable denial
 * - 日志无敏感原值
 */

// =============================================================================
// Health Signal Types
// =============================================================================

export interface PluginPermissionHealthSignal {
  /** Stable error code (never raw error message). */
  code: string
  /** Consecutive failure counter. */
  counter: number
  /** Time bucket (e.g., '5m', '1h'). */
  bucket: string
  /** Whether the signal indicates degraded state. */
  degraded: boolean
}

// =============================================================================
// Health Signal Store (in-memory, bounded)
// =============================================================================

const MAX_COUNTER = 1000

let failureCounter = 0
let lastFailureBucket = '1m'

/**
 * Record an audit failure.
 * Increments counter and updates bucket.
 */
export function recordAuditFailure(): PluginPermissionHealthSignal {
  failureCounter = Math.min(failureCounter + 1, MAX_COUNTER)

  // Update bucket based on counter
  if (failureCounter >= 60) {
    lastFailureBucket = '1h'
  } else if (failureCounter >= 15) {
    lastFailureBucket = '15m'
  } else if (failureCounter >= 5) {
    lastFailureBucket = '5m'
  } else {
    lastFailureBucket = '1m'
  }

  return {
    code: 'audit-unavailable',
    counter: failureCounter,
    bucket: lastFailureBucket,
    degraded: true,
  }
}

/**
 * Reset health signal (on successful audit write).
 */
export function resetHealthSignal(): PluginPermissionHealthSignal {
  failureCounter = 0
  lastFailureBucket = '1m'

  return {
    code: 'ok',
    counter: 0,
    bucket: '1m',
    degraded: false,
  }
}

/**
 * Get current health signal.
 */
export function getHealthSignal(): PluginPermissionHealthSignal {
  return {
    code: failureCounter > 0 ? 'audit-unavailable' : 'ok',
    counter: failureCounter,
    bucket: lastFailureBucket,
    degraded: failureCounter > 0,
  }
}
