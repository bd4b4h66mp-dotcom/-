// 繰上げ返済 効果シミュレーター — GitHub Pages 用スタンドアロン版
// Claude の window.storage / lucide-react には依存せず、
// localStorage と URL共有コードだけで動く単体ページとして動作します。
// React / ReactDOM はグローバル（CDNのUMDビルド）を利用します。
const { useState, useEffect } = React;

// ---------- date helpers (YYYY-MM strings) ----------
function parseYM(ym) {
  const [y, m] = ym.split("-").map(Number);
  return { y, m };
}
function monthsBetween(a, b) {
  const pa = parseYM(a), pb = parseYM(b);
  return (pb.y - pa.y) * 12 + (pb.m - pa.m);
}
function addMonths(ym, n) {
  const p = parseYM(ym);
  const total = p.y * 12 + (p.m - 1) + n;
  const y = Math.floor(total / 12);
  const m = (total % 12) + 1;
  return `${y}/${String(m).padStart(2, "0")}`;
}
function currentYM() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

// ---------- finance helpers ----------
function monthlyPayment(balance, ratePercent, months) {
  const r = ratePercent / 100 / 12;
  if (months <= 0) return balance;
  if (r === 0) return balance / months;
  return (balance * r) / (1 - Math.pow(1 + r, -months));
}
function remainingMonthsFor(balance, ratePercent, payment) {
  const r = ratePercent / 100 / 12;
  if (balance <= 0) return 0;
  if (r === 0) return Math.max(1, Math.ceil(balance / payment));
  const ratio = (balance * r) / payment;
  if (ratio >= 1) return 600;
  return Math.max(1, Math.ceil(-Math.log(1 - ratio) / Math.log(1 + r)));
}

function simulate(principal, termMonths, rateChanges, extraRepayments, options = {}) {
  const { applyFiveYearRule = false, reviewIntervalMonths = 60, maxIncreaseRatio = 1.25 } = options;
  let balance = principal;
  let remainingMonths = termMonths;
  let currentRate = rateChanges[0].rate;
  let payment = monthlyPayment(balance, currentRate, remainingMonths);
  let totalInterest = 0;
  let unpaidInterestTotal = 0;
  const history = [{ m: 0, balance, payment, interest: 0, principalPaid: 0, regularPrincipalPaid: 0, extraPrincipalPaid: 0 }];

  let rateIdx = 1;
  let exIdx = 0;
  const maxLoop = termMonths + 120;
  let nextReviewMonth = applyFiveYearRule ? reviewIntervalMonths : null;

  for (let m = 1; m <= maxLoop; m++) {
    if (balance <= 0.5) {
      history.push({ m, balance: 0, payment: 0, interest: 0, principalPaid: 0, regularPrincipalPaid: 0, extraPrincipalPaid: 0 });
      if (rateIdx >= rateChanges.length && exIdx >= extraRepayments.length) break;
      continue;
    }
    let rateChangedThisMonth = false;
    while (rateIdx < rateChanges.length && rateChanges[rateIdx].m === m) {
      currentRate = rateChanges[rateIdx].rate;
      rateIdx++;
      rateChangedThisMonth = true;
    }
    if (rateChangedThisMonth && !applyFiveYearRule) {
      payment = monthlyPayment(balance, currentRate, Math.max(remainingMonths, 1));
    }

    if (applyFiveYearRule && m === nextReviewMonth) {
      const idealPayment = monthlyPayment(balance, currentRate, Math.max(remainingMonths, 1));
      payment = idealPayment > payment ? Math.min(idealPayment, payment * maxIncreaseRatio) : idealPayment;
      nextReviewMonth += reviewIntervalMonths;
    }

    const r = currentRate / 100 / 12;
    const interest = balance * r;
    let principalPaid = payment - interest;
    if (principalPaid < 0) {
      const shortfall = -principalPaid;
      unpaidInterestTotal += shortfall;
      balance += shortfall;
      principalPaid = 0;
    } else if (principalPaid > balance) {
      principalPaid = balance;
      payment = interest + principalPaid;
    }
    balance = Math.max(0, balance - principalPaid);
    remainingMonths = Math.max(0, remainingMonths - 1);
    totalInterest += interest;

    let extraThisMonth = 0;
    while (exIdx < extraRepayments.length && extraRepayments[exIdx].m === m) {
      const ex = extraRepayments[exIdx];
      const amt = Math.min(ex.amount, balance);
      balance -= amt;
      extraThisMonth += amt;
      if (balance <= 0.5) {
        balance = 0;
        remainingMonths = 0;
      } else if (ex.type === "shorten") {
        remainingMonths = remainingMonthsFor(balance, currentRate, payment);
      } else {
        payment = monthlyPayment(balance, currentRate, Math.max(remainingMonths, 1));
      }
      exIdx++;
    }
    history.push({
      m,
      balance,
      payment,
      interest,
      principalPaid: principalPaid + extraThisMonth,
      regularPrincipalPaid: principalPaid,
      extraPrincipalPaid: extraThisMonth,
    });
    if (balance <= 0 && rateIdx >= rateChanges.length && exIdx >= extraRepayments.length) break;
  }
  const last = history[history.length - 1];
  return {
    history,
    totalInterest,
    payoffMonth: last.m,
    unpaidInterestTotal,
    didNotPayOff: last.balance > 0,
  };
}

const man = (n) => Math.round(n / 10000).toLocaleString("ja-JP");
const nextId = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;

// ---------- prepayment vs. investing comparison ----------
function fvMonthly(amount, months, annualReturnPct) {
  const r = annualReturnPct / 100 / 12;
  if (r === 0 || months <= 0) return amount;
  return amount * Math.pow(1 + r, months);
}
function buildPaymentSeries(hypoHistory, maxMonth) {
  const map = new Map(hypoHistory.map((h) => [h.m, h.payment]));
  const series = [];
  let last = hypoHistory.length ? hypoHistory[0].payment : 0;
  for (let m = 0; m <= maxMonth; m++) {
    if (map.has(m)) last = map.get(m);
    series[m] = last;
  }
  return series;
}
function computeInvestmentComparison({
  hypoHistory,
  exFinal,
  actualPayoffMonth,
  hypoPayoffMonth,
  annualReturnPct,
  interestSavings,
  taxDeductionReduction = 0,
  prepaymentFee = 0,
}) {
  if (exFinal.length === 0 || hypoPayoffMonth - actualPayoffMonth < 1) return null;
  const paymentSeries = buildPaymentSeries(hypoHistory, hypoPayoffMonth);

  function totals(rate) {
    const investFV = exFinal.reduce((sum, e) => sum + fvMonthly(e.amount, Math.max(0, hypoPayoffMonth - e.m), rate), 0);
    let freedCashFV = 0;
    for (let m = actualPayoffMonth + 1; m <= hypoPayoffMonth; m++) {
      const pay = paymentSeries[m] ?? paymentSeries[paymentSeries.length - 1] ?? 0;
      freedCashFV += fvMonthly(pay, hypoPayoffMonth - m, rate);
    }
    return { investFV, freedCashFV };
  }

  const netInterestSavings = interestSavings - taxDeductionReduction - prepaymentFee;
  const { investFV, freedCashFV } = totals(annualReturnPct);
  const prepayTotalEffect = freedCashFV + netInterestSavings;
  const investTotalEffect = investFV;

  let breakevenRate = null;
  let prevDiff = null;
  for (let rr = 0; rr <= 15.001; rr += 0.1) {
    const t = totals(rr);
    const diff = t.investFV - (t.freedCashFV + netInterestSavings);
    if (prevDiff !== null && Math.sign(diff) !== Math.sign(prevDiff)) {
      breakevenRate = Math.round(rr * 10) / 10;
      break;
    }
    prevDiff = diff;
  }

  return {
    investFV,
    freedCashFV,
    interestSavings,
    taxDeductionReduction,
    prepaymentFee,
    netInterestSavings,
    prepayTotalEffect,
    investTotalEffect,
    breakevenRate,
    gapMonths: hypoPayoffMonth - actualPayoffMonth,
  };
}

function defaultTabData(name) {
  return {
    id: nextId(),
    name: name || "シミュレーション1",
    principal: 3000,
    startYM: "2020-04",
    termYears: 35,
    rateChanges: [{ id: nextId(), ym: "2020-04", rate: 0.6 }],
    extras: [{ id: nextId(), ym: "2024-04", amount: 100, type: "shorten" }],
    applyFiveYearRule: true,
    investReturnRate: 3,
    isActual: false,
    result: null,
  };
}

// ---------- local persistence (this browser only) ----------
const STORAGE_KEY = "mortgage-prepayment-tabs-v1";
function loadTabsFromStorage() {
  try {
    if (typeof window === "undefined" || !window.localStorage) return { supported: false, data: null };
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return { supported: true, data: null };
    const data = JSON.parse(raw);
    if (data && Array.isArray(data.tabs) && data.tabs.length > 0) return { supported: true, data };
    return { supported: true, data: null };
  } catch (e) {
    return { supported: false, data: null };
  }
}
function saveTabsToStorage(state) {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    return true;
  } catch (e) {
    return false;
  }
}

