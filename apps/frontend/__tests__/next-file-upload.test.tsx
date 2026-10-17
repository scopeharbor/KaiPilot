/**
 * v3-ui-next-resource-team-domains W3 · tasks 3.6 —— 附件拖拽上传与前端阻断测试
 * （FileUploadDropzone 组件级，真实全局 fetch 伪后端）。
 *
 * 覆盖（design §4.2 与 spec 场景）：
 * - 拖拽悬停高亮（dragover/dragleave 原生事件序列，jsdom 无 PointerEvent）；
 * - 拖入常规文件触发 FormData 上传（entityType=project / entityId=projectId），
 *   成功后呈现成功态；点击选择（input change）同样触发；
 * - 拖入 11MB 超限文件立即红色警示「文件超出单文件 10MB 限制」，
 *   底层网络零请求（RL-06）；白名单外扩展名（.zip/.exe）同样前端拦截零请求；
 *   0 字节空文件同样前端拦截零请求；
 * - 上传中确定性百分比进度条（fake timers 逐步推进），完成后定格成功；
 * - 上传失败展示错误原因与「重试上传」入口，重试成功闭环；
 * - 无 file:manage：释放区物理禁用，拖拽/选择零副作用（RL-06）。
 */
import * as React from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { FileUploadDropzone } from '@/components/next/files/FileUploadDropzone'
import type { Attachment } from '@/lib/api/files'

// ---------------------------------------------------------------------------
// 伪后端（POST /projects/42/attachments）
// ---------------------------------------------------------------------------
const API_PREFIX = 'http://localhost:3333/api/v1'

interface RequestRecord {
  method: string
  url: string
  formFields: Record<string, string> | null
}

function jsonResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: String(status),
    json: async () => body,
  } as Response
}

function makeUploadedAttachment(fileName: string): Attachment {
  return {
    id: 9001,
    entityType: 'project',
    entityId: 42,
    projectId: 42,
    uploadedBy: 1,
    fileName,
    filePath: '/attachments/9001',
    fileSize: 100,
    mimeType: 'image/png',
    thumbnailPath: null,
    storageProvider: 'local',
    currentVersion: 1,
    deletedAt: null,
    createdAt: '2026-09-13T02:00:00.000Z',
    updatedAt: '2026-09-13T02:00:00.000Z',
    uploader: { id: 1, fullName: '王启明', email: 'wang@aiproj.dev' },
  }
}

function makeRecorder(
  handler: (
    path: string,
    method: string,
    form: FormData | null,
  ) => Response | Promise<Response> | null,
) {
  const records: RequestRecord[] = []
  const fetchMock: typeof fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const rawUrl = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    const method = (init?.method ?? 'GET').toUpperCase()
    let form: FormData | null = null
    if (typeof FormData !== 'undefined' && init?.body instanceof FormData) {
      form = init.body
    }
    const path = rawUrl.replace(API_PREFIX, '')
    const formFields: Record<string, string> = {}
    if (form) {
      for (const [key, value] of Array.from(form.entries())) {
        formFields[key] = value instanceof File ? `File:${value.name}` : String(value)
      }
    }
    records.push({ method, url: path, formFields: form ? formFields : null })
    const matched = await handler(path, method, form)
    if (matched) return matched
    return jsonResponse(404, { error: { code: 'NOT_FOUND', message: `未匹配 ${method} ${path}` } })
  }
  vi.stubGlobal('fetch', fetchMock)
  return { records }
}

function makeUploadOkBackend(fileName = '架构图.png') {
  const handler = (path: string, method: string): Response | null => {
    if (path === '/projects/42/attachments' && method === 'POST') {
      return jsonResponse(200, { data: makeUploadedAttachment(fileName) })
    }
    return null
  }
  return handler
}

function resetFetchRouter() {
  vi.unstubAllGlobals()
}

function makeFile(name: string, size: number, type = 'application/octet-stream'): File {
  const file = new File(['测试内容'], name, { type })
  Object.defineProperty(file, 'size', { configurable: true, value: size })
  return file
}

function renderDropzone(canManage: boolean) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const view = render(
    <QueryClientProvider client={client}>
      <FileUploadDropzone projectId={42} canManage={canManage} />
    </QueryClientProvider>,
  )
  const zone = document.querySelector('[data-file-dropzone]') as Element
  expect(zone).not.toBeNull()
  return { zone, view, client }
}

function dropFiles(zone: Element, files: File[]) {
  fireEvent.dragOver(zone, { dataTransfer: { files } })
  fireEvent.drop(zone, { dataTransfer: { files } })
}

function dropFile(zone: Element, file: File) {
  dropFiles(zone, [file])
}

const TWO_MB = 2 * 1024 * 1024
const TEN_MB = 10 * 1024 * 1024

beforeEach(() => {
  vi.useRealTimers()
})

afterEach(() => {
  resetFetchRouter()
})

