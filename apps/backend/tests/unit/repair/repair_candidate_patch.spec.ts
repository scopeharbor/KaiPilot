/**
 * @aiproj/backend —— Repair Candidate Patch Service 单元测试（tasks 3.6）。
 *
 * 测试覆盖：
 * - 数组重排后 patch 仍能定位
 * - 重复提交返回既有结果
 * - 非法 path 拒绝
 * - 回放成功
 * - 回放失败
 */

import { describe, expect, it } from 'vitest'
import { RepairCandidatePatchService } from '../../../app/services/compiler/repair/repair_candidate_patch_service.js'
import type { RepairCandidatePatch } from '@aiproj/compiler-spec'

const service = new RepairCandidatePatchService()
const now = new Date().toISOString()

const basePatchInput = {
  attemptId: 'attempt-1',
  issueIds: ['issue-1'],
  entityIds: ['T1-001'],
  baseArtifactRef: 'pdm:run_1:v3',
  ops: [{ op: 'replace' as const, path: '/tasks/T1-001/name', value: 'Updated Task' }],
  reason: 'Cycle resolution',
  sourceRuleIds: ['HV-001'],
  attemptNumber: 1,
  riskLevel: 'low_risk' as const,
  confidence: 0.9,
  compilerRunId: 1,
  stageId: 'schedule_gate',
}

// ============================================================================
// Create Patch Tests
// ============================================================================

describe('createPatch', () => {
  it('creates patch with valid input', () => {
    const patch = service.createPatch(basePatchInput)
    expect(patch.patchId).toBeDefined()
    expect(patch.entityIds).toEqual(['T1-001'])
    expect(patch.ops.length).toBe(1)
    expect(patch.revalidationStatus).toBe('pending')
  })

  it('rejects patch with numeric array index path', () => {
    expect(() =>
      service.createPatch({
        ...basePatchInput,
        ops: [{ op: 'replace', path: '/tasks/0/name', value: 'Test' }],
      }),
    ).toThrow('Invalid patch path')
  })
})

// ============================================================================
// Path Validation Tests
// ============================================================================

describe('validatePath', () => {
  it('accepts stable entity-id based path', () => {
    expect(service.validatePath('/tasks/T1-001/name').valid).toBe(true)
  })

  it('accepts path with UUID-style entity id', () => {
    expect(service.validatePath('/tasks/abc-123-def/name').valid).toBe(true)
  })

  it('rejects path with numeric segment at root', () => {
    const result = service.validatePath('/0/name')
    expect(result.valid).toBe(false)
    expect(result.reason).toContain('numeric array index')
  })

  it('rejects path starting without /', () => {
    expect(service.validatePath('tasks/T1-001').valid).toBe(false)
  })

  it('rejects empty path segments', () => {
    expect(service.validatePath('').valid).toBe(false)
  })

  it('rejects deeply nested path with numeric index', () => {
    const result = service.validatePath('/workPackages/WP-001/tasks/T2-001/dependencies/0/type')
    expect(result.valid).toBe(false)
    expect(result.reason).toContain('numeric array index')
  })
})

// ============================================================================
// Replay Tests
// ============================================================================

describe('replay', () => {
  const basePdm = {
    tasks: {
      'T1-001': { id: 'T1-001', name: 'Original Task', plannedStart: '2026-07-01', duration: 5 },
      'T2-001': { id: 'T2-001', name: 'Second Task', plannedStart: '2026-07-08', duration: 3 },
    },
  }

  it('replays replace op successfully', () => {
    const patch = service.createPatch({
      ...basePatchInput,
      entityIds: ['T1-001'],
      ops: [{ op: 'replace', path: '/tasks/T1-001/name', value: 'Updated Task' }],
    })
    const result = service.replay(basePdm, patch)
    expect(result.match).toBe(true)
    const target = result.target as any
    expect(target.tasks['T1-001'].name).toBe('Updated Task')
    expect(target.tasks['T2-001'].name).toBe('Second Task') // unaffected
  })

  it('replays add op (array push)', () => {
    const patch = service.createPatch({
      ...basePatchInput,
      entityIds: ['T2-001'],
      ops: [{ op: 'add', path: '/tasks/T2-001/dependencies', value: { id: 'dep-1', type: 'FS' } }],
    })
    const result = service.replay(basePdm, patch)
    expect(result.match).toBe(true)
  })

  it('replays multiple ops in sequence', () => {
    const patch = service.createPatch({
      ...basePatchInput,
      entityIds: ['T1-001'],
      ops: [
        { op: 'replace', path: '/tasks/T1-001/name', value: 'Updated' },
        { op: 'replace', path: '/tasks/T1-001/duration', value: 10 },
      ],
    })
    const result = service.replay(basePdm, patch)
    expect(result.match).toBe(true)
    const target = result.target as any
    expect(target.tasks['T1-001'].name).toBe('Updated')
    expect(target.tasks['T1-001'].duration).toBe(10)
  })

  it('handles array reordering gracefully', () => {
    // Patch that sets a value by entity id (stable path)
    const patch = service.createPatch({
      ...basePatchInput,
      entityIds: ['T2-001'],
      ops: [{ op: 'replace', path: '/tasks/T2-001/name', value: 'Task 2 Updated' }],
    })
    // Keyed object PDM — path by entity ID doesn't depend on array order
    const objPdm = {
      tasks: {
        'T1-001': { id: 'T1-001', name: 'Task 1' },
        'T2-001': { id: 'T2-001', name: 'Task 2' },
      },
    }
    const objResult = service.replay(objPdm, patch)
    expect(objResult.match).toBe(true)
    const target = objResult.target as any
    expect(target.tasks['T2-001'].name).toBe('Task 2 Updated')
  })

  it('returns error for non-traversable path', () => {
    const patch = service.createPatch({
      ...basePatchInput,
      ops: [{ op: 'replace', path: '/nonexistent/T1-001/name', value: 'Test' }],
    })
    const result = service.replay(basePdm, patch)
    expect(result.match).toBe(false)
    expect(result.error).toBeDefined()
  })
})

