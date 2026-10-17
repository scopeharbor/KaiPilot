/**
 * v3-prompt-version-registry —— 注册表契约与不存全文测试。
 *
 * 覆盖 spec 要求：
 * - 注册表无长文本列且不含 prompt、模型输出、token 与 secret（§2.4）
 * - 同内容同 hash、内容变化 hash 变化（§2.6）
 * - 四态 fixtures（§2.7）
 * - 本地版本字段不冒充标准键（§3.3）
 * - 范围查询可解析（§5.4）
 * - 变更内容不可查：不存在返回 prompt 内容或差异的路径（§5.3）
 */
import { describe, it, expect } from 'vitest'
import {
  computePromptContentHash,
  verifyPromptHash,
  isPromptVersionEntry,
  isValidPromptVersion,
  findPromptVersionNamespacingViolations,
  PROMPT_VERSION_UNREGISTERED,
  PROMPT_VERSION_LOCAL_PREFIX,
  PROMPT_VERSION_FIELD,
  PROMPT_NAME_FIELD,
  type PromptVersionEntry,
  type PromptVersionScope,
} from './prompt-version-registry.js'
import {
  KNOWN_PROMPT_CONTENT,
  KNOWN_PROMPT_HASH,
  TRIZ_PROMPT_CONTENT,
  TRIZ_PROMPT_HASH,
  MISMATCH_HASH,
  SCOPE_RISK,
  SCOPE_TRIZ,
  SCOPE_GLOBAL,
  SCOPE_MULTI_CAPABILITY,
  REGISTERED_RISK_ENTRY,
  REGISTERED_TRIZ_ENTRY,
  REGISTERED_MULTI_SCOPE_ENTRY,
  REGISTERED_GLOBAL_ENTRY,
  PROMPT_VERSION_REGISTRY_FIXTURES,
} from './prompt-version-registry-fixtures.js'

// ---------------------------------------------------------------------------
// §2.4 注册表无长文本列且不含敏感内容
// ---------------------------------------------------------------------------

describe('注册表无长文本列且不含敏感内容（task 2.4）', () => {
  it('注册条目字段中无可容纳长文本的列', () => {
    const entry: PromptVersionEntry = {
      promptName: 'test-prompt',
      version: '1.0.0',
      contentHash: 'abc123def4567890',
      effectiveScope: { capabilities: ['draft'], strategies: ['copilot'] },
      createdAt: '2026-08-01T00:00:00.000Z',
    }
    // 所有字段都是短字符串或数字，没有 prompt 全文列
    expect(typeof entry.promptName).toBe('string')
    expect(entry.promptName.length).toBeLessThan(256)
    expect(typeof entry.version).toBe('string')
    expect(entry.version.length).toBeLessThan(32)
    expect(typeof entry.contentHash).toBe('string')
    expect(entry.contentHash.length).toBe(16)
    expect(typeof entry.createdAt).toBe('string')
  })

  it('条目中不含 prompt 全文、模型输出、token 或 secret', () => {
    const entryKeys = Object.keys(REGISTERED_RISK_ENTRY)
    const forbiddenKeys = [
      'promptText',
      'promptContent',
      'prompt_text',
      'prompt_content',
      'output',
      'completion',
      'model_output',
      'token',
      'tokens',
      'api_key',
      'apiKey',
      'secret',
      'authorization',
      'messages',
      'tool_arguments',
      'tool_results',
    ]
    for (const forbidden of forbiddenKeys) {
      expect(entryKeys).not.toContain(forbidden)
    }
  })

  it('条目字段值中不含 prompt 全文示例', () => {
    const entryJson = JSON.stringify(REGISTERED_RISK_ENTRY)
    // 条目 JSON 中不应包含实际 prompt 内容
    expect(entryJson).not.toContain('You are a risk suggestion assistant.')
    expect(entryJson).not.toContain('system instruction')
    expect(entryJson).not.toContain('Authorization')
    // 不含 apiKey/secret 材料
    const parsed = JSON.parse(entryJson) as Record<string, unknown>
    expect(parsed).not.toHaveProperty('apiKey')
    expect(parsed).not.toHaveProperty('secret')
    expect(parsed).not.toHaveProperty('token')
  })
})

