'use client'

import { useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { membersApi } from '@/lib/api-client'

const field =
  'w-full rounded-md border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)] px-3 py-2 text-sm text-[var(--nx-text-primary)]'

export function CreateOrganizationAccountForm({
  organizationId,
  onCreated,
  onCancel,
  createAccount = membersApi.createAccount,
}: {
  organizationId: number
  onCreated: () => void
  onCancel: () => void
  createAccount?: typeof membersApi.createAccount
}) {
  const [fullName, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [role, setRole] = useState<'admin' | 'member' | 'viewer'>('member')
  const [review, setReview] = useState(false)
  const create = useMutation({
    mutationFn: () => createAccount(organizationId, { fullName, email, password, role }),
    onSuccess: () => {
      setPassword('')
      onCreated()
    },
    onError: () => setReview(false),
  })
  const error = (create.error as { message?: string } | null)?.message
  return (
    <form
      className="flex flex-col gap-3 border-y border-[var(--nx-border-hairline)] py-4"
      onSubmit={(event) => {
        event.preventDefault()
        if (!review) setReview(true)
        else create.mutate()
      }}
    >
      <h3 className="text-base font-semibold text-[var(--nx-text-primary)]">建立组织成员账号</h3>
      <p className="text-sm text-[var(--nx-text-secondary)]">
        建立一般邮箱密码账号并加入当前组织。已有账号请改用邀请，不会覆盖原密码。
      </p>
      {review ? (
        <p role="status" className="text-sm text-[var(--nx-text-primary)]">
          确认建立 {fullName}（{email}），角色：
          {role === 'admin' ? '组织管理员' : role === 'member' ? '组织成员' : '只读成员'}
          。仅加入当前组织，不授予平台管理权限。
        </p>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="text-sm text-[var(--nx-text-secondary)]">
            姓名
            <input
              className={field}
              value={fullName}
              required
              maxLength={120}
              onChange={(e) => setName(e.target.value)}
            />
          </label>
          <label className="text-sm text-[var(--nx-text-secondary)]">
            登入邮箱
            <input
              className={field}
              type="email"
              value={email}
              required
              maxLength={254}
              onChange={(e) => setEmail(e.target.value)}
            />
          </label>
          <label className="text-sm text-[var(--nx-text-secondary)]">
            初始密码
            <input
              className={field}
              type="password"
              autoComplete="new-password"
              value={password}
              required
              minLength={8}
              maxLength={32}
              pattern="(?=.*[a-z])(?=.*[A-Z])(?=.*[0-9]).*"
              onChange={(e) => setPassword(e.target.value)}
            />
            <span className="text-xs">8～32 字，包含大小写英文字母与数字；请私下交给成员。</span>
          </label>
          <label className="text-sm text-[var(--nx-text-secondary)]">
            组织角色
            <select
              className={field}
              value={role}
              onChange={(e) => setRole(e.target.value as typeof role)}
            >
              <option value="member">组织成员</option>
              <option value="admin">组织管理员</option>
              <option value="viewer">只读成员</option>
            </select>
          </label>
        </div>
      )}
      {error && (
        <p role="alert" className="text-sm text-[var(--nx-status-danger)]">
          {error}
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        <button
          type="submit"
          disabled={create.isPending}
          className="rounded-md bg-[var(--nx-accent)] px-4 py-2 text-sm text-[var(--nx-bg-0)] disabled:opacity-50"
        >
          {create.isPending ? '正在建立…' : review ? '确认建立账号' : '检查账号资料'}
        </button>
        {review && (
          <button
            type="button"
            disabled={create.isPending}
            className={field + ' w-auto'}
            onClick={() => setReview(false)}
          >
            返回修改
          </button>
        )}
        <button
          type="button"
          disabled={create.isPending}
          className={field + ' w-auto'}
          onClick={() => {
            setPassword('')
            onCancel()
          }}
        >
          取消
        </button>
      </div>
    </form>
  )
}
