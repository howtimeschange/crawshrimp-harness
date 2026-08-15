# Banner Generation Skill

一个用于生成高质量 Banner、运营图和产品介绍卡的 Codex Skill。

它的核心思路是：先用 1xm 图片模型生成“无文字视觉底图”，再用本地 HTML/CSS 精准叠加中文标题、英文文案、Logo、卖点标签和版式，最后导出指定尺寸的 PNG。这样可以避免图片模型直接生成中文时常见的乱码、伪文字和字体不可控问题。

## 适合什么场景

- 电商运营图、活动横幅、商品能力介绍图
- SaaS / 工具类产品的宣传 Banner
- 社媒头图、封面图、宽幅推广图
- 需要中英文文案清晰可控的营销图
- 需要按照指定比例或指定像素输出的图片资产

## 核心能力

- 通过 1xm 调用图片模型，默认适配 `gpt-image-2`
- 支持传入 Logo、截图、品牌图作为视觉参考
- 要求模型只生成视觉底图，不生成文字
- 使用本地 HTML/CSS 合成最终标题、说明、Logo、标签和视觉层级
- 使用 Playwright/Chrome 导出指定尺寸 PNG
- 不绑定作者本机密钥，使用者需要自行配置 1xm key

## 抓虾 Harness 内置版

本内置版已经随应用放在 `skills/banner-generation` 目录。运行脚本前先进入该目录。

## 配置 1xm

### 注册和创建 API key

1. 打开 1xm 邀请注册链接：[https://1xm.ai/register?aff=Bkzj](https://1xm.ai/register?aff=Bkzj)。
2. 注册或登录后，进入平台的 API key / 模型调用配置页面。
3. 创建用于图片生成的 API key，推荐选择或开通 `gpt-image-2【4K】` 能力。
4. 复制 API key 后，按下面任一方式配置到本机。

推荐使用环境变量：

```bash
export ONEXM_API_KEY="你的-1xm-api-key"
export ONEXM_GROUP="" # 可选，只有账号需要 group 时才配置
```

也可以使用配置文件：

```bash
mkdir -p ~/.config/banner-generation
chmod 700 ~/.config/banner-generation
cat > ~/.config/banner-generation/1xm.json <<'JSON'
{
  "apiKey": "你的-1xm-api-key",
  "group": "",
  "baseUrl": "https://api.1xm.ai/v1"
}
JSON
chmod 600 ~/.config/banner-generation/1xm.json
```

这里的 `baseUrl` 是 1xm API 根地址，不是同步生图接口。脚本实际会请求 `POST /images/tasks` 创建异步任务，再轮询 `poll_url` 或 `/images/tasks/{id}` 直到拿到图片结果。

不要把真实 API key 写进仓库、README、生成的 HTML 或 prompt 文件里。

## 在 Codex 中使用

安装后可以直接自然语言调用：

```text
用 $banner-generation 生成一张 1650x500 的产品介绍 Banner，1xm key 从环境变量 ONEXM_API_KEY 读取，中文标题用本地 HTML 合成。
```

```text
用 $banner-generation 参考这个截图比例，做一张电商运营自动化介绍图，标题和卖点用中文叠加。
```

```text
Use $banner-generation to create a 1920x640 launch banner for this app. Use the logo as a visual reference and keep all text as local overlays.
```

## 直接运行脚本

创建一份图片模型 prompt：

```bash
mkdir -p tmp/my-banner
cat > tmp/my-banner/prompt.txt <<'EOF'
Use case: ads-marketing
Asset type: wide promotional banner for a product introduction card
Primary request: Create a cinematic ultra-wide visual backdrop for a productivity tool.
Composition/framing: keep the left 45 percent calm and unobstructed for later typography.
Text: render no words, no numbers, and no letter-like marks; typography will be overlaid separately.
Avoid: unreadable pseudo-text, watermark, border, UI chrome, over-busy collage.
EOF
```

通过 1xm 异步任务生成视觉底图：

```bash
node scripts/generate_1xm_image.mjs \
  --prompt tmp/my-banner/prompt.txt \
  --out tmp/my-banner/base.png \
  --model gpt-image-2 \
  --size 3840x1280 \
  --quality high
```

这条命令内部会调用 `https://api.1xm.ai/v1/images/tasks`，不是同步等待式的生图端点。

把 HTML 合成为最终 Banner：

```bash
node scripts/render_html_banner.mjs \
  --html tmp/my-banner/banner.html \
  --out tmp/my-banner/final.png \
  --width 1650 \
  --height 500 \
  --scale 2
```

检查导出尺寸：

```bash
sips -g pixelWidth -g pixelHeight tmp/my-banner/final.png
```

## 推荐工作流

1. 先确认目标尺寸、用途、品牌风格和必须出现的文案。
2. 收集真实产品资料、截图、Logo 和参考图。
3. 写一份英文图片 prompt，明确要求模型不要生成文字。
4. 用 1xm 异步任务接口生成视觉底图。
5. 编写本地 HTML/CSS，把中文标题、说明、Logo 和标签叠加上去。
6. 用 Playwright 渲染成 PNG。
7. 检查尺寸、文字可读性、Logo 是否被裁切、背景里是否有伪文字。

## 目录结构

```text
.
├── SKILL.md
├── README.md
├── LICENSE
├── agents/
│   └── openai.yaml
├── references/
│   └── 1xm-configuration.md
└── scripts/
    ├── generate_1xm_image.mjs
    └── render_html_banner.mjs
```

## 校验

可以运行：

```bash
node --check scripts/generate_1xm_image.mjs
node --check scripts/render_html_banner.mjs
```

## 注意事项

- 仓库不包含任何 API key，也不应该提交生成结果。
- `gpt-image-2` 通常适合生成宽幅商业视觉底图。
- 对于非常宽的最终 Banner，可以先生成 `3840x1280` 这类支持比例的底图，再通过 HTML 裁切或适配。
- 如果底图里出现伪文字，不建议遮盖，应该加强 prompt 约束后重新生成。
- 中文、标题、卖点和品牌信息都建议走本地 HTML/CSS 合成，保证最终输出可读、可改、可复用。