// ---------- share code: a self-contained link, no backend required ----------
function encodeShareCode(tab) {
  const payload = {
    name: tab.name,
    principal: tab.principal,
    startYM: tab.startYM,
    termYears: tab.termYears,
    rateChanges: (tab.rateChanges || []).map((r) => ({ ym: r.ym, rate: r.rate })),
    extras: (tab.extras || []).map((e) => ({ ym: e.ym, amount: e.amount, type: e.type })),
    applyFiveYearRule: tab.applyFiveYearRule,
    investReturnRate: tab.investReturnRate,
  };
  return btoa(unescape(encodeURIComponent(JSON.stringify(payload))));
}
function parseShareInput(input) {
  let raw = (input || "").trim();
  const hashPos = raw.indexOf("#s=");
  if (hashPos >= 0) raw = raw.slice(hashPos + 3);
  else if (raw.startsWith("s=")) raw = raw.slice(2);
  raw = raw.replace(/\s+/g, "");
  if (!raw) return null;
  try {
    const json = decodeURIComponent(escape(atob(raw)));
    const obj = JSON.parse(json);
    if (!obj || typeof obj !== "object") return null;
    return obj;
  } catch (e) {
    return null;
  }
}
async function copyText(text) {
  try {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch (e) {}
  try {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.left = "-9999px";
    document.body.appendChild(ta);
    ta.focus();
    ta.select();
    const ok = document.execCommand("copy");
    document.body.removeChild(ta);
    return ok;
  } catch (e) {
    return false;
  }
}

// ---------- lightweight inline SVG line chart ----------
// ---------- 現在の状況ページ用のグラフ類 ----------
function BalanceTimelineChart({ history, startYM, payoffMonth, elapsedMonth, principalYen }) {
  const step = payoffMonth > 300 ? 6 : payoffMonth > 150 ? 3 : 1;
  const data = [];
  for (let m = 0; m <= payoffMonth; m += step) {
    const idx = Math.min(m, history.length - 1);
    data.push({ m, date: addMonths(startYM, m), balance: Math.round(history[idx].balance / 10000) });
  }
  if (payoffMonth % step !== 0) {
    data.push({ m: payoffMonth, date: addMonths(startYM, payoffMonth), balance: 0 });
  }

  const width = 600, height = 220;
  const pad = { top: 20, right: 14, bottom: 26, left: 52 };
  const w = width - pad.left - pad.right;
  const h = height - pad.top - pad.bottom;
  const principalMan = Math.round(principalYen / 10000);
  const maxVal = Math.max(1, principalMan, ...data.map((d) => d.balance));
  const n = data.length;
  const xAt = (i) => pad.left + (n <= 1 ? 0 : (i / (n - 1)) * w);
  const yAt = (v) => pad.top + h - (v / maxVal) * h;
  const pts = data.map((d, i) => `${xAt(i)},${yAt(d.balance)}`).join(" ");

  let nowIdx = 0;
  data.forEach((d, i) => {
    if (Math.abs(d.m - elapsedMonth) < Math.abs(data[nowIdx].m - elapsedMonth)) nowIdx = i;
  });
  const nowX = xAt(nowIdx);
  const nowY = yAt(data[nowIdx].balance);
  const areaPts = data.slice(0, nowIdx + 1).map((d, i) => `${xAt(i)},${yAt(d.balance)}`).join(" ");
  const areaPath = `M ${pad.left},${pad.top + h} L ${areaPts} L ${nowX},${pad.top + h} Z`;

  const gridCount = 4;
  const grid = [];
  for (let g = 0; g <= gridCount; g++) grid.push(Math.round((maxVal * g) / gridCount));
  const xTickIdxs = n <= 1 ? [0] : [0, Math.floor((n - 1) / 2), n - 1];

  return (
    <svg viewBox={`0 0 ${width} ${height}`} style={{ width: "100%", height: "auto", display: "block" }}>
      {grid.map((val, idx) => {
        const y = yAt(val);
        return (
          <g key={idx}>
            <line x1={pad.left} x2={width - pad.right} y1={y} y2={y} stroke={T.divider} strokeWidth="1" />
            <text x={pad.left - 6} y={y + 3} fontSize="10" fill={T.muted} textAnchor="end">{val.toLocaleString()}万</text>
          </g>
        );
      })}
      {xTickIdxs.map((idx, i) => (
        <text key={idx} x={xAt(idx)} y={height - 8} fontSize="10" fill={T.muted} textAnchor={i === xTickIdxs.length - 1 ? "end" : i === 0 ? "start" : "middle"}>
          {data[idx] ? data[idx].date : ""}
        </text>
      ))}
      <path d={areaPath} fill={T.accentSoft} stroke="none" />
      <polyline points={pts} fill="none" stroke={T.accent} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
      <line x1={nowX} x2={nowX} y1={pad.top} y2={pad.top + h} stroke={T.ink} strokeWidth="1.5" strokeDasharray="4 3" />
      <circle cx={nowX} cy={nowY} r="4.5" fill={T.ink} />
      <text x={nowX} y={pad.top - 6} fontSize="10.5" fill={T.ink} fontWeight="700" textAnchor="middle">現在</text>
    </svg>
  );
}

function PaymentDonut({ principalPaid, interest, size = 108, strokeWidth = 16 }) {
  const total = principalPaid + interest || 1;
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const principalFrac = principalPaid / total;
  const principalDash = principalFrac * circumference;
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
      <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke={T.divider} strokeWidth={strokeWidth} />
      <circle
        cx={size / 2} cy={size / 2} r={radius} fill="none"
        stroke={T.accent} strokeWidth={strokeWidth}
        strokeDasharray={`${principalDash} ${circumference - principalDash}`}
        transform={`rotate(-90 ${size / 2} ${size / 2})`}
      />
      <circle
        cx={size / 2} cy={size / 2} r={radius} fill="none"
        stroke="#C98A4B" strokeWidth={strokeWidth}
        strokeDasharray={`${circumference - principalDash} ${principalDash}`}
        strokeDashoffset={-principalDash}
        transform={`rotate(-90 ${size / 2} ${size / 2})`}
      />
      <text x={size / 2} y={size / 2 - 2} fontSize="15" fontWeight="700" fill={T.ink} textAnchor="middle">
        {Math.round(principalFrac * 100)}%
      </text>
      <text x={size / 2} y={size / 2 + 13} fontSize="9" fill={T.muted} textAnchor="middle">元金</text>
    </svg>
  );
}

function ProgressBar({ percent, color, label, rightLabel }) {
  const pct = Math.min(100, Math.max(0, percent));
  return (
    <div style={{ marginBottom: 14 }}>
      <div style={S.progressLabelRow}>
        <span>{label}</span>
        <span>{rightLabel ?? `${Math.round(pct)}%`}</span>
      </div>
      <div style={S.progressTrack}>
        <div style={{ ...S.progressFill, width: `${pct}%`, background: color || T.accent }} />
      </div>
    </div>
  );
}

