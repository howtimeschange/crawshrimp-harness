/**
 * DSH rc.1 / dsh-im 4.11 clean-install guard.
 *
 * The former rc.8 runtime needed binary edits to a flat Cordis + SDK graph.
 * rc.1 boots the supported Web profile instead: agent tools live in the
 * per-session `standard` preset and dsh-im 4.11 talks to current controllers.
 * The former broad rc.8 binary rewrites would either fail on a clean install
 * or quietly discard upstream capabilities. The compact 4.11 overlay below
 * changes only verified product copy and bridge source, including the shipped
 * client module that serves that copy; every change is anchored and idempotent.
 */
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

export const RUNTIME_GUARD_MARKER = 'crawshrimp-dsh-im-411-product-patch-v1'
const DSH_IM_RUNTIME_ROOT = 'node_modules/@xmanrui/dsh-im'
const DSH_IM_USER_VISIBLE_SOURCE_ROOTS = ['src', 'plugin-src', 'lib']
const UPSTREAM_HARNESS_BRAND = 'DeepSeek Harness'
const CRAWSHRIMP_HARNESS_BRAND = '抓虾 Harness'
// Bundled i18n keys retain Chinese text as `\\uXXXX` escapes, whose final
// hex digit is a word character. Do not require a leading word boundary here:
// the negative product-prefix check plus trailing boundary still protects
// identifiers such as HarnessClient and an already branded label.
const GENERIC_HARNESS_LABEL = /(?<!抓虾 )Harness\b/gu
const DSH_SESSION_SYNC_LABELS = new Map([
  ['[来自 DSH]', '[来自抓虾 Harness]'],
  ['[DSH 助手]', '[抓虾 Harness]'],
])
export const CRAWSHRIMP_DSH_IM_NATURAL_CONTROLS_MARKER = 'crawshrimp-dsh-im-411-natural-controls-v1'
export const CRAWSHRIMP_DSH_IM_SESSION_PERMISSION_MARKER = 'crawshrimp-dsh-im-411-session-permission-v1'
export const CRAWSHRIMP_DSH_IM_NATIVE_CONTROLS_MARKER = 'crawshrimp-dsh-im-411-native-controls-v1'