describe('FileUploadDropzone：HTML5 拖拽高亮与选择上传入口（spec 场景「拖拽文件至释放区完成上传」）', () => {
  test('dragover 高亮、dragleave 复位（原生事件序列）', () => {
    const { zone } = renderDropzone(true)

    expect(zone.getAttribute('data-file-dropzone-active')).toBeNull()
    fireEvent.dragOver(zone, { dataTransfer: { files: [makeFile('a.png', 100)] } })
    expect(zone.getAttribute('data-file-dropzone-active')).toBe('true')

    fireEvent.dragLeave(zone, { dataTransfer: {} })
    expect(zone.getAttribute('data-file-dropzone-active')).toBeNull()
  })

  test('拖入常规文件：FormData 上传（entityType/entityId 齐备）并呈现成功态', async () => {
    const { records } = makeRecorder(makeUploadOkBackend('项目架构图.png'))
    const { zone } = renderDropzone(true)

    const file = makeFile('项目架构图.png', TWO_MB, 'image/png')
    dropFile(zone, file)

    await waitFor(() => expect(document.querySelector('[data-file-upload-success]')).not.toBeNull())
    expect(screen.getByText(/上传成功/)).toBeInTheDocument()

    expect(records).toHaveLength(1)
    expect(records[0]?.method).toBe('POST')
    expect(records[0]?.url).toBe('/projects/42/attachments')
    expect(records[0]?.formFields).toMatchObject({
      file: 'File:项目架构图.png',
      entityType: 'project',
      entityId: '42',
    })
    // 成功态展示文件名
    expect(document.querySelector('[data-file-upload-success]')?.textContent).toContain(
      '项目架构图.png',
    )
  })

  test('点击选择文件（input change）同样触发上传', async () => {
    const { records } = makeRecorder(makeUploadOkBackend())
    renderDropzone(true)

    const input = document.querySelector('[data-file-input]') as HTMLInputElement
    const file = makeFile('选择上传.pdf', 1024, 'application/pdf')
    fireEvent.change(input, { target: { files: [file] } })

    await waitFor(() => expect(document.querySelector('[data-file-upload-success]')).not.toBeNull())
    expect(records.some((record) => record.method === 'POST')).toBe(true)
  })
})

describe('FileUploadDropzone：超限 / 白名单外 / 空文件前端预检阻断（spec 场景「上传超限或白名单外文件触发前端规格校验阻断」）', () => {
  test('拖入 11MB 超限文件：立即警示 10MB 限制且网络零请求', async () => {
    const { records } = makeRecorder(makeUploadOkBackend())
    const { zone } = renderDropzone(true)

    const huge = makeFile('超大视频.mp4', 11 * 1024 * 1024, 'video/mp4')
    dropFile(zone, huge)

    await waitFor(() => expect(document.querySelector('[data-file-upload-error]')).not.toBeNull())
    const error = document.querySelector('[data-file-upload-error]')
    expect(error?.textContent).toContain('文件超出单文件 10MB 限制')
    expect(error?.getAttribute('aria-label')).toBe('上传失败')
    // 预检失败无重试入口（无已接受的 pending 文件），且零外发
    expect(document.querySelector('[data-file-upload-retry]')).toBeNull()
    expect(records).toHaveLength(0)
  })

  test('拖入白名单外扩展名文件（.zip）：格式警示列出支持格式且网络零请求', async () => {
    const { records } = makeRecorder(makeUploadOkBackend())
    const { zone } = renderDropzone(true)

    dropFile(zone, makeFile('打包.zip', TWO_MB, 'application/zip'))
    await waitFor(() => expect(document.querySelector('[data-file-upload-error]')).not.toBeNull())
    const error = document.querySelector('[data-file-upload-error]')
    expect(error?.textContent).toContain('不支持该文件格式')
    expect(error?.textContent).toContain('pdf')
    expect(document.querySelector('[data-file-upload-retry]')).toBeNull()
    expect(records).toHaveLength(0)
  })

  test('拖入 0 字节空文件：空文件拦截且网络零请求', async () => {
    const { records } = makeRecorder(makeUploadOkBackend())
    const { zone } = renderDropzone(true)

    dropFile(zone, makeFile('空文档.txt', 0, 'text/plain'))
    await waitFor(() => expect(document.querySelector('[data-file-upload-error]')).not.toBeNull())
    expect(document.querySelector('[data-file-upload-error]')?.textContent).toContain('空文件')
    expect(records).toHaveLength(0)
  })

  test('10MB 边界文件精确放行进入上传（含大写扩展名大小写不敏感）', async () => {
    const { records } = makeRecorder(makeUploadOkBackend('边界文件.pdf'))
    const { zone } = renderDropzone(true)

    dropFile(zone, makeFile('边界文件.pdf', TEN_MB, 'application/pdf'))
    await waitFor(() => expect(document.querySelector('[data-file-upload-success]')).not.toBeNull())
    expect(records).toHaveLength(1)
  })

  test('大写扩展名（.PNG）同样放行进入上传', async () => {
    const { records } = makeRecorder(makeUploadOkBackend('架构图.PNG'))
    const { zone } = renderDropzone(true)

    dropFile(zone, makeFile('架构图.PNG', TWO_MB, 'image/png'))
    await waitFor(() => expect(document.querySelector('[data-file-upload-success]')).not.toBeNull())
    expect(records).toHaveLength(1)
  })
})

