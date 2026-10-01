#!/usr/bin/env node
import { existsSync, readFileSync, statSync } from 'node:fs'
import { resolve, join } from 'node:path'
import process from 'node:process'

const args = process.argv.slice(2)
const json = args.includes('--json')
const strict = args.includes('--strict')
const requireRemoteShell = args.includes('--require-remote-shell')
const rootArg = args.find((arg) => !arg.startsWith('--')) ?? process.cwd()
const root = resolve(rootArg)

function exists(relative) {
  return existsSync(join(root, relative))
}

function read(relative) {
  try {
    return readFileSync(join(root, relative), 'utf8')
  } catch {
    return ''
  }
}

function has(relative, needle) {
  const value = read(relative)
  if (needle instanceof RegExp) return needle.test(value)
  if (typeof needle === 'function') return needle(value)
  return value.includes(needle)
}

function packageJson(relative) {
  try {
    return JSON.parse(read(relative))
  } catch {
    return undefined
  }
}

function check(label, ok, detail) {
  return { label, ok: Boolean(ok), ...(detail === undefined ? {} : { detail }) }
}

if (!exists('package.json')) {
  console.error(`不是 DeepSeek Harness 仓库：以下路径没有 package.json ${root}`)
  process.exit(2)
}

const pkg = packageJson('package.json')
if (pkg?.name !== '@deepseek-ai/dsh-root') {
  console.error(`package name 不符合预期: ${String(pkg?.name)}`)
  process.exit(2)
}

const lan = {
  package: exists('packages/client/ui-settings-lan-access/package.json'),
  hostHalf: has('packages/client/ui-settings-lan-access/src/index.ts', 'registerRequestGate'),
  durableStore: has('packages/client/ui-settings-lan-access/src/index.ts', 'lan-access.json') || has('packages/client/ui-settings-lan-access/src/store.ts', 'lan-access.json'),
  waitingPage: has('packages/client/ui-settings-lan-access/src/page.ts', 'renderLanAccessPage'),
  settingsSection: has('packages/client/ui-settings-lan-access/src/client/index.ts', "'settings.section'"),
  gateSeam: has('packages/host/webserver/src/index.ts', 'registerRequestGate'),
  allowLanFlag: has('packages/bundle/web-app/src/startup.ts', '--allow-lan'),
  bundleDependency: Boolean(packageJson('packages/bundle/web-app/package.json')?.dependencies?.['@deepseek-ai/dsh-client-ui-settings-lan-access']),
  bundleRow: has('packages/bundle/web-app/cordis.patch.yml', 'ui-settings-lan-access'),
  dynamicApiTrust: has('packages/client/connection/src/index.ts', /lanIpv4Literals|trustedAuthorities/),
  secureContextShim: exists('packages/client/web/src/secure-context-shim.ts'),
  hostTest: exists('packages/client/ui-settings-lan-access/tests/lan-access.host.spec.ts'),
}
lan.checks = [
  check('双面包存在', lan.package),
  check('宿主请求门存在', lan.hostHalf),
  check('持久化白名单存在', lan.durableStore),
  check('等待/拒绝页面存在', lan.waitingPage),
  check('设置页 section 存在', lan.settingsSection),
  check('webserver gate seam 存在', lan.gateSeam),
  check('--allow-lan 参数解析存在', lan.allowLanFlag),
  check('Web bundle 依赖插件', lan.bundleDependency),
  check('Web bundle 已挂载插件', lan.bundleRow),
  check('API 信任栅栏会推导 LAN authority', lan.dynamicApiTrust),
  check('非 secure context 浏览器 shim 存在', lan.secureContextShim),
  check('宿主安全/持久化测试存在', lan.hostTest),
]
lan.complete = lan.checks.every((entry) => entry.ok)

const ssh = {
  legacyRegistry: has('packages/ssh/ssh/src/types.ts', 'SshConnectionDraft'),
  legacySeam: has('packages/ssh/ssh/src/index.ts', 'class SshService'),
  filesystemProvider: exists('packages/ssh/fs-ssh/src/index.ts'),
  sandboxProvider: exists('packages/ssh/sandbox-ssh/src/index.ts'),
  subprocessProvider: exists('packages/ssh/subprocess-ssh/src/index.ts'),
  apiContract: exists('packages/host/apiproxy/src/api/ssh.ts') || exists('packages/host/apiproxy/src/api/ssh/index.ts'),
  rpcMethods: has('packages/host/apiproxy/src/api/rpc-map.ts', 'ssh.list'),
  clientService: has('packages/client/runtime/src/client/workspaces/service.ts', 'sshDevices'),
  pickerDeviceMenu: exists('packages/client/ui-directory-picker-browse/src/client/DeviceMenu.tsx'),
  remoteBrowse: has('packages/host/directory-picker-browse/src/index.ts', 'ssh://'),
  workspaceUri: has('packages/workspace/workspace/src/paths.ts', 'ssh://'),
  sessionUri: has('packages/core/session/src/index.ts', /REMOTE_CWD|remote.*cwd|scheme URI/i),
  sandboxUri: has('packages/sandbox/sandbox-policy/src/index.ts', 'REMOTE_WORKSPACE_URI_RE'),
  hostCwdGuard: /hostUsableCwd|REMOTE_WORKSPACE_URI_RE/.test(
    read('packages/shell/bash-local/src/index.ts') + read('packages/shell/pwsh-local/src/index.ts') + read('packages/terminal/terminal-bash/src/index.ts'),
  ),
}
ssh.mode = ssh.sandboxProvider && ssh.subprocessProvider
  ? 'modern-provider-family'
  : ssh.legacyRegistry || ssh.legacySeam
    ? 'legacy-multi-device-registry'
    : 'absent'
