// 택씨 — 세무 도우미 봇 · 랜딩 (다크 영수증/터미널 무드)
import { useEffect, useState } from 'react'
import styles from './App.module.css'
import TutorBotWidget from './components/TutorBotWidget'
import { askBot, openBot } from './lib/botBus'
import { EXPENSES, DEDUCTIONS, CALENDAR } from './data/knowledge'

function useTheme() {
  const [theme, setTheme] = useState(() =>
    typeof window !== 'undefined' && localStorage.getItem('theme') === 'light' ? 'light' : 'dark',
  )
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme)
    localStorage.setItem('theme', theme)
  }, [theme])
  return [theme, () => setTheme((p) => (p === 'dark' ? 'light' : 'dark'))]
}

export default function App() {
  const [theme, toggleTheme] = useTheme()

  return (
    <div className={styles.page}>
      <header className={styles.nav}>
        <div className={styles.brand}>
          <span className={styles.roof} />
          <span className={styles.brandName}>택씨</span>
          <span className={styles.brandTag}>TAX·SI</span>
        </div>
        <nav className={styles.navLinks}>
          <a href="#expense">경비 판별</a>
          <a href="#deduct">환급 공제</a>
          <a href="#cal">세금 달력</a>
        </nav>
        <div className={styles.navRight}>
          <button className={styles.themeBtn} onClick={toggleTheme} aria-label="테마 전환">
            {theme === 'dark' ? '☀︎' : '☾'}
          </button>
          <button className={styles.navCta} onClick={() => openBot()}>택씨 부르기</button>
        </div>
      </header>

      {/* 히어로 — 택시 미터기 느낌 */}
      <section className={styles.hero}>
        <div className={styles.heroText}>
          <p className={`${styles.eyebrow} mono`}>TEAM 02 · 세무 도우미 봇</p>
          <h1 className={styles.title}>
            복잡한 세금,<br />목적지까지<br /><span className={styles.hl}>택씨가 모십니다.</span>
          </h1>
          <p className={styles.lede}>
            카드내역을 붙여넣으면 경비로 잡히는 항목을 골라 드리고,
            환급이 얼마나 나올지 감을 잡아 드려요.
            프리랜서 3.3%부터 5월 종소세까지, 길만 알려주세요.
          </p>
          <div className={styles.heroBtns}>
            <button className={styles.primary} onClick={() => askBot('프리랜서인데 카페에서 노트북으로 일하며 쓴 커피값, 경비로 인정될까요? 기준을 알려줘.')}>
              🧾 이거 경비 되는지 물어보기
            </button>
            <a className={styles.ghost} href="#expense">경비 기준 보기 ↓</a>
          </div>
        </div>

        <div className={styles.meter} aria-hidden="true">
          <div className={styles.meterHead}>
            <span className={styles.meterLabel}>영수증</span>
            <span className={styles.meterOn}>● 운행중</span>
          </div>
          <div className={styles.receipt}>
            <div className={styles.rRow}><span>사업소득</span><b>3,000,000</b></div>
            <div className={styles.rRow}><span>원천징수 3.3%</span><b className={styles.neg}>−99,000</b></div>
            <div className={styles.rRow}><span>필요경비</span><b className={styles.neg}>−620,000</b></div>
            <div className={styles.rDash} />
            <div className={`${styles.rRow} ${styles.rTotal}`}><span>예상 환급</span><b className={styles.pos}>+72,000</b></div>
          </div>
          <div className={styles.meterFoot}>※ 감(感) 계산 · 실제는 홈택스에서 확정</div>
        </div>
      </section>

      {/* 경비 판별 */}
      <section id="expense" className={styles.expense}>
        <SecHead k="EXPENSE / 경비" title="이건 경비 될까?" />
        <div className={styles.expGrid}>
          {EXPENSES.map((e) => (
            <button key={e.item} className={`${styles.exp} ${e.ok ? styles.expOk : styles.expNo}`}
              onClick={() => askBot(`"${e.item}" — 이거 사업 경비로 인정되는지, 조건이 뭔지 알려줘.`)}>
              <span className={styles.expMark}>{e.ok ? 'O' : 'X'}</span>
              <div>
                <b>{e.item}</b>
                <p>{e.note}</p>
              </div>
            </button>
          ))}
        </div>
        <p className={styles.expLine}>애매하면 기준은 하나 — <span className={styles.hl}>업무 관련성 + 적격증빙</span>.</p>
      </section>

      {/* 환급 공제 */}
      <section id="deduct" className={styles.deduct}>
        <SecHead k="DEDUCTION / 환급" title="놓치면 손해인 공제" />
        <div className={styles.dList}>
          {DEDUCTIONS.map((d) => (
            <div key={d.name} className={styles.dRow}>
              <div className={styles.dName}><b>{d.name}</b><span className={styles.dWho}>{d.who}</span></div>
              <p className={styles.dTip}>{d.tip}</p>
            </div>
          ))}
        </div>
        <button className={styles.primary} onClick={() => askBot('연말정산 환급을 늘리려면 뭘 챙겨야 하나요? 놓치기 쉬운 공제 위주로 알려줘.')}>
          내 환급 늘리는 법 물어보기 →
        </button>
      </section>

      {/* 세금 달력 */}
      <section id="cal" className={styles.cal}>
        <SecHead k="CALENDAR / 일정" title="세금 달력" />
        <div className={styles.calGrid}>
          {CALENDAR.map((c) => (
            <div key={c.what} className={styles.calCard}>
              <span className={`${styles.calWhen} mono`}>{c.when}</span>
              <b>{c.what}</b>
              <span className={styles.calWho}>{c.who}</span>
            </div>
          ))}
        </div>
      </section>

      <footer className={styles.footer}>
        <div className={styles.footBrand}>🚕 택씨 <span className="mono">TAX·SI</span></div>
        <p>세무 도우미 봇 · 최문혁 (데이터경영학과)</p>
        <p className={styles.footFine}>
          택씨는 세무사가 아닙니다. 일반 세무 정보와 방향만 제시하며, 실제 신고·절세 설계는 세무 전문가와 상의하세요.
        </p>
        <p className={`${styles.footTeam} mono`}>2026 비즈니스모델개발 경진대회 · TEAM 02</p>
      </footer>

      <TutorBotWidget />
    </div>
  )
}

function SecHead({ k, title }) {
  return (
    <div className={styles.secHead}>
      <span className={`${styles.secKicker} mono`}>{k}</span>
      <h2 className={styles.secTitle}>{title}</h2>
    </div>
  )
}
