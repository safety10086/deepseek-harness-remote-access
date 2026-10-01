# SSH 远程工作区

## 选择正确架构

当前存在两套明显不同的实现。

### 旧版多设备注册表

这是 `dsh-v0.1.1-rc.2` 上记录到的实现。`packages/ssh/ssh` 负责 JSON 注册表、`ssh2` 连接池、密码/密钥/agent 认证、探测、命令执行原语和 SFTP；`packages/ssh/fs-ssh` 为本地路径和 `ssh://` 目标实现 `ctx.fs`；浏览器在工作区目录选择器中加入设备切换器。

该模式适合用户需要从 Web UI 注册多个临时 SSH 主机的场景。关键限制是：`bash`、`pwsh` 和终端仍运行在 Harness 主机。远端 workspace 对文件系统工具是完整的，但**不是**完整远端执行环境。

### 当前 POSIX provider family

当前上游提供：

- `packages/ssh/ssh`：部署级单 OpenSSH 别名、经过校验的远端 helper、私有管理 RPC 和认证流。
- `packages/ssh/fs-ssh`：远端文件系统 provider。
- `packages/ssh/subprocess-ssh`：远端进程和终端。
- `packages/ssh/sandbox-ssh`：远端沙箱 argv/effect policy。

Harness、模型传输和 session 存储保留在本机，文件和进程在远端主机执行。上游 README 明确说明 Web workspace 视图仍假设宿主文件系统访问，需要单独集成。

仓库已经存在这一 provider family 时，不要复制旧版 `ssh2` service。应在自定义 profile 中组合 provider，并单独设计缺失的多设备层。

## 远端 Workspace 标识

所有层统一使用：

```text
ssh://<connectionId>/<absolute POSIX remote path>
```

示例：

```text
ssh://d1c9ab7f/home/alice/project
ssh://d1c9ab7f/etc
```

规则：

- connection id 是不透明标识，不能按主机名或用户名解析。
- path 部分始终是在远端设备上的 POSIX 绝对路径。
- `posix.normalize` 处理 `.` 和 `..`；知道 session cwd 后用 `posix.resolve` 处理相对路径。
- 不要对完整 URI 调用宿主 `path.resolve`。Windows 可能把它变成 `E:\ssh:\id\path`。
- 远端目标不能调用宿主 `realpath`、`stat`、`mkdir`，必须通过 SFTP 或远端 provider 校验。
- session cwd、workspace path、sandbox root 都保留 URI。消费者按 URI 区分执行世界，不使用额外的 `remote` boolean。
- 如果调用方可能产生 `/ssh://...`，先折叠回规范 URI 再 dispatch。

## SFTP 兼容约束

真实 SSH 服务器上必须注意：

- `ssh2` 使用数字 SFTP status code。至少映射 `2 -> ENOENT`、`3 -> EACCES`、`8 -> ENOTSUP`。只识别字符串 `ENOENT` 时，首次创建文件会被错误当成传输失败。
- 标准 SFTP rename 不保证覆盖。优先使用 OpenSSH 的 `posix-rename@openssh.com`（`ext_openssh_rename`）原子替换目标，普通 `rename` 只作为兼容 fallback。
- `ctx.sandboxPolicy` 必须保留 `ssh://` workspace root。远端文件系统围栏需要 execution-world URI；本机 shell 和 PTY provider 必须各自清理不可用的远端 cwd。
- live SSH 验收必须覆盖 create、overwrite/edit、跨 root denial 和 cleanup。只测 URI mock 无法发现上述问题。

## 旧版宿主 Service

### 注册表与密钥

`SshService` 注册为 `ctx.ssh`，至少提供：

```ts
list(): Promise<SshConnectionInfo[]>
get(id): Promise<SshConnection | undefined>
upsert(draft): Promise<SshConnection>
remove(id): Promise<boolean>
probe(id): Promise<SshProbeResult>
exec(id, command, options): Promise<SshExecResult>
withSftp(id, fn, options): Promise<T>
home(id): Promise<string>
listDirectory(id, path?): Promise<SshDirListing>
uri(id, path): string
disconnect(id): void
```

持久注册表位于 `$DSH_HOME/ssh-connections.json`，不能包含密码。认证方式：

- `agent`：使用正在运行的 SSH agent（`SSH_AUTH_SOCK`，Windows 可回退到 `pageant`）。
- `key`：只保存私钥文件路径，拨号时才读取文件。
- `password`：密码单独存放在 owner-only 的 `$DSH_HOME/ssh-secrets.json`。

wire view 只能暴露 `hasPassword: boolean`，绝不能返回 `password`。编辑时，空或缺失密码表示保留原密码。

注册表使用原子写入。每个设备维持一个 pooled session，错误、关闭或 disconnect 时失效；传输中断后不能重放不确定操作。设置 handshake、exec、SFTP channel 的超时上限。

### 文件系统 provider

`SshFileSystem` 应继承仓库已有的 sandboxed local filesystem provider，并替代普通 FS bundle row。非 `ssh://` 目标完全委托本地 provider；远端目标通过 SFTP 实现相同的 `FsTarget`、`stat`、read、list、edit 和 write 契约。

远端语义：

- identity 使用远端 `realpath`，不是原始 URI 字符串；
- 读取沿用文本/二进制和大小限制；
- 写入使用同目录临时文件，再通过一次远端 rename 发布；
- create-if-absent 使用 exclusive-create；
- edit 保留检测到的 CRLF；
- `workspace-write` 只在 session workspace 指向同一 connection 且包含 canonical target 时允许；
- 本地/远端 containment 始终为 `false`，不能让本地 root 授权远端写入。

