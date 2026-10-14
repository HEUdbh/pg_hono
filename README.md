# 胖乖生活 / 设备情况

胖乖生活是一个面向校园自助洗衣场景的设备状态查询工具。项目使用 Hono 部署在 Cloudflare Workers，通过上游设备 API 获取设备信息和实时状态，并使用 Cloudflare KV 保存全站共享设备目录。

## 项目功能

### 首页 `/`

- 用生活化的动态叙事介绍项目用途。
- 展示“先查状态，再去洗衣”的使用流程。
- 提供进入设备情况页的入口。
- 支持移动端、桌面端和 reduced-motion 模式。

### 设备页 `/devices`

- 上传二维码图片，浏览器自动解析二维码内容。
- 直接粘贴二维码解析后的 URL 添加设备。
- 服务端从 URL 中提取 UUID、`NQT`、`uuid`、`id`、`goodsId`、`deviceId` 或 `machineId`。
- 调用上游接口获取设备详情和状态。
- 自动按学校、楼号、楼层、设备编号、设备类型分类。
- 支持学校、楼号、楼层和设备类型筛选。
- 显示空闲、使用中、预约、故障、停用、离线和剩余时间。
- 进入页面自动加载，用户可手动刷新状态。
- 只允许添加，不提供删除功能。
- 重复设备、分类缺失、二维码无效和上游失败会显示失败弹窗。

### 数据规则

- 所有访客共享同一套设备目录，不需要登录。
- 新设备写入 Cloudflare KV。
- 相同 `goodsId` 不覆盖已有记录。
- 二维码原文不保存，只保存 SHA-256 摘要。
- KV 键：

```text
device:{goodsId}
device:index
```

## 页面和接口

| 地址 | 用途 |
|---|---|
| `/` | 项目首页 |
| `/devices` | 设备查询和添加页 |
| `GET /api/devices` | 查询设备目录和筛选项 |
| `POST /api/devices/scan` | 添加二维码设备 |
| `POST /api/devices/refresh` | 刷新设备状态 |

`POST /api/devices/scan` 请求：

```json
{ "qrText": "二维码原文或二维码解析后的 URL" }
```

`POST /api/devices/refresh` 请求：

```json
{ "goodsIds": ["1101849555"] }
```

单次最多刷新 25 台设备。项目没有删除接口。

## 技术栈

- Hono 4 + Hono JSX SSR
- Cloudflare Workers
- Cloudflare KV
- Vite + `@cloudflare/vite-plugin`
- TypeScript
- `jsqr` 二维码图片解析

主要代码：

```text
src/index.tsx          页面路由和 Worker API
src/renderer.tsx       HTML 外壳和生产资源注入
src/client.ts          图片解析、URL 添加、筛选和刷新
src/style.css          两个页面的响应式样式
src/lib/upstream.ts    上游签名请求
src/lib/devices.ts     分类解析、状态映射和 KV 读写
src/types.ts           类型定义
wrangler.jsonc         Worker 和 KV 配置
```

## 部署前准备

要求：Node.js 20+、npm 10+、Cloudflare 账号和 Wrangler 登录权限。

安装依赖并登录：

```powershell
npm install
npx wrangler login
npx wrangler whoami
```

当前项目使用 `KV` 作为 Cloudflare KV 绑定名。创建 namespace：

```powershell
npx wrangler kv namespace create KV
npx wrangler kv namespace create KV --preview
```

将返回的 ID 写入 `wrangler.jsonc`：

```jsonc
{
  "name": "pg_hono",
  "compatibility_date": "2025-08-03",
  "main": "./src/index.tsx",
  "kv_namespaces": [
    {
      "binding": "KV",
      "id": "生产 namespace id",
      "preview_id": "预览 namespace id"
    }
  ]
}
```

代码也兼容旧绑定名 `DEVICE_KV`，但新部署建议统一使用 `KV`。

## 环境变量配置

### 本地开发

在 `pg_hono/.dev.vars` 创建本地配置：

