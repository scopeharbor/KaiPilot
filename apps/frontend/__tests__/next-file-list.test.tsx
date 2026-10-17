/**
 * v3-ui-next-resource-team-domains W3 · tasks 3.4 —— 文件附件底册列表测试
 * （FileAttachmentList 组件级，真实全局 fetch 伪后端）。
 *
 * 覆盖（design §4.1/§4.3 与 spec 场景）：
 * - 附件底册渲染：语义类型图标（PDF/Word/Excel/PPT/图片/压缩包/代码/通用）、
 *   格式化大小、上传者姓名/邮箱、版本号 v1/v2 与上传时间；
 * - 文件名不区分大小写模糊搜索 + 文件大类 Tab（文档/表格/图片/压缩包）即时收敛；
 * - 安全下载：下载入口 href 指向受控端点 /projects/:id/attachments/:id/download；
 * - 受控删除：删除 → 二次确认弹窗（文案含「文件删除后不可恢复」）→ 确认后触发
 *   DELETE 并从列表移除；取消零请求；
 * - 无 file:manage：删除入口物理隐藏，仅保留下载（RL-06）；
 * - 空态 / 错误重试三态。
 */
import * as React from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { FileAttachmentList } from '@/components/next/files/FileAttachmentList'
import type { Attachment } from '@/lib/api/files'

// ---------------------------------------------------------------------------
// 伪后端（GET /projects/42/attachments + DELETE .../attachments/:id）
// ---------------------------------------------------------------------------
const API_PREFIX = 'http://localhost:3333/api/v1'

interface RequestRecord {
  method: string
  url: string
  body: Record<string, unknown> | null
}

function jsonResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: String(status),
    json: async () => body,
  } as Response
}

function makeFetchRecorder(
  route: (path: string, method: string) => Response | Promise<Response> | null,
): { records: RequestRecord[] } {
  const records: RequestRecord[] = []
  const fetchMock: typeof fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const rawUrl = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    const method = (init?.method ?? 'GET').toUpperCase()
    let body: Record<string, unknown> | null = null
    if (typeof init?.body === 'string') {
      try {
        body = JSON.parse(init.body) as Record<string, unknown>
      } catch {
        body = null
      }
    }
    const path = rawUrl.replace(API_PREFIX, '')
    records.push({ method, url: path, body })
    const matched = await route(path, method)
    if (matched) return matched
    return jsonResponse(404, { error: { code: 'NOT_FOUND', message: `未匹配 ${method} ${path}` } })
  }
  vi.stubGlobal('fetch', fetchMock)
  return { records }
}

function resetFetchRouter() {
  vi.unstubAllGlobals()
}

function makeAttachment(overrides: Partial<Attachment> & { id: number }): Attachment {
  const now = '2026-09-09T02:00:00.000Z'
  return {
    entityType: 'project',
    entityId: 42,
    projectId: 42,
    uploadedBy: 1,
    fileName: '未命名文件.txt',
    filePath: '/attachments/unused',
    fileSize: 1024,
    mimeType: 'text/plain',
    thumbnailPath: null,
    storageProvider: 'local',
    currentVersion: 1,
    deletedAt: null,
    createdAt: now,
    updatedAt: now,
    uploader: { id: 1, fullName: '王启明', email: 'wang@aiproj.dev' },
    ...overrides,
  }
}

