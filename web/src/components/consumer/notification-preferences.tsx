"use client";

import { useCallback, useEffect, useState } from "react";
import { BellRing, Mail, Monitor, RefreshCw } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  readConsumerNotificationPreferences,
  saveConsumerNotificationPreference,
} from "@/lib/notifications/preferences.client";
import {
  CONSUMER_NOTIFICATION_EMAIL_AVAILABLE,
  DEFAULT_CONSUMER_NOTIFICATION_PREFERENCES,
  type ConsumerNotificationPreference,
  type ConsumerNotificationPreferences,
} from "@/lib/notifications/preferences";
import { cn } from "@/lib/utils";

import { TYPE_META } from "./notifications/view-model";

type LoadState = "idle" | "loading" | "ready" | "error";
type PreferenceChannel = "email" | "inApp";

function ChannelSwitch({
  checked,
  disabled,
  label,
  onChange,
}: {
  checked: boolean;
  disabled: boolean;
  label: string;
  onChange: () => void;
}) {
  return (
    <button
      aria-checked={checked}
      aria-label={label}
      className={cn(
        "relative inline-flex min-h-11 min-w-11 items-center justify-center rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--consumer-accent-ink)] lg:min-h-9",
        disabled && "cursor-wait opacity-60",
      )}
      disabled={disabled}
      onClick={onChange}
      role="switch"
      type="button"
    >
      <span
        aria-hidden
        className={cn(
          "relative h-6 w-10 rounded-full border transition-colors duration-[var(--duration-quick)] motion-reduce:transition-none",
          checked
            ? "border-[var(--consumer-accent-ink)] bg-[var(--consumer-accent-ink)]"
            : "border-[var(--consumer-border)] bg-[var(--surface-raised)]",
        )}
      >
        <span
          className={cn(
            "absolute left-0.5 top-0.5 size-[18px] rounded-full bg-card shadow-sm transition-transform duration-[var(--duration-quick)] motion-reduce:transition-none",
            checked && "translate-x-4",
          )}
        />
      </span>
    </button>
  );
}

