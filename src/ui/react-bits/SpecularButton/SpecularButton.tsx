import { useCallback, type ButtonHTMLAttributes, type CSSProperties } from "react";

interface SpecularButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  radius?: number;
  tint?: string;
  textColor?: string;
  lineColor?: string;
  baseColor?: string;
  thickness?: number;
  compact?: boolean;
}

type SpecularStyle = CSSProperties & {
  "--specular-radius": string;
  "--specular-tint": string;
  "--specular-text": string;
  "--specular-line": string;
  "--specular-base": string;
  "--specular-thickness": string;
  "--specular-angle": string;
};

export function SpecularButton({
  radius = 8,
  tint = "var(--surface-2)",
  textColor = "var(--text-secondary)",
  lineColor = "var(--accent)",
  baseColor = "var(--border-strong)",
  thickness = 1,
  compact = false,
  className = "",
  style,
  onPointerMove,
  children,
  ...props
}: SpecularButtonProps) {
  const handlePointerMove = useCallback<NonNullable<SpecularButtonProps["onPointerMove"]>>(
    (event) => {
      const bounds = event.currentTarget.getBoundingClientRect();
      const x = event.clientX - (bounds.left + bounds.width / 2);
      const y = event.clientY - (bounds.top + bounds.height / 2);
      event.currentTarget.style.setProperty("--specular-angle", `${Math.atan2(y, x) * 180 / Math.PI + 90}deg`);
      onPointerMove?.(event);
    },
    [onPointerMove],
  );
  const variables: SpecularStyle = {
    "--specular-radius": `${radius}px`,
    "--specular-tint": tint,
    "--specular-text": textColor,
    "--specular-line": lineColor,
    "--specular-base": baseColor,
    "--specular-thickness": `${thickness}px`,
    "--specular-angle": "18deg",
    ...style,
  };
  return (
    <button
      {...props}
      className={`specular-button${compact ? " is-compact" : ""}${className ? ` ${className}` : ""}`}
      style={variables}
      onPointerMove={handlePointerMove}
    >
      <span className="specular-button__label">{children}</span>
    </button>
  );
}