ssh.remoteExecution = ssh.mode === 'modern-provider-family' || ssh.subprocessProvider
ssh.checks = [
  check('SSH 后端存在', ssh.legacySeam || ssh.mode === 'modern-provider-family'),
  check('远端文件系统 provider 存在', ssh.filesystemProvider),
  check('RPC 契约和方法存在', ssh.apiContract && ssh.rpcMethods),
  check('客户端 workspaces service 暴露 SSH 调用', ssh.clientService),
  check('工作区选择器设备切换器存在', ssh.pickerDeviceMenu),
  check('宿主目录选择器可解析远端目标', ssh.remoteBrowse),
  check('workspace URI 规范化存在', ssh.workspaceUri),
  check('session cwd 接受远端 scheme', ssh.sessionUri),
  check('sandbox policy 保留远端 root', ssh.sandboxUri),
  check('宿主进程 cwd 保护存在', ssh.hostCwdGuard),
  check('远端 shell/subprocess provider 存在', ssh.remoteExecution, ssh.remoteExecution ? undefined : '旧版仅远端文件系统模式'),
]
ssh.integrationComplete = ssh.checks.filter((entry) => entry.label !== '远端 shell/subprocess provider 存在').every((entry) => entry.ok)
ssh.complete = ssh.integrationComplete && ssh.remoteExecution

const actions = []
const warnings = []
if (!lan.complete) {
  actions.push('请按 references/lan-access.md 实现或完成局域网访问授权，包括 webserver gate、bundle row、--allow-lan、动态 API 信任和 secure-context shim。')
}
if (ssh.mode === 'absent') {
  actions.push('先选择 SSH 架构：上游已有新版 provider family 时直接复用；否则按 references/ssh-workspaces.md 迁移旧版 registry/filesystem 设计。')
} else if (!ssh.integrationComplete) {
  actions.push('补齐 SSH workspace 在 RPC、客户端 workspace service、picker、URI/workspace 校验、sandbox policy 和测试中的接线。')
}
if (ssh.mode !== 'absent' && !ssh.remoteExecution) {
  const boundary = '不要宣称支持完整远端执行：检测到旧版方案只远端化文件系统工作区操作。需要远端命令时请添加 subprocess/terminal provider。'
  if (requireRemoteShell) actions.push(boundary)
  else warnings.push(boundary)
}

const report = {
  root,
  harnessVersion: pkg.version ?? null,
  lan,
  ssh,
  actions,
  warnings,
}

if (json) {
  console.log(JSON.stringify(report, null, 2))
} else {
  console.log('DeepSeek Harness 局域网和远程工作区审计')
  console.log(`仓库根目录： ${root}`)
  console.log(`版本： ${report.harnessVersion ?? '未知'}`)
  console.log('')
  console.log('局域网访问授权')
  for (const entry of lan.checks) console.log(`  ${entry.ok ? '[x]' : '[ ]'} ${entry.label}${entry.detail ? ` (${entry.detail})` : ''}`)
  console.log('')
  console.log('SSH 远程工作区')
  console.log(`  模式： ${ssh.mode}`)
  for (const entry of ssh.checks) console.log(`  ${entry.ok ? '[x]' : '[ ]'} ${entry.label}${entry.detail ? ` (${entry.detail})` : ''}`)
  if (warnings.length > 0) {
    console.log('')
    console.log('边界与警告')
    for (const warning of warnings) console.log(`  - ${warning}`)
  }
  console.log('')
  if (actions.length === 0) {
    console.log('未发现缺失的能力接线。下一步运行包级测试和端到端测试。')
  } else {
    console.log('建议的下一步')
    for (const action of actions) console.log(`  - ${action}`)
  }
}

if ((strict && actions.length > 0) || (requireRemoteShell && !ssh.remoteExecution)) process.exit(1)