export function ConsumerNotificationPreferences({
  enabled,
  onSaved,
}: {
  enabled: boolean;
  onSaved: (preferences: ConsumerNotificationPreferences) => void;
}) {
  const [loadState, setLoadState] = useState<LoadState>(enabled ? "loading" : "idle");
  const [preferences, setPreferences] = useState<ConsumerNotificationPreferences>(
    DEFAULT_CONSUMER_NOTIFICATION_PREFERENCES,
  );
  const [saving, setSaving] = useState<string | null>(null);
  const [message, setMessage] = useState("");

  const load = useCallback(async () => {
    if (!enabled) return;
    setLoadState("loading");
    const result = await readConsumerNotificationPreferences();
    if (!result.ok) {
      setMessage(result.message);
      setLoadState("error");
      return;
    }
    setPreferences(result.preferences);
    setMessage("");
    setLoadState("ready");
  }, [enabled]);

  useEffect(() => {
    let active = true;
    if (!enabled) return () => { active = false; };
    void readConsumerNotificationPreferences().then((result) => {
      if (!active) return;
      if (!result.ok) {
        setMessage(result.message);
        setLoadState("error");
        return;
      }
      setPreferences(result.preferences);
      setMessage("");
      setLoadState("ready");
    });
    return () => { active = false; };
  }, [enabled]);

  const change = useCallback(async (
    current: ConsumerNotificationPreference,
    channel: PreferenceChannel,
  ) => {
    if (saving !== null) return;
    const next = Object.freeze({
      ...current,
      [channel]: !current[channel],
    });
    const key = `${current.eventType}:${channel}`;
    const previous = preferences;
    setPreferences(previous.map((preference) =>
      preference.eventType === current.eventType ? next : preference));
    setSaving(key);
    setMessage("");
    const result = await saveConsumerNotificationPreference(next);
    if (result.ok) {
      setPreferences(result.preferences);
      setMessage(`${TYPE_META[current.eventType].label} preferences saved.`);
      onSaved(result.preferences);
    } else {
      setPreferences(previous);
      setMessage(result.message);
    }
    setSaving(null);
  }, [onSaved, preferences, saving]);

  if (!enabled) return null;
  const visibleState = loadState === "idle" ? "loading" : loadState;

  return (
    <details className="mb-4 overflow-hidden rounded-[10px] border border-[var(--consumer-surface-border)] bg-card shadow-[var(--consumer-surface-shadow)]">
      <summary className="flex min-h-12 cursor-pointer list-none items-center gap-2 px-4 py-3 text-sm font-semibold marker:hidden focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--consumer-accent-ink)] sm:px-5 [&::-webkit-details-marker]:hidden">
        <BellRing aria-hidden className="size-4 text-[var(--consumer-accent-ink)]" />
        Notification preferences
        <span className="ml-auto text-xs font-normal text-muted-foreground">Events and channels</span>
      </summary>
      <div className="border-t border-[var(--consumer-border)] px-4 pb-4 pt-3.5 sm:px-5 sm:pb-5">
        <p className="max-w-[70ch] text-xs leading-5 text-muted-foreground">
          Choose which kinds of update appear in this feed. Turning an in-app category off hides
          that category until you turn it back on.
        </p>
        <p className="mt-1 max-w-[70ch] text-xs leading-5 text-muted-foreground">
          Email tells you the kind of update and asks you to sign in; it never carries amounts,
          lender names or message text. Requested password-reset emails are handled separately from
          these event preferences.
        </p>

        {visibleState === "loading" ? (
          <div aria-live="polite" className="mt-4 flex min-h-20 items-center gap-2 text-sm text-muted-foreground" role="status">
            <RefreshCw aria-hidden className="size-4 animate-spin motion-reduce:animate-none" />
            Loading notification preferences…
          </div>
        ) : visibleState === "error" ? (
          <div className="mt-4" role="alert">
            <p className="text-sm text-[var(--consumer-negative)]">{message}</p>
            <Button className="mt-3 min-h-11" onClick={() => void load()} variant="outline">
              <RefreshCw aria-hidden /> Retry
            </Button>
          </div>
        ) : (
          <div className="mt-4 overflow-hidden rounded-[8px] border border-[var(--consumer-border)]">
            <div className="grid grid-cols-[minmax(0,1fr)_68px_68px] items-center border-b border-[var(--consumer-border)] bg-[var(--consumer-canvas)] px-3 py-2 text-[0.67rem] font-semibold uppercase tracking-[0.08em] text-muted-foreground sm:grid-cols-[minmax(0,1fr)_88px_88px] sm:px-4">
              <span>Event</span>
              <span className="flex items-center justify-center gap-1"><Monitor aria-hidden className="size-3.5" /> In-app</span>
              <span className="flex items-center justify-center gap-1"><Mail aria-hidden className="size-3.5" /> Email</span>
            </div>
            {preferences.map((preference) => {
              const meta = TYPE_META[preference.eventType];
              return (
                <div
                  className="grid min-h-14 grid-cols-[minmax(0,1fr)_68px_68px] items-center border-t border-[var(--consumer-border)] px-3 first:border-t-0 sm:grid-cols-[minmax(0,1fr)_88px_88px] sm:px-4"
                  key={preference.eventType}
                >
                  <span className="min-w-0 pr-2">
                    <b className="block text-sm font-medium">{meta.label}</b>
                    <span className="mt-0.5 block text-[0.7rem] leading-4 text-muted-foreground">When {meta.clause}.</span>
                  </span>
                  <ChannelSwitch
                    checked={preference.inApp}
                    disabled={saving !== null}
                    label={`${meta.label}, in-app ${preference.inApp ? "on" : "off"}`}
                    onChange={() => void change(preference, "inApp")}
                  />
                  {/* The availability constant stays in the disabled condition: it is the one
                      switch that turns consumer event email off everywhere if the dispatcher has
                      to be pulled. */}
                  <ChannelSwitch
                    checked={preference.email}
                    disabled={saving !== null || !CONSUMER_NOTIFICATION_EMAIL_AVAILABLE}
                    label={`${meta.label}, email ${preference.email ? "on" : "off"}`}
                    onChange={() => void change(preference, "email")}
                  />
                </div>
              );
            })}
          </div>
        )}
        <p aria-live="polite" className="mt-3 min-h-4 text-xs text-muted-foreground" role="status">
          {visibleState === "ready" ? message : ""}
        </p>
      </div>
    </details>
  );
}
