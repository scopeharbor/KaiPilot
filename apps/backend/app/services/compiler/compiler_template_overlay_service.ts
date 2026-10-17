/**
 * v3-template-compiler-plugin-integration —— CompilerTemplateOverlayService（tasks 3.1）。
 *
 * 纯函数 overlay：host defaults < template seed < explicit user input
 * - unknown 字段、Stage/handler/prompt 等禁止字段 blocking
 * - 输出逐字段 provenance 与 conflict findings
 * - snapshot 与 TOCTOU 验证
 */

import {
  templatePackFnv1aHash,
  templatePackStableSerialize,
  normalizeCompilerSeed,
} from '@aiproj/types'
import type { CompilerProjectStartSeed } from '@aiproj/types'

export const HOST_DEFAULT_COMPILER_INPUT: Record<string, unknown> = {
  projectType: 'general',
  objectives: [],
  description: '',
  wbsConstraints: { maxDepth: 3, maxTasks: 50, requireMilestones: false },
  deadline: null,
  teamSize: null,
}

export interface CompilerTemplateSnapshot {
  pluginId: string
  pluginVersion: string
  templateId: string
  templateVersion: number
  payloadDigest: string
  compatDigest: string
  seedDigest: string
  selectionDigest: string
  seed: CompilerProjectStartSeed
}

export interface OverlayProvenance {
  field: string
  source: 'host-default' | 'template' | 'user'
  overridden?: boolean
  previousValue?: unknown
}

export interface OverlayFinding {
  code: 'unknown-field' | 'forbidden-field' | 'conflict-overridden'
  severity: 'info' | 'warning' | 'blocking'
  message: string
  path?: string
}

export interface OverlayResult {
  merged: Record<string, unknown>
  provenance: OverlayProvenance[]
  findings: OverlayFinding[]
  snapshot: CompilerTemplateSnapshot
}

const ALLOWED_OVERLAY_FIELDS = new Set<string>([
  'projectType',
  'objectives',
  'description',
  'wbsConstraints',
  'deadline',
  'teamSize',
  'budget',
  'methodology',
  'qualityStandard',
  'text',
])

const FORBIDDEN_FIELDS = new Set<string>([
  'stage',
  'stages',
  'stageManifest',
  'stageOrder',
  'handler',
  'prompt',
  'promptTemplate',
  'code',
  'script',
  'secret',
  'organizationId',
  'tenantId',
])

/**
 * 从 detail 构建不可变 snapshot（规范化 seed + digests）。
 */
export function buildSnapshotFromDetail(detail: {
  pluginId: string
  pluginVersion: string
  templateId: string
  version: number
  payloadDigest: string
  compatDigest: string
  seedDigest: string
  selectionDigest: string
  seed: CompilerProjectStartSeed
}): CompilerTemplateSnapshot {
  const normalizedSeed = normalizeCompilerSeed(detail.seed)
  return {
    pluginId: detail.pluginId,
    pluginVersion: detail.pluginVersion,
    templateId: detail.templateId,
    templateVersion: detail.version,
    payloadDigest: detail.payloadDigest,
    compatDigest: detail.compatDigest,
    seedDigest: detail.seedDigest,
    selectionDigest: detail.selectionDigest,
    seed: normalizedSeed,
  }
}

/**
 * 三层合并：host defaults < template seed < explicit user input
 * - explicit user input 最高优先，记录覆盖
 * - unknown/forbidden 字段产生 blocking finding
 */
