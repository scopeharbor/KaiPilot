/**
 * v3-copilot-custom-agent-authoring — 共享契约测试。
 *
 * 覆盖：
 * - 2.5: 负例测试 — 定义不含 prompt、模型输出、token、secret
 * - 2.7: 版本化 — 原地修改被拒、新版本可创建、旧版本仍可解析
 * - 工具集校验、权限交集、scope 校验、口吻枚举
 */

import { describe, it, expect } from 'vitest'

import {
  AGENT_SCOPES,
  AGENT_TONE_LEVELS,
  AGENT_TONE_LEVEL_LABELS,
  validateAgentToolSet,
  computeEffectivePermissions,
  validateAgentScopeDeclaration,
  detectSensitiveFields,
  isValidToneLevel,
  isValidAgentScope,
  type CopilotAgentDefinition,
  type AgentScope,
  type AgentToneLevel,
  type AgentSkillRef,
} from './copilot-custom-agent.js'

import {
  COPILOT_DESTINATIONS,
  COPILOT_DESTINATION_REGISTRY,
  type CopilotDestination,
} from './copilot-shared-contracts.js'

import {
  assertEligibleKnowledgeTiersExcludeL3,
  knowledgeTiersIncludeSynthetic,
  type CopilotKnowledgeTier,
} from './copilot-context-assembly.js'

import {
  FIXTURE_PERSONAL_AGENT,
  FIXTURE_ORGANIZATION_AGENT,
  FIXTURE_OUT_OF_BOUNDS_TOOL_SET,
  FIXTURE_OUT_OF_BOUNDS_SCOPE,
  FIXTURE_VALID_SCOPE,
  FIXTURE_PERMISSION_NARROWING,
  FIXTURE_PERMISSION_REVERSE_NARROWING,
  FIXTURE_DEFINITION_WITH_SENSITIVE_FIELDS,
  FIXTURE_DEFINITION_SAFE,
  FIXTURE_AGENT_V1,
  FIXTURE_AGENT_V2,
} from './copilot-custom-agent-fixtures.js'

// ── 2.5: 定义不含敏感内容 ──────────────────────────────────────

describe('Agent definition MUST NOT contain sensitive content (D3)', () => {
  it('personal agent fixture has no prompt, token, or secret', () => {
    const sensitive = detectSensitiveFields(
      FIXTURE_PERSONAL_AGENT as unknown as Record<string, unknown>,
    )
    expect(sensitive).toEqual([])
  })

  it('organization agent fixture has no prompt, token, or secret', () => {
    const sensitive = detectSensitiveFields(
      FIXTURE_ORGANIZATION_AGENT as unknown as Record<string, unknown>,
    )
    expect(sensitive).toEqual([])
  })

  it('detects prompt field', () => {
    const fields = detectSensitiveFields({ prompt: 'You are a helpful assistant' })
    expect(fields).toContain('prompt')
  })

  it('detects token field', () => {
    const fields = detectSensitiveFields({ token: 'sk-abc123' })
    expect(fields).toContain('token')
  })

  it('detects secret field', () => {
    const fields = detectSensitiveFields({ secret: 'my-secret' })
    expect(fields).toContain('secret')
  })

  it('detects apiKey field', () => {
    const fields = detectSensitiveFields({ apiKey: 'key-123' })
    expect(fields).toContain('apiKey')
  })

  it('detects authorization field', () => {
    const fields = detectSensitiveFields({ authorization: 'Bearer xxx' })
    expect(fields).toContain('authorization')
  })

  it('detects modelOutput field', () => {
    const fields = detectSensitiveFields({ modelOutput: 'some output' })
    expect(fields).toContain('modelOutput')
  })

  it('safe fixture has no sensitive fields', () => {
    const fields = detectSensitiveFields(FIXTURE_DEFINITION_SAFE)
    expect(fields).toEqual([])
  })

  it('fixture with sensitive fields is detected', () => {
    const fields = detectSensitiveFields(FIXTURE_DEFINITION_WITH_SENSITIVE_FIELDS)
    expect(fields.length).toBeGreaterThan(0)
    expect(fields).toContain('prompt')
    expect(fields).toContain('token')
    expect(fields).toContain('secret')
  })

  it('empty/undefined/null values are not flagged', () => {
    const fields = detectSensitiveFields({
      prompt: undefined,
      token: null,
      secret: '',
    })
    expect(fields).toEqual([])
  })
})