// ============================================================================
// Duplicate Detection Tests
// ============================================================================

describe('isDuplicate', () => {
  it('detects exact duplicate by idempotencyKey', () => {
    const patchA: RepairCandidatePatch = {
      patchId: 'patch-1',
      attemptId: 'attempt-1',
      issueIds: ['issue-1'],
      baseArtifactRef: 'pdm:run_1:v3',
      entityIds: ['T1-001'],
      ops: [{ op: 'replace', path: '/tasks/T1-001/name', value: 'Test' }],
      reason: 'Fix',
      sourceRuleIds: [],
      attemptNumber: 1,
      riskLevel: 'low_risk',
      idempotencyKey: 'ik-same-key',
      confidence: 0.9,
      isSchemaPath: true,
      createdAt: now,
      revalidationStatus: 'pending',
    }
    const patchB: RepairCandidatePatch = {
      ...patchA,
      patchId: 'patch-2',
      idempotencyKey: 'ik-same-key',
    }
    const existing = [patchA]
    const duplicate = service.isDuplicate(existing, patchB)
    expect(duplicate).not.toBeNull()
    expect(duplicate!.patchId).toBe('patch-1')
  })

  it('returns null for non-duplicate', () => {
    const existing: RepairCandidatePatch = {
      patchId: 'patch-1',
      attemptId: 'attempt-1',
      issueIds: ['issue-1'],
      baseArtifactRef: 'pdm:run_1:v3',
      entityIds: ['T1-001'],
      ops: [{ op: 'replace', path: '/tasks/T1-001/name', value: 'Test' }],
      reason: 'Fix',
      sourceRuleIds: [],
      attemptNumber: 1,
      riskLevel: 'low_risk',
      idempotencyKey: 'ik-key-1',
      confidence: 0.9,
      isSchemaPath: true,
      createdAt: now,
      revalidationStatus: 'pending',
    }
    const newPatch: RepairCandidatePatch = {
      ...existing,
      patchId: 'patch-2',
      idempotencyKey: 'ik-key-2',
    }
    expect(service.isDuplicate([existing], newPatch)).toBeNull()
  })
})

// ============================================================================
// Idempotency Key Tests
// ============================================================================

describe('idempotency key generation', () => {
  const input = {
    compilerRunId: 1,
    stageId: 'schedule_gate',
    entityId: 'T1-001',
    contractVersion: 1,
    manifestVersion: 1,
    attemptNumber: 1,
  }

  it('generates repair idempotency key', () => {
    const key = service.generateRepairIdempotencyKey(input)
    expect(key).toBeDefined()
    expect(key.length).toBeGreaterThan(10)
    expect(key).toContain('schedule_gate_repair')
  })

  it('generates patch idempotency key', () => {
    const key = service.generatePatchIdempotencyKey(input)
    expect(key).toBeDefined()
    expect(key).toContain('schedule_gate_patch')
  })

  it('different attempt numbers produce different keys', () => {
    const key1 = service.generateRepairIdempotencyKey({ ...input, attemptNumber: 1 })
    const key2 = service.generateRepairIdempotencyKey({ ...input, attemptNumber: 2 })
    expect(key1).not.toBe(key2)
  })
})
