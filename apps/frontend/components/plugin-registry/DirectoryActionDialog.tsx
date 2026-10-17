/**
 * v3-organization-private-plugin-directory — DirectoryActionDialog（task 4.3）。
 *
 * 审批 / 禁用 / 恢复 / 回滚四个受控管理动作的统一对话框。
 *
 * 三条不可妥协的表达红线：
 * 1. **目录 release ≠ 安装实例**：每屏都用两块分区把「本次改的是目录条目」与
 *    「组织内已安装的实例」显式分开；禁用只改前者，后者逐行保持不变。
 * 2. **提交 ≠ 生效**：创建后停在「已提交，等待他人审批」，不自动串联审批与确认；
 *    审批完成也只是可确认，最终确认按钮独立且需要一次性句柄。
 * 3. **阻断项存在即不可提交**：回滚预览列出 blocking findings 时提交按钮禁用，
 *    并逐条说明原因（与后端同源判定，前端只是复述，不做本地放行）。
 *
 * 文案为简体中文且不含任何公开市场/上架/评分/计费措辞。
 */
'use client'

import { useMemo, useState } from 'react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/Dialog'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Skeleton } from '@/components/ui/Skeleton'
import {
  useAffectedInstallations,
  useConfirmDirectoryChange,
  useCreateDirectoryChange,
  useDirectoryRollbackPreview,
} from '@/hooks/use-plugin-directory'
import { approvePluginChangeRequest, issueConfirmHandle } from '@/lib/api/plugin-change-requests'
import { selectEffectiveOrganizationId, useAuthStore } from '@/stores/auth-store'
import type {
  DirectoryChangeAction,
  DirectoryRollbackBlockingCode,
} from '@/lib/api/plugin-directory'

// =============================================================================
// 文案词表
// =============================================================================

const ACTION_TITLES: Record<DirectoryChangeAction, string> = {
  approve: '批准此版本进入组织目录',
  disable: '停止分发此版本',
  restore: '恢复此版本重新送审',
  rollback: '回滚推荐版本',
}

const ACTION_DESCRIPTIONS: Record<DirectoryChangeAction, string> = {
  approve: '批准后本组织成员可在目录中发现并安装该版本。审批与最终确认分两步，均需人工操作。',
  disable: '停止分发只影响目录的可发现性，已安装实例保持原状，不会被停用或卸载。',
  restore: '恢复会让该版本重新回到送审流程，需要再次通过审批与兼容性检查才能分发。',
  rollback: '回滚只切换目录的推荐版本指针；已安装实例不会被自动降级。',
}

/** 主按钮文案：一律表述为「提交」，与「生效」区分开。 */
const ACTION_SUBMIT_LABELS: Record<DirectoryChangeAction, string> = {
  approve: '提交批准申请',
  disable: '提交停止分发申请',
  restore: '提交恢复申请',
  rollback: '提交回滚申请',
}

const BLOCKING_LABELS: Record<DirectoryRollbackBlockingCode, string> = {
  'rollback-target-not-approved': '目标版本未处于已批准状态，不能作为回滚目标。',
  'rollback-target-integrity-incomplete': '目标版本的完整性信息不完整，无法校验制品。',
  'rollback-target-incompatible': '目标版本与当前宿主不兼容，回滚会破坏运行时。',
  'rollback-permission-elevation': '目标版本声明了更多权限，提权须走权限升级流程，不能借回滚完成。',
  'rollback-target-missing': '目标版本不存在或已不可用。',
}

const INSTALLATION_STATUS_LABELS: Record<string, string> = {
  enabled: '已启用',
  installed: '未启用',
  uninstalled: '已卸载',
}

// =============================================================================
// 分区：目录条目 vs 安装实例
// =============================================================================

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <h4 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
      {children}
    </h4>
  )
}

function DiffRow({ label, before, after }: { label: string; before: string; after: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3 text-xs">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-mono">
        <span className="text-muted-foreground line-through">{before}</span>
        <span className="mx-1.5 text-muted-foreground">→</span>
        <span className="text-foreground">{after}</span>
      </span>
    </div>
  )
}

function shortDigest(value: string | null): string {
  if (!value) return '—'
  return value.length > 14 ? `${value.slice(0, 14)}…` : value
}

/** 目录条目分区：本次动作实际改动的对象。 */
function DirectoryTargetSection({
  pluginIdentity,
  version,
  children,
}: {
  pluginIdentity: string
  version: string
  children?: React.ReactNode
}) {
  return (
    <section
      aria-label="目录条目（本次动作的对象）"
      className="rounded-[var(--radius-sm)] border border-border p-3"
    >
      <SectionTitle>目录条目（本次动作的对象）</SectionTitle>
      <div className="flex items-center justify-between text-sm">
        <span className="font-mono">{pluginIdentity}</span>
        <span className="font-mono">v{version}</span>
      </div>
      {children}
    </section>
  )
}

