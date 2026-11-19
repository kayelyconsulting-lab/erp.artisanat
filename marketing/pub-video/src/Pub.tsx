import React from 'react';
import {
  AbsoluteFill, Audio, Easing, Img, interpolate, random, spring, staticFile,
  useCurrentFrame, useVideoConfig,
} from 'remotion';
import {evolvePath} from '@remotion/paths';
import CAPS from './captions.json';

/* ---------- charte ---------- */
const C = {
  navy: '#1F3864', deep: '#0E1D3A', ink: '#15294D', orange: '#E8720C', orange2: '#FFA94D',
  soft: '#C9D6EE', bg: '#F5F8FC', line: '#DCE4F5', grey: '#5B6479', green: '#1E9E6A',
};
const FONT = 'Inter, "Inter Display", sans-serif';

/* ---------- synchro voix off (images, 30 i/s) ---------- */
const T = {
  brand: 20, digital: 57, service: 85,
  s2: 130, factures: 142, stocks: 168, paie: 183, compta: 192, eparpille: 212,
  s3: 290, kgp: 298, dash: 338, ventes: 342, encaisse: 367, treso: 392, live: 422,
  s4: 510, f1: 516, f2: 547, f3: 561, f4: 573, f5: 605, f6: 625, business: 641, seul: 672,
  s5: 700, simple: 704, sur: 730, fiable: 752, assemble: 790,
  s6: 820, cta: 828, url: 885, contact: 858, demo: 912,
};