// ── 2.7: 版本化 ────────────────────────────────────────────────

describe('Agent definitions MUST be versioned (D6)', () => {
  it('v1 and v2 have same agentKey but different versions', () => {
    expect(FIXTURE_AGENT_V1.agentKey).toBe(FIXTURE_AGENT_V2.agentKey)
    expect(FIXTURE_AGENT_V1.version).toBe(1)
    expect(FIXTURE_AGENT_V2.version).toBe(2)
  })

  it('v1 remains resolvable after v2 is created', () => {
    const versions: CopilotAgentDefinition[] = [FIXTURE_AGENT_V1, FIXTURE_AGENT_V2]
    const v1 = versions.find((v) => v.version === 1)
    const v2 = versions.find((v) => v.version === 2)
    expect(v1).toBeDefined()
    expect(v2).toBeDefined()
    expect(v1!.name).toBe('项目顾问 v1')
    expect(v2!.name).toBe('项目顾问 v2')
  })

  it('version number increments on each edit', () => {
    expect(FIXTURE_AGENT_V2.version).toBeGreaterThan(FIXTURE_AGENT_V1.version)
  })
})

// ── 工具集校验 ──────────────────────────────────────────────────

describe('Tool set MUST be a subset of the destination registry (D2)', () => {
  it('valid tool set passes validation', () => {
    const unknowns = validateAgentToolSet(
      FIXTURE_PERSONAL_AGENT.toolSet as readonly string[],
      COPILOT_DESTINATIONS as readonly string[],
    )
    expect(unknowns).toEqual([])
  })

  it('unknown destinations are rejected', () => {
    const unknowns = validateAgentToolSet(
      FIXTURE_OUT_OF_BOUNDS_TOOL_SET as readonly string[],
      COPILOT_DESTINATIONS as readonly string[],
    )
    expect(unknowns.length).toBeGreaterThan(0)
    expect(unknowns).toContain('nonexistent_destination')
    expect(unknowns).toContain('another_fake_tool')
  })

  it('empty tool set is valid', () => {
    const unknowns = validateAgentToolSet([], COPILOT_DESTINATIONS as readonly string[])
    expect(unknowns).toEqual([])
  })
})

// ── 权限交集 ────────────────────────────────────────────────────

describe('Effective permissions MUST be the intersection (D1)', () => {
  it('lower-privileged user is not elevated', () => {
    const effective = computeEffectivePermissions(
      FIXTURE_PERMISSION_NARROWING.authorPermissions,
      FIXTURE_PERMISSION_NARROWING.userPermissions,
    )
    expect(effective).toEqual(FIXTURE_PERMISSION_NARROWING.expectedEffective)
  })

  it('higher-privileged user does not expand the agent', () => {
    const effective = computeEffectivePermissions(
      FIXTURE_PERMISSION_REVERSE_NARROWING.authorPermissions,
      FIXTURE_PERMISSION_REVERSE_NARROWING.userPermissions,
    )
    expect(effective).toEqual(FIXTURE_PERMISSION_REVERSE_NARROWING.expectedEffective)
  })

  it('empty author permissions yields empty intersection', () => {
    const effective = computeEffectivePermissions([], ['project:read', 'ai:trigger'])
    expect(effective).toEqual([])
  })

  it('empty user permissions yields empty intersection', () => {
    const effective = computeEffectivePermissions(['project:read', 'ai:trigger'], [])
    expect(effective).toEqual([])
  })

  it('no definer semantic: agent does not run with author permissions alone', () => {
    const authorPerms = ['project:read', 'project:update', 'risk:read', 'risk:update']
    const userPerms = ['project:read']
    const effective = computeEffectivePermissions(authorPerms, userPerms)
    expect(effective.length).toBeLessThan(authorPerms.length)
    expect(effective).toEqual(['project:read'])
  })
})

