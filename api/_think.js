// gemma4는 thinking 모델이라 <think>…</think> 를 먼저 흘려보낸다.
// 태그가 토큰 경계에 걸쳐 쪼개져 올 수 있으므로 꼬리를 보류하며 스트림을 걸러낸다.
export function makeThinkFilter() {
  const OPEN = '<think>'
  const CLOSE = '</think>'
  let pending = ''
  let inThink = false

  // 태그 앞부분이 잘려 들어온 경우 다음 청크까지 판단을 미룬다.
  const partialTailLength = (s, tag) => {
    const max = Math.min(s.length, tag.length - 1)
    for (let n = max; n > 0; n--) {
      if (s.slice(-n) === tag.slice(0, n)) return n
    }
    return 0
  }

  return {
    push(chunk) {
      pending += chunk
      let out = ''

      while (pending) {
        if (inThink) {
          const end = pending.indexOf(CLOSE)
          if (end === -1) {
            pending = pending.slice(Math.max(0, pending.length - (CLOSE.length - 1)))
            break
          }
          pending = pending.slice(end + CLOSE.length)
          inThink = false
          continue
        }

        const start = pending.indexOf(OPEN)
        if (start !== -1) {
          out += pending.slice(0, start)
          pending = pending.slice(start + OPEN.length)
          inThink = true
          continue
        }

        const hold = partialTailLength(pending, OPEN)
        out += pending.slice(0, pending.length - hold)
        pending = pending.slice(pending.length - hold)
        break
      }

      return out
    },
  }
}
