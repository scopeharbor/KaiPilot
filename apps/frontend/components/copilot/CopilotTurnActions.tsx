'use client'

import { useState } from 'react'
import { usePathname, useParams, useRouter, useSearchParams } from 'next/navigation'
import { COPILOT_DESTINATION_REGISTRY } from '@aiproj/types'
import { useCopilotStore } from '@/stores/copilot-store'
import { useAuthStore } from '@/stores/auth-store'
import { useCommandRegistryStore } from '@/lib/command-registry/store'
import { findReverseHandoffTargets } from '@/lib/command-registry/bridge'
import { isEnterpriseEntryVisible } from '@/lib/navigation'
import { useCopilotOperatingEntry } from '@/lib/copilot/operating-entry'

/** 只打开既有业务入口；不将路由结果当成执行回执。 */
export function CopilotTurnActions() {
  const turn = useCopilotStore((s) => s.turn)
  const streaming = useCopilotStore((s) => s.streaming)
  const mode = useCopilotStore((s) => s.mode)
  const entry = useCopilotOperatingEntry()
  const auth = useAuthStore()
  const commands = useCommandRegistryStore((s) => s.commands)
  const pathname = usePathname() ?? '/'
  const params = useParams()
  const searchParams = useSearchParams()
  const router = useRouter()
  const [error, setError] = useState<string | null>(null)
  const context = {
    pathname,
    params: (params ?? {}) as Record<string, string | string[]>,
    searchParams: searchParams ?? new URLSearchParams(),
  }
  if (
    !auth.user ||
    !entry.input ||
    !turn ||
    streaming ||
    mode !== 'live' ||
    entry.route !== pathname ||
    entry.userId !== String(auth.user?.id) ||
    entry.organizationId !== auth.currentOrganizationId
  )
    return null

  const canCreate = auth.hasPermission('project:create') && auth.hasPermission('ai:trigger')
  const createProject =
    canCreate &&
    turn.destinations.some(
      (d) => d.destination === 'project_creation' && d.requiresUserConfirmation,
    )
  const visible = Array.from(commands.values()).filter(
    (cmd) =>
      !cmd.requiresPermission?.some((p) => !auth.hasPermission(p)) &&
      (!cmd.enterpriseOnly ||
        isEnterpriseEntryVisible(
          auth.planTier,
          auth.user?.isSuperAdmin || auth.permissions.includes('system:admin'),
        )) &&
      !cmd.featureGate &&
      (!cmd.when || cmd.when(context)),
  )
  const targets = findReverseHandoffTargets(entry.input, visible)
    .filter((t) => !createProject || t.commandId !== 'nav./ai-create')
    .slice(0, 3)
  const projectId = /^\/projects\/(\d+)(?:\/|$)/.exec(pathname)?.[1]
  const destinations = turn.destinations.filter((d) => d.requiresUserConfirmation)
  const needsProject = !projectId && /项目|专案|專案|任务|任務/.test(entry.input) && !createProject
  if (!createProject && !targets.length && !destinations.length && !needsProject) return null

  function openCreation() {
    const current = useAuthStore.getState()
    if (!current.hasPermission('project:create') || !current.hasPermission('ai:trigger')) return
    useCopilotOperatingEntry.setState({ projectCreation: entry.input })
    router.push('/ai-create')
  }

  function openDestination(destination: string) {
    // These are existing authenticated workspaces; their own preview/confirm APIs own writes.
    if (!projectId) {
      router.push('/projects')
      return
    }
    const base = `/projects/${projectId}`
    const route =
      destination === 'weekly_monthly_report'
        ? `${base}/reports-v2/periodic`
        : destination === 'risk_suggestions'
          ? `${base}/risks`
          : base
    router.push(route)
  }

  return (
    <section className="space-y-2 rounded-lg border border-border p-3" aria-label="继续操作">
      <p className="text-sm font-medium text-gray-800">接下来可以这样做</p>
      <p className="text-xs text-gray-600">打开相应流程后，预览并确认才会保存修改。</p>
      <div className="flex flex-wrap gap-2">
        {createProject && (
          <button
            type="button"
            className="rounded-md bg-primary-500 px-3 py-2 text-sm text-white"
            onClick={openCreation}
          >
            用这段需求创建项目
          </button>
        )}
        {targets.map((target) => (
          <button
            type="button"
            key={target.commandId}
            className="rounded-md border border-border px-3 py-2 text-sm"
            onClick={() => {
              const command = useCommandRegistryStore.getState().commands.get(target.commandId)
              const currentAuth = useAuthStore.getState()
              if (
                !command ||
                currentAuth.currentOrganizationId !== entry.organizationId ||
                String(currentAuth.user?.id) !== entry.userId ||
                command.featureGate ||
                (command.enterpriseOnly &&
                  !isEnterpriseEntryVisible(
                    currentAuth.planTier,
                    currentAuth.user?.isSuperAdmin ||
                      currentAuth.permissions.includes('system:admin'),
                  )) ||
                command.requiresPermission?.some((p) => !currentAuth.hasPermission(p)) ||
                (command.when && !command.when(context))
              ) {
                setError('操作已不可用，请刷新后重试。')
                return
              }
              try {
                command.execute(context)
              } catch {
                setError('未能打开该操作，请重试。')
              }
            }}
          >
            打开{target.label}
          </button>
        ))}
        {!createProject &&
          destinations.map((d) => (
            <button
              type="button"
              key={d.destination}
              className="rounded-md border border-border px-3 py-2 text-sm"
              onClick={() => openDestination(d.destination)}
            >
              {projectId
                ? ['weekly_monthly_report', 'risk_suggestions'].includes(d.destination)
                  ? `前往${COPILOT_DESTINATION_REGISTRY[d.destination].label}`
                  : '打开项目，继续准备草案'
                : '选择项目后继续'}
            </button>
          ))}
        {needsProject && destinations.length === 0 && (
          <button
            type="button"
            className="rounded-md border border-border px-3 py-2 text-sm"
            onClick={() => router.push('/projects')}
          >
            选择要查看的项目
          </button>
        )}
      </div>
      {error && (
        <p role="alert" className="text-xs text-red-600">
          {error}
        </p>
      )}
    </section>
  )
}
