import { motion, useAnimationFrame, useMotionValue, useReducedMotion, useTransform } from "motion/react";
import { useEffect, useRef, useState, type ReactNode } from "react";

interface GradientTextProps {
  children: ReactNode;
  className?: string;
  colors?: string[];
  animationSpeed?: number;
  direction?: "horizontal" | "vertical" | "diagonal";
  pauseOnHover?: boolean;
  yoyo?: boolean;
  showBorder?: boolean;
}

export function GradientText({
  children,
  className = "",
  colors = ["var(--accent)", "var(--info)", "var(--text-secondary)"],
  animationSpeed = 8,
  direction = "horizontal",
  pauseOnHover = false,
  yoyo = true,
  showBorder = false,
}: GradientTextProps) {
  const [hovered, setHovered] = useState(false);
  const [visible, setVisible] = useState(document.visibilityState === "visible");
  const reducedMotion = useReducedMotion();
  const progress = useMotionValue(reducedMotion ? 50 : 0);
  const elapsed = useRef(0);
  const previousTime = useRef<number | null>(null);
  const paused = reducedMotion || !visible || (pauseOnHover && hovered);
  const duration = Math.max(animationSpeed, 0.1) * 1000;

  useEffect(() => {
    const update = () => setVisible(document.visibilityState === "visible");
    document.addEventListener("visibilitychange", update);
    return () => document.removeEventListener("visibilitychange", update);
  }, []);

  useEffect(() => {
    elapsed.current = 0;
    previousTime.current = null;
    progress.set(reducedMotion ? 50 : 0);
  }, [animationSpeed, progress, reducedMotion, yoyo]);

  useAnimationFrame((time) => {
    if (paused) {
      previousTime.current = null;
      return;
    }
    if (previousTime.current === null) {
      previousTime.current = time;
      return;
    }
    elapsed.current += time - previousTime.current;
    previousTime.current = time;
    if (yoyo) {
      const cycle = elapsed.current % (duration * 2);
      progress.set(cycle < duration ? (cycle / duration) * 100 : 100 - ((cycle - duration) / duration) * 100);
    } else {
      progress.set((elapsed.current / duration) * 100);
    }
  });

  const backgroundPosition = useTransform(progress, (value) =>
    direction === "vertical" ? `50% ${value}%` : `${value}% 50%`,
  );
  const angle = direction === "horizontal" ? "to right" : direction === "vertical" ? "to bottom" : "to bottom right";
  const gradient = `linear-gradient(${angle}, ${[...colors, colors[0]].join(", ")})`;
  const backgroundSize = direction === "horizontal" ? "300% 100%" : direction === "vertical" ? "100% 300%" : "300% 300%";

  return (
    <motion.span
      className={`gradient-text${showBorder ? " has-border" : ""}${className ? ` ${className}` : ""}`}
      onHoverStart={() => setHovered(true)}
      onHoverEnd={() => setHovered(false)}
      style={showBorder ? { backgroundImage: gradient, backgroundPosition, backgroundSize } : undefined}
    >
      <motion.span
        className="gradient-text__content"
        style={{ backgroundImage: gradient, backgroundPosition, backgroundSize }}
      >
        {children}
      </motion.span>
    </motion.span>
  );
}
