<template>
  <div class="view">
    <header class="view-header">
      <div>
        <h2>设置</h2>
        <p>按配置域分开管理，每个子菜单独立保存。</p>
      </div>
    </header>

    <div class="settings-workspace">
      <aside class="settings-menu" aria-label="设置配置域">
        <div v-for="group in menuGroups" :key="group.id" class="menu-cluster">
          <button
            type="button"
            :class="['menu-group', { active: activeGroupId === group.id }]"
            @click="selectGroup(group.id)"
          >
            <span class="menu-icon">{{ group.icon }}</span>
            <span class="menu-copy">
              <strong>{{ group.label }}</strong>
              <small>{{ group.desc }}</small>
            </span>
          </button>
          <Transition name="settings-children">
            <div v-if="activeGroupId === group.id" class="menu-children">
              <button
                v-for="child in group.children"
                :key="child.id"
                type="button"
                :class="['menu-child', { active: activePanelId === child.id }]"
                @click="selectPanel(group.id, child.id)"
              >
                <span>{{ child.label }}</span>
                <span
                  v-if="child.statusKey || child.statusKeys?.length"
                  :class="['mini-state', isMenuChildConfigured(child) ? 'on' : 'off']"
                >
                  {{ isMenuChildConfigured(child) ? '已配' : '未配' }}
                </span>
              </button>
            </div>
          </Transition>
        </div>
      </aside>

      <main class="settings-content">
        <Transition name="settings-panel" mode="out-in">
        <section v-if="activePanelId === 'appearance-theme'" key="appearance-theme" class="panel">
          <div class="panel-head">
            <div>
              <p class="panel-kicker">外观</p>
              <h3>主题</h3>
            </div>
            <span class="badge neutral">
              当前为{{ props.effectiveTheme === 'light' ? '浅色' : '深色' }}
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
            <span>品牌橙色、状态色和功能布局保持不变，仅调整背景、文字、边框和浮层层级。</span>
          </div>
        </section>

        <section v-else-if="activePanelId === 'connection-overview'" key="connection-overview" class="panel">
          <div class="panel-head">
            <div>
              <p class="panel-kicker">连接</p>
              <h3>服务状态</h3>
            </div>
            <span :class="['badge', props.status?.api && props.status?.chrome ? 'on' : 'neutral']">
              {{ props.status?.api && props.status?.chrome ? '可运行' : '待检查' }}
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
              <span :class="['badge', props.status?.chrome ? 'on' : 'off']">
                {{ props.status?.chrome ? '已连接' : '未连接' }}
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
              <p v-if="!props.status?.chrome && props.status?.chromeDiagnostic?.message" class="inline-msg err">
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
                  {{ launching ? '修复中...' : '修复 Chrome 连接' }}
                </button>
                <button class="btn-ghost" @click="openDiagnosticLog">打开诊断日志</button>
              </div>
            </div>
            <div class="side-note">
              <strong>连接策略</strong>
              <p>核心服务会重新检查数据目录和端口。Chrome 修复只会关闭身份确认属于抓虾的专用实例，不会结束未知进程。</p>
              <p v-if="props.status?.dataDir">当前数据目录：{{ props.status.dataDir }}</p>
            </div>
          </div>
        </section>

        <section v-else-if="activePanelId === 'notify-dingtalk'" key="notify-dingtalk" class="panel">
          <div class="panel-head">
            <div>
              <p class="panel-kicker">通知</p>
              <h3>钉钉机器人</h3>
            </div>
            <span :class="['badge', isFieldConfigured('notify.dingtalk_webhook') ? 'on' : 'off']">
              {{ isFieldConfigured('notify.dingtalk_webhook') ? '已配置' : '未配置' }}
            </span>
          </div>

          <div class="panel-layout">
            <div class="form-stack">
              <div class="field">
                <label>Webhook URL</label>
                <input
                  v-model="cfg['notify.dingtalk_webhook']"
                  placeholder="https://oapi.dingtalk.com/robot/send?access_token=..."
                  class="input"
                />
              </div>
              <div class="field">
                <label>加签密钥（可选）</label>
                <input
                  v-model="cfg['notify.dingtalk_secret']"
                  placeholder="SEC..."
                  class="input"
                  type="password"
                  autocomplete="off"
                />
              </div>
              <PanelActions panel-id="notify-dingtalk" @save="savePanel('notify-dingtalk')" />
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

        <section v-else-if="activePanelId === 'application-update'" key="application-update" class="panel">
          <div class="panel-head">
            <div>
              <p class="panel-kicker">应用</p>
              <h3>桌面更新</h3>
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
              <h3>飞书机器人</h3>
            </div>
            <span :class="['badge', isFieldConfigured('notify.feishu_webhook') ? 'on' : 'off']">
              {{ isFieldConfigured('notify.feishu_webhook') ? '已配置' : '未配置' }}
            </span>
          </div>

          <div class="panel-layout">
            <div class="form-stack">
              <div class="field">
                <label>Webhook URL</label>
                <input
                  v-model="cfg['notify.feishu_webhook']"
                  placeholder="https://open.feishu.cn/open-apis/bot/v2/hook/..."
                  class="input"
                />
              </div>
              <PanelActions panel-id="notify-feishu" @save="savePanel('notify-feishu')" />
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
              <h3>自定义 Webhook</h3>
            </div>
            <span :class="['badge', isFieldConfigured('notify.custom_webhook') ? 'on' : 'off']">
              {{ isFieldConfigured('notify.custom_webhook') ? '已配置' : '未配置' }}
            </span>
          </div>

          <div class="panel-layout">
            <div class="form-stack">
              <div class="field">
                <label>Webhook URL（POST JSON）</label>
                <input
                  v-model="cfg['notify.custom_webhook']"
                  placeholder="https://your-server/hook"
                  class="input"
                />
              </div>
              <PanelActions panel-id="notify-custom" @save="savePanel('notify-custom')" />
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
              <h3>脚本调用说明</h3>
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

        <section v-else-if="activePanelId === 'storage-data'" key="storage-data" class="panel">
          <div class="panel-head">
            <div>
              <p class="panel-kicker">存储</p>
              <h3>数据目录</h3>
            </div>
            <span class="badge neutral">本机</span>
          </div>

          <div class="panel-layout">
            <div class="form-stack">
              <div class="field">
                <label>数据目录 (CRAWSHRIMP_DATA)</label>
                <div class="input-row">
                  <input v-model="cfg['data_dir']" placeholder="默认自动选择可写目录" class="input" />
                  <button class="btn-ghost" @click="browseDir">选择</button>
                </div>
              </div>
              <PanelActions panel-id="storage-data" @save="savePanel('storage-data')" />
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
              <h3>ODPS 写入接口</h3>
            </div>
            <span :class="['badge', isFieldConfigured('odps.app_code') ? 'on' : 'off']">
              {{ isFieldConfigured('odps.app_code') ? '已配置' : '未配置' }}
            </span>
          </div>

          <div class="panel-layout">
            <div class="form-stack">
              <div class="field">
                <label>ODPS AppCode</label>
                <input
                  v-model="cfg['odps.app_code']"
                  placeholder="用于 Authorization: APPCODE ..."
                  class="input"
                  type="password"
                  autocomplete="off"
                />
              </div>
              <PanelActions panel-id="sync-odps" @save="savePanel('sync-odps')" />
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
              <h3>1XM 图片模型</h3>
            </div>
            <span :class="['badge', hasAnyFieldConfigured(ai1xmKeyFields) ? 'on' : 'off']">
              {{ hasAnyFieldConfigured(ai1xmKeyFields) ? '已配置' : '未配置' }}
            </span>
          </div>

          <div class="panel-layout">
            <div class="form-stack">
              <div class="field">
                <label>1XM Base URL</label>
                <input
                  v-model="cfg['ai.1xm.base_url']"
                  placeholder="https://one-xm-proxy.crawshrimp.com/v1"
                  class="input"
                />
              </div>
              <div class="split-fields">
                <div class="field">
                  <label>GPT Image 2K Key</label>
                  <input
                    v-model="cfg['ai.1xm.gpt_image_2k_key']"
                    placeholder="sk-..."
                    class="input"
                    type="password"
                    autocomplete="off"
                  />
                </div>
                <div class="field">
                  <label>GPT Image 4K Key</label>
                  <input
                    v-model="cfg['ai.1xm.gpt_image_4k_key']"
                    placeholder="sk-..."
                    class="input"
                    type="password"
                    autocomplete="off"
                  />
                </div>
              </div>
              <div class="split-fields">
                <div class="field">
                  <label>Gemini 3.1 Flash Image Preview Key</label>
                  <input
                    v-model="cfg['ai.1xm.gemini_3_1_flash_image_preview_key']"
                    placeholder="sk-..."
                    class="input"
                    type="password"
                    autocomplete="off"
                  />
                </div>
                <div class="field">
                  <label>Gemini 3 Pro Image Preview Key</label>
                  <input
                    v-model="cfg['ai.1xm.gemini_3_pro_image_preview_key']"
                    placeholder="sk-..."
                    class="input"
                    type="password"
                    autocomplete="off"
                  />
                </div>
              </div>
              <PanelActions panel-id="ai-1xm" @save="savePanel('ai-1xm')" />
            </div>
            <div class="side-note">
              <strong>密钥状态</strong>
              <div class="key-states">
                <span :class="['key-pill', isFieldConfigured('ai.1xm.gpt_image_2k_key') ? 'on' : 'off']">2K</span>
                <span :class="['key-pill', isFieldConfigured('ai.1xm.gpt_image_4k_key') ? 'on' : 'off']">4K</span>
                <span :class="['key-pill', isFieldConfigured('ai.1xm.gemini_3_1_flash_image_preview_key') ? 'on' : 'off']">G31</span>
                <span :class="['key-pill', isFieldConfigured('ai.1xm.gemini_3_pro_image_preview_key') ? 'on' : 'off']">G3P</span>
              </div>
              <p>密钥只保存在本机抓虾配置中，任务运行时由后端读取。</p>
            </div>
          </div>
        </section>

        <section v-else-if="activePanelId === 'ai-agent'" key="ai-agent" class="panel">
          <div class="panel-head">
            <div>
              <p class="panel-kicker">AI 能力</p>
              <h3>智能体运行时</h3>
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
                <p v-if="agentRuntime.web_url" class="field-hint">会话界面:{{ agentRuntime.web_url }}</p>
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
              <h3>文本大模型网关</h3>
            </div>
            <span :class="['badge', isLlmConfigured(cfg) ? 'on' : 'off']">
              {{ isLlmConfigured(cfg) ? '已配置' : '未配置' }}
            </span>
          </div>

          <div class="form-stack">
            <div class="llm-list-toolbar">
              <p>
                每个 Provider 独立保存 API Key 与 Base URL；已配置的旧森马共享 Key 会自动作为三条森马网关的默认 Key 兜底。
              </p>
              <button class="btn-orange compact" type="button" @click="openLlmProviderModal()">
                添加 Provider
              </button>
            </div>

            <div class="llm-provider-list" aria-label="文本大模型 Provider 列表">
              <article v-for="provider in llmProviders" :key="provider.id" class="llm-provider-row">
                <div class="llm-provider-content">
                  <button
                    :class="['llm-provider-logo', `brand-${provider.brand}`, { 'with-image': provider.logoImage }]"
                    :title="provider.name"
                    :aria-label="`编辑 ${provider.name}`"
                    type="button"
                    @click="openLlmProviderModal(provider.id)"
                  >
                    <img v-if="provider.logoImage" :src="provider.logoImage" alt="" />
                    <span v-else>{{ provider.logoText }}</span>
                  </button>
                  <div class="llm-provider-main">
                    <div class="llm-row-title">
                      <button
                        class="llm-provider-title-button"
                        type="button"
                        @click="openLlmProviderModal(provider.id)"
                      >
                        {{ provider.name }}
                      </button>
                      <span :class="['key-pill', provider.configured ? 'on' : 'off']">
                        {{ provider.configured ? '已配 Key' : '未配 Key' }}
                      </span>
                      <span class="key-pill neutral">{{ provider.compatibility }}</span>
                      <span v-if="provider.isCustom" class="key-pill neutral">自定义</span>
                      <span v-if="provider.isDefault" class="key-pill on">默认</span>
                    </div>
                    <p>{{ provider.baseUrl || '未填写 Base URL' }}</p>
                    <div class="llm-model-preview">
                      <span v-for="model in provider.previewModels" :key="model" class="chip">{{ model }}</span>
                      <span v-if="provider.modelCount > provider.previewModels.length" class="chip muted">
                        +{{ provider.modelCount - provider.previewModels.length }}
                      </span>
                    </div>
                  </div>
                </div>
                <div class="llm-row-actions">
                  <span class="llm-row-meta">{{ provider.modelCount }} 个模型</span>
                  <button
                    v-if="!provider.isDefault && provider.firstModel"
                    class="btn-ghost compact"
                    type="button"
                    @click="setLlmDefaultModel(provider.firstModel)"
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

            <PanelActions panel-id="ai-llm" @save="savePanel('ai-llm')" />
          </div>
        </section>

        <section v-else-if="activePanelId === 'ai-video'" key="ai-video" class="panel">
          <div class="panel-head">
            <div>
              <p class="panel-kicker">AI 视频</p>
              <h3>视频模型 Provider</h3>
            </div>
            <span :class="['badge', hasAnyFieldConfigured(aiVideoKeyFields) ? 'on' : 'off']">
              {{ hasAnyFieldConfigured(aiVideoKeyFields) ? '已配置' : '未配置' }}
            </span>
          </div>

          <div class="panel-layout">
            <div class="form-stack">
              <div class="split-fields">
                <div class="field">
                  <label>Seedance API Key</label>
                  <input
                    v-model="cfg['ai.video.seedance_api_key']"
                    class="input"
                    type="password"
                    autocomplete="new-password"
                    placeholder="sk-..."
                    @focus="selectInputText"
                  />
                </div>
                <div class="field">
                  <label>Seedance Base URL</label>
                  <input
                    v-model="cfg['ai.video.seedance_base_url']"
                    class="input"
                    :placeholder="aiVideoConnectionPlaceholder('ai.video.seedance_base_url')"
                  />
                  <p class="field-hint">{{ aiVideoConnectionHint('ai.video.seedance_base_url') }}</p>
                </div>
              </div>
              <div class="split-fields">
                <div class="field">
                  <label>百炼 API key（HappyHorse、Kling、PixVerse）</label>
                  <input
                    v-model="cfg['ai.video.bailian_api_key']"
                    class="input"
                    type="password"
                    autocomplete="new-password"
                    placeholder="sk-..."
                    @focus="selectInputText"
                  />
                </div>
                <div class="field">
                  <label>百炼 Base URL（可选）</label>
                  <input
                    v-model="cfg['ai.video.bailian_base_url']"
                    class="input"
                    :placeholder="aiVideoConnectionPlaceholder('ai.video.bailian_base_url')"
                  />
                  <p class="field-hint">{{ aiVideoConnectionHint('ai.video.bailian_base_url') }}</p>
                </div>
              </div>

              <details class="settings-advanced-panel">
                <summary>
                  <span>更多 Provider 配置</span>
                  <small>业务空间 ID / 区域</small>
                </summary>
                <div class="settings-advanced-body split-fields">
                  <div class="field">
                    <label>百炼业务空间 ID</label>
                    <input
                      v-model="cfg['ai.video.bailian_workspace_id']"
                      class="input"
                      placeholder="可选：留空使用区域默认 endpoint"
                    />
                    <p class="field-hint">填写后百炼默认 endpoint 会按业务空间 ID + 区域自动生成。</p>
                  </div>
                  <div class="field">
                    <label>百炼区域</label>
                    <input
                      v-model="cfg['ai.video.bailian_region']"
                      class="input"
                      :placeholder="aiVideoConnectionPlaceholder('ai.video.bailian_region')"
                    />
                    <p class="field-hint">{{ aiVideoConnectionHint('ai.video.bailian_region') }}</p>
                  </div>
                </div>
              </details>

              <section class="settings-subsection">
                <header>
                  <div>
                    <strong>OSS 上传配置</strong>
                    <span>仅用于把本地素材上传为百炼临时 OSS 地址，不参与视频生成网关调用。</span>
                  </div>
                  <span :class="['key-pill', isFieldConfigured('ai.video.bailian_upload_api_key') ? 'on' : 'off']">OSS</span>
                </header>
                <div class="split-fields">
                  <div class="field">
                    <label>百炼 OSS 上传 API Key</label>
                    <input
                      v-model="cfg['ai.video.bailian_upload_api_key']"
                      class="input"
                      type="password"
                      autocomplete="new-password"
                      placeholder="sk-..."
                      @focus="selectInputText"
                    />
                  </div>
                  <div class="field">
                    <label>百炼 OSS 上传 Base URL</label>
                    <input
                      v-model="cfg['ai.video.bailian_uploads_url']"
                      class="input"
                      :placeholder="aiVideoConnectionPlaceholder('ai.video.bailian_uploads_url')"
                    />
                    <p class="field-hint">{{ aiVideoConnectionHint('ai.video.bailian_uploads_url') }}</p>
                  </div>
                </div>
              </section>
              <PanelActions panel-id="ai-video" @save="savePanel('ai-video')" />
            </div>
            <div class="side-note">
              <strong>本机凭据</strong>
              <div class="key-states">
                <span :class="['key-pill', isFieldConfigured('ai.video.seedance_api_key') ? 'on' : 'off']">S</span>
                <span :class="['key-pill', isFieldConfigured('ai.video.bailian_api_key') ? 'on' : 'off']">B</span>
                <span :class="['key-pill', isFieldConfigured('ai.video.bailian_upload_api_key') ? 'on' : 'off']">OSS</span>
              </div>
              <p>密钥只保存在本机抓虾配置中，运行视频任务时注入共享能力进程；工作流页面、任务参数和日志不会展示密钥。</p>
            </div>
          </div>
        </section>

        <section v-else-if="activePanelId === 'im-bots'" key="im-bots" class="panel im-panel">
          <div class="panel-head">
            <div>
              <p class="panel-kicker">IM机器人</p>
              <h3>机器人接入</h3>
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

        <section v-else-if="activePanelId === 'cloud-approval'" key="cloud-approval" class="panel">
          <div class="panel-head">
            <div>
              <p class="panel-kicker">云端审批</p>
              <h3>云端审批</h3>
            </div>
            <span :class="['badge', cloudStatus?.configured ? 'on' : 'off']">
              {{ cloudStatus?.configured ? '已配置' : '未配置' }}
            </span>
          </div>

          <div class="panel-layout">
            <div class="form-stack">
              <div class="field">
                <label>云端地址</label>
                <input
                  v-model="cfg['cloud_approval.base_url']"
                  class="input"
                  readonly
                />
                <p :class="['cloud-address-hint', cloudAddressHintOk ? 'ok' : 'warn']">
                  {{ cloudAddressHint }}
                </p>
              </div>
              <div class="field">
                <label>注册 token</label>
                <input
                  v-model="cfg['cloud_approval.registration_token']"
                  placeholder="用于首次注册任务机"
                  class="input"
                  type="password"
                  autocomplete="off"
                />
              </div>
              <div class="field">
                <label>任务机名称</label>
                <input
                  v-model="cfg['cloud_approval.machine_name']"
                  placeholder="例如：设计部任务机"
                  class="input"
                />
              </div>
              <div class="field">
                <label>任务能力</label>
                <div class="capability-list">
                  <label v-for="option in cloudCapabilityOptions" :key="option.value" class="check-row">
                    <input
                      v-model="cfg['cloud_approval.capabilities']"
                      type="checkbox"
                      :value="option.value"
                    />
                    <span>{{ option.label }}</span>
                  </label>
                </div>
              </div>
              <label class="check-row">
                <input v-model="cfg['cloud_approval.machine_enabled']" type="checkbox" />
                <span>启用任务机</span>
              </label>
              <div class="action-strip cloud-actions">
                <button class="btn-orange" :disabled="cloudBusy.config" @click="saveCloudApprovalConfig">
                  {{ cloudBusy.config ? '保存中...' : '保存配置' }}
                </button>
                <button class="btn-ghost" :disabled="cloudBusy.enroll" @click="enrollCloudMachine">
                  {{ cloudBusy.enroll ? '注册中...' : '注册任务机' }}
                </button>
                <button class="btn-ghost" :disabled="cloudBusy.start || cloudStatus?.running" @click="startCloudMachine">
                  {{ cloudBusy.start ? '启动中...' : '启动' }}
                </button>
                <button class="btn-ghost" :disabled="cloudBusy.stop || !cloudStatus?.running" @click="stopCloudMachine">
                  {{ cloudBusy.stop ? '停止中...' : '停止' }}
                </button>
              </div>
              <p v-if="cloudMsg" :class="['inline-msg', cloudMsgOk ? 'ok' : 'err']">{{ cloudMsg }}</p>
            </div>
            <div class="side-note">
              <strong>任务机状态</strong>
              <div class="key-states">
                <span :class="['key-pill', cloudStatus?.running ? 'on' : 'off']">
                  {{ cloudStatus?.running ? '在线' : '离线' }}
                </span>
                <span :class="['key-pill', cloudStatus?.token_present ? 'on' : 'off']">
                  {{ cloudStatus?.token_present ? '已注册' : '未注册' }}
                </span>
                <span class="key-pill neutral">{{ cloudStatus?.health || 'stopped' }}</span>
              </div>
              <p>状态只显示是否已注册、运行状态和任务机 ID；长期任务机凭证不会在界面展示。</p>
              <p v-if="cloudStatus?.machine_id">任务机 ID：{{ cloudStatus.machine_id }}</p>
              <p v-if="cloudStatus?.base_url">云端地址：{{ cloudStatus.base_url }}</p>
              <p v-if="cloudStatus?.capabilities?.length">任务能力：{{ cloudStatus.capabilities.join(', ') }}</p>
            </div>
          </div>
        </section>
        </Transition>
      </main>
    </div>

    <Teleport to="body">
      <div v-if="llmProviderModal.open" class="settings-modal-backdrop" @click.self="closeLlmProviderModal">
        <section class="settings-modal" role="dialog" aria-modal="true" aria-labelledby="llm-provider-modal-title">
          <header class="settings-modal-head">
            <div>
              <p class="panel-kicker">{{ llmProviderModal.isNew ? '新增 Provider' : '编辑 Provider' }}</p>
              <h3 id="llm-provider-modal-title">{{ llmProviderDraft.name || '自定义 Provider' }}</h3>
            </div>
            <button class="btn-ghost compact" type="button" @click="closeLlmProviderModal">关闭</button>
          </header>

          <div class="settings-modal-body">
            <div class="split-fields">
              <div class="field">
                <label>Provider 名称</label>
                <input
                  v-model="llmProviderDraft.name"
                  class="input"
                  :readonly="llmProviderModal.isBuiltin"
                  placeholder="例如：OpenRouter / 内部 Claude 网关"
                />
              </div>
              <div class="field">
                <label>兼容协议</label>
                <select v-model="llmProviderDraft.protocol" class="select" :disabled="llmProviderModal.isBuiltin">
                  <option value="openai">OpenAI 兼容</option>
                  <option value="anthropic">Anthropic 兼容</option>
                </select>
              </div>
            </div>

            <div class="field">
              <label>Base URL</label>
              <input v-model="llmProviderDraft.baseUrl" class="input" placeholder="https://api.example.com/v1" />
            </div>

            <div class="field">
              <label>API Key</label>
              <input
                v-model="llmProviderDraft.apiKey"
                class="input"
                type="password"
                autocomplete="new-password"
                placeholder="留空保持当前 Key；输入新值会覆盖"
                @focus="selectInputText"
              />
              <p class="field-hint">保存后立即落盘，页面只显示“已配 Key”，不会把真实密钥读回设置页。</p>
            </div>

            <div v-if="llmProviderModal.isBuiltin" class="field">
              <label>模型</label>
              <div class="llm-model-chips">
                <span v-for="model in llmProviderDraft.modelIds" :key="model" class="chip">{{ model }}</span>
              </div>
            </div>

            <div v-else class="field">
              <label>模型 ID</label>
              <textarea
                v-model="llmProviderDraft.modelsText"
                class="textarea"
                rows="7"
                placeholder="每行一个模型 ID，例如：&#10;gpt-5.5&#10;claude-sonnet-5"
              ></textarea>
              <p class="field-hint">自定义模型默认按“支持工具 + 文本输入”的保守能力注册；需要视觉能力时后续可继续扩展这里。</p>
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
                <li>点击“保存 Provider”；旧 Key 会被覆盖，保存后只显示“已配 Key”。</li>
              </ol>
            </section>

            <p v-if="llmProviderModal.error" class="inline-msg err">{{ llmProviderModal.error }}</p>
          </div>

          <footer class="settings-modal-actions">
            <button class="btn-ghost" type="button" :disabled="llmProviderModal.saving" @click="closeLlmProviderModal">取消</button>
            <button class="btn-orange" type="button" :disabled="llmProviderModal.saving" @click="applyLlmProviderDraft">
              {{ llmProviderModal.saving ? '保存中...' : '保存 Provider' }}
            </button>
          </footer>
        </section>
      </div>
    </Teleport>
  </div>
