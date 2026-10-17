import { describe, expect, expectTypeOf, test } from 'vitest'
import type {
  AgentAssignment,
  AgentAssignmentInput,
  AgentAssignmentOverdueResult,
  AgentAssignmentStatus,
  AssigneeType,
} from './copilot-agent-assignee.js'
import {
  AGENT_ASSIGNMENT_ALLOWED_TRANSITIONS,
  AGENT_ASSIGNMENT_STATUSES,
  ASSIGNEE_TYPES,
  assertNoSensitiveData,
  isAgentAssignmentStatus,
  makeAgentAssignment,
  makeAgentAssignmentCompleted,
  makeAgentAssignmentNoDueTime,
  makeAgentAssignmentOverdue,
  makeAgentAssignmentUnauthorized,
  requiresDueTime,
  validateAssigneeType,
  isValidAgentAssignmentTransition,
} from './copilot-agent-assignee.js'

// ---------------------------------------------------------------------------
// validateAssigneeType
// ---------------------------------------------------------------------------

describe('validateAssigneeType', () => {
  test('accepts "user"', () => {
    expect(validateAssigneeType('user')).toBe(true)
    expectTypeOf<ReturnType<typeof validateAssigneeType>>().toEqualTypeOf<boolean>()
  })

  test('accepts "agent"', () => {
    expect(validateAssigneeType('agent')).toBe(true)
  })

  test('rejects "admin"', () => {
    expect(validateAssigneeType('admin')).toBe(false)
  })

  test('rejects empty string', () => {
    expect(validateAssigneeType('')).toBe(false)
  })

  test('rejects "User" (case-sensitive)', () => {
    expect(validateAssigneeType('User')).toBe(false)
  })

  test('ASSIGNEE_TYPES constant has exactly 2 members', () => {
    expect(ASSIGNEE_TYPES).toEqual(['user', 'agent'])
    expect(ASSIGNEE_TYPES).toHaveLength(2)
  })
})

// ---------------------------------------------------------------------------
// requiresDueTime
// ---------------------------------------------------------------------------

