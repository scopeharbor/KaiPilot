/**
 * skill-compiler-integration.test.ts —— 纯函数测试套件。
 *
 * 覆盖：Skill 级/条目级过滤、L3 拒绝、fail-soft 跳过、四级降级、空集、确定性。
 */
import { describe, it, expect } from 'vitest'
import {
  projectSkillKnowledge,
  assertNoL3Synthetic,
  applyKnowledgeBudget,
  PDM_STAGE_INJECTION_MAP,
} from './skill-compiler-integration.js'
import type { ActivationDecision, ActivatedSkillEntry } from './skill-activation.js'
import type { Skill, KnowledgeBundle } from './compiler-skill.js'

// ── Fixtures ──────────────────────────────────────────────────────

function makeSkill(overrides: Partial<Skill> = {}): Skill {
  return {
    id: 1,
    organizationId: 1,
    skillKey: 'test-skill',
    name: 'Test Skill',
    version: '1.0.0',
    description: 'A test skill',
    status: 'active',
    category: { primary: 'domain' },
    tags: [],
    dependencies: [],
    activation: {
      stages: [],
      priority: 50,
    },
    knowledge: {
      rules: [
        {
          id: 'rule-1',
          title: 'Rule 1',
          content: 'This is rule 1 content',
          stage: 1,
          provenance: 'official',
          sourceRefs: [{ layer: 'L1', sourceId: 'iso-25010' }],
        },
        {
          id: 'rule-2',
          title: 'Rule 2',
          content: 'This is rule 2 content',
          stage: 2,
          provenance: 'official',
        },
      ],
      patterns: [
        {
          id: 'pattern-1',
          title: 'Pattern 1',
          content: 'This is pattern 1 content',
          stage: 1,
          provenance: 'official',
        },
      ],
      antiPatterns: [
        {
          id: 'anti-1',
          title: 'Anti Pattern 1',
          content: 'Do not do this',
          stage: 1,
          provenance: 'official',
        },
      ],
      examples: [
        {
          id: 'example-1',
          title: 'Example 1',
          content: 'Example content',
          stage: 1,
          provenance: 'official',
        },
      ],
      checklists: [
        {
          id: 'check-1',
          title: 'Check 1',
          content: 'Checklist item',
          stage: 1,
          provenance: 'official',
        },
      ],
      rubric: [
        {
          id: 'rubric-1',
          title: 'Rubric 1',
          content: 'Scoring criteria',
          stage: 1,
          provenance: 'official',
        },
      ],
    },
    basePriority: 50,
    createdBy: 1,
    updatedBy: 1,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  } as Skill
}

function makeActivatedSkillEntry(
  skill: Skill,
  mode: 'manual' | 'auto' | 'dependency' = 'auto',
): ActivatedSkillEntry {
  return {
    skill,
    activationMode: mode,
    reason: mode === 'manual' ? 'manual-selection' : 'project-match',
  }
}

function makeDecision(activated: ActivatedSkillEntry[]): ActivationDecision {
  return {
    activatedSkills: activated,
    advisoryCandidates: [],
    droppedConflicts: [],
    droppedDuplicates: [],
    evidence: [],
    evidenceDigest: 'sha256-test',
  }
}

// ── projectSkillKnowledge ─────────────────────────────────────────