</template>

<script setup>
import { computed, defineComponent, h, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import { IconExternalLink } from '@tabler/icons-vue'
import {
  AI_VIDEO_CONNECTION_DEFAULTS,
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
  DEEPSEEK_PLATFORM_URL,
  LLM_DEFAULTS,
  LLM_MASKED_CREDENTIAL_VALUE,
  LLM_PANEL_FIELDS,
  buildLlmSettingsPatch,
  clearWrittenLlmSettings,
  isLlmConfigured,
  llmProviderConfigured,
  normalizeCustomLlmProviders,
  normalizeLlmProtocol,
  parseLlmModelsText,
} from '../utils/llmSettings.mjs'
import deepseekLogoUrl from '../assets/llm-providers/deepseek-logo.png'
import semirLogoUrl from '../assets/llm-providers/semir-logo.png'

const OFFICIAL_RELEASE_URL = 'https://github.com/howtimeschange/crawshrimp-harness/releases/latest'

const props = defineProps([
  'status',
  'focusPanelId',
  'updateStatus',
  'updateActionBusy',
  'themePreference',
  'effectiveTheme',
])
const emit = defineEmits(['runtime-refresh', 'check-update', 'theme-change'])

const agentRuntime = ref({ state: 'unknown', generation: 0, model: '', web_url: '', api_key_configured: false, error: '' })
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
  const raw = String(agentRuntime.value?.web_url || '').trim()
  if (!raw || agentRuntime.value?.state !== 'ready') return ''
  try {
    const url = new URL(raw)
    url.searchParams.set('csImSettings', '1')
    return url.href
  } catch {
    return ''
  }
})

