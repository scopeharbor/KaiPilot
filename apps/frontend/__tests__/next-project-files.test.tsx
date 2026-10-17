/**
 * v3-ui-next-resource-team-domains W3 · tasks 3.8 —— 项目文件库主工作台端到端集成测试
 * （页面级真实路由 + 全局 fetch 伪后端，覆盖上传区/文档组织/附件底册总装）。
 *
 * 覆盖（spec 场景与 RL-05/RL-06 红线）：
 * - 首次进入：骨架 → 文件库总装（DomainPageHeader 面包屑联动 entity store、
 *   上传释放区、文档与文件夹面板、附件底册齐备）；
 * - 无文件项目：语义化空态与上传引导；
 * - 拖入文件上传成功：列表缓存自动刷新且新附件位于底册首行；
 * - 轻量文档组织：新建文件夹/文档（filesApi.create）即时上屏；
 * - 无 file:view：受限横幅渲染且底层附件/文件接口零请求（RL-06）；
 * - 只读（有 file:view 无 file:manage）：上传释放区禁用、删除入口隐藏、
 *   新建入口隐藏，上传尝试零外发；
 * - 跨租户 / 不存在项目：统一中性 404「项目不存在或已被移除」，零 403 暴露（RL-05）；
 * - 非数字项目 ID：中性 404 且零网络请求。
 */
import * as React from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { useAuthStore } from '@/stores/auth-store'
import { useProjectSpaceEntityStore } from '@/stores/project-space-entity-store'
import ProjectFilesDomainPage from '@/app/(next)/next/projects/[id]/files/page'
import type { Project } from '@/lib/api/projects'
import type { Attachment, Document } from '@/lib/api/files'

// ---------------------------------------------------------------------------
// next/navigation mock（页面路由消费 useRouter / useParams）
// ---------------------------------------------------------------------------
const paramsMock = vi.hoisted(() => ({ value: { id: '42' } as { id: string } }))
const navMock = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn() }))
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: navMock.push, replace: navMock.replace, back: navMock.back }),
  usePathname: () => '/next/projects/42/files',
  useParams: () => paramsMock.value,
  useSearchParams: () => new URLSearchParams(),
}))

// ---------------------------------------------------------------------------
// 会话 & 夹具
// ---------------------------------------------------------------------------
function setAuth(permissions: string[], organizationId: number | null = 1) {
  useAuthStore.setState({
    user: {
      id: 1,
      email: 'pm@example.com',
      fullName: '王启明',
      organizations: [{ id: 1, name: '北极星研发部', slug: 'northstar', role: 'project_manager' }],
    },
    accessToken: null,
    refreshToken: null,
    permissions,
    currentOrganizationId: organizationId,
    planTier: null,
    roleVersion: 0,
    isAuthenticated: true,
    hasHydrated: true,
    effectiveTenantContext: null,
    selectionEpoch: 0,
  })
}

function makeProject(overrides: Partial<Project> = {}): Project {
  return {
    id: 42,
    organizationId: 1,
    name: '开项核心引擎',
    code: 'PROJ-042',
    description: null,
    category: null,
    status: 'active',
    priority: 'high',
    startDate: '2026-09-01',
    endDate: '2026-09-30',
    budgetCents: null,
    currency: null,
    progressPercent: 35,
    healthStatus: 'healthy',
    settings: null,
    createdBy: 1,
    updatedBy: null,
    createdAt: '2026-08-01T00:00:00.000Z',
    updatedAt: '2026-08-02T00:00:00.000Z',
    ...overrides,
  }
}

function makeAttachment(overrides: Partial<Attachment> & { id: number }): Attachment {
  return {
    entityType: 'project',
    entityId: 42,
    projectId: 42,
    uploadedBy: 1,
    fileName: '附件.bin',
    filePath: '/attachments/x',
    fileSize: 1024,
    mimeType: 'application/octet-stream',
    thumbnailPath: null,
    storageProvider: 'local',
    currentVersion: 1,
    deletedAt: null,
    createdAt: '2026-09-08T02:00:00.000Z',
    updatedAt: '2026-09-08T02:00:00.000Z',
    uploader: { id: 1, fullName: '王启明', email: 'wang@aiproj.dev' },
    ...overrides,
  }
}

