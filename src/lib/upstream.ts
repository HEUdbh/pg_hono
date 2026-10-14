import type {
  CloudflareBindings,
  DetailResult,
  ScanResult,
  UpstreamEnvelope,
} from '../types'

const DEFAULT_BASE_URL = 'https://userapi.qiekj.com'
const CHANNEL = 'android_app'
const VERSION = '1.141.0'

export class UpstreamError extends Error {
  constructor(
    message: string,
    public readonly status = 502,
    public readonly upstreamCode?: number,
  ) {
    super(message)
    this.name = 'UpstreamError'
  }
}

function requireSetting(value: string | undefined, name: string) {
  if (!value) throw new UpstreamError(`缺少服务端配置：${name}`, 500)
  return value
}

async function sha256Hex(value: string) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

async function call<T>(env: CloudflareBindings, path: string, fields: Record<string, string>) {
  const token = requireSetting(env.UPSTREAM_TOKEN, 'UPSTREAM_TOKEN')
  const appSecret = requireSetting(env.UPSTREAM_APP_SECRET, 'UPSTREAM_APP_SECRET')
  const timestamp = String(Date.now())
  const signText = `appSecret=${appSecret}&channel=${CHANNEL}&timestamp=${timestamp}&token=${token}&version=${VERSION}&${path}`
  const sign = await sha256Hex(signText)
  const form = new URLSearchParams({ ...fields, token })
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 10000)

  try {
    const response = await fetch(`${env.UPSTREAM_BASE_URL || DEFAULT_BASE_URL}${path}`, {
      method: 'POST',
      headers: {
        Authorization: token,
        Version: VERSION,
        channel: CHANNEL,
        phoneBrand: env.UPSTREAM_PHONE_BRAND || 'vivo',
        deviceId: requireSetting(env.UPSTREAM_DEVICE_ID, 'UPSTREAM_DEVICE_ID'),
        timestamp,
        sign,
        'User-Agent': env.UPSTREAM_USER_AGENT || `QEUser/${VERSION} (com.qiekj.user; userChannel:${CHANNEL})`,
        'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8',
      },
      body: form.toString(),
      signal: controller.signal,
    })

    if (!response.ok) throw new UpstreamError(`上游接口 HTTP ${response.status}`)
    const payload = (await response.json()) as UpstreamEnvelope<T>
    if (payload.code !== 0) throw new UpstreamError(payload.msg || '上游接口返回业务错误', 502, payload.code)
    return payload
  } catch (error) {
    if (error instanceof UpstreamError) throw error
    if (error instanceof Error && error.name === 'AbortError') {
      throw new UpstreamError('上游接口请求超时')
    }
    throw new UpstreamError('上游接口暂时不可用')
  } finally {
    clearTimeout(timeout)
  }
}

export function scanDevice(env: CloudflareBindings, qrText: string) {
  return call<ScanResult>(env, '/goods/scan/v2', { NQT: qrText })
}

export function getDeviceDetail(env: CloudflareBindings, goodsId: string) {
  return call<DetailResult>(env, '/goods/normal/details', { goodsId })
}
