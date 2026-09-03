// 학습 진도 · 오답 · 통계 스토어 (localStorage 기반).
//
// PPT 6p #3 / 7p 의 "개인화 피드백" — 오답 패턴 분석, 취약 단원 시각화,
// 복습 추천 — 을 구현하기 위한 클라이언트 상태.
//
// - recordAttempt(): 분개 연습·퀴즈의 채점 결과를 누적
// - computeStats():  카테고리/단원별 정답률·취약 단원·연속기록 계산
// - 플래시카드 SRS:  Leitner 박스(1~5) 방식
// - 시험 D-day
//
// React 컴포넌트는 useProgress() 로 구독 → 변경 시 자동 리렌더.

import { useSyncExternalStore } from 'react'

const KEY = 'bungae_progress_v1'
const listeners = new Set()
let cache = null

const EMPTY = () => ({
  attempts: [], // { id, kind:'practice'|'quiz', refId, category, group, correct, at, durationMs }
  flashcards: {}, // { [cardId]: { box:1..5, reviewedAt } }
  exam: null, // { title, dateISO }
  quizBest: { score: 0, streak: 0 },
})

function load() {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) || 'null')
    if (!raw || typeof raw !== 'object') return EMPTY()
    return { ...EMPTY(), ...raw }
  } catch {
    return EMPTY()
  }
}

function getSnapshot() {
  if (!cache) cache = load()
  return cache
}

function getServerSnapshot() {
  return EMPTY()
}

function commit(next) {
  cache = next
  try {
    localStorage.setItem(KEY, JSON.stringify(next))
  } catch {}
  listeners.forEach((l) => l())
}

function subscribe(listener) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

// ─── React 훅 ───────────────────────────────────────────────
export function useProgress() {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot)
}

// ─── 변경(mutation) ─────────────────────────────────────────
let seq = 0
function uid() {
  seq += 1
  return 'a' + seq + '_' + getSnapshot().attempts.length
}

export function recordAttempt({ kind = 'practice', refId, category, group, correct, durationMs = 0 }) {
  const s = getSnapshot()
  const attempt = {
    id: uid(),
    kind,
    refId,
    category: category || '기타',
    group: group || '기타',
    correct: !!correct,
    at: Date.now(),
    durationMs,
  }
  // 최근 500개만 유지 (무한 증가 방지)
  const attempts = [...s.attempts, attempt].slice(-500)
  commit({ ...s, attempts })
  return attempt
}

export function recordQuiz({ score = 0, streak = 0 } = {}) {
  const s = getSnapshot()
  const quizBest = {
    score: Math.max(s.quizBest?.score || 0, score),
    streak: Math.max(s.quizBest?.streak || 0, streak),
  }
  commit({ ...s, quizBest })
}

export function reviewCard(cardId, remembered) {
  const s = getSnapshot()
  // "알았어요" → 완전암기(box 5)로 바로 반영(카운트 즉시 증가). "다시 볼래요" → 1로 리셋.
  const box = remembered ? 5 : 1
  const flashcards = { ...s.flashcards, [cardId]: { box, reviewedAt: Date.now() } }
  commit({ ...s, flashcards })
}

export function setExam(title, dateISO) {
  const s = getSnapshot()
  commit({ ...s, exam: title && dateISO ? { title, dateISO } : null })
}

export function resetAll() {
  commit(EMPTY())
}

// ─── 셀렉터(파생 계산) — 컴포넌트 render에서 호출 ─────────────
// 카테고리별·단원별 정답률 + 취약 단원 정렬.
export function computeStats(state) {
  const s = state || getSnapshot()
  const attempts = s.attempts || []
  const total = attempts.length
  const correct = attempts.filter((a) => a.correct).length
  const wrong = total - correct

  const byCategory = {}
  const byGroup = {}
  for (const a of attempts) {
    const c = (byCategory[a.category] ||= { attempts: 0, correct: 0 })
    c.attempts += 1
    if (a.correct) c.correct += 1
    const gKey = a.category + ' · ' + a.group
    const g = (byGroup[gKey] ||= { category: a.category, group: a.group, attempts: 0, correct: 0 })
    g.attempts += 1
    if (a.correct) g.correct += 1
  }

  const rate = (o) => (o.attempts ? Math.round((o.correct / o.attempts) * 100) : 0)
  const categories = Object.entries(byCategory).map(([name, o]) => ({ name, ...o, rate: rate(o) }))
  const groups = Object.values(byGroup).map((o) => ({ ...o, rate: rate(o) }))

  // 취약 단원: 시도 2회 이상 + 정답률 낮은 순 (동률이면 시도 많은 순)
  const weakGroups = [...groups]
    .filter((g) => g.attempts >= 1)
    .sort((a, b) => a.rate - b.rate || b.attempts - a.attempts)

  return {
    total,
    correct,
    wrong,
    accuracy: total ? Math.round((correct / total) * 100) : 0,
    categories: categories.sort((a, b) => b.attempts - a.attempts),
    groups,
    weakGroups,
    quizBest: s.quizBest || { score: 0, streak: 0 },
  }
}

// 오답노트: 가장 최근 오답부터, 같은 문제는 마지막 시도만.
export function getWrongAttempts(state, limit = 50) {
  const s = state || getSnapshot()
  const seen = new Set()
  const out = []
  for (let i = (s.attempts || []).length - 1; i >= 0; i--) {
    const a = s.attempts[i]
    if (a.correct) continue
    if (seen.has(a.refId)) continue
    // 같은 문제를 이후(더 최근)에 맞혔다면 오답노트에서 제외
    const laterCorrect = s.attempts.slice(i + 1).some((x) => x.refId === a.refId && x.correct)
    if (laterCorrect) continue
    seen.add(a.refId)
    out.push(a)
    if (out.length >= limit) break
  }
  return out
}

// 시험 D-day 계산 (남은 일수). 없으면 null.
export function getDday(state) {
  const s = state || getSnapshot()
  if (!s.exam?.dateISO) return null
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const target = new Date(s.exam.dateISO)
  target.setHours(0, 0, 0, 0)
  const days = Math.round((target - today) / 86400000)
  return { title: s.exam.title, dateISO: s.exam.dateISO, days }
}
