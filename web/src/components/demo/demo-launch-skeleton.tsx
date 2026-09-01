import type { ComponentProps, ReactNode } from "react";

import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

const metricWidths = ["w-20", "w-16", "w-24", "w-[4.5rem]"];

function Shape({ className = "", ...props }: ComponentProps<"div">) {
  return (
    <Skeleton
      className={cn(
        "mf-skeleton-shape animate-none bg-[var(--consumer-border)]",
        className,
      )}
      {...props}
    />
  );
}

function HeroShape({ className = "", ...props }: ComponentProps<"div">) {
  return (
    <Skeleton
      className={cn("mf-skeleton-shape animate-none bg-[color-mix(in_srgb,var(--consumer-ink),transparent_90%)]", className)}
      {...props}
    />
  );
}

function Surface({ children }: { children: ReactNode }) {
  return (
    <section className="overflow-hidden rounded-[10px] border border-[var(--consumer-surface-border)] bg-card shadow-[var(--consumer-surface-shadow)]">
      {children}
    </section>
  );
}

export function DemoLaunchSkeleton() {
  return (
    <div
      aria-hidden="true"
      className="mf-launch-skeleton pointer-events-none fixed inset-x-0 bottom-[calc(3.75rem+env(safe-area-inset-bottom))] top-[calc(var(--demo-banner-height)+3.5rem)] z-20 overflow-hidden bg-[var(--consumer-canvas)] opacity-100 lg:bottom-0 lg:left-[17rem] lg:top-[calc(var(--demo-banner-height)+4rem)]"
      data-demo-theme="consumer"
    >
      <div className="mx-auto w-full max-w-[86rem] px-4 py-5 sm:px-6 sm:py-7 xl:px-8 xl:py-8">
        <header className="mb-5 flex flex-col gap-4 border-b border-[var(--consumer-border)] pb-5 sm:mb-6 sm:flex-row sm:items-end sm:justify-between sm:pb-6">
          <div className="min-w-0 space-y-2">
            <Shape className="h-2.5 w-24" />
            <Shape className="h-7 w-56 max-w-[72vw] sm:h-8 sm:w-72" />
          </div>
          <Shape className="h-6 w-24 rounded-md" />
        </header>

        <section className="relative overflow-hidden rounded-[14px] border border-[var(--consumer-border)] bg-[var(--consumer-hero)] shadow-[var(--consumer-surface-shadow)]">
          <span className="absolute inset-x-0 top-0 h-px bg-card/70" />
          <div className="grid lg:min-h-[28rem] lg:grid-cols-[minmax(0,1.08fr)_minmax(20rem,0.92fr)] lg:items-stretch">
            <div className="flex flex-col justify-between px-5 pb-7 pt-6 sm:px-8 sm:pb-8 sm:pt-8 lg:px-7 lg:pb-7 lg:pt-6">
              <div>
                <div className="flex items-center gap-3">
                  <span className="size-2 rounded-full bg-[color-mix(in_srgb,var(--consumer-ink),transparent_88%)]" />
                  <div className="space-y-2">
                    <HeroShape className="h-3 w-32" />
                    <HeroShape className="h-2.5 w-20 bg-[color-mix(in_srgb,var(--consumer-ink),transparent_92%)]" />
                  </div>
                </div>

                <div className="mt-7 space-y-3 lg:mt-5">
                  <HeroShape className="h-9 w-[92%] max-w-md sm:h-11" />
                  <HeroShape className="h-9 w-[68%] max-w-xs sm:h-11" />
                </div>

                <div className="mt-5 space-y-2 lg:mt-4">
                  <HeroShape className="h-3 w-full max-w-xl bg-[color-mix(in_srgb,var(--consumer-ink),transparent_92%)]" />
                  <HeroShape className="h-3 w-[78%] max-w-lg bg-[color-mix(in_srgb,var(--consumer-ink),transparent_92%)]" />
                </div>

                <div className="mt-8 grid border-y border-[var(--consumer-border)] sm:grid-cols-3 lg:mt-6">
                  {[0, 1, 2].map((item) => (
                    <div
                      className={`py-3 sm:px-4 ${
                        item > 0
                          ? "border-t border-[var(--consumer-border)] sm:border-l sm:border-t-0"
                          : "sm:pl-0"
                      }`}
                      key={item}
                    >
                      <HeroShape className="h-2.5 w-20 bg-[color-mix(in_srgb,var(--consumer-ink),transparent_92%)]" />
                      <HeroShape className="mt-2 h-5 w-16" />
                    </div>
                  ))}
                </div>
              </div>

              <div className="mt-8 flex flex-col gap-5 border-t border-[var(--consumer-border)] pt-6 sm:flex-row sm:items-end sm:justify-between lg:mt-5 lg:flex-col lg:items-start lg:gap-4 lg:pt-5 xl:flex-row xl:items-end">
                <HeroShape className="h-12 w-full rounded-md bg-primary/70 sm:w-44" />
                <HeroShape className="h-2.5 w-48 max-w-full bg-[color-mix(in_srgb,var(--consumer-ink),transparent_92%)] sm:ml-auto lg:ml-0 xl:ml-auto" />
              </div>
            </div>

            <div className="border-t border-[var(--consumer-border)] bg-[var(--consumer-hero-panel)] p-5 sm:p-7 lg:border-l lg:border-t-0 lg:p-6 xl:p-7">
              <div className="flex items-start justify-between gap-4">
                <div className="space-y-2">
                  <HeroShape className="h-3 w-28" />
                  <HeroShape className="h-2.5 w-36 bg-[color-mix(in_srgb,var(--consumer-ink),transparent_92%)]" />
                </div>
                <div className="space-y-2 text-right">
                  <HeroShape className="ml-auto h-3 w-24" />
                  <HeroShape className="ml-auto h-2.5 w-20 bg-[color-mix(in_srgb,var(--consumer-ink),transparent_92%)]" />
                </div>
              </div>

              <div className="mt-4 border-y border-[var(--consumer-border)] py-3">
                <div className="relative aspect-[42/17] w-full overflow-hidden">
                  {[12, 36, 60, 84].map((top) => (
                    <span
                      className="absolute inset-x-0 h-px bg-[color-mix(in_srgb,var(--consumer-ink),transparent_92%)]"
                      key={top}
                      style={{ top: `${top}%` }}
                    />
                  ))}
                  {[18, 40, 62, 84].map((left) => (
                    <span
                      className="absolute inset-y-0 w-px bg-[color-mix(in_srgb,var(--consumer-ink),transparent_94%)]"
                      key={left}
                      style={{ left: `${left}%` }}
                    />
                  ))}
                  <HeroShape className="absolute left-[10%] top-[48%] h-1.5 w-[58%] rounded-full bg-[color-mix(in_srgb,var(--consumer-ink),transparent_90%)]" />
                </div>
              </div>

              <div className="mt-3 flex justify-between gap-4">
                <HeroShape className="h-2.5 w-16 bg-[color-mix(in_srgb,var(--consumer-ink),transparent_92%)]" />
                <HeroShape className="h-2.5 w-20 bg-[color-mix(in_srgb,var(--consumer-ink),transparent_92%)]" />
              </div>

              <div className="mt-5 grid grid-cols-2 gap-4 border-t border-[var(--consumer-border)] pt-4">
                <div className="space-y-2">
                  <HeroShape className="h-2.5 w-16 bg-[color-mix(in_srgb,var(--consumer-ink),transparent_92%)]" />
                  <HeroShape className="h-3 w-24" />
                </div>
                <div className="space-y-2">
                  <HeroShape className="ml-auto h-2.5 w-20 bg-[color-mix(in_srgb,var(--consumer-ink),transparent_92%)]" />
                  <HeroShape className="ml-auto h-3 w-14" />
                </div>
              </div>
            </div>
          </div>
        </section>

        <div className="mt-4 grid overflow-hidden rounded-[10px] border border-[var(--consumer-surface-border)] bg-card shadow-[var(--consumer-surface-shadow)] sm:grid-cols-2 xl:grid-cols-4">
          {metricWidths.map((width, index) => (
            <div
              className={`min-h-24 px-4 py-4 sm:px-5 ${
                index > 0
                  ? "border-t border-[var(--consumer-border)] sm:border-l sm:border-t-0"
                  : ""
              } ${
                index === 2
                  ? "sm:border-l-0 sm:border-t xl:border-l xl:border-t-0"
                  : ""
              }`}
              key={width}
            >
              <Shape className={`h-2.5 ${width} opacity-70`} />
              <Shape className="mt-2.5 h-5 w-16" />
              <Shape className="mt-2 h-2.5 w-24 opacity-70" />
            </div>
          ))}
        </div>

        <div className="mt-5 grid gap-5 xl:grid-cols-[minmax(0,1.45fr)_minmax(18rem,0.55fr)]">
          <Surface>
            <div className="flex h-14 items-center justify-between border-b border-[var(--consumer-border)] px-4 sm:px-5">
              <Shape className="h-3 w-28" />
              <Shape className="h-2.5 w-20 opacity-70" />
            </div>
            <div className="px-4 sm:px-5">
              {[0, 1, 2].map((row) => (
                <div
                  className="flex min-h-20 items-center gap-3 border-b border-[var(--consumer-border)] last:border-0"
                  key={row}
                >
                  <Shape className="size-6 rounded-full" />
                  <div className="min-w-0 flex-1 space-y-2">
                    <Shape className="h-3 w-[min(16rem,78%)]" />
                    <Shape className="h-2.5 w-28 opacity-70" />
                  </div>
                  <Shape className="hidden h-9 w-24 sm:block" />
                </div>
              ))}
            </div>
          </Surface>

          <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-1">
            {[0, 1].map((section) => (
              <Surface key={section}>
                <div className="flex h-14 items-center border-b border-[var(--consumer-border)] px-4 sm:px-5">
                  <Shape className="h-3 w-24" />
                </div>
                <div className="space-y-4 p-4 sm:p-5">
                  <div className="flex items-center gap-3">
                    <Shape className="size-9 rounded-md" />
                    <div className="min-w-0 flex-1 space-y-2">
                      <Shape className="h-3 w-28" />
                      <Shape className="h-2.5 w-20 opacity-70" />
                    </div>
                  </div>
                  <Shape className="h-1.5 w-full" />
                  <Shape className="h-9 w-full" />
                </div>
              </Surface>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
