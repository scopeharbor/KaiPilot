/**
 * v3-ai-tools-orchestration-layer —— RL-12 审计留痕与脱敏单元测试（tasks W1 1.8）。
 *
 * 覆盖：入参 SHA-256 稳定性（键序无关、同一入参同一哈希）；审计事件→action 映射
 * （executed→ai_generate / confirmed→apply / denied→reject，复用既有 audit_logs CHECK 枚举，
 * 零新增迁移）；metadata 仅含 parametersHash/status/durationMs/errorCode，
 * 敏感 prompt 与入参明文绝不落库（RL-12）。
 * 注入 fake AuditService 捕获落库条目，零数据库。
 */
import { describe, expect, it } from 'vitest'
import { AuditEvent, EVENT_TO_ACTION } from '../../app/services/audit_service.js'
import AiToolsAuditHelper, {
  hashParameters,
  stableStringify,
} from '../../app/services/ai_tools/ai_tools_audit_helper.js'
import type { AuditEntry } from '../../app/services/audit_service.js'

function makeHelper(entries: AuditEntry[]): AiToolsAuditHelper {
  return new AiToolsAuditHelper({
    log: async (entry: AuditEntry) => {
      entries.push(entry)
    },
  } as never)
}

describe('hashParameters（RL-12 入参哈希）', () => {
  it('同一入参（含嵌套对象）产生稳定一致的 SHA-256 摘要', () => {
    const parameters = {
      projectId: 101,
      filters: { status: 'IN_PROGRESS', priority: 'high' },
      tags: ['a', 'b'],
    }
    const hashA = hashParameters(parameters)
    const hashB = hashParameters({ ...parameters })
    expect(hashA).toBe(hashB)
    expect(hashA).toMatch(/^[0-9a-f]{64}$/)
  })

  it('对象键序不影响哈希（规范化稳定序列化）', () => {
    const a = hashParameters({ projectId: 1, status: 'open', note: 'x' })
    const b = hashParameters({ note: 'x', status: 'open', projectId: 1 })
    expect(a).toBe(b)
  })

  it('入参不同则哈希不同；空/undefined 归一为 {} 的哈希', () => {
    expect(hashParameters({ projectId: 1 })).not.toBe(hashParameters({ projectId: 2 }))
    expect(hashParameters(undefined)).toBe(hashParameters({}))
    expect(hashParameters(null)).toBe(hashParameters({}))
  })

  it('stableStringify 本身确定且键序无关', () => {
    expect(stableStringify({ b: 1, a: 2 })).toBe(stableStringify({ a: 2, b: 1 }))
    expect(stableStringify([2, 1])).toBe('[2,1]')
  })
})

