export default function Skeleton({ className = "", height, width }) {
  return (
    <div
      aria-hidden="true"
      className={`animate-pulse rounded bg-[var(--skeleton-bg,#e5e7eb)] ${className}`}
      style={{ height, width }}
    />
  );
}