const NATURAL_MODEL_CONTROLS_SOURCE = `// ${CRAWSHRIMP_DSH_IM_NATURAL_CONTROLS_MARKER}
import { runModelCommand } from './model-command.mjs';

function commandResult(message) {
  return { handled: true, message, messages: [message] };
}

function cleanText(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function compactModelName(value) {
  return cleanText(value).toLowerCase().replace(/[\\s_-]+/gu, '');
}

export function parseNaturalModelCommand(text) {
  const command = cleanText(text);
  if (!command || command.startsWith('/')) return null;
  if (/^(?:可以|能)?(?:查看|列出|显示|有什么|有哪些|全部)?(?:可用)?(?:大)?模型(?:吗|呢|列表)?[？?]?$/u.test(command)) {
    return { action: 'list' };
  }
  if (/^(?:当前|现在|目前).*(?:是什么|哪个|查看)?.*(?:大)?模型[？?]?$/u.test(command)) {
    return { action: 'current' };
  }
  const selection = /^(?:切换(?:模型)?(?:到|为)?|换成|改成|使用(?:模型)?(?:到|为)?)[\\s：:]*([^\\s]+)$/u.exec(command);
  if (!selection) return null;
  return { action: 'select', requested: selection[1] };
}

export function isNaturalModelCommand(text) {
  return parseNaturalModelCommand(text) !== null;
}

function boundSession(harness, state, key) {
  const sessionId = typeof state?.sessionFor === 'function' ? state.sessionFor(key) : null;
  if (typeof sessionId !== 'string' || !sessionId
    || typeof harness?.workspaceSession !== 'function') return null;
  return { sessionId, session: harness.workspaceSession(sessionId) };
}

async function modelSelectionFor(requested, harness, state, key, options) {
  const bound = boundSession(harness, state, key);
  if (!bound || typeof bound.session?.models !== 'function') return null;
  const catalog = await bound.session.models(options.signal ? { signal: options.signal } : undefined);
  const expected = compactModelName(requested);
  const candidates = [];
  for (const group of Array.isArray(catalog?.groups) ? catalog.groups : []) {
    for (const model of Array.isArray(group?.models) ? group.models : []) {
      if (compactModelName(model?.id) === expected || compactModelName(model?.name) === expected) {
        candidates.push({ provider: group.id, model: model.id });
      }
    }
  }
  if (candidates.length === 0) return null;
  return candidates.find(({ provider }) => provider === catalog?.current?.provider) ?? candidates[0];
}

export async function runNaturalModelCommand(text, harness, state, key, options = {}) {
  const command = parseNaturalModelCommand(text);
  if (!command) return null;
  if (command.action === 'list') return runModelCommand('/models', harness, state, key, options);
  if (command.action === 'current') return runModelCommand('/model', harness, state, key, options);
  const bound = boundSession(harness, state, key);
  if (!bound) {
    return commandResult('当前聊天还没有已绑定会话。请先发送一条普通消息创建会话，再切换模型。');
  }
  const selection = await modelSelectionFor(command.requested, harness, state, key, options);
  if (!selection) return runModelCommand('/model ' + command.requested, harness, state, key, options);
  return runModelCommand('/model ' + selection.provider + '/' + selection.model, harness, state, key, options);
}

export function parseNaturalPermissionCommand(text) {
  const command = cleanText(text);
  if (!command || command.startsWith('/')) return null;
  if (/^(?:修改|查看|查询|现在的)?(?:审批)?权限(?:是什么|如何|多少)?[？?]?$/u.test(command)) {
    return { action: 'query' };
  }
  if (/^(?:审批)?权限(?:改成|切换到|设为)[\\s]*工作区写入$/u.test(command)
    || /^(?:恢复|开启)(?:审批|权限)$/u.test(command)) {
    return { action: 'select', preset: 'workspace-write' };
  }
  if (/^(?:去掉|关闭|取消)(?:审批|权限)$/u.test(command)
    || /^(?:完全访问|完全开放|允许完全访问)$/u.test(command)) {
    return { action: 'request-full-access' };
  }
  if (/^(?:确认|确定)(?:切换到)?(?:完全访问|完全开放)$/u.test(command)) {
    return { action: 'confirm-full-access' };
  }
  return null;
}

export function isNaturalPermissionCommand(text) {
  return parseNaturalPermissionCommand(text) !== null;
}

function permissionOptions(options) {
  return options.signal ? { signal: options.signal } : undefined;
}

function permissionSession(harness, state, key) {
  const bound = boundSession(harness, state, key);
  if (!bound || typeof bound.session?.permission !== 'function'
    || typeof bound.session?.setPermission !== 'function') return null;
  return bound;
}

function permissionMessage(value, prefix) {
  const preset = cleanText(value?.preset) || 'unknown';
  const available = Array.isArray(value?.available)
    ? value.available.filter((item) => typeof item === 'string' && item).join(', ')
    : '';
  return [prefix + preset, ...(available ? ['可用权限：' + available] : [])].join('\\n');
}

const permissionManagers = new WeakMap();

function permissionManagerFor(options) {
  if (options.permissionManager instanceof PermissionCommandManager) {
    return options.permissionManager;
  }
  const owner = options?.control?.owner;
  if (!owner || !['object', 'function'].includes(typeof owner)) return null;
  let manager = permissionManagers.get(owner);
  if (!manager) {
    manager = new PermissionCommandManager();
    permissionManagers.set(owner, manager);
  }
  return manager;
}

export class PermissionCommandManager {
  #pendingFullAccess = new Map();
  #now;
  #ttlMs;

  constructor({ now = () => Date.now(), ttlMs = 5 * 60_000 } = {}) {
    if (typeof now !== 'function' || !Number.isFinite(ttlMs) || ttlMs <= 0) {
      throw new TypeError('PermissionCommandManager requires a clock and positive ttlMs');
    }
    this.#now = now;
    this.#ttlMs = ttlMs;
  }

  #pending(key) {
    const pending = this.#pendingFullAccess.get(key);
    if (pending && pending.expiresAt <= this.#now()) this.#pendingFullAccess.delete(key);
    return this.#pendingFullAccess.get(key) ?? null;
  }

  async #applyFullAccess(harness, state, key, actor, { allowAll = false } = {}) {
    const pending = this.#pending(key);
    if (!pending) return commandResult('没有有效的完全访问二次确认。请先明确发送“去掉审批”。');
    if (pending.actor !== actor) return commandResult('只有发起切换的用户可以确认完全访问。');
    const bound = permissionSession(harness, state, key);
    if (!bound || bound.sessionId !== pending.sessionId) {
      this.#pendingFullAccess.delete(key);
      return commandResult('当前会话已变化，已取消完全访问确认。');
    }
    const value = await bound.session.setPermission({ preset: 'danger-full-access' });
    this.#pendingFullAccess.delete(key);
    return commandResult(permissionMessage(value, allowAll
      ? '当前可见审批已批准；当前会话权限已切换为：'
      : '权限已切换为：'));
  }

  async run(text, harness, state, key, { actor, signal } = {}) {
    const command = parseNaturalPermissionCommand(text);
    if (!command) return null;
    const bound = permissionSession(harness, state, key);
    if (!bound) {
      return commandResult('当前聊天还没有支持权限控制的已绑定会话。请先发送一条普通消息创建会话。');
    }
    const options = permissionOptions({ signal });
    if (command.action === 'query') {
      return commandResult(permissionMessage(await bound.session.permission(options), '当前权限：'));
    }
    if (command.action === 'select') {
      return commandResult(permissionMessage(
        await bound.session.setPermission({ preset: command.preset }, options),
        '权限已切换为：',
      ));
    }
    if (command.action === 'request-full-access') {
      if (!actor) return commandResult('无法确认当前用户，未修改权限。');
      this.#pendingFullAccess.set(key, {
        actor,
        sessionId: bound.sessionId,
        expiresAt: this.#now() + this.#ttlMs,
      });
      return commandResult('完全访问将绕过后续工具审批，仅限当前会话。请由同一用户二次确认：发送“确认切换到完全访问”。');
    }
    return this.#applyFullAccess(harness, state, key, actor);
  }

  async allowAllForCurrentApproval(harness, state, key, { actor } = {}) {
    return this.#applyFullAccess(harness, state, key, actor, { allowAll: true });
  }
}

export async function runNaturalPermissionCommand(text, harness, state, key, options = {}) {
  if (!isNaturalPermissionCommand(text)) return null;
  const manager = permissionManagerFor(options);
  if (!manager) {
    throw new TypeError('A PermissionCommandManager is required');
  }
  return manager.run(text, harness, state, key, {
    actor: options.actor,
    signal: options.signal,
  });
}

export async function allowNaturalPermissionForCurrentApproval(harness, state, key, options = {}) {
  const manager = permissionManagerFor(options);
  if (!manager) return commandResult('无法确认当前会话，未提升完全访问。');
  return manager.allowAllForCurrentApproval(harness, state, key, { actor: options.actor });
}
`

function requireFile(root, relativePath) {
  const target = join(root, relativePath)
  if (!existsSync(target)) {
    throw new Error(`DSH rc.1 runtime closure is missing ${relativePath}`)
  }
  return target
}