describe('AiToolsAuditHelper 事件映射与 metadata 结构', () => {
  it('executed → AI_TOOL_EXECUTED（action=ai_generate），metadata 只含哈希/状态/耗时/错误码', async () => {
    const entries: AuditEntry[] = []
    const helper = makeHelper(entries)
    const parameters = { projectId: 101, keyword: '支付联调' }
    await helper.log({
      kind: 'executed',
      userId: 7,
      organizationId: 1,
      projectId: 101,
      requestId: 'req-1',
      toolName: 'get_project_summary',
      parameters,
      status: 'SUCCESS',
      durationMs: 42,
    })
    expect(entries).toHaveLength(1)
    const entry = entries[0]!
    expect(entry.event).toBe(AuditEvent.AI_TOOL_EXECUTED)
    expect(EVENT_TO_ACTION[entry.event]).toBe('ai_generate')
    expect(entry.userId).toBe(7)
    expect(entry.organizationId).toBe(1)
    expect(entry.projectId).toBe(101)
    expect(entry.entityType).toBe('ai_tool')
    expect(entry.requestId).toBe('req-1')
    const metadata = entry.metadata as Record<string, unknown>
    expect(metadata['toolName']).toBe('get_project_summary')
    expect(metadata['parametersHash']).toBe(hashParameters(parameters))
    expect(metadata['status']).toBe('SUCCESS')
    expect(metadata['durationMs']).toBe(42)
    expect(metadata['errorCode']).toBeNull()
    expect(Object.keys(metadata).sort()).toEqual(
      ['durationMs', 'errorCode', 'parametersHash', 'status', 'toolName'].sort(),
    )
  })

  it('confirmed → AI_TOOL_CONFIRMED（action=apply）', async () => {
    const entries: AuditEntry[] = []
    const helper = makeHelper(entries)
    await helper.log({
      kind: 'confirmed',
      userId: 7,
      organizationId: 1,
      projectId: 101,
      toolName: 'update_task_schedule',
      parameters: { taskId: 9 },
      status: 'CONFIRMED',
      durationMs: 12,
    })
    expect(entries[0]!.event).toBe(AuditEvent.AI_TOOL_CONFIRMED)
    expect(EVENT_TO_ACTION[entries[0]!.event]).toBe('apply')
  })

  it('denied → AI_TOOL_DENIED（action=reject）', async () => {
    const entries: AuditEntry[] = []
    const helper = makeHelper(entries)
    await helper.log({
      kind: 'denied',
      userId: 7,
      organizationId: 1,
      toolName: 'get_project_summary',
      parameters: { projectId: 999 },
      status: 'REJECTED',
      durationMs: 3,
      errorCode: 'PERMISSION_DENIED',
    })
    expect(entries[0]!.event).toBe(AuditEvent.AI_TOOL_DENIED)
    expect(EVENT_TO_ACTION[entries[0]!.event]).toBe('reject')
  })

  it('RL-12：metadata 严禁出现 prompt 原文、入参明文与 AI 响应全文', async () => {
    const entries: AuditEntry[] = []
    const helper = makeHelper(entries)
    const secretPrompt = '帮我写一份关于支付系统重构的项目计划，包含里程碑与风险评估'
    const plaintextParameters = { projectId: 101, ask: secretPrompt, token: 'sk-abcdef-123456' }
    await helper.log({
      kind: 'executed',
      userId: 7,
      organizationId: 1,
      projectId: 101,
      toolName: 'get_project_summary',
      parameters: plaintextParameters,
      status: 'SUCCESS',
      durationMs: 10,
    })
    const serialized = JSON.stringify(entries[0]!.metadata)
    expect(serialized).not.toContain(secretPrompt)
    expect(serialized).not.toContain('sk-abcdef-123456')
    expect(serialized).not.toContain('支付系统重构')
    expect(serialized).toContain(hashParameters(plaintextParameters))
  })

  it('预演状态 PREVIEW_GENERATED 与 FAILED 状态可原样落库', async () => {
    const entries: AuditEntry[] = []
    const helper = makeHelper(entries)
    await helper.log({
      kind: 'executed',
      userId: 7,
      organizationId: 1,
      projectId: 101,
      toolName: 'update_task_schedule',
      parameters: { taskId: 9 },
      status: 'PREVIEW_GENERATED',
      durationMs: 5,
    })
    await helper.log({
      kind: 'executed',
      userId: 7,
      organizationId: 1,
      toolName: 'get_task_detail',
      parameters: { taskId: 9 },
      status: 'FAILED',
      durationMs: 1,
      errorCode: 'RESOURCE_NOT_FOUND',
    })
    expect((entries[0]!.metadata as Record<string, unknown>)['status']).toBe('PREVIEW_GENERATED')
    expect((entries[1]!.metadata as Record<string, unknown>)['status']).toBe('FAILED')
    expect((entries[1]!.metadata as Record<string, unknown>)['errorCode']).toBe(
      'RESOURCE_NOT_FOUND',
    )
  })
})

describe('AuditEvent 扩展（design D5，零新增迁移）', () => {
  it('三个 AI 工具事件均已登记且 action 落在既有 CHECK 枚举内', () => {
    const allowedActions = new Set([
      'create',
      'read',
      'update',
      'delete',
      'export',
      'import',
      'login',
      'logout',
      'approve',
      'reject',
      'ai_generate',
      'apply',
      'rollback',
    ])
    for (const event of [
      AuditEvent.AI_TOOL_EXECUTED,
      AuditEvent.AI_TOOL_CONFIRMED,
      AuditEvent.AI_TOOL_DENIED,
    ]) {
      expect(EVENT_TO_ACTION[event]).toBeDefined()
      expect(allowedActions.has(EVENT_TO_ACTION[event]!)).toBe(true)
    }
  })
})
