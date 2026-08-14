<template>
  <div class="agent-session-bar" :class="{ collapsed }">
    <div class="session-bar-head">
      <button
        class="new-session-btn"
        type="button"
        :title="collapsed ? '新建会话' : undefined"
        :aria-label="'新建会话'"
        :disabled="busy"
        @click="createSession"
      >
        <span class="icon">＋</span>
        <span v-if="!collapsed">新建会话</span>
      </button>
    </div>
    <div v-if="!collapsed" class="session-list">
      <div v-if="loading" class="session-empty">加载中…</div>
      <div v-else-if="!sessions.length" class="session-empty">暂无会话,点击上方新建</div>
      <button
        v-for="s in sessions"
        :key="s.session_id"
        :class="['session-btn', { active: s.session_id === activeId }]"
        type="button"
        :title="s.title"
        @click="select(s.session_id)"
      >
        <span class="session-dot" :class="{ running: s.status === 'running' }"></span>
        <span class="session-title">{{ s.title }}</span>
      </button>
    </div>
  </div>
</template>

<script setup>
import { onMounted, ref } from 'vue'

defineProps({
  collapsed: { type: Boolean, default: false },
})

const emit = defineEmits(['select-session'])

const sessions = ref([])
const activeId = ref('')
const loading = ref(false)
const busy = ref(false)

async function loadSessions() {
  loading.value = true
  try {
    const result = await window.cs.agentApi('GET', '/agent/sessions')
    sessions.value = (result?.sessions || []).filter((s) => !s.archived_at)
  } catch (error) {
    sessions.value = []
  } finally {
    loading.value = false
  }
}

async function createSession() {
  if (busy.value) return
  busy.value = true
  try {
    const result = await window.cs.agentApi('POST', '/agent/sessions', { title: '新会话' })
    const session = result?.session
    if (session) {
      await loadSessions()
      select(session.session_id)
    }
  } catch (error) {
    console.error('[agent] 新建会话失败:', error)
  } finally {
    busy.value = false
  }
}

function select(sessionId) {
  activeId.value = sessionId
  emit('select-session', sessionId)
}

onMounted(loadSessions)
</script>

<style scoped>
.agent-session-bar {
  padding: 6px 8px;
  border-bottom: 1px solid var(--border);
  margin-bottom: 6px;
}
.agent-session-bar.collapsed {
  padding: 6px 8px;
}
.session-bar-head {
  display: flex;
}
.new-session-btn {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  padding: 8px 10px;
  border: 1px dashed var(--orange);
  border-radius: 8px;
  background: transparent;
  color: var(--orange);
  font-size: 13px;
  cursor: pointer;
  transition: all 0.15s;
  white-space: nowrap;
  overflow: hidden;
}
.new-session-btn:hover:not(:disabled) {
  background: var(--orange-bg);
}
.new-session-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
.collapsed .new-session-btn {
  padding: 8px 0;
}
.icon {
  font-size: 14px;
  line-height: 1;
}
.session-list {
  display: flex;
  flex-direction: column;
  gap: 2px;
  margin-top: 8px;
  max-height: 32vh;
  overflow-y: auto;
}
.session-empty {
  padding: 10px 12px;
  color: var(--text3);
  font-size: 12px;
  text-align: center;
}
.session-btn {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 10px;
  border: none;
  border-radius: 8px;
  background: transparent;
  color: var(--text2);
  font-size: 12.5px;
  text-align: left;
  cursor: pointer;
  transition: background 0.15s;
}
.session-btn:hover {
  background: var(--bg3);
  color: var(--text);
}
.session-btn.active {
  background: var(--bg3);
  color: var(--text);
}
.session-dot {
  flex: none;
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--text3);
}
.session-dot.running {
  background: var(--orange);
  box-shadow: 0 0 5px var(--orange);
}
.session-btn.active .session-dot {
  background: var(--orange);
  box-shadow: 0 0 5px var(--orange);
}
.session-title {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
