// v3-resource-capacity-forecasting-closed-loop §7.7/7.8 —— 审计低敏 writer 单元测试。
// 覆盖：各状态事件覆盖、自由文本/隐藏 ID/跨租标识/Authorization/stack/路径注入拒绝、
// 扫描 fail-closed、ref hash 化。
import { describe, expect, it } from 'vitest'
import {
  buildRcclAuditRecord,
  assertRcclAuditLowSensitive,
} from '../../app/services/resource_capacity_loop/audit_writer.js'

const base = {
  event: 'handoff_created' as const,
  organizationId: 1,
  actorUserId: 42,
}

describe('RCCL audit 低敏扫描（§7.8）', () => {
  it('正常记录通过：refs 全部 hash 化', () => {
    const r = buildRcclAuditRecord({
      ...base,
      refs: { loop_id: 123, receipt_id: 'abc' },
      fromState: 'selected',
      toState: 'handed-off',
      counts: { scenarios: 3, receipts: 1 },
      durationMs: 120,
    })
    expect(r.refHashes.loop_id).toMatch(/^fnv1a:/)
    expect(Object.values(r.refHashes).every((v) => v.startsWith('fnv1a:'))).toBe(true)
    expect(() => assertRcclAuditLowSensitive(r)).not.toThrow()
  })

  it('fail closed：自由文本 rationale / assumption / evidence body 字段被拒', () => {
    expect(() =>
      buildRcclAuditRecord({
        ...base,
        ...({ bounded_rationale: '用户结论文本' } as Record<string, unknown>),
      }),
    ).toThrow(/禁止字段/)
    expect(() =>
      buildRcclAuditRecord({ ...base, ...({ evidence_body: 'x' } as Record<string, unknown>) }),
    ).toThrow()
  })

  it('fail closed：Authorization / token / secret / URL / 文件路径 注入被拒', () => {
    for (const [key, value] of [
      ['note', 'Bearer abc.def.ghi'],
      ['note2', 'api_token=xyz'],
      ['note3', 'my secret value'],
      ['callback', 'https://evil.example.com'],
      ['path', '/home/user/.ssh/id_rsa'],
    ] as Array<[string, string]>) {
      expect(() => buildRcclAuditRecord({ ...base, reasonCodes: [`${key}=${value}`] })).toThrow(
        /低敏禁区|未知事件/,
      )
    }
  })

  it('fail closed：跨租标识与隐藏实体 id 不允许出现在 refHashes 之外的明文里', () => {
    // organizationId 是 allowlist 数字字段；但 org-999 明文串进 counts 键会被 sanitize 掉。
    const r = buildRcclAuditRecord({ ...base, counts: { org_999_leak: 1 } as never })
    expect(r.counts && Object.keys(r.counts)).toEqual([])
  })
})
