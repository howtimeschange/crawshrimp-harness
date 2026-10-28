// ModelJetty public catalog verified 2026-10-21. Credentials are user supplied.
export const MODELJETTY_LLM_PRESETS = [
  { id: 'modeljetty-gpt', name: 'ModelJetty · GPT', protocol: 'openai-responses', base_url: 'https://api.modeljetty.com/v1',
    models: ['gpt-6.1-sol', 'gpt-6-astra', 'gpt-6-sol', 'gpt-6-luna', 'gpt-5.6-sol', 'gpt-5.6-terra', 'gpt-5.6-luna'] },
  { id: 'modeljetty-deepseek', name: 'ModelJetty · DeepSeek', protocol: 'openai', base_url: 'https://api.modeljetty.com/v1',
    models: ['deepseek-flash', 'deepseek-v4-pro'] },
  { id: 'modeljetty-gemini', name: 'ModelJetty · Gemini', protocol: 'openai', base_url: 'https://api.modeljetty.com/v1',
    models: ["gemini-2.5-flash", "gemini-2.5-flash-lite", "gemini-2.5-flash-thinking", "gemini-3-flash", "gemini-3.1-flash-lite", "gemini-3.5-flash-lite", "gemini-3.8-flash-high", "gemini-3.8-flash-low", "gemini-3.8-flash-medium", "gemini-3.8-flash-tiered"] },
]
export const MODELJETTY_IMAGE_PRESETS = [
  { id: 'custom-modeljetty-gpt', name: 'ModelJetty · GPT Image', protocol: 'openai', base_url: 'https://api.modeljetty.com/v1',
    models: ['gpt-image-2.5-flare', 'gpt-image-2.5-sunburst'] },
  { id: 'custom-modeljetty-gemini', name: 'ModelJetty · Nano Banana 2', protocol: 'gemini', base_url: 'https://api.modeljetty.com/v1beta',
    models: ['gemini-3.1-flash-image'] },
]
