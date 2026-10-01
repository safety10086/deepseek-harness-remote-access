# 平台集成说明

## 心智模型

DeepSeek Harness（`dsh`）是一个 Cordis 插件树。一个能力通常拆成多个小包，而不是做成单一插件：

- **宿主端**负责持久化状态、密钥、网络套接字、文件系统、进程和 RPC 实现。
- **客户端半端**可以通过 `./client` 导出。package manifest 声明 `dsh.client` 后，客户端模块加载器会扫描启用的 Loader 行并向浏览器提供该 bundle。
- 插件通过 Cordis service 和类型化 RPC 通信，不能直接导入另一个功能包的实现。
- Bundle patch 文件（`cordis.patch.yml`）决定某个 profile 实际挂载哪些插件。包能编译不代表已经启用，必须存在 profile row。

这些功能涉及的层次：

1. **能力 seam**：`ctx.ssh` 或 webserver request-gate service。
2. **消费者**：`ctx.fs`、workspace registry、directory picker、shell/subprocess、terminal。
3. **传输层**：API proxy 方法和导出的 client-safe 类型。
4. **业务客户端运行时**：`ctx.workspaces` 或专用浏览器 service。
5. **UI**：设置页或 workspace picker。
6. **组合层**：package manifest、tsconfig reference、bundle patch row、pnpm lockfile。

## 判断目标版本

运行：

```sh
node scripts/audit-harness.mjs /path/to/deepseek-harness
```

报告会区分：

- **旧版多设备 SSH**：`packages/ssh/ssh` 内包含持久化连接注册表和 `ssh2` 传输；`packages/ssh/fs-ssh` 通过 SFTP 提供文件访问；Web picker 内含设备 UI。该形态对应 `dsh-v0.1.1-rc.2` 加本次记录的扩展。
- **当前 provider family SSH**：`packages/ssh` 内包含 `ssh`、`fs-ssh`、`sandbox-ssh`、`subprocess-ssh`。上游 provider family 负责文件、进程、终端和沙箱执行；其文档仍明确说明 Web workspace 视图需要单独集成。

不要直接混用两套实现：

- 新版 `@deepseek-ai/dsh-ssh` 是部署级单 OpenSSH 别名，不是旧版多设备 JSON 注册表。
- 如果在现代 provider family 上做多设备选择，必须先设计一个 device 到 provider 实例的映射，不能把单连接 service 当成注册表。
- 如果用户只需要一个已配置的远端主机，优先使用当前 provider family 加自定义 profile，再补一个简单的单主机选择流程，不要在浏览器端伪造注册表。

## 包与构建接线

每个新包都需要完整接线：

1. 编写 `package.json`，正确声明 `exports`、`files`、依赖、peerDependencies，以及浏览器半端所需的 `dsh.client`。
2. 添加 `tsconfig.json`；只有 host/client 分离编译的包才需要 `tsconfig.host.json` 和 `tsconfig.client.json`。
3. 将包加入所属 bundle 的 `dependencies`。
4. 在 bundle 的 `cordis.patch.yml` 中增加 row。row id 必须稳定，后续 patch 通过 id 定位。
5. 如果该包参与聚合构建，将 project reference 加入根 `tsconfig.host.json` 或 `tsconfig.client.json`。
6. 通过包管理器更新 `pnpm-lock.yaml`，不要手改。
7. 测试放在对应半端的包目录中。仓库使用 `*.host.spec.ts` 表示 client 包的宿主半端，使用 `*.client.spec.ts[x]` 表示浏览器代码。

常见组合示例：

```yaml
- id: ui-settings-lan-access
  name: '@deepseek-ai/dsh-client-ui-settings-lan-access'
```

```yaml
- id: ssh
  name: '@deepseek-ai/dsh-ssh'

# 旧版实现中，这会替代普通本地沙箱 FS。
- id: fs-sandbox
  name: '@deepseek-ai/dsh-fs-ssh'
```

当前 provider family 应放在自定义 profile 中，而不是对所有部署静默启用。其配置属于部署信息，包括 OpenSSH 身份、helper digest、远端 Node 路径、workspace 和生命周期限制。

## 宿主插件规则

- 使用 `inject` 声明所需 service，不要读取未声明的全局状态。
- 通过 `ctx.effect(...)` 注册清理逻辑，确保 fiber 销毁时注销路由、watcher、gate 和连接池。
- 持久状态使用 `dshHomePath(...)`，不要写入源码目录。
- 用户可编辑状态要使用原子写入和文件锁，不能让截断 JSON 被当成“空注册表”。
- 通用注册表不要保存 secret。密码材料单独存储，文件权限只是尽力加固，不等同于加密。
- 传输失败必须变成明确错误或 `{ ok: false }`，SSH 断开后不能自动重放不确定的 mutation。

## API 与客户端规则

- 在宿主端统一定义 wire contract，只暴露浏览器真正需要的字段。
- 方法名必须稳定，并通过 RPC map 接入。仓库使用 schema-backed dispatch 时，每个 request/response 都需要 schema。
- 只通过既有的 connection/API assembly 导出 client-safe 类型，不能把 host 实现模块打进浏览器 bundle。
- 功能包之间的跨插件契约使用 type-only import；value import 可能被 client bundle purity gate 拒绝。
- 同源 fetch 使用最小必要请求头，并设置 `credentials: 'same-origin'`。

## Workspace 与路径规则

旧版远端 workspace 标识统一使用：

```text
ssh://<connectionId>/<absolute POSIX remote path>
```

该 URI 对宿主文件系统是不透明值。所有本地路径原语都必须先判断：

- 远端 workspace 只按 URI 语法规范化，不能调用 `realpath`。
- 远端目录必须通过设备的 SFTP listing 验证，不能调用宿主 `stat`。
- session cwd 必须保留 URI，让文件工具和 sandbox policy 共用同一执行坐标。
- 不能把远端 URI 传给本机进程 `cwd`。本机 shell 必须明确回退，或者路由到远端 subprocess provider。
- `workspace-write` 只能在同一 connection、且远端 root canonicalize 后包含目标时允许写入。

## 浏览器 UI 规则

- 通过 slot 注册 UI，不要直接 patch 其他插件组件。
- 所有标签和错误都必须本地化，中英文 key 保持一致。
- mutation 完成后以宿主返回结果重新渲染，不要乐观地提前显示成功。
- workspace 连接失败必须显示可见错误，不能丢弃 Promise。
- 密码字段永远只写不读；编辑表单最多显示“已保存密码”，不能回显密码。

## 验证命令

使用目标仓库当前已有的脚本。常见命令：

```sh
pnpm install
pnpm run build:lib
pnpm run typecheck
pnpm run lint
pnpm vitest run packages/client/ui-settings-lan-access/tests/lan-access.host.spec.ts
pnpm vitest run packages/host/apiproxy/tests/api-proxy-workspace.spec.ts
```

对于新版 provider-family SSH，除单元测试外，还必须使用一次性 POSIX 主机执行 live SSH 验收。Mock 成功不能替代真实 SSH 测试。