function requireText(root, relativePath, expected) {
  const target = requireFile(root, relativePath)
  const source = readFileSync(target, 'utf8')
  if (!source.includes(expected)) {
    throw new Error(`DSH rc.1 runtime contract changed in ${relativePath}: expected ${expected}`)
  }
  return target
}

function packageNameFromLoaderName(name) {
  return name.startsWith('@') ? name.split('/').slice(0, 2).join('/') : name.split('/')[0]
}

function javascriptFiles(root) {
  if (!existsSync(root)) return []
  const files = []
  for (const entry of readdirSync(root)) {
    const target = join(root, entry)
    if (statSync(target).isDirectory()) files.push(...javascriptFiles(target))
    else if (/\.[cm]?js$/u.test(entry)) files.push(target)
  }
  return files
}

// This deliberately operates inside quoted copy only. `Harness` also occurs
// in class names, constructors, RPC identifiers, and package internals; those
// are protocol/runtime implementation details and must stay untouched. The
// small lexer below walks JS literals instead of matching a whole template with
// a regular expression: generated 4.11 bundles contain `${...}` expressions,
// so a broad template match can accidentally rewrite an identifier inside one.
function replaceImUserVisibleText(text) {
  const next = text
    .replace(GENERIC_HARNESS_LABEL, CRAWSHRIMP_HARNESS_BRAND)
    .replace(/DSH-IM\b/gu, `${CRAWSHRIMP_HARNESS_BRAND} IM`)
    .replace(/DSH Session\b/gu, `${CRAWSHRIMP_HARNESS_BRAND} Session`)
    .replace(/DSH 会话/gu, `${CRAWSHRIMP_HARNESS_BRAND} 会话`)
  return next
}

function quotedLiteralEnd(source, start) {
  const quote = source[start]
  for (let index = start + 1; index < source.length; index += 1) {
    if (source[index] === '\\') {
      index += 1
      continue
    }
    if (source[index] === quote) return index + 1
  }
  return source.length
}

function lineCommentEnd(source, start) {
  const newline = source.indexOf('\n', start + 2)
  return newline < 0 ? source.length : newline + 1
}

function blockCommentEnd(source, start) {
  const closing = source.indexOf('*/', start + 2)
  return closing < 0 ? source.length : closing + 2
}

function regularExpressionEnd(source, start) {
  let inCharacterClass = false
  for (let index = start + 1; index < source.length; index += 1) {
    const character = source[index]
    if (character === '\\') {
      index += 1
      continue
    }
    if (character === '\n' || character === '\r') return start + 1
    if (character === '[') inCharacterClass = true
    if (character === ']') inCharacterClass = false
    if (character === '/' && !inCharacterClass) {
      index += 1
      while (/[A-Za-z]/u.test(source[index] ?? '')) index += 1
      return index
    }
  }
  return start + 1
}

function templateExpressionEnd(source, start) {
  let depth = 1
  for (let index = start; index < source.length; index += 1) {
    const character = source[index]
    if (character === '\'' || character === '"') {
      index = quotedLiteralEnd(source, index) - 1
      continue
    }
    if (character === '`') {
      index = templateLiteralEnd(source, index) - 1
      continue
    }
    if (character === '/' && source[index + 1] === '/') {
      index = lineCommentEnd(source, index) - 1
      continue
    }
    if (character === '/' && source[index + 1] === '*') {
      index = blockCommentEnd(source, index) - 1
      continue
    }
    if (character === '/') {
      index = regularExpressionEnd(source, index) - 1
      continue
    }
    if (character === '{') depth += 1
    if (character === '}' && --depth === 0) return index + 1
  }
  return source.length
}

function templateLiteralEnd(source, start) {
  for (let index = start + 1; index < source.length; index += 1) {
    const character = source[index]
    if (character === '\\') {
      index += 1
      continue
    }
    if (character === '`') return index + 1
    if (character === '$' && source[index + 1] === '{') {
      index = templateExpressionEnd(source, index + 2) - 1
    }
  }
  return source.length
}

function replaceTemplateLiteralCopy(source, start, end) {
  let result = '`'
  let segmentStart = start + 1
  for (let index = start + 1; index < end - 1; index += 1) {
    const character = source[index]
    if (character === '\\') {
      index += 1
      continue
    }
    if (character !== '$' || source[index + 1] !== '{') continue
    result += replaceImUserVisibleText(source.slice(segmentStart, index))
    const expressionEnd = templateExpressionEnd(source, index + 2)
    result += source.slice(index, expressionEnd)
    index = expressionEnd - 1
    segmentStart = expressionEnd
  }
  return result + replaceImUserVisibleText(source.slice(segmentStart, end - 1)) + '`'
}

function replaceImUserVisibleCopy(source) {
  const branded = source.replaceAll(UPSTREAM_HARNESS_BRAND, CRAWSHRIMP_HARNESS_BRAND)
  let result = ''
  let segmentStart = 0
  for (let index = 0; index < branded.length; index += 1) {
    const character = branded[index]
    if (character === '\'' || character === '"') {
      const end = quotedLiteralEnd(branded, index)
      result += branded.slice(segmentStart, index)
      result += character + replaceImUserVisibleText(branded.slice(index + 1, end - 1)) + character
      segmentStart = end
      index = end - 1
      continue
    }
    if (character === '`') {
      const end = templateLiteralEnd(branded, index)
      result += branded.slice(segmentStart, index) + replaceTemplateLiteralCopy(branded, index, end)
      segmentStart = end
      index = end - 1
      continue
    }
    if (character === '/' && branded[index + 1] === '/') {
      index = lineCommentEnd(branded, index) - 1
      continue
    }
    if (character === '/' && branded[index + 1] === '*') {
      index = blockCommentEnd(branded, index) - 1
      continue
    }
    if (character === '/') {
      index = regularExpressionEnd(branded, index) - 1
    }
  }
  return result + branded.slice(segmentStart)
}

