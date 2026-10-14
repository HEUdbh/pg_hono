import type {
  CloudflareBindings,
  DetailResult,
  DeviceIndexEntry,
  DeviceRecord,
  DeviceStatus,
  StatusKind,
} from '../types'

export function getDeviceKv(env: Pick<CloudflareBindings, 'DEVICE_KV' | 'KV'>) {
  const kv = env.DEVICE_KV || env.KV
  if (!kv) throw new Error('未配置设备 KV：请确认 wrangler.jsonc 中存在 KV 绑定')
  return kv
}

export const INDEX_KEY = 'device:index'
export const DEVICE_PREFIX = 'device:'

export function normalizeQrText(value: string) {
  const trimmed = value.trim()
  const uuid = decodeURIComponent(trimmed).match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i)?.[0]
  if (uuid) return uuid
  try {
    const url = new URL(trimmed)
    for (const key of ['NQT', 'nqt', 'uuid', 'id', 'goodsId', 'goods_id', 'deviceId', 'machineId']) {
      const candidate = url.searchParams.get(key)?.trim()
      if (candidate) return normalizeQrText(candidate)
    }
    const pathUuid = url.pathname.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i)?.[0]
    if (pathUuid) return pathUuid
  } catch {
    // The upstream service may accept non-UUID payloads, so retain raw QR text.
  }
  return trimmed
}

const CATEGORY_NAMES: Record<string, string> = {
  '00': '洗衣机',
  '02': '烘干机',
  '03': '吹风机',
  '04': '饮水机',
  '08': '淋浴',
  '11': '空调',
}

export class ClassificationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ClassificationError'
  }
}

export function statusFromDetail(detail: DetailResult, observedAt = new Date().toISOString()): DeviceStatus {
  const code = detail.deviceErrorCode === null || detail.deviceErrorCode === undefined
    ? ''
    : String(detail.deviceErrorCode)
  const remainTime = Math.max(0, Number(detail.remainTime || 0))
  let kind: StatusKind = 'unknown'

  if (!code && remainTime === 0) kind = 'idle'
  else if (code === '2' || remainTime > 0) kind = 'running'
  else if (code === '7') kind = 'reserved'
  else if (code === '4111') kind = 'disabled'
  else if (code === '4204' || code === '99') kind = 'offline'
  else if (code === '-100' || code === '4000' || code === '4107' || code === '5023') kind = 'fault'

  return {
    kind,
    sourceCode: detail.deviceErrorCode ?? null,
    message: detail.deviceErrorMsg ?? null,
    remainTime,
    observedAt,
  }
}

function required(value: string | number | null | undefined, label: string) {
  const normalized = String(value ?? '').trim()
  if (!normalized) throw new ClassificationError(`缺少${label}`)
  return normalized
}

function parseLocation(name: string, parentPointName?: string) {
  const buildingMatch = name.match(/(\d+\s*号楼)/) || parentPointName?.match(/(\d+\s*号楼)/)
  const floorMatch = name.match(/(\d+\s*层)/)
  const deviceMatch = name.match(/楼\s*\d+\s*层\s*(\d+\s*号)/) || name.match(/(?:^|\D)(\d+\s*号)(?:洗衣机|烘干机|吹风机|饮水机|淋浴|空调|洗鞋机|设备)?$/)
  return {
    building: buildingMatch?.[1]?.replace(/\s+/g, '') || '',
    floor: floorMatch?.[1]?.replace(/\s+/g, '') || '',
    deviceNumber: deviceMatch?.[1]?.replace(/\s+/g, '') || '',
  }
}

export function classifyDetail(detail: DetailResult) {
  const name = required(detail.name, '设备名称')
  const school = required(detail.orgName, '学校或网点')
  const location = parseLocation(name, detail.parentPointName)
  const building = required(location.building, '楼号')
  const floor = required(location.floor, '楼层')
  const deviceNumber = required(location.deviceNumber, '设备编号')
  const categoryCode = required(detail.categoryCode, '设备类型')
  const categoryName = CATEGORY_NAMES[categoryCode] || categoryCode

  return { name, school, building, floor, deviceNumber, categoryCode, categoryName }
}

export async function hashQrText(qrText: string) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(qrText))
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

export function toIndexEntry(record: DeviceRecord): DeviceIndexEntry {
  return {
    goodsId: record.goodsId,
    school: record.school,
    building: record.building,
    floor: record.floor,
    deviceNumber: record.deviceNumber,
    categoryCode: record.categoryCode,
    categoryName: record.categoryName,
    name: record.name,
    createdAt: record.createdAt,
  }
}

export async function readIndex(kv: KVNamespace) {
  return (await kv.get<DeviceIndexEntry[]>(INDEX_KEY, 'json')) || []
}

export async function readRecords(kv: KVNamespace, entries: DeviceIndexEntry[]) {
  const records = await Promise.all(entries.map((entry) => kv.get<DeviceRecord>(`${DEVICE_PREFIX}${entry.goodsId}`, 'json')))
  return records.filter((record): record is DeviceRecord => Boolean(record))
}

export async function saveNewRecord(kv: KVNamespace, record: DeviceRecord) {
  const index = await readIndex(kv)
  if (index.some((entry) => entry.goodsId === record.goodsId)) return false
  await kv.put(`${DEVICE_PREFIX}${record.goodsId}`, JSON.stringify(record))
  await kv.put(INDEX_KEY, JSON.stringify([...index, toIndexEntry(record)]))
  return true
}

export async function updateRecord(kv: KVNamespace, record: DeviceRecord) {
  await kv.put(`${DEVICE_PREFIX}${record.goodsId}`, JSON.stringify(record))
}

export function makeRecord(detail: DetailResult, qrTextHash: string): DeviceRecord {
  const classification = classifyDetail(detail)
  const now = new Date().toISOString()
  return {
    schemaVersion: 1,
    goodsId: String(detail.goodsId),
    qrTextHash,
    ...classification,
    orgId: detail.orgId === undefined ? undefined : String(detail.orgId),
    orgName: detail.orgName,
    shopId: detail.shopId === undefined ? undefined : String(detail.shopId),
    parentPointName: detail.parentPointName,
    childPointName: detail.childPointName || undefined,
    status: statusFromDetail(detail, now),
    createdAt: now,
    updatedAt: now,
  }
}

export function withUpdatedStatus(record: DeviceRecord, detail: DetailResult): DeviceRecord {
  return {
    ...record,
    status: statusFromDetail(detail),
    updatedAt: new Date().toISOString(),
  }
}
