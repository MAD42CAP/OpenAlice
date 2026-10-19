#!/usr/bin/env node
// Dedicated Tailscale Serve target. Never expose this loopback-only process
// directly: Serve supplies the identity, the personal portal decides ownership.
import http from 'node:http'
import { pathToFileURL } from 'node:url'

const MUTATIONS = new Set(['POST', 'PUT', 'PATCH', 'DELETE'])
const HOP = new Set(['connection', 'keep-alive', 'proxy-authenticate', 'proxy-authorization', 'te', 'trailer', 'transfer-encoding', 'upgrade'])

function localTarget(value) {
  const url = new URL(value)
  if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1' || url.username || url.password || url.pathname !== '/' || url.search || url.hash) throw new Error('Upstream must be a loopback HTTP origin.')
  return url
}

export function createInvestmentGateway({ origin, upstream = 'http://127.0.0.1:47331', authOrigin = 'http://127.0.0.1:4319', authTimeoutMs = 3000 }) {
  const publicUrl = new URL(origin)
  if (publicUrl.protocol !== 'https:' || !/^[a-z0-9-]+\.[a-z0-9-]+\.ts\.net$/.test(publicUrl.hostname) || publicUrl.username || publicUrl.password || publicUrl.pathname !== '/' || publicUrl.search || publicUrl.hash) throw new Error('A dedicated Tailscale HTTPS origin is required.')
  const target = localTarget(upstream), authTarget = localTarget(authOrigin)
  const connections = new Set()
  const deny = (res, code = 403) => { res.writeHead(code, { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' }); res.end(code === 503 ? 'Private access temporarily unavailable.' : 'Private access required.') }
  const rejectSocket = (socket, code = 403) => socket.end(`HTTP/1.1 ${code} Private access required\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`)
  const authorize = async (req, websocket = false) => {
    if (req.socket.remoteAddress !== '127.0.0.1' && req.socket.remoteAddress !== '::ffff:127.0.0.1') return 403
    const headerCount = name => req.rawHeaders.filter((_, i) => i % 2 === 0 && req.rawHeaders[i].toLowerCase() === name).length
    if (headerCount('host') !== 1 || headerCount('origin') > 1 || !['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'].includes(req.method)) return 403
    if (req.headers.host?.toLowerCase() !== publicUrl.host || !req.url?.startsWith('/') || req.url.startsWith('//')) return 403
    let pathname
    try {
      pathname = new URL(req.url, publicUrl).pathname
      for (let i = 0; i < 4; i++) {
        const decoded = decodeURIComponent(pathname)
        const normalized = new URL(decoded, publicUrl)
        if (normalized.origin !== publicUrl.origin) return 403
        const next = normalized.pathname.replace(/\/+/g, '/')
        if (next === pathname) break
        pathname = next
      }
    } catch { return 403 }
    if (/^\/(?:mcp|cli)(?:\/|$)/i.test(pathname) || /^\/api\/auth\/(?:login|logout)\/?$/.test(pathname)) return 403
    const inputOrigin = req.headers.origin
    if (inputOrigin !== undefined && inputOrigin !== publicUrl.origin) return 403
    if ((MUTATIONS.has(req.method) || websocket) && inputOrigin !== publicUrl.origin) return 403
    if (req.headers['sec-fetch-site'] === 'cross-site') return 403
    const identityCount = req.rawHeaders.filter((_, i) => i % 2 === 0 && req.rawHeaders[i].toLowerCase() === 'tailscale-user-login').length
    const identity = req.headers['tailscale-user-login']
    if (identityCount !== 1 || typeof identity !== 'string' || !identity.trim() || identity.length > 512 || /[\r\n,]/.test(identity)) return 403
    return new Promise(resolve => {
      let settled = false
      const finish = result => { if (settled) return; settled = true; clearTimeout(deadline); check.destroy(); resolve(result) }
      // No personal notes, configuration or identity values are returned.
      const check = http.request(authTarget, { method: 'GET', path: '/api/private-access-check', headers: { host: publicUrl.hostname, origin: `https://${publicUrl.hostname}`, 'tailscale-user-login': identity } }, response => {
        finish(response.statusCode === 204 ? 0 : response.statusCode === 403 ? 403 : 503)
      })
      const deadline = setTimeout(() => finish(503), authTimeoutMs)
      check.on('error', () => finish(503)); check.end()
    })
  }
  const requestHeaders = (req, websocket = false) => {
    const extraHop = new Set(String(req.headers.connection ?? '').toLowerCase().split(',').map(s => s.trim()))
    const headers = {}
    for (const [name, value] of Object.entries(req.headers)) {
      if (HOP.has(name) || extraHop.has(name) || ['cookie', 'authorization', 'forwarded', 'host', 'origin', 'referer'].includes(name) || name.startsWith('tailscale-') || name.startsWith('x-forwarded-')) continue
      headers[name] = value
    }
    // Only reached after exact owner authorization and external Origin checks.
    headers.host = target.host; headers.origin = target.origin
    if (websocket) { headers.connection = 'Upgrade'; headers.upgrade = 'websocket' }
    return headers
  }
  const responseHeaders = (incoming, websocket = false) => {
    const headers = {}
    const extraHop = new Set(String(incoming.connection ?? '').toLowerCase().split(',').map(s => s.trim()))
    for (const [name, value] of Object.entries(incoming)) {
      if (HOP.has(name) || extraHop.has(name) || name === 'set-cookie' || name.startsWith('access-control-')) continue
      headers[name] = value
    }
    if (typeof headers.location === 'string' && headers.location.startsWith(target.origin + '/')) headers.location = publicUrl.origin + headers.location.slice(target.origin.length)
    headers['cache-control'] = 'no-store'; headers['referrer-policy'] = 'no-referrer'; headers['x-content-type-options'] = 'nosniff'; headers['content-security-policy'] = "frame-ancestors 'none'"
    if (websocket) { headers.connection = 'Upgrade'; headers.upgrade = 'websocket' }
    return headers
  }
  const server = http.createServer(async (req, res) => {
    const decision = await authorize(req)
    if (decision) return deny(res, decision)
    if (req.destroyed) return
    const proxy = http.request(target, { method: req.method, path: req.url, headers: requestHeaders(req) }, upstreamResponse => {
      proxy.setTimeout(0)
      res.writeHead(upstreamResponse.statusCode ?? 502, responseHeaders(upstreamResponse.headers)); upstreamResponse.pipe(res)
      upstreamResponse.on('error', () => res.destroy())
    })
    proxy.setTimeout(15_000, () => proxy.destroy())
    proxy.on('error', () => { if (!res.headersSent) deny(res, 503); else res.destroy() })
    req.on('aborted', () => proxy.destroy()); res.on('close', () => proxy.destroy()); req.pipe(proxy)
  })
  server.on('upgrade', async (req, socket, head) => {
    socket.on('error', () => {})
    const decision = await authorize(req, true)
    if (decision) return rejectSocket(socket, decision)
    if (socket.destroyed || req.headers.upgrade?.toLowerCase() !== 'websocket') return rejectSocket(socket)
    const proxy = http.request(target, { method: 'GET', path: req.url, headers: requestHeaders(req, true) })
    proxy.setTimeout(15_000, () => proxy.destroy())
    proxy.on('upgrade', (reply, upstreamSocket, upstreamHead) => {
      proxy.setTimeout(0); upstreamSocket.setTimeout(0)
      const headers = responseHeaders(reply.headers, true)
      socket.write(`HTTP/1.1 101 Switching Protocols\r\n${Object.entries(headers).map(([k, v]) => `${k}: ${v}`).join('\r\n')}\r\n\r\n`)
      if (upstreamHead.length) socket.write(upstreamHead)
      if (head.length) upstreamSocket.write(head)
      socket.pipe(upstreamSocket); upstreamSocket.pipe(socket)
      socket.on('close', () => upstreamSocket.destroy()); upstreamSocket.on('close', () => socket.destroy())
      upstreamSocket.on('error', () => socket.destroy())
    })
    proxy.on('response', response => { response.resume(); rejectSocket(socket, 503) })
    proxy.on('error', () => { if (!socket.destroyed) rejectSocket(socket, 503) }); proxy.end()
  })
  server.on('connection', socket => { connections.add(socket); socket.on('close', () => connections.delete(socket)) })
  server.shutdown = () => { for (const socket of connections) socket.destroy(); return new Promise(resolve => server.close(resolve)) }
  return server
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = Object.fromEntries(process.argv.slice(2).map(arg => { const match = /^--(origin|port)=(.+)$/.exec(arg); if (!match) throw new Error('Expected --origin=https://host.tailnet.ts.net:port and --port=loopback-port.'); return [match[1], match[2]] }))
  const port = Number(args.port ?? 4321)
  if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('Invalid loopback port.')
  const server = createInvestmentGateway({ origin: args.origin })
  server.listen(port, '127.0.0.1', () => console.log('[investment-tailnet] Private gateway ready.'))
  for (const signal of ['SIGTERM', 'SIGINT']) process.once(signal, () => { void server.shutdown().then(() => process.exit(0)) })
}
