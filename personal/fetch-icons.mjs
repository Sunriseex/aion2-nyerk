import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createHash } from 'node:crypto'

const ROOT = dirname(fileURLToPath(import.meta.url))
const PAGE = 'https://aion2.gg/tools/event-timer'
const HOST = 'https://26z9clbm06.ufs.sh/f/'
const eventIcons = {
  shugo: ['M3KtUJweBx2Qc0e4539968aef99aa2c6e1e62b0d7d3e02ebb884c', 'menu.FieldEvent'],
  invasion: ['M3KtUJweBx2Qc79cd3553240767589765b78e2f7921cbe83cb7de', 'fieldevent.DimensionInvasion'],
  rift: ['M3KtUJweBx2Qc52f5a944b4e3b2a1af0ae62b33cb3cf901536236', 'content.Rift'],
  siege: ['M3KtUJweBx2Qcd5d6dcb2c2d689520e388399bca6b6b6a8666d3f', 'content.AbyssArtifact'],
  siegeBosses: ['M3KtUJweBx2Qc316c2dfc0a77b7c6f11fe5f22cbbfa73f4bc155c', 'mapicon.LegendMonster'],
}
const headers = { 'User-Agent': 'Mozilla/5.0', Referer: 'https://aion2.gg/' }
const metadata = { credit: 'Game images belong to NCSOFT. Sources: Questlog and Aion2.gg client-data databases.', icons: {} }
const output = join(ROOT, 'assets/icons')
mkdirSync(output, { recursive: true })
async function save(id, url, source, registryKey) {
  const response = await fetch(url, { headers, signal: AbortSignal.timeout(30000) })
  if (!response.ok) throw new Error(`${id}: HTTP ${response.status}`)
  const bytes = Buffer.from(await response.arrayBuffer())
  if (bytes.length > 2_000_000 || bytes.toString('ascii', 0, 4) !== 'RIFF' || bytes.toString('ascii', 8, 12) !== 'WEBP') throw new Error(`${id}: not a supported WebP asset`)
  writeFileSync(join(output, `${id}.webp`), bytes)
  metadata.icons[id] = { file: `personal-icons/${id}.webp`, source, url, registryKey,
    originalFilename: response.headers.get('content-disposition'), sha256: createHash('sha256').update(bytes).digest('hex'), bytes: bytes.length }
  console.log(`${id}: ${bytes.length} bytes`)
}
for (const [id, [key, registryKey]] of Object.entries(eventIcons)) await save(id, `${HOST}${key}`, PAGE, registryKey)
for (const [id, npc] of [['kaira', '2600089'], ['nahma', '2600094']]) {
  const url = `https://questlog.gg/aion-2/api/trpc/database.getNpc?input=${encodeURIComponent(JSON.stringify({ id: npc, language: 'en' }))}`
  const response = await fetch(url, { headers, signal: AbortSignal.timeout(30000) })
  if (!response.ok) throw new Error(`${id} NPC: HTTP ${response.status}`)
  const data = (await response.json()).result.data
  if (typeof data.icon !== 'string' || !data.icon.startsWith('/assets/Game/')) throw new Error(`${id}: missing client portrait`)
  const image = `https://cdn.questlog.gg/aion-2${data.icon.replace(/\.[^/]+$/, '')}.webp`
  await save(id, image, 'https://questlog.gg/aion-2/en/map', data.icon)
}
writeFileSync(join(ROOT, 'game-icons.json'), `${JSON.stringify(metadata, null, 2)}\n`)
