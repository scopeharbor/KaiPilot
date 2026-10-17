/**
 * CopilotAction 审计测试（v3-copilot-action-and-preview-boundary 任务 7.4/7.5）。
 *
 * 源码级断言（vitest 直跑）：
 * - 7.1/7.2 每类动作边界事件均注册于 AuditEvent 且带动作分类；
 * - 7.3/7.4 审计字段集低敏：决策/阻断/越权 metadata 只含 actor 上下文、
 *   动作卡 id、决策、状态、幂等键、source hash 前缀——不含 prompt/模型输出/证据正文/原始载荷；
 * - 7.5 越权尝试落审计且不泄露隐藏实体标题与 ID。
 *
 * 纯本地：零网络、零数据库、零 provider。
 */
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const currentDir = dirname(fileURLToPath(import.meta.url))
const readSource = (rel: string) => readFileSync(resolve(currentDir, rel), 'utf-8')

const AUDIT_SERVICE = resolve(currentDir, '../../app/services/audit_service.ts')
const DECISION_SERVICE = resolve(
  currentDir,
  '../../app/services/copilot_action/copilot_action_decision_service.ts',
)

const COPILOT_AUDIT_EVENTS = [
  'COPILOT_ACTION_PRODUCED',
  'COPILOT_ACTION_PREVIEW_CREATED',
  'COPILOT_ACTION_CONFIRMED',
  'COPILOT_ACTION_REJECTED',
  'COPILOT_ACTION_MODIFIED',
  'COPILOT_ACTION_DECIDED',
  'COPILOT_ACTION_BULK_DECIDED',
  'COPILOT_ACTION_STALE_BLOCKED',
  'COPILOT_ACTION_DENIED',
  'COPILOT_ACTION_APPLY_PARTIAL_FAILED',
]

// 审计 metadata 禁止键（低敏字段集之外）
const FORBIDDEN_AUDIT_METADATA_KEYS = [
  'prompt',
  'modelOutput',
  'model_output',
  'evidence',
  'rawPayload',
  'raw_payload',
  'payload',
  'token',
  'secret',
  'authorization',
  'title',
  'entityId',
  'entity_title',
  'entity_id',
]

describe('7.1/7.2 动作边界事件注册与动作分类', () => {
  it('全部事件在 AuditEvent 枚举中注册', () => {
    const source = readSource(AUDIT_SERVICE)
    for (const event of COPILOT_AUDIT_EVENTS) {
      expect(source).toContain(`${event}: '${event}'`)
    }
  })

  it('全部事件在动作分类表中注册（create/read/update/reject/apply）', () => {
    const source = readSource(AUDIT_SERVICE)
    for (const event of COPILOT_AUDIT_EVENTS) {
      expect(source).toMatch(new RegExp(`${event}: '(create|read|update|reject|apply)'`))
    }
  })
})

describe('7.3/7.4 审计字段集低敏', () => {
  it('决策服务审计 metadata 不出现任何禁止键', () => {
    const source = readSource(DECISION_SERVICE)
    for (const key of FORBIDDEN_AUDIT_METADATA_KEYS) {
      // 只检查 metadata 构造段（audit.log 调用附近），不检查注释
      expect(source).not.toContain(`metadata: { ... { ${key}`)
      expect(source).not.toMatch(new RegExp(`metadata:\\s*\\{[^}]*${key}[^}]*\\}`))
    }
  })

  it('审计 metadata 含规定的低敏字段集：动作卡 id / 决策 / 状态 / 幂等键 / source hash 前缀', () => {
    const source = readSource(DECISION_SERVICE)
    expect(source).toContain('actionCardId')
    expect(source).toContain('decision')
    expect(source).toContain('status')
    expect(source).toContain('idempotencyKey')
    expect(source).toContain('sourceHashPrefixes')
    expect(source).toContain('contentHash.slice(0, 8)')
  })
})

describe('7.5 越权尝试落审计且不泄露隐藏实体', () => {
  it('denied/stale 阻断审计只含 reason 与动作卡 id，不含隐藏实体标题或 ID', () => {
    const source = readSource(DECISION_SERVICE)
    // denied 分支（permission_denied / organization_denied）metadata
    expect(source).toContain('reason: preflight.status')
    expect(source).toContain('idempotencyKey: params.idempotencyKey')
    // stale 阻断分支只记失配计数
    expect(source).toContain('mismatchedCount')
    // 不泄露：denied/stale 分支 metadata 不得携带目标实体 id/标题
    const deniedBlock = source.slice(
      source.indexOf('COPILOT_ACTION_DENIED'),
      source.indexOf('COPILOT_ACTION_STALE_BLOCKED'),
    )
    expect(deniedBlock).not.toContain('entityId')
    expect(deniedBlock).not.toContain('title')
    expect(deniedBlock).not.toContain('changeId')
  })
})
