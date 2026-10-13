"use client";

import { useRef, useState } from "react";
import { SUPPORT } from "@/lib/support";

const TIERS = [
  { amt: 3, label: "a kopi", title: "One kopi", desc: "An evening of fixing bugs", ico: "☕" },
  { amt: 6, label: "kopi and kaya toast", title: "Kopi + kaya toast", desc: "Keeps the daily data fresh", ico: "🍞" },
  { amt: 15, label: "a week of kopi", title: "A week of kopi", desc: "Funds the next feature", ico: "🗓️" },
];

/** A value with a Copy button. Falls back to selecting the text; messages are shown inline, never in a dialog. */
export function CopyBox({ label, value, placeholder }: { label: string; value: string; placeholder?: string }) {
  const codeRef = useRef<HTMLElement>(null);
  const [text, setText] = useState("Copy");
  if (!value && !placeholder) return null;
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setText("Copied");
    } catch {
      const sel = window.getSelection();
      if (codeRef.current && sel) {
        const r = document.createRange();
        r.selectNodeContents(codeRef.current);
        sel.removeAllRanges();
        sel.addRange(r);
      }
      setText("Selected, press copy");
    }
    window.setTimeout(() => setText("Copy"), 1800);
  };
  return (
    <div className="paynow">
      <span>
        <strong>{label}</strong>
      </span>
      <code ref={codeRef}>{value || placeholder}</code>
      {value ? (
        <button className="btn" type="button" onClick={copy} aria-live="polite">
          {text}
        </button>
      ) : null}
    </div>
  );
}

/** Tip tiers and the Buy Me a Coffee button. With no username set, the button is switched off and says why. */
export function KopiTiers() {
  const [picked, setPicked] = useState(1);
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const tier = TIERS[picked];
  const ready = !!SUPPORT.bmcUsername;
  const move = (e: React.KeyboardEvent, i: number) => {
    const step = e.key === "ArrowDown" || e.key === "ArrowRight" ? 1 : e.key === "ArrowUp" || e.key === "ArrowLeft" ? -1 : 0;
    if (!step) return;
    e.preventDefault();
    const next = (i + step + TIERS.length) % TIERS.length;
    setPicked(next);
    refs.current[next]?.focus();
  };
  return (
    <>
      <div className="tiers" role="radiogroup" aria-label="Choose a treat">
        {TIERS.map((t, i) => (
          <button
            key={t.amt}
            ref={(el) => {
              refs.current[i] = el;
            }}
            className="tier"
            type="button"
            role="radio"
            aria-checked={i === picked}
            tabIndex={i === picked ? 0 : -1}
            onClick={() => setPicked(i)}
            onKeyDown={(e) => move(e, i)}
          >
            <span className="ico" aria-hidden="true">
              {t.ico}
            </span>
            <span>
              <span className="t">{t.title}</span>
              <br />
              <span className="d">{t.desc}</span>
            </span>
            <span className="amt">S${t.amt}</span>
          </button>
        ))}
      </div>
      <div className="give">
        {ready ? (
          <a
            className="btn primary"
            href={"https://www.buymeacoffee.com/" + encodeURIComponent(SUPPORT.bmcUsername)}
            target="_blank"
            rel="noopener"
          >
            Buy me {tier.label} · S${tier.amt}
          </a>
        ) : (
          <span className="btn primary" role="link" aria-disabled="true">
            Buy me {tier.label} · S${tier.amt}
          </span>
        )}
        <p className="small">
          {ready
            ? "Opens Buy Me a Coffee in a new tab. You’ll confirm the amount there."
            : "The tip link is being set up. Check back soon."}
        </p>
        {SUPPORT.paynow ? <CopyBox label="PayNow" value={SUPPORT.paynow} /> : null}
      </div>
    </>
  );
}
