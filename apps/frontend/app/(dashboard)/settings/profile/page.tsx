'use client'

import { useSyncExternalStore } from 'react'
import Link from 'next/link'
import {
  ChevronRight,
  Languages,
  Mail,
  ShieldCheck,
  Sparkles,
  User as UserIcon,
} from 'lucide-react'
import { Alert } from '@/components/ui/Alert'
import { Avatar, AvatarFallback } from '@/components/ui/Avatar'
import { Card, CardContent } from '@/components/ui/Card'
import { Chip } from '@/components/ui/Chip'
import { RadioGroup, RadioGroupItem } from '@/components/ui/RadioGroup'
import {
  getServerVariant,
  getVariant,
  setVariant,
  subscribeVariant,
  type TextVariant,
} from '@/lib/locale/variant-store'
import { useAuthStore } from '@/stores/auth-store'
import { isSaasPersonalWorkspace } from '@/lib/workspace-edition'

/** 组织角色 → 中文标签（与 organization_members.role 取值对齐）。 */
const ORG_ROLE_LABELS: Record<string, string> = {
  owner: '所有者',
  admin: '管理员',
  member: '成员',
  viewer: '只读',
}

/**
 * 界面文字变体选项。选项名是语言自指名，必须保持原文、不随变体转换：
 * label 已包在带 `data-no-cc` 的元素内，cc-loader 与 runtime DOM 转换都会跳过。
 */
const TEXT_VARIANT_OPTIONS: ReadonlyArray<{ value: TextVariant; label: string }> = [
  { value: 'cn', label: '简体中文' },
  { value: 'tw', label: '台灣繁體' },
  { value: 'hk', label: '香港繁體' },
]

/**
 * 界面文字设置卡片——选择简体/台湾繁体/香港繁体，切换立即生效并持久化到
 * localStorage（lib/locale/variant-store）。SSR 恒为 'cn'（getServerSnapshot
 * 返回 'cn'），仅在客户端 hydration 后呈现用户保存的变体。
 */
function TextVariantSetting() {
  const variant = useSyncExternalStore(subscribeVariant, getVariant, getServerVariant)

  return (
    <Card variant="outlined">
      <CardContent className="space-y-4 pt-[var(--card-pad)]">
        <h2 className="flex items-center gap-2 text-lg font-semibold text-gray-800">
          <Languages className="h-5 w-5 text-gray-400" aria-hidden />
          界面文字
        </h2>
        <p className="text-sm text-gray-500">
          选择界面文字使用的变体：简体中文、台湾繁体或香港繁体。切换立即生效，并保存在本机浏览器。
        </p>
        <RadioGroup
          value={variant}
          onValueChange={(value) => setVariant(value as TextVariant)}
          className="gap-2"
        >
          {TEXT_VARIANT_OPTIONS.map((option) => {
            const active = variant === option.value
            return (
              <label
                key={option.value}
                data-no-cc
                className={[
                  'flex cursor-pointer items-center gap-2.5 rounded-lg border px-3 py-2.5 text-sm text-gray-800 transition-colors',
                  active
                    ? 'border-primary-500 bg-primary-50'
                    : 'border-border hover:border-primary-300',
                ].join(' ')}
              >
                <RadioGroupItem value={option.value} />
                <span className="font-medium">{option.label}</span>
              </label>
            )
          })}
        </RadioGroup>
      </CardContent>
    </Card>
  )
}

/**
 * 个人资料页（`/settings/profile`）——用户菜单「个人资料」入口的落点。
 *
 * V1 范围：只读展示当前会话身份（姓名/邮箱/所属组织与角色），数据取自已恢复的
 * `useAuthStore`。资料编辑属独立议题，本页不承载。认证由根 `AuthSessionProvider`
 * 的恢复门闸与 `(dashboard)` 布局保证。
 */
