// 봇 채팅 (streaming SSE) — 루멘 Open-WebUI /api/chat/completions 프록시
//
// 업스트림은 OpenAI 규격 SSE({"choices":[{"delta":{"content":"..."}}]})를 보내고,
// 프론트는 아래 규격을 기대하므로 이 라우트에서 변환한다.
//
//   data: {"token":"안녕"}\n\n
//   data: {"done": true, "fullText": "..."}\n\n
//   data: [DONE]\n\n

import { callUpstream } from './_llm.js'
import { makeThinkFilter } from './_think.js'

export const config = {
  // Node 함수 — Edge로 가도 OK 하지만 호환성 위해 Node 유지
  api: { bodyParser: true, responseLimit: false },
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')

  if (req.method === 'OPTIONS') return res.status(204).end()
  if (req.method !== 'POST') return res.status(405).json({ error: 'method not allowed' })

  const { message, history = [], images = [] } = req.body || {}
  if (!message) return res.status(400).json({ error: 'message required' })

  // SSE 응답 헤더
  res.setHeader('Content-Type', 'text/event-stream')
  res.setHeader('Cache-Control', 'no-cache, no-transform')
  res.setHeader('Connection', 'keep-alive')
  res.setHeader('X-Accel-Buffering', 'no')
  res.flushHeaders?.()

  let upstream
  try {
    upstream = await callUpstream({ message, history, images, stream: true })
  } catch (e) {
    res.write(`data: ${JSON.stringify({ error: 'upstream connect failed: ' + e.message })}\n\n`)
    return res.end()
  }

  if (!upstream.ok || !upstream.body) {
    const detail = upstream.ok ? '' : await upstream.text().catch(() => '')
    res.write(`data: ${JSON.stringify({ error: 'upstream status ' + upstream.status, detail: detail.slice(0, 200) })}\n\n`)
    return res.end()
  }

  const reader = upstream.body.getReader()
  const decoder = new TextDecoder()
  const think = makeThinkFilter()
  let buf = ''
  let fullText = ''

  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      buf += decoder.decode(value, { stream: true })

      let nl
      while ((nl = buf.indexOf('\n\n')) !== -1) {
        const event = buf.slice(0, nl).trim()
        buf = buf.slice(nl + 2)
        if (!event.startsWith('data:')) continue

        const payload = event.slice(5).trim()
        if (payload === '[DONE]') continue

        let obj
        try { obj = JSON.parse(payload) } catch { continue }

        const delta = obj?.choices?.[0]?.delta?.content
        if (!delta) continue

        const token = think.push(delta)
        if (!token) continue

        fullText += token
        res.write(`data: ${JSON.stringify({ token })}\n\n`)
      }
    }
    res.write(`data: ${JSON.stringify({ done: true, fullText })}\n\n`)
    res.write('data: [DONE]\n\n')
  } catch (e) {
    try { res.write(`data: ${JSON.stringify({ error: 'stream broken: ' + e.message })}\n\n`) } catch {}
  } finally {
    try { res.end() } catch {}
  }
}
