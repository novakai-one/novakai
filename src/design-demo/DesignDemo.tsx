// ─────────────────────────────────────────────────────────────────────────────
// DesignDemo — a throwaway VISUAL CONCEPT, not real app code.
// Imports NOTHING from the rest of the project. All styles are scoped under
// `.dd-root` and every class / keyframe is prefixed `dd-`, so it cannot leak
// into or clash with your real app. Delete this folder to remove completely.
//
// Concept on show:
//   1. Canvas-first  → blocks float in space, not in a scrolling column
//   2. AI-as-cursor  → one intent bar; type, it spawns a card that "settles" in
//   3. OMG layer     → depth, a signature gradient glow, soft motion
// ─────────────────────────────────────────────────────────────────────────────
import { useState } from 'react'

type Card = {
    id: number
    title: string
    body: string
    x: number
    y: number
    accent: string
}

const ACCENTS = ['#7C5CFF', '#3DD6C4', '#FF7A9C', '#FFC857', '#5AA9FF']

const SEED: Card[] = [
    { id: 1, title: 'Today', body: 'Ship the canvas prototype. Tag @self when the settle animation feels right.', x: 8, y: 18, accent: ACCENTS[0] },
    { id: 2, title: 'Tasks · live', body: '3 open · 1 blocked\nThis card rewrites itself when the table changes.', x: 40, y: 30, accent: ACCENTS[1] },
    { id: 3, title: 'Idea', body: 'What if "/" wasn\'t a block menu but an intent bar?', x: 70, y: 14, accent: ACCENTS[2] },
    { id: 4, title: 'Note', body: 'Zoom out = see your whole brain.\nZoom in = edit.', x: 24, y: 60, accent: ACCENTS[4] },
]

export default function DesignDemo() {
    const [cards, setCards] = useState<Card[]>(SEED)
    const [intent, setIntent] = useState('')
    const [focused, setFocused] = useState(false)

    function runIntent() {
        const text = intent.trim()
        if (!text) return
        const id = Date.now()
        const next: Card = {
            id,
            title: text.length > 28 ? text.slice(0, 28) + '…' : text,
            body: 'AI dropped this card where you were looking. (Demo — wire a real model in later.)',
            // spawn near the middle, with a little scatter
            x: 38 + (Math.random() * 16 - 8),
            y: 44 + (Math.random() * 12 - 6),
            accent: ACCENTS[id % ACCENTS.length],
        }
        setCards(c => [...c, next])
        setIntent('')
    }

    return (
        <div className="dd-root">
            <style>{CSS}</style>

            {/* signature gradient glow — the screenshot moment */}
            <div className="dd-glow dd-glow-a" />
            <div className="dd-glow dd-glow-b" />
            <div className="dd-grid" />

            {/* wordmark */}
            <div className="dd-mark">
                <span className="dd-dot" />
                react-dev <span className="dd-mark-sub">canvas</span>
            </div>

            <div className="dd-hint">concept preview · not your real app · add <code>?demo</code> to URL to see this</div>

            {/* the canvas */}
            <div className="dd-canvas">
                {cards.map(card => (
                    <article
                        key={card.id}
                        className="dd-card"
                        style={{ left: `${card.x}%`, top: `${card.y}%`, ['--accent' as string]: card.accent }}
                    >
                        <header className="dd-card-head">
                            <span className="dd-chip" />
                            {card.title}
                        </header>
                        <p className="dd-card-body">{card.body}</p>
                    </article>
                ))}
            </div>

            {/* intent bar — AI lives where you're looking, not in a drawer */}
            <div className={`dd-bar ${focused ? 'dd-bar-on' : ''}`}>
                <span className="dd-slash">/</span>
                <input
                    className="dd-input"
                    value={intent}
                    placeholder="what are we building today?"
                    onChange={e => setIntent(e.target.value)}
                    onFocus={() => setFocused(true)}
                    onBlur={() => setFocused(false)}
                    onKeyDown={e => { if (e.key === 'Enter') runIntent() }}
                />
                <button className="dd-go" onClick={runIntent}>↵ spawn</button>
            </div>
        </div>
    )
}

