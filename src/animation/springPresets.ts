import type { Transition } from "motion/react";

export type SpringPace = "swift" | "snappy" | "smooth" | "expressive";
export type BounceLevel = "subtle" | "standard" | "lively";

const durationByPace: Record<SpringPace, number> = {
  swift: 0.14,
  snappy: 0.22,
  smooth: 0.36,
  expressive: 0.52,
};

const bounceByLevel: Record<BounceLevel, number> = {
  subtle: 0.15,
  standard: 0.3,
  lively: 0.5,
};

export function springTransition(
  pace: SpringPace,
  bounce: BounceLevel = "standard",
): Transition {
  return {
    type: "spring",
    duration: durationByPace[pace],
    bounce: bounceByLevel[bounce],
  };
}

export function pointerFollowTransition(followDistance = 0): Transition {
  const amount = Math.min(Math.max(followDistance, 0), 300) / 300;
  return {
    type: "spring",
    stiffness: 1700 - amount * 1200,
    damping: 48 - amount * 14,
    mass: 0.36 + amount * 0.34,
    restDelta: 0.12,
    restSpeed: 8,
  };
}

export function selectionTransition(): Transition {
  return {
    type: "tween",
    duration: 0.055,
    ease: "easeOut",
  };
}
