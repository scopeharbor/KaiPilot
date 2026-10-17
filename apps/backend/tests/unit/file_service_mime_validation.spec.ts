/**
 * v3 附件上传 MIME 校验回归测试（file_service.ts）。
 *
 * 背景：file_service.upload 曾用 AdonisJS MultipartFile.file.type（主类型，如
 * `image`/`text`）去比对完整 MIME 白名单（如 `image/png`），任何上传都命中
 * `不支持的文件格式` 而 422。修复后须拼接 `type/subtype` 为完整 MIME 再校验。
 *
 * 本套件为 vitest 风格（不依赖 Adonis 运行时/数据库迁移），mock 模型与 IO、
 * 保留真实的 ALLOWED_MIME_TYPES 白名单，直接驱动 FileService.upload 验证
 * MIME 校验收敛。HTTP 级覆盖见 tests/functional/files/files_api.spec.ts。
 */
import { describe, expect, it, vi, beforeEach } from 'vitest'
import FileService from '#services/file_service'
import AuditService from '#services/audit_service'
import NotificationService from '#services/notification_service'
import { ALLOWED_MIME_TYPES } from '#services/file_storage'

vi.mock('#services/audit_service', () => ({
  default: class MockAuditService {
    log = vi.fn()
  },
  AuditEvent: {
    ATTACHMENT_UPLOADED: 'attachment_uploaded',
    ATTACHMENT_DELETED: 'attachment_deleted',
    ATTACHMENT_DOWNLOADED: 'attachment_downloaded',
  },
}))

vi.mock('#services/notification_service', () => ({
  default: class MockNotificationService {
    createForUser = vi.fn()
  },
}))

vi.mock('#services/database_tenant_boundary', () => ({
  default: class MockTenantBoundary {
    scopedQuery = vi.fn()
  },
}))

vi.mock('#models/attachment', () => ({
  default: {
    create: vi.fn(),
  },
}))

vi.mock('#models/task', () => ({
  default: { query: vi.fn() },
}))

// 保留真实白名单/文件名工具，仅替换磁盘 IO（避免单测写入 storage/uploads）
vi.mock('#services/file_storage', async (importOriginal) => {
  const actual = await importOriginal<typeof import('#services/file_storage')>()
  return {
    ...actual,
    ensureDir: vi.fn().mockResolvedValue(undefined),
    getTempDir: vi.fn().mockReturnValue('/tmp/upload-mime-test/_temp'),
    getAttachmentDir: vi.fn().mockReturnValue('/tmp/upload-mime-test/final'),
    moveToFinal: vi.fn().mockResolvedValue(undefined),
  }
})

import Attachment from '#models/attachment'
import type { MultipartFile } from '@adonisjs/core/bodyparser'

/** 构造一个仅暴露 upload 所需字段的假 MultipartFile。 */
function makeFile(overrides: {
  clientName?: string
  size?: number
  type?: string
  subtype?: string
}): MultipartFile {
  return {
    clientName: overrides.clientName ?? 'test.png',
    size: overrides.size ?? 1024,
    type: overrides.type,
    subtype: overrides.subtype,
    move: vi.fn(async () => {}),
  } as unknown as MultipartFile
}

function makeService(): FileService {
  return new FileService(new AuditService(), new NotificationService())
}

const uploadParams = {
  organizationId: 1,
  projectId: 1,
  entityType: 'project' as string,
  entityId: 1,
  userId: 1,
  requestId: 'req-test',
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(Attachment.create).mockResolvedValue({
    id: BigInt(1),
    fileName: 'x',
    filePath: '',
    save: vi.fn().mockResolvedValue(undefined),
    delete: vi.fn().mockResolvedValue(undefined),
  } as never)
})

describe('FileService.upload MIME 校验', () => {
  it('image/png 上传成功，落库 mimeType 为完整 MIME', async () => {
    const service = makeService()
    const result = await service.upload({
      ...uploadParams,
      file: makeFile({ clientName: 'screenshot.png', type: 'image', subtype: 'png' }),
    })

    expect(result).toBeDefined()
    // 回归点：旧实现用主类型 `image` 比白名单（含 `image/png`）必然 422，此处必须通过
    expect(vi.mocked(Attachment.create)).toHaveBeenCalledWith(
      expect.objectContaining({ mimeType: 'image/png' }),
    )
  })

  it('application/pdf 上传成功，落库 mimeType 为完整 MIME', async () => {
    const service = makeService()
    const result = await service.upload({
      ...uploadParams,
      file: makeFile({ clientName: 'report.pdf', type: 'application', subtype: 'pdf' }),
    })

    expect(result).toBeDefined()
    expect(vi.mocked(Attachment.create)).toHaveBeenCalledWith(
      expect.objectContaining({ mimeType: 'application/pdf' }),
    )
  })

  it('扩展名合法但 MIME 不在白名单时 422', async () => {
    const service = makeService()
    // txt 扩展名在白名单，text/html 完整 MIME 不在白名单
    await expect(
      service.upload({
        ...uploadParams,
        file: makeFile({ clientName: 'evil.txt', type: 'text', subtype: 'html' }),
      }),
    ).rejects.toMatchObject({ message: expect.stringContaining('不支持的文件格式') })
    expect(vi.mocked(Attachment.create)).not.toHaveBeenCalled()
  })

  it('无 content-type（type/subtype 缺省）时不做 MIME 拦截（保持宽松）', async () => {
    const service = makeService()
    const result = await service.upload({
      ...uploadParams,
      // txt 扩展名合法；客户端未带 content-type 时 type/subtype 为 undefined
      file: makeFile({ clientName: 'notes.txt', type: undefined, subtype: undefined }),
    })

    expect(result).toBeDefined()
    expect(vi.mocked(Attachment.create)).toHaveBeenCalledWith(
      expect.objectContaining({ mimeType: null }),
    )
  })

  it('白名单收录主/子类型拼接后的完整 MIME', () => {
    // 防回归夹具：若白名单只含主类型，本测试即失败
    expect(ALLOWED_MIME_TYPES.has('image/png')).toBe(true)
    expect(ALLOWED_MIME_TYPES.has('application/pdf')).toBe(true)
    expect(ALLOWED_MIME_TYPES.has('text/html')).toBe(false)
  })
})
