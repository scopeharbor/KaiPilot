import { apiFetch, apiFetchEnvelope } from '@/lib/api-client'

/** 文件夹/文档类型。 */
export type DocumentType = 'folder' | 'document' | 'template'

/** 文档对象。 */
export interface Document {
  id: number
  projectId: number
  parentId: number | null
  name: string
  documentType: DocumentType
  content: string | null
  version: number
  createdBy: number | null
  updatedBy: number | null
  createdAt: string
  updatedAt: string | null
  deletedAt: string | null
}

/** 附件对象。 */
export interface Attachment {
  id: number
  entityType: string
  entityId: number
  projectId: number | null
  uploadedBy: number | null
  fileName: string
  filePath: string
  fileSize: number
  mimeType: string | null
  thumbnailPath: string | null
  storageProvider: string
  currentVersion: number
  deletedAt: string | null
  createdAt: string
  updatedAt: string | null
  uploader?: {
    id: number
    fullName: string | null
    email: string
  }
}

/** 分页响应。 */
export interface PaginatedDocuments {
  data: Document[]
  meta: { total: number; page: number; perPage: number; totalPages: number }
}

export interface PaginatedAttachments {
  data: Attachment[]
  meta: { total: number; page: number; perPage: number; totalPages: number }
}

/** 文件列表查询参数。 */
export interface FileListFilters {
  parentId?: number | null
  search?: string
  documentType?: DocumentType
  page?: number
  perPage?: number
}

/** 附件列表查询参数。 */
export interface AttachmentListFilters {
  entityType?: string
  entityId?: number
  search?: string
  page?: number
  perPage?: number
}

/** 创建文档输入。 */
export interface CreateDocumentInput {
  name: string
  documentType?: DocumentType
  parentId?: number | null
  content?: string | null
}

/** 创建附件输入（元数据）。 */
export interface CreateAttachmentInput {
  entityType: string
  entityId: number
}

// ===== V2 文件管理类型 =====

/** 附件版本。 */
export interface AttachmentVersion {
  id: number
  attachmentId: number
  versionNo: number
  fileSize: number
  mimeType: string | null
  fileName: string
  checksumSha256: string | null
  changeNote: string | null
  createdBy: number | null
  createdAt: string
}

/** 文件标签。 */
export interface FileTag {
  id: number
  projectId: number
  organizationId: number
  name: string
  color: string | null
  createdBy: number | null
  createdAt: string
  updatedAt: string | null
}

/** 文件实体关联。 */
export interface FileEntityLink {
  id: number
  fileType: string
  fileId: number
  entityType: string
  entityId: number
  linkType: string
  organizationId: number
  projectId: number
  createdBy: number | null
  createdAt: string
}

/** 搜索查询参数。 */
export interface SearchFilters {
  q: string
  fileType?: string
  mimeType?: string
  entityType?: string
  uploadedBy?: number
  dateFrom?: string
  dateTo?: string
  page?: number
  perPage?: number
}

/** 批量操作项。 */
export interface BatchItem {
  fileType: 'attachment' | 'document'
  fileId: number
}

/** 批量操作结果项目。 */
export interface BatchItemResult {
  fileType: string
  fileId: number
  success: boolean
  error?: string
}

/** 批量操作结果。 */
export interface BatchResult {
  success: BatchItemResult[]
  failed: BatchItemResult[]
}

// === 文件库 API ===

const filesBase = (projectId: number) => `/projects/${projectId}/files`