/**
 * dsh-im intentionally owns its package and protocol names, but its runtime
 * source contains an upstream product label in chat prompts, errors, channel
 * manifests, and the generated client bundle. Patch only that user-visible
 * label after every clean install; provider names and all persisted ids stay
 * untouched.
 */
function patchDshImUserVisibleBrand(root) {
  const packageRoot = join(root, DSH_IM_RUNTIME_ROOT)
  const files = DSH_IM_USER_VISIBLE_SOURCE_ROOTS.flatMap((relativePath) => (
    javascriptFiles(join(packageRoot, relativePath))
  ))
  if (files.length === 0) throw new Error('dsh-im user-visible source is missing')

  const changed = []
  for (const path of files) {
    const source = readFileSync(path, 'utf8')
    let next = replaceImUserVisibleCopy(source)
    for (const [upstream, product] of DSH_SESSION_SYNC_LABELS) {
      next = next.replaceAll(upstream, product)
    }
    if (next === source) continue
    writeFileSync(path, next)
    changed.push(path)
  }

  for (const path of files) {
    if (readFileSync(path, 'utf8').includes(UPSTREAM_HARNESS_BRAND)) {
      throw new Error(`dsh-im user-visible brand patch did not converge: ${path}`)
    }
  }
  return { files, changed }
}

function replaceRequired(source, expected, replacement, label) {
  if (!source.includes(expected)) {
    throw new Error(`dsh-im 4.11 product patch anchor changed: ${label}`)
  }
  return source.replace(expected, replacement)
}

/**
 * Natural model phrases deliberately wrap dsh-im's own /models and /model
 * handlers. That retains its session-binding lock, current-Session readback,
 * model availability checks, and leaves each bot's future-session default
 * untouched.
 */
function patchDshImNaturalModelControls(root) {
  const packageRoot = join(root, DSH_IM_RUNTIME_ROOT)
  const controls = join(packageRoot, 'src/channels/shared/crawshrimp-natural-controls.mjs')
  const textBridge = join(packageRoot, 'src/channels/shared/text-harness-bridge.mjs')
  if (existsSync(controls)) {
    const source = readFileSync(controls, 'utf8')
    if (!source.includes(CRAWSHRIMP_DSH_IM_NATURAL_CONTROLS_MARKER)) {
      throw new Error('dsh-im 4.11 natural controls path is unexpectedly occupied')
    }
    if (source !== NATURAL_MODEL_CONTROLS_SOURCE) writeFileSync(controls, NATURAL_MODEL_CONTROLS_SOURCE)
  } else {
    writeFileSync(controls, NATURAL_MODEL_CONTROLS_SOURCE)
  }

  const source = readFileSync(requireFile(root, 'node_modules/@xmanrui/dsh-im/src/channels/shared/text-harness-bridge.mjs'), 'utf8')
  const importBlock = "import {\n  isNaturalModelCommand,\n  runNaturalModelCommand,\n} from './crawshrimp-natural-controls.mjs';\n"
  const nextImport = source.includes(importBlock)
    ? source
    : replaceRequired(
      source,
      "import {\n  isModelCommand,\n  runModelCommand,\n} from './model-command.mjs';\n",
      "import {\n  isModelCommand,\n  runModelCommand,\n} from './model-command.mjs';\n" + importBlock,
      'TextHarnessBridge model imports',
    )
  const permissionImport = "import {\n  isNaturalPermissionCommand,\n  PermissionCommandManager,\n  runNaturalPermissionCommand,\n} from './crawshrimp-natural-controls.mjs';\n"
  const nextPermissionImport = nextImport.includes(permissionImport)
    ? nextImport
    : replaceRequired(nextImport, importBlock, importBlock + permissionImport, 'TextHarnessBridge permission imports')
  const nextField = nextPermissionImport.includes('#permissionCommands = new PermissionCommandManager();')
    ? nextPermissionImport
    : replaceRequired(
      nextPermissionImport,
      '  #approvals;\n  #batches = new BatchInputManager();',
      '  #approvals;\n  #permissionCommands = new PermissionCommandManager();\n  #batches = new BatchInputManager();',
      'TextHarnessBridge permission state',
    )
  // A clean 4.11 install starts with its native /models + /model dispatch.
  // Apply the product controls in two explicit, idempotent phases: first add
  // natural-language model selection, then wrap that result with permission
  // control.  Collapsing these into a single anchor makes staging depend on a
  // previously patched development node_modules tree.
  const upstreamModelDispatch = ": (isModelCommand(text)\n          ? runModelCommand\n          : (isPresetCommand(text) ? runPresetCommand : null));"
  const modelDispatch = ": (isNaturalModelCommand(text)\n          ? runNaturalModelCommand\n          : (isModelCommand(text)\n            ? runModelCommand\n            : (isPresetCommand(text) ? runPresetCommand : null)));"
  const permissionDispatch = ": (isNaturalPermissionCommand(text)\n          ? runNaturalPermissionCommand\n          : (isNaturalModelCommand(text)\n            ? runNaturalModelCommand\n            : (isModelCommand(text)\n              ? runModelCommand\n              : (isPresetCommand(text) ? runPresetCommand : null))));"
  const nextNaturalModelDispatch = nextField.includes(modelDispatch) || nextField.includes(permissionDispatch)
    ? nextField
    : replaceRequired(nextField, upstreamModelDispatch, modelDispatch, 'TextHarnessBridge natural model dispatch')
  const nextDispatch = nextNaturalModelDispatch.includes(permissionDispatch)
    ? nextNaturalModelDispatch
    : replaceRequired(nextNaturalModelDispatch, modelDispatch, permissionDispatch, 'TextHarnessBridge permission dispatch')
  const nextCaller = nextDispatch.includes('key,\n        commandRunner,\n        senderId,')
    ? nextDispatch
    : replaceRequired(
      nextDispatch,
      'key,\n        commandRunner,\n      ).finally',
      'key,\n        commandRunner,\n        senderId,\n      ).finally',
      'TextHarnessBridge command actor',
    )
  const nextSignature = nextCaller.includes('async #processFastCommand(message, messageId, key, runner, actor)')
    ? nextCaller
    : replaceRequired(
      nextCaller,
      'async #processFastCommand(message, messageId, key, runner) {',
      'async #processFastCommand(message, messageId, key, runner, actor) {',
      'TextHarnessBridge command actor signature',
    )
  const next = nextSignature.includes('permissionManager: this.#permissionCommands,')
    ? nextSignature
    : replaceRequired(
      nextSignature,
      '          signal: this.#signal,\n          isDirect: message.kind === \'direct\',',
      "          signal: this.#signal,\n          actor,\n          permissionManager: this.#permissionCommands,\n          isDirect: message.kind === 'direct',",
      'TextHarnessBridge permission options',
    )
  const nextApproval = next.includes('onAllowAll: async ({ key, actor }) =>')
    ? next
    : replaceRequired(
      next,
      `    this.#approvals = new HarnessApprovalQueue({
      label: descriptor.key,
      logger,
    });`,
      `    this.#approvals = new HarnessApprovalQueue({
      label: descriptor.key,
      logger,
      onAllowAll: async ({ key, actor }) => {
        const result = await this.#permissionCommands.allowAllForCurrentApproval(
          this.#harness,
          this.#state,
          key,
          { actor },
        );
        return result?.message ?? null;
      },
    });`,
      'TextHarnessBridge scoped allow-all callback',
    )
  if (nextApproval !== source) writeFileSync(textBridge, nextApproval)
  return { controls, textBridge }
}

