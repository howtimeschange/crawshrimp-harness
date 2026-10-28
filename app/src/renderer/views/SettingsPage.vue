<template>
  <div class="view" :class="{ 'settings-light': props.effectiveTheme === 'light' }">
    <div class="settings-workspace">
      <a class="settings-skip" href="#settings-main">跳转到设置内容</a>
      <aside class="settings-menu" aria-label="设置导航">
        <header class="settings-nav-header">
          <button type="button" class="settings-back" aria-label="返回上一页" title="返回上一页" @click="emit('back')"><IconArrowLeft :size="18" :stroke="1.7" /></button>
          <h1>设置</h1>
        </header>
        <div class="settings-search"><IconSearch :size="16" :stroke="1.6" aria-hidden="true" /><input v-model="settingsQuery" type="search" placeholder="搜索设置" aria-label="搜索设置" @keydown.esc="settingsQuery = ''" /><button v-if="settingsQuery" type="button" aria-label="清空设置搜索" @click="settingsQuery = ''"><IconX :size="14" /></button></div>
        <p v-if="settingsQuery" class="settings-search-count" role="status">{{ visibleNavigation.reduce((count, section) => count + section.items.length, 0) }} 项匹配</p>
        <select class="settings-mobile-select" aria-label="选择设置页面" :value="activePanelId" @change="focusPanel($event.target.value)">
          <option v-if="!visibleNavigation.some(section => section.items.some(item => item.id === activePanelId))" value="" disabled>选择匹配的设置</option>
          <optgroup v-for="section in visibleNavigation" :key="section.label" :label="section.label"><option v-for="item in section.items" :key="item.id" :value="item.id">{{ item.label }}</option></optgroup>
        </select>
        <nav class="settings-nav-list" aria-label="设置项目">
          <section v-for="section in visibleNavigation" :key="section.label" class="nav-section">
            <h2>{{ section.label }}</h2>
            <button v-for="item in section.items" :key="item.id" type="button" :class="['settings-nav-item', { active: activePanelId === item.id }]" :aria-current="activePanelId === item.id ? 'page' : undefined" @click="selectPanel(item.groupId, item.id)">
              <component :is="item.icon" :size="17" :stroke="1.6" aria-hidden="true" /><span>{{ item.label }}</span>
            </button>
          </section>
          <div v-if="!visibleNavigation.length" class="nav-empty"><p>没有匹配的设置</p><button type="button" @click="settingsQuery = ''">清空搜索</button></div>
        </nav>
      </aside>
      <main id="settings-main" class="settings-content" ref="settingsContent" :data-panel="activePanelId" aria-label="设置内容" tabindex="-1">
        <section v-if="activePanelId === 'appearance-theme'" key="appearance-theme" class="panel">
          <div class="panel-head">
            <div>
              <p class="panel-kicker">外观</p>
              <h3>主题</h3><p class="panel-description">{{ activePanelDescription }}</p>
            </div>
            <span class="badge neutral">
              当前为{{ props.themePreference === 'lake' ? '湖光' : props.effectiveTheme === 'light' ? '浅色' : '深色' }}
            </span>
          </div>

          <div class="theme-intro">
            <strong>选择抓虾的界面主题</strong>
            <p>主题会立即应用并保存在当前设备。选择“系统”后，抓虾会跟随操作系统外观自动切换，支持 macOS 与 Windows。</p>
          </div>

          <div class="theme-options" role="radiogroup" aria-label="界面主题">
            <button
              v-for="option in themeOptions"
              :key="option.value"
              type="button"
              :class="['theme-option', { active: props.themePreference === option.value }]"
              role="radio"
              :aria-checked="props.themePreference === option.value"
              @click="selectTheme(option.value)"
            >
              <span :class="['theme-preview', `theme-preview-${option.value}`]" aria-hidden="true">
                <span class="theme-preview-titlebar"></span>
                <span class="theme-preview-sidebar"></span>
                <span class="theme-preview-canvas">
                  <i></i>
                  <i></i>
                  <i></i>
                </span>
              </span>
              <span class="theme-option-copy">
                <strong>{{ option.label }}</strong>
                <small>{{ option.description }}</small>
              </span>
              <span class="theme-option-check" aria-hidden="true">✓</span>
            </button>
          </div>

          <div class="appearance-note">
            <span>湖光以白色与湖水绿呈现，状态颜色和功能布局保持不变。</span>
          </div>
        </section>

        <section v-else-if="activePanelId === 'connection-overview'" key="connection-overview" class="panel">
          <div class="panel-head">
            <div>
              <p class="panel-kicker">连接</p>
              <h3>服务状态</h3><p class="panel-description">{{ activePanelDescription }}</p>
            </div>
            <span :class="['badge', props.status?.api ? 'on' : 'neutral']">
              {{ props.status?.api ? '核心就绪' : '待检查' }}
            </span>
          </div>

          <div class="status-grid">
            <article class="status-card">
              <div>
                <span>核心服务 (端口 {{ props.status?.apiPort || 18765 }})</span>
                <strong>本地 API · {{ props.status?.apiState || 'unknown' }}</strong>
              </div>
              <span :class="['badge', props.status?.api ? 'on' : 'off']">
                {{ props.status?.api ? '运行中' : '未启动' }}
              </span>
            </article>
            <article class="status-card">
              <div>
                <span>Chrome CDP (端口 {{ props.status?.cdpPort || 9222 }})</span>
                <strong>浏览器连接</strong>
              </div>
              <span :class="['badge', props.status?.chrome ? 'on' : 'neutral']">
                {{ props.status?.chrome ? '已连接' : '按需启动' }}
              </span>
            </article>
          </div>

          <div class="panel-layout">
            <div class="form-stack">
              <p v-if="backendMsg" :class="['inline-msg', backendMsgOk ? 'ok' : 'err']">{{ backendMsg }}</p>
              <p v-if="chromeMsg" :class="['inline-msg', chromeMsgOk ? 'ok' : 'err']">{{ chromeMsg }}</p>
              <p v-if="props.status?.apiDiagnostic?.lastError" class="inline-msg err">
                核心服务：{{ props.status.apiDiagnostic.lastError }}
              </p>
              <p v-if="!props.status?.chrome && ['occupied-non-cdp', 'invalid-cdp'].includes(props.status?.chromeDiagnostic?.kind)" class="inline-msg err">
                Chrome：{{ props.status.chromeDiagnostic.message }}
              </p>
              <p v-if="props.status?.dataDirRecovery?.recovered" class="inline-msg ok">
                数据目录已自动恢复到：{{ props.status.dataDirRecovery.to }}
              </p>
              <div class="action-strip">
                <button class="btn-orange" :disabled="backendRepairing" @click="doRepairBackend">
                  {{ backendRepairing ? '修复中...' : '修复核心服务' }}
                </button>
                <button class="btn-orange" :disabled="launching" @click="doLaunchChrome">
                  {{ launching ? '正在连接...' : props.status?.chrome ? '检查浏览器连接' : '启动浏览器' }}
                </button>
                <button class="btn-ghost" @click="openDiagnosticLog">打开诊断日志</button>
              </div>
            </div>
            <div class="side-note">
              <strong>连接策略</strong>
              <p>浏览器会在智能体打开网页或执行浏览器任务时自动启动，也可以在这里手动启动。核心服务和纯对话不依赖浏览器。</p><p>连接修复只处理身份确认属于抓虾的专用浏览器实例。</p>
              <p v-if="props.status?.dataDir">当前数据目录：{{ props.status.dataDir }}</p>
            </div>
          </div>
        </section>

        <section v-else-if="activePanelId === 'notify-dingtalk'" key="notify-dingtalk" class="panel">
          <div class="panel-head">
            <div>
              <p class="panel-kicker">通知</p>
              <h3>钉钉机器人</h3><p class="panel-description">{{ activePanelDescription }}</p>
            </div>
            <span :class="['badge', isFieldConfigured('notify.dingtalk_webhook') ? 'on' : 'off']">
              {{ isFieldConfigured('notify.dingtalk_webhook') ? '已配置' : '未配置' }}
            </span>
          </div>

          <div class="panel-layout">
            <div class="form-stack">
              <div class="field">
                <label for="setting-notify-dingtalk-webhook">Webhook URL</label>
                <input
                  id="setting-notify-dingtalk-webhook" v-model="cfg['notify.dingtalk_webhook']"
                  placeholder="https://oapi.dingtalk.com/robot/send?access_token=..."
                  class="input"
                />
              </div>
              <div class="field">
                <label for="setting-notify-dingtalk-secret">加签密钥（可选）</label>
                <input
                  id="setting-notify-dingtalk-secret" v-model="cfg['notify.dingtalk_secret']"
                  placeholder="SEC..."
                  class="input"
                  type="password"
                  autocomplete="off"
                />
              </div>
              <PanelActions panel-id="notify-dingtalk" @save="savePanelFromForm('notify-dingtalk')" />
            </div>
            <div class="side-note">
              <strong>保存范围</strong>
              <p>只更新钉钉 Webhook 和加签密钥，不影响飞书、自定义 Webhook 或其他设置域。</p>
              <button class="btn-ghost" :disabled="testing.dingtalk" @click="testNotify('dingtalk')">
                {{ testing.dingtalk ? '发送中...' : '发送测试消息' }}
              </button>
              <span v-if="testMsg.dingtalk" :class="['test-result', testOk.dingtalk ? 'ok' : 'err']">
                {{ testMsg.dingtalk }}
              </span>
            </div>
          </div>
        </section>

        <AutomationPermissionsPanel v-else-if="isMacOS && activePanelId === 'application-automation'" key="application-automation" />

        <section v-else-if="activePanelId === 'application-update'" key="application-update" class="panel">
          <div class="panel-head">
            <div>
              <p class="panel-kicker">应用</p>
              <h3>桌面更新</h3><p class="panel-description">{{ activePanelDescription }}</p>
            </div>
            <span :class="['badge', updateBadgeTone]">
              {{ updateBadgeLabel }}
            </span>
          </div>

          <div class="panel-layout">
            <div class="form-stack">
              <div class="readonly-grid">
                <div class="readonly-row">
                  <span>当前版本</span>
                  <strong>{{ updateStatus.currentVersion ? `v${updateStatus.currentVersion}` : '未知' }}</strong>
                </div>
                <div class="readonly-row">
                  <span>最新版本</span>
                  <strong>{{ updateStatus.latestVersion ? `v${updateStatus.latestVersion}` : '暂无' }}</strong>
                </div>
                <div class="readonly-row">
                  <span>上次检查</span>
                  <strong>{{ formattedLastCheckedAt }}</strong>
                </div>
              </div>
              <p v-if="updateStatus.error" class="inline-msg err">{{ updateStatus.error }}</p>
              <div class="action-strip">
                <button
                  class="btn-orange"
                  :disabled="updateActionBusy || updateStatus.status === 'checking'"
                  @click="requestUpdateCheck"
                >
                  {{ updateStatus.status === 'error' ? '重新检查' : '检查更新' }}
                </button>
                <button
                  v-if="showManualDownload"
                  class="btn-ghost"
                  :disabled="updateActionBusy"
                  @click="openManualDownload"
                >
                  手动下载安装包
                </button>
              </div>
            </div>
            <div class="side-note">
              <strong>更新控制</strong>
              <p>这里仅显示桌面更新状态并触发检查；下载和安装控制保留在侧边栏底部。</p>
              <p v-if="updateStatus.status === 'disabled'">当前环境不支持自动桌面更新时，可使用官方 Release 页面手动下载。</p>
            </div>
          </div>
        </section>

        <section v-else-if="activePanelId === 'notify-feishu'" key="notify-feishu" class="panel">
          <div class="panel-head">
            <div>
              <p class="panel-kicker">通知</p>
              <h3>飞书机器人</h3><p class="panel-description">{{ activePanelDescription }}</p>
            </div>
            <span :class="['badge', isFieldConfigured('notify.feishu_webhook') ? 'on' : 'off']">
              {{ isFieldConfigured('notify.feishu_webhook') ? '已配置' : '未配置' }}
            </span>
          </div>

          <div class="panel-layout">
            <div class="form-stack">
              <div class="field">
                <label for="setting-notify-feishu-webhook">Webhook URL</label>
                <input
                  id="setting-notify-feishu-webhook" v-model="cfg['notify.feishu_webhook']"
                  placeholder="https://open.feishu.cn/open-apis/bot/v2/hook/..."
                  class="input"
                />
              </div>
              <PanelActions panel-id="notify-feishu" @save="savePanelFromForm('notify-feishu')" />
            </div>
            <div class="side-note">
              <strong>保存范围</strong>
              <p>只更新飞书 Webhook，其他通知渠道保持当前保存状态。</p>
              <button class="btn-ghost" :disabled="testing.feishu" @click="testNotify('feishu')">
                {{ testing.feishu ? '发送中...' : '发送测试消息' }}
              </button>
              <span v-if="testMsg.feishu" :class="['test-result', testOk.feishu ? 'ok' : 'err']">
                {{ testMsg.feishu }}
              </span>
            </div>
          </div>
        </section>

        <section v-else-if="activePanelId === 'notify-custom'" key="notify-custom" class="panel">
          <div class="panel-head">
            <div>
              <p class="panel-kicker">通知</p>
              <h3>自定义 Webhook</h3><p class="panel-description">{{ activePanelDescription }}</p>
            </div>
            <span :class="['badge', isFieldConfigured('notify.custom_webhook') ? 'on' : 'off']">
              {{ isFieldConfigured('notify.custom_webhook') ? '已配置' : '未配置' }}
            </span>
          </div>

          <div class="panel-layout">
            <div class="form-stack">
              <div class="field">
                <label for="setting-notify-custom-webhook">Webhook URL（POST JSON）</label>
                <input
                  id="setting-notify-custom-webhook" v-model="cfg['notify.custom_webhook']"
                  placeholder="https://your-server/hook"
                  class="input"
                />
              </div>
              <PanelActions panel-id="notify-custom" @save="savePanelFromForm('notify-custom')" />
            </div>
            <div class="side-note">
              <strong>保存范围</strong>
              <p>只更新自定义 Webhook 地址，适合接入内部转发服务或其他消息网关。</p>
              <button class="btn-ghost" :disabled="testing.webhook" @click="testNotify('webhook')">
                {{ testing.webhook ? '发送中...' : '发送测试消息' }}
              </button>
              <span v-if="testMsg.webhook" :class="['test-result', testOk.webhook ? 'ok' : 'err']">
                {{ testMsg.webhook }}
              </span>
            </div>
          </div>
        </section>

        <section v-else-if="activePanelId === 'notify-guide'" key="notify-guide" class="panel">
          <div class="panel-head">
            <div>
              <p class="panel-kicker">通知</p>
              <h3>脚本调用说明</h3><p class="panel-description">{{ activePanelDescription }}</p>
            </div>
            <span class="badge neutral">只读</span>
          </div>
          <div class="guide-grid">
            <div class="guide-block">
              <p class="guide-title">manifest.yaml</p>
              <pre class="guide-code">output:
  - type: excel
    filename: "结果_{date}.xlsx"
  - type: notify
    channel: dingtalk
    condition: "data.length > 0"</pre>
            </div>
            <div class="guide-block">
              <p class="guide-title">脚本 meta</p>
              <pre class="guide-code">return {
  success: true,
  data: violations,
  meta: {
    has_more: false,
    notify_title: `破价 ${violations.length} 个`,
    notify_body: violations.map(v => v['SKU ID']).join(', ')
  }
}</pre>
            </div>
          </div>
        </section>

        <section v-else-if="activePanelId === 'storage-archived'" key="storage-archived" class="panel archive-panel">
          <div class="panel-head">
            <div><p class="panel-kicker">存储</p><h3>已归档会话</h3><p class="panel-description">{{ activePanelDescription }}</p></div>
            <button class="btn-ghost" :disabled="archiveLoading || !!archiveRestoring" @click="loadArchivedSessions">{{ archiveLoading ? '加载中…' : '刷新' }}</button>
          </div>
          <p>归档会话的聊天记录会保留。恢复后，会话将重新出现在侧边栏中。</p>
          <input v-model="archiveQuery" class="input" placeholder="搜索会话标题或 ID" aria-label="搜索已归档会话" />
          <p v-if="archiveError" role="alert">{{ archiveError }}</p>
          <p v-if="archiveNotice" class="archive-notice" role="status">{{ archiveNotice }}</p>
          <p v-if="archiveLoading">正在加载已归档会话…</p>
          <p v-else-if="!archiveError && !filteredArchivedSessions.length">{{ archiveQuery.trim() ? '没有匹配的已归档会话' : '暂无已归档会话' }}</p>
          <div v-for="session in pagedArchivedSessions" :key="session.id" class="archived-session-row">
            <div class="archived-session-info"><strong :title="session.title">{{ session.title }}</strong><div class="archive-meta"><time :datetime="archiveTime(session.updatedAt).iso" :title="archiveTime(session.updatedAt).full">最近活动 {{ archiveTime(session.updatedAt).short }}</time><small :title="session.id">{{ session.id }}</small></div></div>
            <button class="btn-ghost" :disabled="archiveLoading || !!archiveRestoring" @click="restoreArchivedSession(session.id)">{{ archiveRestoring === session.id ? '恢复中…' : '恢复会话' }}</button>
          </div>
          <nav v-if="filteredArchivedSessions.length" class="archive-pagination" aria-label="归档会话分页">
            <span>共 {{ filteredArchivedSessions.length }} 条 · 每页 {{ archivePageSize }} 条</span>
            <div>
              <button class="btn-ghost" :disabled="archivePage <= 1 || archiveLoading || !!archiveRestoring" @click="archivePage--">上一页</button>
              <span aria-live="polite">{{ archivePage }} / {{ archivePageCount }}</span>
              <button class="btn-ghost" :disabled="archivePage >= archivePageCount || archiveLoading || !!archiveRestoring" @click="archivePage++">下一页</button>
            </div>
          </nav>
        </section>

        <section v-else-if="activePanelId === 'storage-data'" key="storage-data" class="panel">
          <div class="panel-head">
            <div>
              <p class="panel-kicker">存储</p>
              <h3>数据目录</h3><p class="panel-description">{{ activePanelDescription }}</p>
            </div>
            <span class="badge neutral">本机</span>
          </div>

          <div class="panel-layout">
            <div class="form-stack">
              <div class="field">
                <label for="setting-data-dir">数据目录 (CRAWSHRIMP_DATA)</label>
                <div class="input-row">
                  <input id="setting-data-dir" v-model="cfg['data_dir']" placeholder="默认自动选择可写目录" class="input" />
                  <button class="btn-ghost" @click="browseDir">选择</button>
                </div>
              </div>
              <PanelActions panel-id="storage-data" @save="savePanelFromForm('storage-data')" />
            </div>
            <div class="side-note path-note">
              <strong>当前目录</strong>
              <p>{{ cfg['data_dir'] || '默认运行时目录' }}</p>
            </div>
          </div>
        </section>

        <section v-else-if="activePanelId === 'sync-odps'" key="sync-odps" class="panel">
          <div class="panel-head">
            <div>
              <p class="panel-kicker">数据同步</p>
              <h3>ODPS 写入接口</h3><p class="panel-description">{{ activePanelDescription }}</p>
            </div>
            <span :class="['badge', isFieldConfigured('odps.app_code') ? 'on' : 'off']">
              {{ isFieldConfigured('odps.app_code') ? '已配置' : '未配置' }}
            </span>
          </div>

          <div class="panel-layout">
            <div class="form-stack">
              <div class="field">
                <label for="setting-odps-app-code">ODPS AppCode</label>
                <input
                  id="setting-odps-app-code" v-model="cfg['odps.app_code']"
                  placeholder="用于 Authorization: APPCODE ..."
                  class="input"
                  type="password"
                  autocomplete="off"
                />
              </div>
              <PanelActions panel-id="sync-odps" @save="savePanelFromForm('sync-odps')" />
            </div>
            <div class="side-note">
              <strong>同步出口</strong>
              <p>任务输出文件和「数据文件」页会读取这个 AppCode 进行 ODPS 同步。</p>
            </div>
          </div>
        </section>

        <section v-else-if="activePanelId === 'ai-1xm'" key="ai-1xm" class="panel">
          <div class="panel-head">
            <div>
              <p class="panel-kicker">AI 生图</p>
              <h3>图片模型</h3><p class="panel-description">{{ activePanelDescription }}</p>
            </div>
            <span :class="['badge', isImageServiceConfigured ? 'on' : 'off']">
              {{ isImageServiceConfigured ? '已配置' : '未配置' }}
            </span>
          </div>

          <ImageProviderSettings :config="cfg" :save="saveImageProviderConfig" />

        </section>

        <section v-else-if="activePanelId === 'ai-agent'" key="ai-agent" class="panel">
          <div class="panel-head">
            <div>
              <p class="panel-kicker">AI 能力</p>
              <h3>智能体运行时</h3><p class="panel-description">{{ activePanelDescription }}</p>
            </div>
            <span :class="['badge', agentRuntime.state === 'ready' ? 'on' : agentRuntime.state === 'needs_configuration' ? 'neutral' : 'off']">
              {{ agentRuntimeLabel }}
            </span>
          </div>

          <div class="panel-layout">
            <div class="form-stack">
              <div class="field">
                <label>运行状态</label>
                <div class="key-states">
                  <span :class="['key-pill', agentRuntime.state === 'ready' ? 'on' : 'off']">运行时</span>
                  <span :class="['key-pill', agentRuntime.api_key_configured ? 'on' : 'off']">API Key</span>
                  <span class="key-pill neutral">模型 {{ agentRuntime.model || '—' }}</span>
                </div>
                <p class="field-hint">状态:{{ agentRuntime.state || '—' }} · 代次 {{ agentRuntime.generation }}<span v-if="agentRuntime.error"> · {{ agentRuntime.error }}</span></p>
                <p v-if="agentRuntime.web_verified" class="field-hint">嵌入式 Web 会话已认证（启动地址不会显示）。</p>
              </div>
              <div class="field">
                <label>操作</label>
                <div class="agent-op-row">
                  <button class="btn-ghost" type="button" :disabled="Boolean(agentBusy)" @click="onAgentRestartRuntime">
                    {{ agentBusy === 'runtime' ? '重启中…' : '重启智能体运行时' }}
                  </button>
                  <button class="btn-ghost" type="button" :disabled="Boolean(agentBusy)" @click="onAgentRepairCore">
                    {{ agentBusy === 'core' ? '修复中…' : '修复核心服务' }}
                  </button>
                  <button class="btn-danger" type="button" :disabled="Boolean(agentBusy)" @click="onAgentClearData">
                    清除智能体数据
                  </button>
                </div>
                <p class="field-hint">重启运行时保留会话历史;修复核心服务重启本地后端;清除数据会清空会话历史/审批记录/草稿(不影响已执行任务与产物),需确认。</p>
              </div>
              <div v-if="agentNotice" class="agent-notice">{{ agentNotice }}</div>
            </div>
            <div class="side-note">
              <strong>说明</strong>
              <p>智能体会话界面带自动恢复:运行中掉线会静默自愈。这里提供手动诊断与重置入口。</p>
            </div>
          </div>
        </section>

        <section v-else-if="activePanelId === 'ai-llm'" key="ai-llm" class="panel">
          <div class="panel-head">
            <div>
              <p class="panel-kicker">AI 文本与多模态</p>
              <h3>文本模型</h3><p class="panel-description">{{ activePanelDescription }}</p>
            </div>
            <span :class="['badge', isTextServiceConfigured ? 'on' : 'off']">
              {{ isTextServiceConfigured ? '已配置' : '未配置' }}
            </span>
          </div>

          <div class="form-stack">
            <p class="field-hint">官方模型目录与使用权限随账号实时同步。<button class="btn-ghost compact" type="button" :disabled="refreshingOfficialModels" @click="refreshOfficialModels">{{ refreshingOfficialModels ? '同步中…' : '刷新目录' }}</button><button class="btn-ghost compact" type="button" @click="focusPanel('account')">查看模型权限与会员</button></p>
            <div class="llm-list-toolbar model-provider-toolbar">
              <p>
                各服务商独立保存连接地址与密钥。已配置的森马共享密钥可继续使用。
              </p>
              <button class="btn-orange compact" type="button" @click="openLlmProviderModal()">
                添加服务商
              </button>
            </div>

            <p v-if="officialCatalogError" class="inline-msg err" role="alert">{{ officialCatalogError }}</p>
            <div class="llm-provider-list model-provider-list" aria-label="文本模型服务商列表">
              <article v-for="provider in llmProviders" :key="provider.id" class="llm-provider-row model-provider-row">
                <div class="llm-provider-content model-provider-content">
                  <button
                    :class="['llm-provider-logo', 'model-provider-logo', `brand-${provider.brand}`, { 'with-image': provider.logoImage && !failedProviderLogos[provider.id] }]"
                    :title="provider.name"
                    :aria-label="`编辑 ${provider.name}`"
                    type="button"
                    @click="openLlmProviderModal(provider.id)"
                  >
                    <img
                      v-if="provider.logoImage && !failedProviderLogos[provider.id]"
                      :src="provider.logoImage"
                      alt=""
                      @error="failedProviderLogos[provider.id] = true"
                    />
                    <span v-else>{{ provider.logoText }}</span>
                  </button>
                  <div class="llm-provider-main model-provider-main">
                    <div class="llm-row-title model-provider-heading">
                      <button
                        class="llm-provider-title-button model-provider-name"
                        type="button"
                        @click="openLlmProviderModal(provider.id)"
                      >
                        {{ provider.id.startsWith('crawshrimp-managed-') ? '抓虾官方模型服务' : provider.name }}
                      </button>
                      <span :class="['key-pill', provider.configured ? 'on' : 'off']">
                        {{ provider.id.startsWith('crawshrimp-managed-') ? '账号已连接' : provider.configured ? '已配 Key' : '未配 Key' }}
                      </span>
                      <span class="key-pill neutral">{{ provider.compatibility }}</span>
                      <span v-if="provider.isCustom" class="key-pill neutral">自定义</span>
                      <span v-if="provider.isDefault" class="key-pill on">默认</span>
                    </div>
                    <p>{{ provider.baseUrl || '未填写 Base URL' }}</p>
                    <div class="llm-model-preview model-provider-models">
                      <span v-for="model in provider.previewModels" :key="model" class="chip">{{ model }}</span>
                      <span v-if="provider.modelCount > provider.previewModels.length" class="chip muted">
                        +{{ provider.modelCount - provider.previewModels.length }}
                      </span>
                    </div>
                  </div>
                </div>
                <div class="llm-row-actions model-provider-actions">
                  <span class="llm-row-meta">{{ provider.modelCount }} 个模型</span>
                  <button
                    v-if="!provider.isDefault && provider.firstModel"
                    class="btn-ghost compact"
                    type="button"
                    @click="setLlmDefaultModel(provider.firstModel, provider.id)"
                  >
                    设为默认
                  </button>
                  <button class="btn-ghost compact" type="button" @click="openLlmProviderModal(provider.id)">
                    编辑
                  </button>
                  <button
                    v-if="provider.isCustom"
                    class="btn-danger compact"
                    type="button"
                    @click="removeCustomLlmProvider(provider.id)"
                  >
                    删除
                  </button>
                </div>
              </article>
            </div>

            <PanelActions panel-id="ai-llm" @save="savePanelFromForm('ai-llm')" />
          </div>
        </section>

        <section v-else-if="activePanelId === 'ai-video'" key="ai-video" class="panel">
          <div class="panel-head"><div><h3>视频模型</h3><p class="panel-description">按服务商管理视频生成连接与素材上传配置。</p></div><span :class="['badge', hasAnyFieldConfigured(['ai.video.seedance_api_key', 'ai.video.bailian_api_key']) ? 'on' : 'neutral']">{{ hasAnyFieldConfigured(['ai.video.seedance_api_key', 'ai.video.bailian_api_key']) ? '已配置' : '未配置' }}</span></div>
          <VideoProviderSettings :config="cfg" :save="saveVideoProviderConfig" />
        </section>

        <NativeRuntimePanel v-else-if="activePanelId === 'plugins'" panel="plugins" :theme="props.effectiveTheme" :theme-preference="props.themePreference" />
        <AccountPanel v-else-if="activePanelId === 'account'" key="account" @login="emit('login')" @navigate="focusPanel" @catalog-updated="refreshManagedProviders" />
        <UsagePanel v-if="usagePanelMountedOnce" v-show="activePanelId === 'account-usage'" :active="activePanelId === 'account-usage'" />
        <!-- Keep the authenticated IM iframe mounted while switching panels. -->
        <section
          v-if="imSettingsPanelMountedOnce"
          v-show="activePanelId === 'im-bots'"
          key="im-bots"
          class="panel im-panel"
        >
          <div class="panel-head">
            <div>
              <p class="panel-kicker">IM机器人</p>
              <h3>机器人接入</h3><p class="panel-description">{{ activePanelDescription }}</p>
            </div>
            <span :class="['badge', agentRuntime.state === 'ready' ? 'on' : 'neutral']">
              {{ agentRuntime.state === 'ready' ? '服务常驻' : agentRuntimeLabel }}
            </span>
          </div>

          <div class="im-safety-strip" aria-label="IM 安全策略">
            <span><i aria-hidden="true"></i>仅接受渠道可信用户</span>
            <span><i aria-hidden="true"></i>工作区范围已锁定</span>
            <span><i aria-hidden="true"></i>远程审批默认关闭</span>
          </div>

          <div v-if="imSettingsUrl" class="im-settings-shell">
            <div v-if="!imSettingsReady" class="im-settings-loading" role="status" aria-live="polite">
              <span class="im-settings-loading-spinner" aria-hidden="true"></span>
              <strong>正在载入机器人渠道</strong>
              <p>正在准备接入页面，请稍候…</p>
            </div>
            <iframe
              ref="imSettingsFrame"
              :key="imSettingsUrl"
              :class="['im-settings-frame', { 'is-ready': imSettingsReady }]"
              :src="imSettingsUrl"
              title="抓虾 IM机器人设置"
              allow="clipboard-read; clipboard-write"
              :aria-hidden="imSettingsReady ? 'false' : 'true'"
              @load="onImSettingsFrameLoad"
            />
          </div>
          <div v-else class="im-runtime-placeholder">
            <strong>正在启动 IM 常驻服务</strong>
            <p>IM机器人随抓虾核心服务启动；首次准备运行时可能需要一些时间。</p>
            <button class="btn-orange" type="button" :disabled="Boolean(agentBusy)" @click="onAgentRestartRuntime">
              {{ agentBusy === 'runtime' ? '启动中…' : '重新启动 IM 服务' }}
            </button>
            <p v-if="agentRuntime.error" class="inline-msg err">{{ agentRuntime.error }}</p>
          </div>
        </section>
      </main>
    </div>

    <Teleport to="body">
      <dialog v-if="llmProviderModal.open" ref="llmProviderDialog" class="settings-modal llm-provider-modal model-config-dialog" :class="{ 'editing-models': llmProviderModal.tab === 'models' }" @cancel.prevent="closeLlmProviderModal" @click.self="closeLlmProviderModal" @keydown.tab="trapLlmProviderFocus" aria-labelledby="llm-provider-modal-title">
          <header class="settings-modal-head model-config-header">
            <div class="llm-editor-heading"><span class="llm-editor-mark" aria-hidden="true"><IconPlug :size="23" /></span><div><h3 id="llm-provider-modal-title">{{ llmProviderModal.isNew ? '添加文本模型服务' : llmProviderDraft.name }}</h3><p>配置服务连接，管理可用模型。</p></div></div>
            <button class="btn-ghost compact" type="button" aria-label="关闭文本模型配置" @click="closeLlmProviderModal"><IconX :size="18" /></button>
          </header>

          <nav class="llm-provider-tabs" role="tablist" aria-label="文本模型服务商配置">
            <button id="llm-connection-tab" type="button" role="tab" :aria-selected="llmProviderModal.tab === 'connection'" aria-controls="llm-connection-panel" :tabindex="llmProviderModal.tab === 'connection' ? 0 : -1"
              @click="llmProviderModal.tab = 'connection'" @keydown.right.prevent="switchLlmProviderTab('models')"><IconPlug :size="16" />连接配置</button>
            <button id="llm-models-tab" type="button" role="tab" :aria-selected="llmProviderModal.tab === 'models'" aria-controls="llm-models-panel" :tabindex="llmProviderModal.tab === 'models' ? 0 : -1"
              @click="llmProviderModal.tab = 'models'" @keydown.left.prevent="switchLlmProviderTab('connection')"><IconRobot :size="16" />模型管理 <span>{{ llmProviderDraft.models.length }}</span></button>
          </nav>

          <div class="settings-modal-body model-config-body">
            <section v-show="llmProviderModal.tab === 'connection'" id="llm-connection-panel" class="llm-connection-panel" role="tabpanel" aria-labelledby="llm-connection-tab">
            <div class="llm-section-intro"><h4>服务信息</h4><p>选择服务商使用的接口协议。</p></div>
            <div class="split-fields">
              <div class="field">
                <label for="llm-provider-name">服务商名称</label>
                <input
                  id="llm-provider-name" v-model="llmProviderDraft.name"
                  class="input"
                  :readonly="llmProviderModal.isBuiltin"
                  placeholder="例如：OpenRouter、团队模型服务"
                />
              </div>
              <div class="field">
                <label for="llm-provider-protocol">兼容协议</label>
                <select id="llm-provider-protocol" v-model="llmProviderDraft.protocol" class="select" :disabled="llmProviderModal.isBuiltin">
                  <option value="openai">OpenAI Chat Completions</option>
                  <option value="openai-responses">OpenAI Responses（ModelJetty GPT）</option>
                  <option value="anthropic">Anthropic 兼容</option>
                </select>
              </div>
            </div>

            <div class="llm-section-intro llm-section-divider"><h4>连接凭据</h4><p>填写服务商提供的地址与 API Key。</p></div>
            <div class="field">
              <label for="llm-provider-baseurl">服务地址 <span class="llm-field-alias">Base URL</span></label>
              <input id="llm-provider-baseurl" v-model="llmProviderDraft.baseUrl" class="input" placeholder="https://api.example.com/v1" />
              <p class="field-hint">使用服务商提供的完整 Base URL。</p>
            </div>

            <div class="field">
              <label for="llm-provider-apikey">API Key</label>
              <input
                id="llm-provider-apikey" v-model="llmProviderDraft.apiKey"
                class="input"
                type="password"
                autocomplete="new-password"
                placeholder="留空保持当前 Key；输入新值会覆盖"
                @focus="selectInputText"
              />
              <p class="field-hint">{{ llmProviderDraft.configured ? '已保存密钥。留空保留，填写新值可替换。' : '密钥仅保存在此设备，保存后不再显示明文。' }}</p>
            </div>

            <section
              v-if="llmProviderModal.providerId === 'crawshrimp-deepseek-official'"
              class="key-reset-guide"
              aria-label="重置 DeepSeek API Key 教程"
            >
              <div class="llm-provider-head">
                <strong>重置或更换 Key</strong>
                <button class="inline-link-btn" type="button" @click="openDeepSeekPlatform">
                  <IconExternalLink :size="14" :stroke-width="2.1" aria-hidden="true" />
                  <span>获取 Key</span>
                </button>
              </div>
              <ol>
                <li>在 DeepSeek 官方平台创建新的 API Key。</li>
                <li>回到这里，把新 Key 粘贴到“API Key”。</li>
                <li>点击“保存服务商”；旧 Key 会被覆盖，保存后只显示“已配 Key”。</li>
              </ol>
            </section>
            </section>

            <section v-show="llmProviderModal.tab === 'models'" id="llm-models-panel" class="llm-models-panel" role="tabpanel" aria-labelledby="llm-models-tab">
              <div class="llm-model-toolbar">
                <div>
                  <h4>模型管理</h4>
                  <p class="field-hint">选择左侧模型，编辑右侧参数。所有模型共用此服务商的连接配置。</p>
                </div>
                <div class="llm-model-toolbar-actions">
                  <button v-if="canDiscoverLlmModels" class="btn-ghost compact" type="button" :disabled="llmProviderModal.discovering || llmProviderModal.saving" @click="discoverLlmModels">{{ llmProviderModal.discovering ? '获取中…' : '获取最新模型' }}</button>
                  <button v-if="llmProviderModal.isBuiltin" class="btn-ghost compact" type="button" @click="restoreLlmPresetModels">恢复预设模型</button>
                </div>
              </div>

              <p v-if="llmProviderModal.discoveryError" class="inline-msg err">{{ llmProviderModal.discoveryError }}</p>
              <section v-if="llmProviderModal.discoveredModels.length" class="llm-model-discovery" aria-label="获取到的模型">
                <div class="llm-model-editor-head">
                  <strong>获取到 {{ llmProviderModal.discoveredModels.length }} 个模型</strong>
                  <button class="btn-ghost compact" type="button" :disabled="!llmProviderModal.selectedDiscoveredIds.length" @click="addDiscoveredLlmModels">添加所选模型</button>
                </div>
                <p class="field-hint">{{ llmProviderModal.discoveryNotice }} <a :href="llmProviderModal.discoverySourceUrl" target="_blank" rel="noopener noreferrer">查看来源</a></p>
                <div class="llm-discovered-models">
                  <label v-for="model in llmProviderModal.discoveredModels" :key="model.id">
                    <input v-model="llmProviderModal.selectedDiscoveredIds" type="checkbox" :value="model.id" :disabled="llmProviderDraft.models.some(item => item.id === model.id)" />
                    {{ model.label || model.id }}<span v-if="llmProviderDraft.models.some(item => item.id === model.id)">（已添加）</span>
                  </label>
                </div>
              </section>

              <div class="llm-model-add-row">
                <input v-model="llmProviderModal.newModelId" class="input" aria-label="新增模型 ID" placeholder="输入模型 ID，例如 gpt-6.1-sol" @keydown.enter.prevent="addLlmDraftModel" />
                <button class="btn-orange compact" type="button" :disabled="!llmProviderModal.newModelId.trim()" @click="addLlmDraftModel">新增模型</button>
              </div>

              <div class="llm-model-workspace">
                <aside class="llm-model-sidebar" aria-label="已添加模型">
                  <p class="llm-model-list-caption">已添加模型 · {{ llmProviderDraft.models.length }}</p>
                  <div class="llm-model-list">
                    <button v-for="model in llmProviderDraft.models" :key="model.id" type="button" :class="['llm-model-list-item', { active: selectedLlmDraftModel?.id === model.id }]" :aria-pressed="selectedLlmDraftModel?.id === model.id" :aria-label="`配置模型 ${model.id}`" @click="llmProviderModal.selectedModelId = model.id">
                      <strong>{{ model.label || model.id }}</strong><span>{{ model.id }}</span>
                    </button>
                    <p v-if="!llmProviderDraft.models.length" class="field-hint llm-model-list-empty">尚未添加模型</p>
                  </div>
                </aside>

                <section v-if="selectedLlmDraftModel" class="llm-model-detail" aria-label="模型参数">
                  <header class="llm-model-detail-head">
                    <div><h4>{{ selectedLlmDraftModel.label || selectedLlmDraftModel.id }}</h4><p>{{ selectedLlmDraftModel.id }}</p></div>
                    <button class="btn-danger compact" type="button" :aria-label="`删除模型 ${selectedLlmDraftModel.id}`" @click="removeLlmDraftModel(selectedLlmDraftModel.id)">删除模型</button>
                  </header>

                  <div class="llm-model-details-grid">
                    <label class="field">模型名称<input v-model="selectedLlmDraftModel.label" class="input" :aria-label="`${selectedLlmDraftModel.id} 模型名称`" /></label>
                    <label class="field">模型 ID<input :value="selectedLlmDraftModel.id" class="input" :aria-label="`${selectedLlmDraftModel.id} 模型 ID`" @change="renameLlmDraftModel(selectedLlmDraftModel.id, $event.target)" /></label>
                    <label class="field">上下文（tokens）<input v-model.number="selectedLlmDraftModel.context_window" class="input" type="number" min="1" step="1" :aria-label="`${selectedLlmDraftModel.id} 上下文 tokens`" /></label>
                    <label class="field">输出上限（tokens）<input v-model.number="selectedLlmDraftModel.max_output_tokens" class="input" type="number" min="1" step="1" :aria-label="`${selectedLlmDraftModel.id} 输出上限 tokens`" /></label>
                  </div>

                  <div v-if="llmProviderDraft.protocol === 'openai'" class="field llm-model-reasoning-field">
                    <label :for="`reasoning-${selectedLlmDraftModel.id}`">推理设置</label>
                    <select :id="`reasoning-${selectedLlmDraftModel.id}`" :value="selectedLlmDraftModel.reasoning_protocol || (isLlmPresetModel(selectedLlmDraftModel.id) ? 'inherit' : 'default')" class="select" :aria-label="`${selectedLlmDraftModel.id} 推理协议`" @change="selectedLlmDraftModel.reasoning_protocol = $event.target.value; selectedLlmDraftModel.reasoning_efforts = []">
                      <option v-if="isLlmPresetModel(selectedLlmDraftModel.id)" value="inherit">沿用预设推理设置</option><option value="default">默认（不传推理参数）</option><option value="deepseek">DeepSeek 推理协议</option><option value="openai">OpenAI reasoning_effort</option>
                    </select>
                    <fieldset v-if="['deepseek', 'openai'].includes(selectedLlmDraftModel.reasoning_protocol)" class="llm-model-reasoning-levels"><legend>支持的推理等级</legend>
                      <label v-for="level in (selectedLlmDraftModel.reasoning_protocol === 'deepseek' ? ['off', 'low', 'medium', 'high', 'xhigh', 'max'] : ['low', 'medium', 'high', 'xhigh', 'max'])" :key="level"><input v-model="selectedLlmDraftModel.reasoning_efforts" type="checkbox" :value="level" :aria-label="`${selectedLlmDraftModel.id} 推理等级 ${level}`" />{{ level === 'off' ? 'Off' : level }}</label>
                    </fieldset>
                    <p class="field-hint">只选择供应商支持的协议和档位。新模型的上下文和输出额度请核对后设置。</p>
                  </div>
                </section>
                <div v-else class="llm-model-detail llm-model-empty"><h4>添加第一个模型</h4><p class="field-hint">在上方输入模型 ID，或获取最新模型后选择添加。</p></div>
              </div>

              <details class="llm-batch-models"><summary>批量编辑模型 ID</summary><textarea v-model="llmProviderDraft.modelsText" class="textarea" rows="4" aria-label="批量模型 ID" placeholder="每行一个模型 ID"></textarea><p class="field-hint">每行一个模型 ID；移除一行即可删除。清空列表会停用此 Provider 的全部模型。</p></details>
            </section>

            <p v-if="llmProviderModal.error" class="inline-msg err" role="alert">{{ llmProviderModal.error }}</p>
          </div>

          <footer class="settings-modal-actions model-config-footer">
            <button class="btn-ghost" type="button" :disabled="llmProviderModal.saving" @click="closeLlmProviderModal">取消</button>
            <button class="btn-orange" type="button" :disabled="llmProviderModal.saving" @click="applyLlmProviderDraft">
              {{ llmProviderModal.saving ? '保存中...' : '保存服务商' }}
            </button>
          </footer>
      </dialog>
    </Teleport>
  </div>