function makeDocument(overrides: Partial<Document> & { id: number }): Document {
  return {
    projectId: 42,
    parentId: null,
    name: '文档.bin',
    documentType: 'document',
    content: null,
    version: 1,
    createdBy: 1,
    updatedBy: 1,
    createdAt: '2026-09-07T02:00:00.000Z',
    updatedAt: '2026-09-07T02:00:00.000Z',
    deletedAt: null,
    ...overrides,
  }
}

function defaultAttachments(): Attachment[] {
  return [
    makeAttachment({
      id: 101,
      fileName: '项目章程.pdf',
      mimeType: 'application/pdf',
      fileSize: 2 * 1024 * 1024,
      createdAt: '2026-09-10T02:00:00.000Z',
    }),
    makeAttachment({
      id: 102,
      fileName: '预算总表.xlsx',
      mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      fileSize: 900 * 1024,
      createdAt: '2026-09-09T02:00:00.000Z',
    }),
  ]
}

function defaultDocuments(): Document[] {
  return [
    makeDocument({
      id: 201,
      name: '交付物归档',
      documentType: 'folder',
      createdAt: '2026-09-06T02:00:00.000Z',
    }),
    makeDocument({ id: 202, name: '会议纪要 0901', documentType: 'document' }),
  ]
}

// ---------------------------------------------------------------------------
// 伪后端（项目 + 附件 + 文档文件全端点语义）
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

interface BackendOptions {
  projectOverrides?: Partial<Project>
  /** GET /projects/42 返回 404（模拟不存在/已删除项目）。 */
  projectNotFound?: boolean
  attachments?: Attachment[]
  documents?: Document[]
}

function createBackend(options: BackendOptions = {}) {
  const attachments: Attachment[] = options.attachments
    ? [...options.attachments]
    : defaultAttachments()
  const documents: Document[] = options.documents ? [...options.documents] : defaultDocuments()
  let nextAttachmentId = 9000
  let nextDocumentId = 9000

  const route = (
    path: string,
    method: string,
    body: Record<string, unknown> | null,
  ): Response | null => {
    // 项目详情（RL-05：404 或跨租户 → 中性 404）
    if (path === '/projects/42' && method === 'GET') {
      if (options.projectNotFound) {
        return jsonResponse(404, { error: { code: 'RESOURCE_NOT_FOUND', message: '项目不存在' } })
      }
      return jsonResponse(200, { data: makeProject(options.projectOverrides) })
    }

    // 附件清单
    if (path === '/projects/42/attachments' && method === 'GET') {
      return jsonResponse(200, {
        data: [...attachments],
        meta: { total: attachments.length, page: 1, perPage: 100, totalPages: 1 },
      })
    }
    // 附件上传：store 首行插入新附件（与后端倒序语义一致）
    if (path === '/projects/42/attachments' && method === 'POST') {
      const uploaded = makeAttachment({
        id: ++nextAttachmentId,
        fileName: typeof body?.fileName === 'string' ? (body.fileName as string) : '新上传文件.bin',
        mimeType: typeof body?.mimeType === 'string' ? (body.mimeType as string) : null,
        fileSize: typeof body?.fileSize === 'number' ? (body.fileSize as number) : 100,
        // 固定未来时间戳：与种子附件（2026-09）拉开排序差距，保证新附件恒居首行
        createdAt: '2099-01-01T00:00:00.000Z',
        updatedAt: '2099-01-01T00:00:00.000Z',
      })
      attachments.unshift(uploaded)
      return jsonResponse(200, { data: uploaded })
    }
    // 附件删除
    const deleteMatch = /^\/projects\/42\/attachments\/(\d+)$/.exec(path)
    if (deleteMatch && method === 'DELETE') {
      const id = Number(deleteMatch[1])
      const index = attachments.findIndex((attachment) => attachment.id === id)
      if (index < 0) {
        return jsonResponse(404, { error: { code: 'RESOURCE_NOT_FOUND', message: '文件不存在' } })
      }
      attachments.splice(index, 1)
      return jsonResponse(200, { data: null })
    }

    // 文档 / 文件夹清单（根级）
    if (/^\/projects\/42\/files(\?|$)/.test(path) && method === 'GET') {
      return jsonResponse(200, {
        data: [...documents],
        meta: { total: documents.length, page: 1, perPage: 200, totalPages: 1 },
      })
    }
    // 新建文件夹 / 文档
    if (path === '/projects/42/files' && method === 'POST') {
      const created = makeDocument({
        id: ++nextDocumentId,
        name: typeof body?.name === 'string' ? (body.name as string) : '未命名',
        documentType: body?.documentType === 'folder' ? 'folder' : 'document',
        parentId: (body?.parentId as number | null) ?? null,
        content: typeof body?.content === 'string' ? (body.content as string) : null,
        createdAt: '2099-01-02T00:00:00.000Z',
        updatedAt: '2099-01-02T00:00:00.000Z',
      })
      documents.push(created)
      return jsonResponse(200, { data: created })
    }
    return null
  }

  return { attachments, documents, route }
}

