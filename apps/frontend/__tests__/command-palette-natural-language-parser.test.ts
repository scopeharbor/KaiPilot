/**
 * 自然语言解析器单元测试（design.md D2/D3，spec「自然语言候选命令 / 写意图 / 歧义与低置信度」）。
 *
 * 覆盖：导航、主题/密度、上下文新建任务、同义词、上下文加权、候选排序、
 * 歧义多候选、低置信度空态、写意图降级 open-form/open-confirm、
 * 无安全承接时阻断、权限边界（解析器只消费调用方给定的可见命令）。
 */
import { describe, expect, test, vi } from 'vitest'
import { Plus, LayoutGrid, Settings, CheckSquare, ListTodo } from 'lucide-react'
import { parseNaturalLanguageCommand } from '@/lib/command-palette-natural-language'
import type {
  NaturalLanguageCommandCandidate,
  NaturalLanguageCommandResult,
} from '@/lib/command-palette-natural-language'
import type { CommandContext, RegisteredCommand } from '@/lib/command-registry/types'

const ctx: CommandContext = {
  pathname: '/projects/1/kanban',
  params: { id: '1' },
  searchParams: new URLSearchParams(),
}

/** 取首个候选（带存在性断言，满足 noUncheckedIndexedAccess）。 */
function firstCandidate(result: NaturalLanguageCommandResult): NaturalLanguageCommandCandidate {
  const candidate = result.candidates[0]
  if (!candidate) throw new Error('expected at least one candidate')
  return candidate
}

function makeCmd(
  partial: Partial<RegisteredCommand> & Pick<RegisteredCommand, 'id' | 'label'>,
): RegisteredCommand {
  return {
    icon: Plus,
    group: 'navigation',
    effect: 'navigate',
    execute: vi.fn(),
    ...partial,
  }
}

const navProjects = makeCmd({
  id: 'nav./projects',
  label: '项目列表',
  keywords: ['项目', 'projects'],
  icon: LayoutGrid,
})
const themeDark = makeCmd({
  id: 'theme.dark',
  label: '深色主题',
  keywords: ['主题', '深色', 'dark'],
  group: 'theme',
  effect: 'ui-setting',
})
const densityCompact = makeCmd({
  id: 'density.compact',
  label: '紧凑密度',
  keywords: ['密度', '紧凑', 'compact'],
  group: 'density',
  effect: 'ui-setting',
})
const ctxNewTask = makeCmd({
  id: 'ctx.project.new-task',
  label: '新建任务',
  keywords: ['任务', '新建', 'create', 'task'],
  group: 'contextual',
  effect: 'open-form',
  requiresPermission: ['task:create'],
  when: (c) => c.pathname.startsWith('/projects/'),
})
const approveChange = makeCmd({
  id: 'ctx.change.approve',
  label: '审批变更',
  keywords: ['变更', '审批', 'approve'],
  group: 'contextual',
  effect: 'open-confirm',
  icon: CheckSquare,
})

describe('parseNaturalLanguageCommand - 基本意图', () => {
  test('导航意图：「打开项目列表」→ navigate 主候选', () => {
    const result = parseNaturalLanguageCommand('打开项目列表', [navProjects, themeDark], ctx)
    expect(result.strategy).toBe('primary')
    expect(firstCandidate(result).commandId).toBe('nav./projects')
    expect(firstCandidate(result).effect).toBe('navigate')
    expect(firstCandidate(result).requiresReview).toBe(false)
    expect(firstCandidate(result).command).toBe(navProjects)
  })

  test('设置意图：「切换到深色主题」→ ui-setting 候选', () => {
    const result = parseNaturalLanguageCommand('切换到深色主题', [themeDark, densityCompact], ctx)
    expect(firstCandidate(result).commandId).toBe('theme.dark')
    expect(firstCandidate(result).effect).toBe('ui-setting')
  })

  test('密度同义词：「改成紧凑密度」→ density.compact', () => {
    const result = parseNaturalLanguageCommand('改成紧凑密度', [themeDark, densityCompact], ctx)
    expect(firstCandidate(result).commandId).toBe('density.compact')
  })

  test('同义词命中 keywords：「create task」→ 新建任务', () => {
    const result = parseNaturalLanguageCommand('create task', [ctxNewTask], ctx)
    expect(firstCandidate(result).commandId).toBe('ctx.project.new-task')
  })

  test('上下文新建任务：写意图降级 open-form 且标记 requiresReview', () => {
    const result = parseNaturalLanguageCommand('给这个项目新建任务', [ctxNewTask, navProjects], ctx)
    expect(result.strategy).toBe('primary')
    const top = firstCandidate(result)
    expect(top.commandId).toBe('ctx.project.new-task')
    expect(top.effect).toBe('open-form')
    expect(top.requiresReview).toBe(true)
    expect(top.previewText).toContain('手动提交')
    expect(top.reason).toContain('当前页面')
  })

  test('上下文加权：同为 open-form 的候选中 contextual 分组排在前面', () => {
    const otherNewTask = makeCmd({
      id: 'ext.tasks.new',
      label: '新建任务页',
      keywords: ['任务', '新建'],
      effect: 'open-form',
    })
    const result = parseNaturalLanguageCommand('新建任务', [otherNewTask, ctxNewTask], ctx)
    expect(firstCandidate(result).commandId).toBe('ctx.project.new-task')
  })

  test('候选按评分降序排列且最多 3 条', () => {
    const cmds = [
      makeCmd({ id: 'a', label: '设置一', keywords: ['设置'] }),
      makeCmd({ id: 'b', label: '设置二', keywords: ['设置'] }),
      makeCmd({ id: 'c', label: '设置三', keywords: ['设置'] }),
      makeCmd({ id: 'd', label: '设置四', keywords: ['设置'] }),
    ]
    const result = parseNaturalLanguageCommand('打开设置', cmds, ctx)
    expect(result.candidates.length).toBeLessThanOrEqual(3)
    const ids = result.candidates.map((c) => c.commandId)
    expect(ids).toEqual(['a', 'b', 'c'])
  })
})

