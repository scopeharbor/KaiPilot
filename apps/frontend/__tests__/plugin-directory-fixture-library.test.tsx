import * as React from 'react'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { PluginDirectoryWorkbench } from '@/components/plugin-registry/PluginDirectoryWorkbench'

/**
 * v3-plugin-fixture-market-seed —— 示例库来源标记与入口门禁测试（task 4.2）。
 *
 * 覆盖四组断言：
 * - **用户可见文案禁词**：目录面不得出现公开市场/评分/计费/分成/第三方承诺词汇；
 * - **权限隐藏 + 入口门禁**：production 构建下来源筛选、说明与徽章全部不注册（不可达）；
 * - **可访问性**：筛选控件有 aria-label，说明块以 role="note" 可达，键盘可操作；
 * - **主题/密度**：只用语义 token（border-border / var(--radius-sm) / text-muted-foreground），
 *   源码中不得出现硬编码色值。
 */

const hookMocks = vi.hoisted(() => ({
  useDirectoryReleases: vi.fn(),
  useDirectoryReleaseDetail: vi.fn(),
  useAffectedInstallations: vi.fn(),
}))

vi.mock('@/hooks/use-plugin-directory', () => hookMocks)

const WORKBENCH_SOURCE_PATH = resolve(
  __dirname,
  '../components/plugin-registry/PluginDirectoryWorkbench.tsx',
)

const fixtureRelease = {
  releaseId: '11',
  pluginIdentity: 'com.aiproj.canary-query',
  version: '1.0.0',
  status: 'approved' as const,
  createdAt: '2026-08-24T00:00:00Z',
  compatibilityAllowed: true,
  activeInstallationCount: 1,
  uninstalledInstallationCount: 0,
  fixtureOnly: true,
}

const organicRelease = {
  ...fixtureRelease,
  releaseId: '12',
  pluginIdentity: 'com.example.inhouse',
  fixtureOnly: false,
}

function makeListResult(items: unknown[]) {
  return {
    data: { data: items, meta: { total: items.length, page: 1, perPage: 20, totalPages: 1 } },
    isLoading: false,
    error: null,
    isStale: false,
    isFetching: false,
    dataUpdatedAt: 1,
    refetch: vi.fn(),
  }
}

