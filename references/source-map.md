# 源码接线映射

本文件记录在 `dsh-v0.1.1-rc.2` 上验证过的实现。新版本可能已有相同文件，替换前必须先检查实际契约。

含义：

- **新增**：该 tag 中不存在，由本功能实现。
- **修改**：上游文件为接入远端行为而修改。
- **新版**：当前上游已有不同的 provider-family 实现，应优先复用。

## 局域网访问授权

| 路径 | 状态 | 职责 |
| --- | --- | --- |
| `packages/client/ui-settings-lan-access/package.json` | 新增 | 双面包元数据、client injection、`./client` export。 |
| `packages/client/ui-settings-lan-access/src/index.ts` | 新增 | 宿主插件、HTTP/upgrade gate、持久化存储、管理路由。 |
| `packages/client/ui-settings-lan-access/src/protocol.ts` | 新增 | 共享路由常量、状态、设备和 snapshot 类型。 |
| `packages/client/ui-settings-lan-access/src/store.ts` | 新增 | 原子写入 `$DSH_HOME/lan-access.json`、限制设备数量、状态转换。 |
| `packages/client/ui-settings-lan-access/src/page.ts` | 新增 | 等待/拒绝 HTML、转义值、重新申请表单。 |
| `packages/client/ui-settings-lan-access/src/client/index.ts` | 新增 | locale 和 `settings.section` 注册。 |
| `packages/client/ui-settings-lan-access/src/client/api.ts` | 新增 | 同源管理请求，携带 `x-dsh-lan-access`。 |
| `packages/client/ui-settings-lan-access/src/client/LanAccessSection.tsx` | 新增 | pending/approved/denied 分组和批准、拒绝、撤销、删除操作。 |
| `packages/client/ui-settings-lan-access/src/client/LanAccessSection.module.css` | 新增 | 使用 Harness theme token 的局部样式。 |
| `packages/client/ui-settings-lan-access/src/client/locales.ts` | 新增 | 中英文文案。 |
| `packages/client/ui-settings-lan-access/src/invariant.ts` | 新增 | 包级 invariant companion。 |
| `packages/client/ui-settings-lan-access/tests/lan-access.host.spec.ts` | 新增 | gate、路由、持久化、安全、重启和坏请求测试。 |
| `packages/host/webserver/src/index.ts` | 修改 | 在路由 dispatch 前增加 HTTP/upgrade gate 链。 |
| `packages/bundle/web-app/src/startup.ts` | 修改 | 增加 `--allow-lan`；只有显式 opt-in 才绑定全接口。 |
| `packages/bundle/web-app/cordis.patch.yml` | 修改 | 挂载 LAN access 插件。 |
| `packages/bundle/web-app/package.json` | 修改 | 增加插件依赖。 |
| `packages/client/connection/src/index.ts` | 修改 | 为 `/api` 信任栅栏推导运行时 LAN IPv4 authority。 |
| `packages/client/connection/src/rpc-host.ts` | 修改 | 每次请求读取 trusted authority，而不是冻结启动值。 |
| `packages/client/web/src/boot.ts` | 修改 | client bundle 加载前安装 insecure-context shim。 |
| `packages/client/web/src/secure-context-shim.ts` | 新增 | 为纯 HTTP LAN origin 补充缺失 API。 |
| `tsconfig.host.json`、`tsconfig.client.json` | 修改 | 增加插件 host/client 编译引用。 |
| `pnpm-lock.yaml` | 修改 | 解析新增 workspace package。 |
| `start-deepseek-harness.bat` | 本地部署文件 | 显式使用 `--allow-lan` 的本地启动器，不应无条件推广。 |

## SSH 宿主 Seam 与文件系统