function onImSettingsFrameLoad(event) {
  const frameWindow = event?.target?.contentWindow || imSettingsFrame.value?.contentWindow
  if (!frameWindow || !imSettingsUrl.value) return
  try {
    frameWindow.postMessage({ __crawshrimp: 'theme', theme: props.effectiveTheme }, new URL(imSettingsUrl.value).origin)
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
  if (event.data?.__crawshrimp === 'im-settings-ready') imSettingsReady.value = true
}

async function refreshAgentRuntime() {
  try {
    agentRuntime.value = await window.cs.agentApi('GET', '/agent/runtime')
  } catch {
    agentRuntime.value = { state: 'offline', generation: 0, model: '', web_url: '', api_key_configured: false, error: '后端不可达' }
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
const cloudStatus = ref(null)
const cloudBusy = reactive({ config: false, enroll: false, start: false, stop: false })
const cloudMsg = ref('')
const cloudMsgOk = ref(true)
const cloudServiceErrorMessages = {
  invalid_environment_override: '开发环境变量中的云端审批地址无效',
  unreachable: '云端审批服务暂时无法访问',
  unexpected_service: '检测到的地址不是抓虾云端审批服务',
  not_detected: '未检测到本地审批服务，当前显示默认地址',
}
const defaultCloudCapabilities = ['generate_ai_image', 'regenerate_ai_image', 'submit_tmall_material_test', 'crawl_tmall_material_test_data']
const cloudCapabilityOptions = [
  { value: 'generate_ai_image', label: 'generate_ai_image' },
  { value: 'regenerate_ai_image', label: 'regenerate_ai_image' },
  { value: 'submit_tmall_material_test', label: 'submit_tmall_material_test' },
  { value: 'crawl_tmall_material_test_data', label: 'crawl_tmall_material_test_data' },
]
const ai1xmKeyFields = [
  'ai.1xm.gpt_image_2k_key',
  'ai.1xm.gpt_image_4k_key',
  'ai.1xm.gemini_3_1_flash_image_preview_key',
  'ai.1xm.gemini_3_pro_image_preview_key',
]
const aiVideoKeyFields = [
  'ai.video.seedance_api_key',
  'ai.video.bailian_api_key',
  'ai.video.bailian_upload_api_key',
]
const llmKeyFields = LLM_BUILTIN_PROVIDERS.map(provider => provider.apiKeyField)
const aiVideoConnectionHints = {
  'ai.video.seedance_base_url': `默认：${AI_VIDEO_CONNECTION_DEFAULTS['ai.video.seedance_base_url']}；森马网关可填 https://ai-aigw.semir.com/doubao-seedance/api/v3。`,
  'ai.video.bailian_region': `默认：${AI_VIDEO_CONNECTION_DEFAULTS['ai.video.bailian_region']}；输入新值才会覆盖。`,
  'ai.video.bailian_base_url': `默认：${AI_VIDEO_CONNECTION_DEFAULTS['ai.video.bailian_base_url']}；有业务空间 ID 时会按空间和区域自动生成 endpoint。`,
  'ai.video.bailian_uploads_url': `默认：${AI_VIDEO_CONNECTION_DEFAULTS['ai.video.bailian_uploads_url']}；仅用于本地素材临时 OSS 上传。`,
}

const llmProviderModal = reactive({
  open: false,
  isNew: false,
  isBuiltin: false,
  providerId: '',
  error: '',
  saving: false,
})
const llmProviderDraft = reactive({
  id: '',
  name: '',
  protocol: 'openai',
  baseUrl: '',
  apiKey: '',
  modelsText: '',
  modelIds: [],
  configured: false,
})

const saveState = reactive({})

const themeOptions = [
  { value: 'system', label: '系统', description: '跟随 macOS / Windows' },
  { value: 'light', label: '浅色', description: '明亮、清晰' },
  { value: 'dark', label: '深色', description: '低光、专注' },
]

const menuGroups = [
  {
    id: 'appearance',
    icon: '●',
    label: '外观',
    desc: '主题 / 显示',
    children: [{ id: 'appearance-theme', label: '主题' }],
  },
  {
    id: 'connection',
    icon: '●',
    label: '连接',
    desc: '核心服务 / Chrome',
    children: [{ id: 'connection-overview', label: '服务状态' }],
  },
  {
    id: 'notify',
    icon: '●',
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
    icon: '●',
    label: '应用',
    desc: '版本 / 桌面更新',
    children: [{ id: 'application-update', label: '桌面更新' }],
  },
  {
    id: 'storage',
    icon: '●',
    label: '存储',
    desc: '运行数据目录',
    children: [{ id: 'storage-data', label: '数据目录' }],
  },
  {
    id: 'sync',
    icon: '●',
    label: '数据同步',
    desc: 'ODPS 接口',
    children: [{ id: 'sync-odps', label: 'ODPS AppCode', statusKey: 'odps.app_code' }],
  },
  {
    id: 'ai',
    icon: '●',
    label: 'AI 能力',
    desc: '图片 / 文本 / 视频 / 智能体',
    children: [
      { id: 'ai-1xm', label: '1XM 图片模型', statusKeys: ai1xmKeyFields },
      { id: 'ai-llm', label: '文本大模型', statusKeys: llmKeyFields },
      { id: 'ai-video', label: '视频模型', statusKeys: aiVideoKeyFields },
      { id: 'ai-agent', label: '智能体', statusKeys: [] },
    ],
  },
  {
    id: 'im',
    icon: '●',
    label: 'IM机器人',
    desc: '微信 / 飞书 / 钉钉 / 更多',
    children: [{ id: 'im-bots', label: '机器人接入' }],
  },
  {
    id: 'cloud',
    icon: '●',
    label: '云端审批',
    desc: '审批入口 / 任务机',
    children: [{ id: 'cloud-approval', label: '云端审批', statusKey: 'cloud_approval.base_url' }],
  },
]

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

const panelFields = {
  'notify-dingtalk': ['notify.dingtalk_webhook', 'notify.dingtalk_secret'],
  'notify-feishu': ['notify.feishu_webhook'],
  'notify-custom': ['notify.custom_webhook'],
  'storage-data': ['data_dir'],
  'sync-odps': ['odps.app_code'],
  'ai-1xm': ['ai.1xm.base_url', 'ai.1xm.gpt_image_2k_key', 'ai.1xm.gpt_image_4k_key', 'ai.1xm.gemini_3_1_flash_image_preview_key', 'ai.1xm.gemini_3_pro_image_preview_key'],
  'ai-llm': [...LLM_PANEL_FIELDS],
  'ai-video': ['ai.video.seedance_api_key', 'ai.video.seedance_base_url', 'ai.video.bailian_api_key', 'ai.video.bailian_workspace_id', 'ai.video.bailian_region', 'ai.video.bailian_base_url', 'ai.video.bailian_upload_api_key', 'ai.video.bailian_uploads_url'],
  'cloud-approval': ['cloud_approval.registration_token', 'cloud_approval.machine_name', 'cloud_approval.machine_enabled', 'cloud_approval.capabilities'],
}

const notifyPanelByChannel = {
  dingtalk: 'notify-dingtalk',
  feishu: 'notify-feishu',
  webhook: 'notify-custom',
}

const activeGroup = computed(() => menuGroups.find(group => group.id === activeGroupId.value) || menuGroups[0])
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
const cloudAddressHint = computed(() => {
  const status = cloudStatus.value || {}
  const errorMessage = cloudServiceErrorMessages[status.service_error] || '未检测到本地审批服务，当前显示默认地址'
  if (status.environment === 'production') {
    return status.service_reachable ? '正式环境固定地址' : `正式环境固定地址；${errorMessage}`
  }
  if (status.service_reachable) return '已检测到本地审批服务'
  return errorMessage
})
const cloudAddressHintOk = computed(() => Boolean(cloudStatus.value?.service_reachable))
const customLlmProviders = computed(() => normalizeCustomLlmProviders(cfg.value[LLM_CUSTOM_PROVIDERS_FIELD]))
const llmProviders = computed(() => {
  const defaultModel = String(cfg.value['ai.llm.default_model'] || '').trim()
  const builtinRows = LLM_BUILTIN_PROVIDERS.map((provider) => {
    const modelIds = provider.models.map(model => model.value || model.id).filter(Boolean)
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
      isDefault: modelIds.includes(defaultModel),
    }
  })
  const customRows = customLlmProviders.value.map((provider) => {
    const modelIds = provider.models.map(model => model.id).filter(Boolean)
    return {
      id: provider.id,
      name: provider.name,
      brand: 'custom',
      logoImage: '',
      logoText: llmProviderLogoText(provider),
      isCustom: true,
      compatibility: provider.protocol === 'anthropic' ? 'Anthropic 兼容' : 'OpenAI 兼容',
      configured: Boolean(provider.configured),
      baseUrl: provider.base_url,
      modelCount: modelIds.length,
      previewModels: modelIds.slice(0, 3),
      firstModel: modelIds[0] || '',
      isDefault: modelIds.includes(defaultModel),
    }
  })
  return [...builtinRows, ...customRows]
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
    return provider.models.map(model => model.value || model.id).filter(Boolean)
  }
  return normalizeCustomLlmProviders([provider])[0]?.models.map(model => model.id) || []
}

function firstAvailableLlmModel() {
  for (const provider of LLM_BUILTIN_PROVIDERS) {
    const model = llmProviderModelIds(provider)[0]
    if (model) return model
  }
  for (const provider of customLlmProviders.value) {
    const model = llmProviderModelIds(provider)[0]
    if (model) return model
  }
  return LLM_DEFAULTS['ai.llm.default_model']
}

async function setLlmDefaultModel(modelId) {
  const value = String(modelId || '').trim()
  if (!value) return
  const previousCfg = clonePlain(cfg.value)
  cfg.value['ai.llm.default_model'] = value
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

function openLlmProviderModal(providerId = '') {
  const builtin = LLM_BUILTIN_PROVIDERS.find(provider => provider.id === providerId)
  const custom = customLlmProviders.value.find(provider => provider.id === providerId)
  llmProviderModal.open = true
  llmProviderModal.isNew = !providerId
  llmProviderModal.isBuiltin = Boolean(builtin)
  llmProviderModal.providerId = providerId || ''
  llmProviderModal.error = ''
  if (builtin) {
    const configured = llmProviderConfigured(cfg.value, builtin)
    const modelIds = llmProviderModelIds(builtin)
    Object.assign(llmProviderDraft, {
      id: builtin.id,
      name: builtin.name,
      protocol: builtin.protocol,
      baseUrl: cfg.value[builtin.baseUrlField] || builtin.defaultBaseUrl,
      apiKey: cfg.value[builtin.apiKeyField] || (configured ? LLM_MASKED_CREDENTIAL_VALUE : ''),
      modelsText: modelIds.join('\n'),
      modelIds,
      configured,
    })
    return
  }
  if (custom) {
    const modelIds = llmProviderModelIds(custom)
    Object.assign(llmProviderDraft, {
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

function closeLlmProviderModal(options = {}) {
  if (llmProviderModal.saving && !options.force) return
  llmProviderModal.open = false
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
    llmProviderModal.error = '请填写 Provider 名称。'
    return
  }
  if (!baseUrl) {
    llmProviderModal.error = '请填写 Base URL。'
    return
  }
  const previousCfg = clonePlain(cfg.value)
  const builtin = LLM_BUILTIN_PROVIDERS.find(provider => provider.id === llmProviderDraft.id)
  if (builtin) {
    cfg.value[builtin.baseUrlField] = baseUrl
    if (apiKey) cfg.value[builtin.apiKeyField] = apiKey
    if (apiKey && !isMaskedLlmCredential(apiKey)) cfg.value[builtin.configuredField] = true
    await saveLlmProviderDraft(previousCfg)
    return
  }

  const models = parseLlmModelsText(llmProviderDraft.modelsText)
  if (!models.length) {
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
    await persistLlmPanelChange(previousCfg, 'Provider 已保存')
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
  if (!window.confirm(`确定删除 Provider「${provider.name}」吗？`)) return
  const previousCfg = clonePlain(cfg.value)
  const removedModelIds = new Set(llmProviderModelIds(provider))
  cfg.value[LLM_CUSTOM_PROVIDERS_FIELD] = customLlmProviders.value.filter(item => item.id !== providerId)
  if (removedModelIds.has(String(cfg.value['ai.llm.default_model'] || ''))) {
    cfg.value['ai.llm.default_model'] = firstAvailableLlmModel()
  }
  try {
    await persistLlmPanelChange(previousCfg, 'Provider 已删除')
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
  if (!flat['ai.1xm.base_url']) flat['ai.1xm.base_url'] = 'https://one-xm-proxy.crawshrimp.com/v1'
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
  flat['cloud_approval.machine_enabled'] = Boolean(flat['cloud_approval.machine_enabled'])
  flat['cloud_approval.capabilities'] = normalizeCloudCapabilities(flat['cloud_approval.capabilities'])
  return flat
}

async function load() {
  const flat = normalizedSettings(await window.cs.getSettings() || {})
  cfg.value = { ...flat }
  savedCfg.value = { ...flat }
  await loadCloudStatus()
}

function selectGroup(groupId) {
  const group = menuGroups.find(item => item.id === groupId) || menuGroups[0]
  activeGroupId.value = group.id
  activePanelId.value = group.children[0]?.id || group.id
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
  if (aiVideoKeyFields.includes(key)) return isAiVideoCredentialConfigured(cfg.value, key)
  const llmProvider = LLM_BUILTIN_PROVIDERS.find(provider => provider.apiKeyField === key)
  if (llmProvider) return llmProviderConfigured(cfg.value, llmProvider)
  if (LLM_CREDENTIAL_FIELDS.includes(key)) return isLlmConfigured(cfg.value)
  return String(cfg.value[key] || '').trim().length > 0
}

function aiVideoConnectionPlaceholder(key) {
  const value = AI_VIDEO_CONNECTION_DEFAULTS[key]
  return value ? `默认：${value}` : '留空保持后端当前配置'
}

function aiVideoConnectionHint(key) {
  return aiVideoConnectionHints[key] || '留空使用默认或后端已有配置，输入新值才会覆盖。'
}

function hasAnyFieldConfigured(keys) {
  return keys.some(key => isFieldConfigured(key))
}

function isMenuChildConfigured(child) {
  if (child?.id === 'ai-llm') return isLlmConfigured(cfg.value)
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
    patch[key] = key === 'cloud_approval.capabilities'
      ? selectedCloudCapabilities()
      : cfg.value[key] ?? ''
    return patch
  }, {})
}

function normalizeCloudCapabilities(value) {
  const raw = Array.isArray(value) ? value : []
  const allowed = new Set(defaultCloudCapabilities)
  const capabilities = raw
    .map(item => String(item || '').trim())
    .filter((item, index, list) => item && allowed.has(item) && list.indexOf(item) === index)
  return capabilities.length ? capabilities : [...defaultCloudCapabilities]
}

function selectedCloudCapabilities() {
  const capabilities = normalizeCloudCapabilities(cfg.value['cloud_approval.capabilities'])
  cfg.value['cloud_approval.capabilities'] = capabilities
  return capabilities
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

function cloudConfigPayload() {
  return {
    registration_token: cfg.value['cloud_approval.registration_token'] || '',
    machine_name: cfg.value['cloud_approval.machine_name'] || '',
    machine_enabled: Boolean(cfg.value['cloud_approval.machine_enabled']),
    capabilities: selectedCloudCapabilities(),
  }
}

function applyCloudStatus(status) {
  cloudStatus.value = status || null
  if (status?.base_url !== undefined) cfg.value['cloud_approval.base_url'] = status.base_url || ''
  if (status?.machine_name !== undefined) cfg.value['cloud_approval.machine_name'] = status.machine_name || cfg.value['cloud_approval.machine_name'] || ''
  if (status?.machine_enabled !== undefined) cfg.value['cloud_approval.machine_enabled'] = Boolean(status.machine_enabled)
  if (status?.capabilities !== undefined) cfg.value['cloud_approval.capabilities'] = normalizeCloudCapabilities(status.capabilities)
}

async function loadCloudStatus() {
  if (typeof window.cs.getCloudApprovalStatus !== 'function') return
  try {
    applyCloudStatus(await window.cs.getCloudApprovalStatus({ refresh: true }))
  } catch (e) {
    cloudMsg.value = e?.message || '读取云端审批状态失败'
    cloudMsgOk.value = false
  }
}

async function saveCloudApprovalConfig() {
  cloudBusy.config = true
  cloudMsg.value = ''
  try {
    const result = await window.cs.saveCloudApprovalConfig(cloudConfigPayload())
    applyCloudStatus(result?.status)
    cloudMsg.value = '已保存'
    cloudMsgOk.value = true
  } catch (e) {
    cloudMsg.value = e?.message || '保存失败'
    cloudMsgOk.value = false
  } finally {
    cloudBusy.config = false
  }
}

async function enrollCloudMachine() {
  cloudBusy.enroll = true
  cloudMsg.value = ''
  try {
    await window.cs.saveCloudApprovalConfig(cloudConfigPayload())
    const result = await window.cs.enrollCloudMachine({
      registration_token: cfg.value['cloud_approval.registration_token'] || '',
      machine_name: cfg.value['cloud_approval.machine_name'] || '',
      capabilities: selectedCloudCapabilities(),
    })
    applyCloudStatus(result?.status)
    cloudMsg.value = '任务机已注册'
    cloudMsgOk.value = true
  } catch (e) {
    cloudMsg.value = e?.message || '注册失败'
    cloudMsgOk.value = false
  } finally {
    cloudBusy.enroll = false
  }
}

async function startCloudMachine() {
  cloudBusy.start = true
  cloudMsg.value = ''
  try {
    const result = await window.cs.startCloudMachine()
    applyCloudStatus(result?.status)
    cloudMsg.value = '任务机已启动'
    cloudMsgOk.value = true
  } catch (e) {
    cloudMsg.value = e?.message || '启动失败'
    cloudMsgOk.value = false
  } finally {
    cloudBusy.start = false
  }
}

async function stopCloudMachine() {
  cloudBusy.stop = true
  cloudMsg.value = ''
  try {
    const result = await window.cs.stopCloudMachine()
    applyCloudStatus(result?.status)
    cloudMsg.value = '任务机已停止'
    cloudMsgOk.value = true
  } catch (e) {
    cloudMsg.value = e?.message || '停止失败'
    cloudMsgOk.value = false
  } finally {
    cloudBusy.stop = false
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

onMounted(async () => {
  window.addEventListener('message', onImSettingsMessage)
  await load()
  if (activePanelId.value === 'im-bots') await refreshAgentRuntime()
})

onBeforeUnmount(() => {
  window.removeEventListener('message', onImSettingsMessage)
})

watch(() => props.focusPanelId, panelId => {
  focusPanel(panelId)
})

watch(activePanelId, panelId => {
  if (panelId === 'cloud-approval') loadCloudStatus()
  if (panelId === 'im-bots') imSettingsReady.value = false
  if (panelId === 'ai-agent' || panelId === 'im-bots') refreshAgentRuntime()
})

watch(() => props.effectiveTheme, () => {
  if (activePanelId.value === 'im-bots') onImSettingsFrameLoad()
})

watch(imSettingsUrl, () => {
  imSettingsReady.value = false
})
</script>

<style scoped>
.view {
  height: 100%;
  display: flex;
  flex-direction: column;
  min-height: 0;
}

.view-header {
  display: flex;
  align-items: center;
  padding: 20px 28px 16px;
  border-bottom: 1px solid var(--border);
}

.view-header h2 {
  font-size: 19px;
  font-weight: 750;
  margin: 0;
}

.view-header p {
  margin: 6px 0 0;
  color: var(--text3);
  font-size: 12px;
  line-height: 1.4;
}

.settings-workspace {
  flex: 1;
  min-height: 0;
  display: grid;
  grid-template-columns: 236px minmax(0, 1fr);
  gap: 18px;
  padding: 18px 24px 22px 28px;
  overflow: hidden;
}

.settings-menu,
.settings-content {
  min-height: 0;
  overflow-y: auto;
  overscroll-behavior: contain;
}

.settings-menu {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding-right: 2px;
  scrollbar-gutter: stable;
}

.menu-cluster {
  display: flex;
  flex-direction: column;
  gap: 5px;
}

.menu-group,
.menu-child {
  width: 100%;
  border: 1px solid transparent;
  background: transparent;
  color: var(--text2);
  text-align: left;
  transition:
    background 0.22s cubic-bezier(0.2, 0.8, 0.2, 1),
    border-color 0.22s cubic-bezier(0.2, 0.8, 0.2, 1),
    color 0.22s cubic-bezier(0.2, 0.8, 0.2, 1),
    box-shadow 0.22s cubic-bezier(0.2, 0.8, 0.2, 1),
    transform 0.22s cubic-bezier(0.2, 0.8, 0.2, 1);
}

.menu-group {
  position: relative;
  display: flex;
  align-items: center;
  gap: 10px;
  border-radius: 9px;
  padding: 10px 11px;
  transform-origin: left center;
}

.menu-group:hover,
.menu-child:hover {
  background: var(--bg2);
  color: var(--text);
}

.menu-group:active,
.menu-child:active,
.btn-orange:active,
.btn-ghost:active {
  transform: translateY(1px);
}

.menu-group.active {
  background: rgba(var(--orange-rgb), 0.11);
  border-color: rgba(var(--orange-rgb), 0.2);
  color: var(--orange-text);
  box-shadow: inset 0 0 0 1px rgba(var(--orange-rgb), 0.06), 0 10px 28px rgba(var(--orange-rgb), 0.06);
}

.menu-icon {
  width: 9px;
  height: 9px;
  border-radius: 50%;
  background: currentColor;
  color: inherit;
  font-size: 0;
  flex: 0 0 auto;
  transition: transform 0.22s cubic-bezier(0.2, 0.8, 0.2, 1), box-shadow 0.22s ease;
}

.menu-group.active .menu-icon {
  transform: scale(1.28);
  box-shadow: 0 0 0 4px rgba(var(--orange-rgb), 0.08);
}

.menu-copy {
  display: flex;
  flex-direction: column;
  gap: 3px;
  min-width: 0;
}

.menu-copy strong {
  font-size: 13px;
  font-weight: 700;
  color: inherit;
}

.menu-copy small {
  font-size: 11px;
  color: var(--text3);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.menu-children {
  display: flex;
  flex-direction: column;
  gap: 3px;
  padding: 0 0 2px 23px;
  overflow: hidden;
  transform-origin: top left;
}

.menu-child {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  min-height: 30px;
  border-radius: 7px;
  padding: 7px 9px;
  font-size: 12px;
  transform-origin: left center;
}

.menu-child.active {
  color: var(--text);
  background: var(--bg3);
  border-color: var(--border);
  transform: translateX(4px);
}

.mini-state {
  flex: 0 0 auto;
  font-size: 10px;
  font-weight: 700;
  padding: 2px 6px;
  border-radius: 999px;
}

.mini-state.on {
  color: var(--green);
  background: rgba(74, 222, 128, 0.1);
}

.mini-state.off {
  color: var(--red);
  background: rgba(248, 113, 113, 0.1);
}

.settings-children-enter-active,
.settings-children-leave-active {
  max-height: 190px;
  transition:
    max-height 0.26s cubic-bezier(0.2, 0.8, 0.2, 1),
    opacity 0.2s ease,
    transform 0.24s cubic-bezier(0.2, 0.8, 0.2, 1);
}

.settings-children-enter-from,
.settings-children-leave-to {
  max-height: 0;
  opacity: 0;
  transform: translateY(-6px) scaleY(0.98);
}

.settings-children-enter-to,
.settings-children-leave-from {
  max-height: 190px;
  opacity: 1;
  transform: translateY(0) scaleY(1);
}

.settings-children-enter-active .menu-child {
  animation: menu-child-in 0.26s cubic-bezier(0.2, 0.8, 0.2, 1) both;
}

.settings-children-enter-active .menu-child:nth-child(2) { animation-delay: 0.025s; }
.settings-children-enter-active .menu-child:nth-child(3) { animation-delay: 0.05s; }
.settings-children-enter-active .menu-child:nth-child(4) { animation-delay: 0.075s; }

.settings-content {
  display: flex;
  align-items: flex-start;
  padding-right: 4px;
}

.panel {
  width: min(100%, 1180px);
  background: var(--bg2);
  border: 1px solid var(--border);
  border-radius: 10px;
  padding: 22px;
  display: flex;
  flex-direction: column;
  gap: 20px;
  transform-origin: top left;
}

.agent-op-row { display: flex; flex-wrap: wrap; gap: 10px; }
.agent-notice { font-size: 12.5px; color: var(--green); padding: 8px 12px; border: 1px solid var(--border); border-radius: 8px; background: var(--bg2); }
.btn-danger { border: 1px solid var(--red); color: var(--red); background: transparent; font-size: 13px; padding: 8px 16px; border-radius: 8px; cursor: pointer; }
.btn-danger:hover { background: rgba(248, 113, 113, 0.12); }
.btn-danger:disabled { opacity: 0.6; cursor: default; }

.im-panel {
  min-height: min(860px, calc(100vh - 132px));
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
  min-height: 640px;
  overflow: hidden;
  border: 0;
  border-radius: 0;
  background: transparent;
}

.im-settings-frame {
  display: block;
  width: 100%;
  height: 100%;
  min-height: 640px;
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

.panel-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
  padding-bottom: 16px;
  border-bottom: 1px solid var(--border);
}

.panel-kicker {
  margin: 0 0 5px;
  color: var(--orange-text);
  font-size: 12px;
  font-weight: 700;
}

.panel-head h3 {
  margin: 0;
  font-size: 19px;
  line-height: 1.25;
}

.panel-layout,
.guide-grid {
  display: grid;
  grid-template-columns: minmax(360px, 1.15fr) minmax(280px, 0.85fr);
  gap: 18px;
  align-items: start;
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
  grid-template-columns: repeat(3, minmax(150px, 1fr));
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

.status-card,
.side-note,
.guide-block {
  background: var(--bg3);
  border: 1px solid var(--border);
  border-radius: 9px;
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

.form-stack {
  display: flex;
  flex-direction: column;
  gap: 14px;
  min-width: 0;
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
  width: 100px;
  height: 44px;
  flex: 0 0 100px;
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
  height: 34px;
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

.field {
  display: flex;
  flex-direction: column;
  gap: 7px;
}

.field label {
  font-size: 12px;
  color: var(--text2);
}

.field-hint {
  margin: -2px 0 0;
  color: var(--text3);
  font-size: 11px;
  line-height: 1.45;
  overflow-wrap: anywhere;
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

.input,
.select {
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
}

.select {
  cursor: pointer;
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

.input:focus,
.select:focus {
  border-color: var(--orange);
  background: var(--input-focus);
}

.textarea:focus {
  border-color: var(--orange);
  background: var(--input-focus);
}

.side-note {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 15px;
  color: var(--text2);
}

.side-note strong {
  color: var(--text);
  font-size: 13px;
}

.side-note p {
  margin: 0;
  color: var(--text3);
  font-size: 12px;
  line-height: 1.6;
  overflow-wrap: anywhere;
}

.path-note p {
  color: var(--text2);
  font-family: 'SF Mono', 'Fira Code', monospace;
  font-size: 11px;
}

.panel-actions,
.action-strip {
  display: flex;
  align-items: center;
  gap: 10px;
  min-height: 38px;
}

.badge,
.msg,
.test-result {
  display: inline-flex;
  align-items: center;
  width: fit-content;
  max-width: 100%;
}

.badge {
  flex: 0 0 auto;
  font-size: 11px;
  padding: 4px 10px;
  border-radius: 999px;
  font-weight: 700;
}

.badge.on {
  background: rgba(74, 222, 128, 0.12);
  color: var(--green);
}

.badge.off {
  background: rgba(248, 113, 113, 0.12);
  color: var(--red);
}

.badge.neutral {
  background: rgba(148, 163, 184, 0.12);
  color: var(--text2);
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

.btn-orange,
.btn-ghost {
  border-radius: 8px;
  font-size: 12px;
  font-weight: 700;
  transition: background 0.15s ease, border-color 0.15s ease, color 0.15s ease, opacity 0.15s ease, transform 0.15s ease;
}

.btn-orange {
  padding: 10px 18px;
  border: none;
  background: var(--orange);
  color: var(--on-orange);
}

.btn-orange:hover:not(:disabled) {
  background: var(--orange-hover);
}

.btn-ghost {
  padding: 9px 13px;
  border: 1px solid var(--border);
  background: transparent;
  color: var(--text2);
}

.btn-ghost:hover:not(:disabled) {
  background: var(--bg2);
  color: var(--text);
}

.btn-orange:disabled,
.btn-ghost:disabled {
  opacity: 0.45;
  cursor: not-allowed;
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

.settings-panel-enter-active {
  transition:
    opacity 0.24s ease,
    transform 0.28s cubic-bezier(0.2, 0.8, 0.2, 1),
    filter 0.24s ease;
}

.settings-panel-leave-active {
  transition:
    opacity 0.14s ease,
    transform 0.16s cubic-bezier(0.4, 0, 1, 1),
    filter 0.14s ease;
}

.settings-panel-enter-from {
  opacity: 0;
  transform: translateY(10px) scale(0.992);
  filter: blur(2px);
}

.settings-panel-leave-to {
  opacity: 0;
  transform: translateY(-5px) scale(0.996);
  filter: blur(1px);
}

.settings-panel-enter-to,
.settings-panel-leave-from {
  opacity: 1;
  transform: translateY(0) scale(1);
  filter: blur(0);
}

.settings-panel-enter-active .panel-head,
.settings-panel-enter-active .status-card,
.settings-panel-enter-active .field,
.settings-panel-enter-active .side-note,
.settings-panel-enter-active .guide-block,
.settings-panel-enter-active .llm-provider-row,
.settings-panel-enter-active :deep(.panel-actions) {
  animation: panel-item-in 0.32s cubic-bezier(0.2, 0.8, 0.2, 1) both;
}

.settings-panel-enter-active .status-card:nth-child(2),
.settings-panel-enter-active .field:nth-child(2),
.settings-panel-enter-active .guide-block:nth-child(2) {
  animation-delay: 0.035s;
}

.settings-panel-enter-active .side-note,
.settings-panel-enter-active :deep(.panel-actions) {
  animation-delay: 0.06s;
}

@keyframes menu-child-in {
  from {
    opacity: 0;
    transform: translateX(-8px);
  }
  to {
    opacity: 1;
    transform: translateX(0);
  }
}

@keyframes panel-item-in {
  from {
    opacity: 0;
    transform: translateY(8px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

@media (prefers-reduced-motion: reduce) {
  .menu-group,
  .menu-child,
  .menu-icon,
  .settings-children-enter-active,
  .settings-children-leave-active,
  .settings-panel-enter-active,
  .settings-panel-leave-active,
  .settings-panel-enter-active .panel-head,
  .settings-panel-enter-active .status-card,
  .settings-panel-enter-active .field,
  .settings-panel-enter-active .side-note,
  .settings-panel-enter-active .guide-block,
  .settings-panel-enter-active .llm-provider-row,
  .settings-panel-enter-active :deep(.panel-actions) {
    animation: none;
    transition: none;
  }
}

@media (max-width: 980px) {
  .theme-options {
    grid-template-columns: 1fr;
  }

  .theme-preview {
    aspect-ratio: 2.25;
  }

  .settings-workspace {
    grid-template-columns: 1fr;
    overflow-y: auto;
  }

  .settings-menu {
    overflow: visible;
  }

  .settings-content {
    overflow: visible;
  }

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
