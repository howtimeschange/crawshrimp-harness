import React from '../../../../app/node_modules/react/index.js'
import { createRoot } from '../../../../app/node_modules/react-dom/client.js'
import { ImageGenerationReact } from '../../../../app/src/renderer/components/imageGenerationReact.js'

window.crawshrimpMountImageLoader = (host) => {
  const root = createRoot(host)
  root.render(React.createElement(ImageGenerationReact, { images: [], mode: 'loading' }))
  return () => root.unmount()
}