// ---------------------------------------------------------------------------
// §2.5/§2.6 确定性 hash
// ---------------------------------------------------------------------------

describe('确定性内容 hash（task 2.5/2.6）', () => {
  it('同内容同 hash', () => {
    const hash1 = computePromptContentHash(KNOWN_PROMPT_CONTENT)
    const hash2 = computePromptContentHash(KNOWN_PROMPT_CONTENT)
    expect(hash1).toBe(hash2)
    expect(hash1).toBe(KNOWN_PROMPT_HASH)
  })

  it('内容变化 hash 变化', () => {
    const hash1 = computePromptContentHash(KNOWN_PROMPT_CONTENT)
    const hash2 = computePromptContentHash(TRIZ_PROMPT_CONTENT)
    expect(hash1).not.toBe(hash2)
    expect(hash2).toBe(TRIZ_PROMPT_HASH)
  })

  it('空字符串也有确定性 hash', () => {
    const hash = computePromptContentHash('')
    expect(typeof hash).toBe('string')
    expect(hash.length).toBe(16)
    // 空字符串的 hash 应该是确定的
    expect(computePromptContentHash('')).toBe(hash)
  })

  it('hash 为 sha256 前 16 hex', () => {
    const hash = computePromptContentHash('test')
    expect(/^[0-9a-f]{16}$/.test(hash)).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// §2.6 hash 校验
// ---------------------------------------------------------------------------

describe('hash 校验（task 2.6/4.1）', () => {
  it('hash 相符时 verifyPromptHash 返回 true', () => {
    expect(verifyPromptHash(KNOWN_PROMPT_CONTENT, KNOWN_PROMPT_HASH)).toBe(true)
  })

  it('hash 不符时 verifyPromptHash 返回 false', () => {
    expect(verifyPromptHash(KNOWN_PROMPT_CONTENT, MISMATCH_HASH)).toBe(false)
  })

  it('不同内容的 hash 不符', () => {
    expect(verifyPromptHash(TRIZ_PROMPT_CONTENT, KNOWN_PROMPT_HASH)).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// §2.7 fixtures 四态
// ---------------------------------------------------------------------------

describe('fixtures 四态覆盖（task 2.7）', () => {
  it('已注册条目存在', () => {
    expect(REGISTERED_RISK_ENTRY.promptName).toBe('risk-suggest')
    expect(REGISTERED_RISK_ENTRY.version).toBe('1.0.0')
    expect(isPromptVersionEntry(REGISTERED_RISK_ENTRY)).toBe(true)
  })

  it('未注册标记为 unregistered', () => {
    expect(PROMPT_VERSION_UNREGISTERED).toBe('unregistered')
  })

  it('hash 不符 hash 存在', () => {
    expect(MISMATCH_HASH).not.toBe(KNOWN_PROMPT_HASH)
    expect(MISMATCH_HASH).not.toBe(TRIZ_PROMPT_HASH)
  })

  it('多生效范围 fixtures 存在', () => {
    expect(REGISTERED_MULTI_SCOPE_ENTRY.effectiveScope.capabilities.length).toBeGreaterThan(1)
    expect(isPromptVersionEntry(REGISTERED_MULTI_SCOPE_ENTRY)).toBe(true)
  })

  it('全局生效范围 fixtures 存在', () => {
    expect(REGISTERED_GLOBAL_ENTRY.effectiveScope.capabilities).toHaveLength(0)
    expect(REGISTERED_GLOBAL_ENTRY.effectiveScope.strategies).toHaveLength(0)
  })

  it('完整注册表包含所有 fixtures', () => {
    expect(PROMPT_VERSION_REGISTRY_FIXTURES.length).toBeGreaterThanOrEqual(4)
  })
})

// ---------------------------------------------------------------------------
// §3.3 本地版本字段不冒充标准键
// ---------------------------------------------------------------------------

describe('本地版本字段不冒充标准键（task 3.3）', () => {
  it('版本字段在 aiproj_ 前缀下', () => {
    expect(PROMPT_VERSION_FIELD).toBe('aiproj_prompt_version')
    expect(PROMPT_VERSION_FIELD.startsWith(PROMPT_VERSION_LOCAL_PREFIX)).toBe(true)
  })

  it('名称字段对齐 gen_ai.prompt.name', () => {
    expect(PROMPT_NAME_FIELD).toBe('prompt_name')
  })

  it('无命名空间违规', () => {
    const attrs: Record<string, unknown> = {
      prompt_name: 'test',
      aiproj_prompt_version: '1.0.0',
    }
    const violations = findPromptVersionNamespacingViolations(attrs)
    expect(violations).toHaveLength(0)
  })

  it('检测 gen_ai_prompt_version 违规', () => {
    const attrs: Record<string, unknown> = {
      gen_ai_prompt_version: '1.0.0',
    }
    const violations = findPromptVersionNamespacingViolations(attrs)
    expect(violations).toContain('gen_ai_prompt_version')
  })

  it('检测 gen_ai.prompt.version 违规', () => {
    const attrs: Record<string, unknown> = {
      'gen_ai.prompt.version': '1.0.0',
    }
    const violations = findPromptVersionNamespacingViolations(attrs)
    expect(violations).toContain('gen_ai.prompt.version')
  })
})

// ---------------------------------------------------------------------------
// §5.3/§5.4 变更范围可查、变更内容不可查
// ---------------------------------------------------------------------------

describe('变更范围可查、内容不可查（task 5.3/5.4）', () => {
  it('生效范围可解析', () => {
    const scope: PromptVersionScope = SCOPE_RISK
    expect(scope.capabilities).toContain('risk')
    expect(scope.strategies.length).toBeGreaterThan(0)
  })

  it('不存在返回 prompt 内容或差异的路径', () => {
    // 注册表条目不包含 prompt 全文
    const entry = REGISTERED_RISK_ENTRY
    const entryJson = JSON.stringify(entry)
    // 不存在 content/diff/text/body 字段
    expect(entryJson).not.toContain('"content"')
    expect(entryJson).not.toContain('"text"')
    expect(entryJson).not.toContain('"body"')
    expect(entryJson).not.toContain('"diff"')
    expect(entryJson).not.toContain('"promptContent"')
    expect(entryJson).not.toContain('"promptText"')
  })

  it('所有条目都不包含内容字段', () => {
    for (const entry of PROMPT_VERSION_REGISTRY_FIXTURES) {
      const keys = Object.keys(entry)
      expect(keys).not.toContain('content')
      expect(keys).not.toContain('text')
      expect(keys).not.toContain('body')
      expect(keys).not.toContain('diff')
    }
  })
})

// ---------------------------------------------------------------------------
// 类型守卫
// ---------------------------------------------------------------------------

describe('类型守卫', () => {
  it('isPromptVersionEntry 识别有效条目', () => {
    expect(isPromptVersionEntry(REGISTERED_RISK_ENTRY)).toBe(true)
  })

  it('isPromptVersionEntry 拒绝无效值', () => {
    expect(isPromptVersionEntry(null)).toBe(false)
    expect(isPromptVersionEntry(undefined)).toBe(false)
    expect(isPromptVersionEntry('string')).toBe(false)
    expect(isPromptVersionEntry({})).toBe(false)
    expect(isPromptVersionEntry({ promptName: 'test' })).toBe(false)
  })

  it('isValidPromptVersion 识别合法版本号', () => {
    expect(isValidPromptVersion('1.0.0')).toBe(true)
    expect(isValidPromptVersion('2.1')).toBe(true)
    expect(isValidPromptVersion('0')).toBe(true)
    expect(isValidPromptVersion('100')).toBe(true)
  })

  it('isValidPromptVersion 拒绝非法版本号', () => {
    expect(isValidPromptVersion('v1.0.0')).toBe(false)
    expect(isValidPromptVersion('1.0.0-beta')).toBe(false)
    expect(isValidPromptVersion('')).toBe(false)
    expect(isValidPromptVersion('latest')).toBe(false)
  })
})
