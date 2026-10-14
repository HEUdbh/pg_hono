import jsQR from 'jsqr'

type StatusKind = 'idle' | 'running' | 'reserved' | 'fault' | 'disabled' | 'offline' | 'unknown'
type Device = {
  goodsId: string
  school: string
  building: string
  floor: string
  deviceNumber: string
  categoryCode: string
  categoryName: string
  name: string
  status: { kind: StatusKind; message?: string | null; remainTime: number; observedAt: string }
}

const statusLabels: Record<StatusKind, string> = {
  idle: '空闲可用',
  running: '使用中',
  reserved: '已预约',
  fault: '故障',
  disabled: '停用',
  offline: '离线',
  unknown: '状态未知',
}

const $ = <T = HTMLElement>(selector: string) => document.querySelector(selector) as T | null
const $$ = <T = HTMLElement>(selector: string) => Array.from(document.querySelectorAll(selector)) as T[]
const uploadInput = $('#qr-file') as HTMLInputElement | null
const qrForm = $('[data-qr-form]') as HTMLFormElement | null
const qrUrlInput = $('#qr-url') as HTMLInputElement | null
const uploadStatus = $('[data-upload-status]')
const deviceList = $('[data-device-list]')
const emptyState = $('[data-empty]') as HTMLElement | null
const countLabel = $('[data-count]')
const lastUpdated = $('[data-last-updated]')
let currentDevices: Device[] = []
let isBusy = false

function escapeHtml(value: unknown) {
  return String(value ?? '').replace(/[&<>'"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[char] || char))
}

function showFeedback(title: string, message: string) {
  const dialog = $('[data-feedback]') as HTMLDialogElement | null
  if (!dialog) return
  const titleNode = $('[data-feedback-title]')
  const messageNode = $('[data-feedback-message]')
  if (titleNode) titleNode.textContent = title
  if (messageNode) messageNode.textContent = message
  if (typeof dialog.showModal === 'function') dialog.showModal()
  else dialog.setAttribute('open', '')
}

function formatObservedAt(value: string) {
  return new Intl.DateTimeFormat('zh-CN', { hour: '2-digit', minute: '2-digit' }).format(new Date(value))
}

function renderDevices(devices: Device[]) {
  if (!deviceList || !emptyState) return
  currentDevices = devices
  deviceList.innerHTML = devices.map((device) => {
    const status = statusLabels[device.status.kind] || statusLabels.unknown
    const remain = device.status.kind === 'running' && device.status.remainTime > 0
      ? `剩余 ${device.status.remainTime} 分钟`
      : device.status.kind === 'idle' ? '现在可以使用' : (device.status.message || '请查看设备')
    return `<article class="device-item status-${escapeHtml(device.status.kind)}">
      <div class="device-item-top"><span class="status-dot" aria-hidden="true"></span><span class="status-label">${escapeHtml(status)}</span><span class="device-time">${escapeHtml(formatObservedAt(device.status.observedAt))} 更新</span></div>
      <h3>${escapeHtml(device.name)}</h3>
      <p class="device-path">${escapeHtml(device.school)} / ${escapeHtml(device.building)} / ${escapeHtml(device.floor)} / ${escapeHtml(device.deviceNumber)}</p>
      <div class="device-item-bottom"><span>${escapeHtml(device.categoryName)}</span><strong>${escapeHtml(remain)}</strong></div>
    </article>`
  }).join('')
  emptyState.hidden = devices.length > 0
  if (countLabel) countLabel.textContent = `${devices.length} 台设备`
}

function setOptions(selector: string, values: string[], current = '') {
  const select = $<HTMLSelectElement>(selector)
  if (!select) return
  const first = select.options[0]?.outerHTML || '<option value="">全部</option>'
  select.innerHTML = first + values.map((value) => `<option value="${escapeHtml(value)}">${escapeHtml(value)}</option>`).join('')
  select.value = values.includes(current) ? current : ''
}

async function loadDevices() {
  const params = new URLSearchParams()
  $$<HTMLSelectElement>('[data-filter]').forEach((select) => { if (select.value) params.set(select.dataset.filter || '', select.value) })
  const response = await fetch(`/api/devices?${params.toString()}`)
  const payload = await response.json() as { ok: boolean; data?: { devices: Device[]; filters: { schools: string[]; buildings: string[]; floors: string[]; categories: { code: string; name: string }[] }; serverTime: string }; message?: string }
  if (!response.ok || !payload.ok || !payload.data) throw new Error(payload.message || '设备目录加载失败')
  renderDevices(payload.data.devices)
  const selected = Object.fromEntries($$<HTMLSelectElement>('[data-filter]').map((select) => [select.dataset.filter || '', select.value]))
  setOptions('[data-filter="school"]', payload.data.filters.schools, selected.school)
  setOptions('[data-filter="building"]', payload.data.filters.buildings, selected.building)
  setOptions('[data-filter="floor"]', payload.data.filters.floors, selected.floor)
  const categorySelect = $<HTMLSelectElement>('[data-filter="categoryCode"]')
  if (categorySelect) {
    const first = categorySelect.options[0]?.outerHTML || '<option value="">全部类型</option>'
    categorySelect.innerHTML = first + payload.data.filters.categories.map((category) => `<option value="${escapeHtml(category.code)}">${escapeHtml(category.name)}</option>`).join('')
    categorySelect.value = selected.categoryCode || ''
  }
  if (lastUpdated) lastUpdated.textContent = `目录更新于 ${formatObservedAt(payload.data.serverTime)}`
}

async function refreshDevices() {
  if (!currentDevices.length || isBusy) return
  isBusy = true
  const button = $('[data-refresh]') as HTMLButtonElement | null
  if (button) { button.disabled = true; button.dataset.original = button.textContent || ''; button.textContent = '刷新中…' }
  try {
    const response = await fetch('/api/devices/refresh', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ goodsIds: currentDevices.map((device) => device.goodsId) }) })
    const payload = await response.json() as { ok: boolean; data?: { devices: Device[] }; message?: string }
    if (!response.ok || !payload.ok || !payload.data) throw new Error(payload.message || '刷新失败')
    const refreshed = new Map(payload.data.devices.map((device) => [device.goodsId, device]))
    renderDevices(currentDevices.map((device) => refreshed.get(device.goodsId) || device))
    if (lastUpdated) lastUpdated.textContent = `刚刚更新 · ${formatObservedAt(new Date().toISOString())}`
  } catch (error) {
    showFeedback('刷新失败', error instanceof Error ? error.message : '请稍后重试')
  } finally {
    isBusy = false
    if (button) { button.disabled = false; button.textContent = button.dataset.original || '刷新状态 ↻' }
  }
}

