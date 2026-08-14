<template>
  <div class="agent-session-bar" :class="{ collapsed }">
    <div class="session-bar-head">
      <button
        class="new-session-btn"
        type="button"
        :title="collapsed ? '新建会话' : undefined"
        :aria-label="'新建会话'"
        @click="createSession"
      >
        <span class="icon">＋</span>
        <span v-if="!collapsed">新建会话</span>
      </button>
    </div>
    <div v-if="!collapsed" class="session-list">
      <div v-if="!sessions.length" class="session-empty">暂无会话</div>
      <button
        v-for="s in sessions"
        :key="s.id"
        :class="['session-btn', { active: s.id === activeId }]"
        type="button"
        :title="s.title"
        @click="select(s.id)"
      >
        <span class="session-dot"></span>
        <span class="session-title">{{ s.title }}</span>
      </button>
    </div>
  </div>
</template>

<script setup>
import { ref } from 'vue'

defineProps({
  collapsed: { type: Boolean, default: false },
})

const emit = defineEmits(['select-session'])

// 骨架阶段:会话暂存于渲染端,后续接入 /agent/sessions 产品 API
const sessions = ref([])
const activeId = ref('')

function createSession() {
  const id = `local-${Date.now()}`
  sessions.value.unshift({ id, title: '新会话' })
  activeId.value = id
  emit('select-session', id)
}

function select(id) {
  activeId.value = id
  emit('select-session', id)
}
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
.new-session-btn:hover {
  background: var(--orange-bg);
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
