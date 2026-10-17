/**
 * 日历与曆法设定：有序多选编辑器、三层继承起点、保存调用。
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import type { CalendarDisplayResolution } from '@aiproj/types'
import { CalendarSystemsEditor } from '@/components/next/settings/calendar/CalendarSystemsEditor'
import { CalendarDisplayWorkspace } from '@/components/next/settings/calendar/CalendarDisplayWorkspace'

const api = vi.hoisted(() => ({ get: vi.fn(), update: vi.fn() }))
vi.mock('@/lib/api/calendar-display', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api/calendar-display')>()
  return { ...actual, calendarDisplayApi: api }
})
vi.mock('@/lib/api/projects', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api/projects')>()
  return {
    ...actual,
    projectsApi: {
      ...actual.projectsApi,
      list: vi.fn(async () => ({
        data: [{ id: 5, name: '中东项目', code: 'ME' }],
        meta: { total: 1, page: 1, perPage: 100, totalPages: 1 },
      })),
    },
  }
})

function renderWithClient(ui: React.ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>)
}

beforeEach(() => {
  api.get.mockReset()
  api.update.mockReset()
})

describe('CalendarSystemsEditor', () => {
  test('调顺序后第一个可当主曆的成为主曆，保存传出有序列表', () => {
    const onSave = vi.fn()
    const { container } = render(
      <CalendarSystemsEditor
        value={null}
        inherited={['solar', 'lunar', 'holiday']}
        onSave={onSave}
        inheritLabel="清除"
        today="2026-10-01"
      />,
    )
    expect(
      container.querySelector('[data-primary="true"]')?.getAttribute('data-calendar-system'),
    ).toBe('solar')
    fireEvent.click(screen.getByRole('button', { name: '上移 农历' }))
    expect(
      container.querySelector('[data-primary="true"]')?.getAttribute('data-calendar-system'),
    ).toBe('lunar')
    fireEvent.click(container.querySelector('[data-calendar-system-add="hijri"]')!)
    fireEvent.click(container.querySelector('[data-calendar-systems-save]')!)
    expect(onSave).toHaveBeenCalledWith(['lunar', 'solar', 'holiday', 'hijri'])
    // 预览：农历为主时大数字是农历日
    expect(
      within(container.querySelector('[data-calendar-systems-preview]')! as HTMLElement).getByText(
        '廿一',
      ),
    ).toBeTruthy()
  })

  test('有本层设定时可清除（改为继承）；禁用时不可保存', () => {
    const onSave = vi.fn()
    const { container, rerender } = render(
      <CalendarSystemsEditor
        value={['hijri']}
        inherited={['solar']}
        onSave={onSave}
        inheritLabel="清除项目设定"
      />,
    )
    fireEvent.click(container.querySelector('[data-calendar-systems-inherit]')!)
    expect(onSave).toHaveBeenCalledWith(null)
    rerender(
      <CalendarSystemsEditor
        value={['hijri']}
        inherited={['solar']}
        onSave={onSave}
        inheritLabel="清除"
        disabled
      />,
    )
    expect(container.querySelector('[data-calendar-systems-save]')).toBeDisabled()
  })
})

describe('CalendarDisplayWorkspace', () => {
  const resolution: CalendarDisplayResolution = {
    systems: ['lunar', 'solar'],
    primary: 'lunar',
    source: 'personal',
    layers: { personal: ['lunar', 'solar'], project: null, organization: ['solar', 'holiday'] },
    editable: { personal: true, project: true, organization: false },
  }

  test('生效来源、各层继承起点正确；组织层无权限只读', async () => {
    api.get.mockResolvedValue(resolution)
    const { container } = renderWithClient(<CalendarDisplayWorkspace initialProjectId={5} />)
    await screen.findByText(/现在生效/)
    expect(container.querySelector('[data-calendar-display-effective]')?.textContent).toContain(
      '个人设定',
    )
    // 项目层未设定：起点是组织设定，而不是个人设定
    const project = container.querySelector('[data-calendar-layer="project"]')!
    expect(
      Array.from(project.querySelectorAll('[data-calendar-system]')).map((node) =>
        node.getAttribute('data-calendar-system'),
      ),
    ).toEqual(['solar', 'holiday'])
    const org = container.querySelector('[data-calendar-layer="organization"]')!
    expect(org.querySelector('[data-calendar-systems-save]')).toBeDisabled()
    expect(org.textContent).toContain('需要组织管理权限')
  })

  test('保存个人层调用 API 并提示新的生效设定', async () => {
    api.get.mockResolvedValue(resolution)
    api.update.mockResolvedValue({ ...resolution, systems: ['solar', 'lunar'], primary: 'solar' })
    const { container } = renderWithClient(<CalendarDisplayWorkspace initialProjectId={5} />)
    await screen.findByText(/现在生效/)
    const personal = container.querySelector('[data-calendar-layer="personal"]')! as HTMLElement
    fireEvent.click(within(personal).getByRole('button', { name: '上移 公历（西历）' }))
    fireEvent.click(personal.querySelector('[data-calendar-systems-save]')!)
    await waitFor(() =>
      expect(api.update).toHaveBeenCalledWith({
        layer: 'personal',
        systems: ['solar', 'lunar'],
        projectId: 5,
      }),
    )
  })
})
