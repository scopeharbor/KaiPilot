/**
 * @aiproj/compiler-spec —— Artifact Ref / Envelope / Summary / Context Packet schema（v2-context-compiler-artifact-store §1）。
 *
 * V2 MVP 的 artifact-centric 上下文契约定义。
 * 只包含 V2.0 所需的类型：结构化 ref、envelope、两级摘要、Context Packet、预算与 provenance。
 */

import { z } from 'zod'

// ── Artifact Summary Level ──

export const artifactSummaryLevelSchema = z.enum(['full', 'compact'])

export type ArtifactSummaryLevel = z.infer<typeof artifactSummaryLevelSchema>

// ── Artifact Ref ──

/**
 * 结构化 Artifact Ref —— 在 Stage 间传递 artifact 的唯一引用协议。
 *
 * 字符串形态：
 *   artifact:<kind>:<artifactId>:v<version>@<summaryLevel>[?stage=<stageId>&entity=<entityId>]
 */
export const artifactRefSchema = z.object({
  compilerRunId: z.number().int().positive(),
  organizationId: z.number().int().positive(),
  kind: z.string().min(1),
  artifactId: z.string().min(1),
  version: z.number().int().positive(),
  summaryLevel: artifactSummaryLevelSchema,
  stageId: z.string().optional(),
  entityId: z.string().optional(),
  contractVersion: z.number().int().positive().optional(),
  manifestVersion: z.number().int().positive().optional(),
})

export type ArtifactRef = z.infer<typeof artifactRefSchema>

/**
 * Artifact Ref 校验（用于运行时拒绝不合规的 ref）。
 */
