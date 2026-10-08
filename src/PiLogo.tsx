/** Pi Agent's pixel mark, kept as a vector so it stays sharp at desktop scale. */
export function PiLogo({ size = 24, className }: { size?: number; className?: string }) {
  return (
    <svg
      className={`pi-logo ${className ?? ""}`}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="currentColor"
      shapeRendering="crispEdges"
      aria-hidden="true"
      focusable="false"
    >
      <path fillRule="evenodd" d="M0 0h18v12h-6v6H6v6H0V0Zm6 6v6h6V6H6Zm12 6h6v12h-6V12Z" />
    </svg>
  );
}
