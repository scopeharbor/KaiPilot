import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import {
  COMMAND_HISTORY_STORAGE_KEY,
  useCommandHistoryStore,
} from '@/lib/command-registry/history-store'
import { COMMAND_HISTORY_STORAGE_VERSION } from '@/lib/command-registry/history'

function seedStorage(payload: unknown) {
  window.localStorage.setItem(
    COMMAND_HISTORY_STORAGE_KEY,
    typeof payload === 'string' ? payload : JSON.stringify(payload),
  )
}

function readPersisted(): { state: { history: unknown }; version: number } {
  const raw = window.localStorage.getItem(COMMAND_HISTORY_STORAGE_KEY)
  expect(raw).not.toBeNull()
  return JSON.parse(raw!)
}

beforeEach(() => {
  window.localStorage.clear()
  useCommandHistoryStore.getState().reset()
})

afterEach(() => {
  vi.restoreAllMocks()
  window.localStorage.clear()
  useCommandHistoryStore.getState().reset()
})

describe('command-history-store/持久化', () => {
  test('recordUsage 更新内存态并写入 localStorage', () => {
    useCommandHistoryStore.getState().recordUsage('nav./projects')
    const rec = useCommandHistoryStore.getState().history.records['nav./projects']
    expect(rec).toBeDefined()
    expect(rec!.count).toBe(1)
    const persisted = readPersisted()
    expect(persisted.version).toBe(COMMAND_HISTORY_STORAGE_VERSION)
    const history = persisted.state.history as { records: Record<string, { count: number }> }
    expect(history.records['nav./projects']!.count).toBe(1)
  })

  test('水合：合法持久化载荷恢复到内存态', async () => {
    seedStorage({
      state: {
        history: {
          version: COMMAND_HISTORY_STORAGE_VERSION,
          records: {
            'theme.dark': { id: 'theme.dark', count: 3, firstUsedAt: 1000, lastUsedAt: 2000 },
          },
        },
      },
      version: COMMAND_HISTORY_STORAGE_VERSION,
    })
    await useCommandHistoryStore.persist.rehydrate()
    const rec = useCommandHistoryStore.getState().history.records['theme.dark']
    expect(rec).toEqual({ id: 'theme.dark', count: 3, firstUsedAt: 1000, lastUsedAt: 2000 })
  })

  test('损坏 JSON 载荷：忽略并回退空历史，不抛错', async () => {
    seedStorage('not-json{{{')
    await expect(useCommandHistoryStore.persist.rehydrate()).resolves.toBeUndefined()
    expect(useCommandHistoryStore.getState().history.records).toEqual({})
  })

  test('版本不兼容载荷：回退空历史', async () => {
    seedStorage({
      state: {
        history: {
          version: 999,
          records: { a: { id: 'a', count: 1, firstUsedAt: 1, lastUsedAt: 1 } },
        },
      },
      version: 999,
    })
    await useCommandHistoryStore.persist.rehydrate()
    expect(useCommandHistoryStore.getState().history.records).toEqual({})
  })

  test('记录形态损坏的载荷：回退空历史', async () => {
    seedStorage({
      state: {
        history: {
          version: COMMAND_HISTORY_STORAGE_VERSION,
          records: { a: { id: 'a', count: 'oops' } },
        },
      },
      version: COMMAND_HISTORY_STORAGE_VERSION,
    })
    await useCommandHistoryStore.persist.rehydrate()
    expect(useCommandHistoryStore.getState().history.records).toEqual({})
  })

  test('localStorage 不可用：内存态仍可记录，不抛错', async () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('denied')
    })
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('denied')
    })
    await expect(useCommandHistoryStore.persist.rehydrate()).resolves.toBeUndefined()
    expect(() => useCommandHistoryStore.getState().recordUsage('nav.a')).not.toThrow()
    expect(useCommandHistoryStore.getState().history.records['nav.a']).toBeDefined()
  })

  test('reset 清空内存态并覆写持久化载荷', () => {
    useCommandHistoryStore.getState().recordUsage('nav.a')
    useCommandHistoryStore.getState().reset()
    expect(useCommandHistoryStore.getState().history.records).toEqual({})
    const persisted = readPersisted()
    expect((persisted.state.history as { records: unknown }).records).toEqual({})
  })

  test('pruneStale 清理失效命令记录', () => {
    useCommandHistoryStore.getState().recordUsage('nav.a')
    useCommandHistoryStore.getState().recordUsage('nav.gone')
    useCommandHistoryStore.getState().pruneStale(new Set(['nav.a']))
    expect(Object.keys(useCommandHistoryStore.getState().history.records)).toEqual(['nav.a'])
  })
})

describe('command-history-store/低敏边界', () => {
  test('持久化载荷只含低敏字段，不含搜索原文与业务标题', () => {
    useCommandHistoryStore.getState().recordUsage('nav./projects')
    useCommandHistoryStore.getState().recordUsage('theme.dark', '/settings')
    // 含查询串的路径不写入
    useCommandHistoryStore.getState().recordUsage('nav./search', '/search?q=机密关键词')

    const raw = window.localStorage.getItem(COMMAND_HISTORY_STORAGE_KEY)!
    expect(raw).not.toContain('机密关键词')
    expect(raw).not.toContain('q=')

    const persisted = JSON.parse(raw)
    expect(Object.keys(persisted).sort()).toEqual(['state', 'version'])
    expect(Object.keys(persisted.state)).toEqual(['history'])
    expect(Object.keys(persisted.state.history).sort()).toEqual(['records', 'version'])
    const allowedRecordKeys = ['count', 'firstUsedAt', 'id', 'lastContextPath', 'lastUsedAt']
    for (const record of Object.values(persisted.state.history.records) as Array<
      Record<string, unknown>
    >) {
      for (const key of Object.keys(record)) {
        expect(allowedRecordKeys).toContain(key)
      }
      // 命令 ID 是稳定标识，不是标签/标题/关键词
      expect(typeof record.id).toBe('string')
    }
  })
})
