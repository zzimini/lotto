"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ballColors } from "./ballColors";

// ── 캔버스 좌표계 (논리 픽셀) ─────────────────────────────
const W = 400;
const H = 470;
const CX = 200; // 드럼 중심
const CY = 220;
const R = 165; // 드럼 반지름
const BR = 13; // 공 반지름
const TOTAL = 45;
const PICK = 7; // 6개 + 보너스

// ── 물리 상수 ────────────────────────────────────────────
const GRAVITY = 900;
const JET = 4600; // 바닥에서 불어 올리는 바람
const KICK_RATE = 3.5; // 공 하나가 1초에 랜덤으로 튕겨지는 평균 횟수
const KICK_MIN = 450;
const KICK_MAX = 1150;
const GUST = 1150; // 순간 돌풍 세기
const WALL_BOUNCE = 0.82;
const BALL_BOUNCE = 0.92;
const MAX_SPEED = 1900;
const STEP = 1 / 240;
const SPIN_UP = 1.6; // 송풍기 출력이 올라가는 속도 (1/s)
const SPIN_DOWN = 0.9;

// ── 추첨 타이밍 (ms) ────────────────────────────────────
const MIX_BEFORE_FIRST = 2200;
const BETWEEN_PICKS = 1000;
const EXTRACT_TIME = 0.6; // s, 공이 출구로 빨려 나가는 시간

type Ball = {
  n: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  a: number; // 회전각 (숫자가 같이 굴러감)
  out: boolean;
  t: number; // 뽑힌 뒤 경과 시간
  sx: number;
  sy: number;
};

type Sim = {
  balls: Ball[];
  mixing: boolean;
  running: boolean;
  nextPickAt: number;
  drawn: number[];
  power: number; // 0..1 송풍기 출력
  gustTimer: number;
  gust: { x: number; t: number } | null; // 마지막 돌풍 (이펙트용)
};

function newSim(): Sim {
  return {
    balls: makeBalls(),
    mixing: false,
    running: false,
    nextPickAt: 0,
    drawn: [],
    power: 0,
    gustTimer: 0.3,
    gust: null,
  };
}

type Status = "idle" | "running" | "done";

/** crypto 기반 0..max-1 균등 난수 (모듈로 편향 제거) */
function randInt(max: number): number {
  const buf = new Uint32Array(1);
  const limit = Math.floor(0x100000000 / max) * max;
  let v: number;
  do {
    crypto.getRandomValues(buf);
    v = buf[0];
  } while (v >= limit);
  return v % max;
}

function makeBalls(): Ball[] {
  const balls: Ball[] = [];
  for (let n = 1; n <= TOTAL; n++) {
    // 드럼 안 아래쪽에 겹치지 않게 대충 흩뿌려 둔다 (어차피 물리가 정리함)
    let x = CX;
    let y = CY;
    for (let tries = 0; tries < 200; tries++) {
      const ang = Math.random() * Math.PI * 2;
      const rad = Math.sqrt(Math.random()) * (R - BR - 2);
      x = CX + Math.cos(ang) * rad;
      y = CY + Math.abs(Math.sin(ang)) * rad * 0.9;
      if (balls.every((b) => (b.x - x) ** 2 + (b.y - y) ** 2 > (BR * 2) ** 2)) break;
    }
    balls.push({ n, x, y, vx: 0, vy: 0, a: Math.random() * 6, out: false, t: 0, sx: 0, sy: 0 });
  }
  return balls;
}

