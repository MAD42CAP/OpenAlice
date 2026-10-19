import http, { type Server, type IncomingHttpHeaders } from 'node:http'
import net from 'node:net'
import { createHash } from 'node:crypto'
import { afterEach, expect, it } from 'vitest'
import { createInvestmentGateway } from './market-monitor-tailnet.mjs'

const origin = 'https://investment.example.ts.net:8445'
const cleanup: (() => Promise<void>)[] = []
afterEach(async () => { for (const close of cleanup.splice(0).reverse()) await close() })
async function listen(server: Server) {
  const sockets = new Set<net.Socket>()
  server.on('connection', socket => { sockets.add(socket); socket.on('close', () => sockets.delete(socket)) })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  cleanup.push(async () => { for (const socket of sockets) socket.destroy(); server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())) })
  return (server.address() as net.AddressInfo).port
}
async function fixture() {
  const calls: { path?: string; method?: string; headers: IncomingHttpHeaders; body: string }[] = []
  let authMode: 'normal' | 'timeout' | 'redirect' | 'error' | 'drip' = 'normal'
  const auth = http.createServer((req, res) => {
    expect(req.url).toBe('/api/private-access-check')
    expect(req.headers.host).toBe('investment.example.ts.net')
    expect(req.headers.origin).toBe('https://investment.example.ts.net')
    expect(req.headers.cookie).toBeUndefined()
    expect(req.headers.authorization).toBeUndefined()
    if (authMode === 'timeout') return
    if (authMode === 'drip') {
      const interval = setInterval(() => req.socket.write('HTTP/1.1 100 Continue\r\n\r\n'), 10)
      req.socket.on('close', () => clearInterval(interval)); return
    }
    if (authMode === 'redirect') { res.writeHead(302, { location: '/public' }); return res.end() }
    if (authMode === 'error') { res.writeHead(500); return res.end() }
    res.writeHead(req.headers['tailscale-user-login'] === 'owner-fixture' ? 204 : 403); res.end()
  })
  const authPort = await listen(auth)
  const upstream = http.createServer((req, res) => {
    const chunks: Buffer[] = []
    req.on('data', b => chunks.push(b)); req.on('end', () => {
      calls.push({ path: req.url, method: req.method, headers: req.headers, body: Buffer.concat(chunks).toString() })
      res.writeHead(200, { 'content-type': 'application/json', 'set-cookie': 'fixture-session=value', location: `http://127.0.0.1:${upstreamPort}/research` }); res.end('{"ok":true}')
    })
  })
  const upstreamPort = await listen(upstream)
  upstream.on('upgrade', (req, socket) => {
    calls.push({ path: req.url, headers: req.headers, body: '' })
    const accept = createHash('sha1').update(String(req.headers['sec-websocket-key']) + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64')
    socket.write(`HTTP/1.1 101 Switching Protocols\r\nConnection: Upgrade\r\nUpgrade: websocket\r\nSec-WebSocket-Accept: ${accept}\r\nSet-Cookie: fixture-session=value\r\n\r\n`)
    socket.on('data', chunk => socket.write(chunk)); socket.on('error', () => {})
  })
  const gateway = createInvestmentGateway({ origin, upstream: `http://127.0.0.1:${upstreamPort}`, authOrigin: `http://127.0.0.1:${authPort}`, authTimeoutMs: 60 })
  const port = await listen(gateway)
  cleanup.push(async () => { await gateway.shutdown() })
  const request = (headers: Record<string, string> = {}, method = 'GET', path = '/research') => new Promise<{ status: number; headers: IncomingHttpHeaders; body: string }>((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, path, method, headers: { host: new URL(origin).host, 'tailscale-user-login': 'owner-fixture', ...headers } }, res => {
      let body = ''; res.on('data', c => { body += c }); res.on('end', () => resolve({ status: res.statusCode!, headers: res.headers, body }))
    }); req.on('error', reject); req.end(method === 'POST' ? 'fixture-body' : undefined)
  })
  return { calls, port, upstreamPort, request, setAuthMode: (mode: typeof authMode) => { authMode = mode } }
}

it('authorizes exact owner through the dedicated callback and isolates cookies, credentials and forwarding headers', async () => {
  const f = await fixture()
  const res = await f.request({ cookie: 'personal-fixture=value', authorization: 'fixture-auth', forwarded: 'for=spoof', 'x-forwarded-for': 'spoof' })
  expect(res.status).toBe(200); expect(res.body).toBe('{"ok":true}')
  expect(res.headers['set-cookie']).toBeUndefined(); expect(res.headers.location).toBe(origin + '/research')
  expect(f.calls).toHaveLength(1)
  expect(f.calls[0].headers).toMatchObject({ host: `127.0.0.1:${f.upstreamPort}`, origin: `http://127.0.0.1:${f.upstreamPort}` })
  for (const field of ['cookie', 'authorization', 'forwarded', 'x-forwarded-for', 'tailscale-user-login']) expect(f.calls[0].headers[field]).toBeUndefined()
  expect((await f.request({ origin }, 'POST', '/api/fixture')).status).toBe(200)
  expect(f.calls.at(-1)?.body).toBe('fixture-body')
})

