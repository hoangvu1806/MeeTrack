"use client";

import { useEffect, useRef, useState } from "react";
import { MorphIcon, type IconInput } from "morphicons/react";

type UiIconProps = {
  icon: IconInput;
  hoverIcon?: IconInput;
  size?: number;
  strokeWidth?: number;
  className?: string;
  label?: string;
};

export function UiIcon({ icon, hoverIcon, size = 18, strokeWidth = 1.8, className, label }: UiIconProps) {
  const shellRef = useRef<HTMLSpanElement>(null);
  const [hovered, setHovered] = useState(false);

  useEffect(() => {
    if (!hoverIcon) return;
    const owner = shellRef.current?.closest<HTMLElement>("button, a, [role='button']");
    if (!owner) return;

    const enter = () => setHovered(true);
    const leave = () => setHovered(false);
    owner.addEventListener("mouseenter", enter);
    owner.addEventListener("mouseleave", leave);
    owner.addEventListener("focus", enter);
    owner.addEventListener("blur", leave);

    return () => {
      owner.removeEventListener("mouseenter", enter);
      owner.removeEventListener("mouseleave", leave);
      owner.removeEventListener("focus", enter);
      owner.removeEventListener("blur", leave);
    };
  }, [hoverIcon]);

  return (
    <span ref={shellRef} className={`ui-icon-shell${className ? ` ${className}` : ""}`} style={{ width: size, height: size }}>
      <MorphIcon
        icon={hovered && hoverIcon ? hoverIcon : icon}
        size={size}
        strokeWidth={strokeWidth}
        label={label}
        spring="snappy"
        reducedMotion="user"
      />
    </span>
  );
}
