# 抓虾 Harness 宣传片 v3

在本目录安装渲染依赖。合成需要系统安装 FFmpeg。

```sh
npm ci
npx playwright install chromium
python3 -m pip install -r requirements-v3.txt
```

运行 `./build-v3.sh` 生成 `crawshrimp-harness-promo-v3.mp4`。脚本可以从任意目录调用，接受一个可选的输出路径。`PROMO_JOBS` 设置渲染并发，`PROMO_PYTHON` 指定 Python 环境。

单独生成音轨时，先从页面导出时间轴，再运行配乐脚本。

```sh
node render-60fps.cjs --events-only
python3 audio-v3.py
```

时间轴和 WAV 保存在 `.v3-build/`。