</template>

<script setup>
import NativeRuntimePanel from '../components/NativeRuntimePanel.vue'
import modeljettyLogoUrl from '../assets/modeljetty-mark.svg'
import crawshrimpLogoUrl from '../../../assets/branding/crawshrimp-avatar-C1.png'
import { useNativeDialog } from '../composables/useNativeDialog'
import { MODELJETTY_LLM_PRESETS } from '../utils/modeljettyPresets.mjs'
import { requestArchivedSessions } from '../utils/archivedSessions.mjs'
import { IconArrowLeft, IconSearch, IconUser, IconGauge, IconPalette, IconBell, IconPlug, IconDatabase, IconArchive, IconRefresh, IconRobot, IconMessage, IconPhoto, IconVideo, IconShield, IconCode, IconCloud, IconInfoCircle, IconX, IconPuzzle } from '@tabler/icons-vue'
import { computed, defineComponent, h, nextTick, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import UsagePanel from '../components/UsagePanel.vue'
import AccountPanel from '../components/AccountPanel.vue'
import AutomationPermissionsPanel from '../components/AutomationPermissionsPanel.vue'
import { IconExternalLink } from '@tabler/icons-vue'
import ImageProviderSettings from '../components/ImageProviderSettings.vue'
import VideoProviderSettings from '../components/VideoProviderSettings.vue'
import { configureAiImageProviders, CUSTOM_IMAGE_PROVIDERS_FIELD } from '../utils/aiImageModels.js'
import {
  AI_VIDEO_CREDENTIAL_FIELDS,
  AI_VIDEO_MASKED_CREDENTIAL_VALUE,
  AI_VIDEO_WRITE_ONLY_FIELDS,
  buildWriteOnlyAiVideoPatch,
  clearWrittenAiVideoFields,
  isAiVideoCredentialConfigured,
} from '../utils/aiVideoSettings.mjs'
import {
  LLM_API_KEY_FIELD,
  LLM_BUILTIN_PROVIDERS,
  LLM_CREDENTIAL_FIELDS,
  LLM_CUSTOM_PROVIDERS_FIELD,
  LLM_BUILTIN_PROVIDER_MODELS_FIELD,
  normalizeBuiltinProviderModels,
  builtinLlmProviderModels,
  builtinLlmProviderModelIds,
  DEEPSEEK_PLATFORM_URL,
  LLM_DEFAULTS,
  normalizeDeepSeekModelId,
  LLM_MASKED_CREDENTIAL_VALUE,
  LLM_PANEL_FIELDS,
  buildLlmSettingsPatch,
  clearWrittenLlmSettings,
  isLlmConfigured,
  llmProviderConfigured,
  normalizeCustomLlmProviders,
  normalizeLlmProtocol,
  mergeCustomLlmModelDraft,
  mergeDiscoveredLlmModels,
  customLlmBudgetError,
} from '../utils/llmSettings.mjs'
// Keep provider branding available even when a running renderer outlives a build's asset files.
import deepseekLogoUrl from '../assets/llm-providers/deepseek-logo.png?inline'
import semirLogoUrl from '../assets/llm-providers/semir-logo.png?inline'

const OFFICIAL_RELEASE_URL = 'https://github.com/howtimeschange/crawshrimp-harness/releases/latest'

const props = defineProps([
  'status',
  'focusPanelId',
  'focusRequestId',
  'updateStatus',
  'updateActionBusy',
  'themePreference',
  'effectiveTheme',
])
const emit = defineEmits(['back', 'runtime-refresh', 'check-update', 'theme-change', 'login'])

const agentRuntime = ref({ state: 'unknown', generation: 0, model: '', web_origin: '', web_verified: false, api_key_configured: false, error: '' })
const agentBusy = ref('')
const agentNotice = ref('')
const imSettingsFrame = ref(null)
const imSettingsReady = ref(false)
const agentRuntimeLabel = computed(() => {
  const state = String(agentRuntime.value?.state || '')
  if (state === 'ready') return '就绪'
  if (state === 'needs_configuration') return '待配置'
  if (state === 'crashed') return '异常'
  if (state === 'stopped') return '已停止'
  return '启动中'
})
const imSettingsUrl = computed(() => {
  // AgentWebView is persistent and consumes the one-time launch URL.  This
  // settings frame shares the renderer's authenticated loopback cookie, so it
  // must use only the origin and never copy the token into its own URL.
  const raw = String(agentRuntime.value?.web_origin || '').trim()
  if (!raw || agentRuntime.value?.state !== 'ready') return ''
  try {
    const url = new URL(raw)
    url.searchParams.set('csImSettings', '1')
    const generation = Number(agentRuntime.value?.generation || 0)
    if (Number.isFinite(generation) && generation > 0) {
      url.searchParams.set('csRuntimeGeneration', String(Math.trunc(generation)))
    }
    return url.href
  } catch {
    return ''
  }
})

function onImSettingsFrameLoad(event) {
  const frameWindow = event?.target?.contentWindow || imSettingsFrame.value?.contentWindow
  if (!frameWindow || !imSettingsUrl.value) return
  try {
    frameWindow.postMessage({ __crawshrimp: 'theme', theme: props.effectiveTheme, skin: props.themePreference === 'lake' ? 'lake' : 'default' }, new URL(imSettingsUrl.value).origin)
  } catch {
    // Runtime may have restarted between iframe load and message delivery.
  }
}

function onImSettingsMessage(event) {
  const frameWindow = imSettingsFrame.value?.contentWindow
  if (!frameWindow || event.source !== frameWindow || !imSettingsUrl.value) return
  try {
    if (event.origin !== new URL(imSettingsUrl.value).origin) return
  } catch {
    return
  }
  if (event.data?.__crawshrimp === 'im-settings-ready') { imSettingsReady.value = true; onImSettingsFrameLoad() }
  if (event.data?.__crawshrimp === 'workspace-ready') onImSettingsFrameLoad()
}

async function refreshAgentRuntime() {
  try {
    agentRuntime.value = await window.cs.agentApi('GET', '/agent/runtime')
  } catch {
    agentRuntime.value = { state: 'offline', generation: 0, model: '', web_origin: '', web_verified: false, api_key_configured: false, error: '后端不可达' }
  }
}

async function onAgentRestartRuntime() {
  agentBusy.value = 'runtime'
  agentNotice.value = ''
  try {
    const result = await window.cs.agentApi('POST', '/agent/runtime/restart')
    agentNotice.value = result?.ok ? '智能体运行时已重启。' : `重启失败:${result?.error || ''}`
  } catch (error) {
    agentNotice.value = `重启失败:${error?.message || error}`
  } finally {
    agentBusy.value = ''
    await refreshAgentRuntime()
  }
}

async function onAgentRepairCore() {
  agentBusy.value = 'core'
  agentNotice.value = ''
  try {
    await window.cs.restartBackend()
    agentNotice.value = '核心服务已重启。'
  } catch (error) {
    agentNotice.value = `修复失败:${error?.message || error}`
  } finally {
    agentBusy.value = ''
    await refreshAgentRuntime()
  }
}

async function onAgentClearData() {
  if (!window.confirm('确定清除智能体数据?将清空会话历史、审批记录与草稿,已执行的任务与产物不受影响。')) return
  agentBusy.value = 'clear'
  agentNotice.value = ''
  try {
    await window.cs.agentApi('POST', '/agent/data/clear')
    agentNotice.value = '智能体数据已清除。'
  } catch (error) {
    agentNotice.value = `清除失败:${error?.message || error}`
  } finally {
    agentBusy.value = ''
  }
}

const cfg = ref({})
const savedCfg = ref({})

const launching = ref(false)
const chromeMsg = ref('')
const chromeMsgOk = ref(true)
const backendRepairing = ref(false)
const backendMsg = ref('')
const backendMsgOk = ref(true)

const testing = reactive({ dingtalk: false, feishu: false, webhook: false })
const testMsg = reactive({ dingtalk: '', feishu: '', webhook: '' })
const testOk = reactive({ dingtalk: true, feishu: true, webhook: true })
const imageProviderFields = ['ai.woka.base_url', 'ai.woka.gemini_base_url', 'ai.woka.api_key', 'ai.semir.base_url', 'ai.semir.gemini_base_url', 'ai.semir.gpt_api_key', 'ai.semir.gemini_api_key']
const aiImageKeyFields = [
  CUSTOM_IMAGE_PROVIDERS_FIELD,
  ...imageProviderFields.filter(field => field.endsWith('_key')),
]
const aiVideoKeyFields = [
  'ai.video.seedance_api_key',
  'ai.video.bailian_api_key',
  'ai.video.bailian_upload_api_key',
]
const llmKeyFields = LLM_BUILTIN_PROVIDERS.map(provider => provider.apiKeyField)


const llmProviderDialog = ref(null)

const llmProviderModal = reactive({
  open: false,
  isNew: false,
  isBuiltin: false,
  providerId: '',
  error: '',
  saving: false,
  tab: 'connection',
  selectedModelId: '',
  newModelId: '',
  discovering: false,
  discoveryError: '',
  discoveredModels: [],
  selectedDiscoveredIds: [],
  discoveryNotice: '',
  discoverySourceUrl: '',
})
let llmDiscoveryRequestId = 0
const canDiscoverLlmModels = computed(() => ['crawshrimp-deepseek-official', 'crawshrimp-glm-official'].includes(llmProviderModal.providerId))
const llmProviderDraft = reactive({
  id: '',
  name: '',
  protocol: 'openai',
  baseUrl: '',
  apiKey: '',
  modelsText: '',
  models: [],
  modelIds: [],
  configured: false,
})
useNativeDialog(computed(() => llmProviderModal.open), llmProviderDialog)
const selectedLlmDraftModel = computed(() => llmProviderDraft.models.find(model => model.id === llmProviderModal.selectedModelId) || llmProviderDraft.models[0] || null)

watch(() => llmProviderDraft.modelsText, (text) => {
  llmProviderDraft.models = mergeCustomLlmModelDraft(text, llmProviderDraft.models, llmProviderModal.isBuiltin)
})

const saveState = reactive({})

const themeOptions = [
  { value: 'system', label: '系统', description: '跟随 macOS / Windows' },
  { value: 'light', label: '浅色', description: '明亮、清晰' },
  { value: 'dark', label: '深色', description: '低光、专注' },
  { value: 'lake', label: '湖光', description: '白底 · 湖水绿' },
]

const isMacOS = window.cs?.platform === 'darwin'

const menuGroups = [
  {
    id: 'appearance',
    label: '外观',
    desc: '主题 / 显示',
    children: [{ id: 'appearance-theme', label: '主题' }],
  },
  {
    id: 'connection',
    label: '连接',
    desc: '核心服务 / Chrome',
    children: [{ id: 'connection-overview', label: '服务状态' }],
  },
  {
    id: 'notify',
    label: '通知',
    desc: '机器人 / Webhook',
    children: [
      { id: 'notify-dingtalk', label: '钉钉机器人', statusKey: 'notify.dingtalk_webhook' },
      { id: 'notify-feishu', label: '飞书机器人', statusKey: 'notify.feishu_webhook' },
      { id: 'notify-custom', label: '自定义 Webhook', statusKey: 'notify.custom_webhook' },
      { id: 'notify-guide', label: '脚本调用说明' },
    ],
  },
  {
    id: 'application',
    label: '应用',
    desc: '版本 / 桌面更新',
    children: [
      { id: 'application-update', label: '桌面更新' },
      ...(isMacOS ? [{ id: 'application-automation', label: '桌面自动化权限' }] : []),
    ],
  },
  {
    id: 'storage',
    label: '存储',
    desc: '数据目录 / 已归档会话',
    children: [{ id: 'storage-data', label: '数据目录' }, { id: 'storage-archived', label: '已归档会话' }],
  },
  {
    id: 'sync',
    label: '数据同步',
    desc: 'ODPS 接口',
    children: [{ id: 'sync-odps', label: 'ODPS AppCode', statusKey: 'odps.app_code' }],
  },
  {
    id: 'ai',
    label: 'AI 能力',
    desc: '图片 / 文本 / 视频 / 智能体',
    children: [
      { id: 'ai-1xm', label: '图片模型', statusKeys: aiImageKeyFields },
      { id: 'ai-llm', label: '文本模型', statusKeys: llmKeyFields },
      { id: 'ai-video', label: '视频模型', statusKeys: aiVideoKeyFields },
      { id: 'ai-agent', label: '智能体', statusKeys: [] },
    ],
  },
  {
    id: 'im',
    label: 'IM机器人',
    desc: '微信 / 飞书 / 钉钉 / 更多',
    children: [{ id: 'im-bots', label: '机器人接入' }, { id: 'plugins', label: '插件' }],
  },
  {
    id: 'account',
    label: '账号',
    desc: '个人资料 / 账号管理',
    children: [{ id: 'account', label: '个人账号' }, { id: 'account-usage', label: '套餐与用量' }],
  },
]

const settingsQuery = ref('')
const settingsContent = ref(null)
const navigationSections = [
  { label: '个人', ids: ['account', 'account-usage', 'appearance-theme'] },
  { label: '模型服务', ids: ['ai-llm', 'ai-1xm', 'ai-video', 'ai-agent'] },
  { label: '连接与集成', ids: ['im-bots', 'plugins', 'sync-odps'] },
  { label: '通知', ids: ['notify-dingtalk', 'notify-feishu', 'notify-custom', 'notify-guide'] },
  { label: '此设备', ids: ['connection-overview', 'storage-data', 'storage-archived', 'application-update', 'application-automation'] },
]
const navigationIcons = {
  account: IconUser, 'account-usage': IconGauge, 'appearance-theme': IconPalette,
  'ai-llm': IconMessage, 'ai-1xm': IconPhoto, 'ai-video': IconVideo, 'ai-agent': IconRobot,
  'im-bots': IconPlug, plugins: IconPuzzle, 'sync-odps': IconCloud, 'notify-dingtalk': IconBell,
  'notify-feishu': IconBell, 'notify-custom': IconCode, 'notify-guide': IconInfoCircle,
  'connection-overview': IconPlug, 'storage-data': IconDatabase, 'storage-archived': IconArchive,
  'application-update': IconRefresh, 'application-automation': IconShield,
}
const panelDescriptions = {
  account: '管理账号、此设备的使用记录与隐私偏好。',
  'account-usage': '查看订阅额度、永久充值余额与到期时间。',
  'appearance-theme': '选择适合当前环境的界面外观，立即应用。',
  'ai-llm': '连接官方服务或自己的 API Key，管理可用的文字模型。',
  'ai-1xm': '管理图片模型服务、连接凭据和可用模型。',
  'ai-video': '配置视频生成服务与本地素材上传，密钥仅保存在本机。',
  'ai-agent': '查看智能体运行状态，按需重启或修复服务。',
  'im-bots': '连接聊天平台，在常用的消息应用中与抓虾对话。',
  plugins: '查看已安装插件，管理智能体的扩展能力。',
  'sync-odps': '配置任务结果与数据文件的 ODPS 同步凭据。',
  'notify-dingtalk': '通过钉钉群机器人接收任务结果与提醒。',
  'notify-feishu': '通过飞书群机器人接收任务结果与提醒。',
  'notify-custom': '将任务通知发送到你指定的 Webhook 地址。',
  'notify-guide': '在脚本中声明通知渠道与消息内容。',
  'connection-overview': '检查本地核心服务与浏览器的连接状态。',
  'storage-data': '选择抓虾保存会话、配置与任务文件的位置。',
  'storage-archived': '查找与恢复已归档的会话，聊天记录仍会保留。',
  'application-update': '查看桌面版本与更新状态。',
  'application-automation': '查看并管理抓虾控制本机应用的系统授权。',
}
const activePanelDescription = computed(() => panelDescriptions[activePanelId.value] || '')
const panelSearchAliases = {
  'ai-llm': '大模型 DeepSeek GPT Gemini API Key 服务商',
  'ai-1xm': '生图 GPT Image Nano Banana API Key 供应商 服务商',
  'ai-video': 'Seedance 百炼 HappyHorse Kling PixVerse OSS API Key',
  'account-usage': '充值 余额 月订阅 永久额度 到期 账期',
}
const navigationItems = menuGroups.flatMap(group => group.children.map(child => ({ ...child, groupId: group.id, icon: navigationIcons[child.id], search: `${child.label} ${panelDescriptions[child.id] || ''} ${panelSearchAliases[child.id] || ''} ${navigationSections.find(section => section.ids.includes(child.id))?.label || group.label}` })))
const visibleNavigation = computed(() => {
  const query = settingsQuery.value.trim().toLocaleLowerCase()
  return navigationSections.map(section => ({ label: section.label, items: section.ids.map(id => navigationItems.find(item => item.id === id)).filter(item => item && (!query || item.search.toLocaleLowerCase().includes(query))) })).filter(section => section.items.length)
})

function resolvePanelSelection(panelId) {
  const requested = String(panelId || '').trim()
  for (const group of menuGroups) {
    const child = group.children.find(item => item.id === requested)
    if (child) return { groupId: group.id, panelId: child.id }
  }
  const fallback = menuGroups[0]
  return { groupId: fallback.id, panelId: fallback.children[0]?.id || fallback.id }
}

const initialPanelSelection = resolvePanelSelection(props.focusPanelId)
const activeGroupId = ref(initialPanelSelection.groupId)
const activePanelId = ref(initialPanelSelection.panelId)
const usagePanelMountedOnce = ref(initialPanelSelection.panelId === 'account-usage')
const imSettingsPanelMountedOnce = ref(initialPanelSelection.panelId === 'im-bots')

const panelFields = {
  'notify-dingtalk': ['notify.dingtalk_webhook', 'notify.dingtalk_secret'],
  'notify-feishu': ['notify.feishu_webhook'],
  'notify-custom': ['notify.custom_webhook'],
  'storage-data': ['data_dir'],
  'sync-odps': ['odps.app_code'],
  'ai-1xm': [CUSTOM_IMAGE_PROVIDERS_FIELD, ...imageProviderFields],
  'ai-llm': [...LLM_PANEL_FIELDS],
  'ai-video': ['ai.video.seedance_api_key', 'ai.video.seedance_base_url', 'ai.video.bailian_api_key', 'ai.video.bailian_workspace_id', 'ai.video.bailian_region', 'ai.video.bailian_base_url', 'ai.video.bailian_upload_api_key', 'ai.video.bailian_uploads_url'],
}

const notifyPanelByChannel = {
  dingtalk: 'notify-dingtalk',
  feishu: 'notify-feishu',
  webhook: 'notify-custom',
}

const updateStatus = computed(() => props.updateStatus || {})
const updateActionBusy = computed(() => Boolean(props.updateActionBusy))
const updateBadgeLabel = computed(() => {
  const status = String(updateStatus.value.status || 'idle')
  if (status === 'available') return '可更新'
  if (status === 'checking') return '检查中'
  if (status === 'downloading') return '下载中'
  if (status === 'ready-to-install') return '待安装'
  if (status === 'error') return '异常'
  if (status === 'unsupported') return '不可用'
  if (status === 'disabled') return '不可用'
  return '已配置'
})
const updateBadgeTone = computed(() => {
  const status = String(updateStatus.value.status || 'idle')
  if (status === 'error' || status === 'disabled' || status === 'unsupported') return 'off'
  if (status === 'available' || status === 'ready-to-install') return 'on'
  return 'neutral'
})
const formattedLastCheckedAt = computed(() => {
  const raw = updateStatus.value.lastCheckedAt || updateStatus.value.checkedAt || ''
  if (!raw) return '尚未检查'
  const date = new Date(raw)
  if (Number.isNaN(date.getTime())) return String(raw)
  return date.toLocaleString()
})
const showManualDownload = computed(() => {
  const status = String(updateStatus.value.status || '')
  const error = String(updateStatus.value.error || '')
  const hasFallbackStatus = status === 'disabled' || status === 'error' || status === 'unsupported'
  const hasFallbackError = /unsupported|signature|签名|更新/i.test(error)
  return updateStatus.value.manualDownloadUrl === OFFICIAL_RELEASE_URL && hasFallbackStatus && (status === 'unsupported' || hasFallbackError)
})
const customLlmProviders = computed(() => normalizeCustomLlmProviders(cfg.value[LLM_CUSTOM_PROVIDERS_FIELD]))
const failedProviderLogos = ref({})
const refreshingOfficialModels = ref(false), officialCatalogError = ref('')
let managedProvidersReadSeq = 0
async function refreshManagedProviders() {
  const seq = ++managedProvidersReadSeq
  try {
    const fresh = await window.cs.getSettings()
    if (seq !== managedProvidersReadSeq) return
    for (const key of ['managed_text_providers', 'managed_image_providers']) cfg.value[key] = fresh[key] || []
    configureAiImageProviders(cfg.value)
    officialCatalogError.value = ''
  } catch { if (seq === managedProvidersReadSeq) officialCatalogError.value = '模型列表更新失败，暂时显示上次读取的目录。请重新刷新。' }
}
async function refreshOfficialModels() {
  if (refreshingOfficialModels.value) return
  refreshingOfficialModels.value = true; officialCatalogError.value = ''
  try { await window.cs.accountAction('refresh-models'); await refreshManagedProviders() }
  catch { officialCatalogError.value = '官方模型目录暂时无法同步，请稍后重试。' }
  finally { refreshingOfficialModels.value = false }
}

const llmProviders = computed(() => {
  const defaultModel = String(cfg.value['ai.llm.default_model'] || '').trim()
  const builtinRows = LLM_BUILTIN_PROVIDERS.map((provider) => {
    const modelIds = builtinLlmProviderModelIds(provider, cfg.value)
    return {
      id: provider.id,
      name: provider.name,
      brand: provider.brand || 'custom',
      logoImage: llmProviderLogoImage(provider),
      logoText: llmProviderLogoText(provider),
      isCustom: false,
      compatibility: provider.compatibility,
      configured: llmProviderConfigured(cfg.value, provider),
      baseUrl: cfg.value[provider.baseUrlField] || provider.defaultBaseUrl,
      modelCount: modelIds.length,
      previewModels: modelIds.slice(0, 3),
      firstModel: modelIds[0] || '',
      isDefault: modelIds.includes(defaultModel) && (!cfg.value['ai.llm.default_provider'] || cfg.value['ai.llm.default_provider'] === provider.id),
    }
  })
  const presets = MODELJETTY_LLM_PRESETS.map(preset => customLlmProviders.value.find(item => item.id === preset.id) || {
    ...preset, models: mergeCustomLlmModelDraft(preset.models.join('\n')), configured: false,
  })
  const customRows = [...presets, ...customLlmProviders.value.filter(item => !MODELJETTY_LLM_PRESETS.some(preset => preset.id === item.id))].map((provider) => {
    const isModelJetty = MODELJETTY_LLM_PRESETS.some(preset => preset.id === provider.id)
    const modelIds = provider.models.map(model => model.id).filter(Boolean)
    return {
      id: provider.id,
      name: provider.name,
      brand: isModelJetty ? 'modeljetty' : 'custom',
      logoImage: isModelJetty ? modeljettyLogoUrl : '',
      logoText: llmProviderLogoText(provider),
      isCustom: !isModelJetty,
      compatibility: provider.protocol === 'anthropic' ? 'Anthropic 兼容' : provider.protocol === 'openai-responses' ? 'OpenAI Responses' : 'OpenAI Chat Completions',
      configured: Boolean(provider.configured),
      baseUrl: provider.base_url,
      modelCount: modelIds.length,
      previewModels: modelIds.slice(0, 3),
      firstModel: modelIds[0] || '',
      isDefault: modelIds.includes(defaultModel) && (!cfg.value['ai.llm.default_provider'] || cfg.value['ai.llm.default_provider'] === provider.id),
    }
  })
  const managedRows = (cfg.value.managed_text_providers || []).map(provider => ({ id: provider.id, name: '抓虾官方模型服务', brand: 'crawshrimp', logoImage: crawshrimpLogoUrl, logoText: '抓虾', isCustom: false, compatibility: '账号额度 · ' + provider.protocol, configured: true, baseUrl: '网页登录后使用，无需 API Key', modelCount: provider.models.length, previewModels: provider.models.map(m => m.name || m.id), firstModel: provider.models[0]?.id, isDefault: provider.models.some(m => m.id === defaultModel) }))
  return [...managedRows, builtinRows[0], ...customRows.filter(item => item.brand === 'modeljetty'), ...builtinRows.slice(1), ...customRows.filter(item => item.brand !== 'modeljetty')]
})

function llmProviderLogoText(provider = {}) {
  if (provider.brand === 'deepseek' || provider.id === 'crawshrimp-deepseek-official') return 'deepseek'
  if (provider.brand === 'glm' || provider.id === 'crawshrimp-glm-official') return 'GLM'
  if (provider.brand === 'semir' || String(provider.name || '').includes('森马')) return 'SEMIR'
  return String(provider.name || provider.id || 'AI').trim().replace(/\s+/g, ' ') || 'AI'
}

function llmProviderLogoImage(provider = {}) {
  if (provider.brand === 'deepseek' || provider.id === 'crawshrimp-deepseek-official') return deepseekLogoUrl
  if (provider.brand === 'semir' || String(provider.name || '').includes('森马')) return semirLogoUrl
  return ''
}

function isMaskedLlmCredential(value) {
  return String(value || '').includes(LLM_MASKED_CREDENTIAL_VALUE)
}

function llmProviderModelIds(provider) {
  if (!provider) return []
  if (provider.kind === 'builtin' || provider.baseUrlField) {
    return builtinLlmProviderModelIds(provider, cfg.value)
  }
  return normalizeCustomLlmProviders([provider])[0]?.models.map(model => model.id) || []
}

function firstAvailableLlmModel() {
  const providers = [...LLM_BUILTIN_PROVIDERS, ...customLlmProviders.value]
  for (const configuredOnly of [true, false]) {
    for (const provider of providers) {
      const configured = provider.baseUrlField ? llmProviderConfigured(cfg.value, provider) : provider.configured
      if (configuredOnly && !configured) continue
      const model = llmProviderModelIds(provider)[0]
      if (model) return model
    }
  }
  return ''
}

async function setLlmDefaultModel(modelId, providerId = '') {
  const value = String(modelId || '').trim()
  if (!value) return
  const previousCfg = clonePlain(cfg.value)
  cfg.value['ai.llm.default_model'] = value
  cfg.value['ai.llm.default_provider'] = providerId
  try {
    await persistLlmPanelChange(previousCfg, '默认模型已保存')
  } catch {
    // Error state is shown next to the LLM save action.
  }
}

function slugifyLlmProviderId(value) {
  const slug = String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48)
  return slug ? `custom-${slug}` : `custom-${Date.now().toString(36)}`
}

