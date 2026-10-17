import { describe, expect, test } from 'vitest'
import { Plus } from 'lucide-react'
import {
  COMMAND_HISTORY_MAX_ENTRIES,
  COMMAND_HISTORY_PROMOTED_LIMIT,
  COMMAND_HISTORY_STORAGE_VERSION,
  FRECENCY_HALF_LIFE_MS,
  createEmptyCommandHistory,
  enforceHistoryCap,
  parseCommandHistory,
  pruneCommandHistory,
  rankVisibleCommandsByFrecency,
  recordCommandUsage,
  scoreCommandUsage,
  serializeCommandHistory,
  type CommandHistoryData,
  type CommandUsageRecord,
} from '@/lib/command-registry/history'
import type { RegisteredCommand } from '@/lib/command-registry/types'

const NOW = 1_700_000_000_000

function makeRecord(id: string, overrides: Partial<CommandUsageRecord> = {}): CommandUsageRecord {
  return { id, count: 1, firstUsedAt: NOW, lastUsedAt: NOW, ...overrides }
}

function makeHistory(...records: CommandUsageRecord[]): CommandHistoryData {
  const map: Record<string, CommandUsageRecord> = {}
  for (const r of records) map[r.id] = r
  return { version: COMMAND_HISTORY_STORAGE_VERSION, records: map }
}

function makeCommand(id: string, overrides: Partial<RegisteredCommand> = {}): RegisteredCommand {
  return {
    id,
    label: id,
    icon: Plus,
    group: 'navigation',
    effect: 'navigate',
    execute: () => {},
    ...overrides,
  }
}

describe('command-history/recordCommandUsage', () => {
  test('首次使用：创建记录，count=1，first/last 时间相同', () => {
    const next = recordCommandUsage(createEmptyCommandHistory(), 'nav./projects', NOW)
    expect(next.records['nav./projects']).toEqual({
      id: 'nav./projects',
      count: 1,
      firstUsedAt: NOW,
      lastUsedAt: NOW,
    })
  })

  test('重复使用：count+1，保留 firstUsedAt，更新 lastUsedAt', () => {
    const first = recordCommandUsage(createEmptyCommandHistory(), 'nav./projects', NOW)
    const second = recordCommandUsage(first, 'nav./projects', NOW + 60_000)
    const rec = second.records['nav./projects']!
    expect(rec.count).toBe(2)
    expect(rec.firstUsedAt).toBe(NOW)
    expect(rec.lastUsedAt).toBe(NOW + 60_000)
  })

  test('空/空白/非法命令 ID 被忽略，返回原历史', () => {
    const base = makeHistory(makeRecord('nav./projects'))
    expect(recordCommandUsage(base, '', NOW)).toBe(base)
    expect(recordCommandUsage(base, '   ', NOW)).toBe(base)
    expect(recordCommandUsage(base, undefined as unknown as string, NOW)).toBe(base)
    expect(recordCommandUsage(base, 123 as unknown as string, NOW)).toBe(base)
  })

  test('记录形态只含低敏字段', () => {
    const next = recordCommandUsage(createEmptyCommandHistory(), 'theme.dark', NOW, '/settings')
    const rec = next.records['theme.dark']!
    expect(Object.keys(rec).sort()).toEqual(
      ['count', 'firstUsedAt', 'id', 'lastContextPath', 'lastUsedAt'].sort(),
    )
    // 不传 contextPath 时字段缺省
    const bare = recordCommandUsage(createEmptyCommandHistory(), 'theme.dark', NOW)
    expect(Object.keys(bare.records['theme.dark']!).sort()).toEqual(
      ['count', 'firstUsedAt', 'id', 'lastUsedAt'].sort(),
    )
  })

  test('含查询串或哈希的 contextPath 不写入', () => {
    const withQuery = recordCommandUsage(
      createEmptyCommandHistory(),
      'nav./search',
      NOW,
      '/search?q=机密关键词',
    )
    expect(withQuery.records['nav./search']!.lastContextPath).toBeUndefined()
    const withHash = recordCommandUsage(
      createEmptyCommandHistory(),
      'nav./search',
      NOW,
      '/search#section',
    )
    expect(withHash.records['nav./search']!.lastContextPath).toBeUndefined()
    // 但使用记录本身仍被写入
    expect(withQuery.records['nav./search']!.count).toBe(1)
  })
})

