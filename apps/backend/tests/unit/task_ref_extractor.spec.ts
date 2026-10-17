/**
 * v2-5-code-repository-auto-linking —— task_ref_extractor 表驱动测试。
 *
 * 覆盖：大小写/分隔符、重复引用、无关数字、恶意/超长输入、多引用与规则版本稳定性。
 * 本文件为纯逻辑测试（无 AdonisJS 依赖），使用 vitest 运行。
 */

import { describe, it, expect } from 'vitest'
import {
  normalizeReference,
  extractFromBranchRef,
  extractFromCommitMessage,
  extractFromPullRequestTitle,
  extractFromPullRequestBody,
  extractFromEvent,
  EXTRACTOR_RULE_VERSION,
} from '../../app/services/candidates/task_ref_extractor.js'

// ---------------------------------------------------------------------------
// §1 normalizeReference
// ---------------------------------------------------------------------------

describe('normalizeReference', () => {
  const cases: Array<{ input: string; expected: string }> = [
    { input: 'PROJ-123', expected: 'PROJ-123' },
    { input: 'proj-123', expected: 'PROJ-123' },
    { input: 'Proj-42', expected: 'PROJ-42' },
    { input: 'FEATURE-1', expected: 'FEATURE-1' },
    { input: 'feature-1', expected: 'FEATURE-1' },
    { input: 'ABC-99999', expected: 'ABC-99999' },
    { input: 'XY-0', expected: 'XY-0' },
    { input: 'no-dash', expected: 'NO-DASH' },
  ]

  it.each(cases)('normalizeReference($input) → $expected', ({ input, expected }) => {
    expect(normalizeReference(input)).toBe(expected)
  })
})

// ---------------------------------------------------------------------------
// §2 extractFromBranchRef
// ---------------------------------------------------------------------------

describe('extractFromBranchRef', () => {
  const cases: Array<{ input: string; expected: string; sources: number }> = [
    { input: 'refs/heads/feat/PROJ-123-login', expected: 'PROJ-123', sources: 1 },
    { input: 'feature/PROJ-42-new-ui', expected: 'PROJ-42', sources: 1 },
    { input: 'PROJ-1-hotfix', expected: 'PROJ-1', sources: 1 },
    { input: 'refs/heads/main', expected: '', sources: 0 },
    { input: 'bugfix/ABC-789-fix-crash', expected: 'ABC-789', sources: 1 },
    { input: '', expected: '', sources: 0 },
  ]

  it.each(cases)('extractFromBranchRef($input) → $expected', ({ input, expected, sources }) => {
    const result = extractFromBranchRef(input)
    expect(result.normalizedReference).toBe(expected)
    expect(result.evidences).toHaveLength(sources)
    expect(result.uniqueReferenceCount).toBe(sources)
    if (sources > 0) {
      expect(result.evidences[0].sourceField).toBe('branchRef')
      expect(result.evidences[0].ruleVersion).toBe(EXTRACTOR_RULE_VERSION)
    }
  })
})

// ---------------------------------------------------------------------------
// §3 extractFromCommitMessage
// ---------------------------------------------------------------------------

describe('extractFromCommitMessage', () => {
  const cases: Array<{ input: string; expected: string; sources: number }> = [
    { input: 'fix: resolve PROJ-123 login timeout', expected: 'PROJ-123', sources: 1 },
    { input: 'PROJ-42 Add new feature', expected: 'PROJ-42', sources: 1 },
    { input: 'chore: update dependencies', expected: '', sources: 0 },
    { input: 'feat: implement proj-456 api', expected: 'PROJ-456', sources: 1 },
    { input: 'PROJ-0 initial commit', expected: 'PROJ-0', sources: 1 },
  ]

  it.each(cases)('extractFromCommitMessage($input) → $expected', ({ input, expected, sources }) => {
    const result = extractFromCommitMessage(input)
    expect(result.normalizedReference).toBe(expected)
    expect(result.evidences).toHaveLength(sources)
    expect(result.uniqueReferenceCount).toBe(sources)
  })
})

// ---------------------------------------------------------------------------
// §4 extractFromPullRequestTitle
// ---------------------------------------------------------------------------

describe('extractFromPullRequestTitle', () => {
  const cases: Array<{ input: string; expected: string; sources: number }> = [
    { input: 'Feat: implement PROJ-789 login', expected: 'PROJ-789', sources: 1 },
    { input: '[PROJ-42] Add API endpoint', expected: 'PROJ-42', sources: 1 },
    { input: 'chore: dependency update only', expected: '', sources: 0 },
    { input: 'PROJ-1 PROJ-2', expected: 'PROJ-1', sources: 2 },
  ]

  it.each(cases)(
    'extractFromPullRequestTitle($input) → $expected',
    ({ input, expected, sources }) => {
      const result = extractFromPullRequestTitle(input)
      expect(result.normalizedReference).toBe(expected)
      expect(result.evidences).toHaveLength(sources)
      expect(result.uniqueReferenceCount).toBe(sources)
    },
  )
})

// ---------------------------------------------------------------------------
// §5 extractFromPullRequestBody
// ---------------------------------------------------------------------------