describe('parseNaturalLanguageCommand - 歧义与低置信度', () => {
  test('歧义输入展示多个候选（不自动收敛为单选）', () => {
    const cmds = [
      makeCmd({
        id: 'nav./settings/notifications',
        label: '通知设置',
        keywords: ['设置'],
        icon: Settings,
      }),
      makeCmd({
        id: 'nav./settings/workspace',
        label: '工作区设置',
        keywords: ['设置'],
        icon: Settings,
      }),
    ]
    const result = parseNaturalLanguageCommand('打开设置', cmds, ctx)
    expect(result.strategy).toBe('multiple')
    expect(result.candidates.length).toBe(2)
    for (const c of result.candidates) {
      expect(c.reason.length).toBeGreaterThan(0)
    }
  })

  test('高置信度且明显领先时收敛为主候选', () => {
    const cmds = [
      makeCmd({ id: 'exact', label: '项目列表' }),
      makeCmd({ id: 'weak', label: '项目风险', keywords: ['项目'] }),
    ]
    const result = parseNaturalLanguageCommand('打开项目列表', cmds, ctx)
    expect(result.strategy).toBe('primary')
    expect(firstCandidate(result).commandId).toBe('exact')
  })

  test('低置信度输入返回空态与高级搜索提示，不产生任何候选', () => {
    const result = parseNaturalLanguageCommand('随便说点什么', [navProjects, themeDark], ctx)
    expect(result.strategy).toBe('empty')
    expect(result.candidates).toEqual([])
    expect(result.emptyHint).toContain('高级搜索')
  })

  test('输入过短返回空态', () => {
    const result = parseNaturalLanguageCommand('项', [navProjects], ctx)
    expect(result.strategy).toBe('empty')
    expect(result.candidates).toEqual([])
  })
})

describe('parseNaturalLanguageCommand - 写意图边界', () => {
  test('创建意图只映射 open-form，候选引用原 registry 命令对象', () => {
    const result = parseNaturalLanguageCommand(
      '给当前项目创建一个明天截止的任务',
      [ctxNewTask],
      ctx,
    )
    expect(result.candidates.length).toBeGreaterThan(0)
    for (const c of result.candidates) {
      expect(['open-form', 'open-confirm']).toContain(c.effect)
      expect(c.requiresReview).toBe(true)
    }
    expect(firstCandidate(result).command).toBe(ctxNewTask)
    // 候选不携带任何 execute 字段（执行时复用原命令对象，不新建写入通道）。
    expect('execute' in firstCandidate(result)).toBe(false)
  })

  test('审批/应用意图只映射 open-confirm', () => {
    const result = parseNaturalLanguageCommand('批准这个变更', [approveChange], ctx)
    expect(firstCandidate(result).commandId).toBe('ctx.change.approve')
    expect(firstCandidate(result).effect).toBe('open-confirm')
    expect(firstCandidate(result).requiresReview).toBe(true)
  })

  test('写意图命中 navigate 命令时不降级为导航，返回阻断候选', () => {
    const navTaskBoard = makeCmd({
      id: 'nav./tasks',
      label: '任务看板',
      keywords: ['任务'],
      icon: ListTodo,
    })
    const result = parseNaturalLanguageCommand('删除这个任务', [navTaskBoard], ctx)
    expect(result.strategy).toBe('blocked')
    const blocked = firstCandidate(result)
    expect(blocked.blockedReason).toBe('write-intent-no-safe-open-target')
    expect(blocked.command).toBeUndefined()
    expect(blocked.commandId).toBeNull()
    expect(blocked.effect).toBeNull()
    expect('execute' in blocked).toBe(false)
  })

  test('审批意图无承接命令时阻断而非猜测执行', () => {
    const result = parseNaturalLanguageCommand('应用这个 AI 草案', [navProjects], ctx)
    expect(result.strategy).toBe('blocked')
    expect(firstCandidate(result).blockedReason).toBe('write-intent-no-safe-open-target')
  })

  test('解析器只消费给定 visibleCommands：无权限命令不出现在候选中', () => {
    // 模拟面板过滤：ctxNewTask 声明 task:create，当前用户无权限，故不在 visibleCommands 内。
    const visible = [navProjects, themeDark]
    const result = parseNaturalLanguageCommand('新建任务', visible, ctx)
    const ids = result.candidates.map((c) => c.commandId)
    expect(ids).not.toContain('ctx.project.new-task')
    for (const id of ids) {
      if (id === null) continue // 阻断候选无命令
      expect(visible.some((c) => c.id === id)).toBe(true)
    }
    // 写意图无承接命令 → 阻断，而不是猜测展示其他命令。
    expect(result.strategy).toBe('blocked')
  })

  test('解析为纯函数：不执行任何命令的 execute', () => {
    const execute = vi.fn()
    const cmd = makeCmd({
      id: 'ctx.demo',
      label: '新建任务',
      group: 'contextual',
      effect: 'open-form',
      execute,
    })
    parseNaturalLanguageCommand('新建任务', [cmd], ctx)
    expect(execute).not.toHaveBeenCalled()
  })
})
