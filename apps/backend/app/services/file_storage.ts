import { randomUUID } from 'node:crypto'
import { join, resolve, extname, basename } from 'node:path'
import { mkdir, rename, unlink, access } from 'node:fs/promises'
import logger from '@adonisjs/core/services/logger'

/**
 * 文件存储工具：本地文件系统上传目录配置、安全文件名生成、临时/最终目录管理。
 * V1 仅本地存储，路径由服务端生成，禁止客户端影响磁盘位置。
 */

/** 上传根目录（可通过环境变量覆盖）。 */
const UPLOAD_ROOT = process.env.UPLOAD_ROOT ?? 'storage/uploads'

/** 最大文件大小 10MB。 */
export const MAX_FILE_SIZE = 10 * 1024 * 1024

/** V1 白名单 MIME 类型。 */
export const ALLOWED_MIME_TYPES = new Set([
  'application/pdf',
  'text/markdown',
  'text/plain',
  'text/csv',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'image/png',
  'image/jpeg',
  'image/webp',
])

/** V1 白名单扩展名（不含点）。 */
export const ALLOWED_EXTENSIONS = new Set([
  'pdf',
  'md',
  'txt',
  'csv',
  'docx',
  'xlsx',
  'pptx',
  'png',
  'jpg',
  'jpeg',
  'webp',
])

/** 允许的实体类型白名单。 */
export const ALLOWED_ENTITY_TYPES = new Set([
  'project',
  'task',
  'milestone',
  'risk',
  'document',
  'change_request',
  'comment',
])

/**
 * 生成安全文件名：去除路径片段，使用 UUID 避免冲突。
 * @param originalName 客户端提交的原始文件名
 * @returns 安全的展示名和服务端文件名
 */
export function sanitizeFileName(originalName: string): { displayName: string; safeName: string } {
  // 取基本文件名，去除路径片段
  const base = basename(originalName).replace(/[\\/]/g, '')
  // 去除危险字符
  const cleaned = base.replace(/[^a-zA-Z0-9._\-\u4e00-\u9fff]/g, '_').slice(0, 200)
  const ext = extname(cleaned).toLowerCase()
  const stem = cleaned.slice(0, cleaned.length - ext.length) || 'file'
  const safeName = `${stem}_${randomUUID().slice(0, 8)}${ext}`
  return { displayName: cleaned, safeName }
}

/**
 * 获取项目上传目录。
 */
export function getProjectUploadDir(projectId: number): string {
  return join(UPLOAD_ROOT, 'projects', String(projectId))
}

/**
 * 获取附件最终存储目录。
 */
export function getAttachmentDir(projectId: number, attachmentId: number): string {
  return join(getProjectUploadDir(projectId), String(attachmentId))
}

/**
 * 获取临时上传目录。
 */
export function getTempDir(projectId: number): string {
  return join(getProjectUploadDir(projectId), '_temp')
}

/**
 * 确保目录存在。
 */
export async function ensureDir(dir: string): Promise<void> {
  await mkdir(dir, { recursive: true })
}

/**
 * 验证路径是否在允许的根目录内（防止路径穿越）。
 */
export function isPathSafe(filePath: string, rootDir: string): boolean {
  // 使用 resolve 解析真实路径（处理 ../ 等）
  const resolved = resolve(rootDir, filePath)
  const resolvedRoot = resolve(rootDir)
  return resolved.startsWith(resolvedRoot)
}

/**
 * 移动临时文件到最终目录。
 */
export async function moveToFinal(tempPath: string, finalPath: string): Promise<void> {
  await ensureDir(join(finalPath, '..'))
  await rename(tempPath, finalPath)
}

/**
 * 删除文件，失败只记日志不抛错。
 */
export async function safeUnlink(filePath: string): Promise<boolean> {
  try {
    await unlink(filePath)
    return true
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return true
    }
    logger.warn({ err: error, path: filePath }, 'failed to delete file')
    return false
  }
}

/**
 * 检查文件是否存在。
 */
export async function fileExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath)
    return true
  } catch {
    return false
  }
}
