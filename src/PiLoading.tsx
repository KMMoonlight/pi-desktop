/** Compact falling-block adaptation of the colored mark at https://pi.dev/. */
export function PiLoading() {
  return (
    <svg className="pi-loading" width="20" height="20" viewBox="0 0 24 24" aria-hidden="true" focusable="false" shapeRendering="crispEdges">
      <path className="pi-loading-left" fill="#4D9ABF" d="M0 6h6v6h6v6H6v6H0Z" />
      <path className="pi-loading-top" fill="#F09082" d="M0 0h18v12h-6V6H0Z" />
      <path className="pi-loading-right" fill="#F1BE58" d="M18 12h6v12h-6Z" />
    </svg>
  );
}