function defaultSeed(): Attachment[] {
  return [
    makeAttachment({
      id: 101,
      fileName: '产品需求规格说明书.pdf',
      mimeType: 'application/pdf',
      fileSize: 2 * 1024 * 1024 + 300 * 1024,
      createdAt: '2026-09-12T02:00:00.000Z',
    }),
    makeAttachment({
      id: 102,
      fileName: '需求说明.docx',
      mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      fileSize: 540 * 1024,
      createdAt: '2026-09-11T02:00:00.000Z',
    }),
    makeAttachment({
      id: 103,
      fileName: 'BUDGET-2026.xlsx',
      mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      fileSize: 1024 * 1024,
      createdAt: '2026-09-10T02:00:00.000Z',
      uploader: { id: 2, fullName: '李思远', email: 'li@aiproj.dev' },
    }),
    makeAttachment({
      id: 104,
      fileName: '导出记录.csv',
      mimeType: 'text/csv',
      fileSize: 512,
      createdAt: '2026-09-09T02:00:00.000Z',
      uploader: undefined,
    }),
    makeAttachment({
      id: 105,
      fileName: '架构图.png',
      mimeType: 'image/png',
      fileSize: 5 * 1024 * 1024,
      createdAt: '2026-09-08T02:00:00.000Z',
    }),
    makeAttachment({
      id: 106,
      fileName: '现场材料包.zip',
      mimeType: 'application/zip',
      fileSize: 30 * 1024 * 1024,
      createdAt: '2026-09-07T02:00:00.000Z',
      currentVersion: 2,
    }),
    makeAttachment({
      id: 107,
      fileName: '项目汇报.pptx',
      mimeType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      fileSize: 8 * 1024 * 1024,
      createdAt: '2026-09-06T02:00:00.000Z',
    }),
    makeAttachment({
      id: 108,
      fileName: '同步脚本.js',
      mimeType: 'text/javascript',
      fileSize: 4096,
      createdAt: '2026-09-05T02:00:00.000Z',
    }),
  ]
}

function makeBackend(seed?: Attachment[]) {
  const store: Attachment[] = seed ? [...seed] : defaultSeed()
  const route = (path: string, method: string): Response | null => {
    const listMatch = path === '/projects/42/attachments' && method === 'GET'
    if (listMatch) {
      return jsonResponse(200, {
        data: [...store],
        meta: { total: store.length, page: 1, perPage: 100, totalPages: 1 },
      })
    }
    const deleteMatch = /^\/projects\/42\/attachments\/(\d+)$/.exec(path)
    if (deleteMatch && method === 'DELETE') {
      const id = Number(deleteMatch[1])
      const index = store.findIndex((attachment) => attachment.id === id)
      if (index < 0) {
        return jsonResponse(404, { error: { code: 'RESOURCE_NOT_FOUND', message: '文件不存在' } })
      }
      store.splice(index, 1)
      return jsonResponse(200, { data: null })
    }
    return null
  }
  return { store, route }
}

function mountList(canManage: boolean, backend = makeBackend()) {
  const recorder = makeFetchRecorder(backend.route)
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const view = render(
    <QueryClientProvider client={client}>
      <FileAttachmentList projectId={42} canManage={canManage} />
    </QueryClientProvider>,
  )
  return { recorder, client, view, ...backend }
}

function waitForRows(expected: number) {
  return waitFor(() =>
    expect(document.querySelectorAll('[data-file-attachment-row]')).toHaveLength(expected),
  )
}

afterEach(() => {
  resetFetchRouter()
})

