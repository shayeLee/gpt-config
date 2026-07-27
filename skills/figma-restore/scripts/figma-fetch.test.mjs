import assert from 'assert'
import { mkdtempSync, rmSync, existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { spawn } from 'child_process'
import { fileURLToPath } from 'url'
import {
  parseCliArgs, sanitizeName, sanitizeNodeId, bitmapTarget, iconTarget,
  iconTargets, loadFigmaToken, analyzeNode, fetchNode,
} from './figma-fetch.mjs'

const tests = []
const test = (name, fn) => tests.push({ name, fn })
const fakeRes = (body, status = 200) => ({
  status, ok: status >= 200 && status < 300,
  headers: { get: () => null },
  json: async () => body,
  text: async () => JSON.stringify(body),
  arrayBuffer: async () => Buffer.from(typeof body === 'string' ? body : 'asset'),
})

const root = {
  id: '0:1', type: 'FRAME', name: 'root', children: [
    { id: '1:1', type: 'RECTANGLE', name: 'photo', fills: [{ type: 'IMAGE', imageRef: 'ref-1' }] },
    { id: '1:2', type: 'FRAME', name: 'download', exportSettings: [{ format: 'PNG' }] },
    { id: '1:3', type: 'FRAME', name: 'arrow', exportSettings: [{ format: 'SVG' }] },
    {
      id: '1:4', type: 'INSTANCE', name: 'clear', absoluteBoundingBox: { width: 16, height: 16 }, children: [
        { id: '1:4:1', type: 'BOOLEAN_OPERATION', children: [{ id: '1:4:2', type: 'VECTOR' }] },
      ],
    },
  ],
}
const nodes = { nodes: { '0:1': { document: root } } }

function makeFetcher({ nodesBody = nodes, failRender = false, failBitmap = false, failSvg = false } = {}) {
  return async url => {
    if (url.includes('/v1/files/') && url.endsWith('/images')) {
      return fakeRes({ meta: { images: { 'ref-1': failBitmap ? null : 'asset://bitmap' } } })
    }
    if (url.includes('/v1/files/')) return fakeRes(nodesBody)
    if (url.includes('format=svg')) return failSvg ? fakeRes({}, 500) : fakeRes({ images: { '1:3': 'asset://svg', '1:4': 'asset://svg-instance' } })
    if (url.includes('/v1/images/')) return failRender ? fakeRes({}, 500) : fakeRes({ images: { '0:1': 'asset://render', '1:2': 'asset://bitmap' } })
    return fakeRes('asset')
  }
}

test('nodes 成功并保存 node.json', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'figma-core-'))
  try {
    await fetchNode('file', '0:1', 'token', { baseDir: dir, fetcher: makeFetcher() })
    const out = join(dir, '.figma', 'file', '0-1')
    assert.ok(existsSync(join(out, 'node.json')))
    assert.ok(existsSync(join(out, 'report.json')))
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test('每次取数清理完整旧目录并重新请求 nodes', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'figma-refresh-'))
  try {
    const out = join(dir, '.figma/file/0-1')
    mkdirSync(join(out, 'assets'), { recursive: true })
    for (const file of ['node.json', 'render@2x.png', 'report.json', 'assets/old.png']) writeFileSync(join(out, file), 'old')
    let nodeRequests = 0
    const fetcher = async url => {
      if (url.includes('/nodes')) nodeRequests++
      return makeFetcher()(url)
    }
    await fetchNode('file', '0:1', 'token', { baseDir: dir, fetcher })
    assert.strictEqual(nodeRequests, 1)
    assert.ok(!existsSync(join(out, 'assets/old.png')))
    assert.strictEqual(JSON.parse(readFileSync(join(out, 'node.json'), 'utf8')).nodes['0:1'].document.name, 'root')
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test('nodes 失败抛错且不产生成功 node.json', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'figma-nodes-fail-'))
  try {
    await assert.rejects(() => fetchNode('file', '0:1', 'token', { baseDir: dir, fetcher: makeFetcher({ nodesBody: {} }) }), /nodes 获取失败/)
    assert.ok(!existsSync(join(dir, '.figma', 'file', '0-1', 'node.json')))
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test('nodes 失败时清理旧文件', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'figma-nodes-refresh-fail-'))
  try {
    const out = join(dir, '.figma/file/0-1')
    mkdirSync(join(out, 'icons'), { recursive: true })
    writeFileSync(join(out, 'node.json'), 'old')
    writeFileSync(join(out, 'icons/old.svg'), 'old')
    await assert.rejects(() => fetchNode('file', '0:1', 'token', { baseDir: dir, fetcher: makeFetcher({ nodesBody: {} }) }), /nodes 获取失败/)
    assert.ok(!existsSync(join(out, 'node.json')))
    assert.ok(!existsSync(join(out, 'icons/old.svg')))
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test('render、位图、SVG 失败仍成功并记录手动 target/note', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'figma-resource-fail-'))
  try {
    const result = await fetchNode('file', '0:1', 'token', { baseDir: dir, fetcher: makeFetcher({ failRender: true, failBitmap: true, failSvg: true }) })
    const report = JSON.parse(readFileSync(join(dir, '.figma/file/0-1/report.json'), 'utf8'))
    assert.strictEqual(result.hadResourceFailure, true)
    for (const item of [report.render, ...report.bitmaps, ...report.icons]) {
      assert.strictEqual(item.file, null)
      assert.ok(item.target && item.note.includes('请手动获取'))
    }
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test('资源失败时不保留旧文件并写手动清单', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'figma-resource-refresh-fail-'))
  try {
    const out = join(dir, '.figma/file/0-1')
    mkdirSync(join(out, 'assets'), { recursive: true })
    writeFileSync(join(out, 'render@2x.png'), 'old')
    writeFileSync(join(out, 'assets/old.png'), 'old')
    const result = await fetchNode('file', '0:1', 'token', { baseDir: dir, fetcher: makeFetcher({ failRender: true, failBitmap: true, failSvg: true }) })
    assert.strictEqual(result.hadResourceFailure, true)
    assert.ok(!existsSync(join(out, 'assets/old.png')))
    assert.strictEqual(JSON.parse(readFileSync(join(out, 'report.json'), 'utf8')).render.file, null)
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test('多任务 A 成功、B 失败、C 不执行', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'figma-tasks-'))
  try {
    const requested = []
    const fetcher = async url => {
      requested.push(url)
      if (url.includes('/files/bad/')) return fakeRes({}, 500)
      return makeFetcher()(url)
    }
    await fetchNode('a', '0:1', 'token', { baseDir: dir, fetcher })
    await assert.rejects(() => fetchNode('bad', '0:1', 'token', { baseDir: dir, fetcher }), /nodes 获取失败/)
    assert.ok(!requested.some(url => url.includes('/files/c/')))
    assert.ok(existsSync(join(dir, '.figma/a/0-1/report.json')))
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test('资源成功写出', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'figma-resource-ok-'))
  try {
    await fetchNode('file', '0:1', 'token', { baseDir: dir, fetcher: makeFetcher() })
    const out = join(dir, '.figma/file/0-1')
    assert.ok(existsSync(join(out, 'render@2x.png')))
    assert.ok(existsSync(join(out, 'assets/ref-1.png')))
    assert.ok(existsSync(join(out, 'icons/arrow.svg')))
    assert.ok(existsSync(join(out, 'icons/clear.svg')))
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test('小型无文本矢量实例自动识别为图标', () => {
  const icon = {
    id: 'icon', type: 'INSTANCE', name: 'close', absoluteBoundingBox: { width: 16, height: 16 }, children: [
      { id: 'path', type: 'BOOLEAN_OPERATION', children: [{ id: 'vector', type: 'VECTOR' }] },
    ],
  }
  const text = {
    id: 'text', type: 'INSTANCE', name: 'label', absoluteBoundingBox: { width: 16, height: 16 }, children: [
      { id: 'path', type: 'VECTOR' }, { id: 'label', type: 'TEXT', characters: 'x' },
    ],
  }
  const { icons } = analyzeNode({ id: 'root', type: 'FRAME', children: [icon, text] })
  assert.deepStrictEqual(icons.map(item => item.id), ['icon'])
})

test('图标使用语义名，同名才以 nodeId 后缀区分', () => {
  assert.strictEqual(iconTarget({ name: '提示/一键删除', id: '1:1' }), 'icons/clear.svg')
  assert.strictEqual(iconTarget({ name: '未知', id: '1:1' }), 'icons/icon-1-1.svg')
  assert.deepStrictEqual([...iconTargets([{ name: 'arrow', id: '1:1' }, { name: 'arrow', id: '1:2' }]).values()], [
    'icons/arrow.svg', 'icons/arrow__1-2.svg',
  ])
  assert.notStrictEqual(bitmapTarget({ name: 'x', id: '1:1' }), bitmapTarget({ name: 'x', id: '1:2' }))
  assert.strictEqual(sanitizeName('a b/c'), 'a-b_c')
  assert.strictEqual(sanitizeNodeId('1:2'), '1-2')
})

test('只从项目 .env.figma 读取 FIGMA_TOKEN', () => {
  const dir = mkdtempSync(join(tmpdir(), 'figma-token-'))
  const emptyDir = mkdtempSync(join(tmpdir(), 'figma-token-empty-'))
  try {
    writeFileSync(join(dir, '.env.figma'), '# local only\nFIGMA_TOKEN = "figd_test"\n')
    assert.strictEqual(loadFigmaToken(dir), 'figd_test')
    assert.strictEqual(loadFigmaToken(emptyDir), null)
  } finally {
    rmSync(dir, { recursive: true, force: true })
    rmSync(emptyDir, { recursive: true, force: true })
  }
})

test('--data-only 拒绝', () => assert.throws(() => parseCliArgs(['--data-only']), /不支持/))

test('--inspect 拒绝', () => assert.throws(() => parseCliArgs(['--inspect']), /不支持/))

test('危险 fileKey/nodeId 在删除前拒绝', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'figma-dangerous-'))
  try {
    const sentinel = join(dir, 'sentinel')
    writeFileSync(sentinel, 'keep')
    let requested = false
    const fetcher = async () => { requested = true; return makeFetcher()('x') }
    for (const [fileKey, nodeId] of [['', '0:1'], ['.', '0:1'], ['..', '0:1'], ['a/b', '0:1'], ['a\\b', '0:1'], ['file', ''], ['file', '.'], ['file', '..'], ['file', '0/1'], ['file', '0\\1']]) {
      await assert.rejects(() => fetchNode(fileKey, nodeId, 'token', { baseDir: dir, fetcher }), /危险/)
    }
    assert.strictEqual(requested, false)
    assert.strictEqual(readFileSync(sentinel, 'utf8'), 'keep')
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test('--help 可用', async () => {
  const script = fileURLToPath(new URL('./figma-fetch.mjs', import.meta.url))
  const result = await new Promise(resolve => {
    const child = spawn(process.execPath, [script, '--help'])
    let output = ''
    child.stdout.on('data', data => { output += data })
    child.on('close', code => resolve({ code, output }))
  })
  assert.strictEqual(result.code, 0)
  assert.ok(result.output.includes('用法'))
})

let passed = 0
for (const item of tests) {
  try { await item.fn(); passed++; console.log(`  ✓ ${item.name}`) } catch (error) { console.error(`  ✗ ${item.name}\n${error.stack}`); process.exitCode = 1 }
}
console.log(`\n${passed} passed, ${tests.length - passed} failed, ${tests.length} total`)
