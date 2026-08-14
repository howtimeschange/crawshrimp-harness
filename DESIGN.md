# Design

## Visual theme

抓虾是**深色为主、浅色完整可用**的电商生产力工作台。品牌锚点是抓虾橙:
它只出现在激活态、主操作和品牌点上,大面积界面留给中性深色,让内容与
任务优先。质感方向是「精密工具」而非「开发者终端」:排版有节奏、控件有
完整的悬停/焦点/激活状态、间距统一,不出现裸样式。

- 环境设定:工位上的运营人员,长时间盯屏;深色主题为主降低视觉疲劳,
  浅色主题用于明亮环境,两套主题共用同一组 token。
- 品牌参照:Klim 式的橙色铺陈(purposeful orange),配深炭中性底,
  而非 cream/sand 的 SaaS 套路。

## Color palette(identity-preservation:沿用现有抓虾 token)

| Token | dark | light | 用途 |
|---|---|---|---|
| `--orange` | `#FF6B2B` | `#FF5000` | 品牌主色:激活/主操作/品牌点 |
| `--orange-text` | `#FF8B5F` | `#BD3C00` | 主色上的文字 |
| `--orange-bg` | `rgba(255,107,43,.12)` | `rgba(255,80,0,.1)` | 激活底 |
| `--bg` | `#141418` | `#f7f7f8` | 应用底 |
| `--bg2` | `#1c1c22` | `#ffffff` | 侧栏/面板底 |
| `--bg3` | `#242430` | `#efeff1` | 次级表面 |
| `--bg4` | `#292932` | `#e6e6e9` | 覆盖层/弹层 |
| `--border` | `#2e2e3a` | `#d8d8de` | 常规描边 |
| `--border-strong` | `#484858` | `#b9bac3` | 强调描边 |
| `--text` | `#e2e0f0` | `#24242b` | 正文 |
| `--text2` | `#aaa8bd` | `#565866` | 次级文字 |
| `--text3` | `#8e8ca4` | `#626470` | 弱化文字(仅辅助,不作为正文) |
| `--green/--red/--yellow/--blue` | 状态色 | 状态色 | 成功/错误/警告/信息 |

- 正文对比度 ≥ 4.5:1(`--text`/`--text2` 均达标);`--text3` 只用于 caption。
- 深色下的灰色文字不得低于 `--text2`。
- DSH 内嵌界面通过 `crawshrimp-slots` 把上述值注入 DSH 的
  `--dsw-alias-*` token,保证内外同一套视觉。

## Typography

- 字体:系统栈 `-apple-system, BlinkMacSystemFont, 'SF Pro Text', 'PingFang SC',
  'Microsoft YaHei', sans-serif`;等宽仅用于代码/路径片段。
- 层级:界面标题 14px/600;菜单与正文 13.5px/400(激活 600);
  caption/hint 12px;大数字/展示性标题用 600 以上字重而非更大字号堆叠。
- 行高:正文 1.5;菜单 1.45;caption 1.4。
- 数字与状态:等宽数字特性 `font-variant-numeric: tabular-nums`。

## Spacing & radius

- 间距 4px 网格:`4 / 8 / 12 / 16 / 20`;分组间距 ≥ 16,组内 4–8。
- 圆角:控件与菜单项 8px;卡片 10px;浮层 12px;全圆角仅用于 tag/按钮 pill。
- 菜单项:padding 7px 10px,icon 容器 20px,图标 15px,行高 1.45。

## Components & interaction

- 菜单项(侧边栏/菜单栏):hover = `--soft-fill-hover` 底 + `--text` 文字;
  active = `--orange-bg` 底 + `--orange-text` 文字 + 600 字重;
  focus-visible = 2px `--orange` outline(offset 2px);禁用 = 40% 透明度。
- 状态反馈:运行中=脉冲点,成功/失败/警告用对应状态色;颜色+文字双重表达。
- 动效:150–200ms `cubic-bezier(.4,0,.2,1)` 只作用于 background/color/opacity/
  transform;展开收起用 transform/height 的平滑过渡;全部尊重
  `@media (prefers-reduced-motion: reduce)`(降级为瞬时切换)。
- 空状态/占位:图标 + 一句话下一步动作 + 单个主操作按钮,不出现裸文本。
- 深色输入框:focus 时边框转 `--orange`,placeholder 用 `--text3`。

## Layout

- 主界面:左侧会话侧边栏(品牌 + 新会话 + 主菜单 + 工作区 + 会话列表 +
  底部菜单),右侧内容区;脚本详情为独立二级页面(左:二级菜单,右:内容)。
- 侧边栏宽 280px,可折叠至 56px(折叠态只留图标,tooltip 补齐)。
- 内容区最大行宽 65–75ch;表格与数据视图例外。
