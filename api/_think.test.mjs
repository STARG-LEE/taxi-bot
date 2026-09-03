// chat-stream.js 의 <think> 필터 자체 점검 — `node api/_think.test.mjs`
//
// gemma4는 thinking 모델이라 답변 앞에 <think>…</think> 를 흘려보낸다.
// 태그가 SSE 토큰 경계에 걸쳐 쪼개져 오는 경우가 실제 실패 사례라 그것까지 본다.
import assert from 'node:assert/strict'
import { makeThinkFilter } from './_think.js'

// 한 청크 안에 통째로 들어온 경우
{
  const f = makeThinkFilter()
  assert.equal(f.push('<think>속으로 고민</think>안녕하세요'), '안녕하세요')
}

// 태그가 청크 경계에 걸쳐 쪼개진 경우
{
  const f = makeThinkFilter()
  let out = ''
  for (const c of ['<th', 'ink>고민', '중</thi', 'nk>안녕', '하세요']) out += f.push(c)
  assert.equal(out, '안녕하세요')
}

// thinking 블록이 없으면 그대로 통과
{
  const f = makeThinkFilter()
  let out = ''
  for (const c of ['안녕', '하세', '요']) out += f.push(c)
  assert.equal(out, '안녕하세요')
}

// '<' 로 시작하지만 think가 아닌 텍스트는 삼키지 않는다
{
  const f = makeThinkFilter()
  let out = ''
  for (const c of ['a < b', ' 입니다']) out += f.push(c)
  assert.equal(out, 'a < b 입니다')
}

console.log('ok')