import TurndownService from 'turndown'
import { gfm } from 'turndown-plugin-gfm'

function pickBestUrlFromSrcset(srcset) {
  if (!srcset) return ''
  const candidates = srcset
    .split(',')
    .map((part) => part.trim())
    .map((part) => part.split(/\s+/)[0])
    .filter(Boolean)
  return candidates[candidates.length - 1] || ''
}

function escapeAlt(alt) {
  return (alt || '').replace(/[\[\]]/g, '').trim()
}

function createTurndown() {
  const td = new TurndownService({
    headingStyle: 'atx',
    codeBlockStyle: 'fenced',
    fence: '```',
    bulletListMarker: '-',
    emDelimiter: '*',
    strongDelimiter: '**',
    linkStyle: 'inlined',
  })
  td.use(gfm)

  td.addRule('improvedImage', {
    filter: 'img',
    replacement: (_content, node) => {
      let src = node.getAttribute('src') || ''

      if (!src || src.startsWith('data:image/svg+xml') || src.startsWith('data:image/gif;base64,R0lGOD')) {
        src =
          node.getAttribute('data-src') ||
          node.getAttribute('data-original') ||
          node.getAttribute('data-lazy-src') ||
          node.getAttribute('data-croporisrc') ||
          ''
      }

      if (!src) {
        src = pickBestUrlFromSrcset(node.getAttribute('srcset') || '')
      }

      if (!src) return ''

      const alt = escapeAlt(node.getAttribute('alt') || node.getAttribute('title') || '')
      return `![${alt}](${src})`
    },
  })

  return td
}

const html = `
<div>
  <p>before</p>
  <img alt="System Card Art" src="https://images.ctfassets.net/example/System_Card_Art.png?w=3840&q=90&fm=webp" />
  <img alt="" srcset="https://images.ctfassets.net/example/a.png?w=640 640w, https://images.ctfassets.net/example/a.png?w=3840 3840w" />
  <p>after</p>
</div>
`

const td = createTurndown()
const md = td.turndown(html)

if (!md.includes('![') || !md.includes('](')) {
  console.error('FAIL: expected markdown image syntax, got:\n', md)
  process.exit(1)
}

if (md.includes('<img')) {
  console.error('FAIL: expected no <img> in markdown, got:\n', md)
  process.exit(1)
}

console.log('PASS')
