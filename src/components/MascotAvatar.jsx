// MascotAvatar — 봇별 2D SVG 마스코트 아바타.
// VRMAvatar / Image2DAvatar 와 동일한 imperative handle(speak/stopSpeaking/…)을 노출하는 드롭인.
// three.js·이미지 에셋 없이, 색·소품만 바꿔 봇마다 다른 얼굴을 만든다.
//
// 움직임:
//  - idle: 부드러운 상하 호흡(CSS).
//  - blink: 2.5~5초마다 눈 감았다 뜨기.
//  - talk: /api/tts 로 받은 wav 를 Web Audio 로 재생하며 음량(RMS)에 맞춰 입이 열림.
//
// 봇별 생김새는 bot.config.js 의 BOT.mascot 로 정한다:
//   { face, faceEdge, cheek, accent, icon, eye: 'round'|'happy'|'calm'|'sleepy' }

import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react'
import styles from './MascotAvatar.module.css'
import { BOT } from '../bot.config'

const LIPSYNC_FLOOR = 0.018
const LIPSYNC_GAIN = 7.0
const SMOOTH = 0.4

const M = BOT.mascot || {}
const FACE = M.face || '#c9b8f0'
const EDGE = M.faceEdge || '#a892e0'
const CHEEK = M.cheek || '#f4a9c0'
const ACCENT = M.accent || '#7c66cf'
const ICON = M.icon || BOT.launcherIcon || '🙂'
const EYE = M.eye || 'round'

