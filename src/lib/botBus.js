// 랜딩 페이지 ↔ 플로팅 튜터봇 위젯 사이의 느슨한 연결.
// 의존성 없는 초소형 pub/sub (EventTarget 래퍼).
//
// 사용 예:
//   import { askBot } from '../lib/botBus'
//   askBot('선급보험료는 왜 자산이에요?')   // 위젯이 열리고 질문이 자동 전송됨
//
// 위젯 쪽:
//   useEffect(() => onBot(BOT_EVENTS.ASK, (e) => { open(); send(e.detail.prompt) }), [])

const target = new EventTarget()

export const BOT_EVENTS = {
  ASK: 'bot:ask', // detail: { prompt, autoSend }
  OPEN: 'bot:open', // 위젯 열기만
  CLOSE: 'bot:close', // 위젯 닫기
  PRACTICE_LOAD: 'practice:load', // detail: { problemId } — 분개 연습에 특정 문제 로드
}

// 분개 연습 섹션에 특정 문제를 띄움 (대시보드 복습 추천 → 연습하기)
export function loadPractice(problemId) {
  target.dispatchEvent(new CustomEvent(BOT_EVENTS.PRACTICE_LOAD, { detail: { problemId } }))
}

// 질문을 봇에게 보냄. autoSend=false 면 입력창에 채워만 두고 전송은 사용자가.
export function askBot(prompt, { autoSend = true } = {}) {
  target.dispatchEvent(new CustomEvent(BOT_EVENTS.ASK, { detail: { prompt, autoSend } }))
}

export function openBot() {
  target.dispatchEvent(new CustomEvent(BOT_EVENTS.OPEN))
}

export function closeBot() {
  target.dispatchEvent(new CustomEvent(BOT_EVENTS.CLOSE))
}

// 구독. 정리(cleanup) 함수를 반환하므로 useEffect에서 그대로 return 가능.
export function onBot(eventName, handler) {
  target.addEventListener(eventName, handler)
  return () => target.removeEventListener(eventName, handler)
}