function openModelJettyPreset(preset) {
  const existing = customLlmProviders.value.find(provider => provider.id === preset.id)
  if (existing) return openLlmProviderModal(existing.id)
  openLlmProviderModal()
  const models = mergeCustomLlmModelDraft(preset.models.join('\n'))
  Object.assign(llmProviderDraft, { id: preset.id, name: preset.name, protocol: preset.protocol,
    baseUrl: preset.base_url, models, modelsText: preset.models.join('\n'), modelIds: [...preset.models] })
}

function openLlmProviderModal(providerId = '') {
  if (providerId.startsWith('crawshrimp-managed-')) { selectPanel('account', 'account'); return }
  const preset = MODELJETTY_LLM_PRESETS.find(item => item.id === providerId)
  if (preset && !customLlmProviders.value.some(item => item.id === providerId)) return openModelJettyPreset(preset)
  llmDiscoveryRequestId += 1
  Object.assign(llmProviderModal, { tab: 'connection', selectedModelId: '', newModelId: '', discovering: false, discoveryError: '', discoveredModels: [], selectedDiscoveredIds: [], discoveryNotice: '', discoverySourceUrl: '' })
  const builtin = LLM_BUILTIN_PROVIDERS.find(provider => provider.id === providerId)
  const custom = customLlmProviders.value.find(provider => provider.id === providerId)
  llmProviderModal.open = true
  llmProviderModal.isNew = !providerId
  llmProviderModal.isBuiltin = Boolean(builtin)
  llmProviderModal.providerId = providerId || ''
  llmProviderModal.error = ''
  if (builtin) {
    const configured = llmProviderConfigured(cfg.value, builtin)
    const models = builtinLlmProviderModels(builtin, cfg.value)
    Object.assign(llmProviderDraft, {
      models: models.map(model => ({ ...model, input_modalities: [...model.input_modalities], reasoning_efforts: [...(model.reasoning_efforts || [])] })),
      id: builtin.id,
      name: builtin.name,
      protocol: builtin.protocol,
      baseUrl: cfg.value[builtin.baseUrlField] || builtin.defaultBaseUrl,
      apiKey: cfg.value[builtin.apiKeyField] || (configured ? LLM_MASKED_CREDENTIAL_VALUE : ''),
      modelsText: models.map(model => model.id).join('\n'),
      modelIds: models.map(model => model.id),
      configured,
    })
    return
  }
  if (custom) {
    const modelIds = llmProviderModelIds(custom)
    Object.assign(llmProviderDraft, {
      models: custom.models.map(model => ({ ...model })),
      id: custom.id,
      name: custom.name,
      protocol: normalizeLlmProtocol(custom.protocol),
      baseUrl: custom.base_url || '',
      apiKey: custom.api_key || (custom.configured ? LLM_MASKED_CREDENTIAL_VALUE : ''),
      modelsText: modelIds.join('\n'),
      modelIds,
      configured: Boolean(custom.configured),
    })
    return
  }
  Object.assign(llmProviderDraft, {
    models: [],
    id: '',
    name: '',
    protocol: 'openai',
    baseUrl: '',
    apiKey: '',
    modelsText: '',
    modelIds: [],
    configured: false,
  })
}