function patchDshImApprovalControls(root) {
  const approval = join(root, DSH_IM_RUNTIME_ROOT, 'src/channels/shared/harness-approval.mjs')
  let source = readFileSync(approval, 'utf8')
  if (source.includes('#onAllowAll;')
    && source.includes("['允许所有', 'allowed-all']")
    && source.includes("decision === 'allowed-all'")) return approval
  source = replaceRequired(
    source,
    "  ['yes', 'allowed-once'],",
    "  ['yes', 'allowed-once'],\n  ['允许所有', 'allowed-all'],\n  ['allow all', 'allowed-all'],",
    'HarnessApprovalQueue allow-all replies',
  )
  source = replaceRequired(
    source,
    '  #logger;\n  #byId = new Map();',
    '  #logger;\n  #onAllowAll;\n  #byId = new Map();',
    'HarnessApprovalQueue allow-all callback state',
  )
  source = replaceRequired(
    source,
    '  constructor({ label = \'IM\', logger = console } = {}) {\n    this.#label = label;\n    this.#logger = logger;\n  }',
    `  constructor({ label = 'IM', logger = console, onAllowAll } = {}) {
    if (onAllowAll !== undefined && typeof onAllowAll !== 'function') {
      throw new TypeError('onAllowAll must be a function');
    }
    this.#label = label;
    this.#logger = logger;
    this.#onAllowAll = onAllowAll;
  }`,
    'HarnessApprovalQueue allow-all callback constructor',
  )
  source = replaceRequired(
    source,
    '            await this.#submit(pending, decision);',
    `            if (decision === 'allowed-all') {
              await this.#submit(pending, 'allowed-once');
              const message = await this.#onAllowAll?.({
                key: pending.key,
                actor: pending.actor,
                sessionId: pending.sessionId,
                approvalId: pending.approvalId,
              });
              if (message) await send(message);
            } else {
              await this.#submit(pending, decision);
            }`,
    'HarnessApprovalQueue scoped allow-all submit',
  )
  writeFileSync(approval, source)
  return approval
}