function installFetchRouter(
  route: (path: string, method: string, body: Record<string, unknown> | null) => Response | null,
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
    // FormData 上传体：抽取关键字段供断言（file 为 File 对象则记文件名）
    if (!body && typeof FormData !== 'undefined' && init?.body instanceof FormData) {
      const form = init.body
      body = {
        fileName: (form.get('file') as File | null)?.name ?? 'unknown',
        mimeType: (form.get('file') as File | null)?.type ?? null,
        fileSize: (form.get('file') as File | null)?.size ?? 0,
        entityType: form.get('entityType'),
        entityId: form.get('entityId'),
      }
    }
    const path = rawUrl.replace(API_PREFIX, '')
    records.push({ method, url: path, body })
    const matched = await route(path, method, body)
    if (matched) return matched
    return jsonResponse(404, { error: { code: 'NOT_FOUND', message: `未匹配 ${method} ${path}` } })
  }
  vi.stubGlobal('fetch', fetchMock)
  return { records }
}

function resetFetchRouter() {
  vi.unstubAllGlobals()
}

function makeFile(name: string, size: number, type = 'application/octet-stream'): File {
  const file = new File(['内容'], name, { type })
  Object.defineProperty(file, 'size', { configurable: true, value: size })
  return file
}

function renderPage(node: React.ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(<QueryClientProvider client={client}>{node}</QueryClientProvider>)
}

function waitForRows(expected: number) {
  return waitFor(() =>
    expect(document.querySelectorAll('[data-file-attachment-row]')).toHaveLength(expected),
  )
}

function writeMethods(records: RequestRecord[]): string[] {
  return records.filter((record) => record.method !== 'GET').map((record) => record.method)
}

beforeEach(() => {
  paramsMock.value = { id: '42' }
  navMock.push.mockReset()
  navMock.replace.mockReset()
  navMock.back.mockReset()
  // entity store 为模块级单例，逐用例重置。
  useProjectSpaceEntityStore.setState({ projectId: null, entityTitle: null })
})

afterEach(() => {
  resetFetchRouter()
})