function step(sim: Sim, dt: number) {
  const inside = sim.balls.filter((b) => !b.out);

  // 송풍기 출력 램프 업/다운
  sim.power = sim.mixing
    ? Math.min(1, sim.power + SPIN_UP * dt)
    : Math.max(0, sim.power - SPIN_DOWN * dt);
  const k = sim.power;

  if (sim.gust) {
    sim.gust.t += dt;
    if (sim.gust.t > 0.35) sim.gust = null;
  }

  if (k > 0) {
    // 바닥 랜덤 위치에서 순간 돌풍
    sim.gustTimer -= dt;
    if (sim.gustTimer <= 0) {
      const gx = CX + (Math.random() - 0.5) * R * 1.2;
      sim.gust = { x: gx, t: 0 };
      for (const b of inside) {
        const d = Math.hypot(b.x - gx, b.y - (CY + R));
        if (d < 110) {
          const f = (1 - d / 110) * GUST * k;
          b.vy -= f * (0.7 + Math.random() * 0.6);
          b.vx += (b.x - gx) * 4 * k + (Math.random() - 0.5) * 300 * k;
        }
      }
      sim.gustTimer = 0.18 + Math.random() * 0.35;
    }
  }

  for (const b of inside) {
    b.vy += GRAVITY * dt;
    if (k > 0) {
      // 바닥 송풍
      if (b.y > CY + R * 0.1) b.vy -= JET * k * dt * (0.5 + Math.random());
      // 공마다 제각각 랜덤한 방향으로 튕김
      if (Math.random() < KICK_RATE * k * dt) {
        const ang = Math.random() * Math.PI * 2;
        const mag = (KICK_MIN + Math.random() * (KICK_MAX - KICK_MIN)) * k;
        b.vx += Math.cos(ang) * mag;
        b.vy += Math.sin(ang) * mag - (b.y > CY ? 300 * k : 0);
      }
    } else {
      b.vx *= 0.995;
    }
    const sp = Math.hypot(b.vx, b.vy);
    if (sp > MAX_SPEED) {
      b.vx *= MAX_SPEED / sp;
      b.vy *= MAX_SPEED / sp;
    }
    b.x += b.vx * dt;
    b.y += b.vy * dt;
    b.a += (b.vx * dt) / BR;
  }

  // 공끼리 충돌
  for (let iter = 0; iter < 2; iter++) {
    for (let i = 0; i < inside.length; i++) {
      const p = inside[i];
      for (let j = i + 1; j < inside.length; j++) {
        const q = inside[j];
        const dx = q.x - p.x;
        const dy = q.y - p.y;
        const d2 = dx * dx + dy * dy;
        const min = BR * 2;
        if (d2 >= min * min || d2 === 0) continue;
        const d = Math.sqrt(d2);
        const nx = dx / d;
        const ny = dy / d;
        const push = (min - d) / 2;
        p.x -= nx * push;
        p.y -= ny * push;
        q.x += nx * push;
        q.y += ny * push;
        const rel = (q.vx - p.vx) * nx + (q.vy - p.vy) * ny;
        if (rel < 0) {
          const imp = (-(1 + BALL_BOUNCE) * rel) / 2;
          p.vx -= imp * nx;
          p.vy -= imp * ny;
          q.vx += imp * nx;
          q.vy += imp * ny;
        }
      }
    }
  }

  // 드럼 벽
  for (const b of inside) {
    const dx = b.x - CX;
    const dy = b.y - CY;
    const d = Math.hypot(dx, dy);
    const lim = R - BR;
    if (d > lim) {
      const nx = dx / d;
      const ny = dy / d;
      b.x = CX + nx * lim;
      b.y = CY + ny * lim;
      const vn = b.vx * nx + b.vy * ny;
      if (vn > 0) {
        b.vx -= (1 + WALL_BOUNCE) * vn * nx;
        b.vy -= (1 + WALL_BOUNCE) * vn * ny;
      }
      b.vx *= 0.99;
      b.vy *= 0.99;
    }
  }
}

const easeInOut = (t: number) => (t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2);

/** 뽑힌 공의 위치: 드럼 안 → 꼭대기 출구 → 관을 타고 위로 */
function extractPos(b: Ball): [number, number] {
  const t1 = EXTRACT_TIME * 0.55;
  const exitY = CY - R + BR;
  if (b.t < t1) {
    const k = easeInOut(b.t / t1);
    return [b.sx + (CX - b.sx) * k, b.sy + (exitY - b.sy) * k];
  }
  const k = easeInOut(Math.min(1, (b.t - t1) / (EXTRACT_TIME - t1)));
  return [CX, exitY + (CY - R - 52 - exitY) * k];
}

