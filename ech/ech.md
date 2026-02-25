# WebSocket Proxy Server (ECH)

这是一个基于 Cloudflare Workers 构建的轻量级 WebSocket 代理服务端。核心特性在于拥有**完全内建的全栈数据控制面板**并支持十分灵活的 **Token 动态鉴权配置**，常被用于构建防探测的安全代理节点（如 VLESS, Trojan 等协议转发）。

## 核心级特性

1. **统一的动态鉴权网络系统**：完全剥离了死板的静态配置，系统由远程的 `token.json` 文件全权接管，并兼顾本地缓存提升代理响应速率。
2. **极简大方的主页控制台 (`/`)**：现代化的玻璃拟态运行计时器。实时获取云端记录展现服务器无缝在线时长。
3. **全栈可视管理界面 (`/admin`)**：集成基于 HTML + VanillaJS 的可视管理操作面板。支持在线修改运行时间、维护配置节点群。自动调用 GitHub API 提供安全的全局覆盖保存能力。

## 部署与环境变量配置

部署此 Worker 时，通过 Cloudflare Dashboard 平台为其配置以下 **环境变量（Variables）**：

- `ADMIN_PASSWORD`: **(选填，但强烈推荐)** 管理面板的后台通行鉴权密令！若不填写所有访问 `/admin` 的请求将被直接熔断（返回 403 HTTP 状态）。
- `GITHUB_TOKEN`: **(必填/选填)** 拥有写入权限的 GitHub 个人访问凭证（PAT）。如果你想在管理面板内使用**一键推送到 Github**的功能，则必须填入！
- `TOKEN_JSON_URL`: (选填) 指向远程多 Token 组合的配置文件所在的绝对直链。默认已指定为项目中附带示例：`https://github.com/hc990275/CloudFlare-worker/tree/main/ech/token.json`

## “无状态”配置表：token.json
你所有的核心配置均可通过 `/admin` 页面修改并实时写入下方所指的带有 Metadata 的 Json 数据中心内：
```json
{
  "global": {
    "SERVER_START_TIME": "2024-01-01T00:00:00Z"
  },
  "tokens": [
    {
      "token": "你的加密代理 Token",
      "expire": "2026-12-31T23:59:59Z"
    }
  ]
}
```

## 面向开发
此工程完全使用 JavaScript 及纯天然的 Cloudflare Worker Fetch 设计。涵盖前后端同构体系。请参考 `CHANGELOG.md` 追踪系统演变。
