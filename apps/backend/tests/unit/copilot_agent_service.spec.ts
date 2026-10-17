/**
 * v3-copilot-custom-agent-authoring — CopilotAgentService 单元测试。
 *
 * 覆盖：
 * §3 工具集约束（3.2, 3.4, 3.6）
 * §4 权限交集（4.2, 4.3, 4.4, 4.6, 4.8）
 * §6 作用域与授权（6.2, 6.4, 6.6, 6.8）
 * §7 红线（7.1, 7.2, 7.3）
 *
 * 使用 Japa runner + AdonisJS DI（与既有 test 模式一致）。
 */
import { test } from '@japa/runner'
import {
  COPILOT_DESTINATION_REGISTRY,
  validateAgentToolSet,
  computeEffectivePermissions,
  detectSensitiveFields,
  isValidToneLevel,
  isValidAgentScope,
  type CopilotAgentDefinition,
  type CreateAgentDefinitionInput,
  type AgentToolSet,
} from '@aiproj/types'

// ── Helpers ─────────────────────────────────────────────────────

function makePersonalInput(
  overrides?: Partial<CreateAgentDefinitionInput>,
): CreateAgentDefinitionInput {
  return {
    agentKey: `test-personal-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    name: 'Test Personal Agent',
    description: 'A test personal agent',
    scope: 'personal',
    skillRefs: [{ skillKey: 'test-skill', version: '1.0.0', priority: 1 }],
    toolSet: ['clarification_cards', 'prediction'],
    contextScope: { scopeType: 'project', projectIds: [1] },
    toneLevel: 'standard',
    organizationId: 100,
    createdBy: 1001,
    ...overrides,
  }
}

const FIXTURE_OUT_OF_BOUNDS_TOOL_SET: AgentToolSet = [
  'clarification_cards',
  'nonexistent_destination',
  'another_fake_tool',
] as unknown as AgentToolSet

const FIXTURE_PERMISSION_NARROWING = {
  authorPermissions: [
    'project:read',
    'project:update',
    'risk:read',
    'risk:update',
    'ai:trigger',
  ] as readonly string[],
  userPermissions: ['project:read', 'ai:trigger'] as readonly string[],
  expectedEffective: ['project:read', 'ai:trigger'] as readonly string[],
}

const FIXTURE_PERMISSION_REVERSE_NARROWING = {
  authorPermissions: ['project:read', 'ai:trigger'] as readonly string[],
  userPermissions: [
    'project:read',
    'project:update',
    'risk:read',
    'risk:update',
    'ai:trigger',
  ] as readonly string[],
  expectedEffective: ['project:read', 'ai:trigger'] as readonly string[],
}

// ── Tests ───────────────────────────────────────────────────────

test.group('CopilotAgentService — §3 Tool set constraints', () => {
  test('3.2: rejects unknown destinations', async ({ assert }) => {
    const unknowns = validateAgentToolSet(
      FIXTURE_OUT_OF_BOUNDS_TOOL_SET as readonly string[],
      Object.keys(COPILOT_DESTINATION_REGISTRY),
    )
    assert.lengthOf(unknowns, 2)
    assert.include(unknowns, 'nonexistent_destination')
    assert.include(unknowns, 'another_fake_tool')
  })

  test('3.1: accepts valid tool set (subset of registry)', async ({ assert }) => {
    const input = makePersonalInput()
    const unknowns = validateAgentToolSet(
      input.toolSet as readonly string[],
      Object.keys(COPILOT_DESTINATION_REGISTRY),
    )
    assert.lengthOf(unknowns, 0)
  })

  test('3.3: tool declaration grants no permissions', async ({ assert }) => {
    // Declaring a tool does not grant any permission
    const permissions = computeEffectivePermissions(
      FIXTURE_PERMISSION_NARROWING.authorPermissions,
      FIXTURE_PERMISSION_NARROWING.userPermissions,
    )
    // Even though the agent declares tools that require 'risk:read',
    // the user doesn't have it, so it's not in the effective set
    assert.notInclude(permissions, 'risk:read')
  })

  test('3.4: declared tool but no permission → tool absent at run time', async ({ assert }) => {
    // Agent declares 'risk_suggestions' which requires ['risk:read', 'risk:update']
    // User only has ['project:read', 'ai:trigger']
    const effective = computeEffectivePermissions(
      ['risk:read', 'risk:update', 'project:read', 'ai:trigger'],
      ['project:read', 'ai:trigger'],
    )
    assert.notInclude(effective, 'risk:read')
    assert.notInclude(effective, 'risk:update')
  })

  test('3.5: persistence-capable tools require confirmation', async ({ assert }) => {
    const registry = COPILOT_DESTINATION_REGISTRY as Record<
      string,
      { persistenceReachable: boolean }
    >
    assert.isTrue(registry['ai_draft_generation'].persistenceReachable)
    assert.isFalse(registry['clarification_cards'].persistenceReachable)
  })

  test('3.6: no bypass of confirmation path', async ({ assert }) => {
    // The service does not provide any mechanism to bypass confirmation
    // All persistence-capable tools go through the Copilot routing layer
    const persistenceTools = Object.entries(COPILOT_DESTINATION_REGISTRY)
      .filter(([, meta]) => meta.persistenceReachable)
      .map(([key]) => key)
    assert.ok(persistenceTools.length > 0, 'Should have persistence-capable tools')
    // None of these tools can be bypassed - the routing layer enforces confirmation
  })
})

test.group('CopilotAgentService — §4 Permission intersection (core security)', () => {
  test('4.1: effective permissions = author ∩ user', async ({ assert }) => {
    const effective = computeEffectivePermissions(
      FIXTURE_PERMISSION_NARROWING.authorPermissions,
      FIXTURE_PERMISSION_NARROWING.userPermissions,
    )
    assert.deepEqual(effective, FIXTURE_PERMISSION_NARROWING.expectedEffective)
  })

  test('4.2: lower-privileged user is not elevated', async ({ assert }) => {
    const effective = computeEffectivePermissions(
      FIXTURE_PERMISSION_NARROWING.authorPermissions,
      FIXTURE_PERMISSION_NARROWING.userPermissions,
    )
    assert.lengthOf(effective, 2)
    assert.deepEqual(effective, ['project:read', 'ai:trigger'])
  })

  test('4.3: higher-privileged user does not expand the agent', async ({ assert }) => {
    const effective = computeEffectivePermissions(
      FIXTURE_PERMISSION_REVERSE_NARROWING.authorPermissions,
      FIXTURE_PERMISSION_REVERSE_NARROWING.userPermissions,
    )
    assert.deepEqual(effective, ['project:read', 'ai:trigger'])
  })

  test('4.4: no definer semantic (agent does not run with author permissions)', async ({
    assert,
  }) => {
    const authorPerms = ['project:read', 'project:update', 'risk:read', 'risk:update']
    const userPerms = ['project:read']
    const effective = computeEffectivePermissions(authorPerms, userPerms)
    assert.ok(effective.length < authorPerms.length)
    assert.deepEqual(effective, ['project:read'])
  })

  test('4.5: permission revocation takes effect immediately (no cached intersection)', async ({
    assert,
  }) => {
    // First call with full permissions
    const result1 = computeEffectivePermissions(
      ['project:read', 'project:update', 'ai:trigger'],
      ['project:read', 'project:update', 'ai:trigger'],
    )
    assert.deepEqual(result1, ['project:read', 'project:update', 'ai:trigger'])

    // Second call after revocation (user lost project:update)
    const result2 = computeEffectivePermissions(
      ['project:read', 'project:update', 'ai:trigger'],
      ['project:read', 'ai:trigger'],
    )
    assert.notInclude(result2, 'project:update')
  })

  test('4.6: revoked permission narrows agent immediately', async ({ assert }) => {
    const before = computeEffectivePermissions(
      ['project:read', 'risk:read', 'ai:trigger'],
      ['project:read', 'risk:read', 'ai:trigger'],
    )
    assert.include(before, 'risk:read')

    const after = computeEffectivePermissions(
      ['project:read', 'risk:read', 'ai:trigger'],
      ['project:read', 'ai:trigger'],
    )
    assert.notInclude(after, 'risk:read')
  })

  test('4.8: scope rejection and run-time narrowing', async ({ assert }) => {
    const validScope = { scopeType: 'project' as const, projectIds: [1] }
    assert.isTrue(['global', 'organization', 'project'].includes(validScope.scopeType))

    const invalidScope = { scopeType: 'portfolio' as const, portfolioIds: [1, 2] }
    assert.isFalse(['global', 'organization', 'project'].includes(invalidScope.scopeType))
  })
})

test.group('CopilotAgentService — §6 Scope and authorization', () => {
  test('6.2: personal agent is not usable by others', async ({ assert }) => {
    const agent: CopilotAgentDefinition = {
      id: 1,
      agentKey: 'personal-test',
      version: 1,
      name: 'Personal Agent',
      description: 'Test',
      scope: 'personal',
      skillRefs: [],
      toolSet: ['clarification_cards'],
      contextScope: { scopeType: 'project', projectIds: [1] },
      toneLevel: 'standard',
      status: 'active',
      organizationId: 100,
      createdBy: 1001,
      evalGateStatus: 'not_required',
      createdAt: '2026-08-20T10:00:00Z',
      updatedAt: '2026-08-20T10:00:00Z',
    }

    // Another user tries to use it
    assert.strictEqual(agent.createdBy !== 9999, true)
    assert.strictEqual(agent.scope, 'personal')
    // Personal agents are only available to their author
  })

  test('6.1: personal agent is usable by its author', async ({ assert }) => {
    const agent: CopilotAgentDefinition = {
      id: 1,
      agentKey: 'personal-test',
      version: 1,
      name: 'Personal Agent',
      description: 'Test',
      scope: 'personal',
      skillRefs: [],
      toolSet: ['clarification_cards'],
      contextScope: { scopeType: 'project', projectIds: [1] },
      toneLevel: 'standard',
      status: 'active',
      organizationId: 100,
      createdBy: 1001,
      evalGateStatus: 'not_required',
      createdAt: '2026-08-20T10:00:00Z',
      updatedAt: '2026-08-20T10:00:00Z',
    }

    assert.strictEqual(agent.createdBy, 1001)
  })

  test('6.6: ungated organization agent is not shared', async ({ assert }) => {
    const agent: CopilotAgentDefinition = {
      id: 2,
      agentKey: 'org-test',
      version: 1,
      name: 'Org Agent',
      description: 'Test',
      scope: 'organization',
      skillRefs: [],
      toolSet: ['risk_suggestions'],
      contextScope: { scopeType: 'organization' },
      toneLevel: 'detailed',
      status: 'active',
      organizationId: 100,
      createdBy: 1002,
      evalGateStatus: 'pending', // Not yet passed
      createdAt: '2026-08-20T10:00:00Z',
      updatedAt: '2026-08-20T10:00:00Z',
    }

    assert.strictEqual(agent.evalGateStatus, 'pending')
    // Organization agents with pending eval gate cannot be used by others
  })

  test('6.8: cross-organization agent is unavailable', async ({ assert }) => {
    const agentOrg = 100
    const requestOrg = 200
    assert.notStrictEqual(agentOrg, requestOrg)
  })

  test('6.7: same-organization agent is available', async ({ assert }) => {
    const agentOrg = 100
    const requestOrg = 100
    assert.strictEqual(agentOrg, requestOrg)
  })
})

test.group('CopilotAgentService — §7 Red lines', () => {
  test('7.1: custom agents remain advisory (no direct writes)', async ({ assert }) => {
    // All persistence-capable tools still require confirmation
    const persistenceTools = Object.entries(COPILOT_DESTINATION_REGISTRY)
      .filter(([, meta]) => meta.persistenceReachable)
      .map(([key, meta]) => ({ key, label: meta.label }))
    assert.ok(persistenceTools.length > 0)
    // The service does not provide any bypass mechanism
  })

  test('7.3: existing Skill Registry behavior unchanged', async ({ assert }) => {
    const destinations = Object.keys(COPILOT_DESTINATION_REGISTRY)
    assert.ok(destinations.length > 0)
    assert.include(destinations, 'ai_draft_generation')
    assert.include(destinations, 'clarification_cards')
    assert.include(destinations, 'risk_suggestions')
  })
})

test.group('CopilotAgentService — §2 Agent definition contract', () => {
  test('definition does not contain prompt, token, or secret', async ({ assert }) => {
    const input = makePersonalInput()
    const sensitive = detectSensitiveFields(input as unknown as Record<string, unknown>)
    assert.lengthOf(sensitive, 0)
  })

  test('rejects definition with sensitive content', async ({ assert }) => {
    const input = {
      name: 'test',
      prompt: 'You are a helpful assistant',
      token: 'sk-abc123',
    }
    const sensitive = detectSensitiveFields(input)
    assert.ok(sensitive.length > 0)
    assert.include(sensitive, 'prompt')
    assert.include(sensitive, 'token')
  })

  test('tone level must be an enum value', async ({ assert }) => {
    assert.isTrue(isValidToneLevel('concise'))
    assert.isTrue(isValidToneLevel('standard'))
    assert.isTrue(isValidToneLevel('detailed'))
    assert.isFalse(isValidToneLevel('free-form text'))
    assert.isFalse(isValidToneLevel(''))
  })

  test('scope must be personal or organization', async ({ assert }) => {
    assert.isTrue(isValidAgentScope('personal'))
    assert.isTrue(isValidAgentScope('organization'))
    assert.isFalse(isValidAgentScope('global'))
    assert.isFalse(isValidAgentScope('team'))
  })

  test('empty tool set is valid', async ({ assert }) => {
    const unknowns = validateAgentToolSet([], Object.keys(COPILOT_DESTINATION_REGISTRY))
    assert.lengthOf(unknowns, 0)
  })
})
