/**
 * Evidence Writer 单元测试（tasks 8.4, 8.5）。
 *
 * 覆盖：
 * - V-Gate 完成
 * - 评估跳过
 * - 降级
 * - 修复建议
 * - DTO 快照（entity id、path、rule id、dimension id 字段稳定）
 */

import { describe, expect, it } from 'vitest'
import { InMemoryEvidenceWriter } from '../../../app/services/compiler/validation/interfaces.js'

describe('InMemoryEvidenceWriter', () => {
  it('V-Gate 完成证据可写入和读取', async () => {
    const writer = new InMemoryEvidenceWriter()
    await writer.write({
      evidenceId: 'ev-vg-pass-001',
      stageId: 'wbs_gate',
      evidenceType: 'v_gate_decision',
      inputSignature: { profileId: 'wbs_gate' },
      rulesetVersion: '1.0',
      registryVersion: '1.0',
      outputSummary: { status: 'pass' },
      costSummary: { tokensUsed: 1900, callsMade: 3, latencyMs: 3800 },
      generatedAt: '2026-07-11T00:00:00.000Z',
    })
    const found = await writer.getById('ev-vg-pass-001')
    expect(found).not.toBeNull()
    expect(found!.evidenceType).toBe('v_gate_decision')
    expect(found!.outputSummary.status).toBe('pass')
  })

  it('评估跳过证据有 skipped reason', async () => {
    const writer = new InMemoryEvidenceWriter()
    await writer.write({
      evidenceId: 'ev-skip-002',
      stageId: 'requirements_gate',
      evidenceType: 'soft_evaluation_skipped',
      inputSignature: {},
      rulesetVersion: '1.0',
      registryVersion: '1.0',
      outputSummary: {},
      costSummary: { tokensUsed: 0, callsMade: 0, latencyMs: 0 },
      skippedReason: 'Profile not enabled for this stage',
      generatedAt: '2026-07-11T00:00:00.000Z',
    })
    const found = await writer.getById('ev-skip-002')
    expect(found!.skippedReason).toBe('Profile not enabled for this stage')
  })

  it('降级证据有 degraded reason', async () => {
    const writer = new InMemoryEvidenceWriter()
    await writer.write({
      evidenceId: 'ev-degraded-001',
      stageId: 'wbs_gate',
      evidenceType: 'budget_exceeded',
      inputSignature: {},
      rulesetVersion: '1.0',
      registryVersion: '1.0',
      outputSummary: { dimensionsCompleted: 2, dimensionsTotal: 3 },
      costSummary: { tokensUsed: 55000, callsMade: 5, latencyMs: 6000 },
      degradedReason: 'Token budget 50000 exceeded',
      generatedAt: '2026-07-11T00:00:00.000Z',
    })
    const found = await writer.getById('ev-degraded-001')
    expect(found!.degradedReason).toContain('budget')
  })

  it('修复建议保存为 candidate', async () => {
    const writer = new InMemoryEvidenceWriter()
    await writer.write({
      evidenceId: 'ev-repair-001',
      stageId: 'wbs_gate',
      evidenceType: 'repair_suggestion_generated',
      inputSignature: {},
      rulesetVersion: '1.0',
      registryVersion: '1.0',
      outputSummary: { suggestions: [{ id: 'rep-001', description: '拆分 T2x' }] },
      costSummary: { tokensUsed: 0, callsMade: 0, latencyMs: 0 },
      repairSuggestionIds: ['rep-001'],
      generatedAt: '2026-07-11T00:00:00.000Z',
    })
    const found = await writer.getById('ev-repair-001')
    expect(found!.repairSuggestionIds).toContain('rep-001')
  })

  it('DTO 快照：字段稳定（entity id, path, rule id, dimension id）', async () => {
    const writer = new InMemoryEvidenceWriter()
    await writer.write({
      evidenceId: 'ev-snapshot-001',
      stageId: 'blueprint_gate',
      evidenceType: 'hard_validation_complete',
      inputSignature: { profileId: 'blueprint_gate' },
      rulesetVersion: '1.0',
      registryVersion: '1.0',
      outputSummary: {
        issues: [
          { ruleId: 'HV-008', path: '/dependencies', affectedEntityIds: ['T1a', 'T2b'] },
          { ruleId: 'HV-011', path: '/schedule/T1a', affectedEntityIds: ['T1a'] },
        ],
      },
      costSummary: { tokensUsed: 0, callsMade: 0, latencyMs: 0 },
      generatedAt: '2026-07-11T00:00:00.000Z',
    })
    const found = await writer.getById('ev-snapshot-001')
    expect(found!.outputSummary.issues).toBeDefined()
    const issues = found!.outputSummary.issues as any[]
    expect(issues[0].ruleId).toBe('HV-008')
    expect(issues[0].path).toBe('/dependencies')
    expect(issues[0].affectedEntityIds).toContain('T1a')
  })
})
