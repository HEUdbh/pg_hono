import { Hono } from 'hono'
import { renderer } from './renderer'
import type { ApiResponse, CloudflareBindings, DeviceRecord } from './types'
import { ClassificationError, getDeviceKv, hashQrText, makeRecord, normalizeQrText, readIndex, readRecords, updateRecord, withUpdatedStatus, saveNewRecord } from './lib/devices'
import { getDeviceDetail, scanDevice, UpstreamError } from './lib/upstream'

const app = new Hono<{ Bindings: CloudflareBindings }>()
app.use(renderer)

const success = <T,>(data: T): ApiResponse<T> => ({ ok: true, data })
const failure = (code: string, message: string): ApiResponse<never> => ({ ok: false, code, message })

function homePage() {
  return (
    <main class="home-page">
      <nav class="site-nav container" aria-label="主导航">
        <a class="brand" href="/">胖乖生活<span>/设备情况</span></a>
        <a class="text-link" href="/devices">查看设备 <span aria-hidden="true">→</span></a>
      </nav>

      <section class="home-hero container">
        <div class="hero-copy reveal">
          <p class="eyebrow">PANGGUAI LIFE / CAMPUS LAUNDRY</p>
          <h1>洗衣服之前，先知道哪一台在等你。</h1>
          <p class="hero-lede">把散落在楼层里的洗衣机，整理成一张清楚的公共地图。看状态、看剩余时间，也可以用一张二维码把新设备加入进来。</p>
          <a class="button button-primary" href="/devices">进入设备情况 <span aria-hidden="true">↗</span></a>
        </div>
        <figure class="hero-image reveal reveal-delay">
          <img src="https://images.unsplash.com/photo-1517677208171-0bc6725a3e60?auto=format&fit=crop&w=1400&q=85" alt="明亮洗衣房中的洗衣机" />
          <figcaption>一件衣服的路程，从找到空闲机器开始。</figcaption>
        </figure>
      </section>

      <section class="story container" aria-label="项目故事">
        <article class="story-step reveal"><span>01</span><div><h2>先看一眼</h2><p>不用下楼碰运气，先查到哪台机器空闲。</p></div></article>
        <article class="story-step reveal"><span>02</span><div><h2>再走过去</h2><p>学校、楼号、楼层和编号，设备位置一目了然。</p></div></article>
        <article class="story-step reveal"><span>03</span><div><h2>把新机器留下</h2><p>拍下二维码，系统自动识别并加入公共设备库。</p></div></article>
      </section>

      <section class="home-footer container reveal">
        <div><p class="eyebrow">QUIET UTILITY</p><h2>少一点等待，多一点确定。</h2></div>
        <a class="circle-arrow" href="/devices" aria-label="打开设备情况">↗</a>
      </section>
    </main>
  )
}

function devicesPage() {
  return (
    <main class="devices-page">
      <nav class="site-nav container" aria-label="主导航">
        <a class="brand" href="/">胖乖生活<span>/设备情况</span></a>
        <a class="text-link" href="/">返回首页 <span aria-hidden="true">←</span></a>
      </nav>

      <section class="devices-intro container">
        <div>
          <p class="eyebrow">DEVICE STATUS / SHARED DIRECTORY</p>
          <h1>设备情况</h1>
          <p>按学校、楼号、楼层找到设备。上传二维码，只添加，不删除。</p>
        </div>
        <div class="upload-panel" data-upload-panel>
          <div class="upload-copy"><span class="upload-mark" aria-hidden="true">＋</span><div><strong>添加新设备</strong><small>上传清晰的二维码图片</small></div></div>
          <label class="button button-primary upload-button" for="qr-file">选择二维码图片</label>
          <input id="qr-file" type="file" accept="image/*" hidden />
          <form class="qr-url-form" data-qr-form>
            <label for="qr-url">或粘贴二维码解析后的 URL</label>
            <div class="qr-url-row"><input id="qr-url" name="qrUrl" type="url" inputmode="url" autocomplete="off" placeholder="https://…" /><button class="button button-quiet" type="submit">添加</button></div>
          </form>
          <p class="upload-status" data-upload-status aria-live="polite">等待上传</p>
        </div>
      </section>

      <section class="directory container" aria-label="设备目录">
        <div class="directory-toolbar">
          <div><p class="eyebrow">PUBLIC DIRECTORY</p><h2>正在记录的设备</h2></div>
          <button class="button button-quiet" type="button" data-refresh>刷新状态 <span aria-hidden="true">↻</span></button>
        </div>
        <div class="filters" data-filters>
          <label>学校<select data-filter="school"><option value="">全部学校</option></select></label>
          <label>楼号<select data-filter="building"><option value="">全部楼号</option></select></label>
          <label>楼层<select data-filter="floor"><option value="">全部楼层</option></select></label>
          <label>设备类型<select data-filter="categoryCode"><option value="">全部类型</option></select></label>
        </div>
        <div class="directory-meta"><span data-count>正在加载设备...</span><span data-last-updated></span></div>
        <div class="device-grid" data-device-list aria-live="polite"></div>
        <div class="empty-state" data-empty hidden><span class="empty-line" aria-hidden="true"></span><p>还没有匹配的设备。</p><small>上传二维码后，设备会出现在这里。</small></div>
      </section>
    </main>
  )
}

