'use client'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { pushApi, pushKeys } from '@/lib/api/push'
import { useAuthStore } from '@/stores/auth-store'
import { useToast } from '@/components/ui/Toast'
import { useCallback, useEffect, useState } from 'react'

/**
 * 推送能力状态查询。
 */
export function usePushCapability() {
  return useQuery({
    queryKey: pushKeys.capability(),
    queryFn: () => pushApi.capability(),
    staleTime: 60_000, // 能力状态缓存 1 分钟
  })
}

/**
 * 当前用户订阅状态查询。
 */
export function usePushSubscription() {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated)

  return useQuery({
    queryKey: pushKeys.subscription(),
    queryFn: () => pushApi.subscriptionStatus(),
    staleTime: 30_000,
    enabled: isAuthenticated,
  })
}

/**
 * 浏览器推送订阅状态。
 * 返回浏览器级的 PushSubscription 状态（非后端）。
 */
export function useBrowserPushSubscription() {
  const [subscription, setSubscription] = useState<PushSubscription | null>(null)
  const [supportState, setSupportState] = useState<'supported' | 'unsupported' | 'unknown'>(
    'unknown',
  )

  useEffect(() => {
    if (typeof window === 'undefined') return
    if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
      setSupportState('unsupported')
      return
    }
    setSupportState('supported')

    navigator.serviceWorker.ready
      .then((reg) => reg.pushManager.getSubscription())
      .then((sub) => setSubscription(sub))
      .catch(() => setSupportState('unsupported'))
  }, [])

  return { subscription, supportState }
}

/**
 * 订阅推送 mutation。
 * 请求浏览器权限后发送订阅请求到后端。
 */
export function usePushSubscribe() {
  const queryClient = useQueryClient()
  const { toast } = useToast()

  return useMutation({
    mutationFn: async () => {
      // 请求浏览器通知权限
      const permission = await Notification.requestPermission()
      if (permission !== 'granted') {
        throw new Error('PERMISSION_DENIED')
      }

      // 获取 service worker 注册
      const registration = await navigator.serviceWorker.ready

      // 获取推送能力状态（获取 VAPID 公钥）
      const capability = await pushApi.capability()
      if (!capability.enabled) {
        throw new Error('FEATURE_DISABLED')
      }

      // 订阅推送
      const subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: capability.vapidPublicKey
          ? urlBase64ToUint8Array(capability.vapidPublicKey)
          : undefined,
      })

      // 发送订阅到后端
      const subJson = subscription.toJSON()
      const endpoint = subJson.endpoint
      const keys = subJson.keys
      if (!endpoint || !keys?.p256dh || !keys.auth) {
        throw new Error('SUBSCRIPTION_INVALID')
      }

      return pushApi.subscribe({
        endpoint,
        keys: {
          p256dh: keys.p256dh,
          auth: keys.auth,
        },
        userAgent: navigator.userAgent.slice(0, 255),
      })
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: pushKeys.subscription() })
      toast({ variant: 'success', title: '已开启推送通知' })
    },
    onError: (error: Error) => {
      if (error.message === 'PERMISSION_DENIED') {
        toast({
          variant: 'warning',
          title: '通知权限被拒绝',
          description: '请在浏览器设置中允许通知权限',
        })
      } else if (error.message === 'FEATURE_DISABLED') {
        toast({ variant: 'warning', title: '推送功能未启用' })
      } else {
        toast({ variant: 'error', title: '订阅失败', description: '请稍后重试' })
      }
    },
  })
}

/**
 * 取消订阅 mutation。
 */
export function usePushUnsubscribe() {
  const queryClient = useQueryClient()
  const { toast } = useToast()

  return useMutation({
    mutationFn: async () => {
      // 获取浏览器订阅并取消
      const registration = await navigator.serviceWorker.ready
      const subscription = await registration.pushManager.getSubscription()
      if (subscription) {
        const endpoint = subscription.endpoint
        await subscription.unsubscribe()
        // 通知后端
        return pushApi.unsubscribe(endpoint)
      }
      return { success: true }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: pushKeys.subscription() })
      toast({ variant: 'success', title: '已关闭推送通知' })
    },
    onError: () => {
      toast({ variant: 'error', title: '取消订阅失败', description: '请稍后重试' })
    },
  })
}

/**
 * 检查浏览器是否支持推送。
 */
export function useIsPushSupported(): boolean {
  const [supported, setSupported] = useState(false)

  useEffect(() => {
    if (typeof window === 'undefined') return
    setSupported(
      'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window,
    )
  }, [])

  return supported
}

/**
 * 检查通知权限状态。
 */
export function useNotificationPermission(): NotificationPermission | 'loading' {
  const [permission, setPermission] = useState<NotificationPermission | 'loading'>('loading')

  useEffect(() => {
    if (typeof window === 'undefined') return
    if (!('Notification' in window)) {
      setPermission('denied')
      return
    }
    setPermission(Notification.permission)
  }, [])

  return permission
}

/**
 * 浏览器退订 + 后端退订（登出/会话过期时调用）。
 * best-effort，不阻塞调用方。
 */
export function useBrowserPushCleanup() {
  const cleanup = useCallback(async () => {
    try {
      if (typeof window === 'undefined') return
      if (!('serviceWorker' in navigator) || !('PushManager' in window)) return

      const registration = await navigator.serviceWorker.ready
      const subscription = await registration.pushManager.getSubscription()
      if (subscription) {
        const endpoint = subscription.endpoint
        await subscription.unsubscribe()
        // 后端退订（best-effort）
        try {
          await pushApi.unsubscribe(endpoint)
        } catch {
          // 忽略后端退订失败
        }
      }
    } catch {
      // 忽略清理失败
    }
  }, [])

  return cleanup
}

/**
 * 将 base64url 字符串转换为 Uint8Array（用于 applicationServerKey）。
 */
function urlBase64ToUint8Array(base64String: string): ArrayBuffer {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4)
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/')
  const rawData = atob(base64)
  const buffer = new ArrayBuffer(rawData.length)
  const outputArray = new Uint8Array(buffer)
  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i)
  }
  return buffer
}
