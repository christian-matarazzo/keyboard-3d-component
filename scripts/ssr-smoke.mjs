// Smoke test SSR: importa il pacchetto costruito e lo RENDERIZZA su Node, come
// farebbe il primo render di Next/Remix. L'import da solo non basta — un
// `window` nel corpo di un componente esploderebbe qui e non prima.
import { createElement } from 'react'
import { renderToString } from 'react-dom/server'

const mod = await import('../dist/lib/keyboard-composer.js')
const html = renderToString(createElement(mod.default, { product: 'ARRAY_MODEL_L' }))
console.log('RENDER OK — bytes:', html.length)
