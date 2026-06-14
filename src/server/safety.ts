/**
 * Lightweight content-safety layer.
 *
 * LoreWeaver is a creative-fiction tool, so it must tolerate dramatic conflict
 * while refusing genuinely harmful requests. This is a defense-in-depth guard
 * applied to *user input* before it reaches any model and to *generated output*
 * before it is returned. It is intentionally conservative and explainable.
 */

export interface SafetyResult {
  ok: boolean;
  reason?: string;
}

// Categories we refuse outright, regardless of "it's just fiction" framing.
const BLOCKED_PATTERNS: { label: string; rx: RegExp }[] = [
  {
    label: 'instructions for real-world weapons or explosives',
    rx: /\b(build|make|synthesi[sz]e|manufacture)\b[^.]{0,40}\b(bomb|explosive|nerve agent|bioweapon|sarin|ricin)\b/i,
  },
  {
    label: 'sexual content involving minors',
    rx: /\b(child|minor|underage|preteen)\b[^.]{0,30}\b(sex|sexual|nude|naked)\b/i,
  },
  {
    label: 'targeted real-world self-harm instructions',
    rx: /\b(how to|best way to)\b[^.]{0,30}\b(kill myself|commit suicide|self-harm)\b/i,
  },
];

// Light prompt-injection screen for the MCP/agent surface.
const INJECTION_PATTERNS: RegExp[] = [
  /ignore (all|previous|prior) (instructions|rules)/i,
  /system prompt/i,
  /reveal your (instructions|system prompt|api key)/i,
];

export function screenInput(text: string): SafetyResult {
  const t = text ?? '';
  for (const { label, rx } of BLOCKED_PATTERNS) {
    if (rx.test(t)) {
      return {
        ok: false,
        reason: `Request blocked: it appears to ask for ${label}. LoreWeaver writes fiction, not real-world harm.`,
      };
    }
  }
  return { ok: true };
}

export function looksLikeInjection(text: string): boolean {
  return INJECTION_PATTERNS.some((rx) => rx.test(text ?? ''));
}

export function screenOutput(text: string): SafetyResult {
  for (const { label, rx } of BLOCKED_PATTERNS) {
    if (rx.test(text ?? '')) {
      return { ok: false, reason: `Generated content withheld (${label}).` };
    }
  }
  return { ok: true };
}