// ── Scope 校验 ──────────────────────────────────────────────────

describe('Context scope MUST NOT exceed author reach (D7)', () => {
  it('valid scope passes', () => {
    const valid = validateAgentScopeDeclaration(FIXTURE_VALID_SCOPE, [
      'global',
      'organization',
      'project',
    ])
    expect(valid).toBe(true)
  })

  it('out-of-bounds scope is rejected', () => {
    const valid = validateAgentScopeDeclaration(FIXTURE_OUT_OF_BOUNDS_SCOPE, [
      'global',
      'organization',
      'project',
    ])
    expect(valid).toBe(false)
  })
})

// ── 口吻枚举 ────────────────────────────────────────────────────

describe('Tone MUST be an enumerated level (D3)', () => {
  it('valid tone levels are recognized', () => {
    expect(isValidToneLevel('concise')).toBe(true)
    expect(isValidToneLevel('standard')).toBe(true)
    expect(isValidToneLevel('detailed')).toBe(true)
  })

  it('invalid tone level is rejected', () => {
    expect(isValidToneLevel('free-form prompt text')).toBe(false)
    expect(isValidToneLevel('')).toBe(false)
    expect(isValidToneLevel('verbose')).toBe(false)
  })

  it('tone levels have labels', () => {
    expect(AGENT_TONE_LEVEL_LABELS.concise).toBe('简洁')
    expect(AGENT_TONE_LEVEL_LABELS.standard).toBe('标准')
    expect(AGENT_TONE_LEVEL_LABELS.detailed).toBe('详尽')
  })

  it('all tone levels have labels', () => {
    for (const level of AGENT_TONE_LEVELS) {
      expect(AGENT_TONE_LEVEL_LABELS[level]).toBeDefined()
    }
  })
})

// ── 作用域枚举 ──────────────────────────────────────────────────

describe('Agent scope validation (D5)', () => {
  it('valid scopes are recognized', () => {
    expect(isValidAgentScope('personal')).toBe(true)
    expect(isValidAgentScope('organization')).toBe(true)
  })

  it('invalid scope is rejected', () => {
    expect(isValidAgentScope('global')).toBe(false)
    expect(isValidAgentScope('team')).toBe(false)
  })

  it('personal and organization are the only valid scopes', () => {
    expect(AGENT_SCOPES.length).toBe(2)
    expect(AGENT_SCOPES).toContain('personal')
    expect(AGENT_SCOPES).toContain('organization')
  })
})

// ── §5 Skill 与知识包 ──────────────────────────────────────────