| 路径 | 状态 | 职责 |
| --- | --- | --- |
| `packages/ssh/ssh/package.json` | 旧版新增；新版已有 | 包标识、`ctx.ssh` export、`ssh2` 依赖。 |
| `packages/ssh/ssh/src/types.ts` | 旧版新增 | registry/draft/probe/listing 类型和 `ssh://` URI helper。 |
| `packages/ssh/ssh/src/store.ts` | 旧版新增 | 原子写入不含密码的 `$DSH_HOME/ssh-connections.json`。 |
| `packages/ssh/ssh/src/secrets.ts` | 旧版新增 | 独立保存密码，尽力限制为 owner-only。 |
| `packages/ssh/ssh/src/pool.ts` | 旧版新增 | 每设备一个 `ssh2` pooled session、握手/exec/SFTP 超时、不自动重放。 |
| `packages/ssh/ssh/src/index.ts` | 旧版新增 | `SshService`：registry、probe、exec、SFTP、home、listing、URI、disconnect。 |
| `packages/ssh/ssh/README.md` | 旧版新增 | seam 契约与密钥/URI 摘要。 |
| `packages/ssh/fs-ssh/package.json` | 旧版新增；新版已有 | 文件系统 provider 元数据。 |
| `packages/ssh/fs-ssh/src/index.ts` | 旧版新增 | 同时处理本机和 `ssh://` 目标的 `ctx.fs`，实现受控远端 mutation。 |
| `packages/ssh/fs-ssh/src/sftp.ts` | 旧版新增 | Promise wrapper、流 helper、数字状态码映射和 OpenSSH 原子覆盖 rename。 |
| `packages/ssh/fs-ssh/src/uri.ts` | 旧版新增 | 将 Windows drive-rooted `ssh:` spelling 折回 URI。 |
| `packages/ssh/fs-ssh/tests/sftp.spec.ts` | 新增 | SFTP 状态码映射测试。 |
| `packages/ssh/fs-ssh/tests/uri.spec.ts` | 新增 | URI 规范化和 Windows spelling 测试。 |
| `packages/bundle/base/cordis.patch.yml` | 修改/自定义 profile | 挂载 `dsh-ssh`；旧版中用 `dsh-fs-ssh` 替代普通 FS row。 |
| `packages/bundle/base/package.json` | 修改 | 增加两个 SSH 包依赖。 |

当前上游中应使用 `ssh-workspaces.md` 描述的 provider-family 组合替代旧版 seam。新版包已经包含 `subprocess-ssh` 和 `sandbox-ssh`，不要重复实现。

## SSH RPC 与客户端 Service

| 路径 | 状态 | 职责 |
| --- | --- | --- |
| `packages/host/apiproxy/src/api/ssh.ts` | 新增 | client 可见的设备/draft/probe 契约和 `SshApi`。 |
| `packages/host/apiproxy/src/api/ssh.schema.ts` | 新增 | list/upsert/remove/probe request/response schema。 |
| `packages/host/apiproxy/src/api/index.ts` | 修改 | 将 `ssh` 加入 `ApiProxy` 并导出 wire 类型。 |
| `packages/host/apiproxy/src/api/rpc-map.ts` | 修改 | 注册 `ssh.list`、`ssh.upsert`、`ssh.remove`、`ssh.probe`。 |
| `packages/host/apiproxy/src/api-proxy.ts` | 修改 | 将 RPC 映射到 `ctx.ssh`；校验远端 workspace create 和 agent cwd。 |
| `packages/host/apiproxy/src/index.ts` | 修改 | 暴露 `ApiProxyService.ssh`。 |
| `packages/host/apiproxy/package.json` | 修改 | 增加 type-only SSH capability 依赖。 |
| `packages/client/connection/src/client/api.ts` | 修改 | 重新导出 SSH client 契约类型。 |
| `packages/client/connection/src/client/index.ts` | 修改 | 从 connection client face 导出 SSH 类型。 |
| `packages/api/remotes/src/client/index.ts` | 修改 | 通过 client-safe assembly 导出 SSH 类型。 |
| `packages/client/runtime/src/client/contract/workspaces.ts` | 修改 | 增加 `sshDevices`、upsert、remove、probe 和 connectFailure 投影。 |
| `packages/client/runtime/src/client/workspaces/service.ts` | 修改 | 通过 `this.api.ssh` 实现 SSH 调用并发布连接失败。 |
| `packages/client/runtime/src/client/index.ts` | 修改 | 导出新增 workspace 类型。 |
| `packages/client/runtime/tests/workspaces-service.client.spec.ts` | 修改 | 覆盖 SSH service 调用和失败发布。 |
| `packages/test-support/client-runtime/src/workspaces.ts` | 修改 | 同步 test runtime 的 workspace double。 |