function patchDshImNativeChannelControls(root) {
  const packageRoot = join(root, DSH_IM_RUNTIME_ROOT)
  const bridges = [
    { relativePath: 'src/channels/weixin/weixin-bridge.mjs', actor: 'sender', label: 'weixin' },
    { relativePath: 'src/channels/wecom/wecom-bridge.mjs', actor: 'senderId', label: 'wecom' },
    { relativePath: 'src/channels/dingtalk/dingtalk-bridge.mjs', actor: 'sender', label: 'DingTalk' },
    { relativePath: 'src/channels/qq/qq-bridge.mjs', actor: 'sender', label: 'qq' },
    { relativePath: 'src/channels/feishu/bridge.mjs', actor: 'senderOpenId(event)', label: 'Feishu' },
  ]
  const modelImport = "import {\n  isModelCommand,\n  runModelCommand,\n} from '../shared/model-command.mjs';\n"
  const naturalImport = `import {
  allowNaturalPermissionForCurrentApproval,
  isNaturalModelCommand,
  isNaturalPermissionCommand,
  runNaturalModelCommand,
  runNaturalPermissionCommand,
} from '../shared/crawshrimp-natural-controls.mjs'; // ${CRAWSHRIMP_DSH_IM_NATIVE_CONTROLS_MARKER}
`
  const modelDispatch = `: (isModelCommand(commandText)
          ? runModelCommand
          : (isPresetCommand(commandText) ? runPresetCommand : null));`

  for (const bridge of bridges) {
    const path = join(packageRoot, bridge.relativePath)
    let source = readFileSync(path, 'utf8')
    if (source.includes(CRAWSHRIMP_DSH_IM_NATIVE_CONTROLS_MARKER)) continue
    source = replaceRequired(
      source,
      modelImport,
      modelImport + naturalImport,
      `${bridge.relativePath} natural control imports`,
    )
    const dispatch = `: (isNaturalPermissionCommand(commandText)
          ? (text, harness, state, key, options) => runNaturalPermissionCommand(
            text, harness, state, key, { ...options, actor: ${bridge.actor} },
          )
          : (isNaturalModelCommand(commandText)
            ? runNaturalModelCommand
            : (isModelCommand(commandText)
              ? runModelCommand
              : (isPresetCommand(commandText) ? runPresetCommand : null))));`
    source = replaceRequired(
      source,
      modelDispatch,
      dispatch,
      `${bridge.relativePath} natural control dispatch`,
    )
    source = replaceRequired(
      source,
      `    this.#approvals = new HarnessApprovalQueue({ label: '${bridge.label}', logger });`,
      `    this.#approvals = new HarnessApprovalQueue({
      label: '${bridge.label}',
      logger,
      onAllowAll: async ({ key, actor }) => {
        const result = await allowNaturalPermissionForCurrentApproval(
          this.#harness,
          this.#state,
          key,
          { actor, control: { owner: this, key } },
        );
        return result?.message ?? null;
      },
    });`,
      `${bridge.relativePath} scoped allow-all callback`,
    )
    writeFileSync(path, source)
  }
  return bridges.map(({ relativePath }) => join(packageRoot, relativePath))
}

/**
 * dsh-im 4.11 removed the old command executor. Re-expose permission controls
 * through its typed Host RPC surface, where the product bridge can verify the
 * live Session and apply its native permission preset service.
 */
