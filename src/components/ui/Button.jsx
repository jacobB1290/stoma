import { forwardRef } from "react";

const VARIANT = {
  primary: "bg-[var(--primary,#16525F)] hover:bg-[var(--primary-hover,#0d3b46)] text-white",
  secondary: "border border-[var(--border,#d1d5db)] bg-[var(--surface,white)] text-[var(--text,#111827)] hover:bg-[var(--hover-bg,#f3f4f6)]",
  ghost: "bg-transparent text-[var(--text,#111827)] hover:bg-[var(--hover-bg,rgba(0,0,0,0.06))]",
  danger: "bg-[#dc2626] hover:bg-[#b91c1c] text-white",
};
const SIZE = {
  sm: "px-2.5 py-1 text-xs rounded-md",
  md: "px-3 py-1.5 text-sm rounded-lg",
  lg: "px-4 py-2 text-base rounded-lg",
};
const Button = forwardRef(function Button(
  { variant = "primary", size = "md", className = "", type = "button", children, ...rest },
  ref
) {
  return (
    <button
      ref={ref}
      type={type}
      className={`inline-flex items-center justify-center gap-1.5 font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-[var(--primary,#16525F)] ${VARIANT[variant]} ${SIZE[size]} ${className}`}
      {...rest}
    >
      {children}
    </button>
  );
});
export default Button;
