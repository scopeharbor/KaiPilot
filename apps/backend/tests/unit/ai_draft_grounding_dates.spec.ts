import { describe, expect, it } from 'vitest'
import type { ProjectDraft, ProjectDraftGroundingManifest } from '@aiproj/types'
import { validateSemanticGrounding } from '#services/ai_draft/semantic_grounding_gate'

const FACT =
  '某城商行计划于 2026 年 10 月 12 日启动「支付清算中台」微服务化重构项目,周期约 6 个月,目标 2027 年 4 月中旬完成生产切换'

function manifest(value: string): ProjectDraftGroundingManifest {
  return {
    version: '1.0',
    projectType: 'software',
    hash: 'h',
    truncated: false,
    facts: [
      {
        id: 'in_scope:1',
        category: 'in_scope',
        normalizedValue: value,
        source: 'confirmed',
        required: true,
        hash: 'a',
      },
    ],
  } as unknown as ProjectDraftGroundingManifest
}

function draftWith(texts: string[]): ProjectDraft {
  return { charter: { scope: { value: texts.join('。') } } } as unknown as ProjectDraft
}

describe('已确认事实覆盖 · 中文日期与 ISO 日期等价', () => {
  it('草案用 ISO 日期（2026-10-12 / 2027-04-20）即视为覆盖「2026 年 10 月 12 日」「2027 年 4 月中旬」', () => {
    const draft = draftWith([
      '支付清算中台微服务化重构项目，城商行计划 2026-10-12 启动，周期约 6 个月',
      '2027-04-20 完成生产切换',
    ])
    expect(validateSemanticGrounding(draft, manifest(FACT)).missingFactIds).toEqual([])
  })

  it('日期不一致仍判遗漏（不能因等价放宽而放过错误日期）', () => {
    const draft = draftWith([
      '支付清算中台微服务化重构项目，城商行计划 2026-11-12 启动，周期约 6 个月',
      '2027-04-20 完成生产切换',
    ])
    expect(validateSemanticGrounding(draft, manifest(FACT)).missingFactIds).toEqual(['in_scope:1'])
  })
})
