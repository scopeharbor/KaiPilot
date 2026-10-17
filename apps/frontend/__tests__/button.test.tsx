import { expect, test } from 'vitest'
import { render, screen } from '@testing-library/react'
import { Button } from '@/components/ui/Button'

/**
 * Button 回归（fix-v1-runtime-bugs tasks 1.2）。
 *
 * 根因：asChild 时把 `loading && !asChild ? … : null` 求得的 `null` 与 children 一并传给
 * Radix Slot，Slot（1.3.0 起严格化）因收到「非单一有效元素」抛
 * `Slot failed to slot onto its children`，使整页崩溃（任务批量管理页）。
 */

test('asChild 包裹链接：不崩溃且只透传唯一子元素', () => {
  // 渲染若触发 Slot 抛错会直接让本用例失败，等价于回归护栏。
  expect(() =>
    render(
      <Button asChild>
        <a href="/projects/1/tasks/recycle-bin">打开回收站</a>
      </Button>,
    ),
  ).not.toThrow()

  const link = screen.getByRole('link', { name: '打开回收站' })
  expect(link).toHaveAttribute('href', '/projects/1/tasks/recycle-bin')
  // Slot 把样式合并到唯一子元素：按钮样式类落在 <a> 上，且没有额外包裹 <button>。
  expect(link.className).toContain('inline-flex')
  expect(screen.queryByRole('button')).toBeNull()
})

test('非 asChild 的 loading：渲染指示器并禁用', () => {
  render(<Button loading>保存</Button>)
  const button = screen.getByRole('button', { name: '保存' })
  expect(button).toBeDisabled()
  expect(button).toHaveAttribute('aria-busy', 'true')
  // Loader2 以 svg 呈现（aria-hidden），断言其存在。
  expect(button.querySelector('svg')).not.toBeNull()
})