describe('FileAttachmentList：附件底册渲染（spec 场景「查看不同类型文件的专属图标与规格信息」）', () => {
  test('多类型附件渲染：语义图标 / 大小 / 上传者 / 版本 / 时间齐备', async () => {
    const { recorder } = mountList(true)
    await waitForRows(8)
    expect(recorder.records.some((record) => record.method === 'GET')).toBe(true)

    // 语义图标种类精确回显
    expect(document.querySelectorAll('[data-file-icon-kind="pdf"]')).toHaveLength(1)
    expect(document.querySelectorAll('[data-file-icon-kind="word"]')).toHaveLength(1)
    expect(document.querySelectorAll('[data-file-icon-kind="sheet"]')).toHaveLength(2)
    expect(document.querySelectorAll('[data-file-icon-kind="slide"]')).toHaveLength(1)
    expect(document.querySelectorAll('[data-file-icon-kind="image"]')).toHaveLength(1)
    expect(document.querySelectorAll('[data-file-icon-kind="archive"]')).toHaveLength(1)
    expect(document.querySelectorAll('[data-file-icon-kind="code"]')).toHaveLength(1)
    expect(
      document.querySelector('[data-file-icon-kind="pdf"]')?.getAttribute('data-file-icon-color'),
    ).toBe('#f87171')
    expect(
      document
        .querySelector('[data-file-icon-kind="archive"]')
        ?.getAttribute('data-file-icon-color'),
    ).toBe('#fbbf24')

    // 大小 / 版本 / 上传者 / 时间
    expect(
      document.querySelector('[data-file-attachment-row="101"] [data-file-size]')?.textContent,
    ).toBe('2.3 MB')
    expect(
      document.querySelector('[data-file-attachment-row="104"] [data-file-size]')?.textContent,
    ).toBe('512 B')
    expect(
      document.querySelector('[data-file-attachment-row="106"] [data-file-version]')?.textContent,
    ).toContain('v2')
    expect(
      document.querySelector('[data-file-attachment-row="102"] [data-file-version]')?.textContent,
    ).toContain('v1')
    const uploaderCell = document.querySelector(
      '[data-file-attachment-row="101"] [data-file-uploader]',
    )
    expect(uploaderCell?.textContent).toContain('王启明')
    expect(uploaderCell?.textContent).toContain('wang@aiproj.dev')
    // 无上传者关联 → 占位符
    expect(
      document.querySelector('[data-file-attachment-row="104"] [data-file-uploader]')?.textContent,
    ).toContain('—')
    const timeCell = document.querySelector(
      '[data-file-attachment-row="101"] [data-file-uploaded-at]',
    )
    expect(timeCell?.textContent).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/)

    // 文件名完整展示 + 汇总
    expect(screen.getByText('产品需求规格说明书.pdf')).toBeInTheDocument()
    expect(screen.getByText(/共 8 个/)).toBeInTheDocument()
  })

  test('MIME 缺失时按文件名后缀兜底渲染语义图标', async () => {
    const seed = [
      makeAttachment({
        id: 201,
        fileName: '备份说明.pdf',
        mimeType: null,
        fileSize: 100,
        createdAt: '2026-09-09T02:00:00.000Z',
      }),
      makeAttachment({
        id: 202,
        fileName: '录像.mp4',
        mimeType: 'video/mp4',
        fileSize: 100,
        createdAt: '2026-09-09T01:00:00.000Z',
      }),
    ]
    mountList(true, makeBackend(seed))
    await waitForRows(2)
    expect(document.querySelectorAll('[data-file-icon-kind="pdf"]')).toHaveLength(1)
    // 视频（无对应语义）→ 通用冷灰文档
    expect(document.querySelectorAll('[data-file-icon-kind="generic"]')).toHaveLength(1)
  })
})

