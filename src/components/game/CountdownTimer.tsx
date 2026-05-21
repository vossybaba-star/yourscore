"use client";

import { useEffect, useState, useRef } from "react";

interface CountdownTimerProps {
  totalSeconds: number;
  startTime: Date;
  onExpire: () => void;
  size?: number;
}

export function CountdownTimer({
  totalSeconds,
  startTime,
  onExpire,
  size = 80,
}: CountdownTimerProps) {
  const [remaining, setRemaining] = useState(totalSeconds);
  const expiredRef = useRef(false);
  const radius = (size / 2) * 0.82;
  const circumference = 2 * Math.PI * radius;

  useEffect(() => {
    expiredRef.current = false;

    function tick() {
      const elapsed = (Date.now() - startTime.getTime()) / 1000;
      const left = Math.max(0, totalSeconds - elapsed);
      setRemaining(left);

      if (left <= 0 && !expiredRef.current) {
        expiredRef.current = true;
        onExpire();
      }
    }

    tick();
    const iv = setInterval(tick, 100);
    return () => clearInterval(iv);
  }, [startTime, totalSeconds, onExpire]);

  const displaySeconds = Math.ceil(remaining);
  const progress = remaining / totalSeconds;
  const dashOffset = circumference * (1 - progress);

  const color =
    remaining <= 5
      ? "#ff4757"
      : remaining <= 15
      ? "#ffb800"
      : "#00ff87";

  const pulse = remaining <= 5 && remaining > 0;

  return (
    <div
      className="relative flex items-center justify-center flex-shrink-0"
      style={{ width: size, height: size }}
    >
      <svg
        width={size}
        height={size}
        viewBox={`0 0 ${size} ${size}`}
        className="-rotate-90"
        style={pulse ? { animation: "pulse 0.5s ease-in-out infinite" } : undefined}
      >
        {/* Track */}
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke="rgba(255,255,255,0.06)"
          strokeWidth={size * 0.07}
        />
        {/* Progress */}
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke={color}
          strokeWidth={size * 0.07}
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={dashOffset}
          style={{ transition: "stroke 0.4s ease, stroke-dashoffset 0.1s linear" }}
        />
      </svg>
      <span
        className="absolute font-display leading-none"
        style={{
          fontSize: size * 0.35,
          color,
          transition: "color 0.4s ease",
        }}
      >
        {displaySeconds}
      </span>
    </div>
  );
}