## Workspace、Picker 与执行世界

| 路径 | 状态 | 职责 |
| --- | --- | --- |
| `packages/workspace/workspace/src/paths.ts` | 修改 | `isRemotePath` 和仅按 URI 的 canonicalization。 |
| `packages/workspace/workspace/src/index.ts` | 修改 | 远端 workspace root 跳过宿主目录探测。 |
| `packages/workspace/workspace/src/entity.ts` | 修改 | 远端 cwd session 挂载时不调用宿主 `stat`。 |
| `packages/core/session/src/index.ts` | 修改 | 允许 scheme URI 作为绝对 session cwd。 |
| `packages/sandbox/sandbox-policy/src/index.ts` | 修改 | 保留 `ssh://` workspace root，供远端 provider 使用。 |
| `packages/host/directory-picker-browse/src/index.ts` | 修改 | 通过 `ctx.ssh` 列出/创建远端目录，并返回 URI path。 |
| `packages/client/ui-directory-picker-browse/src/client/DeviceMenu.tsx` | 新增 | 添加、列出、probe、删除设备和选择远端 root。 |
| `packages/client/ui-directory-picker-browse/src/client/DeviceMenu.module.css` | 新增 | 设备切换器和内联表单样式。 |
| `packages/client/ui-directory-picker-browse/src/client/DirectoryBrowser.tsx` | 修改 | 渲染设备切换器并采用远端 root。 |
| `packages/client/ui-directory-picker-browse/src/client/flow.ts` | 修改 | 将可选 SSH device port 传入 dialog。 |
| `packages/client/ui-directory-picker-browse/src/client/index.ts` | 修改 | 将切换器绑定到 `ctx.workspaces` 并添加本地化文案。 |
| `packages/fs/tool-str-replace-editor/src/index.ts` | 修改 | 相对 session cwd 解析工具路径，并接受远端 URI。 |
| `packages/shell/bash-local/src/index.ts` | 修改 | 宿主 process spawn 前移除远端 cwd。 |
| `packages/shell/pwsh-local/src/index.ts` | 修改 | 宿主 process spawn 前移除远端 cwd。 |
| `packages/terminal/terminal-bash/src/index.ts` | 修改 | 宿主 PTY spawn 前移除远端 cwd。 |
| `packages/client/ui-conversation/src/client/contract/slots.ts` | 修改 | conversation contract 增加 connectFailure hook。 |
| `packages/client/ui-conversation/src/client/apply.ts` | 修改 | 注入 workspace connectFailure store。 |
| `packages/client/ui-conversation/src/client/skeleton/ConversationRoot.tsx` | 修改 | 显示可关闭的失败 toast。 |
| `packages/client/ui-conversation/src/client/locales.ts` | 修改 | 增加连接失败文案。 |

上述 shell/terminal 修改是**回退保护**，不是远端执行。当前上游使用 `subprocess-ssh` 替代本地 process provider 时，才能真正执行远端命令。

## 测试与类型接线

完整差异还包含相关测试和聚合 tsconfig。测试必须跟随所属 package，并尽可能通过项目布局生成聚合引用。关键负向测试包括：

- 远端目录不能用宿主 `stat` 校验；
- 远端 URI 不能变成本机 cwd；
- `workspace-write` 不能跨 connection id 或远端 root；
- LAN 管理接口不能从局域网地址调用；
- 未批准 WebSocket upgrade 不能建立；
- 保存的 SSH 密码不能出现在 RPC response。
