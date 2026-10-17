import { describe, expect, it } from 'vitest'
import type { GenerateOptions } from '#services/ai_m0/gateway'
import {
  BRIEF_THRESHOLD_CHARS,
  briefBudget,
  buildRequirementBrief,
  needsRequirementBrief,
  numberParagraphs,
  relevantBriefLines,
  requirementTextForPrompt,
} from '#services/ai_intent/requirement_brief_service'

describe('长需求整理', () => {
  it('8,000 字以内不整理，超过才整理；篇幅约原文 40%，6,000–20,000 字', () => {
    expect(needsRequirementBrief('字'.repeat(BRIEF_THRESHOLD_CHARS))).toBe(false)
    expect(needsRequirementBrief('字'.repeat(BRIEF_THRESHOLD_CHARS + 1))).toBe(true)
    expect(briefBudget(9_000)).toBe(6_000)
    expect(briefBudget(30_000)).toBe(12_000)
    expect(briefBudget(50_000)).toBe(20_000)
  })

  it('原文按段编号，整理稿用「〔段N〕」回指', () => {
    expect(numberParagraphs('第一段\n\n第二段\n第三段')).toBe(
      '〔段1〕第一段\n〔段2〕第二段\n〔段3〕第三段',
    )
  })

  it('每轮都调的环节读整理稿，没有整理稿读原文（最多 8,000 字）', () => {
    expect(requirementTextForPrompt('原文', '- 整理稿〔段1〕')).toBe('- 整理稿〔段1〕')
    expect(requirementTextForPrompt('原'.repeat(9_000), null)).toHaveLength(8_000)
  })

  it('拆解某项能力时只带相关条目', () => {
    const brief = [
      '## 范围与功能清单',
      '- 员工扫码报名，每场上限 200 人〔段3〕',
      '- 报名满员后停止报名〔段4〕',
      '- 年会抽奖分三轮，每人限中一次〔段7〕',
      '- 财务报销走现有 OA〔段9〕',
    ].join('\n')
    const lines = relevantBriefLines(brief, '活动报名 报名表单 报名名额控制')
    expect(lines).toContain('员工扫码报名')
    expect(lines).toContain('报名满员后停止报名')
    expect(lines).not.toContain('财务报销')
    expect(relevantBriefLines(null, '报名')).toBe('')
  })

  it('调用模型整理：带段号的原文、按篇幅设输出上限；过短的结果不采用', async () => {
    let seen: GenerateOptions | null = null
    const gateway = {
      async generate(options: GenerateOptions) {
        seen = options
        return {
          rawText: '```\n## 范围与功能清单\n' + '- 扫码报名〔段1〕\n'.repeat(40) + '```',
          triggeredErrors: [],
          outputTokens: 10,
          firstTokenMs: 1,
          totalMs: 1,
          usingRealAdapter: false,
        }
      },
    }
    const brief = await buildRequirementBrief({ rawInput: '扫码报名\n\n满员停止', gateway })
    expect(brief.startsWith('## 范围与功能清单')).toBe(true)
    expect(brief).not.toContain('```')
    expect(seen!.promptSet!.userPrompt).toContain('〔段2〕满员停止')

    const short = {
      async generate() {
        return {
          rawText: '- 太短',
          triggeredErrors: [],
          outputTokens: 1,
          firstTokenMs: 1,
          totalMs: 1,
          usingRealAdapter: false,
        }
      },
    }
    await expect(buildRequirementBrief({ rawInput: '扫码报名', gateway: short })).rejects.toThrow(
      /过短/,
    )
  })
})
