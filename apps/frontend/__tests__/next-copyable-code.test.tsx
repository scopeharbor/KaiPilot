import * as React from 'react'
import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { CopyableCode } from '@/components/next/common/CopyableCode'

afterEach(() => {
  vi.useRealTimers()
})

describe('CopyableCode', () => {
  test('点击复制编号（不含显示前缀），短暂显示「已复制」且不冒泡', async () => {
    vi.useFakeTimers()
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.assign(navigator, { clipboard: { writeText } })
    const outer = vi.fn()
    render(
      <div onClick={outer}>
        <CopyableCode code="PROJ-5#128" prefix="#" />
      </div>,
    )
    const button = screen.getByRole('button', { name: '复制编号 PROJ-5#128' })
    expect(button.textContent).toBe('#PROJ-5#128')
    await act(async () => {
      fireEvent.click(button)
    })
    expect(writeText).toHaveBeenCalledWith('PROJ-5#128')
    expect(outer).not.toHaveBeenCalled()
    expect(button.textContent).toBe('已复制')
    act(() => {
      vi.advanceTimersByTime(1300)
    })
    expect(button.textContent).toBe('#PROJ-5#128')
  })
})
