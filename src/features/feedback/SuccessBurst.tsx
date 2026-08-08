import { useEffect, useState, type CSSProperties } from "react";

interface SuccessBurstProps {
  token: number;
  message: string;
}

export function SuccessBurst({ token, message }: SuccessBurstProps) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (token === 0) return;
    setVisible(true);
    const timer = window.setTimeout(() => setVisible(false), 720);
    return () => window.clearTimeout(timer);
  }, [token]);

  if (!visible) return null;
  return (
    <>
      <div className="success-burst" aria-hidden="true" key={token}>
        {Array.from({ length: 8 }, (_, index) => (
          <i
            key={index}
            style={{ "--particle-index": index } as CSSProperties}
          />
        ))}
      </div>
      <span className="sr-only" role="status">{message}</span>
    </>
  );
}