describe('FileAttachmentList：搜索与文件大类 Tab 即时收敛（spec 场景「按文件名模糊检索」）', () => {
  test('文件名不区分大小写模糊搜索', async () => {
    mountList(true)
    await waitForRows(8)

    fireEvent.change(document.querySelector('[data-file-search]') as Element, {
      target: { value: '需求' },
    })
    await waitFor(() =>
      expect(document.querySelectorAll('[data-file-attachment-row]')).toHaveLength(2),
    )
    expect(screen.getByText('产品需求规格说明书.pdf')).toBeInTheDocument()
    expect(screen.getByText('需求说明.docx')).toBeInTheDocument()
    expect(screen.queryByText('架构图.png')).not.toBeInTheDocument()

    // 大小写不敏感：搜索 budget 命中 BUDGET-2026.xlsx
    fireEvent.change(document.querySelector('[data-file-search]') as Element, {
      target: { value: 'budget' },
    })
    await waitFor(() =>
      expect(document.querySelectorAll('[data-file-attachment-row]')).toHaveLength(1),
    )
    expect(screen.getByText('BUDGET-2026.xlsx')).toBeInTheDocument()
    expect(document.querySelector('[data-file-attachment-total]')?.textContent).toContain('共 1 个')
  })

  test('大类 Tab 过滤：表格 / 图片 / 压缩包 / 文档', async () => {
    mountList(true)
    await waitForRows(8)

    const clickTab = (id: string) => {
      const tab = document.querySelector(`[data-file-tab="${id}"]`) as Element
      expect(tab).not.toBeNull()
      fireEvent.click(tab)
    }

    // 表格：xlsx + csv
    clickTab('sheet')
    await waitFor(() =>
      expect(document.querySelectorAll('[data-file-attachment-row]')).toHaveLength(2),
    )
    expect(screen.getByText('BUDGET-2026.xlsx')).toBeInTheDocument()
    expect(screen.getByText('导出记录.csv')).toBeInTheDocument()
    expect(document.querySelector('[data-file-tab="sheet"]')?.getAttribute('aria-selected')).toBe(
      'true',
    )

    // 图片：png
    clickTab('image')
    await waitFor(() =>
      expect(document.querySelectorAll('[data-file-attachment-row]')).toHaveLength(1),
    )
    expect(screen.getByText('架构图.png')).toBeInTheDocument()

    // 压缩包
    clickTab('archive')
    await waitFor(() =>
      expect(document.querySelectorAll('[data-file-attachment-row]')).toHaveLength(1),
    )
    expect(screen.getByText('现场材料包.zip')).toBeInTheDocument()

    // 文档：pdf/word/ppt/js（code/generic 归入文档系）
    clickTab('document')
    await waitFor(() =>
      expect(document.querySelectorAll('[data-file-attachment-row]')).toHaveLength(4),
    )

    // 回到全部
    clickTab('all')
    await waitForRows(8)
  })

  test('搜索无匹配：语义化空态 + 一键清除筛选', async () => {
    mountList(true)
    await waitForRows(8)

    fireEvent.change(document.querySelector('[data-file-search]') as Element, {
      target: { value: '绝不存在的文件xyz' },
    })
    await waitFor(() => expect(document.querySelector('[data-file-list-no-match]')).not.toBeNull())
    expect(screen.getByText('未找到与当前搜索/分类匹配的文件。')).toBeInTheDocument()

    fireEvent.click(document.querySelector('[data-file-filter-reset]') as Element)
    await waitForRows(8)
  })
})

describe('FileAttachmentList：安全下载与受控删除', () => {
  test('下载入口 href 指向受控下载端点（列表图标 + 文件名双入口）', async () => {
    mountList(true)
    await waitForRows(8)

    expect(document.querySelector('[data-file-download="101"]')?.getAttribute('href')).toBe(
      'http://localhost:3333/api/v1/projects/42/attachments/101/download',
    )
    const nameAnchor = document.querySelector('[data-file-name-download="101"]')
    expect(nameAnchor?.getAttribute('href')).toBe(
      'http://localhost:3333/api/v1/projects/42/attachments/101/download',
    )
    expect(nameAnchor?.textContent).toBe('产品需求规格说明书.pdf')
  })

  test('删除：取消零请求；确认后触发 DELETE 并从列表移除', async () => {
    const backend = makeBackend()
    const { recorder, view } = mountList(true, backend)
    await waitForRows(8)

    fireEvent.click(document.querySelector('[data-file-delete-open="101"]') as Element)
    const dialog = document.querySelector('[data-file-delete-dialog]')
    expect(dialog).not.toBeNull()
    expect(dialog?.textContent).toContain('产品需求规格说明书.pdf')
    expect(dialog?.textContent).toContain('文件删除后不可恢复')

    // 取消：弹窗关闭且零 DELETE
    fireEvent.click(document.querySelector('[data-file-delete-cancel]') as Element)
    expect(document.querySelector('[data-file-delete-dialog]')).toBeNull()
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(recorder.records.filter((record) => record.method === 'DELETE')).toHaveLength(0)
    expect(document.querySelector('[data-file-attachment-row="101"]')).not.toBeNull()

    // 二次确认：DELETE + 列表平滑移除
    fireEvent.click(document.querySelector('[data-file-delete-open="101"]') as Element)
    expect(document.querySelector('[data-file-delete-dialog]')).not.toBeNull()
    fireEvent.click(document.querySelector('[data-file-delete-confirm]') as Element)
    await waitFor(() =>
      expect(recorder.records.some((record) => record.method === 'DELETE')).toBe(true),
    )
    const deleteRecord = recorder.records.find((record) => record.method === 'DELETE')
    expect(deleteRecord?.url).toBe('/projects/42/attachments/101')
    await waitFor(() =>
      expect(document.querySelector('[data-file-attachment-row="101"]')).toBeNull(),
    )
    expect(document.querySelectorAll('[data-file-attachment-row]')).toHaveLength(7)
    expect(backend.store.some((attachment) => attachment.id === 101)).toBe(false)
    expect(view.baseElement.textContent).not.toContain('产品需求规格说明书.pdf')
  })

  test('删除失败：界面回显错误原因、弹窗关闭且条目保留', async () => {
    const backend = makeBackend()
    const originalRoute = backend.route
    backend.route = (path: string, method: string) => {
      if (path === '/projects/42/attachments/101' && method === 'DELETE') {
        return jsonResponse(500, { error: { code: 'INTERNAL_ERROR', message: '存储服务异常' } })
      }
      return originalRoute(path, method)
    }
    const { recorder } = mountList(true, backend)
    await waitForRows(8)

    fireEvent.click(document.querySelector('[data-file-delete-open="101"]') as Element)
    fireEvent.click(document.querySelector('[data-file-delete-confirm]') as Element)
    await waitFor(() => expect(document.querySelector('[data-file-action-error]')).not.toBeNull())
    expect(document.querySelector('[data-file-action-error]')?.textContent).toContain(
      '存储服务异常',
    )
    expect(document.querySelector('[data-file-delete-dialog]')).toBeNull()
    expect(recorder.records.filter((record) => record.method === 'DELETE')).toHaveLength(1)
    expect(document.querySelector('[data-file-attachment-row="101"]')).not.toBeNull()
  })
})