function patchDshImSessionPermissionRpc(root) {
  const packageRoot = join(root, DSH_IM_RUNTIME_ROOT)
  const harnessClient = join(packageRoot, 'src/channels/shared/harness-client.mjs')
  const workspaceStore = join(packageRoot, 'src/channels/shared/bot-workspace-store.mjs')
  const modernApi = join(packageRoot, 'plugin-src/host/modern-harness-api.mjs')

  let clientSource = readFileSync(harnessClient, 'utf8')
  if (!clientSource.includes(CRAWSHRIMP_DSH_IM_SESSION_PERMISSION_MARKER)) {
    const validation = `// ${CRAWSHRIMP_DSH_IM_SESSION_PERMISSION_MARKER}
function validateSessionPermission(value, method, { requirePrevious = false } = {}) {
  if (!value || typeof value !== 'object'
    || typeof value.preset !== 'string' || !value.preset
    || !Array.isArray(value.available)
    || value.available.some((preset) => typeof preset !== 'string' || !preset)
    || (requirePrevious && (typeof value.previous !== 'string' || !value.previous))) {
    throw new Error('Harness returned an invalid response for ' + method);
  }
  return value;
}
`
    clientSource = replaceRequired(
      clientSource,
      'function validModelReasoning(value) {',
      validation + '\nfunction validModelReasoning(value) {',
      'HarnessClient permission response validation',
    )
    const methods = `  async getSessionPermission(sessionId, options = {}) {
    if (typeof sessionId !== 'string' || !sessionId) throw new TypeError('sessionId is required');
    await this.ensureRunning(options);
    return validateSessionPermission(
      await this.rpc('session.permission', { sessionId }, 10_000, options),
      'session.permission',
    );
  }

  async setSessionPermission(sessionId, preset, options = {}) {
    if (typeof sessionId !== 'string' || !sessionId) throw new TypeError('sessionId is required');
    if (typeof preset !== 'string' || !preset) throw new TypeError('permission preset is required');
    await this.ensureRunning(options);
    return validateSessionPermission(
      await this.rpc('session.permission', { sessionId, preset }, 10_000, options),
      'session.permission',
      { requirePrevious: true },
    );
  }

`
    clientSource = replaceRequired(
      clientSource,
      '  async isSessionRunning(sessionId, options = {}) {',
      methods + '  async isSessionRunning(sessionId, options = {}) {',
      'HarnessClient permission methods',
    )
    writeFileSync(harnessClient, clientSource)
  }

  let storeSource = readFileSync(workspaceStore, 'utf8')
  if (!storeSource.includes(CRAWSHRIMP_DSH_IM_SESSION_PERMISSION_MARKER)) {
    storeSource = replaceRequired(
      storeSource,
      `            selectModel(...args) {
              return invokeCurrentSession('selectSessionModel', args, 'model selection');
            },`,
      `            selectModel(...args) {
              return invokeCurrentSession('selectSessionModel', args, 'model selection');
            },
            // ${CRAWSHRIMP_DSH_IM_SESSION_PERMISSION_MARKER}
            permission(...args) {
              return invokeCurrentSession('getSessionPermission', args, 'permission read');
            },
            setPermission(request, ...args) {
              const preset = typeof request === 'string' ? request : request?.preset;
              return invokeStartedSessionMutation('setSessionPermission', [preset, ...args], 'permission change');
            },`,
      'bot workspace permission facade',
    )
    writeFileSync(workspaceStore, storeSource)
  }

  let modernSource = readFileSync(modernApi, 'utf8')
  if (!modernSource.includes(CRAWSHRIMP_DSH_IM_SESSION_PERMISSION_MARKER)) {
    const helpers = `// ${CRAWSHRIMP_DSH_IM_SESSION_PERMISSION_MARKER}
function optionalService(ctx, name) {
  if (ctx && Object.hasOwn(ctx, name)) return ctx[name];
  try {
    return typeof ctx?.get === 'function' ? ctx.get(name) : undefined;
  } catch {
    return undefined;
  }
}

function permissionRpcError(code, message) {
  const error = new Error(message);
  error.failure = { code, message, details: {} };
  return error;
}

function liveAgentForSession(ctx, sessionId) {
  const agents = optionalService(ctx, 'agents');
  for (const agent of agents?.roots?.() ?? []) {
    if (String(agent?.session?.id) === String(sessionId)) return agent;
  }
  return null;
}

function permissionPresetsFor(ctx) {
  const service = optionalService(ctx, 'permissionPresets');
  if (!service || !Array.isArray(service.names)
    || typeof service.current !== 'function'
    || (typeof service.apply !== 'function' && typeof service.set !== 'function')) return null;
  return service;
}

`
    modernSource = replaceRequired(
      modernSource,
      'class ModernHarnessApi {',
      helpers + 'class ModernHarnessApi {',
      'modern Harness permission helpers',
    )
    modernSource = replaceRequired(
      modernSource,
      'class ModernHarnessApi {\n  #gateway;',
      'class ModernHarnessApi {\n  #ctx;\n  #gateway;',
      'modern Harness permission context',
    )
    modernSource = replaceRequired(
      modernSource,
      '  constructor(ctx, gateway, scope) {\n    this.#gateway = gateway;',
      '  constructor(ctx, gateway, scope) {\n    this.#ctx = ctx;\n    this.#gateway = gateway;',
      'modern Harness permission constructor',
    )
    modernSource = replaceRequired(
      modernSource,
      `      selectModel: (request, signal) => rpcResult(request, () => this.#invoke(
        'session', 'selectModel', { request: request.payload }, signal,
      )),
    });`,
      `      selectModel: (request, signal) => rpcResult(request, () => this.#invoke(
        'session', 'selectModel', { request: request.payload }, signal,
      )),
      permission: (request, signal) => rpcResult(request, () => this.#sessionPermission(
        request.payload, signal,
      )),
    });`,
      'modern Harness permission RPC',
    )
    const method = `  async #sessionPermission(payload, signal) {
    signal?.throwIfAborted();
    const sessionId = typeof payload?.sessionId === 'string' ? payload.sessionId : '';
    if (!sessionId) throw permissionRpcError('bad-request', 'sessionId required');
    const agent = liveAgentForSession(this.#ctx, sessionId);
    if (!agent) throw permissionRpcError('NO_LIVE_AGENT', 'No live agent for this session');
    const service = permissionPresetsFor(this.#ctx);
    if (!service) throw permissionRpcError('unsupported', 'session permission service is unavailable');
    const requested = typeof payload?.preset === 'string' ? payload.preset : '';
    const previous = service.current(agent.session.events);
    if (!requested) return { preset: previous, available: [...service.names] };
    if (!service.names.includes(requested)) {
      throw permissionRpcError('unknown-preset', 'Unknown permission preset "' + requested + '"');
    }
    const approval = optionalService(this.#ctx, 'approval');
    if (typeof service.apply === 'function' && typeof approval?.setPolicy === 'function') {
      service.apply(agent.session, requested, (policy) => approval.setPolicy(agent, policy));
    } else {
      service.set(agent.session, requested);
    }
    signal?.throwIfAborted();
    const preset = service.current(agent.session.events);
    if (preset !== requested) {
      throw permissionRpcError('permission-readback-mismatch', 'Session permission readback did not match the requested preset');
    }
    return { preset, available: [...service.names], previous };
  }

`
    modernSource = replaceRequired(
      modernSource,
      '  async #invoke(namespace, method, args, signal) {',
      method + '  async #invoke(namespace, method, args, signal) {',
      'modern Harness permission implementation',
    )
    writeFileSync(modernApi, modernSource)
  }

  return { harnessClient, workspaceStore, modernApi }
}

/**
 * Cordis evaluates a profile from the runtime root, not from each bundle's
 * nested node_modules tree. Verify every effective profile row where it will
 * actually be imported. This catches npm topology changes before a staged or
 * packaged runtime reaches the user.
 */
function assertEffectiveProfileRootClosure(root) {
  const productProfile = ['profiles/web/cordis.patch.yml', 'profile/web/cordis.patch.yml']
    .map((relativePath) => join(root, relativePath))
    .find(existsSync)
  if (!productProfile) throw new Error('DSH rc.1 product Web profile is missing from the runtime')
  const patchFiles = [
    'node_modules/@deepseek-ai/dsh-base/cordis.patch.yml',
    'node_modules/@deepseek-ai/dsh-web-app/cordis.patch.yml',
    'node_modules/@xmanrui/dsh-im/cordis.patch.yml',
    productProfile.slice(root.length + 1),
  ]
  const packages = new Set()
  for (const relativePath of patchFiles) {
    const source = readFileSync(requireFile(root, relativePath), 'utf8')
    for (const match of source.matchAll(/^\s+name:\s+['"]([^'"]+)['"]\s*$/gmu)) {
      packages.add(packageNameFromLoaderName(match[1]))
    }
  }
  for (const packageName of packages) {
    requireFile(root, `node_modules/${packageName}/package.json`)
  }
  return [...packages].sort()
}

