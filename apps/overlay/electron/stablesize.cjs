// Panel windows follow their content's size – but every resize of a transparent window flashes
// briefly, and in VR (fixed width in metres) a texture a few pixels wider shrinks the whole panel.
// Content size jitters all the time (a longer name, a wider number, a row coming and going):
// sizes go in steps, grow at once (nothing cut off) and shrink only once the content has stayed
// smaller for a while (panels flickered and changed size slightly, 12.10.2026).

/**
 * `step`: size grid in px; `shrinkMs`: how long the content must stay smaller before shrinking.
 * `next(w, h, now)` -> the size to use, or null if the current one stays.
 */
function stableSize({ step, shrinkMs }) {
  let cur = null; // { w, h }
  let smallerSince = null;
  const up = (v) => Math.max(step, Math.ceil(v / step) * step);
  return {
    next(w, h, now = Date.now()) {
      const want = { w: up(w), h: up(h) };
      if (!cur) return (cur = want);
      const grow = want.w > cur.w || want.h > cur.h;
      const shrink = want.w < cur.w || want.h < cur.h;
      if (!shrink) smallerSince = null;
      else if (smallerSince === null) smallerSince = now;
      const shrinkNow = shrink && now - smallerSince >= shrinkMs;
      if (!grow && !shrinkNow) return null;
      // Growing one side keeps the other until it may shrink.
      cur = shrinkNow ? want : { w: Math.max(cur.w, want.w), h: Math.max(cur.h, want.h) };
      if (shrinkNow) smallerSince = null;
      return cur;
    },
    /** Content smaller than the size in use: when to ask `next` again (ms), null if not waiting. */
    pending(now = Date.now()) {
      return smallerSince === null ? null : Math.max(0, smallerSince + shrinkMs - now);
    },
    reset() { cur = null; smallerSince = null; },
  };
}

module.exports = { stableSize };