describe('projectSkillKnowledge', () => {
  it('should filter skills by activation.stages containing stageId', () => {
    const skill = makeSkill()
    skill.activation.stages = ['intent_parsing', 'wbs_generation']
    const decision = makeDecision([makeActivatedSkillEntry(skill)])

    const result = projectSkillKnowledge(decision, 'intent_parsing')
    expect(result.projected.length).toBe(1)
    expect(result.projected[0]!.skillKey).toBe('test-skill')
  })

  it('should pass skills with empty/undefined activation.stages', () => {
    const skill = makeSkill()
    skill.activation.stages = []
    const decision = makeDecision([makeActivatedSkillEntry(skill)])

    const result = projectSkillKnowledge(decision, 'intent_parsing')
    expect(result.projected.length).toBe(1)
  })

  it('should skip skills whose activation.stages does not contain stageId', () => {
    const skill = makeSkill()
    skill.activation.stages = ['wbs_generation']
    const decision = makeDecision([makeActivatedSkillEntry(skill)])

    const result = projectSkillKnowledge(decision, 'intent_parsing')
    expect(result.projected.length).toBe(0)
  })

  it('should filter entries by injection point (stage number)', () => {
    const skill = makeSkill()
    skill.activation.stages = ['intent_parsing']
    const decision = makeDecision([makeActivatedSkillEntry(skill)])

    const result = projectSkillKnowledge(decision, 'intent_parsing')
    expect(result.projected.length).toBe(1)
    const entries = result.projected[0]!.entries
    const rule1 = entries.find((e) => e.id === 'rule-1')
    const rule2 = entries.find((e) => e.id === 'rule-2')
    expect(rule1).toBeTruthy()
    expect(rule2).toBeUndefined()
  })

  it('should pass entries without stage field', () => {
    const skill = makeSkill()
    skill.activation.stages = ['intent_parsing']
    ;(skill.knowledge.rules as unknown[]).push({
      id: 'rule-no-stage',
      title: 'No Stage Rule',
      content: 'No stage content',
      provenance: 'official',
    })
    const decision = makeDecision([makeActivatedSkillEntry(skill)])

    const result = projectSkillKnowledge(decision, 'intent_parsing')
    const entries = result.projected[0]!.entries
    const noStage = entries.find((e) => e.id === 'rule-no-stage')
    expect(noStage).toBeTruthy()
  })

  it('should skip entries missing id/title/content (fail-soft)', () => {
    const skill = makeSkill()
    skill.activation.stages = ['intent_parsing']
    ;(skill.knowledge.rules as unknown[]).push({
      title: 'Bad Entry',
      content: 'Bad content',
      provenance: 'official',
    })
    ;(skill.knowledge.rules as unknown[]).push({
      id: 'missing-title',
      content: 'Content',
      provenance: 'official',
    })
    const decision = makeDecision([makeActivatedSkillEntry(skill)])

    const result = projectSkillKnowledge(decision, 'intent_parsing')
    expect(result.warnings.length).toBeGreaterThanOrEqual(2)
    expect(result.projected[0]!.entries.length).toBeGreaterThan(0)
  })

  it('should return empty projected for empty activatedSkills', () => {
    const decision = makeDecision([])
    const result = projectSkillKnowledge(decision, 'intent_parsing')
    expect(result.projected.length).toBe(0)
    expect(result.warnings.length).toBe(0)
  })

  it('should collect knowledge from all six categories', () => {
    const skill = makeSkill()
    skill.activation.stages = ['intent_parsing']
    const decision = makeDecision([makeActivatedSkillEntry(skill)])

    const result = projectSkillKnowledge(decision, 'intent_parsing')
    const entries = result.projected[0]!.entries
    expect(entries.length).toBeGreaterThanOrEqual(6)
  })

  it('should not consume advisoryCandidates', () => {
    const skill = makeSkill()
    skill.activation.stages = ['intent_parsing']
    const decision: ActivationDecision = {
      activatedSkills: [],
      advisoryCandidates: [makeActivatedSkillEntry(skill)],
      droppedConflicts: [],
      droppedDuplicates: [],
      evidence: [],
      evidenceDigest: 'sha256-test',
    }

    const result = projectSkillKnowledge(decision, 'intent_parsing')
    expect(result.projected.length).toBe(0)
  })

  it('should be deterministic (same input → same output)', () => {
    const skill = makeSkill()
    skill.activation.stages = ['intent_parsing']
    const decision = makeDecision([makeActivatedSkillEntry(skill)])

    const r1 = projectSkillKnowledge(decision, 'intent_parsing')
    const r2 = projectSkillKnowledge(decision, 'intent_parsing')

    expect(r1).toEqual(r2)
  })

  it('should handle non-array knowledge categories gracefully', () => {
    const skill = makeSkill()
    skill.activation.stages = ['intent_parsing']
    skill.knowledge = {
      rules: 'not-an-array',
      patterns: [],
    } as unknown as KnowledgeBundle
    const decision = makeDecision([makeActivatedSkillEntry(skill)])

    const result = projectSkillKnowledge(decision, 'intent_parsing')
    expect(result.projected.length).toBe(0)
  })
})

// ── assertNoL3Synthetic ───────────────────────────────────────────