/**
 * 安装实例分区：本次动作**不会**改动的对象。
 * 清单为后端有界返回，不做本地分页拼接。
 */
function InstalledInstancesSection({
  releaseId,
  enabled,
  action,
}: {
  releaseId: string
  enabled: boolean
  action: DirectoryChangeAction
}) {
  const { data, isLoading, error } = useAffectedInstallations(releaseId, enabled)
  const items = data?.data ?? []

  return (
    <section
      aria-label="组织内已安装实例（本次动作不会改动）"
      className="rounded-[var(--radius-sm)] border border-dashed border-border p-3"
    >
      <SectionTitle>组织内已安装实例（本次动作不会改动）</SectionTitle>
      <p className="mb-2 text-xs text-muted-foreground">
        {action === 'rollback'
          ? '回滚只切换目录推荐版本；下列实例的版本与状态保持不变，如需降级须另行发起安装变更并逐次确认。'
          : '下列实例的启用状态与版本保持不变；停用或卸载须另行发起安装变更并逐次确认。'}
      </p>
      {isLoading ? (
        <Skeleton className="h-10 w-full" />
      ) : error ? (
        <p className="text-xs text-muted-foreground">受影响安装清单暂不可用。</p>
      ) : items.length === 0 ? (
        <p className="text-xs text-muted-foreground">当前没有安装实例引用此版本。</p>
      ) : (
        <ul className="space-y-1" aria-label="已安装实例清单">
          {items.map((item) => (
            <li key={item.id} className="flex items-center justify-between text-xs">
              <span className="font-mono">{item.pluginId}</span>
              <span className="text-muted-foreground">
                v{item.version} · {INSTALLATION_STATUS_LABELS[item.status] ?? item.status}
                <span className="ml-1.5 text-foreground">保持不变</span>
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

/** 回滚差异分区：manifest / package / permission / compatibility 的 from → to。 */
function RollbackDiffSection({
  targetReleaseId,
  enabled,
}: {
  targetReleaseId: string
  enabled: boolean
}) {
  const { data, isLoading, error } = useDirectoryRollbackPreview(targetReleaseId, enabled)

  if (isLoading) {
    return <Skeleton className="h-28 w-full" />
  }
  if (error || !data) {
    return (
      <p className="text-xs text-destructive" role="alert">
        无法为该目标版本生成回滚预览，请返回目录重新选择。
      </p>
    )
  }

  return (
    <section
      aria-label="回滚差异"
      className="space-y-1.5 rounded-[var(--radius-sm)] border border-border p-3"
    >
      <SectionTitle>回滚差异（当前 → 目标）</SectionTitle>
      <DiffRow
        label="推荐版本"
        before={`v${data.currentVersion}`}
        after={`v${data.targetVersion}`}
      />
      <DiffRow
        label="清单摘要"
        before={shortDigest(data.manifestDigestBefore)}
        after={shortDigest(data.manifestDigestAfter)}
      />
      <DiffRow
        label="制品摘要"
        before={shortDigest(data.packageDigestBefore)}
        after={shortDigest(data.packageDigestAfter)}
      />
      <DiffRow
        label="兼容性摘要"
        before={shortDigest(data.compatibilityDigestBefore)}
        after={shortDigest(data.compatibilityDigestAfter)}
      />
      <div className="pt-1 text-xs">
        <span className="text-muted-foreground">权限差异</span>
        <div className="mt-1 flex flex-wrap gap-1">
          {data.permissionDelta.added.length === 0 && data.permissionDelta.removed.length === 0 ? (
            <span className="text-muted-foreground">无净变化</span>
          ) : (
            <>
              {data.permissionDelta.added.map((key) => (
                <Badge key={`add-${key}`} variant="warning">
                  新增 {key}
                </Badge>
              ))}
              {data.permissionDelta.removed.map((key) => (
                <Badge key={`del-${key}`} variant="outline">
                  移除 {key}
                </Badge>
              ))}
            </>
          )}
        </div>
      </div>
    </section>
  )
}

// =============================================================================
// 主对话框
// =============================================================================

export interface DirectoryActionDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  action: DirectoryChangeAction
  releaseId: string
  pluginIdentity: string
  version: string
}

type Phase = 'compose' | 'submitted' | 'applied'

export function DirectoryActionDialog({
  open,
  onOpenChange,
  action,
  releaseId,
  pluginIdentity,
  version,
}: DirectoryActionDialogProps) {
  const organizationId = useAuthStore(selectEffectiveOrganizationId)
  const [phase, setPhase] = useState<Phase>('compose')
  const [requestUid, setRequestUid] = useState<string | null>(null)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [handleIssued, setHandleIssued] = useState<string | null>(null)
  const [approving, setApproving] = useState(false)

  const createChange = useCreateDirectoryChange()
  const confirmChange = useConfirmDirectoryChange()
  const rollbackPreview = useDirectoryRollbackPreview(releaseId, open && action === 'rollback')

  const blockingFindings = useMemo(
    () => (action === 'rollback' ? (rollbackPreview.data?.blockingFindings ?? []) : []),
    [action, rollbackPreview.data],
  )
  const previewFailed = action === 'rollback' && Boolean(rollbackPreview.error)
  const previewLoading = action === 'rollback' && rollbackPreview.isLoading
  const submitDisabled =
    createChange.isPending || blockingFindings.length > 0 || previewFailed || previewLoading

  function resetAndClose() {
    setPhase('compose')
    setRequestUid(null)
    setErrorMessage(null)
    setHandleIssued(null)
    onOpenChange(false)
  }

  function describeError(error: unknown): string {
    const code = (error as { code?: string })?.code
    if (code === 'plugin-change-self-approval-denied') {
      return '不能审批自己发起的申请，请由另一位管理员审批。'
    }
    if (code === 'plugin-change-stale') {
      return '目录条目在此期间发生变化，请关闭后重新发起。'
    }
    if (code === 'plugin-change-already-decided') {
      return '该申请已处理完毕，无需重复确认。'
    }
    return (error as { message?: string })?.message ?? '操作失败，请稍后重试。'
  }

  async function handleSubmit() {
    setErrorMessage(null)
    try {
      const created = await createChange.mutateAsync({ releaseId, action })
      setRequestUid(created.data.requestUid)
      setPhase('submitted')
    } catch (error) {
      setErrorMessage(describeError(error))
    }
  }

  /** 审批（maker-checker）：由**另一位**有审批权的管理员点击。 */
  async function handleApprove() {
    if (!requestUid || organizationId === null) return
    setErrorMessage(null)
    setApproving(true)
    try {
      await approvePluginChangeRequest(organizationId, requestUid, `approve:${requestUid}`)
      const issued = await issueConfirmHandle(organizationId, requestUid)
      setHandleIssued(issued.data.handle)
    } catch (error) {
      setErrorMessage(describeError(error))
    } finally {
      setApproving(false)
    }
  }

  async function handleConfirm() {
    if (!requestUid || !handleIssued) return
    setErrorMessage(null)
    try {
      await confirmChange.mutateAsync({ requestUid, handle: handleIssued })
      setPhase('applied')
    } catch (error) {
      setErrorMessage(describeError(error))
    }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => (next ? onOpenChange(true) : resetAndClose())}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{ACTION_TITLES[action]}</DialogTitle>
          <DialogDescription>{ACTION_DESCRIPTIONS[action]}</DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <DirectoryTargetSection pluginIdentity={pluginIdentity} version={version} />

          {action === 'rollback' && (
            <RollbackDiffSection targetReleaseId={releaseId} enabled={open} />
          )}

          <InstalledInstancesSection releaseId={releaseId} enabled={open} action={action} />

          {blockingFindings.length > 0 && (
            <div
              role="alert"
              className="rounded-[var(--radius-sm)] border border-destructive/50 p-3"
            >
              <p className="mb-1 text-xs font-semibold text-destructive">
                存在阻断项，无法提交回滚：
              </p>
              <ul className="list-inside list-disc space-y-0.5 text-xs text-destructive">
                {blockingFindings.map((code) => (
                  <li key={code}>{BLOCKING_LABELS[code] ?? code}</li>
                ))}
              </ul>
            </div>
          )}

          {phase === 'submitted' && (
            <div role="status" className="rounded-[var(--radius-sm)] border border-border p-3">
              <p className="text-xs">
                申请已提交，<strong>尚未生效</strong>。需由另一位管理员审批，再由持有管理权限者
                完成最终确认后才会改动目录。
              </p>
              {handleIssued && (
                <p className="mt-1 text-xs text-muted-foreground">
                  已签发一次性确认凭据，仅可使用一次；离开本页需重新发起。
                </p>
              )}
            </div>
          )}

          {phase === 'applied' && (
            <div role="status" className="rounded-[var(--radius-sm)] border border-border p-3">
              <p className="text-xs">已生效。目录条目已更新；已安装实例未发生任何改动。</p>
            </div>
          )}

          {errorMessage && (
            <p role="alert" className="text-xs text-destructive">
              {errorMessage}
            </p>
          )}
        </div>

        <DialogFooter>
          <Button type="button" variant="ghost" onClick={resetAndClose}>
            {phase === 'applied' ? '关闭' : '取消'}
          </Button>

          {phase === 'compose' && (
            <Button type="button" onClick={handleSubmit} disabled={submitDisabled}>
              {createChange.isPending ? '提交中…' : ACTION_SUBMIT_LABELS[action]}
            </Button>
          )}

          {phase === 'submitted' && !handleIssued && (
            <Button type="button" onClick={handleApprove} disabled={approving}>
              {approving ? '审批中…' : '由另一位管理员审批'}
            </Button>
          )}

          {phase === 'submitted' && handleIssued && (
            <Button type="button" onClick={handleConfirm} disabled={confirmChange.isPending}>
              {confirmChange.isPending ? '确认中…' : '最终确认并生效'}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
