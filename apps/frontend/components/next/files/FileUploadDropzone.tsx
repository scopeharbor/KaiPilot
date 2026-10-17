'use client'

import * as React from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { AlertTriangle, CheckCircle2, Loader2, Lock, RotateCcw, UploadCloud } from 'lucide-react'
import { attachmentsApi, attachmentKeys, type Attachment } from '@/lib/api/files'
import {
  ALLOWED_UPLOAD_EXTENSIONS_LABEL,
  MAX_FILE_SIZE_LABEL,
  validateUploadFile,
} from '@/lib/next/files/file-helpers'
import { cn } from '@/lib/utils'

/**
 * 附件拖拽上传释放区（v3-ui-next-resource-team-domains W3 · tasks 3.5，
 * design §4.2「附件拖拽上传与规格预检」）。
 *
 * - 原生 HTML5 拖拽（dragenter/dragover/dragleave/drop）+ 点击选择文件双入口；
 * - 前端规格预检：10MB 单文件上限 / 扩展名白名单（与既有服务端上传契约
 *   `size: '10mb'` + extnames 逐项对齐）/ 0 字节空文件拦截，失败立即红色警示，
 *   底层零网络外发（RL-06）；预检通过才组装 FormData 调用 `attachmentsApi.upload`
 *   （entityType=project / entityId=projectId）；
 * - 上传期间展示文件名 + 百分比进度条（fetch 无原生上传进度，采用确定性节拍
 *   模拟逼近，成功后定格 100%）；
 * - 成功后自动失效附件列表缓存（新附件位于底册首行）+ 短暂成功态；
 *   失败展示错误原因并提供「重试」入口（pending 文件保留）；
 * - 权限防护：无 file:manage（props.canManage=false）时释放区物理禁用，
 *   拖拽/点击零副作用（RL-06）。
 */

export interface FileUploadDropzoneProps {
  projectId: number
  /** file:manage 判定：false 时释放区整体禁用（仅可查看，禁止上传）。 */
  canManage: boolean
  /** 上传成功回调（新附件对象；用于工作台统计等联动）。 */
  onUploaded?: (attachment: Attachment) => void
}

type UploadPhase = 'idle' | 'uploading' | 'success' | 'error'

/** 进度节拍（fetch 无原生上传进度事件，确定性模拟逼近：每 250ms +8，封顶 90）。 */
const PROGRESS_TICK_MS = 250
const PROGRESS_TICK_STEP = 8
const PROGRESS_CAP = 90
/** 成功态驻留时长后自动复位。 */
const SUCCESS_HOLD_MS = 2400

function errorMessageOf(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message) return error.message
  if (typeof error === 'object' && error !== null && 'message' in error) {
    const message = (error as { message?: unknown }).message
    if (typeof message === 'string' && message) return message
  }
  return fallback
}

