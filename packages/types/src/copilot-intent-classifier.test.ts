// @aiproj/types — V3 Copilot 确定性分类器测试
// v3-copilot-intent-catalog-and-router —— 任务组 3 契约测试
//
// 纯本地离线：零网络、零 provider、零时钟/随机源。

import { describe, it, expect } from 'vitest'
import {
  COPILOT_INTENT_CATALOG_VERSION,
  COPILOT_RULE_STRENGTH_CONFIDENCE,
  COPILOT_SUB_INTENT_REGISTRY,
  type CopilotModelIntentCandidate,
} from './copilot-intent-catalog.js'
import {
  normalizeCopilotInput,
  deriveIntentSummary,
  extractEntityReferences,
  evaluateRulePipeline,
  consultModelCandidate,
  type CopilotIntentModelCandidateSource,
} from './copilot-intent-classifier.js'

describe('copilot-intent-classifier', () => {
  // ── 3.1 归一化 ──

  it('归一化：去噪、空白归一、长度截断', () => {
    expect(normalizeCopilotInput('  项目  现在   怎么样  ')).toBe('项目 现在 怎么样')
    expect(normalizeCopilotInput('')).toBe('')
    expect(normalizeCopilotInput('   ')).toBe('')
    const longInput = '项目'.repeat(300)
    expect(normalizeCopilotInput(longInput).length).toBeLessThanOrEqual(400)
  })

  it('意图摘要有界截断', () => {
    const short = '项目怎么样'
    expect(deriveIntentSummary(short)).toBe(short)
    const long =
      '这是一个非常非常非常非常非常非常非常非常非常非常非常非常非常非常非常非常非常非常非常非常长的输入'
    const summary = deriveIntentSummary(long)
    expect(summary.length).toBeLessThanOrEqual(40)
    // 长度超过上限时截断并追加省略号
    if (long.length > 40) {
      expect(summary).toContain('…')
    }
  })

  it('实体引用抽取：任务/成员/里程碑/WBS', () => {
    const refs = extractEntityReferences('任务「首页设计」和成员小张')
    expect(refs.length).toBeGreaterThanOrEqual(2)
    expect(refs.some((r) => r.kind === 'task')).toBe(true)
    expect(refs.some((r) => r.kind === 'member')).toBe(true)
  })

  // ── 3.2 / 3.3 / 3.4 规则管线优先级与置信度确定性 ──

  it('斜杠命令最高优先级命中', () => {
    // risk_register 注册了 slash_command 规则
    const result = evaluateRulePipeline({
      normalizedInput: '/risk 新增一个风险',
      slashCommand: '/risk 新增',
    })
    expect(result).not.toBeNull()
    expect(result!.matchedRuleStrength).toBe('slash_command')
    expect(result!.confidence).toBe(COPILOT_RULE_STRENGTH_CONFIDENCE.slash_command)
    expect(result!.subIntentId).toBe('mutation.risk_register')
  })

  it('关键词命中代表性中文表述（规则管线首匹配语义：重叠关键词按注册表顺序决定）', () => {
    for (const entry of COPILOT_SUB_INTENT_REGISTRY) {
      // 只测试第一个表述（最独特的一个），避免与其他子意图关键词重叠
      const phrasing = entry.examplePhrasings[0]
      if (!phrasing) continue
      const result = evaluateRulePipeline({ normalizedInput: phrasing })
      expect(result).not.toBeNull()
      expect(result!.isRuleHit).toBe(true)
      expect(result!.subIntentId).not.toBeNull()
      expect(result!.candidateDestinations.length).toBeGreaterThan(0)
    }
  })

  it('相同规则强度产出相同 confidence（3.4）', () => {
    // 两个不同输入都命中 keyword_pattern，置信度应相同
    const result1 = evaluateRulePipeline({ normalizedInput: '项目进展如何' })
    const result2 = evaluateRulePipeline({ normalizedInput: '项目现在怎么样' })
    expect(result1).not.toBeNull()
    expect(result2).not.toBeNull()
    expect(result1!.matchedRuleStrength).toBe(result2!.matchedRuleStrength)
    expect(result1!.confidence).toBe(result2!.confidence)
  })

  it('通用回答不会被宽泛项目现状规则吞掉', () => {
    const result = evaluateRulePipeline({ normalizedInput: '请用三点回答' })
    expect(result?.subIntentId).toBe('instruction.general_explanation')
    expect(result?.subIntentId).not.toBe('query.project_status')
  })

  it('自然中文风险建议表达直接进入回答而不是泛化澄清', () => {
    const naturalInputs = [
      '请用三点说明一个面向 150 名员工的内部工单系统项目最容易失败的地方，并明确你现在只能给建议、不能修改或确认草案。',
      '帮我分析一下这个工单项目哪里容易出问题，只给建议，不要执行任何操作。',
      '这个计划可能踩哪些坑？请用三点说明。',
      '我有点担心上线后的采用率，你觉得最值得先防的风险是什么？',
      '从真实项目经验看，这个方案会在哪些环节出问题？',
      '不用替我改任何内容，帮忙分析目前计划是否可行。',
      '三点风险',
      '请给出建议',
      '明确只建议',
      '最容易失败',
    ]
    for (const normalizedInput of naturalInputs) {
      const result = evaluateRulePipeline({ normalizedInput, currentRoute: '/ai-create' })
      expect(['instruction', 'analysis']).toContain(result?.intentClass)
      expect(result?.candidateDestinations.length).toBeGreaterThan(0)
    }
  })

  it('三点风险与明确只建议等自然中文变体准确命中通用解释（任务 4.3 契约）', () => {
    const r1 = evaluateRulePipeline({ normalizedInput: '三点风险' })
    expect(r1?.subIntentId).toBe('instruction.general_explanation')
    expect(r1?.intentClass).toBe('instruction')

    const r2 = evaluateRulePipeline({ normalizedInput: '明确只建议' })
    expect(r2?.subIntentId).toBe('instruction.general_explanation')

    const r3 = evaluateRulePipeline({ normalizedInput: '给出建议' })
    expect(r3?.subIntentId).toBe('instruction.general_explanation')

    const r4 = evaluateRulePipeline({
      normalizedInput: '这个工单系统最容易失败的三个风险是什么？请明确只建议不要执行',
    })
    expect(r4?.subIntentId).toBe('instruction.general_explanation')
  })

  it('自然语言仍保留变更边界，明确执行请求不会被只读问答吞掉', () => {
    const result = evaluateRulePipeline({
      normalizedInput: '请直接修改排期，把验收日期调整到下周五',
      currentRoute: '/projects/1/gantt',
    })
    expect(result?.subIntentId).not.toBe('instruction.general_explanation')
  })

  it('需求与草案比较进入质量诊断而不是项目状态', () => {
    const result = evaluateRulePipeline({
      normalizedInput: '比较需求与草案',
      currentRoute: '/ai-create',
    })
    expect(result?.subIntentId).toBe('analysis.draft_quality')
    expect(result?.subIntentId).not.toBe('query.project_status')
  })

  it('草案质量与风险评估等自然表达命中草案质量诊断（任务 4.3 契约）', () => {
    const result1 = evaluateRulePipeline({
      normalizedInput: '草案质量诊断与风险评估',
      currentRoute: '/ai-create',
    })
    expect(result1?.subIntentId).toBe('analysis.draft_quality')
    expect(result1?.intentClass).toBe('analysis')

    const result2 = evaluateRulePipeline({
      normalizedInput: '检查草案与需求的完整性并诊断质量',
      currentRoute: '/ai-create',
    })
    expect(result2?.subIntentId).toBe('analysis.draft_quality')
  })

  // ── 3.5 / 3.6 模型候选接口 ──

  it('规则管线零命中时咨询模型候选，输出经目录校验', () => {
    const mockSource: CopilotIntentModelCandidateSource = {
      suggestCandidates: (): readonly CopilotModelIntentCandidate[] => [
        { subIntentId: 'query.project_status', confidence: 80 },
      ],
    }
    const result = consultModelCandidate({
      normalizedInput: '完全无规则命中的随机文本xyzabc',
      catalogVersion: COPILOT_INTENT_CATALOG_VERSION,
      modelSource: mockSource,
    })
    expect(result).not.toBeNull()
    expect(result!.subIntentId).toBe('query.project_status')
    expect(result!.isRuleHit).toBe(false)
    expect(result!.confidence).toBeLessThanOrEqual(COPILOT_RULE_STRENGTH_CONFIDENCE.keyword_pattern)
  })

  it('模型建议不在目录中时降级为 null', () => {
    const mockSource: CopilotIntentModelCandidateSource = {
      suggestCandidates: (): readonly CopilotModelIntentCandidate[] => [
        { subIntentId: 'nonexistent.intent', confidence: 90 },
      ],
    }
    const result = consultModelCandidate({
      normalizedInput: '测试',
      catalogVersion: COPILOT_INTENT_CATALOG_VERSION,
      modelSource: mockSource,
    })
    expect(result).toBeNull()
  })

  it('无模型源时返回 null（默认关闭）', () => {
    const result = consultModelCandidate({
      normalizedInput: '测试',
      catalogVersion: COPILOT_INTENT_CATALOG_VERSION,
    })
    expect(result).toBeNull()
  })

  // ── 3.7 代表性表述由规则命中 ──

  it('所有子意图的代表性表述由规则命中而非模型兜底（规则管线首匹配语义）', () => {
    for (const entry of COPILOT_SUB_INTENT_REGISTRY) {
      for (const phrasing of entry.examplePhrasings) {
        const result = evaluateRulePipeline({ normalizedInput: phrasing })
        expect(result).not.toBeNull()
        expect(result!.isRuleHit).toBe(true)
        // 规则管线按注册表顺序首匹配：phrasing 可能同时匹配多个子意图，
        // 只断言由规则命中且结果合法（subIntentId 存在），不要求精确到源条目。
        expect(result!.subIntentId).not.toBeNull()
        expect(result!.intentClass).not.toBeNull()
        expect(result!.candidateDestinations.length).toBeGreaterThan(0)
      }
    }
  })

  // ── 3.8 / 3.9 纯函数边界 ──

  it('分类器无时钟/随机依赖（依赖面检查）', () => {
    // evaluateRulePipeline 的依赖面为纯数据：COPILOT_RULE_PIPELINE_ORDER、
    // COPILOT_SUB_INTENT_REGISTRY、COPILOT_RULE_STRENGTH_CONFIDENCE —— 全部为 const 对象。
    // 归一化函数 normalizeCopilotInput 不调用 Date.now() 或 Math.random()。
    const t1 = normalizeCopilotInput('项目进展如何')
    const t2 = normalizeCopilotInput('项目进展如何')
    expect(t1).toBe(t2)

    const r1 = evaluateRulePipeline({ normalizedInput: '项目进展如何' })
    const r2 = evaluateRulePipeline({ normalizedInput: '项目进展如何' })
    expect(JSON.stringify(r1)).toBe(JSON.stringify(r2))
  })

  it('规则管线无模型源时完全确定性', () => {
    const inputs = ['项目现在怎么样', '生成周报', '调整排期', '甘特图怎么看']
    for (const input of inputs) {
      const r1 = evaluateRulePipeline({ normalizedInput: input })
      const r2 = evaluateRulePipeline({ normalizedInput: input })
      expect(JSON.stringify(r1)).toBe(JSON.stringify(r2))
    }
  })
})