it.each([
  [{ 'tailscale-user-login': '' }, 'GET', '/research'],
  [{ 'tailscale-user-login': 'other-fixture' }, 'GET', '/research'],
  [{ host: 'wrong.example.ts.net:8445' }, 'GET', '/research'],
  [{ origin: 'https://other.example' }, 'GET', '/api/fixture'],
  [{ 'sec-fetch-site': 'cross-site' }, 'GET', '/research'],
  [{}, 'POST', '/api/fixture'],
  [{}, 'GET', '/mcp'],
  [{}, 'GET', '/%63li/fixture'],
  [{}, 'GET', '/%2e%2e/mcp/fixture'],
  [{}, 'GET', '/api/auth/login'],
  [{}, 'GET', '/safe%2f..%2fcli/fixture'],
  [{}, 'GET', '/%2563li/fixture'],
  [{}, 'GET', '/safe%5c..%5cmcp/fixture'],
] as const)('rejects unsafe request %j %s %s before touching Alice', async (headers, method, path) => {
  const f = await fixture(); expect((await f.request(headers, method, path)).status).toBe(403); expect(f.calls).toHaveLength(0)
})

it.each(['timeout', 'redirect', 'error', 'drip'] as const)('fails closed on callback %s', async mode => {
  const f = await fixture(); f.setAuthMode(mode)
  expect((await f.request()).status).toBe(503); expect(f.calls).toHaveLength(0)
})

async function raw(port: number, headers: string[], payload = '') {
  return new Promise<string>((resolve, reject) => {
    const socket = net.connect(port, '127.0.0.1'); let result = '', sent = false
    const timer = setTimeout(() => { socket.destroy(); reject(new Error('Fixture socket timed out')) }, 2000)
    const finish = () => { clearTimeout(timer); socket.destroy(); resolve(result) }
    socket.on('connect', () => socket.write(`GET /api/fixture-ws HTTP/1.1\r\n${headers.join('\r\n')}\r\n\r\n`))
    socket.on('data', chunk => {
      result += chunk.toString()
      if (payload && result.includes('101 Switching Protocols') && !sent) { sent = true; socket.write(payload) }
      if (payload && result.endsWith(payload) || !payload && result.includes('\r\n\r\n')) finish()
    }); socket.on('end', finish); socket.on('error', reject)
  })
}
const wsHeaders = () => [`Host: ${new URL(origin).host}`, `Origin: ${origin}`, 'Tailscale-User-Login: owner-fixture', 'Connection: Upgrade', 'Upgrade: websocket', 'Sec-WebSocket-Version: 13', 'Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==']
it('rejects duplicate identity, Host and Origin headers', async () => {
  for (const extra of ['Tailscale-User-Login: owner-fixture', `Host: ${new URL(origin).host}`, `Origin: ${origin}`]) {
    const f = await fixture(); const reply = await raw(f.port, [...wsHeaders(), extra])
    expect(reply).toMatch(/HTTP\/1\.1 (400|403)/); expect(f.calls).toHaveLength(0)
  }
})
it('gates websocket upgrades and strips credentials on both sides before tunnelling bytes', async () => {
  const f = await fixture(); const result = await raw(f.port, [...wsHeaders(), 'Cookie: personal-fixture=value', 'Authorization: fixture-auth'], 'fixture-echo')
  expect(result).toContain('101 Switching Protocols'); expect(result).toContain('fixture-echo'); expect(result.toLowerCase()).not.toContain('set-cookie')
  expect(f.calls).toHaveLength(1); expect(f.calls[0].headers.cookie).toBeUndefined(); expect(f.calls[0].headers.authorization).toBeUndefined()
  for (const headers of [wsHeaders().filter(h => !h.startsWith('Origin:')), wsHeaders().map(h => h.startsWith('Tailscale-User-Login:') ? 'Tailscale-User-Login: other-fixture' : h)]) {
    expect(await raw(f.port, headers)).toContain('403'); expect(f.calls).toHaveLength(1)
  }
})

it('refuses non-loopback upstreams and non-Tailscale public origins', () => {
  expect(() => createInvestmentGateway({ origin: 'http://example.com' })).toThrow()
  expect(() => createInvestmentGateway({ origin, upstream: 'http://example.com' })).toThrow()
  expect(() => createInvestmentGateway({ origin, authOrigin: 'http://127.0.0.1/path' })).toThrow()
})
