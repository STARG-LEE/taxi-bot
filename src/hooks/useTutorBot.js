// useTutorBot — 플로팅 튜터봇 위젯의 모든 대화 로직.
//
// 기존 App.jsx 에 흩어져 있던 스트리밍 채팅 + 문장단위 TTS 큐 + STT(마이크) +
// 세션 상태를 하나의 훅으로 추출했다. (카메라/face-to-face 모드는 위젯에 불필요해 제거,
// 대신 음성 출력 on/off 토글을 추가.)
//
// 백엔드 계약(미수정): POST /api/chat-stream { message, history } → SSE data:{token}/{done}
//                      POST /api/tts { text } → audio ArrayBuffer
//                      POST /api/stt (MicRecorder 가 사용)

import { useCallback, useEffect, useRef, useState } from 'react'
import { newSessionId, saveChat } from '../lib/api'
import { MicRecorder, isMicRecorderSupported } from '../lib/stt'
import { BOT } from '../bot.config'

const ECHO_RESUME_DELAY_MS = 700

const GREETING_TEXT = BOT.greetingText
const GREETING_TTS = BOT.greetingTts

function normalizeTranscript(text) {
  return (text || '').replace(/\s+/g, ' ').trim()
}

// 이모지 제거 + 흔한 약어 한글 발음으로 — TTS 자연스럽게.
function normalizeTtsText(text) {
  if (!text) return ''
  const base = String(text)
    .replace(/😊|😀|😃|😄|😁|🙂|😉|👍|🙏|✨|💡|📌|🎓|📷|🎙|🎤|▶|■|◉|🤖/g, '')
    .replace(/\bAI\b/gi, '에이아이')
  const withDomain = (BOT.ttsReplace || []).reduce(
    (acc, [pat, rep]) => acc.replace(new RegExp(pat, 'gi'), rep),
    base,
  )
  return withDomain.replace(/\s+/g, ' ').trim()
}

function sanitizeForTTS(s) {
  if (!s) return ''
  return s
    .replace(/https?:\/\/[^\s)\]]+/gi, '')
    .replace(/\bwww\.[^\s)\]]+/gi, '')
    .replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, '')
    .replace(/\s{2,}/g, ' ')
    .trim()
}