function LedgerChart({ data }) {
  const width = 600, height = 260;
  const pad = { top: 16, right: 14, bottom: 26, left: 52 };
  const w = width - pad.left - pad.right;
  const h = height - pad.top - pad.bottom;
  const maxVal = Math.max(1, ...data.map((d) => Math.max(d.actual, d.hypo)));
  const n = data.length;
  const xAt = (i) => pad.left + (n <= 1 ? 0 : (i / (n - 1)) * w);
  const yAt = (v) => pad.top + h - (v / maxVal) * h;
  const ptsActual = data.map((d, i) => `${xAt(i)},${yAt(d.actual)}`).join(" ");
  const ptsHypo = data.map((d, i) => `${xAt(i)},${yAt(d.hypo)}`).join(" ");
  const gridCount = 4;
  const grid = [];
  for (let g = 0; g <= gridCount; g++) grid.push(Math.round((maxVal * g) / gridCount));
  const xTickIdxs = n <= 1 ? [0] : [0, Math.floor((n - 1) / 2), n - 1];

  return (
    <svg viewBox={`0 0 ${width} ${height}`} style={{ width: "100%", height: "auto", display: "block" }}>
      {grid.map((val, idx) => {
        const y = yAt(val);
        return (
          <g key={idx}>
            <line x1={pad.left} x2={width - pad.right} y1={y} y2={y} stroke={T.divider} strokeWidth="1" />
            <text x={pad.left - 6} y={y + 3} fontSize="10" fill={T.muted} textAnchor="end">{val.toLocaleString()}万</text>
          </g>
        );
      })}
      {xTickIdxs.map((idx) => (
        <text key={idx} x={xAt(idx)} y={height - 8} fontSize="10" fill={T.muted} textAnchor="middle">
          {data[idx] ? data[idx].date : ""}
        </text>
      ))}
      <polyline points={ptsHypo} fill="none" stroke="#A6ADA6" strokeWidth="2" strokeDasharray="6 4" strokeLinecap="round" />
      <polyline points={ptsActual} fill="none" stroke={T.accent} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

// ---------- hand-drawn inline icon set (no external icon package needed) ----------
function IconBase({ size = 16, strokeWidth = 2, children }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" style={{ display: "block", flexShrink: 0 }}>
      {children}
    </svg>
  );
}
const Share2 = (p) => <IconBase {...p}><circle cx="6" cy="12" r="2.4" /><circle cx="18" cy="6" r="2.4" /><circle cx="18" cy="18" r="2.4" /><line x1="8.1" y1="10.8" x2="15.9" y2="7.2" /><line x1="8.1" y1="13.2" x2="15.9" y2="16.8" /></IconBase>;
const RotateCcw = (p) => <IconBase {...p}><path d="M3.5 12a8.5 8.5 0 1 0 2.8-6.3" /><polyline points="3 4 3.5 9 8.5 8.3" /></IconBase>;
const Pencil = (p) => <IconBase {...p}><path d="M4 20l0.9-4L15 5.9l3.1 3.1L8 19.1z" /><line x1="13.3" y1="7.6" x2="16.4" y2="10.7" /></IconBase>;
const XIcon = (p) => <IconBase {...p}><line x1="6" y1="6" x2="18" y2="18" /><line x1="18" y1="6" x2="6" y2="18" /></IconBase>;
const Plus = (p) => <IconBase {...p}><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></IconBase>;
const LinkIcon = (p) => <IconBase {...p}><path d="M9.5 14.5l5-5" /><path d="M8 16.5a3.5 3.5 0 0 1 0-5l2-2a3.5 3.5 0 0 1 5 5" /><path d="M16 7.5a3.5 3.5 0 0 1 0 5l-2 2a3.5 3.5 0 0 1-5-5" /></IconBase>;
const Check = (p) => <IconBase {...p}><polyline points="5 13 10 18 19 7" /></IconBase>;
const Landmark = (p) => <IconBase {...p}><line x1="4" y1="21" x2="20" y2="21" /><line x1="5" y1="10" x2="5" y2="19" /><line x1="10" y1="10" x2="10" y2="19" /><line x1="14" y1="10" x2="14" y2="19" /><line x1="19" y1="10" x2="19" y2="19" /><polygon points="12 3 21 8 3 8" /></IconBase>;
const TrendingUp = (p) => <IconBase {...p}><polyline points="3 17 9 11 13 15 21 6" /><polyline points="14 6 21 6 21 13" /></IconBase>;
const PiggyBank = (p) => <IconBase {...p}><circle cx="9" cy="10" r="4.5" /><circle cx="15" cy="10" r="4.5" /><line x1="12" y1="17.5" x2="12" y2="20" /></IconBase>;
const BarChart3 = (p) => <IconBase {...p}><line x1="4" y1="20" x2="4" y2="12" /><line x1="10" y1="20" x2="10" y2="7" /><line x1="16" y1="20" x2="16" y2="4" /><line x1="3" y1="20" x2="21" y2="20" /></IconBase>;
const Scale = (p) => <IconBase {...p}><line x1="12" y1="3" x2="12" y2="19" /><line x1="6" y1="4" x2="18" y2="4" /><line x1="5" y1="19" x2="19" y2="19" /><path d="M5 7l-3 6h6l-3-6z" /><path d="M19 7l-3 6h6l-3-6z" /></IconBase>;
const TriangleAlert = (p) => <IconBase {...p}><path d="M12 3l10 18H2L12 3z" /><line x1="12" y1="9" x2="12" y2="14" /><circle cx="12" cy="17.3" r="0.6" fill="currentColor" stroke="none" /></IconBase>;
const Flag = (p) => <IconBase {...p}><line x1="5" y1="21" x2="5" y2="4" /><path d="M5 4.5c2-1.2 4-1.2 6 0s4 1.2 6 0v9c-2 1.2-4 1.2-6 0s-4-1.2-6 0z" /></IconBase>;
const Home = (p) => <IconBase {...p}><path d="M4 11l8-7 8 7" /><path d="M6 10v10h12V10" /></IconBase>;
const Table = (p) => <IconBase {...p}><rect x="3.5" y="4.5" width="17" height="15" rx="1.5" /><line x1="3.5" y1="9.5" x2="20.5" y2="9.5" /><line x1="3.5" y1="14.5" x2="20.5" y2="14.5" /><line x1="10.5" y1="4.5" x2="10.5" y2="19.5" /></IconBase>;

// ---------- small reusable pieces ----------
function IconBtn({ icon: Icon, label, onClick, variant = "ghost", disabled, small, title }) {
  const [hover, setHover] = useState(false);
  const base = {
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
    fontSize: small ? 12 : 12.5,
    fontWeight: 600,
    padding: small ? "6px 10px" : "8px 14px",
    borderRadius: 8,
    cursor: disabled ? "default" : "pointer",
    border: "1px solid transparent",
    whiteSpace: "nowrap",
    transition: "background 120ms ease, border-color 120ms ease, transform 80ms ease",
    opacity: disabled ? 0.5 : 1,
    transform: hover && !disabled ? "translateY(-1px)" : "none",
  };
  const variants = {
    solid: { background: hover ? T.accentDark : T.accent, color: "#FFFFFF", borderColor: T.accent },
    ghost: { background: hover ? T.surfaceHover : "transparent", color: T.ink, borderColor: T.divider },
    danger: { background: hover ? "#FBEEEC" : "transparent", color: T.danger, borderColor: T.divider },
    quiet: { background: hover ? T.surfaceHover : "transparent", color: T.muted, borderColor: "transparent" },
  };
  return (
    <button
      title={title}
      style={{ ...base, ...variants[variant] }}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      onClick={onClick}
      disabled={disabled}
    >
      {Icon && <Icon size={small ? 13 : 14} strokeWidth={2.25} />}
      {label}
    </button>
  );
}

function Switch({ checked, onChange, label, hint }) {
  return (
    <div style={S.switchRow} onClick={() => onChange(!checked)}>
      <span style={{ ...S.switchTrack, background: checked ? T.accent : "#D7D2C2" }}>
        <span style={{ ...S.switchThumb, transform: checked ? "translateX(16px)" : "translateX(0px)" }} />
      </span>
      <span>
        <div style={S.switchLabel}>{label}</div>
        {hint && <div style={S.hint}>{hint}</div>}
      </span>
    </div>
  );
}

function IconOnlyBtn({ icon: Icon, onClick, tone = "default", title, size = 13 }) {
  const [hover, setHover] = useState(false);
  const toneColor = { default: T.inkSoft, danger: T.danger, accentOn: "#FFFFFF" }[tone];
  return (
    <button
      title={title}
      onClick={onClick}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        width: 22,
        height: 22,
        borderRadius: 6,
        border: "none",
        background: hover ? "rgba(0,0,0,0.08)" : "transparent",
        color: toneColor,
        cursor: "pointer",
        flexShrink: 0,
      }}
    >
      <Icon size={size} strokeWidth={2.25} />
    </button>
  );
}

// ---------- tab bar: switching + inline rename/delete on the active pill ----------
function TabBar({ tabs, activeTabId, onSelect, onAdd, onOpenImport, importOpen, onRename, onDelete, canDelete }) {
  const [editing, setEditing] = useState(false);
  const [tempName, setTempName] = useState("");

  function startEdit(t) {
    setTempName(t.name);
    setEditing(true);
  }
  function commit() {
    onRename(tempName.trim() || tabs.find((t) => t.id === activeTabId)?.name);
    setEditing(false);
  }

  return (
    <div style={S.tabBarWrap}>
      <div style={S.tabBar}>
        {tabs.map((t) => {
          const active = t.id === activeTabId;
          if (active && editing) {
            return (
              <div key={t.id} style={{ ...S.tabPill, ...S.tabPillActive, paddingRight: 4 }}>
                <input
                  autoFocus
                  value={tempName}
                  onChange={(e) => setTempName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") commit();
                    if (e.key === "Escape") setEditing(false);
                  }}
                  style={S.tabNameEditInput}
                />
                <IconOnlyBtn icon={Check} tone="accentOn" title="保存" onClick={commit} />
              </div>
            );
          }
          return (
            <div key={t.id} style={active ? { ...S.tabPill, ...S.tabPillActive } : S.tabPill}>
              <button style={active ? S.tabNameBtnActive : S.tabNameBtn} onClick={() => onSelect(t.id)}>
                {t.isActual && <span style={{ marginRight: 4, display: "inline-flex", verticalAlign: -1 }}><Flag size={11} strokeWidth={2.5} /></span>}
                {t.name}
              </button>
              {active && (
                <span style={S.tabPillActions}>
                  <IconOnlyBtn icon={Pencil} tone="accentOn" title="名称を変更" onClick={() => startEdit(t)} />
                  {canDelete && <IconOnlyBtn icon={XIcon} tone="accentOn" title="このタブを削除" onClick={() => onDelete(t.id)} />}
                </span>
              )}
            </div>
          );
        })}
        <button style={S.tabAddBtn} onClick={onAdd} title="新しいタブを追加">
          <Plus size={14} strokeWidth={2.5} /> 新規
        </button>
        <button style={importOpen ? S.tabImportBtnActive : S.tabImportBtn} onClick={onOpenImport} title="共有リンク／コードから追加">
          <LinkIcon size={14} strokeWidth={2.25} /> コード
        </button>
      </div>
    </div>
  );
}

