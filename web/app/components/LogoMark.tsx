// The logo's lime and blue are fixed brand colors (hq/brand/README.md), so they
// do not follow the theme tokens.
export function LogoMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 100 100" aria-hidden="true" className={className}>
      <rect width="100" height="100" fill="#E0FF4F" />
      <path
        fill="#1E40FF"
        fillRule="evenodd"
        d="M14 7H48A38 38 0 0 1 48 83H36L14 93ZM32 27H48A18 18 0 0 1 48 63H32Z"
      />
    </svg>
  );
}