function decodeQr(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(new Error('无法读取图片'))
    reader.onload = () => {
      const image = new Image()
      image.onload = () => {
        const scale = Math.min(1, 1600 / Math.max(image.naturalWidth, image.naturalHeight))
        const canvas = document.createElement('canvas')
        canvas.width = Math.max(1, Math.round(image.naturalWidth * scale))
        canvas.height = Math.max(1, Math.round(image.naturalHeight * scale))
        const context = canvas.getContext('2d', { willReadFrequently: true })
        if (!context) return reject(new Error('浏览器不支持图片解析'))
        context.drawImage(image, 0, 0, canvas.width, canvas.height)
        const pixels = context.getImageData(0, 0, canvas.width, canvas.height)
        const result = jsQR(pixels.data, pixels.width, pixels.height, { inversionAttempts: 'attemptBoth' })
        if (!result?.data) return reject(new Error('图片中没有识别到二维码'))
        resolve(result.data)
      }
      image.onerror = () => reject(new Error('图片格式无法解析'))
      image.src = String(reader.result)
    }
    reader.readAsDataURL(file)
  })
}

async function submitQrText(qrText: string) {
  const response = await fetch('/api/devices/scan', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ qrText }) })
  const payload = await response.json() as { ok: boolean; data?: Device; message?: string }
  if (!response.ok || !payload.ok || !payload.data) throw new Error(payload.message || '设备添加失败')
  await loadDevices()
  return payload.data
}

async function handleQrText(qrText: string) {
  if (!uploadStatus) return
  uploadStatus.textContent = '已识别，正在拉取设备信息…'
  try {
    const device = await submitQrText(qrText)
    uploadStatus.textContent = `已添加：${device.name}`
    if (qrUrlInput) qrUrlInput.value = ''
  } catch (error) {
    uploadStatus.textContent = '等待上传'
    showFeedback('添加失败', error instanceof Error ? error.message : '请检查二维码后重试')
  }
}

async function handleUpload(file: File) {
  if (!uploadStatus) return
  uploadStatus.textContent = '正在识别二维码…'
  try {
    const qrText = await decodeQr(file)
    await handleQrText(qrText)
  } catch (error) {
    uploadStatus.textContent = '等待上传'
    showFeedback('添加失败', error instanceof Error ? error.message : '请检查二维码后重试')
  } finally {
    if (uploadInput) uploadInput.value = ''
  }
}

uploadInput?.addEventListener('change', () => {
  const file = uploadInput.files?.[0]
  if (file) void handleUpload(file)
})
qrForm?.addEventListener('submit', (event) => {
  event.preventDefault()
  const value = qrUrlInput?.value.trim()
  if (!value) {
    showFeedback('无法添加', '请先粘贴二维码解析后的 URL')
    return
  }
  void handleQrText(value)
})
$('[data-refresh]')?.addEventListener('click', () => void refreshDevices())
$$<HTMLSelectElement>('[data-filter]').forEach((select) => select.addEventListener('change', () => void loadDevices().catch((error) => showFeedback('加载失败', error.message))))
$('[data-feedback-close]')?.addEventListener('click', () => {
  const dialog = $('[data-feedback]') as HTMLDialogElement | null
  if (dialog?.open) dialog.close()
  else dialog?.removeAttribute('open')
})

if (deviceList) void loadDevices().catch((error) => showFeedback('加载失败', error instanceof Error ? error.message : '设备目录暂时不可用'))

const revealObserver = 'IntersectionObserver' in window
  ? new IntersectionObserver((entries) => entries.forEach((entry) => { if (entry.isIntersecting) entry.target.classList.add('is-visible') }), { threshold: 0.15 })
  : null
$$('.reveal').forEach((element) => revealObserver?.observe(element))