export const filesApi = {
  /** 列出文件库内容。 */
  list: (projectId: number, filters: FileListFilters = {}) =>
    apiFetchEnvelope<PaginatedDocuments>(`${filesBase(projectId)}${buildQuery(filters)}`),

  /** 创建文件夹或文档。 */
  create: (projectId: number, input: CreateDocumentInput) =>
    apiFetch<Document>(filesBase(projectId), {
      method: 'POST',
      body: JSON.stringify(input),
    }),

  /** 重命名文档。 */
  rename: (projectId: number, documentId: number, name: string) =>
    apiFetch<Document>(`${filesBase(projectId)}/${documentId}/rename`, {
      method: 'PATCH',
      body: JSON.stringify({ name }),
    }),

  /** 移动文档。 */
  move: (projectId: number, documentId: number, parentId: number | null) =>
    apiFetch<Document>(`${filesBase(projectId)}/${documentId}/move`, {
      method: 'POST',
      body: JSON.stringify({ parentId }),
    }),

  /** 删除文档。 */
  delete: (projectId: number, documentId: number) =>
    apiFetch<void>(`${filesBase(projectId)}/${documentId}`, { method: 'DELETE' }),
}

// === 附件 API ===

const attachmentsBase = (projectId: number) => `/projects/${projectId}/attachments`

export const attachmentsApi = {
  /** 列出附件。 */
  list: (projectId: number, filters: AttachmentListFilters = {}) =>
    apiFetchEnvelope<PaginatedAttachments>(`${attachmentsBase(projectId)}${buildQuery(filters)}`),

  /** 上传附件（FormData）。 */
  upload: async (projectId: number, input: CreateAttachmentInput, file: File) => {
    const formData = new FormData()
    formData.append('file', file)
    formData.append('entityType', input.entityType)
    formData.append('entityId', String(input.entityId))

    // 走统一 apiFetch：带 access token、401 时静默刷新（原先裸 fetch 只带 cookie，后端一律 401）
    return apiFetch<Attachment>(attachmentsBase(projectId), { method: 'POST', body: formData })
  },

  /** 下载附件。 */
  getDownloadUrl: (projectId: number, attachmentId: number) =>
    `${process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3333/api/v1'}${attachmentsBase(projectId)}/${attachmentId}/download`,

  /** 删除附件。 */
  delete: (projectId: number, attachmentId: number) =>
    apiFetch<void>(`${attachmentsBase(projectId)}/${attachmentId}`, { method: 'DELETE' }),
}

// === V2 文件管理 API ===

const filesV2Base = (projectId: number) => `/projects/${projectId}/files/v2`

