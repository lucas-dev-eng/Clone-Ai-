import React from "react";

interface LogoProps extends React.SVGProps<SVGSVGElement> {
  className?: string;
  style?: React.CSSProperties;
}

export default function Logo({ className = "w-10 h-10", style, ...props }: LogoProps) {
  return (
    <svg
      viewBox="0 0 100 100"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      style={style}
      {...props}
    >
      {/* Esquerda: Face em Teal (#58C7B3) */}
      <path
        d="M 47 10 
           A 40 40 0 0 0 47 90 
           C 45 86, 42 82, 41 78 
           C 40 73, 41 68, 41 65 
           C 39 63, 38 61, 40 59 
           C 41 58, 41 57, 42 56 
           C 39 55, 39 54, 41 53 
           C 42 52, 41 51, 40 50 
           C 39 49, 40 48, 42 47 
           C 43 45, 41 43, 38 42 
           C 36 41, 35 37, 39 26 
           C 42 18, 46 12, 47 10 
           Z"
        fill="#58C7B3"
      />
      {/* Direita: Face em Sand (#D8B07A) */}
      <path
        d="M 53 10 
           A 40 40 0 0 1 53 90 
           C 55 86, 58 82, 59 78 
           C 60 73, 59 68, 59 65 
           C 61 63, 62 61, 60 59 
           C 59 58, 59 57, 58 56 
           C 61 55, 61 54, 59 53 
           C 58 52, 59 51, 60 50 
           C 61 49, 60 48, 58 47 
           C 57 45, 59 43, 62 42 
           C 64 41, 65 37, 61 26 
           C 58 18, 54 12, 53 10 
           Z"
        fill="#D8B07A"
      />
      {/* 3 Pontos Verticais no Centro */}
      <circle cx="50" cy="38" r="3" fill="#58C7B3" />
      <circle cx="50" cy="50" r="3" fill="#D8B07A" />
      <circle cx="50" cy="62" r="3" fill="#58C7B3" />
    </svg>
  );
}