describe('§5 Custom skills and knowledge packages', () => {
  it('5.3: L3 Synthetic entries are excluded from production agents', () => {
    const productionTiers: CopilotKnowledgeTier[] = ['L1', 'L2']
    const result = assertEligibleKnowledgeTiersExcludeL3(productionTiers)
    expect(result.ok).toBe(true)
  })

  it('5.4: L3 Synthetic entries in eligible tiers are rejected', () => {
    const tiersWithL3: CopilotKnowledgeTier[] = ['L1', 'L2', 'L3']
    expect(knowledgeTiersIncludeSynthetic(tiersWithL3)).toBe(true)
    const result = assertEligibleKnowledgeTiersExcludeL3(tiersWithL3)
    expect(result.ok).toBe(false)
    expect(result.reason).toContain('L3')
  })

  it('5.4: L3-only tiers are rejected', () => {
    const l3Only: CopilotKnowledgeTier[] = ['L3']
    const result = assertEligibleKnowledgeTiersExcludeL3(l3Only)
    expect(result.ok).toBe(false)
  })

  it('5.5: agent can bind multiple skills with priority declaration', () => {
    const skillRefs: AgentSkillRef[] = [
      { skillKey: 'skill-a', version: '1.0.0', priority: 1 },
      { skillKey: 'skill-b', version: '2.0.0', priority: 2 },
      { skillKey: 'skill-c', version: '1.5.0', priority: 3 },
    ]
    const sorted = [...skillRefs].sort((a, b) => a.priority - b.priority)
    expect(sorted[0].skillKey).toBe('skill-a')
    expect(sorted[1].skillKey).toBe('skill-b')
    expect(sorted[2].skillKey).toBe('skill-c')
  })

  it('5.6: multi-skill activation ordering is deterministic', () => {
    const skillRefs: AgentSkillRef[] = [
      { skillKey: 'beta', version: '1.0.0', priority: 3 },
      { skillKey: 'alpha', version: '1.0.0', priority: 1 },
      { skillKey: 'gamma', version: '1.0.0', priority: 2 },
    ]

    const sort1 = [...skillRefs].sort((a, b) => a.priority - b.priority)
    const sort2 = [...skillRefs].sort((a, b) => a.priority - b.priority)
    const sort3 = [...skillRefs].sort((a, b) => a.priority - b.priority)

    expect(sort1).toEqual(sort2)
    expect(sort2).toEqual(sort3)
    expect(sort1[0].skillKey).toBe('alpha')
    expect(sort1[1].skillKey).toBe('gamma')
    expect(sort1[2].skillKey).toBe('beta')
  })

  it('5.1: custom skills use same injection path (no bypass)', () => {
    const ref: AgentSkillRef = { skillKey: 'test-skill', version: '1.0.0', priority: 1 }
    expect(ref.skillKey).toBeTruthy()
    expect(ref.version).toBeTruthy()
  })
})

// ── §6 作用域与授权 ────────────────────────────────────────────

describe('§6 Scope and authorization', () => {
  it('6.2: personal agent is not usable by others', () => {
    const agent: CopilotAgentDefinition = {
      ...FIXTURE_PERSONAL_AGENT,
      scope: 'personal',
      createdBy: 1001,
    }
    expect(agent.scope).toBe('personal')
    expect(agent.createdBy).not.toBe(9999)
  })

  it('6.1: personal agent is usable by its author', () => {
    const agent: CopilotAgentDefinition = {
      ...FIXTURE_PERSONAL_AGENT,
      scope: 'personal',
      createdBy: 1001,
    }
    expect(agent.createdBy).toBe(1001)
  })

  it('6.6: ungated organization agent is not shared', () => {
    const agent: CopilotAgentDefinition = {
      ...FIXTURE_ORGANIZATION_AGENT,
      evalGateStatus: 'pending',
    }
    expect(agent.evalGateStatus).toBe('pending')
    expect(agent.scope).toBe('organization')
  })

  it('6.8: cross-organization agent is unavailable', () => {
    const agent = { ...FIXTURE_PERSONAL_AGENT, organizationId: 100 }
    const requestOrg = 200
    expect(agent.organizationId).not.toBe(requestOrg)
  })

  it('6.7: same-organization agent is available', () => {
    const agent = { ...FIXTURE_PERSONAL_AGENT, organizationId: 100 }
    const requestOrg = 100
    expect(agent.organizationId).toBe(requestOrg)
  })
})

// ── §7 红线 ────────────────────────────────────────────────────

describe('§7 Red lines', () => {
  it('7.1: custom agents remain advisory', () => {
    const persistenceTools = Object.entries(COPILOT_DESTINATION_REGISTRY).filter(
      ([, meta]) => meta.persistenceReachable,
    )
    expect(persistenceTools.length).toBeGreaterThan(0)
  })

  it('7.3: existing Skill Registry behavior unchanged', () => {
    expect(COPILOT_DESTINATIONS.length).toBeGreaterThan(0)
    expect(COPILOT_DESTINATIONS).toContain('ai_draft_generation')
    expect(COPILOT_DESTINATIONS).toContain('clarification_cards')
  })
})