export const filesV2Api = {
  // ---- 版本 ----
  uploadVersion: async (
    projectId: number,
    attachmentId: number,
    file: File,
    changeNote?: string,
  ) => {
    const formData = new FormData()
    formData.append('file', file)
    if (changeNote) formData.append('changeNote', changeNote)

    return apiFetch<AttachmentVersion>(
      `${filesV2Base(projectId)}/attachments/${attachmentId}/versions`,
      { method: 'POST', body: formData },
    )
  },

  listVersions: (projectId: number, attachmentId: number) =>
    apiFetchEnvelope<{ data: AttachmentVersion[] }>(
      `${filesV2Base(projectId)}/attachments/${attachmentId}/versions`,
    ),

  getVersionDownloadUrl: (projectId: number, versionId: number) =>
    `${process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3333/api/v1'}${filesV2Base(projectId)}/versions/${versionId}/download`,

  rollbackVersion: (projectId: number, attachmentId: number, targetVersionNo: number) =>
    apiFetch<AttachmentVersion>(
      `${filesV2Base(projectId)}/attachments/${attachmentId}/versions/rollback`,
      { method: 'POST', body: JSON.stringify({ targetVersionNo }) },
    ),

  // ---- 标签 ----
  listTags: (projectId: number) =>
    apiFetchEnvelope<{ data: FileTag[] }>(`${filesV2Base(projectId)}/tags`),

  createTag: (projectId: number, input: { name: string; color?: string | null }) =>
    apiFetch<FileTag>(`${filesV2Base(projectId)}/tags`, {
      method: 'POST',
      body: JSON.stringify(input),
    }),

  updateTag: (projectId: number, tagId: number, input: { name?: string; color?: string }) =>
    apiFetch<FileTag>(`${filesV2Base(projectId)}/tags/${tagId}`, {
      method: 'PATCH',
      body: JSON.stringify(input),
    }),

  deleteTag: (projectId: number, tagId: number) =>
    apiFetch<void>(`${filesV2Base(projectId)}/tags/${tagId}`, { method: 'DELETE' }),

  assignTags: (projectId: number, input: { fileType: string; fileId: number; tagIds: number[] }) =>
    apiFetch<void>(`${filesV2Base(projectId)}/tags/assign`, {
      method: 'POST',
      body: JSON.stringify(input),
    }),

  // ---- 实体关联 ----
  createLink: (
    projectId: number,
    input: {
      fileType: string
      fileId: number
      entityType: string
      entityId: number
      linkType?: string
    },
  ) =>
    apiFetch<FileEntityLink>(`${filesV2Base(projectId)}/links`, {
      method: 'POST',
      body: JSON.stringify(input),
    }),

  deleteLink: (projectId: number, linkId: number) =>
    apiFetch<void>(`${filesV2Base(projectId)}/links/${linkId}`, { method: 'DELETE' }),

  listEntityFiles: (projectId: number, entityType: string, entityId: number) =>
    apiFetchEnvelope<{ data: Attachment[] }>(
      `${filesV2Base(projectId)}/entity/${entityType}/${entityId}`,
    ),

  // ---- 搜索 ----
  search: (projectId: number, filters: SearchFilters) =>
    apiFetchEnvelope<{
      data: Attachment[]
      meta: { total: number; page: number; perPage: number; totalPages: number }
    }>(`${filesV2Base(projectId)}/search${buildQuery(filters)}`),

  // ---- 回收站 ----
  listTrash: (
    projectId: number,
    filters: { page?: number; perPage?: number; search?: string } = {},
  ) =>
    apiFetchEnvelope<{
      data: Attachment[]
      meta: { total: number; page: number; perPage: number; totalPages: number }
    }>(`${filesV2Base(projectId)}/trash${buildQuery(filters)}`),

  trash: (projectId: number, attachmentId: number, reason?: string) =>
    apiFetch<void>(`${filesV2Base(projectId)}/trash/${attachmentId}`, {
      method: 'POST',
      body: JSON.stringify({ reason }),
    }),

  restore: (projectId: number, attachmentId: number) =>
    apiFetch<void>(`${filesV2Base(projectId)}/trash/${attachmentId}/restore`, { method: 'POST' }),

  permanentDelete: (projectId: number, attachmentId: number) =>
    apiFetch<void>(`${filesV2Base(projectId)}/trash/${attachmentId}/permanent`, {
      method: 'DELETE',
    }),

  // ---- 批量操作 ----
  batchDelete: (projectId: number, items: BatchItem[]) =>
    apiFetch<BatchResult>(`${filesV2Base(projectId)}/batch/delete`, {
      method: 'POST',
      body: JSON.stringify({ items }),
    }),

  batchRestore: (projectId: number, items: BatchItem[]) =>
    apiFetch<BatchResult>(`${filesV2Base(projectId)}/batch/restore`, {
      method: 'POST',
      body: JSON.stringify({ items }),
    }),

  batchPermanentDelete: (projectId: number, items: BatchItem[]) =>
    apiFetch<BatchResult>(`${filesV2Base(projectId)}/batch/permanent`, {
      method: 'DELETE',
      body: JSON.stringify({ items }),
    }),

  batchTag: (projectId: number, items: BatchItem[], tagIds: number[]) =>
    apiFetch<BatchResult>(`${filesV2Base(projectId)}/batch/tag`, {
      method: 'POST',
      body: JSON.stringify({ items, tagIds }),
    }),
}

// === TanStack Query Keys ===

export const fileKeys = {
  all: ['files'] as const,
  lists: (projectId: number) => [...fileKeys.all, 'list', projectId] as const,
  list: (projectId: number, filters: FileListFilters) =>
    [...fileKeys.lists(projectId), filters] as const,
  documents: (projectId: number) => [...fileKeys.all, 'documents', projectId] as const,
  document: (projectId: number, documentId: number) =>
    [...fileKeys.documents(projectId), documentId] as const,
  // V2
  tags: (projectId: number) => [...fileKeys.all, 'tags', projectId] as const,
  trash: (projectId: number) => [...fileKeys.all, 'trash', projectId] as const,
  search: (projectId: number) => [...fileKeys.all, 'search', projectId] as const,
  versions: (projectId: number, attachmentId: number) =>
    [...fileKeys.all, 'versions', projectId, attachmentId] as const,
  entityLinks: (projectId: number, entityType: string, entityId: number) =>
    [...fileKeys.all, 'links', projectId, entityType, entityId] as const,
}