function removeLlmDraftModel(modelId) {
  llmProviderDraft.models = llmProviderDraft.models.filter(model => model.id !== modelId)
  llmProviderDraft.modelsText = llmProviderDraft.models.map(model => model.id).join('\n')
}

function switchLlmProviderTab(tab) {
  llmProviderModal.tab = tab
  nextTick(() => document.getElementById(tab === 'models' ? 'llm-models-tab' : 'llm-connection-tab')?.focus())
}

function addLlmDraftModel() {
  const id = llmProviderModal.newModelId.trim()
  if (!id) return
  if (llmProviderDraft.models.some(model => model.id === id)) {
    llmProviderModal.error = '这个模型 ID 已存在。'
    llmProviderModal.selectedModelId = id
    return
  }
  llmProviderModal.error = ''
  llmProviderDraft.models = mergeCustomLlmModelDraft([...llmProviderDraft.models.map(model => model.id), id].join('\n'), llmProviderDraft.models, llmProviderModal.isBuiltin)
  llmProviderDraft.modelsText = llmProviderDraft.models.map(model => model.id).join('\n')
  llmProviderModal.selectedModelId = id
  llmProviderModal.newModelId = ''
}

function renameLlmDraftModel(previousId, input) {
  const id = input.value.trim()
  if (!id || llmProviderDraft.models.some(model => model.id === id && model.id !== previousId)) {
    llmProviderModal.error = id ? '这个模型 ID 已存在。' : '模型 ID 不能为空。'
    input.value = previousId
    return
  }
  llmProviderModal.error = ''
  const model = llmProviderDraft.models.find(model => model.id === previousId)
  if (!model) return
  if (model.label === previousId) model.label = id
  model.id = id
  llmProviderModal.selectedModelId = id
  llmProviderDraft.modelsText = llmProviderDraft.models.map(model => model.id).join('\n')
}