function drawBall(ctx: CanvasRenderingContext2D, x: number, y: number, n: number, a: number) {
  const [base, shade] = ballColors(n);
  const g = ctx.createRadialGradient(x - BR * 0.4, y - BR * 0.45, BR * 0.1, x, y, BR);
  g.addColorStop(0, "#ffffff");
  g.addColorStop(0.28, base);
  g.addColorStop(1, shade);
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(x, y, BR, 0, Math.PI * 2);
  ctx.fill();

  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(a);
  ctx.fillStyle = "rgba(255,255,255,0.92)";
  ctx.beginPath();
  ctx.arc(0, 0, BR * 0.58, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#1b1b24";
  ctx.font = "bold 10px system-ui, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(String(n), 0, 0.5);
  ctx.restore();
}

function render(ctx: CanvasRenderingContext2D, sim: Sim, time: number) {
  ctx.clearRect(0, 0, W, H);
  const k = sim.power;

  // 기계 진동
  ctx.save();
  if (k > 0) {
    ctx.translate((Math.random() - 0.5) * 3 * k, (Math.random() - 0.5) * 2.4 * k);
  }

  // 받침대
  const baseTop = CY + R - 10;
  const standGrad = ctx.createLinearGradient(0, baseTop, 0, H);
  standGrad.addColorStop(0, "#3b4a9e");
  standGrad.addColorStop(1, "#1a2052");
  ctx.fillStyle = standGrad;
  ctx.beginPath();
  ctx.moveTo(CX - 70, baseTop);
  ctx.lineTo(CX + 70, baseTop);
  ctx.lineTo(CX + 120, H - 14);
  ctx.lineTo(CX - 120, H - 14);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = "#11163d";
  ctx.fillRect(CX - 140, H - 16, 280, 12);
  // 송풍구 불빛
  ctx.fillStyle = k > 0 ? `rgba(255,214,90,${(0.6 + 0.4 * Math.sin(time / 50)) * Math.max(0.3, k)})` : "#2c3570";
  ctx.beginPath();
  ctx.arc(CX, baseTop + 32, 7, 0, Math.PI * 2);
  ctx.fill();

  // 드럼 뒷면
  const back = ctx.createRadialGradient(CX, CY + R * 0.3, R * 0.2, CX, CY, R);
  back.addColorStop(0, "rgba(120,150,255,0.10)");
  back.addColorStop(1, "rgba(120,150,255,0.28)");
  ctx.fillStyle = back;
  ctx.beginPath();
  ctx.arc(CX, CY, R, 0, Math.PI * 2);
  ctx.fill();

  // 돌풍 기둥
  if (k > 0.05) {
    ctx.save();
    ctx.beginPath();
    ctx.arc(CX, CY, R - 2, 0, Math.PI * 2);
    ctx.clip();
    if (sim.gust) {
      const g = sim.gust;
      const al = (1 - g.t / 0.35) * 0.35 * k;
      const grad = ctx.createLinearGradient(0, CY + R, 0, CY + R - 160);
      grad.addColorStop(0, `rgba(255,230,150,${al})`);
      grad.addColorStop(1, "rgba(255,230,150,0)");
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.moveTo(g.x - 22, CY + R);
      ctx.lineTo(g.x + 22, CY + R);
      ctx.lineTo(g.x + 40, CY + R - 160);
      ctx.lineTo(g.x - 40, CY + R - 160);
      ctx.closePath();
      ctx.fill();
    }
    ctx.restore();
  }

  // 출구 관
  ctx.fillStyle = "rgba(170,190,255,0.18)";
  ctx.strokeStyle = "rgba(210,220,255,0.55)";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.rect(CX - BR - 5, CY - R - 66, (BR + 5) * 2, 70);
  ctx.fill();
  ctx.stroke();

  // 잔상 (빠른 공일수록 길게)
  for (const b of sim.balls) {
    if (b.out) continue;
    const sp = Math.hypot(b.vx, b.vy);
    if (sp < 350) continue;
    const [base] = ballColors(b.n);
    const len = Math.min(1, (sp - 350) / 1200);
    for (let i = 1; i <= 3; i++) {
      const f = i * 0.012;
      ctx.globalAlpha = 0.22 * len * (1 - i / 4);
      ctx.fillStyle = base;
      ctx.beginPath();
      ctx.arc(b.x - b.vx * f, b.y - b.vy * f, BR * (1 - i * 0.1), 0, Math.PI * 2);
      ctx.fill();
    }
  }
  ctx.globalAlpha = 1;

  // 공들
  for (const b of sim.balls) {
    if (b.out) {
      const [x, y] = extractPos(b);
      drawBall(ctx, x, y, b.n, b.a);
    } else {
      drawBall(ctx, b.x, b.y, b.n, b.a);
    }
  }

  // 유리 앞면 (테두리 + 반사광)
  ctx.lineWidth = 4;
  ctx.strokeStyle = "rgba(220,230,255,0.75)";
  ctx.beginPath();
  ctx.arc(CX, CY, R, 0, Math.PI * 2);
  ctx.stroke();
  ctx.lineWidth = 10;
  ctx.lineCap = "round";
  ctx.strokeStyle = "rgba(255,255,255,0.22)";
  ctx.beginPath();
  ctx.arc(CX, CY, R - 18, Math.PI * 1.08, Math.PI * 1.38);
  ctx.stroke();
  ctx.lineWidth = 5;
  ctx.strokeStyle = "rgba(255,255,255,0.12)";
  ctx.beginPath();
  ctx.arc(CX, CY, R - 18, Math.PI * 1.45, Math.PI * 1.52);
  ctx.stroke();
  ctx.lineCap = "butt";

  // 공이 출구로 빨려 나갈 때 번쩍
  const picked = sim.balls.find((b) => b.out);
  if (picked) {
    const p = Math.min(1, picked.t / EXTRACT_TIME);
    const exitY = CY - R;
    const glow = ctx.createRadialGradient(CX, exitY, 0, CX, exitY, 30 + 50 * p);
    glow.addColorStop(0, `rgba(255,235,150,${0.7 * (1 - p)})`);
    glow.addColorStop(1, "rgba(255,235,150,0)");
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(CX, exitY, 30 + 50 * p, 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.restore();
}

function ResultBall({ n, small }: { n: number; small?: boolean }) {
  const [base, shade] = ballColors(n);
  return (
    <span
      className={`ball-pop inline-flex shrink-0 items-center justify-center rounded-full font-bold text-white shadow-lg ${
        small ? "h-7 w-7 text-xs" : "h-11 w-11 text-lg sm:h-12 sm:w-12"
      }`}
      style={{
        background: `radial-gradient(circle at 32% 28%, #fff 0%, ${base} 30%, ${shade} 100%)`,
        textShadow: "0 1px 2px rgba(0,0,0,0.45)",
      }}
    >
      {n}
    </span>
  );
}

export default function LottoMachine() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const simRef = useRef<Sim | null>(null);
  const [status, setStatus] = useState<Status>("idle");
  const [results, setResults] = useState<number[]>([]);
  const [history, setHistory] = useState<number[][]>([]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = W * dpr;
    canvas.height = H * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    const sim = newSim();
    simRef.current = sim;

    let raf = 0;
    let last = performance.now();
    let acc = 0;

    const frame = (now: number) => {
      acc += Math.min(0.05, (now - last) / 1000);
      last = now;
      while (acc >= STEP) {
        step(sim, STEP);
        for (const b of sim.balls)
          if (b.out) {
            b.t += STEP;
            b.a += STEP * 18; // 빨려 나가며 팽그르르
          }
        acc -= STEP;
      }

      // 다 빠져나간 공은 결과판으로
      const finished = sim.balls.filter((b) => b.out && b.t >= EXTRACT_TIME);
      if (finished.length) {
        sim.balls = sim.balls.filter((b) => !(b.out && b.t >= EXTRACT_TIME));
        for (const b of finished) sim.drawn.push(b.n);
        const drawn = sim.drawn.slice();
        setResults(drawn);
        if (drawn.length >= PICK) {
          sim.running = false;
          setTimeout(() => {
            sim.mixing = false;
          }, 500);
          setStatus("done");
          setHistory((h) => [drawn, ...h].slice(0, 5));
        } else {
          sim.nextPickAt = now + BETWEEN_PICKS;
        }
      }

      // 다음 공 뽑기
      if (sim.running && now >= sim.nextPickAt && !sim.balls.some((b) => b.out)) {
        const inside = sim.balls.filter((b) => !b.out);
        const b = inside[randInt(inside.length)];
        b.out = true;
        b.t = 0;
        b.sx = b.x;
        b.sy = b.y;
        sim.nextPickAt = Infinity;
      }

      render(ctx, sim, now);
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, []);

  const start = useCallback(() => {
    const sim = simRef.current;
    if (!sim || sim.running) return;
    if (sim.balls.length < TOTAL) sim.balls = makeBalls();
    sim.drawn = [];
    sim.mixing = true;
    sim.running = true;
    sim.nextPickAt = performance.now() + MIX_BEFORE_FIRST;
    setResults([]);
    setStatus("running");
  }, []);

  const main = results.slice(0, 6);
  const bonus = results[6];

  return (
    <section className="mt-6 flex w-full flex-col items-center">
      <canvas
        ref={canvasRef}
        className="aspect-[400/470] w-full max-w-[400px]"
        aria-label="로또 추첨 드럼"
        role="img"
      />

      <div className="mt-4 flex min-h-16 w-full flex-wrap items-center justify-center gap-2 rounded-2xl bg-white/5 px-3 py-3 ring-1 ring-white/10">
        {results.length === 0 ? (
          <span className="text-sm text-indigo-200/60">
            {status === "running" ? "공을 섞는 중…" : "추첨 버튼을 눌러보세요"}
          </span>
        ) : (
          <>
            {main.map((n) => (
              <ResultBall key={n} n={n} />
            ))}
            {bonus !== undefined && (
              <>
                <span className="px-1 text-xl font-bold text-indigo-200/70">+</span>
                <ResultBall n={bonus} />
              </>
            )}
          </>
        )}
      </div>

      {status === "done" && (
        <p className="mt-3 text-sm text-indigo-100/90">
          정렬:{" "}
          <span className="font-semibold text-amber-200">
            {[...main].sort((a, b) => a - b).join(", ")}
          </span>{" "}
          · 보너스 <span className="font-semibold text-amber-200">{bonus}</span>
        </p>
      )}

      <button
        type="button"
        onClick={start}
        disabled={status === "running"}
        className="mt-6 rounded-full bg-amber-400 px-10 py-3.5 text-lg font-bold text-indigo-950 shadow-[0_6px_0_#b7860b] transition active:translate-y-1 active:shadow-[0_2px_0_#b7860b] disabled:cursor-not-allowed disabled:opacity-60"
      >
        {status === "running" ? "추첨 중…" : status === "done" ? "다시 추첨" : "추첨 시작"}
      </button>

      {history.length > 1 && (
        <div className="mt-8 w-full">
          <h2 className="mb-2 text-sm font-semibold text-indigo-200/80">지난 추첨</h2>
          <ul className="space-y-2">
            {history.slice(1).map((h, i) => (
              <li key={i} className="flex flex-wrap items-center gap-1.5">
                {[...h.slice(0, 6)].sort((a, b) => a - b).map((n) => (
                  <ResultBall key={n} n={n} small />
                ))}
                <span className="px-0.5 text-indigo-200/60">+</span>
                <ResultBall n={h[6]} small />
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