export const attachmentKeys = {
  all: ['attachments'] as const,
  lists: (projectId: number) => [...attachmentKeys.all, 'list', projectId] as const,
  list: (projectId: number, filters: AttachmentListFilters) =>
    [...attachmentKeys.lists(projectId), filters] as const,
  entity: (projectId: number, entityType: string, entityId: number) =>
    [...attachmentKeys.all, 'entity', projectId, entityType, entityId] as const,
}

// === 辅助函数 ===

function buildQuery(filters: object): string {
  const query = new URLSearchParams()
  for (const [key, value] of Object.entries(filters)) {
    if (value !== undefined && value !== null) {
      query.set(key, String(value))
    }
  }
  return query.size ? `?${query.toString()}` : ''
}

// === Markdown 导入/导出（v3-document-markdown-import-export §6.1） ===

import type {
  MarkdownExportSingleRequest,
  MarkdownExportSingleResult,
  MarkdownExportTreeRequest,
  MarkdownExportTreeResult,
  MarkdownImportConfirmRequest,
  MarkdownImportConfirmResult,
  MarkdownImportPreview,
  MarkdownImportPreviewRequest,
} from '@aiproj/types'

const markdownBase = (projectId: number) => `${filesBase(projectId)}/markdown`

/** 项目文档 Markdown 确定性导入/导出 API（只读或显式确认后写入）。 */
export const documentMarkdownApi = {
  /** 导入预览：服务端归一化/标题推断/警告检测，不写库。 */
  previewImport: (projectId: number, input: MarkdownImportPreviewRequest) =>
    apiFetch<MarkdownImportPreview>(`${markdownBase(projectId)}/import/preview`, {
      method: 'POST',
      body: JSON.stringify(input),
    }),

  /** 导入确认：须携带 previewHash 与 confirmed=true；replace 需 expectedSourceDocumentHash。 */
  confirmImport: (projectId: number, input: MarkdownImportConfirmRequest) =>
    apiFetch<MarkdownImportConfirmResult>(`${markdownBase(projectId)}/import/confirm`, {
      method: 'POST',
      body: JSON.stringify(input),
    }),

  /** 单文档导出：返回 { data } 信封，附 Content-Disposition 下载头。 */
  exportSingle: (projectId: number, input: MarkdownExportSingleRequest) =>
    apiFetch<MarkdownExportSingleResult>(`${markdownBase(projectId)}/export/${input.documentId}`),

  /** 选中树 bundle 导出：确定性 manifest + 拼接 Markdown。 */
  exportTree: (projectId: number, input: MarkdownExportTreeRequest) =>
    apiFetch<MarkdownExportTreeResult>(`${markdownBase(projectId)}/export/tree`, {
      method: 'POST',
      body: JSON.stringify(input),
    }),
}

// === 文档内容只读（v3-document-code-block-support §5.1） ===

import type { DocumentContentResponse } from '@aiproj/types'

/** 读取文档正文与代码块元数据。 */
export const documentContentApi = {
  get: (projectId: number, documentId: number) =>
    apiFetch<DocumentContentResponse>(`${filesBase(projectId)}/${documentId}/content`),
}

/** 记录公式 TeX 源码复制低敏审计事件。 */
export function reportFormulaCopied(
  projectId: number,
  documentId: number,
  formulaInlineCount: number,
  formulaBlockCount: number,
): Promise<Response> {
  return apiFetch(`${filesBase(projectId)}/${documentId}/formula-copied`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ formulaInlineCount, formulaBlockCount }),
  })
}