不要只注册一个与文件工具无关的 SFTP service。现有工具和 sandbox 检查必须继续通过 `ctx.fs`。

### RPC domain

宿主 API 至少提供：

```ts
interface SshApi {
  list(request): Promise<RpcResponse<{ connections: SshConnectionView[] }>>
  upsert(request): Promise<RpcResponse<{ connection: SshConnectionView }>>
  remove(request): Promise<RpcResponse<{ removed: boolean }>>
  probe(request, signal): Promise<RpcResponse<SshProbeResultView>>
}
```

通过仓库现有 API proxy 和 RPC map 接入。每个 request/response 都要有 schema。`ctx.ssh` 未挂载时返回明确的 unavailable error，不能让 API proxy 崩溃。将 client-safe SSH 类型通过 connection/remotes assembly 导出，再给客户端 `workspaces` service 增加：

```ts
sshDevices(signal?)
sshUpsertDevice(draft)
sshRemoveDevice(id)
sshProbeDevice(id, signal?)
```

`probe` 的传输失败应是结果 `{ ok: false, error }`，registry 失败仍是 RPC error。

### Workspace 与 Session 集成

远端目标必须绕过所有本地快捷判断：

- `packages/workspace/workspace/src/paths.ts`：增加不依赖 `fs.realpath` 的 `ssh://` canonicalizer。
- `packages/workspace/workspace/src/index.ts`：远端 root 跳过本地 `stat`。
- `packages/workspace/workspace/src/entity.ts`：远端 cwd session 挂载时跳过本地 `stat`。
- `packages/host/apiproxy/src/api-proxy.ts`：`workspace.create` 通过 `ctx.ssh.listDirectory` 校验，不能在宿主上 `mkdir` 远端 URI。
- `packages/core/session/src/index.ts`：允许 scheme URI 作为绝对 session cwd。
- `packages/sandbox/sandbox-policy/src/index.ts`：保留远端 workspace root，不要按本机路径解析。
- `packages/fs/tool-str-replace-editor/src/index.ts`：相对路径以 session cwd 为基准，并接受远端 URI。

### 目录选择器宿主半端

`packages/host/directory-picker-browse/src/index.ts` 需要远端分支：

- 在本地路径校验前解析 `ssh://`；
- 通过 `ctx.ssh.listDirectory` 只列出目录；
- 子项路径返回完整远端 URI；
- breadcrumb 使用 POSIX 语义并以设备 home 为根；
- 通过 SFTP 创建目录并返回 URI；
- SSH 未挂载时保持本地浏览可用，或返回准确错误。

### 浏览器设备选择器

工作区选择器只消费注入的 workspace service。`DeviceMenu` 应：

- 列出本机和全部已注册 SSH 设备；
- 使用名称、host、port、username 和 `agent | key | password` 认证添加设备；
- 不回显已保存密码；
- 显示探测后的 platform/uname/home 或失败原因；
- 删除前确认；
- 返回本地 `''` 或远端 `ssh://<connectionId><home>`；
- 优先采用探测到的远端 home，否则使用远端 `/`。

设备切换和目录列表必须走同一个 `ctx.workspaces` service，不能另建 UI 专用 RPC。

### 错误可见性

远端 workspace 连接可能在用户选择后失败。workspace runtime 应暴露只读 `connectFailure` 投影，并在 conversation root 显示 toast 或错误提示。不能把 Promise 丢弃或只写 console，否则用户会看到“点击无反应”。

## 适配当前 provider-family SSH

当前 provider 已解决远端文件、subprocess、terminal 和 sandbox execution。单主机场景：

1. 新增自定义 profile，挂载 `ssh`、`fs-ssh`、`subprocess-ssh`、`sandbox-ssh`。
2. 使用部署级 OpenSSH alias、helper path/hash、远端 Node 和默认 workspace 配置。
3. 验证 session cwd 和工具路径都经过已挂载 provider。
4. 只补 Web 侧配置/状态 UI，不复制 SSH 传输层。
5. provider 实例尚未建立连接 id 映射前，不要先做多设备注册表。

多设备支持需要先设计：

- 每设备独立 Cordis scope/instance；或
- 扩展 connection seam，让一个 service 解析多个 alias，同时保留每设备生命周期。

只有 provider 层提供稳定 device id 和 workspace URI 时，UI 才能复用旧版交互。否则必须明确说明缺口，不能只在浏览器里伪造注册表。

## Shell 与终端边界

旧版行为必须明确：

- `bash-local`、`pwsh-local`、`terminal-bash` 会忽略 `ssh://` cwd，并回退到宿主可用 cwd。
- 因此旧版远端 workspace 只支持远端文件读写和 remote-aware sandbox，命令仍在 Harness 主机执行。
- 需要远端命令执行时，使用当前 `subprocess-ssh` provider，或为旧版补 remote shell/subprocess provider。
- 不能让本机命令实际执行，却向模型宣称它运行在远端。

## 验证

至少测试：

- agent、key、password 三种认证，密码不能返回；
- registry 持久化和删除；
- SSH URI 解析和 POSIX canonicalization；
- 远端 listing、建目录、read、edit、atomic write；
- workspace root 内允许写入，跨设备/跨 root 拒绝；
- session cwd 持久化和重启；
- picker 添加、probe、删除和连接失败可见性；
- 本机 workspace 行为不回归；
- 如果声明支持远端执行，必须证明 command、terminal、process 实际运行在设备上。
