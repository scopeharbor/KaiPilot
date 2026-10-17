/**
 * 幂等键类型与 helper —— 覆盖 run/stage/entity/contract version/manifest version/attempt number。
 *
 * 幂等键由 `compiler_run_id`、`stage_id`、`entity_id`、`contract_version`、
 * `manifest_version` 与 `attempt_number` 组成。
 * 同一幂等键的重复写入返回既有结果或被安全忽略。
 * 新 attempt 必须显式递增 attempt_number。
 *
 * @aiproj/compiler-spec
 */

import { createHash } from 'node:crypto'

// ── IdempotencyKey ──

export interface IdempotencyKey {
  /** 编译运行 ID。 */
  compilerRunId: number
  /** Stage ID。 */
  stageId: string
  /** 实体 ID（可选：部分操作不关联实体）。 */
  entityId?: string
  /** Contract 版本。 */
  contractVersion: number
  /** Manifest 版本。 */
  manifestVersion: number
  /** 尝试次数（≥1）。 */
  attemptNumber: number
}

// ── Key Components Separator ──

const KEY_SEPARATOR = '::'

// ── Key Types ──

export type IdempotencyKeyType =
  | 'contract_write'
  | 'manifest_write'
  | 'ledger_write'
  | 'entity_artifact'
  | 'pdm_merge'
  | 'cost_write'
  | 'budget_write'

// ── Key Scopes ──

export const IDEMPOTENCY_SCOPE: Record<IdempotencyKeyType, string> = {
  contract_write: 'ctr',
  manifest_write: 'mft',
  ledger_write: 'ldg',
  entity_artifact: 'art',
  pdm_merge: 'pdm',
  cost_write: 'cst',
  budget_write: 'bdg',
} as const

// ── Helper Functions ──

/**
 * 生成幂等键字符串。
 * 格式：`<scope>::<runId>::<stageId>[::<entityId>]::<contractVer>::<manifestVer>::<attemptNum>`
 *
 * @param keyType   幂等键类型（用于区分操作域）
 * @param key       幂等键字段
 * @returns 形如 `ctr::1::stage_intent_parsing::Wdesign_1a2b::1::1::1`
 */
export function generateIdempotencyKey(keyType: IdempotencyKeyType, key: IdempotencyKey): string {
  const scope = IDEMPOTENCY_SCOPE[keyType]
  const parts = [
    scope,
    String(key.compilerRunId),
    key.stageId,
    key.entityId ?? '_',
    String(key.contractVersion),
    String(key.manifestVersion),
    String(key.attemptNumber),
  ]
  return parts.join(KEY_SEPARATOR)
}

/**
 * 从幂等键字符串中解析出字段。
 * 返回 null 表示格式不合法。
 */
export function parseIdempotencyKey(raw: string): {
  keyType: IdempotencyKeyType | null
  key: Partial<IdempotencyKey>
} {
  const parts = raw.split(KEY_SEPARATOR)
  if (parts.length < 6) {
    return { keyType: null, key: {} }
  }

  const scope = parts[0]
  const keyType = Object.entries(IDEMPOTENCY_SCOPE).find(([, v]) => v === scope)?.[0] as
    IdempotencyKeyType | undefined

  return {
    keyType: keyType ?? null,
    key: {
      compilerRunId: Number(parts[1]),
      stageId: parts[2],
      entityId: parts[3] !== '_' ? parts[3] : undefined,
      contractVersion: Number(parts[4]),
      manifestVersion: Number(parts[5]),
      attemptNumber: Number(parts[6]),
    },
  }
}

/**
 * 判断 attempt_number 是否比已有记录新。
 * 用于在重试时校验 attempt 已递增。
 */
export function isAttemptNewer(existingAttempt: number, newAttempt: number): boolean {
  return newAttempt > existingAttempt
}

/**
 * 从幂等键生成稳定 hash（用于数据库唯一索引）。
 * 使用 SHA-256 以确保稳定性和低碰撞。
 */
export function idempotencyKeyHash(keyType: IdempotencyKeyType, key: IdempotencyKey): string {
  const str = generateIdempotencyKey(keyType, key)
  return createHash('sha256').update(str, 'utf-8').digest('hex')
}

/**
 * 为 entity 写入生成 artifact 幂等键。
 * 用于 saveStageOutput / saveEntityArtifact 等操作。
 */
export function artifactIdempotencyKey(
  compilerRunId: number,
  stageId: string,
  entityId: string,
  contractVersion: number,
  manifestVersion: number,
  attemptNumber: number,
): string {
  return generateIdempotencyKey('entity_artifact', {
    compilerRunId,
    stageId,
    entityId,
    contractVersion,
    manifestVersion,
    attemptNumber,
  })
}

/**
 * 为 Ledger Entry 写入生成幂等键。
 */
export function ledgerIdempotencyKey(
  compilerRunId: number,
  stageId: string,
  entityId: string,
  contractVersion: number,
  manifestVersion: number,
  attemptNumber: number,
): string {
  return generateIdempotencyKey('ledger_write', {
    compilerRunId,
    stageId,
    entityId,
    contractVersion,
    manifestVersion,
    attemptNumber,
  })
}

/**
 * 为 Contract 写入生成幂等键（不关联 entityId）。
 */
export function contractIdempotencyKey(
  compilerRunId: number,
  stageId: string,
  contractVersion: number,
  manifestVersion: number,
): string {
  return generateIdempotencyKey('contract_write', {
    compilerRunId,
    stageId,
    contractVersion,
    manifestVersion,
    attemptNumber: 1,
  })
}

/**
 * 为 Manifest 写入生成幂等键（不关联 entityId）。
 */
export function manifestIdempotencyKey(
  compilerRunId: number,
  stageId: string,
  contractVersion: number,
  manifestVersion: number,
): string {
  return generateIdempotencyKey('manifest_write', {
    compilerRunId,
    stageId,
    contractVersion,
    manifestVersion,
    attemptNumber: 1,
  })
}