describe('requiresDueTime', () => {
  test('agent requires due time', () => {
    expect(requiresDueTime('agent')).toBe(true)
  })

  test('user does not require due time', () => {
    expect(requiresDueTime('user')).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// isAgentAssignmentStatus
// ---------------------------------------------------------------------------

describe('isAgentAssignmentStatus', () => {
  test.each(AGENT_ASSIGNMENT_STATUSES)('accepts "%s"', (status) => {
    expect(isAgentAssignmentStatus(status)).toBe(true)
  })

  test('rejects unknown status', () => {
    expect(isAgentAssignmentStatus('cancelled')).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// isValidAgentAssignmentTransition
// ---------------------------------------------------------------------------

describe('isValidAgentAssignmentTransition', () => {
  test('pending → completed is valid', () => {
    expect(isValidAgentAssignmentTransition('pending', 'completed')).toBe(true)
  })

  test('pending → overdue is valid', () => {
    expect(isValidAgentAssignmentTransition('pending', 'overdue')).toBe(true)
  })

  test('pending → failed is valid', () => {
    expect(isValidAgentAssignmentTransition('pending', 'failed')).toBe(true)
  })

  test('completed → pending is invalid (terminal)', () => {
    expect(isValidAgentAssignmentTransition('completed', 'pending')).toBe(false)
  })

  test('overdue → pending is invalid (terminal)', () => {
    expect(isValidAgentAssignmentTransition('overdue', 'pending')).toBe(false)
  })

  test('failed → pending is invalid (terminal)', () => {
    expect(isValidAgentAssignmentTransition('failed', 'pending')).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// assertNoSensitiveData
// ---------------------------------------------------------------------------

describe('assertNoSensitiveData', () => {
  test('passes on clean record', () => {
    expect(() => assertNoSensitiveData({ taskId: 1, assigneeType: 'agent' })).not.toThrow()
  })

  test('throws on "prompt" key', () => {
    expect(() => assertNoSensitiveData({ taskId: 1, prompt: 'write a poem' })).toThrow(
      /sensitive keys: prompt/,
    )
  })

  test('throws on "modelOutput" key', () => {
    expect(() => assertNoSensitiveData({ taskId: 1, modelOutput: '...' })).toThrow(
      /sensitive keys: modelOutput/,
    )
  })

  test('throws on "token" key', () => {
    expect(() => assertNoSensitiveData({ taskId: 1, token: 'sk-xxx' })).toThrow(
      /sensitive keys: token/,
    )
  })

  test('throws on "secret" key', () => {
    expect(() => assertNoSensitiveData({ taskId: 1, secret: 'abc' })).toThrow(
      /sensitive keys: secret/,
    )
  })

  test('throws on "apiKey" key', () => {
    expect(() => assertNoSensitiveData({ taskId: 1, apiKey: 'key-123' })).toThrow(
      /sensitive keys: apiKey/,
    )
  })

  test('throws on "model_output" key (snake_case)', () => {
    expect(() => assertNoSensitiveData({ taskId: 1, model_output: '...' })).toThrow(
      /sensitive keys: model_output/,
    )
  })

  test('detects multiple sensitive keys at once', () => {
    expect(() => assertNoSensitiveData({ prompt: 'x', token: 'y', safe: 1 })).toThrow(
      /sensitive keys: prompt, token/,
    )
  })

  test('passes on empty record', () => {
    expect(() => assertNoSensitiveData({})).not.toThrow()
  })
})

// ---------------------------------------------------------------------------
// Fixtures —— 五种标准状态
// ---------------------------------------------------------------------------

describe('makeAgentAssignment (default / pending)', () => {
  test('returns a valid pending agent assignment', () => {
    const a = makeAgentAssignment()
    expect(a.assigneeType).toBe('agent')
    expect(a.status).toBe('pending')
    expect(a.dueTime).toBeTruthy()
    expect(a.taskId).toBe(100)
    expect(a.projectId).toBe(10)
    expect(a.organizationId).toBe(1)
    expectTypeOf(a).toEqualTypeOf<AgentAssignment>()
  })

  test('overrides are applied', () => {
    const a = makeAgentAssignment({ taskId: 200, status: 'completed' })
    expect(a.taskId).toBe(200)
    expect(a.status).toBe('completed')
  })
})

describe('makeAgentAssignmentNoDueTime', () => {
  test('returns an input with empty dueTime', () => {
    const input = makeAgentAssignmentNoDueTime()
    expect(input.assigneeType).toBe('agent')
    expect(input.dueTime).toBe('')
    expectTypeOf(input).toEqualTypeOf<AgentAssignmentInput>()
  })

  test('would be rejected by requiresDueTime check', () => {
    const input = makeAgentAssignmentNoDueTime()
    expect(requiresDueTime(input.assigneeType)).toBe(true)
    expect(input.dueTime).toBeFalsy()
  })
})

describe('makeAgentAssignmentCompleted', () => {
  test('returns completed agent assignment', () => {
    const a = makeAgentAssignmentCompleted()
    expect(a.status).toBe('completed')
    expect(a.assigneeType).toBe('agent')
    expectTypeOf(a).toEqualTypeOf<AgentAssignment>()
  })
})

describe('makeAgentAssignmentOverdue', () => {
  test('returns overdue agent assignment', () => {
    const a = makeAgentAssignmentOverdue()
    expect(a.status).toBe('overdue')
    expect(a.assigneeType).toBe('agent')
    expectTypeOf(a).toEqualTypeOf<AgentAssignment>()
  })
})

describe('makeAgentAssignmentUnauthorized', () => {
  test('returns assignment with mismatched org/project', () => {
    const a = makeAgentAssignmentUnauthorized()
    expect(a.assignedBy).toBe(999)
    expect(a.organizationId).toBe(99)
    expect(a.projectId).toBe(999)
    expectTypeOf(a).toEqualTypeOf<AgentAssignment>()
  })
})

// ---------------------------------------------------------------------------
// Type-level assertions
// ---------------------------------------------------------------------------

describe('Type contracts', () => {
  test('AssigneeType is a union of string literals', () => {
    expectTypeOf<AssigneeType>().toEqualTypeOf<'user' | 'agent'>()
  })

  test('AgentAssignmentStatus is a union of string literals', () => {
    expectTypeOf<AgentAssignmentStatus>().toEqualTypeOf<
      'pending' | 'completed' | 'overdue' | 'failed'
    >()
  })

  test('AgentAssignment has all required fields', () => {
    type A = AgentAssignment
    expectTypeOf<A['id']>().toEqualTypeOf<number>()
    expectTypeOf<A['taskId']>().toEqualTypeOf<number>()
    expectTypeOf<A['projectId']>().toEqualTypeOf<number>()
    expectTypeOf<A['organizationId']>().toEqualTypeOf<number>()
    expectTypeOf<A['assigneeType']>().toEqualTypeOf<AssigneeType>()
    expectTypeOf<A['assigneeId']>().toEqualTypeOf<number | null>()
    expectTypeOf<A['assignedBy']>().toEqualTypeOf<number>()
    expectTypeOf<A['dueTime']>().toEqualTypeOf<string>()
    expectTypeOf<A['status']>().toEqualTypeOf<AgentAssignmentStatus>()
    expectTypeOf<A['createdAt']>().toEqualTypeOf<string>()
    expectTypeOf<A['updatedAt']>().toEqualTypeOf<string>()
  })

  test('AgentAssignmentOverdueResult has correct shape', () => {
    type O = AgentAssignmentOverdueResult
    expectTypeOf<O['taskId']>().toEqualTypeOf<number>()
    expectTypeOf<O['assignmentId']>().toEqualTypeOf<number>()
    expectTypeOf<O['clearedAt']>().toEqualTypeOf<string>()
    expectTypeOf<O['notifiedUsers']>().toEqualTypeOf<number[]>()
  })
})

// ---------------------------------------------------------------------------
// Transition table completeness
// ---------------------------------------------------------------------------

describe('AGENT_ASSIGNMENT_ALLOWED_TRANSITIONS', () => {
  test('covers all statuses', () => {
    for (const status of AGENT_ASSIGNMENT_STATUSES) {
      expect(AGENT_ASSIGNMENT_ALLOWED_TRANSITIONS).toHaveProperty(status)
    }
  })

  test('terminal states have empty transition arrays', () => {
    expect(AGENT_ASSIGNMENT_ALLOWED_TRANSITIONS.completed).toEqual([])
    expect(AGENT_ASSIGNMENT_ALLOWED_TRANSITIONS.overdue).toEqual([])
    expect(AGENT_ASSIGNMENT_ALLOWED_TRANSITIONS.failed).toEqual([])
  })

  test('pending can reach all non-pending statuses', () => {
    const pendingTransitions = AGENT_ASSIGNMENT_ALLOWED_TRANSITIONS.pending
    expect(pendingTransitions).toContain('completed')
    expect(pendingTransitions).toContain('overdue')
    expect(pendingTransitions).toContain('failed')
    expect(pendingTransitions).toHaveLength(3)
  })
})