function restoreLlmPresetModels() {
  const builtin = LLM_BUILTIN_PROVIDERS.find(provider => provider.id === llmProviderDraft.id)
  if (!builtin) return
  const models = builtinLlmProviderModels(builtin, cfg.value, true)
  llmProviderDraft.models = models
  llmProviderDraft.modelsText = models.map(model => model.id).join('\n')
}

function isLlmPresetModel(modelId) {
  const builtin = LLM_BUILTIN_PROVIDERS.find(provider => provider.id === llmProviderDraft.id)
  return Boolean(builtin && builtinLlmProviderModels(builtin, cfg.value, true).some(model => model.id === modelId))
}

async function discoverLlmModels() {
  if (!canDiscoverLlmModels.value || llmProviderModal.discovering) return
  const requestId = ++llmDiscoveryRequestId
  llmProviderModal.discovering = true
  llmProviderModal.discoveryError = ''
  llmProviderModal.discoveredModels = []
  llmProviderModal.selectedDiscoveredIds = []
  const payload = { base_url: String(llmProviderDraft.baseUrl || '').trim() }
  const key = String(llmProviderDraft.apiKey || '').trim()
  if (key && !isMaskedLlmCredential(key)) payload.api_key = key
  try {
    const result = await window.cs.agentApi('POST', `/agent/providers/${llmProviderModal.providerId}/discover-models`, payload)
    if (requestId !== llmDiscoveryRequestId || !llmProviderModal.open) return
    llmProviderModal.discoveredModels = result.models || []
    llmProviderModal.selectedDiscoveredIds = llmProviderModal.discoveredModels
      .filter(model => !llmProviderDraft.models.some(item => item.id === model.id)).map(model => model.id)
    llmProviderModal.discoveryNotice = result.notice || ''
    llmProviderModal.discoverySourceUrl = result.source_url || ''
  } catch (error) {
    if (requestId === llmDiscoveryRequestId && llmProviderModal.open) llmProviderModal.discoveryError = error.message || String(error)
  } finally {
    if (requestId === llmDiscoveryRequestId) llmProviderModal.discovering = false
  }
}

function addDiscoveredLlmModels() {
  const current = mergeCustomLlmModelDraft(llmProviderDraft.modelsText, llmProviderDraft.models, true)
  const models = mergeDiscoveredLlmModels(current, llmProviderModal.discoveredModels, llmProviderModal.selectedDiscoveredIds)
  llmProviderDraft.models = models
  llmProviderDraft.modelsText = models.map(model => model.id).join('\n')
  llmProviderModal.selectedDiscoveredIds = []
}

function trapLlmProviderFocus(event) {
  const elements = [...(llmProviderDialog.value?.querySelectorAll('button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled)') || [])].filter(element => element.getClientRects().length)
  const first = elements[0], last = elements.at(-1)
  if (event.shiftKey && (document.activeElement === first || document.activeElement === llmProviderDialog.value)) { event.preventDefault(); last?.focus() }
  else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus() }
}

function closeLlmProviderModal(options = {}) {
  if (llmProviderModal.saving && !options.force) return
  llmProviderModal.open = false
  llmDiscoveryRequestId += 1
  llmProviderModal.error = ''
}

async function applyLlmProviderDraft() {
  if (llmProviderModal.saving) return
  llmProviderModal.error = ''
  const name = String(llmProviderDraft.name || '').trim()
  const protocol = normalizeLlmProtocol(llmProviderDraft.protocol)
  const baseUrl = String(llmProviderDraft.baseUrl || '').trim()
  const apiKey = String(llmProviderDraft.apiKey || '').trim()
  if (!name) {
    llmProviderModal.tab = 'connection'
    llmProviderModal.error = '请填写 服务商名称。'
    return
  }
  if (!baseUrl) {
    llmProviderModal.tab = 'connection'
    llmProviderModal.error = '请填写 Base URL。'
    return
  }
  const previousCfg = clonePlain(cfg.value)
  const builtin = LLM_BUILTIN_PROVIDERS.find(provider => provider.id === llmProviderDraft.id)
  const models = mergeCustomLlmModelDraft(llmProviderDraft.modelsText, llmProviderDraft.models, Boolean(builtin))
  const budgetError = customLlmBudgetError(models, protocol)
  if (budgetError) {
    llmProviderModal.tab = 'models'
    llmProviderModal.error = budgetError
    return
  }
  if (builtin) {
    cfg.value[builtin.baseUrlField] = baseUrl
    cfg.value[LLM_BUILTIN_PROVIDER_MODELS_FIELD] = {
      ...normalizeBuiltinProviderModels(cfg.value[LLM_BUILTIN_PROVIDER_MODELS_FIELD]),
      [builtin.id]: models,
    }
    if (apiKey) cfg.value[builtin.apiKeyField] = apiKey
    if (apiKey && !isMaskedLlmCredential(apiKey)) cfg.value[builtin.configuredField] = true
    const defaultModel = String(cfg.value['ai.llm.default_model'] || '').trim()
    if (!defaultModel || ![...LLM_BUILTIN_PROVIDERS, ...customLlmProviders.value].some(provider => llmProviderModelIds(provider).includes(defaultModel))) {
      cfg.value['ai.llm.default_model'] = firstAvailableLlmModel()
    }
    await saveLlmProviderDraft(previousCfg)
    return
  }

  if (!models.length) {
    llmProviderModal.tab = 'models'
    llmProviderModal.error = '请至少填写一个模型 ID。'
    return
  }
  const existingId = String(llmProviderDraft.id || '').trim()
  const providerId = existingId || slugifyLlmProviderId(name)
  const reserved = new Set(LLM_BUILTIN_PROVIDERS.map(provider => provider.id))
  if (reserved.has(providerId)) {
    llmProviderModal.error = '这个 Provider 标识与内置 Provider 冲突，请换一个名称。'
    return
  }
  const providers = normalizeCustomLlmProviders(cfg.value[LLM_CUSTOM_PROVIDERS_FIELD])
  const duplicate = providers.some(provider => provider.id === providerId && provider.id !== llmProviderModal.providerId)
  if (duplicate) {
    llmProviderModal.error = '这个 Provider 已存在，请换一个名称。'
    return
  }
  const nextProvider = {
    id: providerId,
    name,
    protocol,
    base_url: baseUrl,
    api_key: apiKey,
    configured: Boolean(llmProviderDraft.configured) || isMaskedLlmCredential(apiKey) || Boolean(apiKey),
    models,
  }
  const next = providers.filter(provider => provider.id !== llmProviderModal.providerId)
  next.push(nextProvider)
  cfg.value[LLM_CUSTOM_PROVIDERS_FIELD] = next
  if (!cfg.value['ai.llm.default_model']) cfg.value['ai.llm.default_model'] = models[0].id
  await saveLlmProviderDraft(previousCfg)
}

async function saveLlmProviderDraft(previousCfg) {
  llmProviderModal.saving = true
  try {
    await persistLlmPanelChange(previousCfg, '服务商已保存')
    closeLlmProviderModal({ force: true })
  } catch (error) {
    llmProviderModal.error = error?.message || 'Provider 保存失败'
  } finally {
    llmProviderModal.saving = false
  }
}

async function persistLlmPanelChange(previousCfg, successMessage) {
  try {
    const result = await savePanel('ai-llm', { silent: true })
    const state = ensureSaveState('ai-llm')
    state.err = false
    state.msg = llmRuntimeSaveMessage(result, successMessage)
    return result
  } catch (error) {
    cfg.value = clonePlain(previousCfg)
    const state = ensureSaveState('ai-llm')
    state.err = true
    state.msg = error?.message || '保存失败'
    throw error
  }
}

function clonePlain(value) {
  return JSON.parse(JSON.stringify(value || {}))
}

function llmRuntimeSaveMessage(result, fallback = '已保存') {
  if (result?.agent_runtime_reload === 'restarted') return `${fallback}，智能体运行时已同步重启`
  if (result?.agent_runtime_reload === 'scheduled') return `${fallback}，智能体运行时正在重启`
  if (result?.agent_runtime_reload === 'busy') return `${fallback}，当前有运行中的智能体任务，结束后请重启运行时`
  if (result?.agent_runtime_reload === 'failed') {
    return `${fallback}，智能体运行时重启失败:${result?.agent_runtime_error || '未知错误'}`
  }
  if (result?.restart_required) return `${fallback}，重启应用后生效`
  return fallback
}

async function removeCustomLlmProvider(providerId) {
  const provider = customLlmProviders.value.find(item => item.id === providerId)
  if (!provider) return
  if (!window.confirm(`确定删除 服务商「${provider.name}」吗？`)) return
  const previousCfg = clonePlain(cfg.value)
  const removedModelIds = new Set(llmProviderModelIds(provider))
  cfg.value[LLM_CUSTOM_PROVIDERS_FIELD] = customLlmProviders.value.filter(item => item.id !== providerId)
  if (removedModelIds.has(String(cfg.value['ai.llm.default_model'] || ''))) {
    cfg.value['ai.llm.default_model'] = firstAvailableLlmModel()
  }
  try {
    await persistLlmPanelChange(previousCfg, '服务商已删除')
  } catch {
    // Error state is shown next to the LLM save action.
  }
}

function ensureSaveState(panelId) {
  if (!saveState[panelId]) {
    saveState[panelId] = { saving: false, msg: '', err: false }
  }
  return saveState[panelId]
}

function panelSaving(panelId) {
  return Boolean(saveState[panelId]?.saving)
}

function panelMsg(panelId) {
  return saveState[panelId]?.msg || ''
}

function panelErr(panelId) {
  return Boolean(saveState[panelId]?.err)
}