describe('command-history/pruneCommandHistory', () => {
  test('移除不在有效集合内的历史记录', () => {
    const history = makeHistory(makeRecord('nav.a'), makeRecord('nav.gone'), makeRecord('nav.b'))
    const next = pruneCommandHistory(history, new Set(['nav.a', 'nav.b']))
    expect(Object.keys(next.records).sort()).toEqual(['nav.a', 'nav.b'])
  })

  test('全部有效时返回原历史（无多余对象分配）', () => {
    const history = makeHistory(makeRecord('nav.a'))
    expect(pruneCommandHistory(history, new Set(['nav.a', 'nav.b']))).toBe(history)
  })
})

describe('command-history/enforceHistoryCap', () => {
  test('未超容量时原样返回', () => {
    const history = makeHistory(makeRecord('a'), makeRecord('b'))
    expect(enforceHistoryCap(history, NOW)).toBe(history)
  })

  test('超容量时按评分从低到高确定性驱逐到上限', () => {
    const records: CommandUsageRecord[] = []
    for (let i = 0; i < COMMAND_HISTORY_MAX_ENTRIES + 5; i++) {
      // 索引越小越旧、次数越少 → 评分越低 → 优先被驱逐
      records.push(
        makeRecord(`cmd.${String(i).padStart(3, '0')}`, {
          count: 1,
          lastUsedAt: NOW - (COMMAND_HISTORY_MAX_ENTRIES + 5 - i) * 60_000,
        }),
      )
    }
    const history = makeHistory(...records)
    const next = enforceHistoryCap(history, NOW)
    const ids = Object.keys(next.records)
    expect(ids).toHaveLength(COMMAND_HISTORY_MAX_ENTRIES)
    // 最近使用的 50 条被保留，最旧的 5 条被驱逐
    expect(ids).not.toContain('cmd.000')
    expect(ids).toContain(`cmd.${String(COMMAND_HISTORY_MAX_ENTRIES + 4).padStart(3, '0')}`)
  })

  test('recordCommandUsage 写入后自动执行容量驱逐', () => {
    const records: CommandUsageRecord[] = []
    for (let i = 0; i < COMMAND_HISTORY_MAX_ENTRIES; i++) {
      records.push(makeRecord(`cmd.${i}`, { lastUsedAt: NOW - 10 * FRECENCY_HALF_LIFE_MS }))
    }
    const full = makeHistory(...records)
    const next = recordCommandUsage(full, 'cmd.new', NOW)
    expect(Object.keys(next.records)).toHaveLength(COMMAND_HISTORY_MAX_ENTRIES)
    expect(next.records['cmd.new']).toBeDefined()
  })
})

describe('command-history/parseCommandHistory', () => {
  test('合法载荷原样解析', () => {
    const history = makeHistory(makeRecord('nav.a', { count: 3 }))
    const parsed = parseCommandHistory(JSON.parse(serializeCommandHistory(history)))
    expect(parsed).toEqual(history)
  })

  test('版本不兼容回退为空历史', () => {
    expect(parseCommandHistory({ version: 999, records: {} })).toEqual(createEmptyCommandHistory())
    expect(parseCommandHistory({ records: {} })).toEqual(createEmptyCommandHistory())
  })

  test('损坏载荷回退为空历史', () => {
    expect(parseCommandHistory(undefined)).toEqual(createEmptyCommandHistory())
    expect(parseCommandHistory(null)).toEqual(createEmptyCommandHistory())
    expect(parseCommandHistory('not-an-object')).toEqual(createEmptyCommandHistory())
    expect(parseCommandHistory({ version: COMMAND_HISTORY_STORAGE_VERSION })).toEqual(
      createEmptyCommandHistory(),
    )
    // 单条记录字段非法 → 整体回退
    expect(
      parseCommandHistory({
        version: COMMAND_HISTORY_STORAGE_VERSION,
        records: { 'nav.a': { id: 'nav.a', count: 'x', firstUsedAt: NOW, lastUsedAt: NOW } },
      }),
    ).toEqual(createEmptyCommandHistory())
  })

  test('路径分类含查询串的载荷整体作废（宁空勿留敏感数据）', () => {
    const parsed = parseCommandHistory({
      version: COMMAND_HISTORY_STORAGE_VERSION,
      records: {
        'nav.a': {
          id: 'nav.a',
          count: 1,
          firstUsedAt: NOW,
          lastUsedAt: NOW,
          lastContextPath: '/search?q=secret',
        },
      },
    })
    expect(parsed).toEqual(createEmptyCommandHistory())
  })
})

