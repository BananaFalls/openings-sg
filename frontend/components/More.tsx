"use client";

import { useState } from "react";

/**
 * Wraps a list or table whose later items carry className="extra". They stay in the page
 * (so links can be followed) but are hidden until the button is pressed.
 */
export function More({ label, children }: { label: string; children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="more" data-open={open}>
      {children}
      {open ? null : (
        <button className="btn more-btn" type="button" onClick={() => setOpen(true)}>
          {label}
        </button>
      )}
    </div>
  );
}
