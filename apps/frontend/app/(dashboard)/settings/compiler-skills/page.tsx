'use client'

/**
 * v3-skill-registry-and-lifecycle —— Skill Registry 管理页面（P1）。
 *
 * 权限感知 + feature flag 门控。仅当 COMPILER_SKILL_REGISTRY_ENABLED 开启且用户
 * 有 ai:compiler:skill:view 权限时渲染 SkillRegistryPanel。
 */
import { usePermissions } from '@/hooks/use-permissions'
import { EmptyState } from '@/components/ui/EmptyState'
import { SkillRegistryPanel } from '@/components/compiler/skill-registry-panel'

const SKILL_REGISTRY_ENABLED = process.env.NEXT_PUBLIC_COMPILER_SKILL_REGISTRY !== 'false'

export default function CompilerSkillsPage() {
  const { can } = usePermissions()
  const canView = can('ai:compiler:skill:view')

  if (!SKILL_REGISTRY_ENABLED || !canView) {
    return (
      <EmptyState
        title="Skill Registry"
        description="您没有查看 Skill Registry 的权限，或该功能未启用。"
      />
    )
  }

  return (
    <div className="space-y-6 p-6">
      <SkillRegistryPanel />
    </div>
  )
}