// ---------- main app: manages tabs ----------
function App() {
  const [tabs, setTabs] = useState(() => [{ ...defaultTabData("シミュレーション1"), isActual: true }]);
  const [view, setView] = useState("simulator"); // "simulator" | "dashboard" | "schedule"
  const [activeTabId, setActiveTabId] = useState(null);
  const [loaded, setLoaded] = useState(false);
  const [saveStatus, setSaveStatus] = useState("");
  const [storageSupported, setStorageSupported] = useState(null);
  const [toast, setToast] = useState("");
  const [importOpen, setImportOpen] = useState(false);
  const [importCode, setImportCode] = useState("");
  const [incomingShared, setIncomingShared] = useState(null);
  const [lastShareUrl, setLastShareUrl] = useState("");

  // load previously saved tabs from this browser on mount
  useEffect(() => {
    const { supported, data } = loadTabsFromStorage();
    setStorageSupported(supported);
    if (data) {
      setTabs(data.tabs);
      setActiveTabId(data.tabs.some((t) => t.id === data.activeTabId) ? data.activeTabId : data.tabs[0].id);
    } else {
      setActiveTabId((id) => id || tabs[0].id);
    }
    setLoaded(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // detect an incoming shared link (#s=...) on first load
  useEffect(() => {
    const hash = window.location.hash || "";
    if (hash.startsWith("#s=")) {
      const decoded = parseShareInput(hash);
      if (decoded) setIncomingShared(decoded);
      window.history.replaceState(null, "", window.location.pathname + window.location.search);
    }
  }, []);

  // auto-save (debounced), this browser only
  useEffect(() => {
    if (!loaded || storageSupported === false) return;
    setSaveStatus("saving");
    const t = setTimeout(() => {
      const ok = saveTabsToStorage({ tabs, activeTabId });
      if (ok) {
        setSaveStatus("saved");
      } else {
        setTimeout(() => {
          setSaveStatus(saveTabsToStorage({ tabs, activeTabId }) ? "saved" : "error");
        }, 800);
      }
    }, 500);
    return () => clearTimeout(t);
  }, [loaded, tabs, activeTabId, storageSupported]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(""), 4200);
    return () => clearTimeout(t);
  }, [toast]);

  const activeTab = tabs.find((t) => t.id === activeTabId) || tabs[0];

  function updateActiveTab(patch) {
    setTabs((ts) => ts.map((t) => (t.id === activeTab.id ? { ...t, ...(typeof patch === "function" ? patch(t) : patch) } : t)));
  }

  function addTab(fromShared) {
    const name = `シミュレーション${tabs.length + 1}`;
    const tab = fromShared
      ? {
          id: nextId(),
          name: fromShared.name ? `${fromShared.name}（共有）` : name,
          principal: fromShared.principal ?? 3000,
          startYM: fromShared.startYM || "2020-04",
          termYears: fromShared.termYears ?? 35,
          rateChanges:
            Array.isArray(fromShared.rateChanges) && fromShared.rateChanges.length > 0
              ? fromShared.rateChanges.map((r) => ({ id: nextId(), ym: r.ym, rate: r.rate }))
              : [{ id: nextId(), ym: fromShared.startYM || "2020-04", rate: 0.6 }],
          extras: Array.isArray(fromShared.extras)
            ? fromShared.extras.map((e) => ({ id: nextId(), ym: e.ym, amount: e.amount, type: e.type }))
            : [],
          applyFiveYearRule: fromShared.applyFiveYearRule ?? true,
          investReturnRate: fromShared.investReturnRate ?? 3,
          isActual: false,
          result: null,
        }
      : defaultTabData(name);
    setTabs((ts) => [...ts, tab]);
    setActiveTabId(tab.id);
    return tab;
  }

  function setActualTab(id) {
    setTabs((ts) => ts.map((t) => ({ ...t, isActual: t.id === id })));
  }

  function deleteTab(id) {
    if (tabs.length <= 1) return;
    if (!window.confirm("このタブを削除しますか？入力内容は失われます。")) return;
    let next = tabs.filter((t) => t.id !== id);
    if (next.length > 0 && !next.some((t) => t.isActual)) {
      next = next.map((t, i) => (i === 0 ? { ...t, isActual: true } : t));
    }
    setTabs(next);
    if (activeTabId === id) setActiveTabId(next[0].id);
  }

  function renameTab(name) {
    setTabs((ts) => ts.map((t) => (t.id === activeTab.id ? { ...t, name: name || t.name } : t)));
  }

  function resetActiveTab() {
    if (!window.confirm("このタブの入力内容をすべて削除して初期状態に戻しますか？")) return;
    updateActiveTab((t) => {
      const fresh = defaultTabData(t.name);
      return {
        principal: fresh.principal,
        startYM: fresh.startYM,
        termYears: fresh.termYears,
        rateChanges: fresh.rateChanges,
        extras: fresh.extras,
        applyFiveYearRule: fresh.applyFiveYearRule,
        investReturnRate: fresh.investReturnRate,
        result: null,
      };
    });
  }

  async function handleShareTab() {
    const code = encodeShareCode(activeTab);
    const url = `${window.location.origin}${window.location.pathname}#s=${code}`;
    setLastShareUrl(url);
    const ok = await copyText(url);
    setToast(
      ok
        ? "共有用リンクをコピーしました。メールやチャットなどで相手に送ってください。"
        : "自動コピーできませんでした。下に表示されたリンクを手動でコピーしてください。"
    );
  }

  function handleImportCode() {
    const decoded = parseShareInput(importCode);
    if (!decoded) {
      setToast("読み込めませんでした。共有リンクまたはコードを確認してください。");
      return;
    }
    const tab = addTab(decoded);
    setImportCode("");
    setImportOpen(false);
    setToast(`共有データから新しいタブ「${tab.name}」を追加しました。`);
  }

  if (!activeTab) return null;

  return (
    <div style={S.page}>
      <style>{`
        input:focus, textarea:focus { outline: 2px solid ${T.accent}; outline-offset: 1px; }
        button:disabled { cursor: default; }
        * { box-sizing: border-box; }
        body { margin: 0; }
      `}</style>

      <header style={S.header}>
        <div style={S.brandRow}>
          <span style={S.brandMark}><Landmark size={16} strokeWidth={2.25} /></span>
          <h1 style={S.title}>繰上げ返済 効果シミュレーター</h1>
        </div>
        <p style={S.subtitle}>金利変動を反映しながら、繰上げ返済の有無で残高・総利息がどう変わるかを可視化します。</p>
      </header>

      <PageNav view={view} setView={setView} />

      {incomingShared && (
        <div style={S.importBox}>
          <p style={S.hint}>
            共有リンクからデータ「{incomingShared.name || "無題"}」が見つかりました。新しいタブとして追加しますか？
          </p>
          <div style={S.row}>
            <IconBtn icon={Check} label="タブとして追加" variant="solid" onClick={() => { addTab(incomingShared); setIncomingShared(null); }} />
            <IconBtn label="今は追加しない" variant="ghost" onClick={() => setIncomingShared(null)} />
          </div>
        </div>
      )}

      {view === "simulator" && (
        <>
          <TabBar
            tabs={tabs}
            activeTabId={activeTab.id}
            onSelect={setActiveTabId}
            onAdd={() => addTab()}
            onOpenImport={() => setImportOpen((v) => !v)}
            importOpen={importOpen}
            onRename={renameTab}
            onDelete={deleteTab}
            canDelete={tabs.length > 1}
          />

          {importOpen && (
            <div style={S.importBox}>
              <p style={S.hint}>相手から受け取った共有リンク（またはコード部分だけ）を貼り付けてください。</p>
              <div style={S.row}>
                <input
                  style={{ ...S.input, flex: 1 }}
                  value={importCode}
                  onChange={(e) => setImportCode(e.target.value)}
                  placeholder="https://.../#s=XXXXXXXX… または XXXXXXXX…"
                />
                <IconBtn icon={Check} label="追加" variant="solid" onClick={handleImportCode} disabled={!importCode.trim()} />
                <IconBtn label="キャンセル" variant="ghost" onClick={() => { setImportOpen(false); setImportCode(""); }} />
              </div>
            </div>
          )}

          <div style={S.actionRow}>
            <IconBtn icon={Share2} label="共有" variant="solid" onClick={handleShareTab} />
            <IconBtn
              icon={Flag}
              label={activeTab.isActual ? "実際の借入（設定中）" : "実際の借入として設定"}
              variant={activeTab.isActual ? "solid" : "ghost"}
              onClick={() => setActualTab(activeTab.id)}
              title="「現在の状況」「返済予定表」ページに表示する借入として、このタブを使います"
            />
            <IconBtn icon={RotateCcw} label="初期化" variant="ghost" onClick={resetActiveTab} />
            <span style={S.saveStatusText}>
              {storageSupported === false
                ? "自動保存はこのブラウザでは利用できません（このセッション中のみ有効）"
                : saveStatus === "saving"
                ? "保存中…"
                : saveStatus === "saved"
                ? "この端末に自動保存済み"
                : saveStatus === "error"
                ? "保存に失敗しました"
                : ""}
            </span>
          </div>
          {lastShareUrl && (
            <p style={S.shareCodeLine}>
              共有用リンク：
          <span style={S.shareCodeText}>{lastShareUrl}</span>
          <span style={S.shareCodeHint}>をコピーして相手に送ってください（リンクにこのタブの入力内容が含まれます）</span>
        </p>
      )}

          <SimulatorTab key={activeTab.id} tab={activeTab} onChange={updateActiveTab} />
        </>
      )}

      {view === "dashboard" && (
        <DashboardPage tab={tabs.find((t) => t.isActual) || null} onGoToSimulator={() => setView("simulator")} />
      )}

      {view === "schedule" && (
        <SchedulePage tab={tabs.find((t) => t.isActual) || null} onGoToSimulator={() => setView("simulator")} />
      )}

      {toast && <div style={S.toast}>{toast}</div>}
    </div>
  );
}

// ---------- top-level page navigation ----------
function PageNav({ view, setView }) {
  const items = [
    { key: "simulator", label: "シミュレーション", icon: TrendingUp },
    { key: "dashboard", label: "現在の状況", icon: Home },
    { key: "schedule", label: "返済予定表", icon: Table },
  ];
  return (
    <div style={S.pageNav}>
      {items.map((it) => (
        <button key={it.key} style={view === it.key ? S.pageNavBtnActive : S.pageNavBtn} onClick={() => setView(it.key)}>
          <it.icon size={14} strokeWidth={2.25} /> {it.label}
        </button>
      ))}
    </div>
  );
}

// ---------- empty state shared by dashboard/schedule pages ----------
function NoActualTabNotice({ onGoToSimulator }) {
  return (
    <div style={S.card}>
      <SectionLabel icon={Flag} label="実際の借入が設定されていません" />
      <p style={S.hint}>
        「シミュレーション」ページで、実際の借入内容を入力しているタブを開き、「🏳 実際の借入として設定」を押してください。設定したタブの内容が、このページに反映されます。
      </p>
      <IconBtn icon={TrendingUp} label="シミュレーションページへ" variant="solid" onClick={onGoToSimulator} />
    </div>
  );
}

// ---------- run the "actual" tab's simulation fresh from its current inputs ----------
function runActualSimulation(tab) {
  const termMonths = Math.round(Number(tab.termYears) * 12);
  const principalYen = Number(tab.principal) * 10000;
  if (!principalYen || termMonths <= 0) return null;

  const rcSorted = [...tab.rateChanges]
    .filter((r) => r.ym && r.rate !== "" && !isNaN(Number(r.rate)))
    .map((r) => ({ m: Math.max(0, monthsBetween(tab.startYM, r.ym)), rate: Number(r.rate) }))
    .sort((a, b) => a.m - b.m);
  if (rcSorted.length === 0 || rcSorted[0].m !== 0) {
    rcSorted.unshift({ m: 0, rate: rcSorted[0] ? rcSorted[0].rate : 0.5 });
  }
  const rcMap = new Map();
  rcSorted.forEach((r) => rcMap.set(r.m, r.rate));
  const rcFinal = [...rcMap.entries()].map(([m, rate]) => ({ m, rate })).sort((a, b) => a.m - b.m);

  const exFinal = [...tab.extras]
    .filter((e) => e.ym && e.amount && Number(e.amount) > 0)
    .map((e) => ({ m: monthsBetween(tab.startYM, e.ym), amount: Number(e.amount) * 10000, type: e.type }))
    .filter((e) => e.m > 0 && e.m < termMonths)
    .sort((a, b) => a.m - b.m);

  const result = simulate(principalYen, termMonths, rcFinal, exFinal, { applyFiveYearRule: !!tab.applyFiveYearRule });
  return { ...result, principalYen, termMonths };
}

function getMonthEntry(history, m) {
  const idx = Math.max(0, Math.min(m, history.length - 1));
  return history[idx];
}

// ---------- 現在の状況 (current balance / principal / interest breakdown) ----------
function DashboardPage({ tab, onGoToSimulator }) {
  if (!tab) return <NoActualTabNotice onGoToSimulator={onGoToSimulator} />;

  const sim = runActualSimulation(tab);
  if (!sim) {
    return (
      <div style={S.card}>
        <SectionLabel icon={Home} label="現在の状況" />
        <p style={S.hint}>「{tab.name}」の借入額・返済期間の入力を確認してください。</p>
      </div>
    );
  }

  const nowYM = currentYM();
  const elapsedRaw = monthsBetween(tab.startYM, nowYM);
  const notStarted = elapsedRaw < 0;
  const elapsed = Math.max(0, Math.min(elapsedRaw, sim.payoffMonth));
  const paidOff = elapsedRaw >= sim.payoffMonth;
  const entry = getMonthEntry(sim.history, elapsed);

  let cumInterest = 0, cumPrincipal = 0, cumExtra = 0;
  for (let m = 1; m <= elapsed; m++) {
    const h = sim.history[m];
    cumInterest += h.interest;
    cumPrincipal += h.principalPaid;
    cumExtra += h.extraPrincipalPaid;
  }

  const payoffDate = addMonths(tab.startYM, sim.payoffMonth);
  const remainingMonths = Math.max(0, sim.payoffMonth - elapsed);

  return (
    <div>
      <section style={S.card}>
        <SectionLabel icon={Flag} label={`「${tab.name}」を実際の借入として表示中`} />
        <p style={S.hint}>
          {notStarted
            ? "借入開始日がまだ先のため、開始前の状態（借入額そのまま）を表示しています。"
            : paidOff
            ? `${payoffDate} 頃に完済済みの試算です。`
            : `${nowYM.replace("-", "年")}月時点（借入から${Math.floor(elapsed / 12)}年${elapsed % 12}ヶ月）の状況です。`}
        </p>
      </section>

      <section style={{ ...S.resultsCard, marginTop: 0 }}>
        <SectionLabel icon={Landmark} label="現在の残高" />
        <div style={S.statGrid}>
          <StatCard label="現在の残高" value={`${man(entry.balance)} 万円`} tone="neutral" />
          <StatCard label="完済まで" value={paidOff ? "完済済み" : `${Math.floor(remainingMonths / 12)}年${remainingMonths % 12}ヶ月`} tone="good" />
        </div>

        <ProgressBar
          label="元金の返済（残高ベース）"
          percent={((sim.principalYen - entry.balance) / sim.principalYen) * 100}
          rightLabel={`${man(sim.principalYen - entry.balance)} / ${man(sim.principalYen)} 万円`}
        />
        <ProgressBar
          label="返済期間の経過"
          color="#9AA5A1"
          percent={(elapsed / sim.payoffMonth) * 100}
          rightLabel={`${elapsed} / ${sim.payoffMonth} ヶ月`}
        />

        <div style={S.chartWrap}>
          <div style={S.legendRow}>
            <span style={S.legendItem}><span style={{ ...S.legendSwatch, background: T.accent }} /> 残高</span>
            <span style={S.legendItem}><span style={{ ...S.legendSwatch, background: T.accentSoft, borderTop: "none", width: 12, height: 12, display: "inline-block" }} /> 返済済み期間</span>
          </div>
          <BalanceTimelineChart
            history={sim.history}
            startYM={tab.startYM}
            payoffMonth={sim.payoffMonth}
            elapsedMonth={elapsed}
            principalYen={sim.principalYen}
          />
        </div>

        <div style={S.summaryTable}>
          <SummaryRow label="借入額" value={`${man(sim.principalYen)} 万円`} />
          <SummaryRow label="完済予定日" value={payoffDate} />
          <SummaryRow label="これまでに支払った元金（累計）" value={`${man(cumPrincipal)} 万円`} />
          {cumExtra > 0 && <SummaryRow label="　うち繰上げ返済分" value={`${man(cumExtra)} 万円`} />}
          <SummaryRow label="これまでに支払った利息（累計）" value={`${man(cumInterest)} 万円`} last />
        </div>
      </section>

      <MonthlyBreakdownCard entry={entry} />

      {(sim.unpaidInterestTotal > 0 || sim.didNotPayOff) && (
        <div style={S.warningBanner}>
          <span style={{ flexShrink: 0, marginTop: 1 }}><TriangleAlert size={14} strokeWidth={2.25} /></span>
          <span>
            5年ルール・125%ルールにより未払利息が発生しています（累計約{man(sim.unpaidInterestTotal)}万円）。残高にはこの分が上乗せされています。
          </span>
        </div>
      )}
    </div>
  );
}

function MonthlyBreakdownCard({ entry }) {
  const yen = (n) => Math.round(n).toLocaleString("ja-JP");
  return (
    <section style={S.card}>
      <SectionLabel icon={Scale} label="今月の返済額の内訳（元金・利息）" />
      <div style={S.donutRow}>
        <PaymentDonut principalPaid={entry.principalPaid} interest={entry.interest} />
        <div style={{ ...S.statGrid, flex: 1, marginBottom: 0 }}>
          <StatCard label="元金" value={`${yen(entry.principalPaid)} 円`} tone="good" />
          <StatCard label="利息" value={`${yen(entry.interest)} 円`} tone="neutral" />
        </div>
      </div>
      {entry.extraPrincipalPaid > 0 && (
        <p style={S.hint}>うち繰上げ返済による元金充当: {yen(entry.extraPrincipalPaid)} 円</p>
      )}
      <p style={S.hint}>返済額合計: {yen(entry.payment)} 円（元金 {yen(entry.principalPaid)} 円 ＋ 利息 {yen(entry.interest)} 円）</p>
    </section>
  );
}

// ---------- 毎月の返済予定金額 (amortization schedule) ----------
function SchedulePage({ tab, onGoToSimulator }) {
  const [windowSize, setWindowSize] = useState(24);

  if (!tab) return <NoActualTabNotice onGoToSimulator={onGoToSimulator} />;

  const sim = runActualSimulation(tab);
  if (!sim) {
    return (
      <div style={S.card}>
        <SectionLabel icon={Table} label="返済予定表" />
        <p style={S.hint}>「{tab.name}」の借入額・返済期間の入力を確認してください。</p>
      </div>
    );
  }

  const nowYM = currentYM();
  const elapsedRaw = monthsBetween(tab.startYM, nowYM);
  const startIdx = Math.max(1, Math.min(elapsedRaw, sim.payoffMonth));
  const lastIdx = sim.history.length - 1;
  const showAll = windowSize === Infinity;
  const endIdx = showAll ? lastIdx : Math.min(lastIdx, startIdx + windowSize - 1);

  const rows = [];
  for (let m = startIdx; m <= endIdx; m++) {
    rows.push(sim.history[m]);
  }

  const yen = (n) => Math.round(n).toLocaleString("ja-JP");

  return (
    <div>
      <section style={S.card}>
        <SectionLabel icon={Flag} label={`「${tab.name}」の返済予定表`} />
        <p style={S.hint}>今月（{nowYM.replace("-", "年")}月）以降の毎月の返済予定です。返済額は「元金＋利息」の内訳で表示しています。</p>
        <div style={S.row}>
          <IconBtn label="今後12ヶ月" variant={windowSize === 12 ? "solid" : "ghost"} small onClick={() => setWindowSize(12)} />
          <IconBtn label="今後24ヶ月" variant={windowSize === 24 ? "solid" : "ghost"} small onClick={() => setWindowSize(24)} />
          <IconBtn label="今後60ヶ月" variant={windowSize === 60 ? "solid" : "ghost"} small onClick={() => setWindowSize(60)} />
          <IconBtn label="完済まで全部" variant={showAll ? "solid" : "ghost"} small onClick={() => setWindowSize(Infinity)} />
        </div>
      </section>

      <section style={S.card}>
        <div style={S.scheduleTableWrap}>
          <table style={S.scheduleTable}>
            <thead>
              <tr>
                <th style={S.scheduleTh}>年月</th>
                <th style={S.scheduleTh}>返済額</th>
                <th style={S.scheduleTh}>元金</th>
                <th style={S.scheduleTh}>利息</th>
                <th style={S.scheduleTh}>残高</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((h) => (
                <tr key={h.m}>
                  <td style={S.scheduleTd}>{addMonths(tab.startYM, h.m)}</td>
                  <td style={S.scheduleTd}>{yen(h.payment)}</td>
                  <td style={S.scheduleTd}>
                    {yen(h.principalPaid)}
                    {h.extraPrincipalPaid > 0 && <span style={S.scheduleExtraNote}>（繰{yen(h.extraPrincipalPaid)}）</span>}
                  </td>
                  <td style={S.scheduleTd}>{yen(h.interest)}</td>
                  <td style={S.scheduleTd}>{man(h.balance)}万</td>
                </tr>
              ))}
              {rows.length === 0 && (
                <tr><td style={S.scheduleTd} colSpan={5}>表示できる返済予定がありません（すでに完済済みの可能性があります）。</td></tr>
              )}
            </tbody>
          </table>
        </div>
        {!showAll && endIdx < lastIdx && (
          <p style={S.hint}>完済（{addMonths(tab.startYM, sim.payoffMonth)}）まで、あと{lastIdx - endIdx}ヶ月分あります。「完済まで全部」で全期間を表示できます。</p>
        )}
      </section>
    </div>
  );
}

