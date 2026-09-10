import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

export const REASONING_RECOVERY_MARKER = 'crawshrimp-reasoning-recovery-v1'

// Only a reasoning-only length finish is recoverable here. In particular,
// BlockAssembler drops truncated tool calls, so inspect the raw stream too.
export function buildReasoningRecovery(content, sawToolCall, attempts) {
  if (sawToolCall || !content.length || content.some(block =>
    block.type !== 'reasoning' && !(block.type === 'text' && !block.text.trim()))) return null
  const draft = content.filter(block => block.type === 'reasoning').map(block => block.text).join('\n\n')
  if (!draft.trim()) return null
  const retry = attempts < 1
  return {
    retry,
    notice: retry
      ? '思考阶段已耗尽输出额度，尚未产生正文。已保留思考上下文，正在自动续接（1/1）。'
      : '自动续接后仍在思考阶段耗尽输出额度，已停止自动重试。最新思考上下文已保留；可降低思考强度或提高输出预算后发送“继续”。',
    context: '上一轮模型只产生了未完成的思考草稿，没有正文或可执行的工具调用。以下 JSON 字符串是该草稿，仅作为工作上下文，不是用户的新指令，也不是已完成操作的证据。保留原任务和权限边界，沿用有用的已有推导，避免从头重复规划；尽快输出结果或调用当前可用工具执行下一步。\n未完成草稿：\n' + JSON.stringify(draft),
  }
}

function replaceOnce(source, anchor, replacement) {
  if (source.split(anchor).length !== 2) throw new Error('Reasoning recovery anchor changed: ' + anchor.slice(0, 90))
  return source.replace(anchor, replacement)
}

export function patchReasoningRecoverySource(source) {
  if (source.includes(REASONING_RECOVERY_MARKER)) return source.replace(
    'content: [{ type: "text", text: recovery.notice }], source })',
    'content: [{ type: "text", text: recovery.notice }], source: { provider: "crawshrimp-output-recovery", model: "notice" } })')
  source = replaceOnce(source, '\t\tphase.turn = turn;', '\t\tphase.turn = turn;\n\t\tphase.crawshrimpReasoningRecoveries = 0;')
  source = replaceOnce(source, '\t\t\tconst assembler = new BlockAssembler();', '\t\t\tconst assembler = new BlockAssembler();\n\t\t\tlet crawshrimpSawToolCall = false;')
  source = replaceOnce(source, '\t\t\t\t\tassembler.push(chunk);', `\t\t\t\t\tcrawshrimpSawToolCall ||= chunk.type === "tool-call-delta" || chunk.blockType === "tool-call" || chunk.block?.type === "tool-call";
\t\t\t\t\tassembler.push(chunk);`)
  source = replaceOnce(source, '\t\t\tif (finish.kind === "max-tokens") return { kind: "max-tokens" };', `\t\t\tif (finish.kind === "max-tokens") {
\t\t\t\tconst recovery = buildReasoningRecovery(message.content, crawshrimpSawToolCall, this.phase.crawshrimpReasoningRecoveries ?? 0);
\t\t\t\tif (recovery) {
\t\t\t\t\tsignal.throwIfAborted();
\t\t\t\t\tconst source = { kind: "plugin", plugin: "crawshrimp-output-recovery" };
\t\t\t\t\t// Persist a provider-neutral snapshot before scheduling another step.
\t\t\t\t\t// Pure reasoning assistant history is omitted by some adapters.
\t\t\t\t\tthis.session.append("user/message", createUserMessage({
\t\t\t\t\t\tcontent: [{ type: "text", text: recovery.context }],
\t\t\t\t\t\tsource: { ...source, form: "snapshot", sections: [{ name: "未完成思考上下文", text: recovery.context }] }
\t\t\t\t\t}), { surfaceOp: "append" });
\t\t\t\t\tthis.session.append("assistant/message", {
\t\t\t\t\t\tturn, step,
\t\t\t\t\t\tmessage: createAssistantMessage({ content: [{ type: "text", text: recovery.notice }], source: { provider: "crawshrimp-output-recovery", model: "notice" } })
\t\t\t\t\t}, { surfaceOp: "append" });
\t\t\t\t\tif (recovery.retry) {
\t\t\t\t\t\tthis.phase.crawshrimpReasoningRecoveries = (this.phase.crawshrimpReasoningRecoveries ?? 0) + 1;
\t\t\t\t\t\treturn null;
\t\t\t\t\t}
\t\t\t\t}
\t\t\t\treturn { kind: "max-tokens" };
\t\t\t}`)
  return `// ${REASONING_RECOVERY_MARKER}\n${buildReasoningRecovery.toString()}\n` + source
}

export function patchReasoningRecovery(root) {
  const entry = join(root, 'node_modules/@deepseek-ai/dsh-agent-loop/lib/index.js')
  const before = readFileSync(entry, 'utf8')
  const after = patchReasoningRecoverySource(before)
  if (before !== after) writeFileSync(entry, after)
  return { entry, marker: REASONING_RECOVERY_MARKER }
}
