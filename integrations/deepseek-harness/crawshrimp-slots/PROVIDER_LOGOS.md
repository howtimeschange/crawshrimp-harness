# Model provider logos

Original SVG assets from [LobeHub Icons](https://github.com/lobehub/lobe-icons),
`@lobehub/icons-static-svg@1.100.0` (MIT). Brand trademarks belong to their respective owners.

Tarball: https://registry.npmjs.org/@lobehub/icons-static-svg/-/icons-static-svg-1.100.0.tgz

SVG markup is embedded without modifying paths, colors or viewBoxes in `lib/client.js`.
The upstream 24 × 24 icon viewBoxes already normalize whitespace. Each SVG scales proportionally
to 21px in a 23px transparent slot; the wider whale uses 23px for optical balance.
Monochrome paths inherit the theme foreground. No runtime CDN or asset path resolution is needed.
The same `conversation.input.model.label` slot renders trigger, menu summary and model options.
Unknown custom model IDs use a neutral chip symbol. Provider transport is deliberately ignored
because OpenAI-compatible providers can serve other brands.

| Brand | Upstream file | SHA-256 (UTF-8 original SVG) |
| --- | --- | --- |
| openai | `openai.svg` | `a595df6b423920c67a7f8f73c063e4bfb72d415948097b6cac063a2366bb5186` |
| gemini | `gemini-color.svg` | `8ab0a9bafec11f7e69bcb9fc4ffd8f1bc927d1ddcbbb6ff36dee5ae8b5a9d602` |
| deepseek | `deepseek-color.svg` | `deba5f98a5c1796e20fcac3149bcd7eb8a32f0bdd04d048819400b1f28bd1439` |
| claude | `claude-color.svg` | `a3101f3047a119aa11825ad9369510f0c472428c8c52d420e31bc62db44a8364` |
| qwen | `qwen-color.svg` | `a158a0e3ed5b541e4f91384ece02c3acf0a0d81b7b11a46d77bafb248b09e32c` |
| zai | `zai.svg` | `e748cb5108ce37b116d7a5ba97d37e0ae97eadf6849b0de11afb248e244a01e1` |
| kimi | `kimi-color.svg` | `0bdb95375d7c6e90a1850e91cd36770da2bc98fa33ec2d783f4a8fed027da85f` |
| grok | `grok.svg` | `9175fc90c22655160231976c849f25a03b888d7cc0e04c5f1b987b659bb07c95` |
| mistral | `mistral-color.svg` | `722f74b289d95486b43662fe24fa883b333701296f618406cd0ed502299170b6` |
| minimax | `minimax-color.svg` | `7f7187fa6d9b341ac5f22f6c5a970523afb439dc45566d64eb4f4b9b604d6b01` |
| doubao | `doubao-color.svg` | `3cd31ba03ae44b8c29561597a3b863809efecb13fcdfd08407a086df86a69b55` |

## License

See `LOBE_ICONS_LICENSE`.