export default function ProfilePage() {
  const user = useAuthStore((state) => state.user)
  const currentOrganizationId = useAuthStore((state) => state.currentOrganizationId)
  const planTier = useAuthStore((state) => state.planTier)

  if (!user) {
    return <Alert className="my-8">请先登录后查看个人资料。</Alert>
  }

  const displayName = user.fullName?.trim() || user.email
  const initials =
    user.initials ||
    (user.fullName ? user.fullName.slice(0, 2) : user.email.slice(0, 2)).toUpperCase()
  const isPersonal = isSaasPersonalWorkspace(planTier) && !user.isSuperAdmin

  return (
    <div className="mx-auto max-w-2xl space-y-6 py-8">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold text-gray-800">个人资料</h1>
        <p className="text-sm text-gray-500">
          {isPersonal ? '管理个人账号与界面偏好。' : '查看你的账户身份与所属组织。'}
        </p>
      </header>

      <Card variant="outlined">
        <CardContent className="flex flex-col gap-5 pt-[var(--card-pad)] sm:flex-row sm:items-center">
          <Avatar className="h-16 w-16">
            <AvatarFallback className="text-lg">{initials}</AvatarFallback>
          </Avatar>
          <div className="min-w-0 space-y-1">
            <div className="flex items-center gap-2">
              <UserIcon className="h-4 w-4 text-gray-400" aria-hidden />
              <span className="truncate text-lg font-medium text-gray-800">{displayName}</span>
              {user.isSuperAdmin ? <Chip>系统管理员</Chip> : null}
            </div>
            <div className="flex items-center gap-2 text-sm text-gray-500">
              <Mail className="h-4 w-4 text-gray-400" aria-hidden />
              <span className="truncate">{user.email}</span>
            </div>
          </div>
        </CardContent>
      </Card>

      {isPersonal ? (
        <Card variant="outlined">
          <CardContent className="space-y-3 pt-[var(--card-pad)]">
            <h2 className="flex items-center gap-2 text-lg font-semibold text-gray-800">
              <Sparkles className="h-5 w-5 text-primary-500" aria-hidden />
              个人版
            </h2>
            <p className="text-sm leading-6 text-gray-500">
              这是由 Google 登录自动建立的个人空间。项目、任务、WBS、甘特图、报表和 AI
              草案等个人版能力可正常使用；不适用的企业管理入口会自动隐藏。
            </p>
          </CardContent>
        </Card>
      ) : (
        <Card variant="outlined">
          <CardContent className="space-y-4 pt-[var(--card-pad)]">
            <h2 className="flex items-center gap-2 text-lg font-semibold text-gray-800">
              <ShieldCheck className="h-5 w-5 text-gray-400" aria-hidden />
              所属组织
            </h2>
            {user.organizations.length === 0 ? (
              <p className="text-sm text-gray-500">尚未加入任何组织。</p>
            ) : (
              <ul className="divide-y divide-border">
                {user.organizations.map((org) => (
                  <li
                    key={org.id}
                    className="flex items-center justify-between gap-3 py-3 first:pt-0 last:pb-0"
                  >
                    <div className="min-w-0">
                      <p className="truncate font-medium text-gray-800">{org.name}</p>
                      <p className="truncate text-xs text-gray-500">{org.slug}</p>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      {org.id === currentOrganizationId ? <Chip selected>当前</Chip> : null}
                      <Chip>{ORG_ROLE_LABELS[org.role] ?? org.role}</Chip>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      )}

      {/* 账号安全入口：2FA 是个人账号能力，从个人资料页可直达（导航里也有一份）。 */}
      <Card variant="outlined">
        <CardContent className="pt-[var(--card-pad)]">
          <Link
            href="/settings/security/two-factor"
            className="-m-2 flex items-center justify-between gap-3 rounded-lg p-2 transition-colors hover:bg-gray-50 focus-visible:shadow-focus"
          >
            <div className="min-w-0 space-y-1">
              <h2 className="flex items-center gap-2 text-lg font-semibold text-gray-800">
                <ShieldCheck className="h-5 w-5 text-gray-400" aria-hidden />
                两步验证
              </h2>
              <p className="text-sm leading-6 text-gray-500">
                用认证器应用为登录再加一道验证。即使密码泄露，别人也进不来。
              </p>
            </div>
            <ChevronRight className="h-5 w-5 shrink-0 text-gray-400" aria-hidden />
          </Link>
        </CardContent>
      </Card>

      <TextVariantSetting />
    </div>
  )
}