describe('command-history/scoreCommandUsage', () => {
  test('次数相同时最近使用者评分更高（MRU）', () => {
    const recent = scoreCommandUsage(makeRecord('a', { lastUsedAt: NOW }), NOW)
    const old = scoreCommandUsage(makeRecord('b', { lastUsedAt: NOW - 60_000 }), NOW)
    expect(recent).toBeGreaterThan(old)
  })

  test('每过一个半衰期 recency 分量减半', () => {
    const now = scoreCommandUsage(makeRecord('a', { count: 1, lastUsedAt: NOW }), NOW)
    const halfLifeAgo = scoreCommandUsage(
      makeRecord('a', { count: 1, lastUsedAt: NOW - FRECENCY_HALF_LIFE_MS }),
      NOW,
    )
    // frequency 分量相同（log1p(1)），差值 = recency 权重的一半
    expect(now - halfLifeAgo).toBeCloseTo(1, 5)
  })

  test('log1p 频率：高频旧命令可超过低频新命令，但收益递减', () => {
    const frequent = scoreCommandUsage(
      makeRecord('a', { count: 50, lastUsedAt: NOW - 60_000 }),
      NOW,
    )
    const singleUse = scoreCommandUsage(makeRecord('b', { count: 1, lastUsedAt: NOW }), NOW)
    expect(frequent).toBeGreaterThan(singleUse)
    // 收益递减：count 1→2 的增量大于 count 100→101
    const at1 = scoreCommandUsage(makeRecord('c', { count: 1, lastUsedAt: NOW }), NOW)
    const at2 = scoreCommandUsage(makeRecord('c', { count: 2, lastUsedAt: NOW }), NOW)
    const at100 = scoreCommandUsage(makeRecord('c', { count: 100, lastUsedAt: NOW }), NOW)
    const at101 = scoreCommandUsage(makeRecord('c', { count: 101, lastUsedAt: NOW }), NOW)
    expect(at2 - at1).toBeGreaterThan(at101 - at100)
  })

  test('未来的 lastUsedAt 不产生负 age（评分有界且确定）', () => {
    const score = scoreCommandUsage(makeRecord('a', { lastUsedAt: NOW + 999_999 }), NOW)
    expect(Number.isFinite(score)).toBe(true)
    expect(score).toBe(scoreCommandUsage(makeRecord('a', { lastUsedAt: NOW }), NOW))
  })
})

describe('command-history/rankVisibleCommandsByFrecency', () => {
  test('按 MRU 排序：次数相同时最近使用者在前', () => {
    const history = makeHistory(
      makeRecord('a', { lastUsedAt: NOW - 60_000 }),
      makeRecord('b', { lastUsedAt: NOW }),
    )
    const ranked = rankVisibleCommandsByFrecency([makeCommand('a'), makeCommand('b')], history, NOW)
    expect(ranked.map((r) => r.id)).toEqual(['b', 'a'])
  })

  test('高频旧命令排名可超过低频新命令（frequency-vs-recency）', () => {
    const history = makeHistory(
      makeRecord('frequent', { count: 50, lastUsedAt: NOW - 60_000 }),
      makeRecord('fresh', { count: 1, lastUsedAt: NOW }),
    )
    const ranked = rankVisibleCommandsByFrecency(
      [makeCommand('fresh'), makeCommand('frequent')],
      history,
      NOW,
    )
    expect(ranked[0]!.id).toBe('frequent')
  })

  test('评分与时间都相同时按传入顺序（registry/分组顺序），再按 ID 字典序', () => {
    const history = makeHistory(makeRecord('b'), makeRecord('a'), makeRecord('c'))
    // 三者评分、lastUsedAt 完全相同 → 保持传入顺序
    const ranked = rankVisibleCommandsByFrecency(
      [makeCommand('b'), makeCommand('a'), makeCommand('c')],
      history,
      NOW,
    )
    expect(ranked.map((r) => r.id)).toEqual(['b', 'a', 'c'])
    // 相同输入在不同传入顺序下：排序仍确定（由输入顺序决定，符合 design D4）
    const ranked2 = rankVisibleCommandsByFrecency(
      [makeCommand('c'), makeCommand('a'), makeCommand('b')],
      history,
      NOW,
    )
    expect(ranked2.map((r) => r.id)).toEqual(['c', 'a', 'b'])
  })

  test('无历史命令不参与推广；无历史时返回空', () => {
    expect(
      rankVisibleCommandsByFrecency(
        [makeCommand('a'), makeCommand('b')],
        createEmptyCommandHistory(),
        NOW,
      ),
    ).toEqual([])
    const history = makeHistory(makeRecord('a'))
    const ranked = rankVisibleCommandsByFrecency([makeCommand('a'), makeCommand('b')], history, NOW)
    expect(ranked.map((r) => r.id)).toEqual(['a'])
  })

  test('推广数量受上限约束', () => {
    const records: CommandUsageRecord[] = []
    const commands: RegisteredCommand[] = []
    for (let i = 0; i < COMMAND_HISTORY_PROMOTED_LIMIT + 3; i++) {
      records.push(makeRecord(`cmd.${i}`, { count: i + 1 }))
      commands.push(makeCommand(`cmd.${i}`))
    }
    const ranked = rankVisibleCommandsByFrecency(commands, makeHistory(...records), NOW)
    expect(ranked).toHaveLength(COMMAND_HISTORY_PROMOTED_LIMIT)
  })

  test('相同输入历史下排序结果确定（重复调用一致）', () => {
    const history = makeHistory(
      makeRecord('a', { count: 3, lastUsedAt: NOW - 1000 }),
      makeRecord('b', { count: 1, lastUsedAt: NOW }),
      makeRecord('c', { count: 10, lastUsedAt: NOW - 5000 }),
    )
    const commands = [makeCommand('a'), makeCommand('b'), makeCommand('c')]
    const first = rankVisibleCommandsByFrecency(commands, history, NOW)
    const second = rankVisibleCommandsByFrecency(commands, history, NOW)
    expect(first).toEqual(second)
  })

  test('不修改传入的命令数组与历史对象', () => {
    const history = makeHistory(makeRecord('a'), makeRecord('b'))
    const commands = [makeCommand('b'), makeCommand('a')]
    const commandsSnapshot = commands.map((c) => c.id)
    const historySnapshot = JSON.parse(JSON.stringify(history))
    rankVisibleCommandsByFrecency(commands, history, NOW)
    expect(commands.map((c) => c.id)).toEqual(commandsSnapshot)
    expect(history).toEqual(historySnapshot)
  })
})