describe('assertNoL3Synthetic', () => {
  it('should pass entries without L3 sourceRefs', () => {
    const entries = [
      {
        id: 'e1',
        title: 'Entry 1',
        content: 'Content',
        provenance: 'official',
        sourceRefs: [{ layer: 'L1' as const, sourceId: 'iso-25010' }],
      },
      {
        id: 'e2',
        title: 'Entry 2',
        content: 'Content',
        provenance: 'official',
        sourceRefs: [{ layer: 'L2' as const, sourceId: 'org-template' }],
      },
    ]

    const result = assertNoL3Synthetic(entries)
    expect(result.allowed.length).toBe(2)
    expect(result.rejected.length).toBe(0)
    expect(result.warnings.length).toBe(0)
  })

  it('should reject entries with L3 sourceRefs', () => {
    const entries = [
      {
        id: 'e1',
        title: 'Entry 1',
        content: 'Content',
        provenance: 'official',
        sourceRefs: [{ layer: 'L1' as const, sourceId: 'iso-25010' }],
      },
      {
        id: 'e2',
        title: 'Entry 2',
        content: 'Content',
        provenance: 'synthetic',
        sourceRefs: [{ layer: 'L3' as const, sourceId: 'ai-synthesis' }],
      },
    ]

    const result = assertNoL3Synthetic(entries)
    expect(result.allowed.length).toBe(1)
    expect(result.rejected.length).toBe(1)
    expect(result.rejected[0]!.id).toBe('e2')
    expect(result.warnings.some((w) => w.includes('e2'))).toBe(true)
  })

  it('should pass entries without sourceRefs', () => {
    const entries = [
      {
        id: 'e1',
        title: 'Entry 1',
        content: 'Content',
        provenance: 'official',
      },
    ]

    const result = assertNoL3Synthetic(entries)
    expect(result.allowed.length).toBe(1)
    expect(result.rejected.length).toBe(0)
  })

  it('should handle empty array', () => {
    const result = assertNoL3Synthetic([])
    expect(result.allowed.length).toBe(0)
    expect(result.rejected.length).toBe(0)
  })

  it('should reject entry with any L3 sourceRef among multiple', () => {
    const entries = [
      {
        id: 'e1',
        title: 'Entry 1',
        content: 'Content',
        provenance: 'official',
        sourceRefs: [
          { layer: 'L1' as const, sourceId: 'iso-25010' },
          { layer: 'L3' as const, sourceId: 'ai-gen' },
        ],
      },
    ]

    const result = assertNoL3Synthetic(entries)
    expect(result.allowed.length).toBe(0)
    expect(result.rejected.length).toBe(1)
  })
})

// ── applyKnowledgeBudget ──────────────────────────────────────────

