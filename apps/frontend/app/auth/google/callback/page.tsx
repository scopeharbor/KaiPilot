'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useAuthStore, type AuthUser } from '@/stores/auth-store'
import { safeNextPath } from '@/lib/auth/safe-next-path'
import { NextAuthCallbackShell } from '@/components/next/auth/NextAuthCallbackShell'

function decodeUser(value: string): AuthUser {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/')
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=')
  const bytes = Uint8Array.from(atob(padded), (char) => char.charCodeAt(0))
  return JSON.parse(new TextDecoder().decode(bytes)) as AuthUser
}

export default function GoogleAuthCallbackPage() {
  const router = useRouter()
  const setSession = useAuthStore((state) => state.setSession)
  const [error, setError] = useState('')
  const [nextPath, setNextPath] = useState<string | null>(null)

  useEffect(() => {
    const fragment = new URLSearchParams(window.location.hash.replace(/^#/, ''))
    const accessToken = fragment.get('accessToken')
    const refreshToken = fragment.get('refreshToken')
    const userRaw = fragment.get('user')
    const next = safeNextPath(fragment.get('next'))
    setNextPath(next)
    if (!accessToken || !refreshToken || !userRaw) {
      setError('Google 登录回调缺少系统会话，请重新登录。')
      return
    }
    try {
      setSession({ user: decodeUser(userRaw), accessToken, refreshToken })
      window.history.replaceState(null, '', '/auth/google/callback')
      router.replace(next)
      router.refresh()
    } catch {
      setError('Google 登录回调解析失败，请重新登录。')
    }
  }, [router, setSession])

  return (
    <NextAuthCallbackShell
      loadingLabel="正在完成 Google 登录…"
      error={error}
      errorTitle="Google 登录未完成"
      nextPath={nextPath}
    />
  )
}
