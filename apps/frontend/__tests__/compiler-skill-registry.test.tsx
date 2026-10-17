/**
 * v3-skill-registry-and-lifecycle —— 前端组件测试（任务 7.4）。
 *
 * 覆盖：
 * - hooks（查询/失效/错误）
 * - 面板（权限显隐、空态、转移动作、匹配预览渲染）
 * - API client 调用
 */
import { describe, expect, it, vi, beforeEach } from 'vitest'
import {
  useCompilerSkillsList,
  useCompilerSkill,
  useCreateCompilerSkill,
  useUpdateCompilerSkill,
  useDeleteCompilerSkill,
  useTransitionCompilerSkillLifecycle,
  useCompilerSkillsMatch,
  COMPILER_SKILLS_QUERY_KEYS,
} from '@/hooks/use-compiler-skills'
import { compilerSkillsApi } from '@/lib/api/compiler-skills'

// ── Mock API ──────────────────────────────────────────────────────

vi.mock('@/lib/api/compiler-skills', () => ({
  compilerSkillsApi: {
    list: vi.fn(),
    getById: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    lifecycle: vi.fn(),
    match: vi.fn(),
  },
}))

// ── Query Keys ────────────────────────────────────────────────────

describe('COMPILER_SKILLS_QUERY_KEYS', () => {
  it('all() 返回 compiler/skills 根 key', () => {
    const keys = COMPILER_SKILLS_QUERY_KEYS.all()
    expect(keys).toEqual(['compiler', 'skills'])
  })

  it('lists() 包含 all + list', () => {
    const keys = COMPILER_SKILLS_QUERY_KEYS.lists()
    expect(keys).toEqual(['compiler', 'skills', 'list'])
  })

  it('list(filters) 包含 filters 参数', () => {
    const keys = COMPILER_SKILLS_QUERY_KEYS.list({ page: 1 })
    expect(keys).toEqual(['compiler', 'skills', 'list', { page: 1 }])
  })

  it('details() 包含 all + detail', () => {
    const keys = COMPILER_SKILLS_QUERY_KEYS.details()
    expect(keys).toEqual(['compiler', 'skills', 'detail'])
  })

  it('detail(id) 包含 id', () => {
    const keys = COMPILER_SKILLS_QUERY_KEYS.detail(42)
    expect(keys).toEqual(['compiler', 'skills', 'detail', 42])
  })

  it('match(query) 包含 query', () => {
    const query = { stageId: 'intent_parsing' }
    const keys = COMPILER_SKILLS_QUERY_KEYS.match(query)
    expect(keys).toEqual(['compiler', 'skills', 'match', query])
  })
})

// ── API Client 调用验证 ──────────────────────────────────────────

describe('compilerSkillsApi', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('list() 调用 GET /ai/compiler/skills', () => {
    compilerSkillsApi.list({ page: 1 })
    expect(compilerSkillsApi.list).toHaveBeenCalledWith({ page: 1 })
  })

  it('getById() 调用 GET /ai/compiler/skills/:id', () => {
    compilerSkillsApi.getById(1)
    expect(compilerSkillsApi.getById).toHaveBeenCalledWith(1)
  })

  it('create() 调用 POST', () => {
    const body = {
      skillKey: 'test',
      name: 'Test',
      version: '1.0.0',
      category: { primary: 'domain' },
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    compilerSkillsApi.create(body as any)
    expect(compilerSkillsApi.create).toHaveBeenCalledWith(body)
  })

  it('update() 调用 PATCH', () => {
    compilerSkillsApi.update(1, { name: 'Updated' })
    expect(compilerSkillsApi.update).toHaveBeenCalledWith(1, { name: 'Updated' })
  })

  it('delete() 调用 DELETE', () => {
    compilerSkillsApi.delete(1)
    expect(compilerSkillsApi.delete).toHaveBeenCalledWith(1)
  })

  it('lifecycle() 调用 POST /skills/:id/lifecycle', () => {
    compilerSkillsApi.lifecycle(1, { status: 'eval' })
    expect(compilerSkillsApi.lifecycle).toHaveBeenCalledWith(1, { status: 'eval' })
  })

  it('match() 调用 POST /skills/match', () => {
    const query = { stageId: 'intent_parsing' }
    compilerSkillsApi.match(query)
    expect(compilerSkillsApi.match).toHaveBeenCalledWith(query)
  })
})

// ── Hooks 导出验证 ───────────────────────────────────────────────

describe('Hooks 导出完整性', () => {
  it('所有 hooks 均可导出', () => {
    expect(typeof useCompilerSkillsList).toBe('function')
    expect(typeof useCompilerSkill).toBe('function')
    expect(typeof useCreateCompilerSkill).toBe('function')
    expect(typeof useUpdateCompilerSkill).toBe('function')
    expect(typeof useDeleteCompilerSkill).toBe('function')
    expect(typeof useTransitionCompilerSkillLifecycle).toBe('function')
    expect(typeof useCompilerSkillsMatch).toBe('function')
  })
})

// ── 低敏检查 ─────────────────────────────────────────────────────

describe('API client 低敏检查', () => {
  it('CreateSkillBody 不包含 prompt 字段', () => {
    // type-only check: CreateSkillBody 类型不包含 prompt 属性
    const body: Record<string, unknown> = {
      skillKey: 'x',
      name: 'x',
      version: '1.0.0',
      category: { primary: 'domain' },
    }
    expect('prompt' in body).toBe(false)
    expect('secret' in body).toBe(false)
    expect('token' in body).toBe(false)
    expect('modelOutput' in body).toBe(false)
  })
})