const CSS = `
.dd-root {
    position: fixed; inset: 0; overflow: hidden;
    background: #0B0B12;
    color: #ECECF4;
    font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif;
    z-index: 9999;
}
.dd-grid {
    position: absolute; inset: 0;
    background-image:
        linear-gradient(rgba(255,255,255,.035) 1px, transparent 1px),
        linear-gradient(90deg, rgba(255,255,255,.035) 1px, transparent 1px);
    background-size: 46px 46px;
    mask-image: radial-gradient(circle at 50% 45%, #000 35%, transparent 80%);
    pointer-events: none;
}
.dd-glow { position: absolute; border-radius: 50%; filter: blur(80px); opacity: .55; pointer-events: none; }
.dd-glow-a { width: 540px; height: 540px; left: -120px; top: -160px;
    background: radial-gradient(circle, #7C5CFF, transparent 70%); animation: dd-float 14s ease-in-out infinite; }
.dd-glow-b { width: 600px; height: 600px; right: -160px; bottom: -200px;
    background: radial-gradient(circle, #3DD6C4, transparent 70%); animation: dd-float 18s ease-in-out infinite reverse; }

.dd-mark { position: absolute; top: 22px; left: 24px; font-weight: 700; letter-spacing: -.02em;
    font-size: 15px; display: flex; align-items: center; gap: 8px; z-index: 2; }
.dd-dot { width: 9px; height: 9px; border-radius: 50%;
    background: linear-gradient(135deg, #7C5CFF, #FF7A9C); box-shadow: 0 0 14px #7C5CFF; }
.dd-mark-sub { opacity: .45; font-weight: 500; }
.dd-hint { position: absolute; top: 24px; right: 24px; font-size: 11px; opacity: .4; z-index: 2; }
.dd-hint code { background: rgba(255,255,255,.08); padding: 1px 5px; border-radius: 4px; }

.dd-canvas { position: absolute; inset: 0; z-index: 1; }

.dd-card {
    position: absolute; width: 250px;
    padding: 16px 16px 18px;
    border-radius: 16px;
    background: rgba(22,22,32,.6);
    border: 1px solid rgba(255,255,255,.08);
    border-top: 1px solid rgba(255,255,255,.16);
    backdrop-filter: blur(14px);
    box-shadow: 0 18px 50px -12px rgba(0,0,0,.7), 0 0 0 1px rgba(255,255,255,.02) inset;
    animation: dd-settle .5s cubic-bezier(.2,.9,.25,1.1) both;
    transition: transform .18s ease, box-shadow .18s ease;
    cursor: grab;
}
.dd-card:hover { transform: translateY(-4px) scale(1.015);
    box-shadow: 0 26px 60px -10px rgba(0,0,0,.75), 0 0 26px -6px var(--accent); }
.dd-card-head { display: flex; align-items: center; gap: 8px; font-weight: 650; font-size: 13.5px; margin-bottom: 8px; }
.dd-chip { width: 8px; height: 8px; border-radius: 3px; background: var(--accent); box-shadow: 0 0 10px var(--accent); }
.dd-card-body { margin: 0; font-size: 12.5px; line-height: 1.5; opacity: .72; white-space: pre-line; }

.dd-bar {
    position: absolute; left: 50%; bottom: 38px; transform: translateX(-50%);
    display: flex; align-items: center; gap: 10px;
    width: min(560px, 86vw); padding: 12px 12px 12px 16px;
    border-radius: 16px; z-index: 3;
    background: rgba(20,20,30,.78); backdrop-filter: blur(18px);
    border: 1px solid rgba(255,255,255,.1);
    box-shadow: 0 18px 50px -14px rgba(0,0,0,.8);
    transition: border-color .2s ease, box-shadow .2s ease;
}
.dd-bar-on { border-color: rgba(124,92,255,.7);
    box-shadow: 0 18px 60px -12px rgba(124,92,255,.45), 0 0 0 4px rgba(124,92,255,.12); }
.dd-slash { font-weight: 800; opacity: .5; font-size: 18px; }
.dd-input { flex: 1; background: transparent; border: none; outline: none; color: #fff;
    font-size: 14.5px; font-family: inherit; }
.dd-input::placeholder { color: rgba(255,255,255,.38); }
.dd-go { border: none; cursor: pointer; font-family: inherit; font-size: 12.5px; font-weight: 650;
    color: #0B0B12; padding: 9px 14px; border-radius: 10px;
    background: linear-gradient(135deg, #7C5CFF, #3DD6C4); }
.dd-go:hover { filter: brightness(1.08); }

@keyframes dd-settle {
    0%   { opacity: 0; transform: translateY(18px) scale(.92); filter: blur(6px); }
    100% { opacity: 1; transform: translateY(0) scale(1); filter: blur(0); }
}
@keyframes dd-float {
    0%,100% { transform: translate(0,0); }
    50%     { transform: translate(30px, 26px); }
}
`
