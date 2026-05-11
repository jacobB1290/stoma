const SIZE = { sm: "h-4 w-4 border-2", md: "h-5 w-5 border-2", lg: "h-8 w-8 border-[3px]" };
export default function Spinner({ size = "md", className = "" }) {
  return (
    <span
      role="status"
      aria-label="Loading"
      className={`inline-block animate-spin rounded-full border-current border-t-transparent ${SIZE[size]} ${className}`}
    />
  );
}
