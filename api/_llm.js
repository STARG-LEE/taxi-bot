// 루멘(구 미들턴) 백엔드 어댑터.
//
// 구 백엔드는 팀별 RAG 라우트 /finbot/api/team/{TEAM_ID}/chat 을 제공했으나
// 2026-07 서버 재편으로 해당 라우트가 사라졌다. 현재 백엔드는 Open-WebUI의
// OpenAI 호환 엔드포인트 /api/chat/completions 이므로 요청/응답을 변환한다.
//
// 환경변수 (Vercel Project Settings → Environment Variables)
//   LUMEN_BASE_URL   기본 https://middleton.o-r.kr
//   LUMEN_API_KEY    Open-WebUI API 키 (필수)
//   LUMEN_MODEL      기본 gemma4:latest
//   BOT_SYSTEM_PROMPT  비워두면 api/_persona.js 의 봇별 기본 프롬프트 사용

import { DEFAULT_SYSTEM } from './_persona.js'

export const BASE = (process.env.LUMEN_BASE_URL || 'https://middleton.o-r.kr').replace(/\/+$/, '')
export const MODEL = process.env.LUMEN_MODEL || 'gemma4:latest'

const KEY = process.env.LUMEN_API_KEY || ''

export function systemPrompt() {
  return process.env.BOT_SYSTEM_PROMPT || DEFAULT_SYSTEM
}

// 프론트 계약: { message, history:[{role,content}], images:[dataURL] }
// → OpenAI chat.completions messages 배열
export function buildMessages({ message, history = [], images = [] }) {
  const messages = [{ role: 'system', content: systemPrompt() }]

  for (const h of history.slice(-8)) {
    if (!h || !h.content) continue
    messages.push({
      role: h.role === 'assistant' ? 'assistant' : 'user',
      content: String(h.content),
    })
  }

  if (images.length > 0) {
    messages.push({
      role: 'user',
      content: [
        { type: 'text', text: message },
        ...images.map((url) => ({ type: 'image_url', image_url: { url } })),
      ],
    })
  } else {
    messages.push({ role: 'user', content: message })
  }

  return messages
}

export function callUpstream({ message, history, images, stream }) {
  return fetch(`${BASE}/api/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(KEY ? { Authorization: `Bearer ${KEY}` } : {}),
    },
    body: JSON.stringify({
      model: MODEL,
      stream: Boolean(stream),
      messages: buildMessages({ message, history, images }),
    }),
  })
}

// gemma4는 thinking 모델이라 <think>…</think> 블록을 앞에 붙일 때가 있다.
// 화면/TTS 어디에도 노출되면 안 되므로 제거한다.
export function stripThinking(text) {
  if (!text) return ''
  return String(text)
    .replace(/<think>[\s\S]*?<\/think>/gi, '')
    .replace(/^\s*<think>[\s\S]*$/i, '')
    .trim()
}
