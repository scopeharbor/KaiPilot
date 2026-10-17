import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { Plus } from 'lucide-react'
import { useCommandRegistryStore } from '@/lib/command-registry/store'
import { registerStaticCommands } from '@/lib/command-registry/register'
import { useRegisterCommands } from '@/lib/command-registry/use-register-commands'
import type { RegisteredCommand } from '@/lib/command-registry/types'

function makeCommand(id: string, label = id): RegisteredCommand {
  return {
    id,
    label,
    icon: Plus,
    group: 'contextual',
    effect: 'open-form',
    execute: () => {},
  }
}

beforeEach(() => {
  useCommandRegistryStore.getState().clear()
})

afterEach(() => {
  useCommandRegistryStore.getState().clear()
})

describe('command-registry/store', () => {
  test('addCommands 注册后 getAllCommands 返回', () => {
    useCommandRegistryStore.getState().addCommands([makeCommand('a'), makeCommand('b')])
    expect(useCommandRegistryStore.getState().getAllCommands()).toHaveLength(2)
  })

  test('重复 ID 被拒绝（不静默覆盖）', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const first = makeCommand('dup', '第一')
    const second = makeCommand('dup', '第二')
    useCommandRegistryStore.getState().addCommands([first, second])
    const all = useCommandRegistryStore.getState().getAllCommands()
    expect(all).toHaveLength(1)
    expect(all[0]!.label).toBe('第一') // 后注册者被拒绝
    expect(spy).toHaveBeenCalledWith(expect.stringContaining('dup'))
    spy.mockRestore()
  })

  test('removeCommands 按 ID 注销且忽略不存在的 ID', () => {
    useCommandRegistryStore.getState().addCommands([makeCommand('a'), makeCommand('b')])
    useCommandRegistryStore.getState().removeCommands(['a', '不存在的'])
    const all = useCommandRegistryStore.getState().getAllCommands()
    expect(all).toHaveLength(1)
    expect(all[0]!.id).toBe('b')
  })

  test('批量 add 空 数组无副作用', () => {
    useCommandRegistryStore.getState().addCommands([])
    expect(useCommandRegistryStore.getState().getAllCommands()).toHaveLength(0)
  })

  test('clear 清空注册表', () => {
    useCommandRegistryStore.getState().addCommands([makeCommand('a')])
    useCommandRegistryStore.getState().clear()
    expect(useCommandRegistryStore.getState().getAllCommands()).toHaveLength(0)
  })
})

describe('command-registry/register', () => {
  test('registerStaticCommands 在客户端注册命令', () => {
    registerStaticCommands([makeCommand('nav.x')])
    expect(useCommandRegistryStore.getState().getAllCommands()).toHaveLength(1)
  })

  test('registerStaticCommands 空数组不注册', () => {
    registerStaticCommands([])
    expect(useCommandRegistryStore.getState().getAllCommands()).toHaveLength(0)
  })

  test('registerStaticCommands 幂等：重复注册同 ID 不产生重复', () => {
    registerStaticCommands([makeCommand('nav.x')])
    registerStaticCommands([makeCommand('nav.x')])
    expect(useCommandRegistryStore.getState().getAllCommands()).toHaveLength(1)
  })
})

describe('command-registry/useRegisterCommands', () => {
  test('挂载时注册、卸载时注销', () => {
    const { unmount } = renderHook(() => useRegisterCommands([makeCommand('ctx.a')]))
    expect(useCommandRegistryStore.getState().getAllCommands()).toHaveLength(1)

    unmount()
    expect(useCommandRegistryStore.getState().getAllCommands()).toHaveLength(0)
  })

  test('Strict Mode 双调用幂等（mount→unmount→mount 只留一份）', () => {
    // renderHook 已启用 Strict Mode（setup 由 React Testing Library 默认带 StrictMode）
    const { unmount, rerender } = renderHook(() => useRegisterCommands([makeCommand('ctx.strict')]))
    // 触发一次重渲染，模拟 effect 重新执行
    rerender()
    const count = useCommandRegistryStore
      .getState()
      .getAllCommands()
      .filter((c) => c.id === 'ctx.strict').length
    expect(count).toBe(1)

    unmount()
    expect(useCommandRegistryStore.getState().getAllCommands()).toHaveLength(0)
  })

  test('deps 变化时先注销旧命令再注册新命令', () => {
    const { rerender } = renderHook(({ id }) => useRegisterCommands([makeCommand(id)], [id]), {
      initialProps: { id: 'ctx.1' },
    })
    expect(
      useCommandRegistryStore
        .getState()
        .getAllCommands()
        .map((c) => c.id),
    ).toEqual(['ctx.1'])

    act(() => {
      rerender({ id: 'ctx.2' })
    })
    expect(
      useCommandRegistryStore
        .getState()
        .getAllCommands()
        .map((c) => c.id),
    ).toEqual(['ctx.2'])
  })

  test('工厂函数形式：每次 deps 变化重新求值', () => {
    let label = 'A'
    const { rerender } = renderHook(() =>
      useRegisterCommands(() => [makeCommand('ctx.f', label)], [label]),
    )
    expect(useCommandRegistryStore.getState().getAllCommands()[0]!.label).toBe('A')

    label = 'B'
    act(() => rerender())
    expect(useCommandRegistryStore.getState().getAllCommands()[0]!.label).toBe('B')
  })
})