const MascotAvatar = forwardRef(function MascotAvatar({ onReady, onError, className, style }, ref) {
  const [speaking, setSpeaking] = useState(false)
  const rootRef = useRef(null)
  const mouthRef = useRef(null)
  const leftEyeRef = useRef(null)
  const rightEyeRef = useRef(null)

  const audioCtxRef = useRef(null)
  const analyserRef = useRef(null)
  const dataRef = useRef(null)
  const sourceRef = useRef(null)
  const speakingRef = useRef(false)
  const endResolveRef = useRef(null)
  const rafRef = useRef(0)
  const openRef = useRef(0)
  const readyRef = useRef(false)

  // 준비 완료(에셋 없음 → 즉시)
  useEffect(() => {
    readyRef.current = true
    const t = setTimeout(() => onReady?.(), 80)
    return () => clearTimeout(t)
  }, []) // eslint-disable-line

  // 깜빡임 타이머
  useEffect(() => {
    let alive = true
    let timer
    const blink = () => {
      if (!alive) return
      const eyes = [leftEyeRef.current, rightEyeRef.current]
      eyes.forEach((e) => e && e.classList.add(styles.blinking))
      setTimeout(() => eyes.forEach((e) => e && e.classList.remove(styles.blinking)), 130)
      timer = setTimeout(blink, 2500 + Math.random() * 2800)
    }
    timer = setTimeout(blink, 1200 + Math.random() * 1500)
    return () => { alive = false; clearTimeout(timer) }
  }, [])

  const ensureCtx = () => {
    if (!audioCtxRef.current) {
      const AC = window.AudioContext || window.webkitAudioContext
      audioCtxRef.current = new AC()
    }
    return audioCtxRef.current
  }

  const applyMouth = (v) => {
    openRef.current = v
    if (mouthRef.current) {
      // 입: 세로로 열림(0.14 살짝 다문 상태 ~ 1.0 크게)
      const sy = 0.14 + Math.max(0, Math.min(1, v)) * 0.95
      mouthRef.current.style.transform = `scaleY(${sy})`
    }
  }

  const stopVisuals = () => {
    if (rafRef.current) { cancelAnimationFrame(rafRef.current); rafRef.current = 0 }
    applyMouth(0)
    speakingRef.current = false
    setSpeaking(false)
  }

  const stopAudio = () => {
    const s = sourceRef.current
    if (s) { try { s.onended = null; s.stop() } catch {} sourceRef.current = null }
    analyserRef.current = null
    stopVisuals()
    const r = endResolveRef.current
    endResolveRef.current = null
    if (r) r()
  }

  const loop = () => {
    const tick = () => {
      if (!speakingRef.current) return
      const an = analyserRef.current
      const data = dataRef.current
      if (an && data) {
        an.getByteTimeDomainData(data)
        let sum = 0
        for (let i = 0; i < data.length; i++) { const s = (data[i] - 128) / 128; sum += s * s }
        const rms = Math.sqrt(sum / data.length)
        const open = Math.max(0, Math.min(1, (rms - LIPSYNC_FLOOR) * LIPSYNC_GAIN))
        applyMouth(openRef.current + (open - openRef.current) * SMOOTH)
      }
      rafRef.current = requestAnimationFrame(tick)
    }
    rafRef.current = requestAnimationFrame(tick)
  }

  useImperativeHandle(ref, () => ({
    isReady: () => readyRef.current,
    isSpeaking: () => speakingRef.current,
    getVRM: () => null,
    speak: async (arrayBuffer) => {
      stopAudio()
      if (!arrayBuffer || !arrayBuffer.byteLength) return
      const ctx = ensureCtx()
      if (ctx.state === 'suspended') { try { await ctx.resume() } catch {} }
      let buf
      try { buf = await ctx.decodeAudioData(arrayBuffer.slice(0)) }
      catch (e) { console.warn('[MascotAvatar] decode 실패:', e); return }
      const source = ctx.createBufferSource()
      source.buffer = buf
      const analyser = ctx.createAnalyser()
      analyser.fftSize = 1024
      source.connect(analyser); analyser.connect(ctx.destination)
      analyserRef.current = analyser
      dataRef.current = new Uint8Array(analyser.fftSize)
      sourceRef.current = source
      speakingRef.current = true
      setSpeaking(true)
      loop()
      return new Promise((resolve) => {
        endResolveRef.current = resolve
        source.onended = () => {
          if (sourceRef.current !== source) return
          sourceRef.current = null; analyserRef.current = null
          stopVisuals(); endResolveRef.current = null; resolve()
        }
        source.start()
      })
    },
    stopSpeaking: () => stopAudio(),
    setMouthOpen: (v) => applyMouth(Number(v) || 0),
    setExpression: () => {},
    wink: () => {
      const e = leftEyeRef.current
      if (!e) return
      e.classList.add(styles.blinking)
      setTimeout(() => e.classList.remove(styles.blinking), 300)
    },
  }), [])

  useEffect(() => () => {
    stopAudio()
    if (audioCtxRef.current) { try { audioCtxRef.current.close() } catch {} audioCtxRef.current = null }
  }, [])

  // 눈 모양 (path d 또는 원)
  const eyeShape = (side) => {
    const cx = side === 'l' ? 76 : 124
    if (EYE === 'happy') {
      // ^ 웃는 눈
      return <path d={`M ${cx - 9} 96 Q ${cx} 86 ${cx + 9} 96`} className={styles.eyeLine} />
    }
    if (EYE === 'sleepy') {
      return <path d={`M ${cx - 9} 94 Q ${cx} 99 ${cx + 9} 94`} className={styles.eyeLine} />
    }
    if (EYE === 'calm') {
      return <ellipse cx={cx} cy="94" rx="6" ry="7" className={styles.eyeDot} />
    }
    // round (기본)
    return <ellipse cx={cx} cy="94" rx="7.5" ry="8.5" className={styles.eyeDot} />
  }

  return (
    <div
      ref={rootRef}
      className={[styles.stage, speaking ? styles.speaking : '', className].filter(Boolean).join(' ')}
      style={style}
      onClick={() => { const e = rightEyeRef.current; if (e) { e.classList.add(styles.blinking); setTimeout(() => e.classList.remove(styles.blinking), 260) } }}
      title={`${BOT.name}`}
    >
      <div className={styles.float}>
        <svg viewBox="0 0 200 210" className={styles.svg} role="img" aria-label={`${BOT.name} 마스코트`}>
          <defs>
            <radialGradient id="faceG" cx="50%" cy="42%" r="65%">
              <stop offset="0%" stopColor={FACE} />
              <stop offset="100%" stopColor={EDGE} />
            </radialGradient>
            <filter id="soft"><feGaussianBlur stdDeviation="0.6" /></filter>
          </defs>

          {/* 그림자 */}
          <ellipse cx="100" cy="196" rx="52" ry="9" className={styles.shadow} />

          {/* 몸/머리 (둥근 블롭) */}
          <path
            d="M100 20
               C142 20 168 52 168 96
               C168 150 140 186 100 186
               C60 186 32 150 32 96
               C32 52 58 20 100 20 Z"
            fill="url(#faceG)" stroke={EDGE} strokeWidth="2"
          />

          {/* 목도리/칼라 액센트 */}
          <path d="M56 150 Q100 176 144 150 L150 166 Q100 196 50 166 Z" fill={ACCENT} opacity="0.92" />

          {/* 볼터치 */}
          <ellipse cx="66" cy="116" rx="11" ry="7" fill={CHEEK} opacity="0.55" />
          <ellipse cx="134" cy="116" rx="11" ry="7" fill={CHEEK} opacity="0.55" />

          {/* 눈 */}
          <g ref={leftEyeRef} className={styles.eye} style={{ transformOrigin: '76px 94px' }}>{eyeShape('l')}</g>
          <g ref={rightEyeRef} className={styles.eye} style={{ transformOrigin: '124px 94px' }}>{eyeShape('r')}</g>

          {/* 입 (말할 때 세로로 열림) */}
          <g style={{ transformOrigin: '100px 130px' }}>
            <ellipse ref={mouthRef} cx="100" cy="130" rx="15" ry="12"
              className={styles.mouth} style={{ transformOrigin: '100px 130px', transform: 'scaleY(0.14)' }} />
          </g>

          {/* 테마 소품 (이모지) — 머리 위 */}
          <text x="150" y="52" className={styles.icon} textAnchor="middle">{ICON}</text>
        </svg>
      </div>
      {!speaking && <div className={styles.hint}>안녕! 👋</div>}
    </div>
  )
})

export default MascotAvatar
