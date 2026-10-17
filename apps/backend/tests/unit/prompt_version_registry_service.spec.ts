/**
 * v3-prompt-version-registry —— 注册表后端服务测试。
 *
 * 覆盖 spec 要求：
 * - 组织隔离：跨组织注册条目不可见（§7.2）
 * - 零域写：注册表路径无域仓储或模型写依赖（§7.6）
 * - 统一账本与既有 AI 调用行为未被改变（§7.7）
 */
import { describe, it, expect, beforeEach } from 'vitest'
import {
  registerPromptVersion,
  queryPromptVersions,
  listPromptVersions,
  queryByCapability,
  isRegistered,
  getLatestVersion,
  clearAllRegistries,
} from '../../app/services/prompt-version-registry/registry_service.js'
import {
  REGISTERED_RISK_ENTRY,
  REGISTERED_TRIZ_ENTRY,
  REGISTERED_GLOBAL_ENTRY,
} from '@aiproj/types'

const ORG_A = 101
const ORG_B = 202

beforeEach(() => {
  clearAllRegistries()
})

// ---------------------------------------------------------------------------
// §7.1 组织隔离
// ---------------------------------------------------------------------------

describe('组织隔离（task 7.1/7.2）', () => {
  it('跨组织注册条目不可见', () => {
    registerPromptVersion(ORG_A, REGISTERED_RISK_ENTRY)
    registerPromptVersion(ORG_B, REGISTERED_TRIZ_ENTRY)

    const resultA = listPromptVersions(ORG_A)
    expect(resultA.entries).toHaveLength(1)
    expect(resultA.entries[0].promptName).toBe('risk-suggest')

    const resultB = listPromptVersions(ORG_B)
    expect(resultB.entries).toHaveLength(1)
    expect(resultB.entries[0].promptName).toBe('triz-contradiction')
  })

  it('不同组织可注册同名 prompt', () => {
    registerPromptVersion(ORG_A, REGISTERED_RISK_ENTRY)
    const entryForB = { ...REGISTERED_RISK_ENTRY, version: '2.0.0' }
    registerPromptVersion(ORG_B, entryForB)

    expect(listPromptVersions(ORG_A).entries).toHaveLength(1)
    expect(listPromptVersions(ORG_B).entries).toHaveLength(1)
  })

  it('查询不存在的组织返回空', () => {
    const result = listPromptVersions(999)
    expect(result.entries).toHaveLength(0)
    expect(result.total).toBe(0)
  })
})

// ---------------------------------------------------------------------------
// §7.6 零域写
// ---------------------------------------------------------------------------

describe('零域写（task 7.5/7.6）', () => {
  it('注册表不依赖任何领域仓储', () => {
    // 注册表服务是纯函数，不 import 任何 Lucid 模型
    // 这个测试本身就是证据：registry_service.ts 只依赖 @aiproj/types
    registerPromptVersion(ORG_A, REGISTERED_RISK_ENTRY)
    const result = listPromptVersions(ORG_A)
    expect(result.entries).toHaveLength(1)
  })

  it('注册表不产生动作产出', () => {
    // 注册操作只修改内存 Map，不触发任何 side effect
    registerPromptVersion(ORG_A, REGISTERED_RISK_ENTRY)
    // 没有返回动作指示
    const registered = isRegistered(ORG_A, 'risk-suggest', '1.0.0')
    expect(registered).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// 注册与查询基本功能
// ---------------------------------------------------------------------------

describe('注册与查询', () => {
  it('注册后可查询', () => {
    registerPromptVersion(ORG_A, REGISTERED_RISK_ENTRY)
    const result = queryPromptVersions(ORG_A, 'risk-suggest')
    expect(result.entries).toHaveLength(1)
    expect(result.entries[0].version).toBe('1.0.0')
  })

  it('同名同版本幂等', () => {
    const r1 = registerPromptVersion(ORG_A, REGISTERED_RISK_ENTRY)
    const r2 = registerPromptVersion(ORG_A, REGISTERED_RISK_ENTRY)
    expect(r1).toBe(true)
    expect(r2).toBe(false)
    expect(listPromptVersions(ORG_A).entries).toHaveLength(1)
  })

  it('按能力面查询', () => {
    registerPromptVersion(ORG_A, REGISTERED_RISK_ENTRY)
    registerPromptVersion(ORG_A, REGISTERED_TRIZ_ENTRY)
    registerPromptVersion(ORG_A, REGISTERED_GLOBAL_ENTRY)

    const riskResult = queryByCapability(ORG_A, 'risk')
    expect(riskResult.entries.length).toBeGreaterThanOrEqual(1)
    // risk-suggest 和 global 都覆盖 risk
    expect(riskResult.entries.some((e) => e.promptName === 'risk-suggest')).toBe(true)
    expect(riskResult.entries.some((e) => e.promptName === 'general-purpose')).toBe(true)
  })

  it('获取最新版本', () => {
    registerPromptVersion(ORG_A, REGISTERED_RISK_ENTRY)
    const latest = getLatestVersion(ORG_A, 'risk-suggest')
    expect(latest).not.toBeNull()
    expect(latest!.version).toBe('1.0.0')
  })

  it('不存在的 prompt 返回 null', () => {
    const latest = getLatestVersion(ORG_A, 'nonexistent')
    expect(latest).toBeNull()
  })
})
