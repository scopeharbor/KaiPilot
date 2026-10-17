/**
 * Validation Module 骨架单元测试（tasks 2.5）。
 *
 * 覆盖：
 * - 模块可以无 persistence 运行
 * - ValidationInputContext 类型正确
 * - InMemoryEvidenceWriter 的基本读写
 * - Service 层不依赖 Controller/HTTP/request（编译验证）
 */

import { describe, expect, it } from 'vitest'
import { InMemoryEvidenceWriter } from '../../../app/services/compiler/validation/interfaces.js'
import type { ValidationInputContext } from '../../../app/services/compiler/validation/types.js'

// ── 任务 2.4：确认模块保持 Service 层边界 ──
// 本文件不 import 任何 Controller/HTTP/request 对象。
// ValidationInputContext 是纯数据接口，不依赖 request/response。

describe('ValidationInputContext', () => {
  it('可以创建最小上下文', () => {
    const ctx: ValidationInputContext = {
      stageId: 'blueprint_gate',
    }
    expect(ctx.stageId).toBe('blueprint_gate')
  })

  it('可以创建完整上下文', () => {
    const ctx: ValidationInputContext = {
      pdmSnapshotId: 'snap-001',
      pdmSnapshot: { tasks: [] },
      stageId: 'wbs_gate',
      stageName: 'WBS Gate',
      deterministicOutputs: {
        graphValidation: { passed: true },
        schedule: { scheduled: {} },
      },
      profileId: 'wbs_gate',
      organizationId: 'org-1',
      runId: 'run-001',
      isIncremental: true,
      changedPaths: ['/tasks/T1/description'],
      changedEntityIds: ['T1task_a'],
    }
    expect(ctx.organizationId).toBe('org-1')
    expect(ctx.isIncremental).toBe(true)
  })
})

describe('InMemoryEvidenceWriter', () => {
  it('可以写入和读取证据', async () => {
    const writer = new InMemoryEvidenceWriter()

    const entry = {
      evidenceId: 'ev-test-001',
      stageId: 'blueprint_gate',
      evidenceType: 'hard_validation_complete' as const,
      inputSignature: { profileId: 'blueprint_gate' },
      rulesetVersion: '1.0',
      registryVersion: '1.0',
      outputSummary: { passed: true },
      costSummary: { tokensUsed: 0, callsMade: 0, latencyMs: 0 },
      generatedAt: '2026-07-11T00:00:00.000Z',
    }

    const id = await writer.write(entry)
    expect(id).toBe('ev-test-001')

    const read = await writer.getById('ev-test-001')
    expect(read).not.toBeNull()
    expect(read!.evidenceType).toBe('hard_validation_complete')

    const byStage = await writer.getByStageId('blueprint_gate')
    expect(byStage).toHaveLength(1)
  })

  it('批量写入和查询', async () => {
    const writer = new InMemoryEvidenceWriter()

    const entries = [
      {
        evidenceId: 'ev-batch-1',
        stageId: 'wbs_gate',
        evidenceType: 'v_gate_decision' as const,
        inputSignature: {},
        rulesetVersion: '1.0',
        registryVersion: '1.0',
        outputSummary: { status: 'pass' },
        costSummary: { tokensUsed: 100, callsMade: 1, latencyMs: 500 },
        generatedAt: '2026-07-11T00:00:00.000Z',
      },
      {
        evidenceId: 'ev-batch-2',
        stageId: 'wbs_gate',
        evidenceType: 'soft_evaluation_complete' as const,
        inputSignature: {},
        rulesetVersion: '1.0',
        registryVersion: '1.0',
        outputSummary: { score: 4.5 },
        costSummary: { tokensUsed: 2000, callsMade: 3, latencyMs: 3000 },
        generatedAt: '2026-07-11T00:00:00.000Z',
      },
    ]

    const ids = await writer.writeBatch(entries)
    expect(ids).toHaveLength(2)

    const all = writer.getAll()
    expect(all).toHaveLength(2)

    const byStage = await writer.getByStageId('wbs_gate')
    expect(byStage).toHaveLength(2)
  })

  it('不存在的 evidenceId 返回 null', async () => {
    const writer = new InMemoryEvidenceWriter()
    const result = await writer.getById('non-existent')
    expect(result).toBeNull()
  })

  it('清空存储', async () => {
    const writer = new InMemoryEvidenceWriter()
    await writer.write({
      evidenceId: 'ev-clear-test',
      stageId: 'test',
      evidenceType: 'hard_validation_complete',
      inputSignature: {},
      rulesetVersion: '1.0',
      registryVersion: '1.0',
      outputSummary: {},
      costSummary: { tokensUsed: 0, callsMade: 0, latencyMs: 0 },
      generatedAt: '2026-07-11T00:00:00.000Z',
    })
    expect(writer.getAll()).toHaveLength(1)
    writer.clear()
    expect(writer.getAll()).toHaveLength(0)
  })
})