describe('ProjectFilesDomainPage：初次加载与总装（面包屑 + 上传区 + 文档面板 + 附件底册）', () => {
  test('项目校验通过后渲染文件库总装，DomainPageHeader 注册 <项目名> · 项目文件库', async () => {
    setAuth(['project:view', 'file:view', 'file:manage'])
    const backend = createBackend()
    installFetchRouter(backend.route)
    const view = renderPage(<ProjectFilesDomainPage />)

    // 加载期骨架 → 总装容器
    expect(document.querySelector('[data-project-space-skeleton]')).not.toBeNull()
    await waitFor(() =>
      expect(document.querySelector('[data-files-workspace-space]')).not.toBeNull(),
    )

    // 页头：标题 + 返回按钮 + 面包屑联动
    expect(document.querySelector('[data-domain-back]')).not.toBeNull()
    expect(screen.getByText('开项核心引擎 · 项目文件库')).toBeInTheDocument()
    expect(useProjectSpaceEntityStore.getState().projectId).toBe(42)
    expect(useProjectSpaceEntityStore.getState().entityTitle).toBe('开项核心引擎 · 项目文件库')

    // 上传释放区 + 文档面板 + 附件底册
    expect(document.querySelector('[data-file-dropzone]')).not.toBeNull()
    expect(document.querySelector('[data-file-dropzone-disabled]')).toBeNull()
    await waitFor(() =>
      expect(document.querySelectorAll('[data-file-document-row]')).toHaveLength(2),
    )
    expect(screen.getByText('交付物归档')).toBeInTheDocument()
    await waitForRows(2)
    expect(screen.getByText('项目章程.pdf')).toBeInTheDocument()
    expect(screen.getByText('预算总表.xlsx')).toBeInTheDocument()
    expect(screen.getByText(/共 2 个/)).toBeInTheDocument()

    // 面包屑随卸载安全清理
    view.unmount()
    expect(useProjectSpaceEntityStore.getState().projectId).toBeNull()
    expect(useProjectSpaceEntityStore.getState().entityTitle).toBeNull()
  })

  test('无文件项目：附件空态卡 + 上传引导 + 文档面板空态', async () => {
    setAuth(['project:view', 'file:view', 'file:manage'])
    const backend = createBackend({ attachments: [], documents: [] })
    installFetchRouter(backend.route)
    renderPage(<ProjectFilesDomainPage />)

    await waitFor(() =>
      expect(document.querySelector('[data-files-workspace-space]')).not.toBeNull(),
    )
    await waitFor(() => expect(document.querySelector('[data-file-list-empty]')).not.toBeNull())
    expect(screen.getByText('当前项目暂无交付物与附件')).toBeInTheDocument()
    expect(document.body.textContent).toContain('选择文件上传首个交付物')
    await waitFor(() =>
      expect(document.querySelector('[data-file-documents-empty]')).not.toBeNull(),
    )
    // 空态下不渲染底册表格行
    expect(document.querySelectorAll('[data-file-attachment-row]')).toHaveLength(0)
  })
})

describe('ProjectFilesDomainPage：上传成功自动刷新列表（spec 场景「拖拽文件至释放区完成上传」）', () => {
  test('拖入文件：POST 上传成功 → 附件底册缓存刷新且新附件位于首行', async () => {
    setAuth(['project:view', 'file:view', 'file:manage'])
    const backend = createBackend()
    const { records } = installFetchRouter(backend.route)
    renderPage(<ProjectFilesDomainPage />)
    await waitForRows(2)

    const zone = document.querySelector('[data-file-dropzone]') as Element
    fireEvent.dragOver(zone, {
      dataTransfer: { files: [makeFile('项目架构图.png', 2 * 1024 * 1024, 'image/png')] },
    })
    expect(zone.getAttribute('data-file-dropzone-active')).toBe('true')
    fireEvent.drop(zone, {
      dataTransfer: { files: [makeFile('项目架构图.png', 2 * 1024 * 1024, 'image/png')] },
    })

    await waitFor(() => expect(records.some((record) => record.method === 'POST')).toBe(true))
    const postRecord = records.find((record) => record.method === 'POST')
    expect(postRecord?.url).toBe('/projects/42/attachments')
    expect(postRecord?.body).toMatchObject({
      entityType: 'project',
      entityId: '42',
      fileName: '项目架构图.png',
    })

    // 列表自动刷新：新附件首行上屏
    await waitForRows(3)
    const firstRow = document.querySelector('[data-file-attachment-row]')
    expect(firstRow?.getAttribute('data-file-attachment-row')).not.toBe('101')
    expect(firstRow?.textContent).toContain('项目架构图.png')
    expect(backend.attachments[0]?.fileName).toBe('项目架构图.png')
  })
})