describe('组织私有目录的示例库来源标记（v3-plugin-fixture-market-seed 4.1/4.2）', () => {
  beforeEach(() => {
    hookMocks.useDirectoryReleases.mockReturnValue(makeListResult([fixtureRelease, organicRelease]))
    hookMocks.useDirectoryReleaseDetail.mockReturnValue({
      data: null,
      isLoading: false,
      error: null,
    })
    hookMocks.useAffectedInstallations.mockReturnValue({
      data: null,
      isLoading: false,
      error: null,
    })
  })

  afterEach(() => {
    vi.unstubAllEnvs()
    vi.clearAllMocks()
  })

  // ── 徽章与筛选 ────────────────────────────────────────────────────────
  it('只给 seed 写入的版本打「示例数据」徽章，自建版本不打', () => {
    render(<PluginDirectoryWorkbench />)
    const badges = screen.getAllByText('示例数据')
    expect(badges).toHaveLength(1)
    expect(badges[0]).toHaveAttribute('title', expect.stringContaining('不是真实业务数据'))
  })

  it('来源筛选把 fixtureOnly 传给查询：仅示例数据 -> true，排除 -> false，全部 -> 不带参数', () => {
    render(<PluginDirectoryWorkbench />)
    expect(hookMocks.useDirectoryReleases).toHaveBeenLastCalledWith(
      expect.not.objectContaining({ fixtureOnly: expect.anything() }),
    )

    const select = screen.getByLabelText('按来源筛选')
    fireEvent.change(select, { target: { value: 'only' } })
    expect(hookMocks.useDirectoryReleases).toHaveBeenLastCalledWith(
      expect.objectContaining({ fixtureOnly: true }),
    )

    fireEvent.change(select, { target: { value: 'exclude' } })
    expect(hookMocks.useDirectoryReleases).toHaveBeenLastCalledWith(
      expect.objectContaining({ fixtureOnly: false }),
    )

    fireEvent.change(select, { target: { value: '' } })
    expect(hookMocks.useDirectoryReleases).toHaveBeenLastCalledWith(
      expect.not.objectContaining({ fixtureOnly: expect.anything() }),
    )
  })

  it('明确声明离线与非生产边界，且不承诺任何外部服务', () => {
    render(<PluginDirectoryWorkbench />)
    const note = screen.getByLabelText('示例数据说明')
    expect(note).toHaveAttribute('role', 'note')
    expect(note.textContent).toContain('离线')
    expect(note.textContent).toContain('不连接任何外部服务')
    expect(note.textContent).toContain('不会出现在生产环境')
  })

  // ── production 入口不注册（bundle/route 不可达） ──────────────────────
  it('production 构建下来源筛选、说明与徽章全部不注册', async () => {
    vi.resetModules()
    vi.stubEnv('NODE_ENV', 'production')
    const mod = await import('@/components/plugin-registry/PluginDirectoryWorkbench')
    render(<mod.PluginDirectoryWorkbench />)

    expect(screen.queryByLabelText('按来源筛选')).toBeNull()
    expect(screen.queryByLabelText('示例数据说明')).toBeNull()
    expect(screen.queryByText('示例数据')).toBeNull()
    // 目录本身仍然正常渲染——被摘除的只是示例库入口
    expect(screen.getByLabelText('目录版本列表')).toBeInTheDocument()
  })

  it('入口以 NODE_ENV 常量静态门禁，保证 production bundle 可被静态消除', () => {
    const source = readFileSync(WORKBENCH_SOURCE_PATH, 'utf8')
    expect(source).toContain(
      "const FIXTURE_LIBRARY_ENTRY_ENABLED = process.env.NODE_ENV !== 'production'",
    )
    // 门禁只有一处定义，其余位置一律引用它（不得出现第二套判定）；注释行不计入
    const codeLines = source
      .split('\n')
      .filter((line) => !/^\s*(\/\/|\*|\/\*)/.test(line))
      .join('\n')
    expect(codeLines.match(/process\.env\.NODE_ENV/g) ?? []).toHaveLength(1)
  })

  // ── 用户可见文案禁词 ──────────────────────────────────────────────────
  it('用户可见文案不含公开市场、评分、计费、分成或第三方承诺词汇', () => {
    const { container } = render(<PluginDirectoryWorkbench />)
    const visibleText = container.textContent ?? ''
    const forbidden = [
      '上架',
      '下架',
      '市场',
      '商店',
      '评分',
      '评论',
      '计费',
      '订阅',
      '分成',
      '付费',
      '第三方',
    ]
    for (const word of forbidden) {
      expect(visibleText).not.toContain(word)
    }
    // 正面表述：能力名义始终是组织私有目录
    expect(visibleText).toContain('组织私有插件目录')
  })

  // ── 可访问性与主题/密度 ───────────────────────────────────────────────
  it('筛选控件可命名、可键盘聚焦，且与状态/排序控件同级可达', () => {
    render(<PluginDirectoryWorkbench />)
    const select = screen.getByLabelText('按来源筛选') as HTMLSelectElement
    select.focus()
    expect(document.activeElement).toBe(select)
    expect(screen.getByLabelText('按状态筛选')).toBeInTheDocument()
    expect(screen.getByLabelText('排序方式')).toBeInTheDocument()
    expect(select.tagName).toBe('SELECT')
  })

  it('示例库相关样式只用语义 token，源码中无硬编码色值', () => {
    const source = readFileSync(WORKBENCH_SOURCE_PATH, 'utf8')
    expect(source).not.toMatch(/#[0-9a-fA-F]{3,8}\b/)
    expect(source).not.toMatch(/\brgb\(|\bhsl\(/)
    expect(source).toContain('border-border')
    expect(source).toContain('var(--radius-sm)')
    expect(source).toContain('text-muted-foreground')
  })
})
