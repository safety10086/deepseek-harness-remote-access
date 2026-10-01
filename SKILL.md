---
name: deepseek-harness-remote-access
description: 为 DeepSeek Harness 实现或审计局域网访问授权与 SSH 远程工作区，覆盖宿主、浏览器、API、文件系统、沙箱、workspace 和 bundle 接线。适用于添加网络授权设置页、远端设备选择、SSH 设备注册表或远端 workspace 支持。
metadata:
  short-description: 添加局域网授权和 SSH 远程工作区
---

# DeepSeek Harness 局域网和远程工作区

本 Skill 用于在 DeepSeek Harness 仓库中实现两套功能：

- **局域网访问授权**：为非回环设备提供请求门、持久化地址白名单，以及设置页中的批准、拒绝、撤销和删除。
- **SSH 远程工作区**：提供宿主端 SSH 注册表和连接池、`ssh://<connectionId>/<absolute path>` 工作区标识、RPC 接口，以及可添加和选择远端设备的工作区选择器。

## 先收集证据

1. 检查 `package.json`，确认目标是 `"name": "@deepseek-ai/dsh-root"` 的 Harness 仓库。
2. 运行 `node scripts/audit-harness.mjs <repo-root>`，根据报告选择旧版多设备实现或当前 provider family 实现。
3. 修改包边界或 bundle 配置前，先阅读 [references/platform-integration.md](references/platform-integration.md)。
4. 实现局域网授权时阅读 [references/lan-access.md](references/lan-access.md)。
5. 实现 SSH 工作区时阅读 [references/ssh-workspaces.md](references/ssh-workspaces.md)。
6. 使用 [references/source-map.md](references/source-map.md) 定位每个接线层。该文件记录了 `dsh-v0.1.1-rc.2` 上的完整实现，以及如何迁移到新版 provider family。

## 不可违反的约束

- 修改前必须检查目标仓库版本。Harness 仍处于 developer preview，不同 tag 的包契约可能变化。
- 局域网请求门只决定可达性，不能扩大 `/api` 信任范围、沙箱权限或工具能力。已批准设备仍必须经过后续全部安全栅栏。
- 局域网白名单管理只允许从回环地址发起，必须携带插件专用请求头，并且拒绝跨源请求。局域网设备只能查看自身状态和重新申请授权。
- 白名单必须存放在源码目录之外，使用原子写入并限制增长，不能让未授权设备无限占用内存或磁盘。
- 远端路径只允许使用 `ssh://<connectionId>/<absolute path>` 表达。调用本机 `path.resolve`、`realpath`、`stat`、shell、PTY 或 sandbox 前必须先识别该语法。
- 绝不能把已保存的 SSH 密码返回浏览器。注册表只能暴露 `hasPassword`，密钥路径和密码存储必须保留在宿主端。
- 当前上游已有 `packages/ssh/*` provider family 时，优先复用 `ssh`、`fs-ssh`、`sandbox-ssh`、`subprocess-ssh`，不要重复实现旧版 `ssh2` 方案。
- 只挂载 `fs-ssh` 时不要宣称支持远端命令执行。旧版实现只让文件工具和 workspace 感知远端，`bash`、`pwsh` 和终端会明确回退到主机 cwd。

## 实现顺序

1. 建立宿主能力 seam 和稳定的数据契约。
2. 暴露最小 RPC 方法，并更新 client-safe 类型。
3. 让 workspace 标识、校验和 sandbox policy 理解远端目标。
4. 添加浏览器界面，并通过正确的 bundle row 挂载。
5. 将 package manifest、tsconfig、lockfile 和测试作为一次完整修改提交。
6. 再运行审计脚本，然后先执行相关包测试，再执行仓库级检查。

## 验证

优先使用目标仓库自带的命令。至少需要：

- 为每个改动的 host/client package 运行聚焦测试；
- 运行仓库的 typecheck 和 lint；
- 构建 Harness `lib` 产物；
- 使用真实端口验证局域网等待页、批准、撤销和管理接口；
- 使用真实 SSH 设备验证探测、远端目录、创建、读取、编辑和跨 root 拒绝。

如果目标仓库没有远端 shell provider，必须在结论中明确说明边界，不能把远端文件系统描述成完整远端执行环境。
