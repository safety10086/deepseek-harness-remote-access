# 局域网访问授权

## 目标行为

`--allow-lan` 是操作者明确选择开启局域网访问的开关。它会将 webserver 绑定到 `0.0.0.0`，启用逐设备授权门，并输出实际局域网 URL。单独使用 `--host 0.0.0.0` 必须报用法错误，因为该 API 具备代码执行能力。

门启用后的行为：

- 回环请求直接通过。
- 未记录的远端地址进入 `pending`，看到独立等待授权页，而不是应用。
- `denied` 地址看到拒绝页，可以重新提交申请。
- `approved` 地址正常通过。
- 未批准地址的 WebSocket upgrade 会在任何事件流开始前被拒绝。
- 批准前只允许访问 `/lan-access/status` 和 `/lan-access/request`。

该门只授予**可达性**，不授予权限。已批准请求仍需通过 `/api` 浏览器信任栅栏、沙箱、审批和其他全部宿主策略。

## 宿主插件

建议使用双面包，例如 `packages/client/ui-settings-lan-access`。

最少需要：

```text
src/
|-- index.ts                 # 宿主门、路由和持久化存储接线
|-- protocol.ts              # 共享路由、请求头和 wire 类型
|-- store.ts                 # 原子白名单持久化
|-- page.ts                  # 转义后的等待/拒绝 HTML
|-- client/
    |-- index.ts             # slot 和 locale 注册
    |-- api.ts               # 管理 API fetch 客户端
    |-- LanAccessSection.tsx # 设置界面
    `-- locales.ts
```

宿主半端声明 webserver 依赖：

```ts
export const name = 'lan-access'
export const inject = ['webServer']
```

通过 effect 安装请求门和前缀路由：

```ts
ctx.effect(() => ctx.webServer.registerRequestGate({
  gateRequest: (request, response) => gateRequest(request, response, store, state),
  gateUpgrade: (request, socket) => gateUpgrade(request, socket, store, state),
}), 'lan-access: request gate')

ctx.effect(() => ctx.webServer.register({
  kind: 'prefix',
  path: '/lan-access',
  handler: (request, response) => serveRoute(request, response, store, state),
}), 'lan-access: routes')
```

如果目标 webserver 没有请求门能力，先增加通用 `WebRequestGate` seam：

```ts
interface WebRequestGate {
  gateRequest?: (req, res) => boolean | Promise<boolean>
  gateUpgrade?: (req, socket, head) => boolean | Promise<boolean>
}
```

Gate 在命名路由和静态 fallback 之前运行。只有当 gate 已写响应或关闭 socket 时，才返回 `true`。

## Wire 契约

双端共享以下常量与类型：

```ts
export const LAN_ACCESS_PREFIX = '/lan-access'
export const LAN_ACCESS_HEADER = 'x-dsh-lan-access'
export const LAN_ACCESS_STATUS_PATH = `${LAN_ACCESS_PREFIX}/status`
export const LAN_ACCESS_REQUEST_PATH = `${LAN_ACCESS_PREFIX}/request`
export const LAN_ACCESS_DEVICES_PATH = `${LAN_ACCESS_PREFIX}/devices`
export const LAN_ACCESS_MUTATIONS = ['approve', 'revoke', 'deny', 'forget']
```

设备状态只有 `pending | approved | denied`。管理快照返回 bind host、port、gateActive、LAN URL 和设备列表；设备自身状态接口只返回调用方地址、自身状态和刷新间隔。

## 安全规则

只有同时满足以下条件才接受管理操作：

1. `request.socket.remoteAddress` 在 IPv4-mapped IPv6 归一化后属于回环地址。
2. 请求带 `x-dsh-lan-access` 请求头。
3. 如果存在 `Origin`，其 host 必须等于请求的 `Host`。

自定义请求头可以阻止跨站 HTML form 授权设备；回环限制可以阻止已批准局域网浏览器管理白名单。测试至少覆盖：

- 局域网地址携带伪造请求头：`403`
- 回环地址缺少请求头：`403`
- 回环地址带外部 Origin：`403`
- 前缀下错误路径：`404`
- 合法回环管理读取：`200`

等待页只显示调用方地址、服务端口、本机管理 URL 和拒绝对应的重新申请按钮。所有插值都必须 HTML escape。

## 持久化存储

白名单存放在 `dshHomePath('lan-access.json')`，不能放进源码目录或 session log。

有 atomic-write / file-lock seam 时优先使用。mutation 必须先落盘再返回。建议结构：

```json
{
  "version": 1,
  "devices": [
    {
      "address": "192.168.1.23",
      "label": "192.168.1.23",
      "status": "approved",
      "firstSeenAt": 0,
      "lastSeenAt": 0,
      "requests": 1,
      "approvedAt": 0
    }
  ]
}
```

必须满足：

- pending 记录首次/最近访问时间和请求次数；
- approval 重启后仍有效；
- revoke 将设备退回 pending；
- deny 返回拒绝页；
- forget 完全删除记录；
- 坏数据行被跳过，不能让宿主崩溃；
- 限制攻击者可扩张的 pending 数量，裁剪时保留人工批准记录；
- 平台支持时使用 owner-only 文件权限。

## 设置界面

浏览器半端注册字典和 Settings slot：

```ts
export const inject = ['slots', 'locale']

ctx.slots.inject('settings.section', () => ctx.slots.register({
  name: 'settings.section',
  id: 'lan-access',
  order: 40,
  locale: 'settings.lanAccess',
  label: () => t('nav'),
  inject: () => ({ ...client }),
}, LanAccessSection))
```

界面按 `pending`、`approved`、`denied` 分组。每个 mutation 使用：

```ts
fetch(path, {
  method: 'POST',
  headers: { 'x-dsh-lan-access': '1' },
  credentials: 'same-origin',
})
```

UI 必须以宿主返回结果重新渲染。明确显示当前 bind 状态，并在仅回环模式下解释局域网设备为何无法连接。中英文文案都要维护。

## Web 组合接线

完整 Web 集成不只包含插件包：

- `packages/bundle/web-app/package.json`：添加插件依赖。
- `packages/bundle/web-app/cordis.patch.yml`：挂载插件。
- `packages/bundle/web-app/src/startup.ts`：解析 `--allow-lan`；强制 `0.0.0.0`；拒绝单独使用 `--host 0.0.0.0`。
- 用户指南和 CLI help：说明审批流程与安全边界。
- 根 tsconfig：引用 host/client 两个编译面。
- 启动脚本：必须显式 opt-in，不能默认暴露局域网。

`/api` 信任栅栏必须接受机器当前局域网 IPv4 literal。如果网卡地址会变化，不能只在启动时冻结；应使用短 TTL 缓存重新读取，否则服务会宣传一个自己的 API 栅栏拒绝的地址。

纯 HTTP 不是 secure browser context。任何 client bundle 加载前，需要补上现有前端依赖的最小 shim，例如缺少 `crypto.randomUUID` 时补全。不能因此放宽 TLS 或 Origin 检查。

## 验收清单

- 回环端无需批准即可使用。
- 首次局域网访问只能看到等待页，不能直接进入应用。
- approve 后设备可访问；revoke 后重新回到等待页。
- deny 后显示拒绝页，重新申请正常。
- approval 跨服务重启保留。
- 缺少 `--allow-lan` 时 `--host 0.0.0.0` 在绑定前失败。
- 局域网直接调用管理接口即使猜中请求头也失败。
- `/api`、插件 bundle、SSE 和 WebSocket upgrade 都经过 gate。
