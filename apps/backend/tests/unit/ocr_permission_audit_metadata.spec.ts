import { test } from '@japa/runner'
import { buildOcrPermissionAuditMetadataFromSnapshot } from '../../app/services/ai_ocr/ocr_permission_audit_logger.js'
import { buildDecisionSnapshotFixture } from '@aiproj/types'

/**
 * OCR 权限/审计低敏元数据测试（v3-ocr-permission-and-audit §3.7）。
 *
 * 证明审计元数据构建器只产出哈希 / 引用 / 枚举码 / 计数 / 摘要，
 * 绝不写入完整 OCR 文本、结构化值、搜索片段、provider 体、提示词、
 * 模型输出、密钥、授权头或绝对路径。
 */
const FORBIDDEN_TOKENS = [
  'authorization',
  'bearer ',
  'token',
  'secret',
  'api_key',
  'apikey',
  'password',
  'prompt',
  'provider_body',
  'model_output',
  'raw_text',
  'full_text',
  'snippet',
  'search_query',
  'content:',
  'value:',
  'C:\\\\',
  '/Users/',
  '/home/',
  '/var/',
]

function collectKeys(obj: unknown, prefix = ''): string[] {
  if (obj === null || typeof obj !== 'object') return []
  const keys: string[] = []
  for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
    const path = prefix ? `${prefix}.${k}` : k
    keys.push(path)
    keys.push(...collectKeys(v, path))
  }
  return keys
}

function collectValues(obj: unknown): string[] {
  if (obj === null || typeof obj !== 'object') return []
  const out: string[] = []
  for (const v of Object.values(obj as Record<string, unknown>)) {
    if (typeof v === 'string') out.push(v)
    else if (typeof v === 'object') out.push(...collectValues(v))
  }
  return out
}

test.group('OCR 权限/审计低敏元数据', () => {
  test('快照元数据仅含哈希/引用/枚举码/计数，无精确实体文本', ({ assert }) => {
    const snapshot = buildDecisionSnapshotFixture({
      action: 'review_confirm',
      result: 'allow',
      sourceHash: 'abc123',
      reasonCodes: ['confirmation_required'],
    })
    const meta = buildOcrPermissionAuditMetadataFromSnapshot({
      event: 'ocr.permission.review_confirm',
      snapshot,
      countSummaries: { accepted: 3, rejected: 1 },
      warningCodes: ['low_confidence'],
      providerSummary: { provider: 'mock', model: 'mock-model' },
    })

    // 必有低敏键
    assert.isDefined(meta.sourceHash)
    assert.isDefined(meta.decisionHash)
    assert.isDefined(meta.artifactRefId)
    assert.isDefined(meta.reasonCodes)
    assert.isDefined(meta.countSummaries)

    const keys = collectKeys(meta).map((k) => k.toLowerCase())
    const values = collectValues(meta).map((v) => v.toLowerCase())

    for (const forbidden of FORBIDDEN_TOKENS) {
      const hitKey = keys.find((k) => k.includes(forbidden))
      const hitVal = values.find((v) => v.includes(forbidden.toLowerCase()))
      assert.isUndefined(hitKey, `元数据键不应包含 ${forbidden}`)
      assert.isUndefined(hitVal, `元数据值不应包含 ${forbidden}`)
    }
  })

  test('status 快照元数据同样不泄露敏感字段', ({ assert }) => {
    const snapshot = buildDecisionSnapshotFixture({
      action: 'permission_status_read',
      result: 'allow',
      lifecycleState: 'active',
      retentionState: 'none',
      grantedSource: 'role',
    })
    const meta = buildOcrPermissionAuditMetadataFromSnapshot({
      event: 'ocr.permission.status_read',
      snapshot,
      countSummaries: {},
    })

    const keys = collectKeys(meta).map((k) => k.toLowerCase())
    const values = collectValues(meta).map((v) => v.toLowerCase())
    for (const forbidden of FORBIDDEN_TOKENS) {
      assert.isUndefined(
        keys.find((k) => k.includes(forbidden)),
        `键不应包含 ${forbidden}`,
      )
      assert.isUndefined(
        values.find((v) => v.includes(forbidden.toLowerCase())),
        `值不应包含 ${forbidden}`,
      )
    }
  })
})