describe('ProjectFilesDomainPage：轻量文档组织（filesApi.list / filesApi.create）', () => {
  test('新建文件夹：POST /files 成功 → 面板即时上屏并清空输入', async () => {
    setAuth(['project:view', 'file:view', 'file:manage'])
    const backend = createBackend({ documents: [] })
    const { records } = installFetchRouter(backend.route)
    renderPage(<ProjectFilesDomainPage />)
    await waitFor(() =>
      expect(document.querySelector('[data-file-documents-empty]')).not.toBeNull(),
    )

    const input = document.querySelector('[data-file-documents-name-input]') as HTMLInputElement
    fireEvent.change(input, { target: { value: '合同归档' } })
    fireEvent.click(document.querySelector('[data-file-documents-create-folder]') as Element)

    await waitFor(() =>
      expect(
        records.some((record) => record.method === 'POST' && record.url === '/projects/42/files'),
      ).toBe(true),
    )
    const postRecord = records.find((record) => record.url === '/projects/42/files')
    expect(postRecord?.body).toMatchObject({
      name: '合同归档',
      documentType: 'folder',
    })
    await waitFor(() => expect(document.querySelector('[data-file-document-row]')).not.toBeNull())
    const row = document.querySelector('[data-file-document-row]') as Element
    expect(row.getAttribute('data-file-document-type')).toBe('folder')
    expect(row.textContent).toContain('合同归档')
    expect(
      (document.querySelector('[data-file-documents-name-input]') as HTMLInputElement).value,
    ).toBe('')
    expect(document.querySelector('[data-file-documents-empty]')).toBeNull()
  })

  test('空名称创建被前端阻断：零 POST 请求', async () => {
    setAuth(['project:view', 'file:view', 'file:manage'])
    const backend = createBackend()
    const { records } = installFetchRouter(backend.route)
    renderPage(<ProjectFilesDomainPage />)
    await waitFor(() =>
      expect(document.querySelector('[data-file-documents-panel]')).not.toBeNull(),
    )

    fireEvent.click(document.querySelector('[data-file-documents-create-document]') as Element)
    await waitFor(() =>
      expect(document.querySelector('[data-file-documents-create-error]')).not.toBeNull(),
    )
    expect(document.querySelector('[data-file-documents-create-error]')?.textContent).toContain(
      '请输入文件夹或文档名称',
    )
    expect(records.filter((record) => record.method === 'POST')).toHaveLength(0)
  })
})

