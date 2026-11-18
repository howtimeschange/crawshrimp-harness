# 验证记录

- 使用 Lemo 原生 `core/render/still.mjs` 渲染 t=0、1、2 三帧，1200 × 630，页面无异常或缺失资源；最终为 t=2。
- 与 dark-keynote 演示对照：结构、开场、招牌构图、摄影机路线、声音形态和结尾均不同。只使用深色层次、网格、单一重点色与原创 UI 的风格语法。
- 单行主标题完整可读，主 UI 与文件区互不遮挡。四边保留安全区，域名在右上角；平台底部标题不覆盖产品主标题。
- 图中标注“工作流示意”；没有把原创 UI 示意图称作真实录屏，没有虚构量化收益。
- 无水印、无外部品牌、无示例作品片名；素材授权记录见 CREDITS。
- 输出 JPG 1200 × 630，小于 100 KB。保留 build.sh、字体、品牌标识和全部源代码。

## 重建分享图

在 Lemo Opuscar 检出中安装其锁定依赖及 Chromium。进入解压后的分享图源码目录，运行：

```sh
./build.sh /path/to/lemo-opuscar
```

也可通过 `LEMO_ROOT` 提供 Lemo 路径。脚本默认使用 Lemo 的 `.venv/bin/python`，也可用 `LEMO_PYTHON` 指定装有 Pillow 的 Python。生成 `poster.jpg`、`style-frames.jpg` 和 `out/` 中的三帧。
