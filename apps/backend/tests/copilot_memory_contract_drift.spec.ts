/**
 * v3-backend-type-debt-closure（任务 3.3）—— 契约字段名漂移捕获测试。
 *
 * 背景（observation F3 / 任务 3.1–3.2）：记忆注入器与导出曾按 Lucid 列名
 * `memoryScope` / `entryId` 读契约类型（契约为 `scope` / `id`），运行时恒 undefined，
 * scope 过滤全部落空。本测试用「诱饵字段」证明实现读的是契约字段名：
 * 对象上同时携带契约字段与历史列名诱饵，若实现回退到读诱饵字段，断言立即失败。
 */
import { describe, expect, it } from 'vitest'
import type { CopilotMemoryEntry } from '@aiproj/types'
import { selectMemoriesForInjection } from '../app/services/copilot_memory/copilot_memory_injector.js'
import { exportMemoryEntries } from '../app/services/copilot_memory/copilot_memory_service.js'

function makeEntry(overrides: Partial<CopilotMemoryEntry> = {}): CopilotMemoryEntry {
  return {
    id: 'm-1',
    organizationId: 1,
    actorId: 5,
    scope: 'organization',
    summary: '偏好周会放在周二',
    tags: ['meeting'],
    confidence: 0.8,
    confidenceSource: 'explicit_user_statement',
    basis: [],
    observedAt: '2026-08-01T00:00:00.000Z',
    status: 'confirmed',
    validityTier: 'durable',
    createdAt: '2026-08-01T00:00:00.000Z',
    updatedAt: '2026-08-01T00:00:00.000Z',
    ...overrides,
  }
}

/** 在契约字段之外混入历史 Lucid 列名诱饵（运行时对象完全可能带有多余键）。 */
function withLegacyDecoys<T extends object>(entry: T, decoys: Record<string, unknown>): T {
  return Object.assign({}, entry, decoys)
}

describe('契约字段名漂移捕获（任务 3.3）', () => {
  it('注入选取读契约字段 scope，而非历史列名 memoryScope', () => {
    // 契约 scope=organization；诱饵 memoryScope=user。
    // global scope 只注入 user 记忆——若实现读诱饵（user）会错误纳入，读契约（organization）则排除。
    const entry = withLegacyDecoys(makeEntry({ scope: 'organization' }), {
      memoryScope: 'user',
    })
    const result = selectMemoriesForInjection([entry], {
      scope: 'global',
      organizationId: 1,
      actorId: 5,
      memoryBudgetBytes: 10_000,
    })
    expect(result.selected).toHaveLength(0)
  })

  it('scope 过滤命中的正是契约字段值（project 记忆在 global 下不注入）', () => {
    const projectEntry = withLegacyDecoys(makeEntry({ scope: 'project', projectId: 10 }), {
      memoryScope: 'user',
    })
    const result = selectMemoriesForInjection([projectEntry], {
      scope: 'global',
      organizationId: 1,
      actorId: 5,
      memoryBudgetBytes: 10_000,
    })
    expect(result.selected).toHaveLength(0)

    // 同一条目在 organization scope 下应被注入（scope=project 属合法子集）
    const orgResult = selectMemoriesForInjection([projectEntry], {
      scope: 'organization',
      organizationId: 1,
      actorId: 5,
      memoryBudgetBytes: 10_000,
    })
    expect(orgResult.selected).toHaveLength(1)
  })

  it('projectId 缺省为 undefined 时可注入（不得与 null 比较）', () => {
    // F3：原实现 `m.projectId === null` 永不成立，契约可选字段缺省是 undefined。
    const entry = makeEntry({ scope: 'project', projectId: undefined })
    const result = selectMemoriesForInjection([entry], {
      scope: 'project',
      projectId: 10,
      organizationId: 1,
      actorId: 5,
      memoryBudgetBytes: 10_000,
    })
    expect(result.selected).toHaveLength(1)
  })

  it('导出读契约字段 id/scope，而非历史列名 entryId/memoryScope', () => {
    const entry = withLegacyDecoys(
      makeEntry({ id: 'm-contract-id', scope: 'project', projectId: 10 }),
      { entryId: 'legacy-wrong-id', memoryScope: 'user' },
    )
    const result = exportMemoryEntries([entry], 1)
    expect(result.entries).toHaveLength(1)
    expect(result.entries[0]!.id).toBe('m-contract-id')
    expect(result.entries[0]!.scope).toBe('project')
    // 诱饵值不得出现在导出中
    expect(JSON.stringify(result)).not.toContain('legacy-wrong-id')
  })
})
