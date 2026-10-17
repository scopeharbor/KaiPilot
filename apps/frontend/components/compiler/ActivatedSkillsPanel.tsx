'use client'

import { useSkillActivation } from '@/hooks/use-skill-activation'
import { AlertCircle, BookOpen, Lightbulb } from 'lucide-react'
import { cn } from '@/lib/utils'

/**
 * ActivatedSkillsPanel —— Compiler run 明细面板中「激活的 Skill」只读区。
 *
 * 消费 useSkillActivation / useSkillInjections hooks，
 * 展示激活决策摘要（skillKey/version/activationMode/evidenceDigest/注入条目数/裁剪原因）。
 *
 * feature-off 降级：当 COMPILER_SKILL_INJECTION_ENABLED=false 时不渲染。
 * 权限感知：需要 ai:compiler:skill:view（由调用方控制是否传入）。
 */
export function ActivatedSkillsPanel({
  projectId,
  runId,
  enabled = false,
}: {
  projectId: number
  runId: number
  enabled?: boolean
}) {
  // Feature-off 降级
  if (!enabled) return null

  const { data: activation, isLoading, isError } = useSkillActivation(projectId, runId, enabled)

  // 加载态
  if (isLoading) {
    return (
      <section className="rounded-lg border p-4 space-y-2" aria-label="激活的 Skill">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <BookOpen className="h-4 w-4 shrink-0" aria-hidden />
          <span>正在加载激活的 Skill...</span>
        </div>
      </section>
    )
  }

  // 错误态
  if (isError) {
    return (
      <section className="rounded-lg border p-4 space-y-2" aria-label="激活的 Skill">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <AlertCircle className="h-4 w-4 shrink-0" aria-hidden />
          <span>无法加载 Skill 激活信息</span>
        </div>
      </section>
    )
  }

  // 空态：无激活决策
  if (!activation || activation.activatedSkillKeys.length === 0) {
    return (
      <section className="rounded-lg border p-4 space-y-2" aria-label="激活的 Skill">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <BookOpen className="h-4 w-4 shrink-0" aria-hidden />
          <span>未激活任何 Skill</span>
        </div>
      </section>
    )
  }

  return (
    <section className="rounded-lg border p-4 space-y-3" aria-label="激活的 Skill">
      {/* 标题栏 */}
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium flex items-center gap-1.5">
          <BookOpen className="h-4 w-4 shrink-0" aria-hidden />
          激活的 Skill
        </h3>
        <span className="text-xs text-muted-foreground">
          {activation.activatedSkillKeys.length} 个
        </span>
      </div>

      {/* 激活的 Skill 列表 */}
      <ul className="space-y-2">
        {activation.activatedSkills.map((skill) => (
          <li
            key={skill.skillKey}
            className={cn(
              'flex items-start gap-2 rounded-md border p-2 text-sm',
              skill.activationMode === 'manual' && 'border-primary/20 bg-primary/5',
              skill.activationMode === 'auto' && 'border-muted',
              skill.activationMode === 'dependency' && 'border-muted border-dashed',
            )}
          >
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-1.5">
                <span className="font-medium truncate">{skill.name}</span>
                <span className="text-xs text-muted-foreground shrink-0">v{skill.version}</span>
              </div>
              <div className="flex items-center gap-1.5 mt-0.5">
                <ActivationModeBadge mode={skill.activationMode} />
                <span className="text-xs text-muted-foreground truncate">{skill.reason}</span>
              </div>
            </div>
          </li>
        ))}
      </ul>

      {/* Advisory 候选区 */}
      {activation.advisorySkillKeys.length > 0 && (
        <div className="border-t pt-2">
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground mb-1">
            <Lightbulb className="h-3.5 w-3.5 shrink-0" aria-hidden />
            <span>AI 推荐但未激活</span>
          </div>
          <div className="flex flex-wrap gap-1">
            {activation.advisorySkillKeys.map((key) => (
              <span
                key={key}
                className="inline-flex items-center rounded-full border px-2 py-0.5 text-xs text-muted-foreground"
              >
                {key}
              </span>
            ))}
          </div>
        </div>
      )}
    </section>
  )
}

/**
 * 激活模式徽章组件。
 */
function ActivationModeBadge({ mode }: { mode: string }) {
  const config: Record<string, { label: string; className: string }> = {
    manual: { label: '手动', className: 'bg-primary/10 text-primary' },
    auto: { label: '自动', className: 'bg-muted text-muted-foreground' },
    dependency: { label: '依赖', className: 'bg-muted text-muted-foreground' },
  }

  const { label, className } = config[mode] ?? { label: mode, className: '' }

  return (
    <span
      className={cn(
        'inline-flex items-center rounded px-1.5 py-0 text-[10px] font-medium',
        className,
      )}
    >
      {label}
    </span>
  )
}
