/**
 * ai-structured-output-poc / M0 —— 三档判定 + AIMarker 覆盖率检查。
 *
 * spec 硬约束：
 *   - 「M0 结构化一致性必须按分布口径三档测量」：strict / repaired / failed；
 *   - 「必填推断字段的 AIMarker 覆盖率必须为 100%」，任一字段缺 marker 一律判失败。
 *
 * 流程：
 *   1) 调 `tryParseJson`（recovery.ts）拿到 raw JSON；
 *   2) 调 `parseDraft`（schema.ts）做 zod 校验；
 *   3) 用 `AiM0InputCase.expectedRequiredInferredFields` 逐字段检查 marker 覆盖；
 *   4) 分档：一次通过且覆盖=1 → strict；经清洗/修补且覆盖=1 → repaired；否则 failed。
 */

import type {
  AiM0ConsistencyBucket,
  AiM0ErrorKind,
  AiM0InputCase,
  AiProjectDraft,
} from '@aiproj/types'
import { parseDraft } from './schema.ts'
import { tryParseJson } from './recovery.ts'

export interface JudgeResult {
  bucket: AiM0ConsistencyBucket
  draft: AiProjectDraft | null
  markerCoverage: number
  missingMarkerFields: string[]
  appliedFixes: string[]
  triggeredErrors: AiM0ErrorKind[]
}

/**
 * 分档判定。`triggeredErrorsFromAdapter` 来自 gateway（token_limit / sse_interrupted / refusal）。
 */
export function judgeOutcome(input: {
  rawText: string
  triggeredErrorsFromAdapter: AiM0ErrorKind[]
  expectedRequiredInferredFields: AiM0InputCase['expectedRequiredInferredFields']
}): JudgeResult {
  const errors = [...input.triggeredErrorsFromAdapter]

  // step 1 —— 解析 JSON（含轻量修复）
  const parsed = tryParseJson(input.rawText)
  if (!parsed.ok) {
    if (parsed.errorKind) errors.push(parsed.errorKind)
    return {
      bucket: 'failed',
      draft: null,
      markerCoverage: 0,
      missingMarkerFields: [],
      appliedFixes: parsed.appliedFixes,
      triggeredErrors: errors,
    }
  }

  // step 2 —— zod 结构化校验
  const draftResult = parseDraft(parsed.value)
  if (!draftResult.ok) {
    errors.push('field_missing_or_type_error')
    return {
      bucket: 'failed',
      draft: null,
      markerCoverage: 0,
      missingMarkerFields: draftResult.issues.map((i) => i.path.join('.')).slice(0, 20),
      appliedFixes: parsed.appliedFixes,
      triggeredErrors: errors,
    }
  }

  // step 3 —— AIMarker 覆盖率
  const missing = computeMissingMarkers(draftResult.value, input.expectedRequiredInferredFields)
  const coverage =
    input.expectedRequiredInferredFields.length === 0
      ? 1
      : (input.expectedRequiredInferredFields.length - missing.length) /
        input.expectedRequiredInferredFields.length

  if (missing.length > 0) {
    errors.push('field_missing_or_type_error')
    return {
      bucket: 'failed',
      draft: draftResult.value,
      markerCoverage: coverage,
      missingMarkerFields: missing,
      appliedFixes: parsed.appliedFixes,
      triggeredErrors: errors,
    }
  }

  // step 4 —— 分档
  const bucket: AiM0ConsistencyBucket = parsed.appliedFixes.length === 0 ? 'strict' : 'repaired'
  return {
    bucket,
    draft: draftResult.value,
    markerCoverage: 1,
    missingMarkerFields: [],
    appliedFixes: parsed.appliedFixes,
    triggeredErrors: errors,
  }
}

/**
 * 按点分路径检查 marker 完整性。
 * 支持 `charter.startDate` / `tasks[].durationDays` / `wbs[].name` 等模板路径。
 */
export function computeMissingMarkers(
  draft: AiProjectDraft,
  expected: readonly string[],
): string[] {
  const missing: string[] = []
  for (const path of expected) {
    if (!checkMarkerAtPath(draft, path)) {
      missing.push(path)
    }
  }
  return missing
}

/**
 * 支持三种路径写法：
 *   - `charter.startDate` — 直接对象路径；
 *   - `tasks[].durationDays` — 数组每项都要满足；
 *   - `wbs[].children[].name` — 递归（本 POC 只做一层 `[]` 展开 + wbs 特殊递归）。
 */
function checkMarkerAtPath(root: any, path: string): boolean {
  const segments = path.split('.')
  return walk(root, segments)
}

function walk(node: any, segments: string[]): boolean {
  if (segments.length === 0) return isMarked(node)
  const [head, ...rest] = segments
  if (head.endsWith('[]')) {
    const key = head.slice(0, -2)
    const arr = node?.[key]
    if (!Array.isArray(arr) || arr.length === 0) return false
    // 特殊：wbs 树递归 —— 若 rest 起点是 `name`/`description`，只查每个节点自身；
    // 若 rest 起点是 `children[]`，走递归。
    return arr.every((item) => {
      // wbs 递归：如果查 `wbs[].name` 且节点有 children，也要求每个 children 的 name 都有 marker。
      const selfOk = walk(item, rest)
      if (!selfOk) return false
      if (key === 'wbs' || key === 'children') {
        const kids = item?.children
        if (Array.isArray(kids) && kids.length > 0) {
          return kids.every((k: any) => walk(k, rest))
        }
      }
      return true
    })
  }
  if (node === null || node === undefined) return false
  return walk(node[head], rest)
}

function isMarked(v: any): boolean {
  if (v === null || v === undefined || typeof v !== 'object') return false
  const m = v.marker
  return (
    m !== null &&
    m !== undefined &&
    typeof m.confidence === 'number' &&
    typeof m.source === 'string' &&
    typeof m.reason === 'string' &&
    typeof m.needsConfirmation === 'boolean'
  )
}