describe('FileUploadDropzone：上传进度条与失败重试闭环', () => {
  test('上传中进度条确定性推进（6% → 14% → 22%），完成后成功态', async () => {
    let resolveUpload!: (value: Response) => void
    const pending = new Promise<Response>((resolve) => {
      resolveUpload = resolve
    })
    const handler = (path: string, method: string): Promise<Response> | null => {
      if (path === '/projects/42/attachments' && method === 'POST') return pending
      return null
    }
    makeRecorder(handler)
    const { zone } = renderDropzone(true)

    vi.useFakeTimers()
    try {
      dropFile(zone, makeFile('进度文件.pdf', TWO_MB, 'application/pdf'))

      // 上传中：文件名 + 初始百分比
      expect(document.querySelector('[data-file-upload-name]')?.textContent).toBe('进度文件.pdf')
      expect(document.querySelector('[data-file-upload-progress]')?.textContent).toBe('6%')

      // 每 250ms +8，封顶 90
      await act(async () => {
        vi.advanceTimersByTime(250)
      })
      expect(document.querySelector('[data-file-upload-progress]')?.textContent).toBe('14%')
      await act(async () => {
        vi.advanceTimersByTime(250)
      })
      expect(document.querySelector('[data-file-upload-progress]')?.textContent).toBe('22%')
      const progressbar = document.querySelector('[role="progressbar"]')
      expect(progressbar?.getAttribute('aria-valuenow')).toBe('22')

      // 请求返回 → 成功态
      await act(async () => {
        resolveUpload(jsonResponse(200, { data: makeUploadedAttachment('进度文件.pdf') }))
        await pending
      })
      expect(document.querySelector('[data-file-upload-success]')).not.toBeNull()
      expect(document.querySelector('[role="progressbar"]')).toBeNull()
    } finally {
      vi.useRealTimers()
    }
  })

  test('上传失败：展示错误原因与重试入口，重试成功后闭环', async () => {
    let shouldFail = true
    const handler = (path: string, method: string): Response | null => {
      if (path === '/projects/42/attachments' && method === 'POST') {
        if (shouldFail) {
          shouldFail = false
          return jsonResponse(500, {
            error: { code: 'UPLOAD_FAILED', message: '存储服务暂不可用' },
          })
        }
        return jsonResponse(200, { data: makeUploadedAttachment('重试文件.png') })
      }
      return null
    }
    const { records } = makeRecorder(handler)
    const { zone } = renderDropzone(true)

    dropFile(zone, makeFile('重试文件.png', TWO_MB, 'image/png'))
    await waitFor(() => expect(document.querySelector('[data-file-upload-error]')).not.toBeNull())
    expect(document.querySelector('[data-file-upload-error]')?.textContent).toContain(
      '存储服务暂不可用',
    )

    // 重试按钮 → 第二次上传成功
    const retryButton = document.querySelector('[data-file-upload-retry]') as Element
    expect(retryButton).not.toBeNull()
    fireEvent.click(retryButton)
    await waitFor(() => expect(document.querySelector('[data-file-upload-success]')).not.toBeNull())
    expect(records.filter((record) => record.method === 'POST')).toHaveLength(2)
  })

  test('网络异常（fetch reject）：兜底错误文案与重试入口', async () => {
    const handler = (): Promise<Response> | null => Promise.reject(new Error('网络中断'))
    makeRecorder(handler)
    const { zone } = renderDropzone(true)

    dropFile(zone, makeFile('断网文件.txt', 1024, 'text/plain'))
    await waitFor(() => expect(document.querySelector('[data-file-upload-error]')).not.toBeNull())
    expect(document.querySelector('[data-file-upload-error]')?.textContent).toContain('网络中断')
    expect(document.querySelector('[data-file-upload-retry]')).not.toBeNull()
  })
})

describe('FileUploadDropzone：只读权限物理禁用（RL-06）', () => {
  test('无 file:manage：拖拽与选择零副作用、零网络请求', async () => {
    const { records } = makeRecorder(makeUploadOkBackend())
    const { zone } = renderDropzone(false)

    expect(zone.getAttribute('data-file-dropzone-disabled')).not.toBeNull()
    expect(zone.getAttribute('aria-disabled')).toBe('true')
    expect(document.body.textContent).toContain('上传需 file:manage 权限')

    // 拖拽高亮不生效
    fireEvent.dragOver(zone, { dataTransfer: { files: [makeFile('a.png', 100)] } })
    expect(zone.getAttribute('data-file-dropzone-active')).toBeNull()

    // 拖入 / 选择均零请求
    dropFile(zone, makeFile('禁止上传.png', TWO_MB, 'image/png'))
    const input = document.querySelector('[data-file-input]') as HTMLInputElement
    expect(input.disabled).toBe(true)
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(records).toHaveLength(0)
  })
})