/** Verify a preset composition against the runtime-root package closure. */
function assertStandardPresetRootClosure(root) {
  const standardPath = 'node_modules/@deepseek-ai/dsh-agent-presets/presets/standard/agent.cordis.yml'
  // Source development runtime keeps the profile under `profile/web`; the
  // package staging step copies it to `profiles/web`. Both execute this same
  // guard, so resolve the actual layout before checking the preset closure.
  const crawshrimpPath = [
    'profiles/web/agent-presets/crawshrimp-standard/agent.cordis.yml',
    'profile/web/agent-presets/crawshrimp-standard/agent.cordis.yml',
  ].find((relativePath) => existsSync(join(root, relativePath)))
  if (!crawshrimpPath) {
    throw new Error('DSH rc.1 product Crawshrimp standard preset is missing from the runtime')
  }
  const sources = [
    readFileSync(requireFile(root, standardPath), 'utf8'),
    readFileSync(requireFile(root, crawshrimpPath), 'utf8'),
  ]
  const packages = new Set()
  for (const source of sources) {
    for (const match of source.matchAll(/^\s+name:\s+['"]([^'"]+)['"]\s*$/gmu)) {
      packages.add(packageNameFromLoaderName(match[1]))
    }
  }
  for (const packageName of packages) {
    requireFile(root, `node_modules/${packageName}/package.json`)
  }
  return { packages: [...packages].sort(), standardPath, crawshrimpPath }
}

/**
 * Validate and apply product-owned 4.11 overlays to a freshly installed
 * runtime. The old rc.8 binary graph is deliberately not revived: every
 * mutation below targets readable 4.11 source and is idempotent.
 *
 * @returns source paths used as current-release evidence for staging/tests.
 */
export function patchRuntimeDependencies(runtimeRoot) {
  const root = resolve(runtimeRoot)
  const dshManifest = requireText(root, 'node_modules/@deepseek-ai/dsh/package.json', '"0.1.2-rc.1"')
  const dshBin = requireFile(root, 'node_modules/@deepseek-ai/dsh/lib/bin.js')
  // Cordis resolves Web Host plugins from the product runtime root.  Keep the
  // complete official Web closure hoisted here instead of relying on npm's
  // nested copy below `dsh`, which cannot satisfy that resolver on a clean
  // install.
  const dshWebAppManifest = requireText(root, 'node_modules/@deepseek-ai/dsh-web-app/package.json', '"0.1.2-rc.1"')
  const dshWebAppPatch = requireFile(root, 'node_modules/@deepseek-ai/dsh-web-app/cordis.patch.yml')
  const dshWorkspaceController = requireText(root, 'node_modules/@deepseek-ai/dsh-api-workspace-controller/package.json', '"0.1.2-rc.1"')
  const dshCordisHostRunner = requireText(root, 'node_modules/@deepseek-ai/dsh-cordis-host-runner/package.json', '"0.1.2-rc.1"')
  // These active rows come from the standard Web profile plus Crawshrimp's
  // official-profile overlay.  They are intentionally direct dependencies:
  // the Cordis loader imports every active row from this runtime root.
  const dshAttachmentLocal = requireText(root, 'node_modules/@deepseek-ai/dsh-attachment-local/package.json', '"0.1.2-rc.1"')
  const dshLlMPiAi = requireText(root, 'node_modules/@deepseek-ai/dsh-llm-pi-ai/package.json', '"0.1.2-rc.1"')
  const dshTimeContext = requireText(root, 'node_modules/@deepseek-ai/dsh-time-context/package.json', '"0.1.2-rc.1"')
  const dshSchedule = requireText(root, 'node_modules/@deepseek-ai/dsh-schedule/package.json', '"0.1.2-rc.1"')
  const dshImManifest = requireText(root, 'node_modules/@xmanrui/dsh-im/package.json', '"4.11.0"')
  const dshImEntry = requireFile(root, 'node_modules/@xmanrui/dsh-im/lib/index.js')
  const dshImBrand = patchDshImUserVisibleBrand(root)
  const dshImNaturalModelControls = patchDshImNaturalModelControls(root)
  const dshImApprovalControls = patchDshImApprovalControls(root)
  const dshImNativeChannelControls = patchDshImNativeChannelControls(root)
  const dshImSessionPermission = patchDshImSessionPermissionRpc(root)
  const profilePackages = assertEffectiveProfileRootClosure(root)
  const standardPreset = assertStandardPresetRootClosure(root)
  const inboundTtl = requireText(
    root,
    'node_modules/@xmanrui/dsh-im/src/channels/shared/inbound-ttl.mjs',
    'DEFAULT_INBOUND_TTL_HOURS = 168',
  )
  const sessionBinding = requireFile(
    root,
    'node_modules/@xmanrui/dsh-im/src/channels/shared/harness-session-binding.mjs',
  )
  const modelSetting = requireFile(
    root,
    'node_modules/@xmanrui/dsh-im/src/channels/shared/model-setting.mjs',
  )

  return {
    patched: true,
    marker: RUNTIME_GUARD_MARKER,
    dshManifest,
    dshBin,
    dshWebAppManifest,
    dshWebAppPatch,
    dshWorkspaceController,
    dshCordisHostRunner,
    dshAttachmentLocal,
    dshLlMPiAi,
    dshTimeContext,
    dshSchedule,
    dshImManifest,
    dshImEntry,
    dshImBrandFiles: dshImBrand.files,
    dshImBrandChangedFiles: dshImBrand.changed,
    dshImNaturalModelControls,
    dshImApprovalControls,
    dshImNativeChannelControls,
    dshImSessionPermission,
    profilePackages,
    standardPresetPackages: standardPreset.packages,
    crawshrimpPreset: standardPreset.crawshrimpPath,
    inboundTtl,
    sessionBinding,
    modelSetting,
  }
}

if (import.meta.url === new URL(process.argv[1], 'file:').href) {
  const result = patchRuntimeDependencies(resolve(new URL('..', import.meta.url).pathname))
  console.log(`[patch-runtime-dependencies] ${result.marker}: patched ${result.dshImBrandChangedFiles.length} dsh-im user-visible source files`)
}