// ---------- one tab's simulator form + results ----------
function SimulatorTab({ tab, onChange }) {
  const { principal, startYM, termYears, rateChanges, extras, applyFiveYearRule, investReturnRate, result } = tab;
  const [error, setError] = useState("");

  useEffect(() => {
    if (rateChanges.length > 0 && rateChanges[0].ym !== startYM) {
      onChange({ rateChanges: [{ ...rateChanges[0], ym: startYM }, ...rateChanges.slice(1)] });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [startYM]);

  const setPrincipal = (v) => onChange({ principal: v });
  const setStartYM = (v) => onChange({ startYM: v });
  const setTermYears = (v) => onChange({ termYears: v });
  const setInvestReturnRate = (v) => onChange({ investReturnRate: v });
  const setApplyFiveYearRule = (v) => onChange({ applyFiveYearRule: v });
  const setRateChanges = (updater) =>
    onChange((t) => ({ rateChanges: typeof updater === "function" ? updater(t.rateChanges) : updater }));
  const setExtras = (updater) =>
    onChange((t) => ({ extras: typeof updater === "function" ? updater(t.extras) : updater }));
  const setResult = (r) => onChange({ result: r });

  const updateRate = (id, field, val) => setRateChanges((rs) => rs.map((r) => (r.id === id ? { ...r, [field]: val } : r)));
  const updateExtra = (id, field, val) => setExtras((es) => es.map((e) => (e.id === id ? { ...e, [field]: val } : e)));

  function calculate() {
    setError("");
    const termMonths = Math.round(termYears * 12);
    const principalYen = Number(principal) * 10000;
    if (!principalYen || termMonths <= 0) {
      setError("借入額と返済期間を確認してください。");
      return;
    }
    const rcSorted = [...rateChanges]
      .filter((r) => r.ym && r.rate !== "" && !isNaN(Number(r.rate)))
      .map((r) => ({ m: Math.max(0, monthsBetween(startYM, r.ym)), rate: Number(r.rate) }))
      .sort((a, b) => a.m - b.m);
    if (rcSorted.length === 0 || rcSorted[0].m !== 0) {
      rcSorted.unshift({ m: 0, rate: rcSorted[0] ? rcSorted[0].rate : 0.5 });
    }
    const rcMap = new Map();
    rcSorted.forEach((r) => rcMap.set(r.m, r.rate));
    const rcFinal = [...rcMap.entries()].map(([m, rate]) => ({ m, rate })).sort((a, b) => a.m - b.m);

    const exFinal = [...extras]
      .filter((e) => e.ym && e.amount && Number(e.amount) > 0)
      .map((e) => ({ m: monthsBetween(startYM, e.ym), amount: Number(e.amount) * 10000, type: e.type }))
      .filter((e) => e.m > 0 && e.m < termMonths)
      .sort((a, b) => a.m - b.m);

    const simOptions = { applyFiveYearRule: !!applyFiveYearRule };
    const actual = simulate(principalYen, termMonths, rcFinal, exFinal, simOptions);
    const hypo = simulate(principalYen, termMonths, rcFinal, [], simOptions);

    const maxLen = Math.max(actual.payoffMonth, hypo.payoffMonth, termMonths);
    const step = maxLen > 300 ? 6 : maxLen > 150 ? 3 : 1;
    const actualMap = new Map(actual.history.map((h) => [h.m, h.balance]));
    const hypoMap = new Map(hypo.history.map((h) => [h.m, h.balance]));
    const fillLookup = (map, m, lastVal) => (map.has(m) ? map.get(m) : lastVal);

    const chartData = [];
    let lastA = principalYen, lastH = principalYen;
    for (let m = 0; m <= maxLen; m += step) {
      lastA = fillLookup(actualMap, m, lastA);
      lastH = fillLookup(hypoMap, m, lastH);
      chartData.push({ m, date: addMonths(startYM, m), actual: Math.round(lastA / 10000), hypo: Math.round(lastH / 10000) });
    }
    if (maxLen % step !== 0) {
      lastA = fillLookup(actualMap, maxLen, lastA);
      lastH = fillLookup(hypoMap, maxLen, lastH);
      chartData.push({ m: maxLen, date: addMonths(startYM, maxLen), actual: Math.round(lastA / 10000), hypo: Math.round(lastH / 10000) });
    }

    const investCompare = computeInvestmentComparison({
      hypoHistory: hypo.history,
      exFinal,
      actualPayoffMonth: actual.payoffMonth,
      hypoPayoffMonth: hypo.payoffMonth,
      annualReturnPct: Number(investReturnRate) || 0,
      interestSavings: hypo.totalInterest - actual.totalInterest,
      taxDeductionReduction: 0,
      prepaymentFee: 0,
    });

    setResult({
      chartData,
      actualTotalInterest: actual.totalInterest,
      hypoTotalInterest: hypo.totalInterest,
      actualPayoffDate: addMonths(startYM, actual.payoffMonth),
      hypoPayoffDate: addMonths(startYM, hypo.payoffMonth),
      monthsShortened: hypo.payoffMonth - actual.payoffMonth,
      extraTotal: exFinal.reduce((s, e) => s + e.amount, 0),
      investCompare,
      applyFiveYearRule: !!applyFiveYearRule,
      actualUnpaidInterest: actual.unpaidInterestTotal,
      hypoUnpaidInterest: hypo.unpaidInterestTotal,
      actualDidNotPayOff: actual.didNotPayOff,
      hypoDidNotPayOff: hypo.didNotPayOff,
    });
  }

  const interestSavings = result ? result.hypoTotalInterest - result.actualTotalInterest : 0;

  return (
    <div>
      <section style={S.card}>
        <SectionLabel icon={Landmark} label="借入の基本情報" />
        <div style={S.grid2}>
          <Field label="借入額（万円）">
            <input style={S.input} type="number" value={principal} onChange={(e) => setPrincipal(e.target.value)} min="1" />
          </Field>
          <Field label="返済期間（年）">
            <input style={S.input} type="number" value={termYears} onChange={(e) => setTermYears(e.target.value)} min="1" max="50" />
          </Field>
          <Field label="借入開始年月" full>
            <input style={S.input} type="month" value={startYM} onChange={(e) => setStartYM(e.target.value)} />
          </Field>
        </div>
      </section>

      <section style={S.card}>
        <SectionLabel icon={TrendingUp} label="金利の変動履歴" />
        <p style={S.hint}>最初の行が当初金利です。金利が変わった月を追加してください（変動金利の場合）。</p>
        <Switch
          checked={!!applyFiveYearRule}
          onChange={setApplyFiveYearRule}
          label="5年ルール・125%ルールを適用する"
          hint="金利が変わっても返済額は5年ごとにしか見直されず、見直し時の増額も直前の返済額の1.25倍までに抑えられます。返済額が利息分を下回った場合、その不足分（未払利息）は元金に上乗せされるものとして計算します。"
        />
        <div style={{ height: 4 }} />
        {rateChanges.map((r, i) => (
          <div key={r.id} style={S.row}>
            <input style={{ ...S.input, flex: "1 1 120px" }} type="month" value={r.ym} disabled={i === 0}
              onChange={(e) => updateRate(r.id, "ym", e.target.value)} />
            <div style={S.inputSuffix}>
              <input style={{ ...S.input, width: 72 }} type="number" step="0.01" value={r.rate}
                onChange={(e) => updateRate(r.id, "rate", e.target.value)} />
              <span style={S.suffixText}>％</span>
            </div>
            {i > 0 && <IconOnlyBtn icon={XIcon} tone="danger" title="削除" onClick={() => setRateChanges((rs) => rs.filter((x) => x.id !== r.id))} />}
          </div>
        ))}
        <IconBtn icon={Plus} label="金利変更を追加" variant="ghost" small
          onClick={() => setRateChanges((rs) => [...rs, { id: nextId(), ym: startYM, rate: rs[rs.length - 1] ? rs[rs.length - 1].rate : 0.5 }])} />
      </section>

      <section style={S.card}>
        <SectionLabel icon={PiggyBank} label="繰上げ返済の履歴" />
        <p style={S.hint}>実行した（または予定の）繰上げ返済を入力してください。</p>
        {extras.length === 0 && <p style={S.hint}>繰上げ返済はまだ登録されていません。</p>}
        {extras.map((e) => (
          <div key={e.id} style={S.extraCard}>
            <div style={S.row}>
              <input style={{ ...S.input, flex: "1 1 110px" }} type="month" value={e.ym} onChange={(ev) => updateExtra(e.id, "ym", ev.target.value)} />
              <div style={S.inputSuffix}>
                <input style={{ ...S.input, width: 76 }} type="number" value={e.amount} onChange={(ev) => updateExtra(e.id, "amount", ev.target.value)} />
                <span style={S.suffixText}>万円</span>
              </div>
              <IconOnlyBtn icon={XIcon} tone="danger" title="削除" onClick={() => setExtras((es) => es.filter((x) => x.id !== e.id))} />
            </div>
            <div style={S.typeToggle}>
              <button style={e.type === "shorten" ? S.typeBtnActive : S.typeBtn} onClick={() => updateExtra(e.id, "type", "shorten")}>期間短縮型</button>
              <button style={e.type === "reduce" ? S.typeBtnActive : S.typeBtn} onClick={() => updateExtra(e.id, "type", "reduce")}>返済額軽減型</button>
            </div>
          </div>
        ))}
        <IconBtn icon={Plus} label="繰上げ返済を追加" variant="ghost" small
          onClick={() => setExtras((es) => [...es, { id: nextId(), ym: startYM, amount: 100, type: "shorten" }])} />
      </section>

      <section style={S.card}>
        <SectionLabel icon={Scale} label="繰上げ返済 vs 資産運用" />
        <p style={S.hint}>
          繰上げ返済する代わりに、同じ金額を運用に回したらどうなるかを比較します。「期間短縮型」の繰上げ返済で完済が早まった分、浮いた月々の返済額を運用に回せると仮定します。
        </p>
        <Field label="想定年利回り（％）">
          <div style={S.inputSuffix}>
            <input style={{ ...S.input, width: 90 }} type="number" step="0.1" value={investReturnRate} onChange={(e) => setInvestReturnRate(e.target.value)} />
            <span style={S.suffixText}>％ / 年</span>
          </div>
        </Field>
      </section>

      <button style={S.calcBtn} onClick={calculate}>効果を計算する</button>
      {error && <p style={S.error}>{error}</p>}

      {result && (
        <section style={S.resultsCard}>
          <SectionLabel icon={BarChart3} label="計算結果" />
          {(result.actualUnpaidInterest > 0 || result.hypoUnpaidInterest > 0 || result.actualDidNotPayOff || result.hypoDidNotPayOff) && (
            <div style={S.warningBanner}>
              <span style={{ flexShrink: 0, marginTop: 1 }}><TriangleAlert size={14} strokeWidth={2.25} /></span>
              <span>
                5年ルール・125%ルールにより、返済額が利息分を下回った月がありました。その不足分（未払利息）は元金に上乗せされています。
                {result.actualUnpaidInterest > 0 && ` 実際のケースでの未払利息累計: 約${man(result.actualUnpaidInterest)}万円。`}
                {result.hypoUnpaidInterest > 0 && ` 繰上げ返済なしのケースでの未払利息累計: 約${man(result.hypoUnpaidInterest)}万円。`}
                {(result.actualDidNotPayOff || result.hypoDidNotPayOff) && " また、試算期間内で完済に至らなかったため、結果が実際より不利／有利に偏って表示されている可能性があります。金利設定をご確認ください。"}
              </span>
            </div>
          )}
          <div style={S.statGrid}>
            <StatCard label="利息軽減額" value={`${man(interestSavings)} 万円`} tone="good" />
            <StatCard label="完済の前倒し"
              value={result.monthsShortened > 0 ? `${Math.floor(result.monthsShortened / 12)}年${result.monthsShortened % 12}ヶ月 早い` : "変化なし（返済額軽減型のみ）"}
              tone="good" />
            <StatCard label="繰上げ返済の合計額" value={`${man(result.extraTotal)} 万円`} tone="neutral" />
          </div>

          <div style={S.chartWrap}>
            <div style={S.legendRow}>
              <span style={S.legendItem}><span style={{ ...S.legendSwatch, background: T.accent }} /> 実際</span>
              <span style={S.legendItem}><span style={{ ...S.legendSwatch, background: "#A6ADA6", borderStyle: "dashed" }} /> 繰上げ返済なし</span>
            </div>
            <LedgerChart data={result.chartData} />
          </div>

          <div style={S.summaryTable}>
            <SummaryRow label="総利息（実際）" value={`${man(result.actualTotalInterest)} 万円`} />
            <SummaryRow label="総利息（繰上げ返済なしの場合）" value={`${man(result.hypoTotalInterest)} 万円`} />
            <SummaryRow label="完済時期（実際）" value={result.actualPayoffDate} />
            <SummaryRow label="完済時期（繰上げ返済なしの場合）" value={result.hypoPayoffDate} last />
          </div>

          <InvestCompareBlock compare={result.investCompare} rate={investReturnRate} />

          <p style={S.note}>
            {result.applyFiveYearRule
              ? "※ 「5年ルール・125%ルール」を適用したモデルです。実際の運用は金融機関により細部が異なる場合があります（見直し月のずれ、未払利息の扱いなど）ので、目安としてご利用ください。"
              : "※ 金利が変わり次第すぐに返済額を再計算する簡易モデルです。多くの金融機関が採用する「5年ルール・125%ルール」を適用したい場合は、上の「金利の変動履歴」欄のスイッチをオンにしてください。"}
          </p>
        </section>
      )}
    </div>
  );
}

function SectionLabel({ icon: Icon, label }) {
  return (
    <div style={S.sectionLabel}>
      <span style={S.sectionIcon}><Icon size={15} strokeWidth={2.25} /></span>
      <span style={S.sectionText}>{label}</span>
    </div>
  );
}
function Field({ label, children, full }) {
  return (
    <label style={{ ...S.field, gridColumn: full ? "1 / -1" : "auto" }}>
      <span style={S.fieldLabel}>{label}</span>
      {children}
    </label>
  );
}
function StatCard({ label, value, tone }) {
  return (
    <div style={{ ...S.statCard, borderColor: tone === "good" ? T.accent : T.divider }}>
      <div style={S.statLabel}>{label}</div>
      <div style={S.statValue}>{value}</div>
    </div>
  );
}
function SummaryRow({ label, value, last }) {
  return (
    <div style={last ? { ...S.summaryRow, borderBottom: "none" } : S.summaryRow}>
      <span style={S.summaryLabel}>{label}</span>
      <span style={S.summaryValue}>{value}</span>
    </div>
  );
}

function InvestCompareBlock({ compare, rate }) {
  if (!compare) {
    return (
      <div style={S.investBlock}>
        <div style={S.sectionLabel}>
          <span style={S.sectionIcon}><Scale size={15} strokeWidth={2.25} /></span>
          <span style={S.sectionText}>繰上げ返済 vs 資産運用</span>
        </div>
        <p style={S.hint}>
          「期間短縮型」の繰上げ返済による完済の前倒しがない（または「返済額軽減型」のみの）ため、今回は比較対象外です。
        </p>
      </div>
    );
  }
  const diff = compare.prepayTotalEffect - compare.investTotalEffect;
  const prepayWins = diff >= 0;
  const hasAdjustment = compare.taxDeductionReduction > 0 || compare.prepaymentFee > 0;

  return (
    <div style={S.investBlock}>
      <div style={S.sectionLabel}>
        <span style={S.sectionIcon}><Scale size={15} strokeWidth={2.25} /></span>
        <span style={S.sectionText}>繰上げ返済 vs 資産運用（経済効果の比較）</span>
      </div>
      <p style={S.hint}>
        繰上げ返済の経済効果は「完済後に浮く返済額を運用した資産額」だけでなく「利息軽減額」も合わせたものとして比較します。資産運用側は、同じ金額をその都度 年利 {rate}％ で運用したと仮定した資産額です。
      </p>

      <div style={S.statGrid}>
        <StatCard label="繰上げ返済側：合計の経済効果" value={`${man(compare.prepayTotalEffect)} 万円`} tone={prepayWins ? "good" : "neutral"} />
        <StatCard label="資産運用側：合計の経済効果" value={`${man(compare.investTotalEffect)} 万円`} tone={!prepayWins ? "good" : "neutral"} />
      </div>

      <div style={S.summaryTable}>
        <SummaryRow label={hasAdjustment ? "利息軽減額（実質）" : "利息軽減額"} value={`${man(compare.netInterestSavings)} 万円`} />
        {hasAdjustment && (
          <SummaryRow label="内訳：住宅ローン控除の減少・手数料控除前" value={`${man(compare.interestSavings)} 万円`} />
        )}
        <SummaryRow label="＋ 繰上げ返済後に運用した資産額" value={`${man(compare.freedCashFV)} 万円`} />
        <SummaryRow label="＝ 繰上げ返済側の合計効果" value={`${man(compare.prepayTotalEffect)} 万円`} />
        <SummaryRow label="最初から資産運用した場合の資産額" value={`${man(compare.investTotalEffect)} 万円`} />
        <SummaryRow label="両者の差額" value={`${man(Math.abs(diff))} 万円`} last />
      </div>

      <p style={S.verdict}>
        この想定利回りでは <strong>{prepayWins ? "繰上げ返済" : "資産運用"}</strong> の方が、完済予定時点でおよそ <strong>{man(Math.abs(diff))} 万円</strong> 有利という試算です（利息軽減額を含む）。
      </p>

      {compare.breakevenRate !== null ? (
        <p style={S.hint}>
          損益分岐利回りの目安：約 <strong>{compare.breakevenRate}％</strong>。これより運用利回りが高ければ資産運用、低ければ繰上げ返済の方が有利になる計算です。
        </p>
      ) : (
        <p style={S.hint}>試算範囲（0〜15％）内では損益分岐点は見つかりませんでした。</p>
      )}

      <p style={S.note}>
        ※ 資産運用の利回り（年{rate}％）はあくまで想定値であり、実際の運用成果は市況により変動し、元本が保証されるものではありません。一方、繰上げ返済による利息軽減は、金利が変わらない限り基本的に確定した効果として扱っています。
        {hasAdjustment
          ? " なお、住宅ローン控除の減少額・繰上げ返済手数料を利息軽減額から差し引いた「実質的な利息軽減効果」を用いています。"
          : " 住宅ローン控除の減少額や繰上げ返済手数料は現在未対応のため、利息軽減額から差し引いていません（今後の対応により反映される場合があります）。"}
      </p>
    </div>
  );
}

// ---------- design tokens ----------
const T = {
  page: "#F6F4EE",
  surface: "#FFFFFF",
  surfaceHover: "#F1EFE7",
  ink: "#1B2A2E",
  inkSoft: "#3E4A48",
  muted: "#70786F",
  accent: "#1F6F5C",
  accentDark: "#175747",
  accentSoft: "#E7F1EC",
  danger: "#B0453A",
  divider: "#E4E0D3",
};

const S = {
  pageNav: { display: "flex", gap: 6, marginBottom: 16, borderBottom: `1px solid ${T.divider}`, paddingBottom: 10 },
  pageNavBtn: { display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12.5, fontWeight: 600, padding: "8px 12px", borderRadius: 8, border: `1px solid ${T.divider}`, background: T.surface, color: T.muted, cursor: "pointer" },
  pageNavBtnActive: { display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12.5, fontWeight: 700, padding: "8px 12px", borderRadius: 8, border: `1px solid ${T.accent}`, background: T.accent, color: "#FFFFFF", cursor: "pointer" },

  scheduleTableWrap: { overflowX: "auto", WebkitOverflowScrolling: "touch" },
  scheduleTable: { width: "100%", borderCollapse: "collapse", fontSize: 12, fontFamily: "ui-monospace, Menlo, monospace", minWidth: 460 },
  scheduleTh: { textAlign: "right", padding: "8px 8px", color: T.muted, fontWeight: 600, borderBottom: `1px solid ${T.divider}`, whiteSpace: "nowrap" },
  scheduleTd: { textAlign: "right", padding: "7px 8px", borderBottom: `1px solid ${T.divider}`, whiteSpace: "nowrap" },
  scheduleExtraNote: { color: T.accent, fontSize: 10.5, marginLeft: 4 },

  progressLabelRow: { display: "flex", justifyContent: "space-between", fontSize: 11.5, color: T.muted, marginBottom: 5 },
  progressTrack: { width: "100%", height: 8, borderRadius: 999, background: T.divider, overflow: "hidden" },
  progressFill: { height: "100%", borderRadius: 999, transition: "width 300ms ease" },
  donutRow: { display: "flex", alignItems: "center", gap: 18, marginBottom: 10 },


  page: { fontFamily: "-apple-system, BlinkMacSystemFont, 'Hiragino Sans', 'Yu Gothic', sans-serif", color: T.ink, background: T.page, padding: "20px 16px 44px", maxWidth: 560, margin: "0 auto", boxSizing: "border-box", minHeight: "100vh" },

  header: { marginBottom: 18 },
  brandRow: { display: "flex", alignItems: "center", gap: 8, marginBottom: 6 },
  brandMark: { display: "inline-flex", alignItems: "center", justifyContent: "center", width: 28, height: 28, borderRadius: 8, background: T.accentSoft, color: T.accent },
  title: { fontSize: 19, fontWeight: 700, margin: 0, letterSpacing: "0.01em" },
  subtitle: { fontSize: 13, color: T.muted, marginTop: 0, lineHeight: 1.6, paddingLeft: 36 },

  card: { background: T.surface, borderRadius: 12, border: `1px solid ${T.divider}`, boxShadow: "0 1px 2px rgba(27,42,46,0.04)", padding: 16, marginBottom: 14 },
  sectionLabel: { display: "flex", alignItems: "center", gap: 8, marginBottom: 12 },
  sectionIcon: { display: "inline-flex", alignItems: "center", justifyContent: "center", width: 26, height: 26, borderRadius: 7, background: T.accentSoft, color: T.accent, flexShrink: 0 },
  sectionText: { fontSize: 14, fontWeight: 700 },
  hint: { fontSize: 12, color: T.muted, margin: "0 0 10px", lineHeight: 1.6 },
  grid2: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 },
  field: { display: "flex", flexDirection: "column", gap: 4 },
  fieldLabel: { fontSize: 12, color: T.muted },
  input: { fontFamily: "ui-monospace, Menlo, monospace", fontSize: 14, padding: "9px 10px", border: `1px solid ${T.divider}`, borderRadius: 8, background: T.page, color: T.ink, boxSizing: "border-box", width: "100%" },
  row: { display: "flex", alignItems: "center", gap: 8, marginBottom: 8 },
  inputSuffix: { display: "flex", alignItems: "center", gap: 4 },
  suffixText: { fontSize: 12, color: T.muted },
  extraCard: { border: `1px solid ${T.divider}`, borderRadius: 10, padding: 10, marginBottom: 10, background: T.page },
  typeToggle: { display: "flex", gap: 6, marginTop: 8 },
  typeBtn: { flex: 1, fontSize: 12, padding: "7px 8px", borderRadius: 7, border: `1px solid ${T.divider}`, background: T.surface, color: T.muted, cursor: "pointer" },
  typeBtnActive: { flex: 1, fontSize: 12, padding: "7px 8px", borderRadius: 7, border: `1px solid ${T.accent}`, background: T.accent, color: "#FFFFFF", cursor: "pointer", fontWeight: 600 },

  switchRow: { display: "flex", alignItems: "flex-start", gap: 10, cursor: "pointer", padding: "6px 2px 12px", userSelect: "none" },
  switchTrack: { flexShrink: 0, width: 36, height: 20, borderRadius: 999, position: "relative", transition: "background 150ms ease", marginTop: 2 },
  switchThumb: { position: "absolute", top: 2, left: 2, width: 16, height: 16, borderRadius: "50%", background: "#FFFFFF", boxShadow: "0 1px 2px rgba(0,0,0,0.25)", transition: "transform 150ms ease" },
  switchLabel: { fontSize: 13, fontWeight: 700, color: T.ink, marginBottom: 2 },

  warningBanner: { display: "flex", alignItems: "flex-start", gap: 8, background: "#FBF3E6", border: "1px solid #E9CFA0", color: "#7A5321", borderRadius: 10, padding: "10px 12px", fontSize: 12, lineHeight: 1.7, marginBottom: 16 },

  calcBtn: { width: "100%", display: "flex", alignItems: "center", justifyContent: "center", gap: 8, background: T.ink, color: "#FFFFFF", fontSize: 14, fontWeight: 700, padding: "13px 16px", border: "none", borderRadius: 10, cursor: "pointer", marginTop: 4, boxShadow: "0 2px 8px rgba(27,42,46,0.18)" },
  error: { color: T.danger, fontSize: 12.5, marginTop: 8 },

  resultsCard: { background: T.surface, borderRadius: 12, border: `1px solid ${T.divider}`, boxShadow: "0 4px 16px rgba(27,42,46,0.06)", padding: 18, marginTop: 22 },
  statGrid: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 16 },
  statCard: { border: "1px solid", borderRadius: 10, padding: "12px 12px", background: T.page },
  statLabel: { fontSize: 11.5, color: T.muted, marginBottom: 4 },
  statValue: { fontSize: 16, fontWeight: 700, fontFamily: "ui-monospace, Menlo, monospace" },
  chartWrap: { border: `1px solid ${T.divider}`, borderRadius: 10, padding: "12px 8px 4px", background: T.page, marginBottom: 16 },
  legendRow: { display: "flex", gap: 16, marginBottom: 6, paddingLeft: 4 },
  legendItem: { display: "flex", alignItems: "center", gap: 6, fontSize: 11.5, color: T.muted },
  legendSwatch: { width: 16, height: 0, borderTop: "2.5px solid", display: "inline-block" },
  summaryTable: { border: `1px solid ${T.divider}`, borderRadius: 10, overflow: "hidden" },
  summaryRow: { display: "flex", justifyContent: "space-between", padding: "10px 12px", fontSize: 13, borderBottom: `1px solid ${T.divider}`, background: T.page },
  summaryLabel: { color: T.muted },
  summaryValue: { fontFamily: "ui-monospace, Menlo, monospace", fontWeight: 700 },
  note: { fontSize: 11.5, color: T.muted, lineHeight: 1.7, marginTop: 14 },
  investBlock: { border: `1px solid ${T.divider}`, borderRadius: 10, padding: "14px 14px 4px", background: T.page, marginBottom: 16 },
  verdict: { fontSize: 13, color: T.ink, lineHeight: 1.7, background: T.accentSoft, borderRadius: 8, padding: "10px 12px", margin: "4px 0 10px" },

  // ---- tabs ----
  tabBarWrap: { overflowX: "auto", WebkitOverflowScrolling: "touch", marginBottom: 10, paddingBottom: 4 },
  tabBar: { display: "flex", gap: 6, minWidth: "min-content" },
  tabPill: { flexShrink: 0, display: "flex", alignItems: "center", borderRadius: 999, border: `1px solid ${T.divider}`, background: T.surface },
  tabPillActive: { border: `1px solid ${T.accent}`, background: T.accent, boxShadow: "0 2px 6px rgba(31,111,92,0.25)" },
  tabPillActions: { display: "inline-flex", alignItems: "center", gap: 2, paddingRight: 6 },
  tabNameBtn: { background: "none", border: "none", color: T.ink, fontSize: 12.5, fontWeight: 600, padding: "9px 14px", cursor: "pointer", whiteSpace: "nowrap", maxWidth: 130, overflow: "hidden", textOverflow: "ellipsis" },
  tabNameBtnActive: { background: "none", border: "none", color: "#FFFFFF", fontSize: 12.5, fontWeight: 700, padding: "9px 8px 9px 14px", cursor: "pointer", whiteSpace: "nowrap", maxWidth: 130, overflow: "hidden", textOverflow: "ellipsis" },
  tabNameEditInput: { fontFamily: "inherit", fontSize: 12.5, fontWeight: 700, padding: "7px 4px 7px 12px", border: "none", background: "transparent", color: "#FFFFFF", width: 110, outline: "none" },
  tabAddBtn: { flexShrink: 0, display: "inline-flex", alignItems: "center", gap: 4, border: `1px dashed ${T.divider}`, borderRadius: 999, background: "none", color: T.accent, fontSize: 12.5, fontWeight: 600, padding: "9px 14px", cursor: "pointer", whiteSpace: "nowrap" },
  tabImportBtn: { flexShrink: 0, display: "inline-flex", alignItems: "center", gap: 4, border: `1px dashed ${T.divider}`, borderRadius: 999, background: "none", color: T.muted, fontSize: 12.5, fontWeight: 600, padding: "9px 14px", cursor: "pointer", whiteSpace: "nowrap" },
  tabImportBtnActive: { flexShrink: 0, display: "inline-flex", alignItems: "center", gap: 4, border: `1px dashed ${T.accent}`, borderRadius: 999, background: T.accentSoft, color: T.accent, fontSize: 12.5, fontWeight: 700, padding: "9px 14px", cursor: "pointer", whiteSpace: "nowrap" },

  // ---- action row (share / reset / save status) ----
  actionRow: { display: "flex", alignItems: "center", gap: 8, marginBottom: 6, flexWrap: "wrap" },
  saveStatusText: { fontSize: 10.5, color: "#8E958B", marginLeft: "auto", whiteSpace: "nowrap" },
  shareCodeLine: { fontSize: 12, color: T.muted, marginTop: 0, marginBottom: 18, wordBreak: "break-all", lineHeight: 1.7 },
  shareCodeText: { fontFamily: "ui-monospace, Menlo, monospace", fontWeight: 700, color: T.ink, background: T.accentSoft, padding: "2px 7px", borderRadius: 6 },
  shareCodeHint: { marginLeft: 4 },

  // ---- import box ----
  importBox: { border: `1px solid ${T.divider}`, borderRadius: 10, padding: 12, marginBottom: 14, background: T.surface },

  // ---- toast ----
  toast: { position: "fixed", left: "50%", bottom: 20, transform: "translateX(-50%)", background: T.ink, color: "#FFFFFF", fontSize: 12.5, padding: "12px 16px", borderRadius: 10, boxShadow: "0 8px 24px rgba(0,0,0,0.25)", zIndex: 50, maxWidth: "92%", textAlign: "center", lineHeight: 1.6 },
};

const root = ReactDOM.createRoot(document.getElementById("root"));
root.render(<App />);
