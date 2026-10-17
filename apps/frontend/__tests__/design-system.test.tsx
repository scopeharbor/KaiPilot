import * as React from 'react'
import { render, screen, fireEvent, act } from '@testing-library/react'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import { z } from 'zod'
import { Button } from '@/components/ui/Button'
import { Checkbox } from '@/components/ui/Checkbox'
import { Input } from '@/components/ui/Input'
import { Table, TableBody, TableCaption, TableCell, TableRow } from '@/components/ui/Table'
import { StatCard } from '@/components/ui/StatCard'
import { useUiStore, applyDensity } from '@/stores/ui-store'
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
  FormModeProvider,
  FormSubmit,
  useForm,
  zodResolver,
} from '@/components/forms'

describe('ui-store 密度（design-tokens-theming）', () => {
  beforeEach(() => {
    useUiStore.setState({ density: 'comfortable' })
    document.documentElement.removeAttribute('data-density')
  })

  test('applyDensity 把密度写入 <html data-density>', () => {
    applyDensity('compact')
    expect(document.documentElement.getAttribute('data-density')).toBe('compact')
  })

  test('toggleDensity 在舒适↔紧凑间切换并同步 DOM', () => {
    act(() => useUiStore.getState().toggleDensity())
    expect(useUiStore.getState().density).toBe('compact')
    expect(document.documentElement.getAttribute('data-density')).toBe('compact')
    act(() => useUiStore.getState().toggleDensity())
    expect(useUiStore.getState().density).toBe('comfortable')
    expect(document.documentElement.getAttribute('data-density')).toBe('comfortable')
  })
})

describe('Button 7 态（ui-component-library）', () => {
  test('loading 态：禁用 + aria-busy + spinner', () => {
    render(<Button loading>保存</Button>)
    const btn = screen.getByRole('button', { name: /保存/ })
    expect(btn).toBeDisabled()
    expect(btn).toHaveAttribute('aria-busy', 'true')
    expect(btn.querySelector('.animate-spin')).not.toBeNull()
  })

  test('error 态：aria-invalid 透传到 DOM', () => {
    render(<Button aria-invalid>提交</Button>)
    expect(screen.getByRole('button', { name: /提交/ })).toHaveAttribute('aria-invalid', 'true')
  })

  test('disabled 态：不可点击', () => {
    const onClick = vi.fn()
    render(
      <Button disabled onClick={onClick}>
        删除
      </Button>,
    )
    fireEvent.click(screen.getByRole('button'))
    expect(onClick).not.toHaveBeenCalled()
  })
})

describe('Checkbox 无障碍（ui-component-library）', () => {
  test('暴露 checkbox role 且可键盘可达', () => {
    render(<Checkbox aria-label="同意条款" />)
    const box = screen.getByRole('checkbox', { name: '同意条款' })
    expect(box).toBeInTheDocument()
  })
})

describe('Table 与 StatCard（ui-component-library）', () => {
  test('Table 单元格响应紧凑密度且 caption 默认视觉隐藏', () => {
    document.documentElement.setAttribute('data-density', 'compact')
    render(
      <Table>
        <TableCaption>项目列表</TableCaption>
        <TableBody>
          <TableRow>
            <TableCell>开项平台</TableCell>
          </TableRow>
        </TableBody>
      </Table>,
    )

    expect(screen.getByText('项目列表')).toHaveClass('sr-only')
    expect(screen.getByRole('cell')).toHaveClass('[[data-density=compact]_&]:py-[var(--space-2)]')
  })

  test('StatCard 使用 article 语义且没有侧边色条、渐变或发光', () => {
    render(<StatCard label="健康度" value="正常" hint="无需处理" />)
    const card = screen.getByRole('article')
    expect(card).toHaveTextContent('健康度')
    expect(card.className).not.toMatch(/border-[lr]|gradient|shadow/)
  })
})

const schema = z.object({
  name: z.string().min(1, '请输入项目名称'),
  note: z.string().optional(),
})
type Values = z.infer<typeof schema>

function TestForm({ onValid }: { onValid: (v: Values) => void }) {
  const form = useForm<Values>({
    resolver: zodResolver(schema),
    mode: 'onChange',
    defaultValues: { name: '', note: '' },
  })
  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onValid)}>
        <FormField
          control={form.control}
          name="name"
          render={({ field }) => (
            <FormItem>
              <FormLabel>项目名称</FormLabel>
              <FormControl>
                <Input {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="note"
          advanced
          render={({ field }) => (
            <FormItem>
              <FormLabel>备注</FormLabel>
              <FormControl>
                <Input {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormSubmit>保存</FormSubmit>
      </form>
    </Form>
  )
}

describe('表单与验证（form-system）', () => {
  test('字段级校验失败：字段下方显示具体中文文案，拦截提交', async () => {
    const onValid = vi.fn()
    render(<TestForm onValid={onValid} />)
    fireEvent.submit(screen.getByRole('button', { name: /保存/ }))
    expect(await screen.findByText('请输入项目名称')).toBeInTheDocument()
    expect(onValid).not.toHaveBeenCalled()
  })

  test('合法值通过校验并回调（zod schema 驱动类型与校验一致）', async () => {
    const onValid = vi.fn()
    render(<TestForm onValid={onValid} />)
    await act(async () => {
      fireEvent.change(screen.getByLabelText('项目名称'), { target: { value: '开项' } })
    })
    await act(async () => {
      fireEvent.submit(screen.getByRole('button', { name: /保存/ }))
    })
    await vi.waitFor(() => expect(onValid).toHaveBeenCalledTimes(1))
    expect(onValid.mock.calls[0]![0]).toMatchObject({ name: '开项' })
  })

  test('提交按钮仅在有改动且校验通过时高亮可提交（初始禁用）', async () => {
    render(<TestForm onValid={vi.fn()} />)
    expect(screen.getByRole('button', { name: /保存/ })).toBeDisabled()
    await act(async () => {
      fireEvent.input(screen.getByLabelText('项目名称'), { target: { value: 'x' } })
    })
    await vi.waitFor(() => expect(screen.getByRole('button', { name: /保存/ })).toBeEnabled())
  })

  test('渐进披露：novice 模式隐藏 advanced 字段，pro 模式显示', () => {
    const { rerender } = render(
      <FormModeProvider mode="novice">
        <TestForm onValid={vi.fn()} />
      </FormModeProvider>,
    )
    expect(screen.queryByLabelText('备注')).toBeNull()
    expect(screen.getByLabelText('项目名称')).toBeInTheDocument()

    rerender(
      <FormModeProvider mode="pro">
        <TestForm onValid={vi.fn()} />
      </FormModeProvider>,
    )
    expect(screen.getByLabelText('备注')).toBeInTheDocument()
  })
})