describe('ProjectFilesDomainPage：RBAC 权限矩阵（RL-06）', () => {
  test('无 file:view：受限横幅渲染且底层附件/文档接口零请求', async () => {
    setAuth(['project:view', 'task:view'])
    const backend = createBackend()
    const { records } = installFetchRouter(backend.route)
    renderPage(<ProjectFilesDomainPage />)

    expect(document.querySelector('[data-permission-fallback]')).not.toBeNull()
    expect(screen.getByText('你没有查看该项目文件库的权限')).toBeInTheDocument()
    await new Promise((resolve) => setTimeout(resolve, 30))
    expect(records).toHaveLength(0)
  })

  test('只读（file:view 无 file:manage）：上传区禁用、删除/新建入口隐藏、上传尝试零外发', async () => {
    setAuth(['project:view', 'file:view'])
    const backend = createBackend()
    const { records } = installFetchRouter(backend.route)
    renderPage(<ProjectFilesDomainPage />)

    await waitFor(() =>
      expect(document.querySelector('[data-files-workspace-space]')).not.toBeNull(),
    )
    await waitForRows(2)

    // 下载保留（每行 1 个下载入口 + 1 个文件名入口锚点）
    expect(document.querySelectorAll('[data-file-download]')).toHaveLength(2)
    // 删除入口物理隐藏
    expect(document.querySelectorAll('[data-file-delete-open]')).toHaveLength(0)
    // 上传释放区禁用 + 提示
    expect(document.querySelector('[data-file-dropzone-disabled]')).not.toBeNull()
    expect(document.body.textContent).toContain('上传需 file:manage 权限')
    // 文档新建入口隐藏
    expect(document.querySelector('[data-file-documents-create-folder]')).toBeNull()
    expect(document.querySelector('[data-file-documents-name-input]')).toBeNull()

    // 只读下尝试拖入文件：零外发
    const zone = document.querySelector('[data-file-dropzone]') as Element
    fireEvent.drop(zone, { dataTransfer: { files: [makeFile('只读尝试.png', 1024, 'image/png')] } })
    await new Promise((resolve) => setTimeout(resolve, 30))
    expect(records.filter((record) => record.method === 'POST')).toHaveLength(0)
    expect(writeMethods(records)).toHaveLength(0)
  })

  test('具备 file:manage：删除按钮可见，确认后 DELETE 并移除条目', async () => {
    setAuth(['project:view', 'file:view', 'file:manage'])
    const backend = createBackend()
    const { records } = installFetchRouter(backend.route)
    renderPage(<ProjectFilesDomainPage />)
    await waitForRows(2)

    expect(document.querySelectorAll('[data-file-delete-open]')).toHaveLength(2)
    fireEvent.click(document.querySelector('[data-file-delete-open="101"]') as Element)
    expect(document.querySelector('[data-file-delete-dialog]')).not.toBeNull()
    fireEvent.click(document.querySelector('[data-file-delete-confirm]') as Element)
    await waitFor(() => expect(records.some((record) => record.method === 'DELETE')).toBe(true))
    await waitFor(() =>
      expect(document.querySelector('[data-file-attachment-row="101"]')).toBeNull(),
    )
    expect(document.querySelectorAll('[data-file-attachment-row]')).toHaveLength(1)
  })
})

describe('ProjectFilesDomainPage：RL-05 跨租户与非法 ID 中性 404', () => {
  test('跨组织项目（orgMismatch）：统一中性 404，零 403 暴露', async () => {
    setAuth(['project:view', 'file:view', 'file:manage'], 1)
    const backend = createBackend({
      projectOverrides: { organizationId: 2, name: '其他组织项目' },
    })
    const { records } = installFetchRouter(backend.route)
    renderPage(<ProjectFilesDomainPage />)

    await screen.findByRole('status', { name: '项目不存在或已被移除' })
    expect(screen.getByText('项目不存在或已被移除')).toBeInTheDocument()
    expect(document.body.textContent).not.toContain('其他组织项目')
    expect(document.body.textContent).not.toContain('403')
    // 仅发出项目详情请求；附件/文件接口零请求
    const urls = records.map((record) => record.url)
    expect(urls.filter((url) => url.startsWith('/projects/42/attachments'))).toHaveLength(0)
    expect(urls.filter((url) => /^\/projects\/42\/files(\?|$)/.test(url))).toHaveLength(0)
  })

  test('项目接口返回 404（不存在/已删除）：中性 404 空态', async () => {
    setAuth(['project:view', 'file:view', 'file:manage'])
    const backend = createBackend({ projectNotFound: true })
    const { records } = installFetchRouter(backend.route)
    renderPage(<ProjectFilesDomainPage />)

    await screen.findByRole('status', { name: '项目不存在或已被移除' })
    expect(document.querySelector('[data-project-space-empty="not_found"]')).not.toBeNull()
    expect(
      records.filter((record) => record.url.startsWith('/projects/42/attachments')),
    ).toHaveLength(0)

    // 「返回角色首页」动线
    fireEvent.click(document.querySelector('[data-project-space-back-home]') as Element)
    expect(navMock.push).toHaveBeenCalledWith('/next')
  })

  test('非数字项目 ID：中性 404 视图，零网络请求', async () => {
    setAuth(['project:view', 'file:view', 'file:manage'])
    paramsMock.value = { id: 'abc' }
    const { records } = installFetchRouter(createBackend().route)
    renderPage(<ProjectFilesDomainPage />)

    await screen.findByRole('status', { name: '项目不存在或已被移除' })
    expect(records).toHaveLength(0)
  })
})
