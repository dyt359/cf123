这是自动升级

## 前后端分离说明

后端（`_worker.js`）已剥离前端渲染，**根路径 `/` 只返回 JSON**，不再输出 HTML 页面。

| 接口 | 方法 | 说明 |
|---|---|---|
| `/` | GET | 健康检查，返回 `{"status":"ok","message":"API Server running"}` |
| `/<UUID>/sub` | GET | 订阅内容 |
| `/<UUID>/region` | GET | 当前节点地区 |
| `/<UUID>/test-api` | GET | 连通性测试 |
| `/<UUID>/api/config` | GET/POST | 配置读写 |

所有响应均带 `Access-Control-Allow-Origin: *`，并支持 `OPTIONS` 预检，可跨域调用。

### 前端

`docs/` 目录是独立的静态前端（纯 HTML/CSS/JS，无构建步骤），UI 遵循《UI 规范 v3.1》：

- `docs/index.html` —— 页面结构
- `docs/style.css` —— 设计令牌（颜色/间距/圆角/字号）
- `docs/app.js` —— fetch 交互逻辑

部署到 Cloudflare Pages 时，将 `docs/` 作为静态目录即可。页面内可自行填写后端 Worker 地址（默认 `https://cf123-1ju.pages.dev`），地址会存入 `localStorage`。

> **⚠️ 自动同步已停用**
> `.github/workflows/sync-from-cfnew.yml` 中的 cron 定时同步已注释掉，防止原作者 Releases 覆盖本仓库的前后端分离改动与缓存补丁。该工作流仍可手动触发；**若手动同步，请重新检查根路径是否退回了 HTML 页面、以及「傻瓜缓存」代码是否被覆盖**。

---

> **⚠️ 重要：部署后请将兼容日期设置为 `2026-01-20`**
>
> **Pages 部署：**
> 1. 登录 [Cloudflare 控制台](https://dash.cloudflare.com/)
> 2. 进入 **Workers 和 Pages** → 选择你的 Pages 项目
> 3. 点击 **设置** → **运行时**
> 4. 找到 **兼容性日期**，选择 `2026-01-20`，点击 **保存**
> 5. 返回 **部署** → 对最新一次部署点 **重试部署**，让新日期生效
>
> **Worker 部署：**
> 1. 登录 [Cloudflare 控制台](https://dash.cloudflare.com/)
> 2. 进入 **Workers 和 Pages** → 选择你的 Worker
> 3. 点击 **设置** → **运行时**
> 4. 找到 **兼容性日期**，选择 `2026-01-20`，点击 **保存**
>
> 这个设置只用改一次，之后每 6 小时的自动同步不会动它。