export function validateArtifactRef(ref: unknown): { valid: boolean; errors?: string[] } {
  const result = artifactRefSchema.safeParse(ref)
  if (result.success) return { valid: true }
  return {
    valid: false,
    errors: result.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`),
  }
}

// ── Artifact Ref 字符串化与反解析 ──

/**
 * 从结构化 ref 生成稳定字符串引用。
 * 格式：artifact:<kind>:<artifactId>:v<version>@<summaryLevel>?stage=<stageId>&entity=<entityId>
 */
export function stringifyArtifactRef(ref: ArtifactRef): string {
  let base = `artifact:${ref.kind}:${ref.artifactId}:v${ref.version}@${ref.summaryLevel}`
  const params: string[] = []
  if (ref.stageId) params.push(`stage=${encodeURIComponent(ref.stageId)}`)
  if (ref.entityId) params.push(`entity=${encodeURIComponent(ref.entityId)}`)
  if (ref.contractVersion) params.push(`cv=${ref.contractVersion}`)
  if (ref.manifestVersion) params.push(`mv=${ref.manifestVersion}`)
  if (params.length > 0) base += `?${params.join('&')}`
  return base
}

/**
 * 从字符串引用反解析回结构化 ref（不含运行时上下文字段，如 compilerRunId / organizationId）。
 */
export function parseArtifactRef(input: string): { ref: ArtifactRef; errors?: string[] } | null {
  const match = input.match(/^artifact:([^:]+):([^:]+):v(\d+)@(full|compact)(?:\?(.+))?$/)
  if (!match) return null

  const kind = match[1]!
  const artifactId = match[2]!
  const versionStr = match[3]!
  const summaryLevel = match[4]!
  const queryString = match[5]
  const version = Number.parseInt(versionStr, 10)

  const ref: ArtifactRef = {
    compilerRunId: 0, // placeholder — 调用方需填入
    organizationId: 0, // placeholder — 调用方需填入
    kind,
    artifactId,
    version,
    summaryLevel: summaryLevel as ArtifactSummaryLevel,
  }

  if (queryString) {
    const params = new URLSearchParams(queryString)
    const stageId = params.get('stage')
    const entityId = params.get('entity')
    const cv = params.get('cv')
    const mv = params.get('mv')
    if (stageId) ref.stageId = decodeURIComponent(stageId)
    if (entityId) ref.entityId = decodeURIComponent(entityId)
    if (cv) ref.contractVersion = Number.parseInt(cv, 10)
    if (mv) ref.manifestVersion = Number.parseInt(mv, 10)
  }

  return { ref }
}

// ── Artifact Envelope ──

export const artifactEnvelopeSchema = z.object({
  kind: z.string().min(1),
  schemaVersion: z.string().min(1),
  version: z.number().int().positive(),
  stageId: z.string().optional(),
  entityId: z.string().optional(),
  inputRefs: z.array(z.string()).default([]),
  outputRefs: z.array(z.string()).default([]),
  idempotencyKey: z.string().optional(),
  summaryLevel: artifactSummaryLevelSchema,
  contentHash: z.string().length(64),
  createdAt: z.string().datetime(),
  createdBy: z.string().optional(),
  validationSummary: z
    .object({
      passed: z.boolean(),
      issues: z
        .array(
          z.object({
            severity: z.enum(['error', 'warning', 'info']),
            message: z.string(),
          }),
        )
        .default([]),
    })
    .optional(),
})

export type ArtifactEnvelope = z.infer<typeof artifactEnvelopeSchema>

// ── Context Section Priority ──

export const contextPrioritySchema = z.enum(['P0', 'P1', 'P2'])

export type ContextPriority = z.infer<typeof contextPrioritySchema>

// ── Context Section ──

export const contextSectionSchema = z.object({
  name: z.string().min(1),
  priority: contextPrioritySchema,
  summaryLevel: artifactSummaryLevelSchema,
  requestedTokens: z.number().int().nonnegative(),
  includedTokens: z.number().int().nonnegative(),
  cutReason: z.string().optional(),
  content: z.unknown(),
  sourceRefs: z.array(z.string()).default([]),
})

export type ContextSection = z.infer<typeof contextSectionSchema>

// ── Context Budget ──

export const contextBudgetSchema = z.object({
  totalBudget: z.number().int().positive(),
  totalRequested: z.number().int().nonnegative(),
  totalIncluded: z.number().int().nonnegative(),
  sections: z.array(contextSectionSchema),
  overBudget: z.boolean(),
  overBudgetReason: z.string().optional(),
})

export type ContextBudget = z.infer<typeof contextBudgetSchema>

// ── Context Provenance ──

export const contextProvenanceSchema = z.object({
  contractRef: z.string().optional(),
  manifestRef: z.string().optional(),
  ledgerRef: z.string().optional(),
  pdmRef: z.string().optional(),
  repairFeedbackRefs: z.array(z.string()).default([]),
  inputScope: z.array(z.string()).default([]),
  allowedTools: z.array(z.string()).default([]),
  skillActivationRef: z.string().optional(),
  advisorySkillRefs: z.array(z.string()).default([]),
})

export type ContextProvenance = z.infer<typeof contextProvenanceSchema>

// ── Context Packet ──

export const contextPacketSchema = z.object({
  schemaVersion: z.literal('2.0'),
  packetId: z.string().min(1),
  compilerRunId: z.number().int().positive(),
  organizationId: z.number().int().positive(),
  targetEntityId: z.string().optional(),
  targetBatchId: z.string().optional(),
  sections: z.array(contextSectionSchema),
  budget: contextBudgetSchema,
  provenance: contextProvenanceSchema,
  createdAt: z.string().datetime(),
})

export type ContextPacket = z.infer<typeof contextPacketSchema>

// ── Context Compiler Error ──

export const contextCompilerErrorSchema = z.object({
  code: z.enum([
    'BUDGET_EXCEEDED_P0',
    'INVALID_ARTIFACT_REF',
    'SCOPE_VIOLATION',
    'ORGANIZATION_MISMATCH',
    'MANIFEST_ENTITY_NOT_FOUND',
    'UNAUTHORIZED_TOOL',
    'INTERNAL_ERROR',
  ]),
  message: z.string().min(1),
  details: z.record(z.string(), z.unknown()).optional(),
})

export type ContextCompilerError = z.infer<typeof contextCompilerErrorSchema>

// ── Token 估算（轻量字符/JSON 长度近似，不引入 tokenizer 依赖） ──

/**
 * 简单的 token 估算：按 JSON 字符串长度 / 4 估算 token 数。
 * 这与 OpenAI/Claude tokenizer 不完全一致，但作为预算门禁足够。
 */
export function estimateTokens(obj: unknown): number {
  const raw = JSON.stringify(obj)
  // 中文及 multibyte 字符估算
  let tokenCount = 0
  for (let i = 0; i < raw.length; i++) {
    const code = raw.charCodeAt(i)
    if (code > 0x7f) {
      tokenCount += 2 // 非 ASCII 字符估 2 token
    } else {
      tokenCount += 0.25 // ASCII 字符估 0.25 token
    }
  }
  return Math.ceil(tokenCount)
}
