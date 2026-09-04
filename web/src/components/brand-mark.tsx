import { cn } from "@/lib/utils";

/*
 * The MostFundable mark: an M whose right leg keeps rising into an arrow, so the
 * letter reads as a climb. Drawn in currentColor on whatever tile holds it, so
 * the sidebar tile, the mobile header and any future favicon all share one
 * shape. Interim mark until brand delivers final artwork.
 */
export function BrandMark({ className }: { className?: string }) {
  return (
    <svg
      aria-hidden
      className={cn("size-4", className)}
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="2.3"
      viewBox="0 0 24 24"
    >
      <path d="M4.5 19V7.5l5 5.5 5-5.5" />
      <path d="M14.5 19V5.2" />
      <path d="M11 8.5l3.5-3.5L18 8.5" />
    </svg>
  );
}