export function FileUploadDropzone({ projectId, canManage, onUploaded }: FileUploadDropzoneProps) {
  const queryClient = useQueryClient()
  const inputRef = React.useRef<HTMLInputElement | null>(null)
  const mountedRef = React.useRef(true)

  const [dragActive, setDragActive] = React.useState(false)
  const [phase, setPhase] = React.useState<UploadPhase>('idle')
  const [progress, setProgress] = React.useState(0)
  const [uploadedName, setUploadedName] = React.useState<string | null>(null)
  const [errorMessage, setErrorMessage] = React.useState<string | null>(null)
  /** 仅上传请求失败（非规格预检失败）时提供重试入口。 */
  const [retryable, setRetryable] = React.useState(false)
  const pendingFileRef = React.useRef<File | null>(null)
  const progressTimerRef = React.useRef<number | null>(null)
  const resetTimerRef = React.useRef<number | null>(null)

  React.useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      if (progressTimerRef.current !== null) window.clearInterval(progressTimerRef.current)
      if (resetTimerRef.current !== null) window.clearTimeout(resetTimerRef.current)
    }
  }, [])

  const clearProgressTimer = () => {
    if (progressTimerRef.current !== null) {
      window.clearInterval(progressTimerRef.current)
      progressTimerRef.current = null
    }
  }

  const clearResetTimer = () => {
    if (resetTimerRef.current !== null) {
      window.clearTimeout(resetTimerRef.current)
      resetTimerRef.current = null
    }
  }

  const busy = phase === 'uploading' || phase === 'success'

  const startUpload = React.useCallback(
    async (file: File) => {
      if (!canManage || busy) return

      // 规格预检：失败立即阻断（零网络外发，RL-06）。
      const validation = validateUploadFile(file)
      if (!validation.ok) {
        pendingFileRef.current = null
        setRetryable(false)
        setErrorMessage(validation.message)
        setPhase('error')
        return
      }

      pendingFileRef.current = file
      setRetryable(true)
      setUploadedName(null)
      setErrorMessage(null)
      setPhase('uploading')
      setProgress(6)
      clearProgressTimer()
      progressTimerRef.current = window.setInterval(() => {
        setProgress((value) => (value >= PROGRESS_CAP ? PROGRESS_CAP : value + PROGRESS_TICK_STEP))
      }, PROGRESS_TICK_MS)

      try {
        const uploaded = await attachmentsApi.upload(
          projectId,
          { entityType: 'project', entityId: projectId },
          file,
        )
        if (!mountedRef.current) return
        clearProgressTimer()
        setProgress(100)
        setPhase('success')
        setUploadedName(uploaded?.fileName ?? file.name)
        onUploaded?.(uploaded)
        void queryClient.invalidateQueries({ queryKey: attachmentKeys.lists(projectId) })
        clearResetTimer()
        resetTimerRef.current = window.setTimeout(() => {
          if (!mountedRef.current) return
          setPhase('idle')
          setProgress(0)
          setUploadedName(null)
          setRetryable(false)
          pendingFileRef.current = null
        }, SUCCESS_HOLD_MS)
      } catch (error) {
        if (!mountedRef.current) return
        clearProgressTimer()
        setPhase('error')
        setErrorMessage(errorMessageOf(error, '上传失败，请重试'))
      }
    },
    [canManage, busy, projectId, queryClient, onUploaded],
  )

  const handleFilesFromInput = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (file) void startUpload(file)
  }

  const openPicker = () => {
    if (!canManage || busy) return
    inputRef.current?.click()
  }

  // ---- HTML5 原生拖拽事件（dragenter/dragover 高亮，dragleave/drop 复位） ----
  const handleDragEnter = (event: React.DragEvent<HTMLDivElement>) => {
    if (!canManage || busy) return
    event.preventDefault()
    setDragActive(true)
  }

  const handleDragOver = (event: React.DragEvent<HTMLDivElement>) => {
    if (!canManage || busy) return
    event.preventDefault()
    event.dataTransfer.dropEffect = 'copy'
    setDragActive(true)
  }

  const handleDragLeave = (event: React.DragEvent<HTMLDivElement>) => {
    if (!canManage || busy) return
    event.preventDefault()
    setDragActive(false)
  }

  const handleDrop = (event: React.DragEvent<HTMLDivElement>) => {
    if (!canManage || busy) return
    event.preventDefault()
    setDragActive(false)
    const file = event.dataTransfer.files?.[0]
    if (file) void startUpload(file)
  }

  const isDisabled = !canManage || phase === 'uploading'

  return (
    <div
      data-file-dropzone
      data-file-dropzone-active={dragActive || undefined}
      data-phase={phase}
      data-file-dropzone-disabled={!canManage || undefined}
      onClick={openPicker}
      onKeyDown={(event) => {
        if ((event.key === 'Enter' || event.key === ' ') && canManage && !busy) {
          event.preventDefault()
          openPicker()
        }
      }}
      onDragEnter={handleDragEnter}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      role={canManage ? 'button' : undefined}
      tabIndex={canManage ? 0 : -1}
      aria-disabled={isDisabled}
      aria-label="上传附件：点击选择文件或将文件拖入此区域"
      className={cn(
        'flex min-h-28 cursor-pointer select-none flex-col items-center justify-center gap-2 rounded-md border border-dashed px-6 py-6 text-center transition-colors',
        !canManage
          ? 'cursor-not-allowed border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)] opacity-70'
          : dragActive
            ? 'border-[var(--nx-border-focus)] bg-[var(--nx-space-surface)]'
            : 'border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)] hover:border-[var(--nx-border-focus)]',
      )}
    >
      <input
        ref={inputRef}
        type="file"
        data-file-input
        aria-label="选择上传文件"
        className="hidden"
        disabled={!canManage || phase === 'uploading'}
        onChange={handleFilesFromInput}
      />

      {/* 权限缺失态：物理禁用（RL-06），拖拽/点击零副作用 */}
      {!canManage ? (
        <>
          <Lock className="h-6 w-6 text-[var(--nx-text-muted)]" aria-hidden />
          <p className="text-xs text-[var(--nx-text-secondary)]">
            当前为只读模式，上传需 file:manage 权限
          </p>
          <p className="text-[10px] text-[var(--nx-text-muted)]">
            请联系项目负责人开通权限后可拖拽或选择文件上传
          </p>
        </>
      ) : null}

      {/* 闲置 / 拖拽高亮态 */}
      {canManage && phase === 'idle' ? (
        <>
          <UploadCloud
            className={cn(
              'h-6 w-6',
              dragActive ? 'text-[var(--nx-accent)]' : 'text-[var(--nx-text-muted)]',
            )}
            aria-hidden
          />
          <p className="text-[13px] text-[var(--nx-text-primary)]">
            {dragActive ? '释放即可上传' : '点击上传文件或将文件拖入此区域'}
          </p>
          <p className="text-[10px] text-[var(--nx-text-muted)]">
            单文件不超过 {MAX_FILE_SIZE_LABEL} · 支持 {ALLOWED_UPLOAD_EXTENSIONS_LABEL} 格式 · 禁止
            0 字节空文件
          </p>
        </>
      ) : null}

      {/* 上传中：文件名 + 百分比进度条 */}
      {canManage && phase === 'uploading' ? (
        <>
          <div className="flex items-center gap-2">
            <Loader2 className="h-4 w-4 animate-spin text-[var(--nx-accent)]" aria-hidden />
            <p className="max-w-xs truncate text-[12px] text-[var(--nx-text-secondary)]">
              <span data-file-upload-name>{pendingFileRef.current?.name}</span>
              <span className="ml-1 text-[var(--nx-text-muted)]">上传中…</span>
            </p>
          </div>
          <div
            role="progressbar"
            aria-label="上传进度"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={progress}
            className="h-1.5 w-full max-w-sm overflow-hidden rounded-full bg-[var(--nx-bg-1)]"
          >
            <div
              className="h-full rounded-full bg-[var(--nx-accent)] transition-[width] duration-150"
              style={{ width: `${progress}%` }}
            />
          </div>
          <p
            data-file-upload-progress
            className="font-mono text-[11px] text-[var(--nx-text-muted)]"
          >
            {progress}%
          </p>
        </>
      ) : null}

      {/* 成功态：绿勾 + 文件名（驻留后自动复位） */}
      {canManage && phase === 'success' ? (
        <>
          <CheckCircle2 className="h-6 w-6 text-[var(--nx-status-success)]" aria-hidden />
          <p data-file-upload-success className="text-[13px] text-[var(--nx-text-primary)]">
            上传成功：<span className="text-[var(--nx-status-success)]">{uploadedName}</span>
          </p>
        </>
      ) : null}

      {/* 错误态：红色警示 + （上传请求失败时）重试入口 */}
      {canManage && phase === 'error' ? (
        <>
          <AlertTriangle className="h-6 w-6 text-[var(--nx-status-danger)]" aria-hidden />
          <p
            role="alert"
            data-file-upload-error
            aria-label="上传失败"
            className="max-w-md text-[13px] text-[var(--nx-status-danger)]"
          >
            {errorMessage}
          </p>
          {retryable && pendingFileRef.current ? (
            <button
              type="button"
              data-file-upload-retry
              onClick={(event) => {
                event.stopPropagation()
                const file = pendingFileRef.current
                if (file) void startUpload(file)
              }}
              className="flex h-8 items-center gap-1.5 rounded-md border border-[var(--nx-border-focus)] bg-[var(--nx-bg-1)] px-3 text-xs text-[var(--nx-accent)] transition-colors hover:border-[var(--nx-accent)]"
            >
              <RotateCcw className="h-3.5 w-3.5" aria-hidden />
              重试上传
            </button>
          ) : null}
        </>
      ) : null}
    </div>
  )
}

export default FileUploadDropzone
