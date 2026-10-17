'use client'

import { useMemo } from 'react'
import { Plus } from 'lucide-react'
import { useRegisterCommands } from '@/lib/command-registry/use-register-commands'
import { commandPush } from '@/lib/command-registry/router-bridge'
import type { RegisteredCommand } from '@/lib/command-registry/types'

/**
 * 项目详情页的上下文快捷命令（spec command-palette「上下文命令随组件挂载注册」）。
 *
 * - 由项目 layout 挂载，随项目路由常驻；离开项目路由（layout 卸载）时自动注销；
 * - 「新建任务」命令 `effect: 'open-form'`：导航到项目 list 视图并带 `?newTask=1` 预填参数，
 *   list 视图据此聚焦快速新建输入框——**不直接创建任务记录**（写操作边界）。
 *
 * @param projectId 当前项目 ID（来自 layout params）
 */
export function ProjectContextCommands({ projectId }: { projectId: number }) {
  const commands = useMemo<RegisteredCommand[]>(
    () => [
      {
        id: 'ctx.project.new-task',
        label: '新建任务',
        keywords: ['任务', '新建', 'create', 'task'],
        icon: Plus,
        group: 'contextual',
        effect: 'open-form',
        requiresPermission: ['task:create'],
        when: (ctx) => ctx.pathname.startsWith('/projects/'),
        execute: () => {
          if (!Number.isFinite(projectId)) return
          commandPush(`/projects/${projectId}/list?newTask=1`)
        },
      },
    ],
    [projectId],
  )
  useRegisterCommands(commands, [projectId])
  return null
}
