'use client'

import { useEffect, useRef } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { LoaderCircle } from 'lucide-react'
import { BrandLogo } from '@/components/ui/BrandLogo'
import { TwoFactorChallengeForm } from '@/components/auth/TwoFactorChallengeForm'
import { useAuthStore } from '@/stores/auth-store'
import { isChallengeUsable, useTwoFactorChallengeStore } from '@/stores/two-factor-challenge-store'
import type { AuthSession } from '@/lib/api/auth'
import type { TwoFactorChallengePurpose } from '@/lib/api/auth'

/** 左栏文案随用途切换：绑定与验证是两件事，标题不该共用一句。 */
const COPY: Record<TwoFactorChallengePurpose, { title: string; body: string }> = {
  enroll: {
    title: '给账号加把锁',
    body: '用手机上的认证器 App 扫一次码，以后登录多输 6 位数字，密码泄露也进不来。',
  },
  verify: {
    title: '多一步，安全得多',
    body: '即使密码泄露，没有你手机上的认证器也无法登录你的项目工作台。',
  },
}

/**
 * `/2fa/setup` 与 `/2fa/challenge` 两个独立路由的共同外壳。
 *
 * 拆成真实路由而非登录页内部状态，是为了让「扫码绑定」与「输验证码」可被直接导航、
 * 刷新不丢失、浏览器前进后退可用。挑战票据来自 sessionStorage（见 store 注释），
 * 页面自身**不接受任何 URL 参数**——票据绝不经 URL 传递。
 *
 * 守卫：没有可用票据、或票据用途与本路由不符，一律踢回 `/login`。这既防止直接
 * 深链进入绑定页（未经密码验证不得取得二维码），也避免用户对着一个已过期的表单打转。
 */
export function TwoFactorStepPage({ expected }: { expected: TwoFactorChallengePurpose }) {
  const router = useRouter()
  const setSession = useAuthStore((state) => state.setSession)
  const challengeToken = useTwoFactorChallengeStore((state) => state.challengeToken)
  const expiresAt = useTwoFactorChallengeStore((state) => state.expiresAt)
  const purpose = useTwoFactorChallengeStore((state) => state.purpose)
  const skippable = useTwoFactorChallengeStore((state) => state.skippable)
  const methods = useTwoFactorChallengeStore((state) => state.methods)
  const nextPath = useTwoFactorChallengeStore((state) => state.nextPath)
  const hasHydrated = useTwoFactorChallengeStore((state) => state.hasHydrated)
  const clear = useTwoFactorChallengeStore((state) => state.clear)

  // sessionStorage 恢复是异步的（skipHydration），必须等它完成再判定，
  // 否则刷新页面会在票据尚未读回时误判为「无票据」并把用户踢走。
  useEffect(() => {
    void useTwoFactorChallengeStore.persist.rehydrate()
  }, [])

  const usable = isChallengeUsable({ challengeToken, expiresAt })
  const matches = purpose === expected

  /**
   * 本页是否已经完成使命（换到会话、或用户主动放弃）。
   *
   * 成功路径会清空票据，那一刻守卫看到的就是「票据没了」——若不设这道闸，
   * 守卫会在成功跳转之后再跳一次 `/login`，把刚建立的登录顶掉。
   * 用 ref 而不是 state：它必须在同一个事件循环里立刻生效，不能等下一次渲染。
   */
  const settledRef = useRef(false)

  useEffect(() => {
    if (!hasHydrated || settledRef.current) return
    if (!usable || !matches) router.replace('/login')
  }, [hasHydrated, usable, matches, router])

  // 票据不在（含成功后已清空）就渲染过渡态——此时要么在等 rehydrate，
  // 要么正在跳转离开，两种情况都不该继续显示表单。
  if (!hasHydrated || !usable || !matches || !challengeToken || !expiresAt || !purpose) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-background">
        <p className="flex items-center gap-2 text-sm text-gray-500">
          <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden />
          正在校验登录状态…
        </p>
      </main>
    )
  }

  const copy = COPY[expected]

  function finish(session: AuthSession) {
    // 先落闸再清票据：清空会让守卫看到「无票据」，闸门保证它不再插手跳转。
    settledRef.current = true
    const destination = nextPath
    setSession(session)
    clear()
    router.replace(destination)
    router.refresh()
  }

  function abandon() {
    settledRef.current = true
    clear()
    router.replace('/login')
  }

  return (
    <main className="grid min-h-screen bg-background lg:grid-cols-[minmax(320px,0.85fr)_minmax(460px,1.15fr)]">
      <section className="bg-primary-50 px-6 py-6 sm:px-10 lg:flex lg:flex-col lg:justify-between lg:px-14 lg:py-12">
        <Link
          href="/"
          className="w-fit text-base font-semibold text-primary-700 focus-visible:rounded-sm focus-visible:shadow-focus"
        >
          <BrandLogo size={34} showName imageClassName="h-[34px] w-[34px]" />
        </Link>
        <div className="mt-8 max-w-md lg:my-auto lg:py-12">
          <BrandLogo
            size={80}
            showName={false}
            imageClassName="mb-6 h-[72px] w-[72px] lg:mb-8 lg:h-20 lg:w-20"
            className="block"
          />
          <h1 className="text-balance text-2xl font-semibold tracking-[-0.03em] text-heading lg:text-3xl">
            {copy.title}
          </h1>
          <p className="mt-3 max-w-[48ch] text-pretty text-sm leading-6 text-gray-600 lg:mt-4 lg:text-base lg:leading-7">
            {copy.body}
          </p>
        </div>
        <p className="hidden text-xs text-gray-500 lg:block">AI 驱动，项目从容。</p>
      </section>

      <section className="flex items-center justify-center px-6 py-8 sm:px-10 lg:py-12">
        <TwoFactorChallengeForm
          challenge={{ challengeToken, expiresAt, purpose, skippable, methods }}
          onAuthenticated={finish}
          onCancel={abandon}
        />
      </section>
    </main>
  )
}
