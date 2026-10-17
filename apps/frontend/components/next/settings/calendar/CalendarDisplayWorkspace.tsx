'use client'

import * as React from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Loader2 } from 'lucide-react'
import {
  CALENDAR_DISPLAY_LAYER_LABELS,
  CALENDAR_SYSTEM_LABELS,
  DEFAULT_CALENDAR_SYSTEMS,
  resolveCalendarDisplay,
  type CalendarDisplayLayer,
  type CalendarDisplayResolution,
  type CalendarSystemId,
} from '@aiproj/types'
import { calendarDisplayApi, calendarDisplayKeys } from '@/lib/api/calendar-display'
import { projectsApi, projectKeys } from '@/lib/api/projects'
import { toast } from '@/components/ui/Toast'
import { CalendarSystemsEditor } from './CalendarSystemsEditor'
import { PersonalWorkingCalendarEditor } from './PersonalWorkingCalendarEditor'

/**
 * 日历与曆法设定（/next/settings/calendar）：个人 > 项目 > 组织 > 系统默认。
 *
 * 个人层任何人可改；项目层需要该项目的编辑权限；组织层需要组织管理权限（后端再校验一次）。
 */
function systemsText(systems: readonly CalendarSystemId[]): string {
  return systems.map((id) => CALENDAR_SYSTEM_LABELS[id]).join(' → ')
}

function Section({
  title,
  description,
  children,
  ...rest
}: {
  title: string
  description: string
  children: React.ReactNode
} & React.HTMLAttributes<HTMLElement>) {
  return (
    <section
      {...rest}
      className="space-y-3 rounded-lg border border-[var(--nx-border-hairline)] bg-[var(--nx-workspace-bg)] p-4"
    >
      <header>
        <h3 className="text-sm font-semibold text-[var(--nx-text-primary)]">{title}</h3>
        <p className="mt-0.5 text-xs text-[var(--nx-text-muted)]">{description}</p>
      </header>
      {children}
    </section>
  )
}