export function applyTemplateOverlay(params: {
  hostDefaults?: Record<string, unknown>
  snapshot: CompilerTemplateSnapshot
  userInput: Record<string, unknown>
}): OverlayResult {
  const host = params.hostDefaults ?? HOST_DEFAULT_COMPILER_INPUT
  const snapshot = params.snapshot
  const userInput = params.userInput ?? {}

  const findings: OverlayFinding[] = []
  const provenance: OverlayProvenance[] = []

  // 校验 forbidden / unknown
  for (const key of Object.keys(userInput)) {
    if (FORBIDDEN_FIELDS.has(key)) {
      findings.push({
        code: 'forbidden-field',
        severity: 'blocking',
        message: `Field '${key}' is forbidden and cannot be overridden by template or user.`,
        path: key,
      })
    } else if (
      !ALLOWED_OVERLAY_FIELDS.has(key) &&
      !(key in host) &&
      !(key in (snapshot.seed as unknown as Record<string, unknown>))
    ) {
      // 未知字段 blocking（白名单外）
      // 允许 text 字段（用户输入核心）
      if (!ALLOWED_OVERLAY_FIELDS.has(key)) {
        findings.push({
          code: 'unknown-field',
          severity: 'blocking',
          message: `Unknown field '${key}' is not allowed for compiler input.`,
          path: key,
        })
      }
    }
  }

  // 也校验 seed 中的 forbidden（理论上 validate 已拦，但 overlay 再拦）
  for (const key of Object.keys(snapshot.seed as unknown as Record<string, unknown>)) {
    if (FORBIDDEN_FIELDS.has(key)) {
      findings.push({
        code: 'forbidden-field',
        severity: 'blocking',
        message: `Template seed field '${key}' is forbidden.`,
        path: `seed.${key}`,
      })
    }
  }

  const blocking = findings.some((f) => f.severity === 'blocking')
  if (blocking) {
    return { merged: {}, provenance, findings, snapshot }
  }

  // 合并
  const merged: Record<string, unknown> = { ...host }

  // template 层
  for (const [k, v] of Object.entries(snapshot.seed as unknown as Record<string, unknown>)) {
    if (v === undefined) continue
    const prev = merged[k]
    const overridden = prev !== undefined && JSON.stringify(prev) !== JSON.stringify(v)
    merged[k] = v
    provenance.push({
      field: k,
      source: 'template',
      ...(overridden ? { overridden: true, previousValue: prev } : {}),
    })
    if (overridden) {
      findings.push({
        code: 'conflict-overridden',
        severity: 'info',
        message: `Template value for '${k}' overrides host default.`,
        path: k,
      })
    }
  }

  // user 层（最高优先）
  for (const [k, v] of Object.entries(userInput)) {
    if (v === undefined || v === null || (typeof v === 'string' && v.trim() === '')) continue
    const prev = merged[k]
    const exists = k in merged
    const overridden = exists && JSON.stringify(prev) !== JSON.stringify(v)
    merged[k] = v
    provenance.push({
      field: k,
      source: 'user',
      ...(overridden ? { overridden: true, previousValue: prev } : {}),
    })
    if (overridden) {
      findings.push({
        code: 'conflict-overridden',
        severity: 'info',
        message: `User value for '${k}' overrides template/default. User input takes precedence.`,
        path: k,
      })
    }
  }

  // 标记 host-default 仍保留的字段 provenance
  for (const k of Object.keys(host)) {
    if (!provenance.some((p) => p.field === k)) {
      provenance.push({ field: k, source: 'host-default' })
    }
  }

  return { merged, provenance, findings, snapshot }
}

/**
 * TOCTOU 验证：提交时的 selectionDigest 必须与当前 detail 的 selectionDigest 一致。
 * 不一致说明模板在 preview 后已升级/替换，需提示 stale digest。
 */
export function verifyTocTou(
  detail: { selectionDigest: string },
  submittedDigest: string,
): { ok: boolean; reason?: string } {
  if (!submittedDigest || typeof submittedDigest !== 'string') {
    return { ok: false, reason: 'Missing selection digest' }
  }
  if (detail.selectionDigest !== submittedDigest) {
    return { ok: false, reason: 'Template selection is stale; please refresh and re-select.' }
  }
  return { ok: true }
}

/**
 * 生成 snapshot 的 display digest（用于调试 / 审计低敏展示）。
 */
export function snapshotDigest(snapshot: CompilerTemplateSnapshot): string {
  return templatePackFnv1aHash(templatePackStableSerialize(snapshot))
}