export function useTutorBot() {
  const [status, setStatus] = useState('idle') // idle | connecting | connected | speaking
  const [messages, setMessages] = useState([])
  const [isProcessing, setIsProcessing] = useState(false)
  const [isListening, setIsListening] = useState(false)
  const [voiceEnabled, setVoiceEnabled] = useState(true)
  const [avatarReady, setAvatarReady] = useState(false)

  const vrmAvatarRef = useRef(null)
  const sessionIdRef = useRef(null)
  const historyRef = useRef([])
  const startedRef = useRef(false)

  // TTS 큐
  const ttsQueueRef = useRef([])
  const ttsRunningRef = useRef(false)
  const ttsAbortRef = useRef(false)

  // STT / echo-guard
  const micRecorderRef = useRef(null)
  const isSpeakingRef = useRef(false)
  const isProcessingRef = useRef(false)
  const autoListenRef = useRef(false)
  const isListeningRef = useRef(false)
  const voiceEnabledRef = useRef(true)
  const echoResumeTimerRef = useRef(null)
  const lastSubmittedSpeechRef = useRef({ key: '', at: 0 })

  useEffect(() => { isProcessingRef.current = isProcessing }, [isProcessing])
  useEffect(() => { isListeningRef.current = isListening }, [isListening])
  useEffect(() => { isSpeakingRef.current = status === 'speaking' }, [status])
  useEffect(() => { voiceEnabledRef.current = voiceEnabled }, [voiceEnabled])

  const onAvatarReady = useCallback(() => setAvatarReady(true), [])

  // ─── TTS 큐 ──────────────────────────────────────────────
  const processTTSQueue = useCallback(async () => {
    if (ttsRunningRef.current) return
    ttsRunningRef.current = true
    const avatar = vrmAvatarRef.current
    try {
      while (ttsQueueRef.current.length > 0 && !ttsAbortRef.current) {
        const bufPromise = ttsQueueRef.current.shift()
        if (!bufPromise) continue
        let buf
        try { buf = await bufPromise } catch { continue }
        if (ttsAbortRef.current) break
        if (!isSpeakingRef.current) {
          isSpeakingRef.current = true
          setStatus('speaking')
        }
        if (avatar && avatar.speak) {
          try { await avatar.speak(buf) } catch {}
        }
      }
    } finally {
      ttsRunningRef.current = false
      ttsAbortRef.current = false
      if (isSpeakingRef.current && ttsQueueRef.current.length === 0) {
        isSpeakingRef.current = false
        setStatus((s) => (s === 'speaking' ? 'connected' : s))
      }
    }
  }, [])

  const enqueueTTS = useCallback((sentence) => {
    const s = (sentence || '').trim()
    if (!s) return
    if (!voiceEnabledRef.current) return // 음성 출력 꺼짐
    const clean = sanitizeForTTS(normalizeTtsText(s))
    if (!clean) return
    const bufPromise = fetch('/api/tts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: clean }),
    }).then((res) => {
      if (!res.ok) throw new Error('tts http ' + res.status)
      return res.arrayBuffer()
    })
    ttsQueueRef.current.push(bufPromise)
    processTTSQueue()
  }, [processTTSQueue])

  const clearTTSQueue = useCallback(() => {
    ttsAbortRef.current = true
    ttsQueueRef.current = []
    try { vrmAvatarRef.current?.stopSpeaking?.() } catch {}
    isSpeakingRef.current = false
    setStatus((s) => (s === 'speaking' ? 'connected' : s))
  }, [])

  const interrupt = useCallback(() => {
    try { clearTTSQueue() } catch (e) { console.error('interrupt error:', e) }
  }, [clearTTSQueue])

  // ─── 메시지 전송 (스트리밍 SSE) ──────────────────────────
  const sendMessage = useCallback(async (userText) => {
    const text = (userText || '').trim()
    if (!text || isProcessingRef.current) return
    if (isSpeakingRef.current) interrupt() // 말하는 중이면 끊고 새 질문 받기

    isProcessingRef.current = true
    setIsProcessing(true)

    setMessages((prev) => [...prev, { role: 'user', text }])
    historyRef.current = [...historyRef.current, { role: 'user', content: text }]
    if (sessionIdRef.current) saveChat(sessionIdRef.current, 'user', text)
    setMessages((prev) => [...prev, { role: 'assistant', text: '' }])

    let accumulated = ''
    let pending = ''
    let isFirstFlush = true

    const flushPendingIfSentence = () => {
      const minLen = isFirstFlush ? 6 : 12
      let m = pending.match(/^([\s\S]*?[.!?…。\n])(.*)$/)
      if (m && m[1].trim().length >= minLen) {
        enqueueTTS(m[1]); pending = m[2]; isFirstFlush = false; return true
      }
      if (isFirstFlush) {
        m = pending.match(/^([\s\S]*?[,，、])(.*)$/)
        if (m && m[1].trim().length >= 6) {
          enqueueTTS(m[1]); pending = m[2]; isFirstFlush = false; return true
        }
      }
      return false
    }

    try {
      const res = await fetch('/api/chat-stream', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: text, history: historyRef.current.slice(-20), images: [] }),
      })
      if (!res.ok || !res.body) throw new Error('chat-stream http ' + res.status)

      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let buf = ''
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buf += decoder.decode(value, { stream: true })
        let nlIdx
        while ((nlIdx = buf.indexOf('\n\n')) !== -1) {
          const event = buf.slice(0, nlIdx).trim()
          buf = buf.slice(nlIdx + 2)
          if (!event.startsWith('data: ')) continue
          const payload = event.slice(6).trim()
          if (payload === '[DONE]') { buf = ''; break }
          let obj
          try { obj = JSON.parse(payload) } catch { continue }
          if (obj.token) {
            accumulated += obj.token
            pending += obj.token
            setMessages((prev) => {
              const next = [...prev]
              const last = next[next.length - 1]
              if (last && last.role === 'assistant') next[next.length - 1] = { ...last, text: accumulated }
              return next
            })
            while (flushPendingIfSentence()) {}
          }
          if (obj.done && pending.trim()) { enqueueTTS(pending); pending = '' }
          if (obj.error) console.warn('[chat-stream] server error:', obj.error)
        }
      }
      if (pending.trim()) { enqueueTTS(pending); pending = '' }

      const finalReply = accumulated || '죄송해요, 답변을 생성하지 못했어요.'
      historyRef.current = [...historyRef.current, { role: 'assistant', content: finalReply }]
      if (sessionIdRef.current) saveChat(sessionIdRef.current, 'assistant', finalReply)
    } catch (e) {
      console.warn('[chat-stream] error:', e)
      setMessages((prev) => {
        const next = [...prev]
        const last = next[next.length - 1]
        if (last && last.role === 'assistant' && !last.text) {
          next[next.length - 1] = { role: 'assistant', text: '연결에 문제가 있어요. 봇 채팅은 배포 환경(TEAM_ID 설정)에서 동작해요. 잠시 후 다시 시도해 주세요.' }
        }
        return next
      })
    } finally {
      isProcessingRef.current = false
      setIsProcessing(false)
    }
  }, [enqueueTTS, interrupt])

  // ─── STT ────────────────────────────────────────────────
  const submitSpeechText = useCallback((rawText) => {
    const text = normalizeTranscript(rawText)
    if (!text || text.length < 2) return
    if (isSpeakingRef.current || isProcessingRef.current) return
    const key = text.replace(/\s+/g, '')
    const now = Date.now()
    const last = lastSubmittedSpeechRef.current
    if (key === last.key && now - last.at < 8000) return
    lastSubmittedSpeechRef.current = { key, at: now }
    sendMessage(text)
  }, [sendMessage])

  const ensureMicRecorder = useCallback(() => {
    if (micRecorderRef.current) return micRecorderRef.current
    if (!isMicRecorderSupported()) {
      alert('이 브라우저는 음성 인식을 지원하지 않아요.\n텍스트로 입력해 주세요.')
      return null
    }
    const rec = new MicRecorder({
      sttEndpoint: '/api/stt',
      onTranscript: (t) => submitSpeechText(t),
      onError: (err) => console.warn('[STT] error:', err),
      onStateChange: (st) => {
        const listening = st === 'listening' || st === 'recording'
        isListeningRef.current = listening
        setIsListening(listening)
      },
    })
    micRecorderRef.current = rec
    return rec
  }, [submitSpeechText])

  const startListening = useCallback(async () => {
    const rec = ensureMicRecorder()
    if (!rec) { autoListenRef.current = false; return }
    try {
      if (!rec.isRunning) await rec.start()
      else rec.resume()
    } catch (e) {
      const denied = e?.name === 'NotAllowedError' || /denied|permission|allowed/i.test(e?.message || '')
      alert(denied ? '마이크 권한이 필요해요. 주소창 왼쪽 자물쇠에서 마이크를 허용해 주세요.' : '마이크를 시작하지 못했어요.')
      autoListenRef.current = false
      setIsListening(false)
    }
  }, [ensureMicRecorder])

  const stopListening = useCallback(() => {
    const rec = micRecorderRef.current
    if (rec) { try { rec.stop() } catch {} ; micRecorderRef.current = null }
    isListeningRef.current = false
    setIsListening(false)
  }, [])

  const toggleMic = useCallback(() => {
    if (autoListenRef.current || isListeningRef.current) {
      autoListenRef.current = false
      stopListening()
    } else {
      autoListenRef.current = true
      startListening()
    }
  }, [startListening, stopListening])

  // echo guard: 봇 발화 중 마이크 일시정지, 끝나면 재개
  useEffect(() => {
    const rec = micRecorderRef.current
    clearTimeout(echoResumeTimerRef.current)
    if (!rec || !rec.isRunning) return
    if (status === 'speaking') {
      rec.pause()
    } else if (status === 'connected' && autoListenRef.current) {
      echoResumeTimerRef.current = setTimeout(() => {
        const r = micRecorderRef.current
        if (r && r.isRunning && autoListenRef.current && !isSpeakingRef.current && !isProcessingRef.current) r.resume()
      }, ECHO_RESUME_DELAY_MS)
    }
    return () => clearTimeout(echoResumeTimerRef.current)
  }, [status])

  const toggleVoice = useCallback(() => {
    setVoiceEnabled((prev) => {
      const next = !prev
      if (!next) { try { clearTTSQueue() } catch {} } // 끄면 진행 중 음성 중단
      return next
    })
  }, [clearTTSQueue])

  // ─── 세션 시작/종료 ─────────────────────────────────────
  const startSession = useCallback(() => {
    if (startedRef.current) return
    startedRef.current = true
    sessionIdRef.current = newSessionId()
    historyRef.current = []
    setStatus('connected')
    setMessages([{ role: 'assistant', text: GREETING_TEXT }])
    saveChat(sessionIdRef.current, 'assistant', GREETING_TEXT)
    // 인사 음성 (음성 on 일 때). 아바타 로드 전이면 살짝 늦게 시도.
    setTimeout(() => enqueueTTS(GREETING_TTS), 400)
  }, [enqueueTTS])

  const stopSession = useCallback(() => {
    clearTimeout(echoResumeTimerRef.current)
    autoListenRef.current = false
    stopListening()
    try { clearTTSQueue() } catch {}
    startedRef.current = false
    sessionIdRef.current = null
    historyRef.current = []
    setMessages([])
    setStatus('idle')
  }, [clearTTSQueue, stopListening])

  // 언마운트 정리
  useEffect(() => () => {
    clearTimeout(echoResumeTimerRef.current)
    if (micRecorderRef.current) { try { micRecorderRef.current.stop() } catch {} ; micRecorderRef.current = null }
  }, [])

  return {
    status,
    messages,
    isProcessing,
    isListening,
    voiceEnabled,
    avatarReady,
    vrmAvatarRef,
    onAvatarReady,
    sendMessage,
    toggleMic,
    toggleVoice,
    interrupt,
    startSession,
    stopSession,
  }
}