export function CalendarDisplayWorkspace({
  initialProjectId = null,
}: {
  initialProjectId?: number | null
}) {
  const queryClient = useQueryClient()
  const [projectId, setProjectId] = React.useState<number | null>(initialProjectId)

  const { data, isPending, isError } = useQuery({
    queryKey: calendarDisplayKeys.detail(projectId),
    queryFn: () => calendarDisplayApi.get(projectId),
  })
  const { data: projects } = useQuery({
    queryKey: [...projectKeys.lists(), 'calendar-display-picker'] as const,
    queryFn: () => projectsApi.list({ perPage: 100 }),
  })

  const mutation = useMutation({
    mutationFn: (input: { layer: CalendarDisplayLayer; systems: CalendarSystemId[] | null }) =>
      calendarDisplayApi.update({ ...input, projectId }),
    onSuccess: (result: CalendarDisplayResolution, input) => {
      queryClient.setQueryData(calendarDisplayKeys.detail(projectId), result)
      void queryClient.invalidateQueries({ queryKey: calendarDisplayKeys.all })
      toast({
        variant: 'success',
        title: input.systems === null ? '已改为继承上层设定' : '日历设定已保存',
        description: `现在生效：${systemsText(result.systems)}（${CALENDAR_DISPLAY_LAYER_LABELS[result.source]}）`,
      })
    },
    onError: (error) => {
      toast({
        variant: 'error',
        title: '保存失败',
        description: (error as { message?: string }).message ?? '请稍后重试',
      })
    },
  })

  if (isPending) {
    return (
      <p className="flex items-center gap-2 text-sm text-[var(--nx-text-muted)]">
        <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
        正在读取日历设定…
      </p>
    )
  }
  if (isError || !data) {
    return <p className="text-sm text-[var(--nx-status-danger)]">日历设定读取失败，请稍后重试。</p>
  }

  const { layers, editable } = data
  // 每一层「继承到的」值：只看比它低的层（个人继承项目 / 组织，项目继承组织，组织继承系统默认）
  const inheritedFor = (layer: CalendarDisplayLayer) =>
    resolveCalendarDisplay({
      personal: null,
      project: layer === 'personal' ? layers.project : null,
      organization: layer === 'organization' ? null : layers.organization,
    }).systems
  const save = (layer: CalendarDisplayLayer) => (systems: CalendarSystemId[] | null) =>
    mutation.mutate({ layer, systems })

  return (
    <div data-calendar-display-workspace className="space-y-4">
      <div
        data-calendar-display-effective
        className="rounded-lg border border-[var(--nx-space-cyan)]/40 bg-[var(--nx-space-cyan)]/5 px-4 py-3 text-sm"
      >
        <p className="text-[var(--nx-text-primary)]">
          现在生效：<span className="font-medium">{systemsText(data.systems)}</span>
        </p>
        <p className="mt-0.5 text-xs text-[var(--nx-text-muted)]">
          来自 {CALENDAR_DISPLAY_LAYER_LABELS[data.source]} · 优先序：个人 &gt; 项目 &gt; 组织 &gt;
          系统默认（
          {systemsText(DEFAULT_CALENDAR_SYSTEMS)}）
        </p>
      </div>

      <Section
        data-calendar-layer="personal"
        title="我的日历（个人）"
        description="只影响你自己看到的日历；设了就优先于项目与组织设定。"
      >
        <CalendarSystemsEditor
          value={layers.personal}
          inherited={inheritedFor('personal')}
          saving={mutation.isPending}
          onSave={save('personal')}
          inheritLabel="清除个人设定（跟随项目 / 组织）"
        />
      </Section>

      <Section
        data-calendar-personal-working
        title="我的工作日历（休假）"
        description="休假和个人工作日跨项目生效：日历上新建任务时会避开你不上班的日子，「我的日历」也会标出来。"
      >
        <PersonalWorkingCalendarEditor />
      </Section>

      <Section
        data-calendar-layer="project"
        title="项目日历"
        description="项目成员在这个项目里默认看到的曆法（个人设定仍然优先）。需要项目编辑权限。"
      >
        <label className="flex min-w-0 flex-wrap items-center gap-2 text-xs text-[var(--nx-text-secondary)]">
          选择项目
          <select
            data-calendar-project-picker
            value={projectId ?? ''}
            onChange={(event) =>
              setProjectId(event.target.value ? Number(event.target.value) : null)
            }
            className="h-8 min-w-0 max-w-full rounded-md border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)] px-2 text-xs text-[var(--nx-text-primary)]"
          >
            <option value="">（未选择）</option>
            {(projects?.data ?? []).map((project) => (
              <option key={project.id} value={project.id}>
                {project.code ? `${project.code} · ` : ''}
                {project.name}
              </option>
            ))}
          </select>
        </label>
        {projectId === null ? (
          <p className="text-xs text-[var(--nx-text-muted)]">
            选择一个项目后可查看与修改它的日历设定。
          </p>
        ) : (
          <CalendarSystemsEditor
            key={projectId}
            value={layers.project}
            inherited={inheritedFor('project')}
            disabled={!editable.project}
            saving={mutation.isPending}
            onSave={save('project')}
            inheritLabel="清除项目设定（跟随组织）"
          />
        )}
        {projectId !== null && !editable.project ? (
          <p className="text-xs text-[var(--nx-status-warning)]">
            你没有这个项目的编辑权限，只能查看。
          </p>
        ) : null}
      </Section>

      <Section
        data-calendar-layer="organization"
        title="组织默认"
        description="组织里所有人与项目的默认曆法。需要组织管理权限。"
      >
        <CalendarSystemsEditor
          value={layers.organization}
          inherited={inheritedFor('organization')}
          disabled={!editable.organization}
          saving={mutation.isPending}
          onSave={save('organization')}
          inheritLabel="清除组织设定（用系统默认）"
        />
        {!editable.organization ? (
          <p className="text-xs text-[var(--nx-status-warning)]">
            需要组织管理权限才能修改，你只能查看。
          </p>
        ) : null}
      </Section>
    </div>
  )
}

export default CalendarDisplayWorkspace
