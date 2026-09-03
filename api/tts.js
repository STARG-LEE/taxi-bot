// TTS — 텍스트를 음성(wav)으로 바꿔 프론트로 돌려준다.
//
// 프론트는 받은 wav를 재생하면서 동시에 Web Audio AnalyserNode로 분석해
// 아바타 입모양(viseme) blendshape를 구동한다.
//
// 업스트림 우선순위
//   1) OMNI_URL          — 루멘 omnivoice(한국어). 기본값이 잡혀 있어 보통 그대로 쓴다.
//   2) OPENAI_API_KEY    — 1번이 실패했을 때만 쓰는 OpenAI /v1/audio/speech 폴백.
//   3) 둘 다 안 되면 503 — 프론트는 음성 없이 텍스트 대화를 계속한다.
//
// 주: omnivoice 컨테이너는 살아 있으나 호스트 ufw가 docker0 브리지에서
// 8083 포트를 막고 있으면 /omnivoice/ 프록시가 타임아웃한다. 그 경우
// 아래 폴백이 받아주고, 폴백도 없으면 음성만 빠진다.

const LUMEN_BASE = (process.env.LUMEN_BASE_URL || 'https://middleton.o-r.kr').replace(/\/+$/, '')

const OMNI_URL = process.env.OMNI_URL || `${LUMEN_BASE}/omnivoice/v1/audio/speech`
const OMNI_MODEL = process.env.OMNI_MODEL || 'omnivoice'
// 기본 음성 — omnivoice instruct 어휘 (emo_manifest 검증값).
// 본인 봇 톤에 맞춰 OMNI_INSTRUCT 환경변수로 쉽게 교체 가능.
const OMNI_INSTRUCT =
  process.env.OMNI_INSTRUCT || 'female, young adult, moderate pitch, korean accent'

const OPENAI_KEY = process.env.OPENAI_API_KEY || ''
const OPENAI_TTS_MODEL = process.env.OPENAI_TTS_MODEL || 'gpt-4o-mini-tts'
const OPENAI_TTS_VOICE = process.env.OPENAI_TTS_VOICE || 'shimmer'

async function fromOmnivoice(input, instruct) {
  return fetch(OMNI_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: OMNI_MODEL,
      input,
      voice: 'alloy', // omnivoice는 voice 무시, instruct로 음색 제어
      response_format: 'wav',
      language: 'ko',
      instruct: instruct || OMNI_INSTRUCT,
    }),
  })
}

async function fromOpenAI(input) {
  return fetch('https://api.openai.com/v1/audio/speech', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${OPENAI_KEY}`,
    },
    body: JSON.stringify({
      model: OPENAI_TTS_MODEL,
      input,
      voice: OPENAI_TTS_VOICE,
      response_format: 'wav',
    }),
  })
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
  res.setHeader('Cache-Control', 'no-store')

  if (req.method === 'OPTIONS') return res.status(204).end()
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'method not allowed' })
  }

  const body = req.body || {}
  const input = String(body.text || '').trim()
  if (!input) return res.status(400).json({ error: 'empty text' })

  let lastError = ''

  try {
    const upstream = await fromOmnivoice(input, body.instruct)
    if (upstream.ok) return sendWav(res, upstream)
    lastError = `omnivoice ${upstream.status}: ${(await upstream.text().catch(() => '')).slice(0, 200)}`
  } catch (e) {
    lastError = 'omnivoice ' + (e.message || 'request failed')
  }

  if (!OPENAI_KEY) {
    return res.status(503).json({ error: 'tts unavailable', detail: lastError })
  }

  try {
    const upstream = await fromOpenAI(input)
    if (upstream.ok) return sendWav(res, upstream)
    lastError = `openai ${upstream.status}: ${(await upstream.text().catch(() => '')).slice(0, 200)}`
  } catch (e) {
    lastError = 'openai ' + (e.message || 'request failed')
  }

  return res.status(502).json({ error: 'tts upstream error', detail: lastError })
}

async function sendWav(res, upstream) {
  const audioBuf = Buffer.from(await upstream.arrayBuffer())
  res.setHeader('Content-Type', 'audio/wav')
  return res.status(200).send(audioBuf)
}