```text
UPSTREAM_BASE_URL=https://userapi.qiekj.com
UPSTREAM_TOKEN=实际 token
UPSTREAM_APP_SECRET=实际 appSecret
UPSTREAM_DEVICE_ID=实际 deviceId
UPSTREAM_PHONE_BRAND=vivo
UPSTREAM_USER_AGENT=QEUser/1.141.0 (com.qiekj.user; userChannel:android_app)
```

`.dev.vars` 已被 `.gitignore` 忽略，只用于本地 `npm run dev`。不要把 token 或 appSecret 写入前端、README 或 `wrangler.jsonc`。

### 生产环境

生产环境必须使用 Cloudflare Secrets。每条命令执行后粘贴对应值：

```powershell
npx wrangler secret put UPSTREAM_TOKEN
npx wrangler secret put UPSTREAM_APP_SECRET
npx wrangler secret put UPSTREAM_DEVICE_ID
npx wrangler secret put UPSTREAM_PHONE_BRAND
npx wrangler secret put UPSTREAM_USER_AGENT
```

检查已上传的 Secret 名称：

```powershell
npx wrangler secret list
```

`UPSTREAM_BASE_URL` 不上传也可以，代码默认使用：

```text
https://userapi.qiekj.com
```

如需显式配置，可在 `wrangler.jsonc` 增加：

```jsonc
"vars": {
  "UPSTREAM_BASE_URL": "https://userapi.qiekj.com"
}
```

## 本地运行和验证

```powershell
npm run typecheck
npm run dev
```

浏览器访问：

```text
http://localhost:5173/
http://localhost:5173/devices
```

生产构建：

```powershell
npm run build
```

如果修改了 `wrangler.jsonc`，重新生成 Worker 类型：

```powershell
npm run cf-typegen
```

## 部署到 Cloudflare Workers

确认 KV ID 和生产 Secrets 后执行：

```powershell
npm run deploy
```

部署脚本实际执行：

```text
npm run build
wrangler deploy
```

首次正式部署前可以先执行 dry-run：

```powershell
npm run deploy -- --dry-run
```

dry-run 应确认：

- Worker 名称为 `pg_hono`。
- 存在 `env.KV` KV Namespace 绑定。
- 构建产物中包含 `client-*.js`。
- 没有把 token 或 appSecret 写入源码。

部署后检查：

```text
https://你的域名/
https://你的域名/devices
https://你的域名/api/devices
```

## 发布验收

1. 首页可以打开并跳转设备页。
2. 设备页能返回空设备列表，而不是 500。
3. 粘贴二维码 URL 后，浏览器不会整页刷新，显示处理中或失败弹窗。
4. 使用有效设备二维码时返回新增设备。
5. 重复添加同一设备返回失败提示。
6. 设备可以按学校、楼号、楼层和类型筛选。
7. 刷新状态可以更新剩余时间和更新时间。
8. 上传无效二维码、未绑定设备或未开通设备时显示明确错误。

## 常见问题

### 提示“缺少 UPSTREAM_TOKEN”

本地检查 `pg_hono/.dev.vars`；线上执行：

```powershell
npx wrangler secret put UPSTREAM_TOKEN
```

然后重新执行 `npm run deploy`。

### URL 提交后没有反应

确认已经重新构建并部署。生产页面必须加载构建后的 `client-*.js`，不能直接引用 `/src/client.ts`。

### 提示“功能未上线”或“设备未绑定”

这通常是上游设备业务状态，不是 Worker 页面未部署。请确认使用的是设备机身二维码，并确认设备已经在上游平台绑定和开通。

### 本地提示“服务暂不可用”

依次检查：

1. `.dev.vars` 中的 `UPSTREAM_TOKEN`、`UPSTREAM_APP_SECRET`、`UPSTREAM_DEVICE_ID` 是否完整。
2. 上游 API 是否可访问。
3. 粘贴的 URL 是否确实包含设备 UUID 或设备参数。
4. 上游账号是否有权访问该设备。

## 安全注意事项

- 不要把 `.dev.vars`、token、appSecret 提交到 Git。
- 如果凭据曾经公开，立即在上游平台轮换。
- 当前系统无登录，任何访客都可以提交二维码；生产环境建议增加 Cloudflare WAF 或 Rate Limiting。
- Cloudflare KV 是最终一致性存储，极端并发下不适合作为强一致去重数据库。