describe('extractFromPullRequestBody', () => {
  const cases: Array<{ input: string; expected: string; sources: number }> = [
    { input: 'Closes PROJ-123', expected: 'PROJ-123', sources: 1 },
    { input: 'Related: PROJ-42, PROJ-56', expected: 'PROJ-42', sources: 2 },
    { input: 'Minor text changes', expected: '', sources: 0 },
    { input: '', expected: '', sources: 0 },
  ]

  it.each(cases)(
    'extractFromPullRequestBody($input) → $expected',
    ({ input, expected, sources }) => {
      const result = extractFromPullRequestBody(input)
      expect(result.normalizedReference).toBe(expected)
      expect(result.evidences).toHaveLength(sources)
      expect(result.uniqueReferenceCount).toBe(sources)
    },
  )
})

// ---------------------------------------------------------------------------
// §6 extractFromEvent —— 多字段合并
// ---------------------------------------------------------------------------

describe('extractFromEvent', () => {
  it('从分支和 commit 提取相同引用时去重', () => {
    const results = extractFromEvent({
      branchRef: 'feat/PROJ-123-login',
      commitMessage: 'fix: PROJ-123 timeout',
    })
    expect(results).toHaveLength(1)
    expect(results[0].normalizedReference).toBe('PROJ-123')
  })

  it('从多个字段提取不同的引用', () => {
    const results = extractFromEvent({
      branchRef: 'feat/PROJ-123-login',
      pullRequestTitle: 'Implement PROJ-456',
    })
    expect(results).toHaveLength(2)
    expect(results.map((r) => r.normalizedReference).sort()).toEqual(['PROJ-123', 'PROJ-456'])
  })

  it('没有匹配时返回空数组', () => {
    const results = extractFromEvent({
      branchRef: 'refs/heads/main',
      commitMessage: 'chore: update lockfile',
    })
    expect(results).toHaveLength(0)
  })

  it('全部为空时返回空数组', () => {
    const results = extractFromEvent({})
    expect(results).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// §7 大小写 / 分隔符
// ---------------------------------------------------------------------------

describe('大小写和分隔符', () => {
  it('小写 key 被规范化到大写', () => {
    const result = extractFromBranchRef('proj-123-feature')
    expect(result.normalizedReference).toBe('PROJ-123')
  })

  it('混合大小写被规范化', () => {
    const result = extractFromCommitMessage('FeAtUrE-42: add new thing')
    expect(result.normalizedReference).toBe('FEATURE-42')
  })

  it('数字后可加分隔符', () => {
    const result = extractFromPullRequestTitle('fix(ABC-789): resolve crash')
    expect(result.normalizedReference).toBe('ABC-789')
  })
})

// ---------------------------------------------------------------------------
// §8 无关数字
// ---------------------------------------------------------------------------

describe('无关数字', () => {
  it('纯数字不匹配', () => {
    const result = extractFromCommitMessage('Fix issue 12345')
    expect(result.normalizedReference).toBe('')
    expect(result.uniqueReferenceCount).toBe(0)
  })

  it('没有字母前缀的数字不匹配', () => {
    const result = extractFromPullRequestTitle('Update version to 2.0.0')
    expect(result.normalizedReference).toBe('')
  })
})

// ---------------------------------------------------------------------------
// §9 恶意 / 超长输入
// ---------------------------------------------------------------------------

describe('恶意/超长输入', () => {
  it('超长 commit message 仍能提取并截断证据', () => {
    // 使 reference 出现在 4000 字符以内（extractor 限制 4096），并在末尾填充超大内容
    const longMsg = 'a'.repeat(4000) + ' PROJ-123-fix ' + 'b'.repeat(5000)
    const result = extractFromCommitMessage(longMsg)
    expect(result.normalizedReference).toBe('PROJ-123')
    expect(result.evidences[0].matchedPreview.length).toBeLessThanOrEqual(120)
  })

  it('注入特殊字符不破坏提取', () => {
    const result = extractFromBranchRef("feature/PROJ-123'; DROP TABLE tasks;--")
    expect(result.normalizedReference).toBe('PROJ-123')
  })

  it('大量重复引用不会撑爆', () => {
    const text = 'PROJ-1 '.repeat(1000)
    const result = extractFromCommitMessage(text)
    expect(result.uniqueReferenceCount).toBe(1)
    expect(result.normalizedReference).toBe('PROJ-1')
  })
})

// ---------------------------------------------------------------------------
// §10 多引用与去重
// ---------------------------------------------------------------------------

describe('多引用与去重', () => {
  it('同一个字段中多个相同引用只保留一个', () => {
    const result = extractFromPullRequestBody('PROJ-123 fixed, PROJ-123 also mentioned')
    expect(result.uniqueReferenceCount).toBe(1)
    expect(result.normalizedReference).toBe('PROJ-123')
  })

  it('同一个字段中多个不同引用全保留', () => {
    const result = extractFromPullRequestBody('Closes PROJ-123, see also PROJ-456 and PROJ-789')
    expect(result.uniqueReferenceCount).toBe(3)
  })
})

// ---------------------------------------------------------------------------
// §11 规则版本稳定性
// ---------------------------------------------------------------------------

describe('规则版本稳定性', () => {
  it('所有提取结果都带正确的 ruleVersion', () => {
    const result = extractFromBranchRef('feature/PROJ-42')
    expect(result.evidences[0].ruleVersion).toBe(EXTRACTOR_RULE_VERSION)
  })

  it('EXTRACTOR_RULE_VERSION 为 1', () => {
    expect(EXTRACTOR_RULE_VERSION).toBe(1)
  })

  it('匹配位置正确', () => {
    const result = extractFromCommitMessage('fix: resolve PROJ-123 timeout')
    expect(result.evidences[0].matchStart).toBe(13)
    expect(result.evidences[0].matchEnd).toBe(21)
  })
})