const PanelActions = defineComponent({
  name: 'PanelActions',
  props: { panelId: { type: String, required: true } },
  emits: ['save'],
  setup(componentProps, { emit: emitAction }) {
    return () => h('div', { class: 'panel-actions' }, [
      h(
        'button',
        {
          class: 'btn-orange',
          disabled: panelSaving(componentProps.panelId),
          onClick: () => emitAction('save'),
        },
        panelSaveButtonLabel(componentProps.panelId),
      ),
      panelMsg(componentProps.panelId)
        ? h('span', {
          class: ['msg', panelErr(componentProps.panelId) ? 'err' : 'ok'],
          role: panelErr(componentProps.panelId) ? 'alert' : 'status',
        }, panelMsg(componentProps.panelId))
        : null,
    ])
  },
})

function panelSaveButtonLabel(panelId) {
  if (panelSaving(panelId)) return '保存中...'
  if (panelId === 'ai-llm') return '保存并重启智能体'
  return '保存此项'
}

function flattenSettings(source, prefix = '', target = {}) {
  const value = source && typeof source === 'object' ? source : {}
  for (const [key, item] of Object.entries(value)) {
    const nextKey = prefix ? `${prefix}.${key}` : key
    if (item && typeof item === 'object' && !Array.isArray(item)) {
      flattenSettings(item, nextKey, target)
    } else {
      target[nextKey] = item
    }
  }
  return target
}

function normalizedSettings(raw) {
  const flat = flattenSettings(raw || {})
  flat[LLM_BUILTIN_PROVIDER_MODELS_FIELD] = normalizeBuiltinProviderModels(
    raw?.[LLM_BUILTIN_PROVIDER_MODELS_FIELD] || raw?.ai?.llm?.builtin_provider_models,
  )
  flat['ai.llm.builtin_provider_model_defaults'] = normalizeBuiltinProviderModels(
    raw?.['ai.llm.builtin_provider_model_defaults'] || raw?.ai?.llm?.builtin_provider_model_defaults,
  )
  flat['ai.llm.default_model'] = normalizeDeepSeekModelId(flat['ai.llm.default_model'])
  if (!flat['ai.woka.base_url']) flat['ai.woka.base_url'] = 'https://4.0.wk-best.com/v1'
  if (!flat['ai.woka.gemini_base_url']) flat['ai.woka.gemini_base_url'] = 'https://4.0.wk-best.com/v1beta'
  if (!flat['ai.semir.base_url']) flat['ai.semir.base_url'] = 'https://ai-aigw.semir.com/overseas-image/v1'
  if (!flat['ai.semir.gemini_base_url']) flat['ai.semir.gemini_base_url'] = 'https://ai-aigw.semir.com/overseas-image-gemini/v1beta'
  for (const [key, value] of Object.entries(LLM_DEFAULTS)) {
    if (!flat[key]) flat[key] = value
  }
  flat[LLM_API_KEY_FIELD] = flat['ai.llm.configured'] ? LLM_MASKED_CREDENTIAL_VALUE : ''
  for (const provider of LLM_BUILTIN_PROVIDERS) {
    const configured = llmProviderConfigured(flat, provider)
    flat[provider.apiKeyField] = configured ? LLM_MASKED_CREDENTIAL_VALUE : ''
    if (provider.configuredField) flat[provider.configuredField] = configured
  }
  flat[LLM_CUSTOM_PROVIDERS_FIELD] = normalizeCustomLlmProviders(flat[LLM_CUSTOM_PROVIDERS_FIELD])
    .map(provider => ({
      ...provider,
      api_key: provider.configured ? LLM_MASKED_CREDENTIAL_VALUE : '',
    }))
  // Provider connection fields are write-only. Never retain a value returned
  // by an older backend, and never synthesize defaults that could overwrite it.
  for (const key of AI_VIDEO_WRITE_ONLY_FIELDS) flat[key] = ''
  for (const key of AI_VIDEO_CREDENTIAL_FIELDS) {
    if (isAiVideoCredentialConfigured(flat, key)) flat[key] = AI_VIDEO_MASKED_CREDENTIAL_VALUE
  }
  return flat
}

async function load() {
  const flat = normalizedSettings(await window.cs.getSettings() || {})
  configureAiImageProviders(flat)
  cfg.value = { ...flat }
  savedCfg.value = { ...flat }
}

function selectPanel(groupId, panelId) {
  activeGroupId.value = groupId
  activePanelId.value = panelId
}

function selectTheme(preference) {
  emit('theme-change', preference)
}

function focusPanel(panelId) {
  if (!panelId) return
  const group = menuGroups.find(item => item.children.some(child => child.id === panelId))
  if (!group) return
  activeGroupId.value = group.id
  activePanelId.value = panelId
}

function selectInputText(event) {
  event?.target?.select?.()
}

function isFieldConfigured(key) {
  if (key === CUSTOM_IMAGE_PROVIDERS_FIELD) return (cfg.value[key] || []).some(provider => Boolean(provider.api_key))
  if (aiVideoKeyFields.includes(key)) return isAiVideoCredentialConfigured(cfg.value, key)
  const llmProvider = LLM_BUILTIN_PROVIDERS.find(provider => provider.apiKeyField === key)
  if (llmProvider) return llmProviderConfigured(cfg.value, llmProvider)
  if (LLM_CREDENTIAL_FIELDS.includes(key)) return isLlmConfigured(cfg.value)
  return String(cfg.value[key] || '').trim().length > 0
}


function hasAnyFieldConfigured(keys) {
  return keys.some(key => isFieldConfigured(key))
}

const isImageServiceConfigured = computed(() => (cfg.value.managed_image_providers || []).some(provider => provider.models?.length) || hasAnyFieldConfigured(aiImageKeyFields))
const isTextServiceConfigured = computed(() => (cfg.value.managed_text_providers || []).some(provider => provider.models?.length) || isLlmConfigured(cfg.value))

function isMenuChildConfigured(child) {
  if (child?.id === 'ai-1xm') return isImageServiceConfigured.value
  if (child?.id === 'ai-llm') return isTextServiceConfigured.value
  if (Array.isArray(child?.statusKeys)) return hasAnyFieldConfigured(child.statusKeys)
  return isFieldConfigured(child?.statusKey)
}

async function browseDir() {
  const p = await window.cs.browseFile({ directory: true })
  if (p) cfg.value['data_dir'] = p
}

function buildPatch(panelId) {
  if (panelId === 'ai-video') return buildWriteOnlyAiVideoPatch(cfg.value)
  if (panelId === 'ai-llm') return buildLlmSettingsPatch(cfg.value)
  const keys = panelFields[panelId] || []
  return keys.reduce((patch, key) => {
    patch[key] = cfg.value[key] ?? ''
    return patch
  }, {})
}

async function saveVideoProviderConfig(values) {
  const patch = clonePlain(buildWriteOnlyAiVideoPatch(values))
  const result = typeof window.cs.patchSettings === 'function'
    ? await window.cs.patchSettings(patch)
    : await window.cs.saveSettings(clonePlain({ ...savedCfg.value, ...patch }))
  Object.assign(cfg.value, patch)
  Object.assign(savedCfg.value, patch)
  clearWrittenAiVideoFields(cfg.value, patch)
  clearWrittenAiVideoFields(savedCfg.value, patch)
  return result
}

async function saveImageProviderConfig(patch) {
  // Existing provider entries come from Vue reactive state; IPC accepts plain data.
  const plainPatch = clonePlain(patch)
  const result = typeof window.cs.patchSettings === 'function'
    ? await window.cs.patchSettings(plainPatch)
    : await window.cs.saveSettings(clonePlain({ ...savedCfg.value, ...plainPatch }))
  const readback = normalizedSettings(await window.cs.getSettings() || {})
  for (const key of Object.keys(patch)) {
    cfg.value[key] = readback[key]
    savedCfg.value[key] = readback[key]
  }
  configureAiImageProviders(readback)
  return result
}

function savePanelFromForm(panelId) {
  // savePanel records the actionable error in this panel's live status.
  // Form events consume the rejection; programmatic callers can still await it.
  void savePanel(panelId).catch(() => {})
}

async function savePanel(panelId, options = {}) {
  const keys = panelFields[panelId] || []
  if (!keys.length) return { ok: true }

  const state = ensureSaveState(panelId)
  state.saving = true
  state.err = false
  if (!options.silent) state.msg = ''

  try {
    const patch = buildPatch(panelId)
    const result = typeof window.cs.patchSettings === 'function'
      ? await window.cs.patchSettings(patch)
      : await window.cs.saveSettings({ ...savedCfg.value, ...patch })

    if (panelId === 'ai-video') {
      clearWrittenAiVideoFields(cfg.value, patch)
      clearWrittenAiVideoFields(savedCfg.value, patch)
    } else if (panelId === 'ai-llm') {
      clearWrittenLlmSettings(cfg.value, patch)
      clearWrittenLlmSettings(savedCfg.value, patch)
      savedCfg.value = { ...savedCfg.value, ...patch }
      clearWrittenLlmSettings(savedCfg.value, patch)
    } else {
      savedCfg.value = { ...savedCfg.value, ...patch }
    }
    state.err = false
    if (!options.silent) {
      if (panelId === 'ai-llm' && result?.agent_runtime_reload === 'restarted') {
        state.msg = '已保存，智能体运行时已同步重启'
      } else if (panelId === 'ai-llm' && result?.agent_runtime_reload === 'scheduled') {
        state.msg = '已保存，智能体运行时正在重启'
      } else if (panelId === 'ai-llm' && result?.agent_runtime_reload === 'busy') {
        state.msg = '已保存，当前有运行中的智能体任务，结束后请重启运行时'
      } else if (panelId === 'ai-llm' && result?.agent_runtime_reload === 'failed') {
        state.msg = `已保存，智能体运行时重启失败:${result?.agent_runtime_error || '未知错误'}`
      } else {
        state.msg = result?.restart_required ? '已保存，重启应用后生效' : '已保存'
      }
    }
    if (panelId === 'ai-llm') await refreshAgentRuntime()
    return result
  } catch (e) {
    state.err = true
    state.msg = e?.message || '保存失败'
    throw e
  } finally {
    state.saving = false
  }
}

async function doLaunchChrome() {
  launching.value = true
  chromeMsg.value = ''
  try {
    const res = await window.cs.launchChrome()
    chromeMsg.value = res.msg || (res.ok ? '已启动' : '启动失败')
    chromeMsgOk.value = res.ok
    emit('runtime-refresh')
  } catch (e) {
    chromeMsg.value = e.message
    chromeMsgOk.value = false
  } finally {
    launching.value = false
  }
}

async function doRepairBackend() {
  backendRepairing.value = true
  backendMsg.value = ''
  try {
    const result = await window.cs.restartBackend()
    backendMsg.value = result?.dataDirRecovery?.recovered
      ? `核心服务已恢复，数据目录已切换到 ${result.dataDir}`
      : '核心服务已重新启动并通过健康检查'
    backendMsgOk.value = true
    emit('runtime-refresh')
  } catch (error) {
    backendMsg.value = error?.message || '核心服务修复失败'
    backendMsgOk.value = false
  } finally {
    backendRepairing.value = false
  }
}

async function openDiagnosticLog() {
  try {
    await window.cs.openDiagnosticLog()
  } catch (error) {
    backendMsg.value = error?.message || '无法打开诊断日志'
    backendMsgOk.value = false
  }
}

function requestUpdateCheck() {
  emit('check-update')
}

function openManualDownload() {
  if (updateActionBusy.value) return
  if (updateStatus.value.manualDownloadUrl === OFFICIAL_RELEASE_URL) {
    window.cs.openExternalUrl(updateStatus.value.manualDownloadUrl)
  }
}

function openDeepSeekPlatform() {
  if (typeof window.cs?.openExternalUrl !== 'function') return
  window.cs.openExternalUrl(DEEPSEEK_PLATFORM_URL).catch((error) => {
    const state = ensureSaveState('ai-llm')
    state.err = true
    state.msg = error?.message || '无法打开 DeepSeek 官方平台'
  })
}

async function testNotify(channel) {
  const panelId = notifyPanelByChannel[channel]
  testing[channel] = true
  testMsg[channel] = ''

  try {
    await savePanel(panelId, { silent: true })
    const res = await window.cs.testNotify(channel)
    testMsg[channel] = res.ok ? (res.msg || '发送成功') : (res.error || '发送失败')
    testOk[channel] = Boolean(res.ok)
  } catch (e) {
    testMsg[channel] = e?.message || '发送失败'
    testOk[channel] = false
  } finally {
    testing[channel] = false
  }
}

const archivedSessions = ref([])
const archiveQuery = ref('')
const archiveLoading = ref(false)
const archiveRestoring = ref('')
const archiveError = ref('')
const archiveNotice = ref('')
const filteredArchivedSessions = computed(() => {
  const query = archiveQuery.value.trim().toLowerCase()
  return archivedSessions.value.filter(item => `${item.title} ${item.id}`.toLowerCase().includes(query))
})
function archiveTime(value) {
  const date = value == null ? null : new Date(value)
  if (!date || !Number.isFinite(date.getTime())) return { short: '未知', full: '暂无时间信息', iso: undefined }
  const pad = n => String(n).padStart(2, '0')
  const day = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
  const time = `${pad(date.getHours())}:${pad(date.getMinutes())}`
  return { short: `${day} ${time}`, full: `${day} ${time}:${pad(date.getSeconds())}（本地时间）`, iso: date.toISOString() }
}
const archivePageSize = 10
const archivePage = ref(1)
const archivePageCount = computed(() => Math.max(1, Math.ceil(filteredArchivedSessions.value.length / archivePageSize)))
const pagedArchivedSessions = computed(() => filteredArchivedSessions.value.slice((archivePage.value - 1) * archivePageSize, archivePage.value * archivePageSize))
watch(archiveQuery, () => { archivePage.value = 1 })
watch(archivePageCount, pages => { archivePage.value = Math.min(archivePage.value, pages) }, { flush: 'sync' })
async function loadArchivedSessions() {
  if (archiveLoading.value || archiveRestoring.value) return
  archiveLoading.value = true
  archiveError.value = ''
  archiveNotice.value = ''
  try { archivedSessions.value = await requestArchivedSessions() }
  catch (error) { archiveError.value = error.message }
  finally { archiveLoading.value = false }
}
async function restoreArchivedSession(id) {
  if (archiveLoading.value || archiveRestoring.value) return
  archiveRestoring.value = id
  archiveError.value = ''
  archiveNotice.value = ''
  try {
    archivedSessions.value = await requestArchivedSessions('restore', id)
    archiveNotice.value = '会话已恢复，可在侧边栏查看。'
  } catch (error) { archiveError.value = error.message }
  finally { archiveRestoring.value = '' }
}

let stopAccountUpdates
onMounted(async () => {
  stopAccountUpdates = window.cs.onAccountChanged?.(refreshManagedProviders)
  window.addEventListener('message', onImSettingsMessage)
  await load()
  if (activePanelId.value === 'storage-archived') await loadArchivedSessions()
  if (activePanelId.value === 'im-bots') await refreshAgentRuntime()
})

onBeforeUnmount(() => {
  managedProvidersReadSeq += 1
  stopAccountUpdates?.()
  window.removeEventListener('message', onImSettingsMessage)
})

watch(() => [props.focusPanelId, props.focusRequestId], ([panelId]) => {
  focusPanel(panelId)
})

watch(activePanelId, panelId => {
  if (panelId === 'account-usage') usagePanelMountedOnce.value = true
  if (settingsContent.value) settingsContent.value.scrollTop = 0
  if (panelId === 'storage-archived') loadArchivedSessions()
  if (panelId === 'im-bots') {
    imSettingsPanelMountedOnce.value = true
    if (!imSettingsFrame.value) imSettingsReady.value = false
    refreshAgentRuntime()
  }
  if (panelId === 'ai-agent') refreshAgentRuntime()
})

watch(() => [props.effectiveTheme, props.themePreference], () => {
  if (activePanelId.value === 'im-bots') onImSettingsFrameLoad()
})

watch(imSettingsUrl, () => {
  imSettingsReady.value = false
})
</script>

