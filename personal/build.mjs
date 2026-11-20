import { createHash } from 'node:crypto'
import { cpSync, mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'
import { extractAll } from '../app/node_modules/@electron/asar/lib/asar.js'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
export const BASE_SHA256 = '2430b621e912f35165eeb5b0251056342685ecd79ddedd642696655a88736860'
export function replaceOnce(source, before, after) {
  if (source.split(before).length !== 2) throw new Error(`Patch anchor is absent or ambiguous: ${before.slice(0, 90)}`)
  return source.replace(before, after)
}
export function patchMain(source) {
  let s = replaceOnce(source, 'electron2.app.setName(DISPLAY_NAME);', `electron2.app.setName(DISPLAY_NAME);
var personal = require('../personal/runtime.cjs').createPersonal({
  app: electron2.app, ipcMain: electron2.ipcMain, rendererFile: node_path.join(__dirname, '../renderer/index.html'),
  timers: () => TIMERS, setKina, broadcast,
  publish: data => { for (const fn of addonLineListeners) fn({type:'addon', addon:'personal-kina', name:'stats', data}); }
});`)
  s = replaceOnce(s, 'void electron2.app.whenReady().then(() => {', 'void electron2.app.whenReady().then(() => {\n    personal.start();')
  s = replaceOnce(s, 'electron2.app.on("second-instance", () => showPanel());', 'electron2.app.on("second-instance", (_event, argv) => { if (argv.includes("--personal-preview")) personal.request("preview"); else showPanel(); });')
  s = replaceOnce(s, '  switch (ev["type"]) {\n    case "addon":\n    case "addonLoaded":', '  if (personal.accept(ev)) return;\n  switch (ev["type"]) {\n    case "addon":\n    case "addonLoaded":')
  s = replaceOnce(s, '  const args = [...cmd.args, "--data", data];', '  personal.helperStarting();\n  const args = [...cmd.args, "--data", data];')
  s = replaceOnce(s, 'setKina({ ...NO_KINA, balance: kina.balance, gains: [] });', 'personal.resetSession();')
  s = replaceOnce(s, 'setKina(kinaRebase(kina));', 'personal.rebase();')
  s = replaceOnce(s, 'if (saved.kina) setKina(kinaRebase(saved.kina));', 'if (saved.kina) personal.restore(saved.kina);')
  s = replaceOnce(s, '  if (!addon) throw new Error("the addon is not switched on");\n  switch (method) {',
    '  if (!addon) throw new Error("the addon is not switched on");\n  if (id === "personal-kina" && method === "send") return personal.request(String(args[0] ?? ""), args[1]);\n  switch (method) {')
  return s
}
export function patchRenderer(source) {
  let s = `import {personalBubble, personalClock, ratesText, boundCard} from './personal-renderer.mjs';\n${source}`
  s = replaceOnce(s, '__name:"BubblePage",setup(e){const t=Ne(),n=U(()=>Ql(t.status))',
    '__name:"BubblePage",setup(e){const t=Ne(),personalIcon=personalBubble(t,te,U,De,tt,Ve,ae,fr),n=U(()=>Ql(t.status))')
  s = replaceOnce(s, 't.alerting.length?"A timer is up: click to see it":', 'personalIcon.value.title?personalIcon.value.title:')
  s = replaceOnce(s, 'key:o.value,src:fr,alt:"",draggable:"false",class:oe(["size-12 rounded-full",o.value&&"animate-soul"])},null,2)',
    'key:personalIcon.value.active?"personal-alert":o.value,src:personalIcon.value.src,onError:()=>personalIcon.value.failed(),alt:"",draggable:"false",class:oe(["size-12 rounded-full",!personalIcon.value.active&&o.value&&"animate-soul"])},null,10,["src"])')
  s = replaceOnce(s, '__name:"HudPage",setup(e){const t=Ne(),n=te(null)', '__name:"HudPage",setup(e){const t=Ne(),personalNow=personalClock(te,Ve),n=te(null)')
  s = replaceOnce(s, 's.value.kina?t.kinaRate!==null?`${ws(t.kinaRate)} Kina/h`:t.kina.earned?"Kina/h measuring…":null:null',
    's.value.kina?ratesText(t.kina,personalNow.value):null')
  s = replaceOnce(s, 'title:"This session\'s Kina per hour"', 'title:"Ordinary and bound Kina per hour, tracked separately"')
  s = replaceOnce(s, '__name:"SessionTab",setup(e){const t=Ne(),n=U(', '__name:"SessionTab",setup(e){const t=Ne(),personalNow=personalClock(te,Ve),n=U(')
  s = replaceOnce(s, 'null,8,["values"])):V("",!0)])]),n.value.length?', 'null,8,["values"])):V("",!0)]),boundCard(c,t.kina,personalNow.value)]),n.value.length?')
  // Display the base and local extension separately; the base's real version remains 0.2.64.
  s = replaceOnce(s, '"v"+$(m(t).update.current)', '"v"+$(m(t).update.current)+" + Personal"')
  return s
}

export function stage(baseDirectory, output) {
  const asar = join(baseDirectory, 'resources', 'app.asar')
  const hash = createHash('sha256').update(readFileSync(asar)).digest('hex')
  if (hash !== BASE_SHA256) throw new Error(`Unsupported base app.asar SHA-256: ${hash}`)
  if (existsSync(output)) throw new Error('Use a fresh output folder; existing staging is never overwritten')
  mkdirSync(output, { recursive: true })
  extractAll(asar, output)
  const patch = (relative, transform) => { const file = join(output, relative); writeFileSync(file, transform(readFileSync(file, 'utf8'))) }
  patch('out/main/index.js', patchMain)
  patch('out/renderer/assets/index-D0Azwfnj.js', patchRenderer)
  patch('out/preload/index.js', s => replaceOnce(replaceOnce(s, 'var INVOKE_CHANNELS = [', 'var INVOKE_CHANNELS = ["personal:get",'), 'var EVENT_CHANNELS = [', 'var EVENT_CHANNELS = ["personal:state",'))
  mkdirSync(join(output, 'out/personal'), { recursive: true })
  for (const file of ['runtime.cjs', 'ledger.cjs', 'game-icons.json']) cpSync(join(ROOT, 'personal', file), join(output, 'out/personal', file))
  cpSync(join(ROOT, 'personal/renderer.mjs'), join(output, 'out/renderer/assets/personal-renderer.mjs'))
  cpSync(join(ROOT, 'personal/addon'), join(output, 'out/addons/personal-kina'), {
    recursive: true, filter: path => !path.includes('__pycache__') && !path.endsWith('.pyc'),
  })
  const icons = join(output, 'out/renderer/personal-icons'); mkdirSync(icons, { recursive: true })
  const assets = JSON.parse(readFileSync(join(ROOT, 'personal/game-icons.json'), 'utf8')).icons
  for (const [id, asset] of Object.entries(assets)) {
    const file = join(ROOT, 'personal/assets/icons', `${id}.webp`)
    if (createHash('sha256').update(readFileSync(file)).digest('hex') !== asset.sha256) throw new Error(`Game icon integrity mismatch: ${id}`)
    cpSync(file, join(icons, `${id}.webp`))
  }
  const drawings = {
    event: '<path d="M16 14v10m0 3v1"/><circle cx="16" cy="16" r="12"/>',
    merchant: '<path d="M7 11h18l-2 16H9zM11 11V8a5 5 0 0 1 10 0v3"/>',
    shugo: '<ellipse cx="16" cy="10" rx="10" ry="4"/><path d="M6 10v7c0 6 20 6 20 0v-7M6 17v6c0 6 20 6 20 0v-6"/>',
    rift: '<ellipse cx="16" cy="16" rx="9" ry="13"/><ellipse cx="16" cy="16" rx="4" ry="8"/>',
    invasion: '<path d="M5 4l21 21m-7 0l6-6M27 4L6 25m7 0l-6-6M5 4l6 2-4 4zM27 4l-6 2 4 4z"/>',
    siege: '<path d="M5 27V9h5v5h4V7h4v7h4V9h5v18zM13 27v-7h6v7"/>',
    dailyReset: '<path d="M8 9a11 11 0 1 1-3 13M3 9h8V2M16 9v8l5 3"/>',
  }
  drawings.weeklyReset = drawings.dailyReset; drawings.siegeBosses = drawings.siege
  drawings.kaira = drawings.event; drawings.nahma = drawings.event
  for (const [id, drawing] of Object.entries(drawings)) writeFileSync(join(icons, `${id}.svg`), `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" rx="16" fill="#201c39"/><g fill="none" stroke="#e6c66d" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${drawing}</g></svg>`)
  for (const file of ['out/main/index.js', 'out/preload/index.js', 'out/renderer/assets/index-D0Azwfnj.js']) execFileSync(process.execPath, ['--check', join(output, file)])
  return output
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const base = resolve(process.argv[2] ?? '')
  if (!process.argv[2]) throw new Error('Usage: node personal/build.mjs <original-0.2.64-program-folder> [--installer]')
  const output = join(ROOT, 'build', `personal-${Date.now()}`)
  stage(base, output)
  console.log(`Staged: ${output}`)
  if (process.argv.includes('--installer')) {
    const { build, Platform, Arch } = await import('../app/node_modules/electron-builder/out/index.js')
    await build({ projectDir: output, targets: Platform.WINDOWS.createTarget('nsis', Arch.x64), publish: 'never', config: {
      extends: null, appId: 'com.xcrov.aion2-drop-tracker', productName: 'Nyerk', executableName: 'Aion2DropTracker',
      electronVersion: '44.7.0', npmRebuild: false,
      directories: { output: join(ROOT, 'build/personal-installer'), buildResources: join(ROOT, 'app/build') },
      files: ['**/*'], extraResources: [{ from: join(base, 'resources/sidecar'), to: 'sidecar' }], asar: true, electronLanguages: ['en-US'],
      win: { target: ['nsis'], icon: join(ROOT, 'app/build/icon.ico') },
      nsis: { oneClick: true, perMachine: false, deleteAppDataOnUninstall: false, shortcutName: 'Nyerk', artifactName: 'Nyerk-Personal-0.2.64-1.1.0.exe' },
      publish: { provider: 'generic', url: 'https://nyerk.app/updates/', channel: 'latest' },
    } })
  }
}