/* ---------- utilitaires ---------- */
const clamp = {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'} as const;
const useLayout = () => {
  const {width: W, height: H, fps} = useVideoConfig();
  const V = H > W;
  const S = V ? Math.min(W / 1080, (H / 1920) * 1.12) : H / 1080;
  return {W, H, V, S, fps};
};
const useSpring = (delay: number, cfg: object = {}) => {
  const f = useCurrentFrame();
  const {fps} = useVideoConfig();
  return spring({frame: f - delay, fps, config: {damping: 14, stiffness: 140, mass: 0.7, ...cfg}});
};
const ramp = (f: number, a: number, b: number, e = Easing.out(Easing.cubic)) =>
  interpolate(f, [a, b], [0, 1], {...clamp, easing: e});

/* Texte révélé mot par mot (masque) */
const Words: React.FC<{text: string; start: number; stagger?: number; style?: React.CSSProperties; hl?: string[]}> = ({
  text, start, stagger = 3, style, hl = [],
}) => {
  const f = useCurrentFrame();
  const {fps} = useVideoConfig();
  return (
    <div style={{display: 'flex', flexWrap: 'wrap', justifyContent: 'center', columnGap: '0.28em', ...style}}>
      {text.split(' ').map((w, i) => {
        const p = spring({frame: f - start - i * stagger, fps, config: {damping: 16, stiffness: 160, mass: 0.6}});
        return (
          <span key={i} style={{display: 'inline-block', overflow: 'hidden', padding: '0.06em 0 0.12em'}}>
            <span style={{display: 'inline-block', transform: `translateY(${(1 - p) * 115}%) rotate(${(1 - p) * 6}deg)`,
              color: hl.includes(w) ? C.orange2 : undefined}}>{w}</span>
          </span>
        );
      })}
    </div>
  );
};

/* Texte révélé lettre par lettre */
const Letters: React.FC<{text: string; start: number; stagger?: number; style?: React.CSSProperties; colorFrom?: number}> = ({
  text, start, stagger = 1.6, style, colorFrom = 999,
}) => {
  const f = useCurrentFrame();
  const {fps} = useVideoConfig();
  return (
    <div style={{display: 'flex', justifyContent: 'center', whiteSpace: 'pre', ...style}}>
      {text.split('').map((ch, i) => {
        const p = spring({frame: f - start - i * stagger, fps, config: {damping: 13, stiffness: 170, mass: 0.6}});
        return (
          <span key={i} style={{display: 'inline-block', overflow: 'hidden', padding: '0.05em 0 0.1em'}}>
            <span style={{display: 'inline-block', transform: `translateY(${(1 - p) * 110}%)`, opacity: Math.min(1, p * 1.4),
              color: i >= colorFrom ? C.orange2 : undefined}}>{ch}</span>
          </span>
        );
      })}
    </div>
  );
};

/* Reflet lumineux qui balaie un bloc */
const Sweep: React.FC<{at: number; dur?: number}> = ({at, dur = 22}) => {
  const f = useCurrentFrame();
  const x = interpolate(f, [at, at + dur], [-60, 160], {...clamp, easing: Easing.inOut(Easing.quad)});
  return (
    <div style={{position: 'absolute', inset: 0, pointerEvents: 'none', mixBlendMode: 'overlay',
      background: `linear-gradient(105deg, transparent ${x - 18}%, rgba(255,255,255,.9) ${x}%, transparent ${x + 18}%)`}} />
  );
};

/* Tuile blanche avec le symbole du vrai logo */
const Mark: React.FC<{size: number; at: number; glow?: boolean}> = ({size, at, glow = true}) => {
  const p = useSpring(at, {damping: 11, stiffness: 120});
  return (
    <div style={{width: size, height: size, borderRadius: size * 0.26, transform: `scale(${p}) rotate(${(1 - p) * -120}deg)`, background: '#fff',
      display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: glow ? `0 ${size * 0.2}px ${size * 0.6}px rgba(232,114,12,.45)` : undefined}}>
      <Img src={staticFile('symbol-color.png')} style={{width: size * 0.72, height: size * 0.72 * 199 / 240}} />
    </div>
  );
};

/* Vrai logo animé : le symbole surgit, puis le nom se déroule */
const LOGO_R = 729 / 206;
const SYM = 238 / 729;
const Logo: React.FC<{w: number; at: number; wordAt: number}> = ({w, at, wordAt}) => {
  const f = useCurrentFrame();
  const {fps} = useVideoConfig();
  const h = w / LOGO_R;
  const p = spring({frame: f - at, fps, config: {damping: 10, stiffness: 110, mass: 0.8}});
  const r = interpolate(f, [wordAt, wordAt + 20], [0, 1], {...clamp, easing: Easing.inOut(Easing.cubic)});
  const glow = interpolate(f, [at + 10, at + 30], [0, 1], clamp);
  const img = {position: 'absolute', left: 0, top: 0, width: w, height: h} as const;
  return (
    <div style={{position: 'relative', width: w, height: h, filter: `drop-shadow(0 ${h * 0.08}px ${h * 0.25 * glow}px rgba(232,114,12,${0.35 * glow}))`}}>
      <Img src={staticFile('logo-white.png')} style={{...img, clipPath: `inset(0 ${(1 - SYM) * 100}% 0 0)`, transformOrigin: `${SYM * 45}% 60%`,
        transform: `translateX(${(1 - r) * w * 0.33}px) scale(${p}) rotate(${(1 - p) * -30}deg)`}} />
      <Img src={staticFile('logo-white.png')} style={{...img, clipPath: `inset(0 ${(1 - r) * (1 - SYM) * 100}% 0 ${SYM * 100}%)`,
        transform: `translateX(${(1 - r) * -w * 0.05}px)`, opacity: r}} />
    </div>
  );
};

/* Icônes vectorielles */
const Icon: React.FC<{name: string; size: number; color?: string}> = ({name, size, color = '#fff'}) => {
  const st = {fill: 'none', stroke: color, strokeWidth: 1.8, strokeLinecap: 'round', strokeLinejoin: 'round'} as const;
  const icons: Record<string, React.ReactNode> = {
    invoice: <><path d="M6 2h9l5 5v15H6z" {...st} /><path d="M15 2v5h5M9 12h8M9 16h8M9 8h3" {...st} /></>,
    box: <><path d="M12 2l9 5v10l-9 5-9-5V7z" {...st} /><path d="M3 7l9 5 9-5M12 12v10" {...st} /></>,
    people: <><circle cx="9" cy="8" r="3.5" {...st} /><path d="M2 20c0-3.6 3-6 7-6s7 2.4 7 6" {...st} /><circle cx="17.5" cy="7" r="2.5" {...st} /><path d="M17 13.5c2.8 0 5 1.9 5 5" {...st} /></>,
    chart: <><path d="M3 3v18h18" {...st} /><path d="M7 15l4-4 3 3 6-6" {...st} /><path d="M16 8h4v4" {...st} /></>,
    phone: <><rect x="7" y="2" width="10" height="20" rx="2.5" {...st} /><path d="M11 18h2" {...st} /><path d="M10 9l2 2 3-4" {...st} /></>,
    lock: <><rect x="5" y="11" width="14" height="10" rx="2.5" {...st} /><path d="M8 11V7a4 4 0 0 1 8 0v4M12 15v2" {...st} /></>,
    sheet: <><rect x="3" y="3" width="18" height="18" rx="2" {...st} /><path d="M3 9h18M3 15h18M9 3v18" {...st} /></>,
    clock: <><circle cx="12" cy="12" r="9" {...st} /><path d="M12 7v5l3 2" {...st} /></>,
    call: <path d="M5 3h3.5l2 5-2.6 1.6a12 12 0 0 0 6.5 6.5L16 13.5l5 2V19a2 2 0 0 1-2 2A17 17 0 0 1 3 5a2 2 0 0 1 2-2z" {...st} />,
    mail: <><rect x="3" y="5" width="18" height="14" rx="2.5" {...st} /><path d="M3.5 6.5l8.5 6 8.5-6" {...st} /></>,
  };
  return <svg width={size} height={size} viewBox="0 0 24 24">{icons[name]}</svg>;
};

/* ---------- fond animé ---------- */
const Background: React.FC = () => {
  const f = useCurrentFrame();
  const {W, H, S} = useLayout();
  const g = 46 * S;
  return (
    <AbsoluteFill style={{background: `radial-gradient(120% 90% at 70% 15%, #2B4C86 0%, ${C.navy} 40%, ${C.deep} 100%)`}}>
      <svg width={W} height={H} style={{position: 'absolute', opacity: 0.22}}>
        <defs>
          <pattern id="dots" width={g} height={g} patternUnits="userSpaceOnUse" patternTransform={`translate(${(f * 0.6) % g} ${(f * 0.35) % g})`}>
            <circle cx={g / 2} cy={g / 2} r={1.6 * S} fill="#9FB4DD" />
          </pattern>
        </defs>
        <rect width={W} height={H} fill="url(#dots)" />
      </svg>
      <div style={{position: 'absolute', width: 900 * S, height: 900 * S, borderRadius: '50%', background: C.orange, filter: `blur(${150 * S}px)`, opacity: 0.32,
        left: -300 * S + Math.sin(f / 50) * 140 * S, top: H - 600 * S + Math.cos(f / 60) * 90 * S}} />
      <div style={{position: 'absolute', width: 800 * S, height: 800 * S, borderRadius: '50%', background: '#4F78C4', filter: `blur(${150 * S}px)`, opacity: 0.35,
        right: -250 * S + Math.cos(f / 55) * 120 * S, top: -280 * S + Math.sin(f / 45) * 100 * S}} />
      <AbsoluteFill style={{background: 'radial-gradient(ellipse at center, transparent 55%, rgba(5,12,28,.55) 100%)'}} />
    </AbsoluteFill>
  );
};

/* ---------- transition : double volet diagonal ---------- */
const Wipe: React.FC<{at: number; color?: string; second?: string}> = ({at, color = C.orange, second = C.deep}) => {
  const f = useCurrentFrame();
  const {W, H} = useLayout();
  const bar = (delay: number, col: string) => {
    const left = interpolate(f, [at - 12 + delay, at + 12 + delay], [-3.6 * W, 1.6 * W], {...clamp, easing: Easing.inOut(Easing.cubic)});
    return <div style={{position: 'absolute', top: -H * 0.5, height: H * 2, width: W * 3, left, background: col, transform: 'skewX(-14deg)'}} />;
  };
  if (f < at - 14 || f > at + 18) return null;
  return <AbsoluteFill style={{zIndex: 50, overflow: 'hidden'}}>{bar(0, color)}{bar(4, second)}</AbsoluteFill>;
};

/* ======================= SCÈNE 1 : INTRO ======================= */
const Intro: React.FC = () => {
  const f = useCurrentFrame();
  const {S, V} = useLayout();
  const rings = [0, 6, 12].map((d, i) => {
    const p = ramp(f, 2 + d, 40 + d);
    return <div key={i} style={{position: 'absolute', width: 1400 * S * p, height: 1400 * S * p, borderRadius: '50%',
      border: `${3 * S}px solid ${i === 1 ? C.orange2 : '#7E9BD3'}`, opacity: (1 - p) * 0.7}} />;
  });
  const out = ramp(f, 112, 130, Easing.in(Easing.cubic));
  return (
    <AbsoluteFill style={{alignItems: 'center', justifyContent: 'center', fontFamily: FONT}}>
      {rings}
      <div style={{display: 'flex', flexDirection: 'column', alignItems: 'center', transform: `scale(${1 + out * 0.15 + f * 0.0006})`, filter: `blur(${out * 8}px)`}}>
        <Logo w={(V ? 880 : 1050) * S} at={4} wordAt={T.brand} />
        <div style={{marginTop: 30 * S, color: C.soft, fontSize: (V ? 46 : 44) * S, fontWeight: 500, textAlign: 'center', maxWidth: (V ? 860 : 1500) * S}}>
          <Words text="Le digital," start={T.digital} />
          <Words text="au service de votre entreprise" start={T.service} hl={['entreprise']} style={{fontWeight: 700, color: '#fff'}} />
        </div>
      </div>
    </AbsoluteFill>
  );
};

/* ======================= SCÈNE 2 : LE PROBLÈME ======================= */
const CARDS = [
  {icon: 'invoice', t: 'Facture n°0127', at: T.factures + 4, h: [0.13, 0.2], v: [0.2, 0.17]},
  {icon: 'invoice', t: 'Devis — à relancer', at: T.factures + 10, h: [0.8, 0.16], v: [0.78, 0.25]},
  {icon: 'box', t: 'Stock : ???', at: T.stocks + 2, h: [0.17, 0.78], v: [0.24, 0.64]},
  {icon: 'sheet', t: 'stock_v3_FINAL.xlsx', at: T.stocks + 8, h: [0.84, 0.74], v: [0.72, 0.7]},
  {icon: 'people', t: 'Bulletins de paie', at: T.paie + 2, h: [0.5, 0.12], v: [0.5, 0.1]},
  {icon: 'chart', t: 'Bilan en retard', at: T.compta + 3, h: [0.5, 0.86], v: [0.5, 0.76]},
  {icon: 'clock', t: 'Client en retard', at: T.compta + 9, h: [0.07, 0.5], v: [0.15, 0.36]},
  {icon: 'sheet', t: 'Caisse.xlsx', at: T.compta + 14, h: [0.93, 0.45], v: [0.85, 0.6]},
];
const Problem: React.FC = () => {
  const f = useCurrentFrame();
  const {W, H, S, V, fps} = useLayout();
  const words = [
    {w: 'Factures', at: T.factures}, {w: 'Stocks', at: T.stocks}, {w: 'Paie', at: T.paie}, {w: 'Comptabilité', at: T.compta},
  ];
  const cur = [...words].reverse().find((x) => f >= x.at);
  const suck = ramp(f, 262, 288, Easing.in(Easing.cubic));
  const shake = f > T.eparpille && f < T.eparpille + 14 ? (random(f) - 0.5) * 16 * S : 0;
  return (
    <AbsoluteFill style={{fontFamily: FONT, transform: `translateX(${shake}px)`}}>
      {CARDS.map((c, i) => {
        const p = spring({frame: f - c.at, fps, config: {damping: 12, stiffness: 120, mass: 0.8}});
        const [fx, fy] = V ? c.v : c.h;
        const drift = Math.sin((f + i * 20) / 18) * 10 * S;
        const rot = (random(`r${i}`) - 0.5) * 24;
        const x = (fx * W) * (1 - suck) + (W / 2) * suck;
        const y = (fy * H) * (1 - suck) + (H / 2) * suck;
        return (
          <div key={i} style={{position: 'absolute', left: x, top: y + drift, transform: `translate(-50%,-50%) scale(${p * (1 - suck * 0.9)}) rotate(${rot * (1 - suck) + (1 - p) * 40}deg)`,
            background: '#fff', borderRadius: 18 * S, padding: `${18 * S}px ${26 * S}px`, display: 'flex', alignItems: 'center', gap: 14 * S,
            boxShadow: `0 ${20 * S}px ${50 * S}px rgba(0,0,0,.35)`, color: C.ink, fontWeight: 700, fontSize: 28 * S, whiteSpace: 'nowrap', opacity: Math.min(1, p * 2)}}>
            <div style={{width: 50 * S, height: 50 * S, borderRadius: 12 * S, background: '#FBE5E3', display: 'flex', alignItems: 'center', justifyContent: 'center'}}>
              <Icon name={c.icon} size={30 * S} color="#B3261E" />
            </div>
            {c.t}
          </div>
        );
      })}
      <AbsoluteFill style={{alignItems: 'center', justifyContent: 'center'}}>
        {cur && f < T.eparpille && (() => {
          const p = spring({frame: f - cur.at, fps, config: {damping: 10, stiffness: 200, mass: 0.6}});
          const size = Math.min(190 * S, (W * 0.84) / (cur.w.length * 0.62));
          return (
            <div key={cur.w} style={{color: '#fff', fontWeight: 900, fontSize: size, transform: `scale(${2 - p})`, opacity: p, letterSpacing: '-0.02em',
              textShadow: `0 ${10 * S}px ${40 * S}px rgba(0,0,0,.4)`}}>{cur.w}</div>
          );
        })()}
        {f >= T.eparpille && (
          <div style={{textAlign: 'center', transform: `scale(${1 - suck})`, opacity: 1 - suck}}>
            <Words text="Tout est" start={T.eparpille} style={{color: '#fff', fontWeight: 800, fontSize: (V ? 96 : 110) * S}} />
            <div style={{display: 'flex', justifyContent: 'center', fontWeight: 900, fontSize: (V ? 130 : 150) * S, color: C.orange2}}>
              {'éparpillé ?'.split('').map((ch, i) => {
                const k = ramp(f, T.eparpille + 14, 262, Easing.inOut(Easing.quad));
                const p = spring({frame: f - T.eparpille - 6 - i * 1.2, fps, config: {damping: 12, stiffness: 180}});
                const dx = (random(`x${i}`) - 0.5) * 120 * S * k;
                const dy = (random(`y${i}`) - 0.5) * 160 * S * k;
                const r = (random(`a${i}`) - 0.5) * 60 * k;
                return <span key={i} style={{display: 'inline-block', whiteSpace: 'pre', opacity: p, transform: `translate(${dx}px,${dy + (1 - p) * 80 * S}px) rotate(${r}deg)`}}>{ch}</span>;
              })}
            </div>
          </div>
        )}
      </AbsoluteFill>
    </AbsoluteFill>
  );
};

/* ======================= SCÈNE 3 : LE PRODUIT ======================= */
const fmt = (n: number) => Math.round(n).toLocaleString('fr-FR').replace(/[  ]/g, ' ');
const Product: React.FC = () => {
  const f = useCurrentFrame();
  const {S, V, fps} = useLayout();
  const up = ramp(f, T.dash - 6, T.dash + 14, Easing.inOut(Easing.cubic));
  const d = spring({frame: f - T.dash, fps, config: {damping: 15, stiffness: 90, mass: 1}});
  const DW = (V ? 960 : 1360) * S;
  const DH = (V ? 980 : 700) * S;
  const hi = (a: number, b: number) => ramp(f, a, a + 8) * (1 - ramp(f, b, b + 8));
  const kpis = [
    {l: "Ventes du mois", to: 48750000, cur: 'FCFA', at: T.ventes, until: T.encaisse},
    {l: 'Encaissé', to: 41200000, cur: 'FCFA', at: T.encaisse, until: T.treso},
    {l: 'Trésorerie', to: 12480000, cur: 'FCFA', at: T.treso, until: T.live},
  ];
  const bars = [52, 44, 66, 58, 61, 55, 78, 70, 90, 83, 96, 88];
  const live = Math.sin(f / 3) * 0.5 + 0.5;
  const chartW = DW - (V ? 70 : 380) * S;
  const chartH = (V ? 450 : 330) * S;
  const pts = [0.62, 0.55, 0.6, 0.48, 0.5, 0.38, 0.4, 0.3, 0.26, 0.18, 0.2, 0.1];
  const path = pts.map((y, i) => `${i ? 'L' : 'M'} ${(i / (pts.length - 1)) * (chartW - 60 * S) + 30 * S} ${y * chartH * 0.8 + chartH * 0.12}`).join(' ');
  const draw = ramp(f, T.treso, T.treso + 28, Easing.inOut(Easing.cubic));
  const ev = evolvePath(draw, path);
  const toast = spring({frame: f - T.live - 4, fps, config: {damping: 13, stiffness: 140}});
  const exit = ramp(f, 492, 510, Easing.in(Easing.cubic));
  return (
    <AbsoluteFill style={{fontFamily: FONT, alignItems: 'center', justifyContent: 'center'}}>
      <div style={{position: 'absolute', top: interpolate(up, [0, 1], [V ? 760 : 380, V ? 170 : 40]) * S, width: '100%', textAlign: 'center',
        transform: `scale(${interpolate(up, [0, 1], [1, V ? 0.62 : 0.55])})`, transformOrigin: 'top center'}}>
        <Words text="Découvrez" start={T.s3 + 2} style={{color: C.soft, fontWeight: 600, fontSize: 60 * S}} />
        <Letters text="KAYELY GESTION PRO" start={T.kgp} stagger={1.3} colorFrom={7}
          style={{color: '#fff', fontWeight: 900, fontSize: (V ? 96 : 130) * S, letterSpacing: '0.04em'}} />
        <div style={{margin: '0 auto', height: 8 * S, width: (V ? 600 : 900) * S * ramp(f, T.kgp + 20, T.kgp + 40), background: `linear-gradient(90deg, ${C.orange}, ${C.orange2})`, borderRadius: 8 * S}} />
      </div>
      <div style={{position: 'absolute', top: (V ? 460 : 225) * S, width: DW, height: DH, borderRadius: 28 * S, background: C.bg, overflow: 'hidden', display: 'flex',
        boxShadow: `0 ${50 * S}px ${120 * S}px rgba(0,0,0,.5)`, opacity: Math.min(1, d * 2) * (1 - exit),
        transform: `perspective(${2000 * S}px) translateY(${(1 - d) * 500 * S}px) rotateX(${(1 - d) * 35}deg) scale(${0.96 + 0.04 * d + exit * 0.1})`}}>
        {!V && (
          <div style={{width: 300 * S, background: C.navy, padding: `${36 * S}px ${26 * S}px`, color: '#fff'}}>
            <div style={{fontWeight: 900, fontSize: 26 * S, letterSpacing: '0.06em'}}>KAYELY <span style={{color: C.orange2}}>PRO</span></div>
            {['Tableau de bord', 'Ventes & factures', 'Achats', 'Stocks', 'Paie', 'Comptabilité', 'Trésorerie'].map((x, i) => (
              <div key={x} style={{marginTop: 18 * S, fontSize: 22 * S, padding: `${12 * S}px ${16 * S}px`, borderRadius: 12 * S,
                color: i === 0 ? '#fff' : C.soft, fontWeight: i === 0 ? 700 : 500, background: i === 0 ? 'rgba(255,169,77,.18)' : 'transparent',
                opacity: ramp(f, T.dash + 6 + i * 2, T.dash + 14 + i * 2), transform: `translateX(${(1 - ramp(f, T.dash + 6 + i * 2, T.dash + 14 + i * 2)) * -30 * S}px)`}}>{x}</div>
            ))}
          </div>
        )}
        <div style={{flex: 1, padding: `${34 * S}px ${36 * S}px`, position: 'relative'}}>
          <div style={{display: 'flex', alignItems: 'center', justifyContent: 'space-between'}}>
            <div style={{fontSize: 34 * S, fontWeight: 800, color: C.ink}}>Tableau de bord</div>
            <div style={{display: 'flex', alignItems: 'center', gap: 10 * S, fontSize: 22 * S, fontWeight: 700, color: C.green,
              opacity: ramp(f, T.live, T.live + 8), background: '#E3F6EE', padding: `${8 * S}px ${16 * S}px`, borderRadius: 99}}>
              <div style={{width: 12 * S, height: 12 * S, borderRadius: 99, background: C.green, boxShadow: `0 0 0 ${live * 8 * S}px rgba(30,158,106,${0.35 * (1 - live)})`}} />
              En temps réel
            </div>
          </div>
          <div style={{display: 'flex', flexWrap: V ? 'wrap' : 'nowrap', gap: 20 * S, marginTop: 26 * S}}>
            {kpis.map((k, i) => {
              const h = hi(k.at, k.until);
              const cnt = ramp(f, T.dash + 10, k.at + 30, Easing.out(Easing.quad));
              return (
                <div key={k.l} style={{flex: V ? (i === 2 ? '1 1 100%' : '1 1 40%') : '1 1 0', minWidth: 0, background: '#fff', borderRadius: 18 * S, padding: 22 * S,
                  border: `${2 * S}px solid ${h > 0.01 ? C.orange : C.line}`, transform: `scale(${1 + h * 0.05})`,
                  boxShadow: `0 ${16 * S * h}px ${40 * S * h}px rgba(232,114,12,${0.3 * h})`, position: 'relative', zIndex: h > 0 ? 2 : 1}}>
                  <div style={{fontSize: 20 * S, color: C.grey, fontWeight: 600}}>{k.l}</div>
                  <div style={{fontSize: (V ? 40 : 36) * S, color: C.ink, fontWeight: 800, marginTop: 6 * S, whiteSpace: 'nowrap'}}>
                    {fmt(k.to * cnt)} <span style={{fontSize: 20 * S, color: C.grey}}>{k.cur}</span>
                  </div>
                </div>
              );
            })}
          </div>
          <div style={{marginTop: 24 * S, background: '#fff', border: `${2 * S}px solid ${C.line}`, borderRadius: 18 * S, height: chartH, position: 'relative', overflow: 'hidden'}}>
            <div style={{position: 'absolute', top: 18 * S, left: 26 * S, fontSize: 20 * S, fontWeight: 700, color: C.ink}}>Ventes &amp; trésorerie — 12 mois</div>
            <div style={{position: 'absolute', left: 30 * S, right: 30 * S, bottom: 20 * S, top: 70 * S, display: 'flex', alignItems: 'flex-end', gap: 14 * S}}>
              {bars.map((b, i) => {
                const g = ramp(f, T.dash + 14 + i * 2, T.dash + 34 + i * 2, Easing.out(Easing.back(1.4)));
                const wig = f > T.live ? Math.sin(f / 4 + i) * 4 : 0;
                return <div key={i} style={{flex: 1, height: `${(b + wig) * g}%`, borderRadius: `${8 * S}px ${8 * S}px 0 0`,
                  background: i % 2 ? `linear-gradient(180deg,#6F8FCC,${C.navy})` : `linear-gradient(180deg,${C.orange2},${C.orange})`}} />;
              })}
            </div>
            <svg width={chartW} height={chartH} style={{position: 'absolute', left: 0, top: 0}}>
              <path d={path} fill="none" stroke={C.green} strokeWidth={6 * S} strokeLinecap="round" strokeLinejoin="round"
                strokeDasharray={ev.strokeDasharray} strokeDashoffset={ev.strokeDashoffset} />
            </svg>
          </div>
          <div style={{position: 'absolute', right: 60 * S, bottom: (V ? 70 : 50) * S, transform: `translateX(${(1 - toast) * 700 * S}px)`,
            background: C.ink, color: '#fff', borderRadius: 16 * S, padding: `${16 * S}px ${22 * S}px`, display: 'flex', gap: 14 * S, alignItems: 'center',
            boxShadow: `0 ${20 * S}px ${40 * S}px rgba(0,0,0,.35)`, zIndex: 5}}>
            <div style={{width: 48 * S, height: 48 * S, borderRadius: 12 * S, background: C.green, display: 'flex', alignItems: 'center', justifyContent: 'center'}}>
              <Icon name="phone" size={30 * S} />
            </div>
            <div>
              <div style={{fontSize: 18 * S, color: C.soft}}>Paiement Mobile Money reçu</div>
              <div style={{fontSize: 26 * S, fontWeight: 800}}>+ 250 000 FCFA</div>
            </div>
          </div>
        </div>
      </div>
    </AbsoluteFill>
  );
};

/* ======================= SCÈNE 4 : LES FONCTIONNALITÉS ======================= */
const FEATS = [
  {t: 'Facturation', icon: 'invoice', at: T.f1},
  {t: 'Stocks', icon: 'box', at: T.f2},
  {t: 'Paie', icon: 'people', at: T.f3},
  {t: 'Comptabilité SYSCOHADA', icon: 'chart', at: T.f4},
  {t: 'Mobile Money', icon: 'phone', at: T.f5},
  {t: 'Sécurité 2FA', icon: 'lock', at: T.f6},
];
const Features: React.FC = () => {
  const f = useCurrentFrame();
  const {W, S, V, fps} = useLayout();
  const cx = W / 2;
  const cy = (V ? 1010 : 585) * S;
  const rx = (V ? 360 : 600) * S;
  const ry = (V ? 400 : 255) * S;
  const squeeze = 1 - 0.12 * ramp(f, T.seul, T.seul + 14, Easing.inOut(Easing.cubic));
  const rot = (f - T.s4) * 0.12;
  const hub = spring({frame: f - T.s4 - 2, fps, config: {damping: 11, stiffness: 120}});
  const lastPop = [...FEATS].reverse().find((x) => f >= x.at)?.at ?? -99;
  const ripple = ramp(f, lastPop, lastPop + 18);
  const nodes = FEATS.map((n, i) => {
    const a = ((-90 + i * 60 + rot) * Math.PI) / 180;
    return {...n, x: cx + Math.cos(a) * rx * squeeze, y: cy + Math.sin(a) * ry * squeeze, p: spring({frame: f - n.at, fps, config: {damping: 10, stiffness: 160, mass: 0.6}})};
  });
  const hlw = ramp(f, T.seul + 4, T.seul + 18, Easing.inOut(Easing.cubic));
  return (
    <AbsoluteFill style={{fontFamily: FONT}}>
      <div style={{position: 'absolute', top: (V ? 240 : 50) * S, width: '100%', textAlign: 'center'}}>
        <Words text="Tout votre business," start={T.business} style={{color: '#fff', fontWeight: 800, fontSize: (V ? 80 : 76) * S}} />
        <div style={{display: 'flex', justifyContent: 'center'}}>
          <div style={{position: 'relative', padding: `0 ${20 * S}px`}}>
            <div style={{position: 'absolute', inset: `${10 * S}px 0 ${6 * S}px`, background: `linear-gradient(90deg, ${C.orange}, ${C.orange2})`, borderRadius: 14 * S,
              transform: `scaleX(${hlw})`, transformOrigin: 'left'}} />
            <Words text="dans un seul outil" start={T.seul} style={{position: 'relative', color: '#fff', fontWeight: 900, fontSize: (V ? 84 : 80) * S}} />
          </div>
        </div>
      </div>
      <svg width={W} height={(V ? 1920 : 1080) * S} style={{position: 'absolute', left: 0, top: 0}}>
        {nodes.map((n, i) => {
          const len = Math.hypot(n.x - cx, n.y - cy);
          const dr = ramp(f, n.at - 4, n.at + 8);
          return <line key={i} x1={cx} y1={cy} x2={n.x} y2={n.y} stroke={C.orange2} strokeWidth={3 * S} strokeOpacity={0.6}
            strokeDasharray={`${len} ${len}`} strokeDashoffset={len * (1 - dr)} />;
        })}
      </svg>
      <div style={{position: 'absolute', left: cx, top: cy, transform: 'translate(-50%,-50%)', display: 'flex', alignItems: 'center', justifyContent: 'center'}}>
        <div style={{position: 'absolute', width: 400 * S * ripple, height: 400 * S * ripple, borderRadius: '50%', border: `${3 * S}px solid ${C.orange2}`, opacity: 1 - ripple}} />
        <div style={{transform: `scale(${hub * (1 + (1 - ripple) * 0.08)})`}}>
          <Mark size={150 * S} at={T.s4} />
        </div>
      </div>
      {nodes.map((n, i) => (
        <div key={i} style={{position: 'absolute', left: n.x, top: n.y, transform: `translate(-50%,-50%) scale(${n.p})`, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12 * S, opacity: Math.min(1, n.p * 2)}}>
          <div style={{width: 112 * S, height: 112 * S, borderRadius: 30 * S, background: 'rgba(255,255,255,.1)', border: `${2 * S}px solid rgba(255,255,255,.25)`,
            display: 'flex', alignItems: 'center', justifyContent: 'center', backdropFilter: 'blur(6px)'}}>
            <Icon name={n.icon} size={58 * S} color={C.orange2} />
          </div>
          <div style={{color: '#fff', fontWeight: 800, fontSize: 30 * S, whiteSpace: 'nowrap', textShadow: '0 4px 20px rgba(0,0,0,.4)'}}>{n.t}</div>
        </div>
      ))}
    </AbsoluteFill>
  );
};

/* ======================= SCÈNE 5 : VALEURS ======================= */
const Values: React.FC = () => {
  const f = useCurrentFrame();
  const {W, H, S, V, fps} = useLayout();
  const R = Math.hypot(W, H);
  const circ = (at: number, col: string) => {
    const p = ramp(f, at - 4, at + 12, Easing.inOut(Easing.cubic));
    return <div style={{position: 'absolute', left: W / 2 - (R * p) / 2, top: H / 2 - (R * p) / 2, width: R * p, height: R * p, borderRadius: '50%', background: col}} />;
  };
  const words = [
    {w: 'Simple.', at: T.simple, c: '#fff'}, {w: 'Sûr.', at: T.sur, c: '#fff'}, {w: 'Fiable.', at: T.fiable, c: C.navy},
  ];
  const asm = ramp(f, T.assemble, T.assemble + 16, Easing.inOut(Easing.cubic));
  const cur = [...words].reverse().find((x) => f >= x.at);
  return (
    <AbsoluteFill style={{fontFamily: FONT, background: C.navy}}>
      {circ(T.sur, C.orange)}
      {circ(T.fiable, '#fff')}
      <AbsoluteFill style={{alignItems: 'center', justifyContent: 'center'}}>
        {asm < 0.01 && cur && (() => {
          const p = spring({frame: f - cur.at, fps, config: {damping: 9, stiffness: 220, mass: 0.6}});
          return <div style={{fontSize: (V ? 240 : 300) * S, fontWeight: 900, color: cur.c, transform: `scale(${2.2 - 1.2 * p})`, opacity: Math.min(1, p * 1.5), letterSpacing: '-0.03em'}}>{cur.w}</div>;
        })()}
        {asm >= 0.01 && (
          <div style={{display: 'flex', flexDirection: V ? 'column' : 'row', alignItems: 'center', gap: (V ? 0 : 50) * S}}>
            {words.map((w, i) => {
              const p = spring({frame: f - T.assemble - i * 4, fps, config: {damping: 12, stiffness: 160}});
              return <div key={i} style={{fontSize: (V ? 170 : 160) * S, fontWeight: 900, color: i === 1 ? C.orange : C.navy, opacity: p, transform: `translateY(${(1 - p) * 80 * S}px)`, letterSpacing: '-0.03em'}}>{w.w}</div>;
            })}
          </div>
        )}
      </AbsoluteFill>
    </AbsoluteFill>
  );
};

/* ======================= SCÈNE 6 : APPEL À L'ACTION ======================= */
const Cta: React.FC = () => {
  const f = useCurrentFrame();
  const {S, V, fps} = useLayout();
  const url = 'kayelygroup.com';
  const pill = spring({frame: f - T.url + 6, fps, config: {damping: 12, stiffness: 140}});
  const typed = Math.floor(interpolate(f, [T.url, T.url + 26], [0, url.length], clamp));
  const caret = f < T.url + 34 ? (Math.floor(f / 8) % 2 ? 1 : 0) : 0;
  const pulse = f > T.url + 30 ? Math.sin((f - T.url - 30) / 6) * 0.5 + 0.5 : 0;
  const rings = [0, 1, 2].map((i) => {
    const p = ((f - T.cta + i * 20) % 60) / 60;
    return <div key={i} style={{position: 'absolute', width: 260 * S + p * 700 * S, height: 260 * S + p * 700 * S, borderRadius: '50%', border: `${2 * S}px solid rgba(255,169,77,${0.4 * (1 - p)})`}} />;
  });
  return (
    <AbsoluteFill style={{fontFamily: FONT, alignItems: 'center', justifyContent: 'center'}}>
      <div style={{position: 'absolute', top: (V ? 560 : 250) * S, display: 'flex', alignItems: 'center', justifyContent: 'center'}}>{f > T.cta && rings}</div>
      <div style={{display: 'flex', flexDirection: 'column', alignItems: 'center', marginTop: (V ? -260 : 0) * S}}>
        <Logo w={(V ? 840 : 880) * S} at={T.cta} wordAt={T.cta + 8} />
        <Words text="Gérez mieux. Grandissez plus vite." start={T.cta + 22} stagger={2} hl={['Grandissez', 'plus', 'vite.']} style={{color: '#fff', fontSize: (V ? 50 : 46) * S, fontWeight: 600, marginTop: 36 * S, maxWidth: 940 * S}} />
        <div style={{marginTop: 56 * S, transform: `scale(${pill * (1 + pulse * 0.03)})`, opacity: Math.min(1, pill * 2), position: 'relative', overflow: 'hidden',
          background: `linear-gradient(90deg, ${C.orange}, ${C.orange2})`, borderRadius: 999, padding: `${26 * S}px ${64 * S}px`,
          boxShadow: `0 ${24 * S}px ${(60 + pulse * 40) * S}px rgba(232,114,12,${0.45 + pulse * 0.2})`}}>
          <div style={{color: '#fff', fontWeight: 800, fontSize: (V ? 64 : 60) * S, whiteSpace: 'pre', minWidth: url.length * 0.56 * (V ? 64 : 60) * S}}>
            {url.slice(0, typed)}<span style={{opacity: caret}}>|</span>
          </div>
          <Sweep at={T.url + 34} dur={26} />
        </div>
        <div style={{display: 'flex', flexDirection: V ? 'column' : 'row', alignItems: 'center', gap: (V ? 18 : 40) * S, marginTop: 40 * S}}>
          {[{icon: 'call', t: '05 00 70 65 60'}, {icon: 'mail', t: 'contact@kayelygroup.com'}].map((c, i) => {
            const p = spring({frame: f - T.contact - i * 6, fps, config: {damping: 13, stiffness: 150}});
            return (
              <div key={c.t} style={{display: 'flex', alignItems: 'center', gap: 16 * S, opacity: Math.min(1, p * 1.5), transform: `translateY(${(1 - p) * 40 * S}px)`,
                background: 'rgba(255,255,255,.08)', border: `${2 * S}px solid rgba(255,255,255,.18)`, borderRadius: 999, padding: `${12 * S}px ${30 * S}px ${12 * S}px ${14 * S}px`}}>
                <div style={{width: 54 * S, height: 54 * S, borderRadius: 99, background: `linear-gradient(135deg, ${C.orange}, ${C.orange2})`, display: 'flex', alignItems: 'center', justifyContent: 'center'}}>
                  <Icon name={c.icon} size={30 * S} />
                </div>
                <div style={{color: '#fff', fontWeight: 800, fontSize: (V ? 44 : 38) * S, whiteSpace: 'nowrap', letterSpacing: i === 0 ? '0.03em' : 0}}>{c.t}</div>
              </div>
            );
          })}
        </div>
        <Words text="Demandez votre démo dès aujourd'hui" start={T.demo} stagger={2} style={{color: C.soft, fontSize: (V ? 42 : 38) * S, fontWeight: 500, marginTop: 34 * S}} />
      </div>
    </AbsoluteFill>
  );
};


/* Sous-titres animés (style réseaux sociaux) */
type Cap = {w: string; s: number; e: number; line: number};
const GROUPS: Cap[][] = (() => {
  const g: Cap[][] = [];
  let cur: Cap[] = [];
  (CAPS as Cap[]).forEach((c, i, a) => {
    if (cur.length && (cur[0].line !== c.line || cur.length >= 3)) { g.push(cur); cur = []; }
    cur.push(c);
    if (/[.,…:!?]$/.test(c.w) && cur.length >= 2) { g.push(cur); cur = []; }
    if (i === a.length - 1 && cur.length) g.push(cur);
  });
  return g;
})();
const Captions: React.FC = () => {
  const f = useCurrentFrame();
  const {W, H, S, V, fps} = useLayout();
  const tall = H / W > 1.5;
  const gi = GROUPS.findIndex((g, i) => {
    const nxt = GROUPS[i + 1];
    const end = Math.min(g[g.length - 1].e + 10, nxt && nxt[0].line === g[0].line ? nxt[0].s : 9999);
    return f >= g[0].s - 2 && f < end;
  });
  if (gi < 0) return null;
  const g = GROUPS[gi];
  const pop = spring({frame: f - g[0].s + 2, fps, config: {damping: 12, stiffness: 220, mass: 0.5}});
  const size = (V ? 66 : 54) * S;
  return (
    <div style={{position: 'absolute', left: 0, right: 0, bottom: tall ? H * 0.175 : V ? 34 * S : 34 * S, display: 'flex', justifyContent: 'center', zIndex: 45, fontFamily: FONT}}>
      <div style={{display: 'flex', flexWrap: 'wrap', justifyContent: 'center', columnGap: '0.38em', maxWidth: W * 0.9, transform: `scale(${0.85 + 0.15 * pop})`, opacity: Math.min(1, pop * 2),
        fontSize: size, fontWeight: 900, lineHeight: 1.15, textAlign: 'center'}}>
        {g.map((c, i) => {
          const on = f >= c.s && f < (g[i + 1]?.s ?? c.e + 10);
          const k = on ? spring({frame: f - c.s, fps, config: {damping: 10, stiffness: 260, mass: 0.4}}) : 0;
          return (
            <span key={i} style={{display: 'inline-block', color: on ? C.orange2 : '#fff', transform: `scale(${1 + 0.05 * k}) translateY(${-5 * k * S}px)`,
              WebkitTextStroke: `${size * 0.16}px ${C.deep}`, paintOrder: 'stroke fill', textShadow: `0 ${6 * S}px ${18 * S}px rgba(0,0,0,.55)`}}>{c.w}</span>
          );
        })}
      </div>
    </div>
  );
};

/* Petit logo en coin pendant les scènes centrales */
const Corner: React.FC = () => {
  const f = useCurrentFrame();
  const {S, V} = useLayout();
  const o = ramp(f, T.s2 + 10, T.s2 + 24) * (1 - ramp(f, T.s5 - 14, T.s5 - 2));
  if (o <= 0) return null;
  return (
    <div style={{position: 'absolute', top: (V ? 120 : 40) * S, left: (V ? 60 : 50) * S, display: 'flex', alignItems: 'center', gap: 14 * S, opacity: o * 0.9, fontFamily: FONT, zIndex: 40}}>
      <Img src={staticFile('logo-white.png')} style={{height: 54 * S, width: 54 * S * LOGO_R}} />
    </div>
  );
};

/* ======================= COMPOSITION ======================= */
const Show: React.FC<{a: number; b: number; children: React.ReactNode}> = ({a, b, children}) => {
  const f = useCurrentFrame();
  return f >= a && f < b ? <>{children}</> : null;
};
export const Pub: React.FC = () => {
  const f = useCurrentFrame();
  return (
    <AbsoluteFill style={{background: C.deep}}>
      <Background />
      <Show a={0} b={T.s2}><Intro /></Show>
      <Show a={T.s2} b={T.s3}><Problem /></Show>
      <Show a={T.s3} b={T.s4}><Product /></Show>
      <Show a={T.s4} b={T.s5}><Features /></Show>
      <Show a={T.s5} b={T.s6}><Values /></Show>
      <Show a={T.s6} b={9999}><Cta /></Show>
      <Corner />
      <Captions />
      <Wipe at={T.s2} />
      <Wipe at={T.s3} />
      <Wipe at={T.s4} />
      <Wipe at={T.s5} color={C.orange2} second={C.navy} />
      <Wipe at={T.s6} color={C.orange} second={C.deep} />
      <AbsoluteFill style={{background: C.deep, opacity: ramp(f, 948, 960), pointerEvents: 'none', zIndex: 60}} />
      <Audio src={staticFile('mix.m4a')} />
    </AbsoluteFill>
  );
};