<style scoped src="./settingsPanel.css"></style>
<style scoped>
.llm-model-editor-head { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
.llm-model-editor-head strong { overflow-wrap: anywhere; min-width: 0; }
.llm-provider-modal { --model-dialog-width: 740px; width: min(740px, calc(100vw - 48px)); height: auto; max-height: calc(100dvh - 48px); margin: auto; }
.llm-provider-modal.editing-models { --model-dialog-width: 940px; width: min(940px, calc(100vw - 48px)); }
.llm-provider-modal .settings-modal-body { flex: 0 1 auto; padding: 24px; overflow-y: auto; min-height: 0; }
.llm-provider-tabs { display: flex; gap: 24px; padding: 0 22px; border-bottom: 1px solid var(--border); flex-shrink: 0; }
.llm-provider-tabs button { display: inline-flex; align-items: center; gap: 8px; padding: 14px 0 12px; border: 0; border-bottom: 2px solid transparent; background: none; color: var(--text3); font: inherit; font-weight: 650; cursor: pointer; }
.llm-provider-tabs button[aria-selected="true"] { color: var(--orange-text); border-bottom-color: var(--orange); }
.llm-provider-tabs button span { padding: 2px 6px; border-radius: 4px; background: var(--bg3); color: var(--text2); font-size: 11px; font-variant-numeric: tabular-nums; }
.llm-provider-tabs button:focus-visible, .llm-model-list-item:focus-visible, .llm-batch-models summary:focus-visible { outline: 2px solid var(--orange); outline-offset: 3px; }
.llm-connection-panel { display: flex; flex-direction: column; gap: 18px; width: 100%; }
.llm-models-panel { display: flex; flex-direction: column; gap: 18px; min-width: 0; }
.llm-model-toolbar { display: flex; justify-content: space-between; align-items: flex-start; gap: 16px; }
.llm-model-toolbar h4, .llm-model-detail h4 { margin: 0; font-size: 15px; color: var(--text); }
.llm-model-toolbar .field-hint { margin: 6px 0 0; }
.llm-model-toolbar-actions { display: flex; gap: 8px; flex-shrink: 0; }
.llm-model-add-row { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 10px; }
.llm-model-workspace { display: grid; grid-template-columns: 240px minmax(0, 1fr); border: 1px solid var(--border); border-radius: 8px; min-height: 380px; overflow: hidden; }
.llm-model-sidebar { min-width: 0; border-right: 1px solid var(--border); background: var(--bg3); }
.llm-model-list-caption { margin: 0; padding: 16px; color: var(--text3); font-size: 12px; font-weight: 650; }
.llm-model-list { display: flex; flex-direction: column; gap: 4px; padding: 0 8px 10px; max-height: 400px; overflow-y: auto; }
.llm-model-list-item { display: flex; flex-direction: column; align-items: flex-start; gap: 5px; width: 100%; min-height: 58px; padding: 11px 12px; border: 1px solid transparent; border-radius: 6px; background: transparent; text-align: left; cursor: pointer; color: var(--text2); }
.llm-model-list-item strong, .llm-model-list-item span { width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.llm-model-list-item strong { font-size: 13px; font-weight: 600; }
.llm-model-list-item span { font-size: 11px; color: var(--text3); }
.llm-model-list-item.active { background: var(--bg2); border-color: var(--border-strong); color: var(--orange-text); }
.llm-model-list-empty { padding: 8px; }
.llm-model-detail { min-width: 0; padding: 20px; display: flex; flex-direction: column; gap: 20px; }
.llm-model-detail-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; padding-bottom: 16px; border-bottom: 1px solid var(--border); }
.llm-model-detail-head > div { min-width: 0; }
.llm-model-detail-head h4 { overflow-wrap: anywhere; }
.llm-model-detail-head p { margin: 6px 0 0; font-size: 12px; color: var(--text3); overflow-wrap: anywhere; }
.llm-model-detail-head button { flex-shrink: 0; }
.llm-model-details-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 16px; }
.llm-model-details-grid .field { margin: 0; min-width: 0; }
.llm-model-details-grid input { margin-top: 2px; }
.llm-model-reasoning-levels { margin: 0; padding: 0; border: 0; min-width: 0; }
.llm-model-reasoning-levels legend { margin-bottom: 10px; color: var(--text2); font-size: 12px; font-weight: 650; }
.llm-model-reasoning-field { margin: 0; }
.llm-model-reasoning-levels { display: flex; flex-wrap: wrap; gap: 12px 16px; padding-top: 10px; }
.llm-model-reasoning-levels label { display: inline-flex; align-items: center; gap: 6px; font-size: 12px; }
.llm-model-reasoning-levels input { margin: 0; }
.llm-model-empty { justify-content: center; align-items: center; text-align: center; }
.llm-batch-models { font-size: 12px; color: var(--text3); }
.llm-batch-models summary { cursor: pointer; width: fit-content; }
.llm-batch-models textarea { margin-top: 12px; }
.llm-model-discovery { padding: 14px 16px; border: 1px solid var(--border); border-radius: 8px; background: var(--bg3); }
.llm-model-discovery > .field-hint { margin: 8px 0; }
.llm-discovered-models { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px 16px; max-height: 180px; overflow-y: auto; }
.llm-discovered-models label { display: inline-flex; align-items: center; gap: 6px; overflow-wrap: anywhere; font-size: 12px; }
@media (max-width: 760px) {
  .llm-provider-modal .settings-modal-body { padding: 16px; }
  .llm-model-toolbar { flex-direction: column; }
  .llm-model-toolbar-actions { flex-wrap: wrap; }
  .llm-model-workspace { grid-template-columns: 1fr; }
  .llm-model-sidebar { border-right: 0; border-bottom: 1px solid var(--border); }
  .llm-model-list { max-height: 160px; }
  .llm-model-detail { padding: 16px; }
  .llm-model-details-grid, .llm-model-capabilities, .llm-discovered-models { grid-template-columns: 1fr; }
}

.view { height: 100%; min-height: 0; color: var(--text); background: var(--bg); }
/* Fixed navigation + fluid content; no layout-changing entrance animations. */
.settings-workspace { height: 100%; display: grid; grid-template-columns: 228px minmax(0, 1fr); overflow: hidden; }
.settings-menu { min-height: 0; display: flex; flex-direction: column; padding: 20px 12px 12px; border-right: 1px solid var(--border); background: var(--bg); }
.settings-nav-header { display: flex; align-items: center; gap: 10px; padding: 0 6px 20px; }
.settings-nav-header h1 { margin: 0; font-size: 16px; font-weight: 600; }
.settings-back { display: grid; place-items: center; width: 28px; height: 28px; padding: 0; border: 0; border-radius: 6px; background: transparent; color: var(--text2); cursor: pointer; }
.settings-back:hover { background: var(--bg3); color: var(--text); }
.settings-search { display: flex; gap: 8px; align-items: center; min-height: 34px; padding: 0 10px; background: var(--bg2); border: 1px solid var(--border); border-radius: 7px; color: var(--text3); }
.settings-search input { width: 100%; min-width: 0; border: 0; outline: 0; color: var(--text); background: transparent; font: inherit; font-size: 12px; padding: 8px 0; }
.settings-search input::placeholder { color: var(--text3); }
.settings-search:focus-within { outline: 2px solid var(--text3); outline-offset: 2px; }
.settings-mobile-select { display: none; }
.settings-nav-list { min-height: 0; overflow-y: auto; overscroll-behavior: contain; padding: 2px 0 16px; margin-top: 10px; scrollbar-width: thin; }
.nav-section { margin-top: 18px; }
.nav-section:first-child { margin-top: 8px; }
.nav-section h2 { font-size: 11px; font-weight: 500; color: var(--text3); margin: 0 10px 7px; }
.settings-nav-item { display: flex; align-items: center; gap: 10px; width: 100%; min-height: 34px; padding: 7px 10px; border: 0; border-radius: 6px; color: var(--text2); background: transparent; text-align: left; font: inherit; font-size: 12px; line-height: 20px; cursor: pointer; }
.settings-nav-item svg { flex-shrink: 0; color: var(--text3); }
.settings-nav-item:hover { background: var(--bg2); color: var(--text); }
.settings-nav-item.active { background: var(--bg3); color: var(--text); font-weight: 550; }
.settings-nav-item.active svg { color: var(--text); }
.settings-nav-item:focus-visible, .settings-back:focus-visible { outline: 2px solid var(--text3); outline-offset: -2px; }
.nav-empty { color: var(--text3); font-size: 12px; padding: 16px 10px; }
.settings-content { min-width: 0; min-height: 0; overflow-y: auto; overscroll-behavior: contain; padding: 44px clamp(24px, 5vw, 76px) 48px; scrollbar-gutter: stable; }
.settings-content > * { margin-left: auto; margin-right: auto; }
.settings-content > .panel { max-width: 1000px; padding: 0; border: 0; background: transparent; }
.settings-content :deep(.panel-head h3) { font-size: 22px; font-weight: 600; }
.settings-content :deep(.panel-kicker) { color: var(--text3); font-weight: 400; }

.agent-op-row { display: flex; flex-wrap: wrap; gap: 10px; }
.agent-notice { font-size: 12.5px; color: var(--green); padding: 8px 12px; border: 1px solid var(--border); border-radius: 8px; background: var(--bg2); }
.btn-danger { border: 1px solid var(--red); color: var(--red); background: transparent; font-size: 13px; padding: 8px 16px; border-radius: 8px; cursor: pointer; }
.btn-danger:hover { background: rgba(248, 113, 113, 0.12); }
.btn-danger:disabled { opacity: 0.6; cursor: default; }

.im-panel {
  height: calc(100dvh - 132px);
  min-height: 0;
}

.im-safety-strip {
  display: flex;
  flex-wrap: wrap;
  gap: 8px 16px;
  padding: 10px 12px;
  border: 1px solid var(--border);
  border-radius: 9px;
  color: var(--text2);
  background: var(--bg3);
  font-size: 12px;
}

.im-safety-strip span {
  display: inline-flex;
  align-items: center;
  gap: 7px;
}

.im-safety-strip i {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: var(--green);
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--green) 12%, transparent);
}

.im-settings-shell {
  position: relative;
  flex: 1;
  min-height: 0;
  overflow: hidden;
  border: 0;
  border-radius: 0;
  background: transparent;
}

.im-settings-frame {
  display: block;
  width: 100%;
  height: 100%;
  min-height: 0;
  border: 0;
  background: var(--bg);
  opacity: 0;
  visibility: hidden;
  pointer-events: none;
}

.im-settings-frame.is-ready {
  opacity: 1;
  visibility: visible;
  pointer-events: auto;
}

.im-settings-loading {
  position: absolute;
  inset: 0;
  z-index: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  min-height: 420px;
  color: var(--text2);
  background: var(--bg);
}

.im-settings-loading strong {
  color: var(--text);
  font-size: 15px;
}

.im-settings-loading p {
  margin: 0;
  font-size: 12px;
}

.im-settings-loading-spinner {
  width: 22px;
  height: 22px;
  margin-bottom: 4px;
  border: 2px solid color-mix(in srgb, var(--orange) 22%, transparent);
  border-top-color: var(--orange);
  border-radius: 50%;
  animation: im-settings-spin 0.75s linear infinite;
}

@keyframes im-settings-spin {
  to { transform: rotate(360deg); }
}

.im-runtime-placeholder {
  flex: 1;
  min-height: 420px;
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  justify-content: center;
  gap: 10px;
  padding: 28px;
  border: 1px dashed var(--border);
  border-radius: 10px;
  color: var(--text2);
  background: var(--bg3);
}

.im-runtime-placeholder strong {
  color: var(--text);
  font-size: 16px;
}

.im-runtime-placeholder p {
  margin: 0;
  line-height: 1.6;
}













.status-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 14px;
}

