import { beforeEach, describe, expect, test, vi } from 'vitest'
import { NEXT_TRACK_STORAGE_KEY, useNextTrackStore } from '@/stores/next-track-store'

beforeEach(() => {
  // 先回内存默认值（persist 会同步写回存储），再清存储：两端都回到新鲜状态。
  useNextTrackStore.getState().reset()
  localStorage.clear()
})

describe('stores/next-track-store（v3-ui-next-track-foundation D-b）', () => {
  test('首次加载默认 legacy 轨，immersionTier 与 source 为 null', () => {
    const s = useNextTrackStore.getState()
    expect(s.track).toBe('legacy')
    expect(s.immersionTier).toBeNull()
    expect(s.source).toBeNull()
  })

  test('setTrack 显式写入轨道并记录来源', () => {
    useNextTrackStore.getState().setTrack('next', 'topbar_button')
    const s = useNextTrackStore.getState()
    expect(s.track).toBe('next')
    expect(s.source).toBe('topbar_button')
  })

  test('setTrack 不带 source 时 source 清空', () => {
    useNextTrackStore.getState().setTrack('next', 'shell_switch')
    useNextTrackStore.getState().setTrack('legacy')
    const s = useNextTrackStore.getState()
    expect(s.track).toBe('legacy')
    expect(s.source).toBeNull()
  })

  test('setImmersionTier 支持写入与清除（null = 恢复系统合成）', () => {
    useNextTrackStore.getState().setImmersionTier('light')
    expect(useNextTrackStore.getState().immersionTier).toBe('light')
    useNextTrackStore.getState().setImmersionTier(null)
    expect(useNextTrackStore.getState().immersionTier).toBeNull()
  })

  test('跨会话恢复：模块重载后从 localStorage 恢复 track 与 immersionTier，source 不落盘', async () => {
    // 上一次会话：写入偏好并持久化。
    const { useNextTrackStore: first } = await import('@/stores/next-track-store')
    first.getState().setTrack('next', 'next_login')
    first.getState().setImmersionTier('light')

    // 模拟关闭浏览器后重新打开：模块重载，新 store 从 localStorage 同步水合。
    vi.resetModules()
    const { useNextTrackStore: second } = await import('@/stores/next-track-store')

    const s = second.getState()
    expect(s.track).toBe('next')
    expect(s.immersionTier).toBe('light')
    expect(s.source).toBeNull()
  })

  test('reset 恢复全部默认值', () => {
    useNextTrackStore.getState().setTrack('next', 'next_login')
    useNextTrackStore.getState().setImmersionTier('precise')
    useNextTrackStore.getState().reset()
    const s = useNextTrackStore.getState()
    expect(s.track).toBe('legacy')
    expect(s.immersionTier).toBeNull()
    expect(s.source).toBeNull()
  })

  test('持久化契约：localStorage 只含 track 与 immersionTier', () => {
    expect(NEXT_TRACK_STORAGE_KEY).toBe('aiproj-next-track')
    useNextTrackStore.getState().setTrack('next', 'topbar_button')
    useNextTrackStore.getState().setImmersionTier('precise')

    const raw = localStorage.getItem(NEXT_TRACK_STORAGE_KEY)
    expect(raw).toBeTruthy()
    const parsed = JSON.parse(raw!) as { state: Record<string, unknown> }
    expect(parsed.state.track).toBe('next')
    expect(parsed.state.immersionTier).toBe('precise')
    expect('source' in parsed.state).toBe(false)
  })
})
