export type StatusKind =
  | 'idle'
  | 'running'
  | 'reserved'
  | 'fault'
  | 'disabled'
  | 'offline'
  | 'unknown'

export interface DeviceStatus {
  kind: StatusKind
  sourceCode?: string | number | null
  message?: string | null
  remainTime: number
  observedAt: string
}

export interface DeviceRecord {
  schemaVersion: 1
  goodsId: string
  qrTextHash: string
  school: string
  building: string
  floor: string
  deviceNumber: string
  categoryCode: string
  categoryName: string
  name: string
  orgId?: string
  orgName?: string
  shopId?: string
  parentPointName?: string
  childPointName?: string
  status: DeviceStatus
  createdAt: string
  updatedAt: string
}

export interface DeviceIndexEntry {
  goodsId: string
  school: string
  building: string
  floor: string
  deviceNumber: string
  categoryCode: string
  categoryName: string
  name: string
  createdAt: string
}

export interface UpstreamEnvelope<T> {
  code: number
  msg?: string
  data: T
  t?: number
}

export interface ScanResult {
  id: string
  shopId?: string | number
  categoryCode?: string
  categoryName?: string
  type?: string
  useModel?: string
  shopCanReserve?: boolean
}

export interface DetailResult {
  goodsId: string | number
  name?: string
  categoryCode?: string
  subCategoryId?: number
  orgId?: string | number
  orgName?: string
  shopId?: string | number
  deviceId?: string | number
  imei?: string
  machineId?: string
  communication?: string
  isBluetooth?: number
  payment?: string
  deviceErrorCode?: string | number | null
  deviceErrorMsg?: string | null
  remainTime?: number | null
  isReserve?: number
  soldState?: number
  stockType?: number
  payTypes?: number[]
  supportAppUserFinish?: boolean
  tradeMain?: number
  brandName?: string
  serviceTelephone?: string
  parentPointName?: string
  childPointName?: string | null
}

export interface CloudflareBindings {
  DEVICE_KV?: KVNamespace
  KV?: KVNamespace
  UPSTREAM_BASE_URL?: string
  UPSTREAM_TOKEN?: string
  UPSTREAM_APP_SECRET?: string
  UPSTREAM_DEVICE_ID?: string
  UPSTREAM_PHONE_BRAND?: string
  UPSTREAM_USER_AGENT?: string
}

export type ApiResponse<T> =
  | { ok: true; data: T }
  | { ok: false; code: string; message: string }