.theme-intro {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.theme-intro strong {
  color: var(--text);
  font-size: 14px;
}

.theme-intro p {
  max-width: 680px;
  margin: 0;
  color: var(--text3);
  font-size: 12px;
  line-height: 1.6;
}

.theme-options {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
  gap: 14px;
}

.theme-option {
  position: relative;
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: 11px;
  padding: 10px;
  border: 1px solid var(--border);
  border-radius: 10px;
  background: var(--bg3);
  color: var(--text2);
  text-align: left;
  transition: border-color 0.15s ease, background 0.15s ease, box-shadow 0.15s ease, transform 0.15s ease;
}

.theme-option:hover {
  border-color: var(--border-strong);
  background: var(--soft-fill-hover);
}

.theme-option:active {
  transform: translateY(1px);
}

.theme-option:focus-visible {
  outline: 2px solid var(--orange);
  outline-offset: 2px;
}

.theme-option.active {
  border-color: var(--orange);
  background: var(--orange-bg);
  box-shadow: 0 0 0 1px var(--orange-bg);
}

.theme-preview {
  position: relative;
  display: grid;
  grid-template-columns: 28% 72%;
  grid-template-rows: 22% 78%;
  width: 100%;
  aspect-ratio: 1.7;
  overflow: hidden;
  border: 1px solid rgba(98, 99, 108, 0.36);
  border-radius: 8px;
  background: #f4f4f5;
}

.theme-preview-titlebar {
  grid-column: 1 / -1;
  background: #ececee;
  border-bottom: 1px solid #d6d6da;
}

.theme-preview-sidebar {
  background: #e7e7e9;
  border-right: 1px solid #d6d6da;
}

.theme-preview-canvas {
  display: flex;
  flex-direction: column;
  gap: 7px;
  padding: 12px 10px;
  background: #fafafa;
}

.theme-preview-canvas i {
  display: block;
  width: 76%;
  height: 7px;
  border-radius: 3px;
  background: #dedee2;
}

.theme-preview-canvas i:nth-child(2) {
  width: 55%;
}

.theme-preview-canvas i:nth-child(3) {
  width: 84%;
  height: 24px;
  background: #f0f0f2;
  border: 1px solid #dddddf;
}

.theme-preview-dark {
  border-color: rgba(255, 255, 255, 0.18);
  background: #1a1a1f;
}

.theme-preview-dark .theme-preview-titlebar {
  background: #202027;
  border-color: #303039;
}

.theme-preview-dark .theme-preview-sidebar {
  background: #1d1d23;
  border-color: #303039;
}

.theme-preview-dark .theme-preview-canvas {
  background: #151519;
}

.theme-preview-dark .theme-preview-canvas i {
  background: #35353f;
}

.theme-preview-dark .theme-preview-canvas i:nth-child(3) {
  background: #222229;
  border-color: #393943;
}

.theme-preview-lake { border-color: #dfe4df; background: #ffffff; }
.theme-preview-lake .theme-preview-titlebar { background: #ffffff; border-color: #dfe4df; }
.theme-preview-lake .theme-preview-sidebar { background: #f5f6f5; border-color: #dfe4df; }
.theme-preview-lake .theme-preview-canvas { background: #ffffff; }
.theme-preview-lake .theme-preview-canvas i { background: #dfe4df; }
.theme-preview-lake .theme-preview-canvas i:nth-child(3) { background: #315c43; border-color: #315c43; }

.theme-preview-system {
  background: linear-gradient(90deg, #f4f4f5 0 50%, #1a1a1f 50%);
}

.theme-preview-system .theme-preview-titlebar {
  background: linear-gradient(90deg, #ececee 0 50%, #202027 50%);
}

.theme-preview-system .theme-preview-sidebar {
  background: linear-gradient(90deg, #e7e7e9 0 78%, #1d1d23 78%);
}

.theme-preview-system .theme-preview-canvas {
  background: linear-gradient(90deg, #fafafa 0 30.5%, #151519 30.5%);
}

.theme-preview-system .theme-preview-canvas i {
  background: linear-gradient(90deg, #dedee2 0 35%, #35353f 35%);
}

.theme-option-copy {
  display: flex;
  flex-direction: column;
  gap: 3px;
  padding: 0 2px;
}

.theme-option-copy strong {
  color: var(--text);
  font-size: 13px;
}

.theme-option-copy small {
  color: var(--text3);
  font-size: 11px;
}

.theme-option-check {
  position: absolute;
  right: 14px;
  bottom: 14px;
  display: grid;
  width: 18px;
  height: 18px;
  place-items: center;
  border-radius: 50%;
  background: var(--orange);
  color: var(--on-orange);
  font-size: 11px;
  font-weight: 800;
  opacity: 0;
  transform: scale(0.75);
  transition: opacity 0.15s ease, transform 0.15s ease;
}

.theme-option.active .theme-option-check {
  opacity: 1;
  transform: scale(1);
}

.appearance-note {
  padding: 12px 14px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--soft-fill);
  color: var(--text3);
  font-size: 11px;
  line-height: 1.55;
}

.readonly-grid {
  display: grid;
  gap: 10px;
}

.readonly-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 14px;
  min-height: 42px;
  padding: 12px 14px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--bg3);
}

.readonly-row span {
  color: var(--text3);
  font-size: 12px;
}

.readonly-row strong {
  color: var(--text);
  font-size: 13px;
  font-weight: 700;
  overflow-wrap: anywhere;
  text-align: right;
}




.status-card {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 14px;
  padding: 16px;
}

.status-card div {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.status-card span:first-child {
  color: var(--text3);
  font-size: 12px;
}

.status-card strong {
  color: var(--text);
  font-size: 15px;
  font-weight: 700;
}




.llm-provider-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  min-width: 0;
}

.inline-link-btn {
  flex: 0 0 auto;
  min-height: 30px;
  border: 1px solid color-mix(in srgb, var(--orange) 58%, var(--border-strong));
  border-radius: 8px;
  background: var(--orange-bg);
  color: var(--orange-text);
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 5px;
  padding: 6px 10px;
  font-size: 12px;
  font-weight: 700;
  white-space: nowrap;
}

.inline-link-btn:hover {
  background: rgba(var(--orange-rgb), 0.15);
}

.llm-list-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 14px;
  padding: 12px 14px;
  border: 1px solid var(--border);
  border-radius: 9px;
  background: var(--soft-fill);
}

.llm-list-toolbar p {
  margin: 0;
  color: var(--text3);
  font-size: 12px;
  line-height: 1.5;
}

.llm-provider-list {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.llm-provider-row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 14px;
  align-items: center;
  min-height: 92px;
  padding: 14px;
  border: 1px solid var(--border);
  border-radius: 9px;
  background: var(--bg3);
}

.llm-provider-content {
  min-width: 0;
  display: flex;
  align-items: flex-start;
  gap: 12px;
}

.llm-provider-logo {
  width: 76px;
  height: 36px;
  flex: 0 0 76px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--soft-fill);
  color: var(--text2);
  overflow: hidden;
  padding: 0;
  font: inherit;
  appearance: none;
  cursor: pointer;
}

.llm-provider-logo span {
  display: block;
  max-width: calc(100% - 12px);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 12px;
  font-weight: 850;
}

.llm-provider-logo img {
  display: block;
  width: auto;
  max-width: 100%;
  height: 28px;
  max-width: 68px;
  max-height: 100%;
  object-fit: contain;
}

.llm-provider-logo:hover,
.llm-provider-title-button:hover {
  filter: brightness(1.08);
}

.llm-provider-logo:focus-visible,
.llm-provider-title-button:focus-visible {
  outline: 2px solid rgba(var(--orange-rgb), 0.72);
  outline-offset: 3px;
}

.llm-provider-logo.brand-deepseek {
  color: #8fb0ff;
  border-color: rgba(112, 146, 255, 0.32);
  background:
    radial-gradient(circle at 22% 18%, rgba(143, 176, 255, 0.32), transparent 42%),
    linear-gradient(135deg, rgba(40, 58, 132, 0.58), rgba(22, 25, 42, 0.92));
}

.llm-provider-logo.brand-glm {
  color: #a7ffe1;
  border-color: rgba(44, 211, 169, 0.34);
  background:
    radial-gradient(circle at 18% 16%, rgba(124, 255, 220, 0.26), transparent 42%),
    linear-gradient(135deg, rgba(23, 127, 111, 0.58), rgba(16, 30, 38, 0.92));
}

.llm-provider-logo.brand-semir {
  color: #fff;
  border-color: rgba(72, 108, 214, 0.42);
  background: linear-gradient(135deg, #486cd6, #26449d);
}

.llm-provider-logo.brand-custom {
  color: var(--orange-text);
  border-color: rgba(var(--orange-rgb), 0.24);
  background: var(--orange-bg);
}

.llm-provider-logo.brand-custom span {
  max-width: calc(100% - 12px);
  font-size: 16px;
  font-weight: 850;
  line-height: 1;
}

.llm-provider-logo.with-image {
  border-color: transparent;
  background: transparent;
}

.llm-provider-main {
  display: flex;
  flex-direction: column;
  gap: 8px;
  min-width: 0;
}

.llm-row-title {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 7px;
  min-width: 0;
}

.llm-provider-title-button {
  flex: 0 1 auto;
  min-width: 0;
  max-width: min(100%, 420px);
  padding: 0;
  border: 0;
  background: transparent;
  color: var(--text);
  font-family: inherit;
  font-size: 14px;
  font-weight: 750;
  line-height: 1.25;
  cursor: pointer;
  text-align: left;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.llm-provider-main p {
  margin: 0;
  color: var(--text3);
  font-size: 12px;
  line-height: 1.45;
  overflow-wrap: anywhere;
}

.llm-model-preview {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 6px;
}

.llm-row-actions {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  flex-wrap: wrap;
  gap: 8px;
  max-width: 300px;
}

.llm-row-meta {
  width: 100%;
  color: var(--text3);
  font-size: 11px;
  text-align: right;
}

.btn-orange.compact,
.btn-ghost.compact,
.btn-danger.compact {
  min-height: 30px;
  padding: 6px 10px;
  border-radius: 7px;
  font-size: 12px;
}

.llm-model-chips { display: flex; gap: 6px; flex-wrap: wrap; }

.llm-model-chips .chip {
  font-size: 12px;
  padding: 3px 10px;
  border-radius: 999px;
  border: 1px solid var(--border-strong);
  color: var(--text2);
  background: var(--bg3);
  font-family: var(--font-mono, ui-monospace, monospace);
}

.llm-model-preview .chip,
.llm-model-chips .chip.muted {
  font-size: 11px;
  padding: 3px 8px;
  border-radius: 999px;
  border: 1px solid var(--border);
  color: var(--text2);
  background: var(--soft-fill);
  font-family: var(--font-mono, ui-monospace, monospace);
  max-width: min(100%, 360px);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.llm-model-preview .chip.muted {
  color: var(--text3);
  font-family: inherit;
}

.key-reset-guide {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 11px 12px;
  border: 1px solid var(--border);
  border-radius: 9px;
  background: var(--soft-fill);
}

.key-reset-guide strong {
  color: var(--text);
  font-size: 12px;
}

.key-reset-guide ol {
  margin: 0;
  padding-left: 18px;
  color: var(--text3);
  font-size: 11px;
  line-height: 1.55;
}

.key-reset-guide li {
  padding-left: 2px;
  overflow-wrap: anywhere;
}

.settings-modal-backdrop {
  position: fixed;
  inset: 0;
  z-index: 1000;
  display: grid;
  place-items: center;
  padding: 28px;
  background: rgba(0, 0, 0, 0.58);
  backdrop-filter: blur(10px);
}

.settings-modal {
  width: min(680px, calc(100vw - 36px));
  max-height: min(760px, calc(100vh - 36px));
  display: flex;
  flex-direction: column;
  overflow: hidden;
  border: 1px solid var(--border-strong);
  border-radius: 10px;
  background: var(--bg2);
  box-shadow: 0 24px 80px rgba(0, 0, 0, 0.36);
}

.settings-modal-head,
.settings-modal-actions {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 14px;
  padding: 16px 18px;
  border-bottom: 1px solid var(--border);
}

.settings-modal-head h3 {
  margin: 0;
  color: var(--text);
  font-size: 18px;
  line-height: 1.25;
}

.settings-modal-body {
  display: flex;
  flex-direction: column;
  gap: 14px;
  min-height: 0;
  overflow-y: auto;
  padding: 18px;
}

.settings-modal-actions {
  justify-content: flex-end;
  border-top: 1px solid var(--border);
  border-bottom: 0;
}










.settings-advanced-panel,
.settings-subsection {
  border: 1px solid var(--border);
  border-radius: 9px;
  background: var(--soft-fill);
}

.settings-advanced-panel {
  overflow: hidden;
}

.settings-advanced-panel summary {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  min-height: 42px;
  padding: 11px 13px;
  color: var(--text2);
  cursor: pointer;
  list-style: none;
  user-select: none;
}

.settings-advanced-panel summary::-webkit-details-marker {
  display: none;
}

.settings-advanced-panel summary::after {
  content: '展开';
  flex: 0 0 auto;
  color: var(--orange-text);
  font-size: 11px;
  font-weight: 750;
}

.settings-advanced-panel[open] summary {
  border-bottom: 1px solid var(--border);
  background: var(--soft-fill);
}

.settings-advanced-panel[open] summary::after {
  content: '收起';
}

.settings-advanced-panel summary span,
.settings-subsection header strong {
  color: var(--text);
  font-size: 13px;
  font-weight: 750;
}

.settings-advanced-panel summary small,
.settings-subsection header span {
  color: var(--text3);
  font-size: 11px;
  line-height: 1.45;
}

.settings-advanced-body {
  padding: 13px;
}

.settings-subsection {
  display: flex;
  flex-direction: column;
  gap: 13px;
  padding: 14px;
}

.settings-subsection header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
}

.settings-subsection header div {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
}

.input-row,
.split-fields {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 8px;
}

.split-fields {
  grid-template-columns: repeat(2, minmax(0, 1fr));
}







.textarea {
  width: 100%;
  min-width: 0;
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 10px 12px;
  color: var(--text);
  font-size: 13px;
  outline: none;
  transition: border-color 0.15s ease, background 0.15s ease;
  min-height: 132px;
  resize: vertical;
  line-height: 1.45;
  font-family: var(--font-mono, ui-monospace, SFMono-Regular, Menlo, Consolas, monospace);
}




.textarea:focus {
  border-color: var(--orange);
  background: var(--input-focus);
}










.path-note p {
  color: var(--text2);
  font-family: 'SF Mono', 'Fira Code', monospace;
  font-size: 11px;
}



















.inline-msg,
.msg,
.test-result {
  font-size: 12px;
  line-height: 1.4;
}

.inline-msg,
.msg {
  margin: 0;
  padding: 7px 10px;
  border-radius: 7px;
}

.inline-msg.ok,
.msg.ok,
.test-result.ok {
  color: var(--green);
}

.inline-msg.ok,
.msg.ok {
  background: rgba(74, 222, 128, 0.1);
}

.inline-msg.err,
.msg.err,
.test-result.err {
  color: var(--red);
}

.inline-msg.err,
.msg.err {
  background: rgba(248, 113, 113, 0.1);
}

.cloud-address-hint {
  margin: 6px 0 0;
  font-size: 12px;
  line-height: 1.5;
}

.cloud-address-hint.ok {
  color: var(--green);
}

.cloud-address-hint.warn {
  color: var(--orange-text);
}

.guide-block {
  min-width: 0;
  padding: 14px;
}

.guide-title {
  margin: 0 0 10px;
  color: var(--orange-text);
  font-size: 12px;
  font-weight: 700;
}

.guide-code {
  font-family: 'SF Mono', 'Fira Code', monospace;
  font-size: 11px;
  background: var(--bg);
  border: 1px solid var(--subtle-border);
  border-radius: 7px;
  padding: 11px 12px;
  margin: 0;
  color: var(--text2);
  white-space: pre;
  overflow-x: auto;
  line-height: 1.6;
}

.key-states {
  display: flex;
  gap: 8px;
}

.key-pill {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 38px;
  height: 26px;
  border-radius: 7px;
  border: 1px solid var(--border);
  font-size: 12px;
  font-weight: 800;
}

.key-pill.on {
  color: var(--green);
  background: rgba(74, 222, 128, 0.09);
  border-color: rgba(74, 222, 128, 0.18);
}

.key-pill.off {
  color: var(--text3);
  background: var(--soft-fill);
}

.key-pill.neutral {
  color: var(--text2);
  background: rgba(148, 163, 184, 0.12);
  border-color: rgba(148, 163, 184, 0.18);
}

.check-row {
  display: inline-flex;
  align-items: center;
  gap: 9px;
  width: fit-content;
  color: var(--text2);
  font-size: 12px;
}

.check-row input {
  width: 15px;
  height: 15px;
  accent-color: var(--orange);
}

.capability-list {
  display: flex;
  flex-wrap: wrap;
  gap: 10px 16px;
}

.cloud-actions {
  flex-wrap: wrap;
}



















:deep(.panel-actions) {
  display: flex;
  align-items: center;
  gap: 10px;
  min-height: 38px;
}

:deep(.panel-actions .btn-orange) {
  padding: 10px 18px;
  border: none;
  border-radius: 8px;
  background: var(--orange);
  color: var(--on-orange);
  font-size: 12px;
  font-weight: 700;
  transition: background 0.15s ease, opacity 0.15s ease, transform 0.15s ease;
}

:deep(.panel-actions .btn-orange:hover:not(:disabled)) {
  background: var(--orange-hover);
}

:deep(.panel-actions .btn-orange:active) {
  transform: translateY(1px);
}

:deep(.panel-actions .btn-orange:disabled) {
  opacity: 0.45;
  cursor: not-allowed;
}

:deep(.panel-actions .msg) {
  display: inline-flex;
  align-items: center;
  width: fit-content;
  max-width: 100%;
  margin: 0;
  padding: 7px 10px;
  border-radius: 7px;
  font-size: 12px;
  line-height: 1.4;
}

:deep(.panel-actions .msg.ok) {
  background: rgba(74, 222, 128, 0.1);
  color: var(--green);
}

:deep(.panel-actions .msg.err) {
  background: rgba(248, 113, 113, 0.1);
  color: var(--red);
}

@media (max-width: 980px) {
  .theme-options {
    grid-template-columns: 1fr;
  }

  .theme-preview {
    aspect-ratio: 2.25;
  }

  .settings-workspace {
    grid-template-columns: 200px minmax(0, 1fr);
  }

  .settings-menu { padding: 16px 10px; }

  .settings-content { padding: 28px 24px; }

  .panel-layout,
  .guide-grid,
  .status-grid,
  .split-fields {
    grid-template-columns: 1fr;
  }

  .llm-list-toolbar,
  .llm-provider-row {
    grid-template-columns: 1fr;
    align-items: stretch;
  }

  .llm-list-toolbar {
    display: grid;
  }

  .llm-row-actions {
    justify-content: flex-start;
    max-width: none;
  }

  .llm-row-meta {
    width: auto;
    text-align: left;
  }

  .settings-modal-backdrop {
    padding: 12px;
  }
}
</style>

<style scoped>
.archive-panel { gap: 12px; }
.archive-panel > p { margin: 0; font-size: 13px; }
.archive-panel .panel-head { margin-bottom: 0; }
.archive-panel .archived-session-row { display: flex; align-items: center; gap: 12px; padding: 8px 0; min-height: 48px; box-sizing: border-box; border-bottom: 1px solid var(--border-color, #383842); }
.archived-session-info { flex: 1; min-width: 0; }
.archived-session-info strong, .archived-session-info small { display: block; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.archived-session-info strong { font-size: 13px; font-weight: 500; }
.archive-meta { display: flex; gap: 12px; align-items: baseline; margin-top: 2px; min-width: 0; font-size: 11px; opacity: .65; }
.archive-meta time { flex-shrink: 0; }
.archived-session-info small { font-size: 11px; min-width: 0; }
@media (max-width: 800px) { .archive-meta { flex-wrap: wrap; gap: 2px 12px; } }
.archive-panel .archived-session-row .btn-ghost, .archive-pagination .btn-ghost { padding: 5px 10px; min-height: 30px; font-size: 12px; flex-shrink: 0; }
.archive-pagination { display: flex; align-items: center; justify-content: space-between; gap: 12px; flex-wrap: wrap; font-size: 12px; padding-top: 4px; }
.archive-pagination > div { display: flex; align-items: center; gap: 10px; }
</style>

<style scoped>
.llm-provider-logo.brand-modeljetty { background: #fff; border: 1px solid #ddd; }
.llm-provider-logo.brand-modeljetty img { width: 28px; height: 28px; object-fit: contain; }
.llm-provider-logo.brand-crawshrimp img { width: 28px; height: 28px; border-radius: 0; object-fit: contain; }
</style>

<style scoped src="./settingsWorkspace.css"></style>

<style scoped src="../styles/modelProviders.css"></style>

<style scoped>
.llm-provider-modal .settings-modal-body { flex: 0 1 auto; }
.llm-provider-modal .field label { flex-direction: row; }
.llm-provider-modal .llm-editor-heading { display: flex; align-items: center; gap: 13px; min-width: 0; }
.llm-editor-mark { width: 42px; height: 42px; display: grid; place-items: center; border-radius: 10px; color: var(--orange-text); background: var(--orange-bg); flex-shrink: 0; }
.llm-provider-modal .llm-editor-heading h3 { font-size: 19px; }
.llm-provider-modal .llm-editor-heading p { font-size: 12px; margin: 4px 0 0; color: var(--text2); }
.llm-provider-modal .llm-provider-tabs { gap: 4px; margin: 18px 24px 0; padding: 4px; border: 1px solid var(--border); background: var(--bg); border-radius: 9px; }
.llm-provider-modal .llm-provider-tabs button { flex: 1; justify-content: center; min-height: 36px; padding: 7px 12px; border: 0; border-radius: 6px; font-size: 13px; color: var(--text2); background: transparent; }
.llm-provider-modal .llm-provider-tabs button[aria-selected=true] { color: var(--text); background: var(--bg3); }
.llm-provider-modal .llm-provider-tabs button[aria-selected=true] svg { color: var(--orange-text); }
.llm-provider-modal .llm-provider-tabs button span { padding: 1px 6px; background: var(--bg4); }
.llm-section-intro h4 { margin: 0 0 5px; color: var(--text); font-size: 13px; font-weight: 650; }
.llm-section-intro p { margin: 0; font-size: 12px; line-height: 1.6; color: var(--text2); }
.llm-section-divider { border-top: 1px solid var(--border); padding-top: 20px; margin-top: 2px; }
.llm-provider-modal .field { margin: 0; display: flex; flex-direction: column; gap: 8px; min-width: 0; }
.llm-provider-modal .field label { display: flex; align-items: baseline; gap: 8px; font-size: 12px; }
.llm-field-alias { font-weight: 400; color: var(--text2); font-size: 11px; }
.llm-provider-modal .field-hint { margin: 0; font-size: 12px; line-height: 1.6; }
.llm-provider-modal .split-fields { gap: 16px; }
.llm-provider-modal .model-config-body :is(input,select) { min-height: 40px; padding: 9px 11px; font-size: 13px; }
.llm-provider-modal .llm-model-workspace { min-height: 280px; }
@media (max-width: 640px) { .llm-provider-modal .llm-provider-tabs { margin: 16px 18px 0; } .llm-provider-modal .split-fields { grid-template-columns: 1fr; } }
</style>