describe('command-history/安全不变量：历史不得绕过可见性过滤', () => {
  /** 模拟面板的既有可见性过滤（权限 + when），再交给排名。 */
  function visibleAfterFilters(
    commands: RegisteredCommand[],
    granted: string[],
    pathname: string,
  ): RegisteredCommand[] {
    return commands.filter((cmd) => {
      if (cmd.requiresPermission?.length) {
        if (!cmd.requiresPermission.some((p) => granted.includes(p))) return false
      }
      if (cmd.when && !cmd.when({ pathname, params: {}, searchParams: new URLSearchParams() })) {
        return false
      }
      return true
    })
  }

  test('历史中有但注册表已移除的命令不被推广', () => {
    const history = makeHistory(makeRecord('nav.removed'))
    // 可见集合为空（注册表中不存在该命令）
    const ranked = rankVisibleCommandsByFrecency([], history, NOW)
    expect(ranked).toEqual([])
  })

  test('权限被拒的命令即使有历史也不被推广', () => {
    const guarded = makeCommand('ctx.admin', { requiresPermission: ['admin:all'] })
    const history = makeHistory(makeRecord('ctx.admin', { count: 99, lastUsedAt: NOW }))
    const visible = visibleAfterFilters([guarded], [], '/dashboard')
    const ranked = rankVisibleCommandsByFrecency(visible, history, NOW)
    expect(ranked).toEqual([])
  })

  test('上下文不匹配的命令即使有历史也不被推广', () => {
    const ctxCmd = makeCommand('ctx.project.new-task', {
      when: (ctx) => ctx.pathname.startsWith('/projects/'),
    })
    const history = makeHistory(makeRecord('ctx.project.new-task', { count: 99 }))
    const visible = visibleAfterFilters([ctxCmd], [], '/dashboard')
    const ranked = rankVisibleCommandsByFrecency(visible, history, NOW)
    expect(ranked).toEqual([])
  })

  test('权限恢复后历史命令可再次被推广', () => {
    const guarded = makeCommand('ctx.admin', { requiresPermission: ['admin:all'] })
    const history = makeHistory(makeRecord('ctx.admin', { count: 2 }))
    const visible = visibleAfterFilters([guarded], ['admin:all'], '/dashboard')
    const ranked = rankVisibleCommandsByFrecency(visible, history, NOW)
    expect(ranked.map((r) => r.id)).toEqual(['ctx.admin'])
  })
})