describe('applyKnowledgeBudget', () => {
  function makeEntry(
    id: string,
    contentLength = 200,
  ): {
    skillKey: string
    version: string
    entries: { id: string; title: string; content: string; provenance: string }[]
  } {
    return {
      skillKey: 'test-skill',
      version: '1.0.0',
      entries: [
        {
          id,
          title: `Entry ${id}`,
          content: 'x'.repeat(contentLength),
          provenance: 'official',
        },
      ],
    }
  }

  it('should return null section for empty input', () => {
    const result = applyKnowledgeBudget([], 1000)
    expect(result.section).toBeNull()
    expect(result.cutLevel).toBe('cut')
    expect(result.cutReason).toBe('empty_input')
    expect(result.includedCount).toBe(0)
  })

  it('should return null section for zero budget', () => {
    const projected = [makeEntry('e1')]
    const result = applyKnowledgeBudget(projected, 0)
    expect(result.section).toBeNull()
    expect(result.cutLevel).toBe('cut')
    expect(result.cutReason).toBe('no_budget')
  })

  it('should return full when budget is sufficient', () => {
    const projected = [makeEntry('e1', 50)]
    const result = applyKnowledgeBudget(projected, 10000)
    expect(result.cutLevel).toBe('full')
    expect(result.section).not.toBeNull()
    expect(result.section!.entries.length).toBe(1)
    expect(result.includedCount).toBe(1)
  })

  it('should return compact when budget is tight', () => {
    // Use very long content so full exceeds budget
    const longContent = 'x'.repeat(5000)
    const projected = [
      {
        skillKey: 'test-skill',
        version: '1.0.0',
        entries: [
          { id: 'e1', title: 'Entry e1', content: longContent, provenance: 'official' },
          { id: 'e2', title: 'Entry e2', content: longContent, provenance: 'official' },
        ],
      },
    ]
    const result = applyKnowledgeBudget(projected, 500)
    expect(result.cutLevel).toBe('compact')
    expect(result.section).not.toBeNull()
    for (const e of result.section!.entries) {
      expect(e.content).toBe('')
      expect(e.sourceRefs).toBeUndefined()
    }
  })

  it('should return ref-only when compact is too large', () => {
    // 1 skill with many entries: compact=8*14=112 > budget=80, ref=1*20=20 <= budget
    const projected = [
      {
        skillKey: 'skill-0',
        version: '1.0.0',
        entries: Array.from({ length: 8 }, (_, i) => ({
          id: `entry-${i}`,
          title: `Title for entry ${i}`,
          content: 'x'.repeat(5000),
          provenance: 'official',
        })),
      },
    ]
    const result = applyKnowledgeBudget(projected, 80)
    expect(result.cutLevel).toBe('ref-only')
    expect(result.section).not.toBeNull()
    expect(result.section!.entries.length).toBe(0)
    expect(result.section!.skillRefs.length).toBeGreaterThan(0)
  })

  it('should return cut when ref-only is too large', () => {
    const projected = Array.from({ length: 500 }, (_, i) => makeEntry(`e${i}`, 5000))
    const result = applyKnowledgeBudget(projected, 10)
    expect(result.cutLevel).toBe('cut')
    expect(result.section).toBeNull()
  })

  it('should deduplicate skillRefs', () => {
    const e1 = makeEntry('e1', 50)
    const e2 = makeEntry('e2', 50)
    e2.skillKey = 'test-skill'
    e2.version = '1.0.0'
    const result = applyKnowledgeBudget([e1, e2], 10000)
    expect(result.section!.skillRefs.length).toBe(1)
  })

  it('should handle projected with no entries', () => {
    const projected = [{ skillKey: 'test', version: '1.0.0', entries: [] }]
    const result = applyKnowledgeBudget(projected, 1000)
    expect(result.section).toBeNull()
    expect(result.cutReason).toBe('no_entries_after_filter')
  })

  it('should be deterministic', () => {
    const projected = [makeEntry('e1', 100), makeEntry('e2', 100)]
    const r1 = applyKnowledgeBudget(projected, 500)
    const r2 = applyKnowledgeBudget(projected, 500)
    expect(r1).toEqual(r2)
  })

  it('should include cutSkillRefs when fully cut', () => {
    const projected = Array.from({ length: 100 }, (_, i) => makeEntry(`e${i}`, 5000))
    const result = applyKnowledgeBudget(projected, 5)
    expect(result.cutLevel).toBe('cut')
  })
})

// ── PDM_STAGE_INJECTION_MAP ───────────────────────────────────────

describe('PDM_STAGE_INJECTION_MAP', () => {
  it('should have valid injection points (1-6)', () => {
    for (const [stageId, injectionPoint] of Object.entries(PDM_STAGE_INJECTION_MAP)) {
      expect(injectionPoint).toBeGreaterThanOrEqual(1)
      expect(injectionPoint).toBeLessThanOrEqual(6)
    }
  })

  it('should map known stage IDs', () => {
    expect(PDM_STAGE_INJECTION_MAP['intent_parsing']).toBe(1)
    expect(PDM_STAGE_INJECTION_MAP['wbs_generation']).toBe(2)
    expect(PDM_STAGE_INJECTION_MAP['task_generation']).toBe(4)
    expect(PDM_STAGE_INJECTION_MAP['quality_planning']).toBe(5)
    expect(PDM_STAGE_INJECTION_MAP['review_scoring']).toBe(6)
  })

  it('should have unique injection points per stage', () => {
    const stagesByInjectionPoint = new Map<number, string[]>()
    for (const [stageId, point] of Object.entries(PDM_STAGE_INJECTION_MAP)) {
      if (!stagesByInjectionPoint.has(point)) {
        stagesByInjectionPoint.set(point, [])
      }
      stagesByInjectionPoint.get(point)!.push(stageId)
    }
    for (let i = 1; i <= 6; i++) {
      expect(stagesByInjectionPoint.has(i)).toBe(true)
    }
  })
})
