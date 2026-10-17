// v3-resource-capacity-forecasting-closed-loop §7.7 —— loop audit writer 与低敏二次扫描。
//
// allowlist：稳定内部 ref/hash、组织与 actor 引用、状态迁移、reason/warning 码、
// 来源覆盖、状态、计数、耗时、关联 id。禁止：业务快照正文、assumptions/rationale 全文、
// 隐藏实体标识、evidence 正文、URL、文件路径、prompt/模型输出、secret/token/Authorization。
// 持久化前统一 secondary scan，命中即 fail closed（抛错），绝不降级写入。

import { fnv1a32Loop } from '@aiproj/types/resource-capacity-closed-loop-pure'

export type RcclAuditEvent =
  | 'loop_created'
  | 'baseline_refreshed'
  | 'scenario_mutated'
  | 'simulated'
  | 'selection_created'
  | 'handoff_created'
  | 'observation_captured'
  | 'reviewed'
  | 'closed'
  | 'cancelled'
  | 'drill_down'

const ALLOWED_EVENT_SET = new Set<string>(
  Object.values({
    LOOP_CREATED: 'loop_created',
    BASELINE_REFRESHED: 'baseline_refreshed',
    SCENARIO_MUTATED: 'scenario_mutated',
    SIMULATED: 'simulated',
    SELECTION_CREATED: 'selection_created',
    HANDOFF_CREATED: 'handoff_created',
    OBSERVATION_CAPTURED: 'observation_captured',
    REVIEWED: 'reviewed',
    CLOSED: 'closed',
    CANCELLED: 'cancelled',
    DRILL_DOWN: 'drill_down',
  }),
)

export interface RcclAuditRecord {
  event: RcclAuditEvent
  organizationId: number
  actorUserId: number
  /** 稳定内部引用的 hash 形式（loop/receipt/selection 等）。 */
  refHashes: Record<string, string>
  fromState?: string
  toState?: string
  metricVersion?: string
  reasonCodes?: string[]
  warningCodes?: string[]
  sourceCoverage?: string[]
  counts?: Record<string, number>
  durationMs?: number
  correlationId?: string
}

/** 禁词模式：命中即 fail closed。 */
const FORBIDDEN_PATTERNS: RegExp[] = [
  /authorization/i,
  /\bsecret\b/i,
  /\bpassword\b/i,
  /token(?!s)/i,
  /bearer\s/i,
  /prompt/i,
  /model[_\s-]?output/i,
  /file[_\s-]?path|\/home\/|C:\\\\|\/var\//i,
  /https?:\/\//i,
]

/** 禁止的字段名（rationale/assumption/evidence body/payload 类）。 */
const FORBIDDEN_KEY_PATTERNS: RegExp[] = [
  /rationale/i,
  /assumption/i,
  /evidence_?body/i,
  /payload/i,
]

/** 序列化整个 record 后做禁词扫描；再校验字段级 allowlist。 */
export function assertRcclAuditLowSensitive(record: RcclAuditRecord): void {
  if (!ALLOWED_EVENT_SET.has(record.event)) {
    throw new Error(`audit fail closed：未知事件 ${record.event}`)
  }
  const serialized = JSON.stringify(record)
  for (const p of FORBIDDEN_PATTERNS) {
    if (p.test(serialized)) {
      throw new Error(`audit fail closed：命中低敏禁区 ${String(p)}`)
    }
  }
  // rationale/assumption/evidence body 类字段不允许出现在构建结果里。
  for (const key of Object.keys(record as unknown as Record<string, unknown>)) {
    if (/rationale|assumption|evidence_?body|payload/i.test(key)) {
      throw new Error(`audit fail closed：禁止字段 ${key}`)
    }
  }
}

/** 构建并校验记录；refHashes 值统一为 fnv1a hash 形式。 */
export function buildRcclAuditRecord(input: {
  event: RcclAuditEvent
  organizationId: number
  actorUserId: number
  refs?: Record<string, number | string | null>
  fromState?: string
  toState?: string
  metricVersion?: string
  reasonCodes?: string[]
  warningCodes?: string[]
  sourceCoverage?: string[]
  counts?: Record<string, number>
  durationMs?: number
  correlationId?: string
}): RcclAuditRecord {
  // 输入键名先扫（fail closed：禁止 rationale/payload 类自由文本入口）。
  const inputRecord = input as unknown as Record<string, unknown>
  for (const key of Object.keys(inputRecord)) {
    if (FORBIDDEN_KEY_PATTERNS.some((p) => p.test(key))) {
      throw new Error(`audit fail closed：禁止字段 ${key}`)
    }
  }
  const refHashes: Record<string, string> = {}
  for (const [k, v] of Object.entries(input.refs ?? {})) {
    if (v === null || v === undefined || v === '') continue
    refHashes[k] = String(v).startsWith('fnv1a:') ? String(v) : fnv1a32Loop(String(v))
  }
  const record: RcclAuditRecord = {
    event: input.event,
    organizationId: Number(input.organizationId),
    actorUserId: Number(input.actorUserId),
    refHashes,
    fromState: input.fromState,
    toState: input.toState,
    metricVersion: input.metricVersion,
    reasonCodes: input.reasonCodes ?? [],
    warningCodes: input.warningCodes ?? [],
    sourceCoverage: input.sourceCoverage ?? [],
    counts: sanitizeCounts(input.counts),
    durationMs: input.durationMs,
    correlationId: input.correlationId ? fnv1a32Loop(input.correlationId) : undefined,
  }
  assertRcclAuditLowSensitive(record)
  return record
}

function sanitizeCounts(
  counts: Record<string, number> | undefined,
): Record<string, number> | undefined {
  if (!counts) return undefined
  const out: Record<string, number> = {}
  for (const [k, v] of Object.entries(counts)) {
    if (/^[a-z_]+$/.test(k) && Number.isFinite(v)) out[k] = v
  }
  return out
}
