import { jsxRenderer } from 'hono/jsx-renderer'
import { Link, Script, ViteClient } from 'vite-ssr-components/hono'

export const renderer = jsxRenderer(({ children }) => {
  return (
    <html lang="zh-CN">
      <head>
        <meta charset="UTF-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <meta name="theme-color" content="#f5f4ef" />
        <meta name="description" content="胖乖生活：查看校园共享洗衣设备状态，扫码添加新设备。" />
        <title>胖乖生活 / 设备情况</title>
        <ViteClient />
        <Link href="/src/style.css" rel="stylesheet" />
      </head>
      <body>
        {children}
        <div class="feedback-layer" aria-live="assertive">
          <dialog class="feedback-dialog" data-feedback>
            <p class="eyebrow">NOTICE</p>
            <h2 data-feedback-title>操作未完成</h2>
            <p data-feedback-message>请稍后重试。</p>
            <button class="button button-primary" type="button" data-feedback-close>知道了</button>
          </dialog>
        </div>
        <Script src="/src/client.ts" type="module" />
      </body>
    </html>
  )
})
