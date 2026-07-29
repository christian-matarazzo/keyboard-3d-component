/**
 * Curve di interpolazione per gli step a durata esplicita (fade, offset).
 *
 * NON riguardano le pose né il focus: quelli sono guidati dalla molla e dallo
 * smorzamento `maath` di useComposerControls.js, che hanno un "feel" proprio e
 * non un tempo. Qui si tratta solo di come un valore scalare va da A a B in
 * `duration` secondi.
 */

export const EASINGS = {
  linear: (t) => t,
  easeInQuad: (t) => t * t,
  easeOutQuad: (t) => t * (2 - t),
  easeInOutQuad: (t) => (t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t),
  easeInCubic: (t) => t * t * t,
  easeOutCubic: (t) => 1 - (1 - t) ** 3,
  easeInOutCubic: (t) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2),
  easeOutBack: (t) => {
    const c1 = 1.70158
    const c3 = c1 + 1
    return 1 + c3 * (t - 1) ** 3 + c1 * (t - 1) ** 2
  },
}

export const EASING_NAMES = Object.keys(EASINGS)

export const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v)

/** Applica la curva per nome; un nome sconosciuto ricade su `linear`. */
export function ease(name, t) {
  const fn = EASINGS[name] ?? EASINGS.linear
  return fn(clamp01(t))
}