describe('FileAttachmentList：权限与三态（RL-06 / 空态 / 错误重试）', () => {
  test('无 file:manage：删除入口物理隐藏，仅保留下载与只读提示', async () => {
    const { recorder } = mountList(false)
    await waitForRows(8)

    expect(document.querySelectorAll('[data-file-delete-open]')).toHaveLength(0)
    expect(document.querySelectorAll('[data-file-download]')).toHaveLength(8)
    expect(document.querySelector('[data-file-readonly-hint]')).not.toBeNull()
    expect(recorder.records.filter((record) => record.method === 'DELETE')).toHaveLength(0)
  })

  test('项目暂无附件：语义化空态卡 + 上传引导', async () => {
    mountList(true, makeBackend([]))
    await waitFor(() => expect(document.querySelector('[data-file-list-empty]')).not.toBeNull())
    expect(screen.getByText('当前项目暂无交付物与附件')).toBeInTheDocument()
    expect(document.body.textContent).toContain('选择文件上传首个交付物')
  })

  test('附件接口 500：错误卡 + 重试恢复', async () => {
    const backend = makeBackend()
    const originalRoute = backend.route
    let failNextGet = true
    backend.route = (path: string, method: string) => {
      if (path === '/projects/42/attachments' && method === 'GET') {
        if (failNextGet) {
          failNextGet = false
          return jsonResponse(500, { error: { code: 'INTERNAL_ERROR', message: '服务器繁忙' } })
        }
        return jsonResponse(200, {
          data: defaultSeed().slice(0, 2),
          meta: { total: 2, page: 1, perPage: 100, totalPages: 1 },
        })
      }
      return originalRoute(path, method)
    }
    mountList(true, backend)

    await waitFor(() => expect(document.querySelector('[data-file-list-error]')).not.toBeNull())
    expect(document.body.textContent).toContain('附件清单加载失败')

    fireEvent.click(document.querySelector('[data-file-list-retry]') as Element)
    await waitFor(() =>
      expect(document.querySelectorAll('[data-file-attachment-row]')).toHaveLength(2),
    )
    expect(document.querySelector('[data-file-list-error]')).toBeNull()
  })
})