function statusMessage(error: unknown) {
  if (error instanceof ClassificationError) return { status: 422, body: failure('INCOMPLETE_CLASSIFICATION', error.message) }
  if (error instanceof UpstreamError) {
    const message = error.message
    if (message.includes('功能未上线')) {
      return { status: 422, body: failure('QR_FEATURE_UNAVAILABLE', '该二维码对应的设备暂不支持扫码接入，请确认使用的是设备机身二维码') }
    }
    if (message.includes('未绑定') || error.upstreamCode === 4000) {
      return { status: 422, body: failure('DEVICE_NOT_BOUND', '该二维码对应的设备尚未绑定，请联系设备服务商') }
    }
    return { status: error.status, body: failure('UPSTREAM_ERROR', message) }
  }
  return { status: 500, body: failure('INTERNAL_ERROR', '服务暂时不可用，请稍后重试') }
}

app.get('/', (c) => c.render(homePage()))
app.get('/devices', (c) => c.render(devicesPage()))

app.get('/api/devices', async (c) => {
  try {
    const kv = getDeviceKv(c.env)
    const index = await readIndex(kv)
    const records = await readRecords(kv, index)
    const filters = {
      schools: [...new Set(records.map((device) => device.school))].sort(),
      buildings: [...new Set(records.map((device) => device.building))].sort(),
      floors: [...new Set(records.map((device) => device.floor))].sort(),
      categories: [...new Map(records.map((device) => [device.categoryCode, device.categoryName])).entries()].map(([code, name]) => ({ code, name })),
    }
    const school = c.req.query('school')
    const building = c.req.query('building')
    const floor = c.req.query('floor')
    const categoryCode = c.req.query('categoryCode')
    const filtered = records.filter((device) =>
      (!school || device.school === school) &&
      (!building || device.building === building) &&
      (!floor || device.floor === floor) &&
      (!categoryCode || device.categoryCode === categoryCode),
    )
    return c.json(success({ devices: filtered, filters, serverTime: new Date().toISOString() }))
  } catch {
    return c.json(failure('KV_READ_ERROR', '设备目录暂时无法读取'), 500)
  }
})

app.post('/api/devices/scan', async (c) => {
  try {
    const body = await c.req.json<{ qrText?: string }>()
    const qrText = body.qrText?.trim()
    if (!qrText || qrText.length > 2048) return c.json(failure('INVALID_QR_TEXT', '二维码内容无效'), 400)
    const upstreamQrText = normalizeQrText(qrText)
    const scanned = await scanDevice(c.env, upstreamQrText)
    const goodsId = String(scanned.data.id || '')
    if (!goodsId) return c.json(failure('MISSING_GOODS_ID', '二维码未识别出设备编号'), 502)
    const detail = await getDeviceDetail(c.env, goodsId)
    const record = makeRecord({ ...detail.data, goodsId }, await hashQrText(qrText))
    const added = await saveNewRecord(getDeviceKv(c.env), record)
    if (!added) return c.json(failure('DUPLICATE_DEVICE', '这台设备已经添加过了'), 409)
    return c.json(success(record), 201)
  } catch (error) {
    const result = statusMessage(error)
    return c.json(result.body, result.status as 400 | 422 | 500 | 502)
  }
})

app.post('/api/devices/refresh', async (c) => {
  try {
    const body = await c.req.json<{ goodsIds?: string[] }>()
    const goodsIds = [...new Set((body.goodsIds || []).map(String).filter(Boolean))]
    if (!goodsIds.length || goodsIds.length > 25) return c.json(failure('INVALID_REFRESH_REQUEST', '一次最多刷新 25 台设备'), 400)
    const kv = getDeviceKv(c.env)
    const records = await readRecords(kv, await readIndex(kv))
    const selected = records.filter((record) => goodsIds.includes(record.goodsId))
    const updated: DeviceRecord[] = []
    for (const record of selected) {
      const detail = await getDeviceDetail(c.env, record.goodsId)
      const next = withUpdatedStatus(record, detail.data)
      await updateRecord(kv, next)
      updated.push(next)
    }
    return c.json(success({ devices: updated, serverTime: new Date().toISOString() }))
  } catch (error) {
    const result = statusMessage(error)
    return c.json(result.body, result.status as 400 | 422 | 500 | 502)
  }
})

export default app
