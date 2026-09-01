"use client";

import { useMemo, useState, type ChangeEvent, type CSSProperties } from "react";
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  Building2,
  Check,
  ImageIcon,
  Mail,
  Moon,
  Paintbrush,
  Smartphone,
  Sun,
  Upload,
  UserPlus,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { PublishedBrand } from "@/lib/tenancy/types";
import { cn } from "@/lib/utils";

type Accent = "forest" | "green" | "navy";
type AppIconStyle = "initials" | "mark";
type BrandStep = "identity" | "invite" | "theme";
type OnboardingRoute = "brand" | "choice" | "complete" | "invite";
type PreviewMode = "dark" | "light";

export type OperatorBrandSetup = {
  accent: Accent;
  appIconStyle: AppIconStyle;
  brand: PublishedBrand;
  brandLabel: string;
  businessName: string;
  inviteEmail: string;
  inviteName: string;
  logoFileName?: string;
  previewMode: PreviewMode;
};

export type OperatorOnboardingProps = {
  /** The name shown in the portal, when the workspace already has one. */
  brandLabel?: string;
  className?: string;
  embedded?: boolean;
  initialBrand?: PublishedBrand;
  initialBusinessName?: string;
  onComplete?: (setup: OperatorBrandSetup) => void;
  onExit?: () => void;
  onInviteClient?: (email: string) => void;
};

const BRAND_STEPS: Array<{ id: BrandStep; label: string }> = [
  { id: "identity", label: "Identity" },
  { id: "theme", label: "Theme" },
  { id: "invite", label: "Invitation" },
];

const accentStyles: Record<
  Accent,
  { button: string; preview: string; soft: string }
> = {
  green: {
    button: "bg-primary",
    preview: "bg-primary text-primary-foreground",
    soft: "bg-primary/10 text-primary-ink",
  },
  forest: {
    button: "bg-emerald-800",
    preview: "bg-emerald-800 text-white",
    soft: "bg-emerald-700/10 text-emerald-800",
  },
  navy: {
    button: "bg-slate-800",
    preview: "bg-slate-800 text-white",
    soft: "bg-slate-700/10 text-slate-800",
  },
};

const accentColors: Record<Accent, string> = {
  forest: "#176B4D",
  green: "#0F7A5C",
  navy: "#26364D",
};

const MAX_WORKSPACE_NAME_LENGTH = 120;
const MAX_LOGO_BYTES = 2 * 1024 * 1024;
const LOGO_MIME_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
const HEX_COLOR = /^#[0-9a-f]{6}$/i;

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function boundedName(value: string): boolean {
  const trimmed = value.trim();
  return trimmed.length > 0 && trimmed.length <= MAX_WORKSPACE_NAME_LENGTH;
}

function brandPortalName(brand: PublishedBrand | undefined): string | null {
  const value = (brand as PublishedBrand & { portalName?: unknown } | undefined)?.portalName;
  return typeof value === "string" && boundedName(value) ? value.trim() : null;
}

function brandColor(brand: PublishedBrand | undefined): string {
  for (const value of [brand?.accentColor, brand?.primaryColor]) {
    if (typeof value === "string" && HEX_COLOR.test(value)) return value.toLowerCase();
  }
  return accentColors.green.toLowerCase();
}

function accentForColor(color: string): Accent {
  return (Object.entries(accentColors) as Array<[Accent, string]>).find(
    ([, value]) => value.toLowerCase() === color.toLowerCase(),
  )?.[0] ?? "green";
}

function safeLogoUrl(value: unknown): string | null {
  if (typeof value !== "string" || value.length > 2048) return null;
  try {
    const url = new URL(value);
    if (
      (url.protocol !== "https:" && url.protocol !== "http:")
      || url.username
      || url.password
    ) return null;
    return url.toString();
  } catch {
    return null;
  }
}

function parseBrand(value: unknown): PublishedBrand | null {
  const source = record(value);
  const allowed = new Set(["accentColor", "logoUrl", "portalName", "primaryColor"]);
  if (!source || Object.keys(source).some((key) => !allowed.has(key))) return null;
  const parsed: PublishedBrand = {};
  for (const key of ["accentColor", "primaryColor"] as const) {
    const field = source[key];
    if (field !== undefined) {
      if (typeof field !== "string" || !HEX_COLOR.test(field)) return null;
      parsed[key] = field.toLowerCase();
    }
  }
  if (source.logoUrl !== undefined) {
    const logoUrl = safeLogoUrl(source.logoUrl);
    if (!logoUrl) return null;
    parsed.logoUrl = logoUrl;
  }
  if (source.portalName !== undefined) {
    if (typeof source.portalName !== "string" || !boundedName(source.portalName)) return null;
    parsed.portalName = source.portalName.trim();
  }
  return parsed;
}

export function verifiedBrandResponse(
  value: unknown,
  expected: { accentColor?: string; logo?: boolean; portalName?: string; primaryColor?: string },
): PublishedBrand | null {
  const brand = parseBrand(record(value)?.brand);
  const portalName = brandPortalName(brand ?? undefined);
  if (!brand) return null;
  if (
    expected.accentColor !== undefined
    && brand.accentColor?.toLowerCase() !== expected.accentColor.toLowerCase()
  ) return null;
  if (
    expected.primaryColor !== undefined
    && brand.primaryColor?.toLowerCase() !== expected.primaryColor.toLowerCase()
  ) return null;
  if (expected.portalName !== undefined && portalName !== expected.portalName) return null;
  if (expected.logo && !brand.logoUrl) return null;
  return brand;
}

export function verifiedWorkspaceNameResponse(value: unknown, expected: string): boolean {
  return record(record(value)?.org)?.name === expected;
}

export function verifiedPublicationResponse(value: unknown): boolean {
  const publishedAt = record(record(value)?.brand)?.publishedAt;
  return typeof publishedAt === "string" && Number.isFinite(Date.parse(publishedAt));
}

export function verifiedInviteResponse(value: unknown): boolean {
  const invite = record(record(value)?.invite);
  return typeof invite?.inviteId === "string" && invite.inviteId.length > 0
    && typeof invite.orgId === "string" && invite.orgId.length > 0;
}

function initials(value: string) {
  return value
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
}

function normalized(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function SetupHeader({
  description,
  headingLevel = "h1",
  onBack,
  title,
}: {
  description: string;
  headingLevel?: "h1" | "h2";
  onBack?: () => void;
  title: string;
}) {
  const Heading = headingLevel;
  return (
    <header className="flex flex-col gap-4 border-b border-border pb-5 sm:flex-row sm:items-start">
      {onBack ? (
        <Button
          aria-label="Go back"
          className="shrink-0"
          onClick={onBack}
          size="icon-lg"
          variant="outline"
        >
          <ArrowLeft aria-hidden />
        </Button>
      ) : (
        <span className="grid size-11 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary-ink">
          <Building2 aria-hidden className="size-5" />
        </span>
      )}
      <div className="min-w-0">
        <Heading className="text-2xl font-semibold tracking-[-0.025em]">{title}</Heading>
        <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">
          {description}
        </p>
      </div>
    </header>
  );
}

/**
 * Both name fields default to empty rather than to a workspace nobody here
 * belongs to. `operator.tsx` mounts this embedded and now threads the signed-in
 * organization's name in; with nothing threaded — the standalone route and the
 * fixture shell — the operator types their own, which is what a setup wizard is
 * for. The previous defaults, "Apex Funding Partners" and "Apex Funding", were
 * prefilled into a form whose whole subject is who you are.
 */
export function OperatorOnboarding({
  brandLabel: initialBrandLabel = "",
  className,
  embedded = false,
  initialBrand,
  initialBusinessName = "",
  onComplete,
  onExit,
  onInviteClient,
}: OperatorOnboardingProps) {
  const initialColor = brandColor(initialBrand);
  const [route, setRoute] = useState<OnboardingRoute>("choice");
  const [brandStep, setBrandStep] = useState<BrandStep>("identity");
  const [businessName, setBusinessName] = useState(initialBusinessName);
  const [brandLabel, setBrandLabel] = useState(
    () => brandPortalName(initialBrand) ?? initialBrandLabel,
  );
  const [logoFile, setLogoFile] = useState<File | null>(null);
  const [logoFileName, setLogoFileName] = useState("");
  const [savedLogoUrl, setSavedLogoUrl] = useState(
    () => safeLogoUrl(initialBrand?.logoUrl),
  );
  const [appIconStyle, setAppIconStyle] =
    useState<AppIconStyle>("initials");
  const [accent, setAccent] = useState<Accent>(() => accentForColor(initialColor));
  const [selectedColor, setSelectedColor] = useState(initialColor);
  const [previewMode, setPreviewMode] = useState<PreviewMode>("light");
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteName, setInviteName] = useState("");
  const [invitePrepared, setInvitePrepared] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [inviteIdempotencyKey] = useState(() => crypto.randomUUID());

  const stepIndex = BRAND_STEPS.findIndex((step) => step.id === brandStep);
  const mismatch =
    Boolean(businessName.trim()) &&
    Boolean(brandLabel.trim()) &&
    normalized(businessName) !== normalized(brandLabel);
  const validInvite = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(inviteEmail.trim());
  const validInviteName =
    inviteName.trim().length > 0 && inviteName.trim().length <= 120;
  const validBusinessName = boundedName(businessName);
  const validBrandLabel = boundedName(brandLabel);
  const iconText = useMemo(
    () =>
      appIconStyle === "initials"
        ? initials(brandLabel || businessName)
        : initials(brandLabel || businessName).slice(0, 1),
    [appIconStyle, brandLabel, businessName],
  );
  const savedLogoStyle: CSSProperties | undefined = savedLogoUrl
    ? {
        backgroundImage: `url(${JSON.stringify(savedLogoUrl)})`,
        backgroundPosition: "center",
        backgroundSize: "cover",
      }
    : undefined;

  function chooseLogo(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (file) {
      if (!LOGO_MIME_TYPES.has(file.type) || file.size < 1 || file.size > MAX_LOGO_BYTES) {
        setLogoFile(null);
        setLogoFileName("");
        setSaveError("Choose a PNG, JPEG, or WebP image no larger than 2 MB.");
        event.target.value = "";
        return;
      }
      setSaveError(null);
      setLogoFile(file);
      setLogoFileName(file.name);
    }
  }

  async function sendClientInvite(): Promise<boolean> {
    if (!validInvite || !validInviteName) return false;
    const response = await fetch("/api/invites", {
      body: JSON.stringify({
        email: inviteEmail.trim(),
        expiresInDays: 7,
        fullName: inviteName.trim(),
        kind: "client",
        orgRole: null,
      }),
      headers: {
        "content-type": "application/json",
        "Idempotency-Key": inviteIdempotencyKey,
      },
      method: "POST",
    });
    if (!response.ok) return false;
    const responseBody = await response.json().catch(() => null);
    if (!verifiedInviteResponse(responseBody)) return false;
    setInvitePrepared(true);
    onInviteClient?.(inviteEmail.trim());
    return true;
  }

  async function saveBrand(): Promise<PublishedBrand | null> {
    const nextBusinessName = businessName.trim();
    const nextPortalName = brandLabel.trim();
    const normalizedColor = selectedColor.toLowerCase();
    const settingsResponse = await fetch("/api/org/settings", {
      body: JSON.stringify({ name: nextBusinessName }),
      headers: { "content-type": "application/json" },
      method: "PATCH",
    });
    const settingsBody = await settingsResponse.json().catch(() => null);
    if (
      !settingsResponse.ok
      || !verifiedWorkspaceNameResponse(settingsBody, nextBusinessName)
    ) return null;

    const colorResponse = await fetch("/api/org/brand", {
      body: JSON.stringify({
        accentColor: normalizedColor,
        portalName: nextPortalName,
        primaryColor: normalizedColor,
      }),
      headers: { "content-type": "application/json" },
      method: "PATCH",
    });
    const colorBody = await colorResponse.json().catch(() => null);
    let savedBrand = colorResponse.ok
      ? verifiedBrandResponse(colorBody, {
          accentColor: normalizedColor,
          portalName: nextPortalName,
          primaryColor: normalizedColor,
        })
      : null;
    if (!savedBrand) return null;

    if (logoFile) {
      const form = new FormData();
      form.set("logo", logoFile);
      const logoResponse = await fetch("/api/org/brand", {
        body: form,
        method: "PATCH",
      });
      const logoBody = await logoResponse.json().catch(() => null);
      const logoBrand = logoResponse.ok
        ? verifiedBrandResponse(logoBody, {
            accentColor: normalizedColor,
            logo: true,
            portalName: nextPortalName,
            primaryColor: normalizedColor,
          })
        : null;
      if (!logoBrand) return null;
      savedBrand = logoBrand;
    }

    const publishResponse = await fetch("/api/org/brand/publish", { method: "POST" });
    const publishBody = await publishResponse.json().catch(() => null);
    if (!publishResponse.ok || !verifiedPublicationResponse(publishBody)) return null;
    return savedBrand;
  }

  async function nextBrandStep() {
    const nextStep = BRAND_STEPS[stepIndex + 1];
    if (nextStep) {
      setBrandStep(nextStep.id);
      return;
    }

    setSaveError(null);
    setSaving(true);
    try {
      const savedBrand = await saveBrand();
      const inviteSent =
        savedBrand && inviteEmail.trim() !== "" ? await sendClientInvite() : true;
      if (!savedBrand || !inviteSent) {
        setSaveError(
          !savedBrand
            ? "The brand could not be saved and published. Nothing is being claimed as complete."
            : "The brand was saved, but the client invitation could not be sent. Try the invitation again.",
        );
        return;
      }

      const setup: OperatorBrandSetup = {
        accent,
        appIconStyle,
        brand: savedBrand,
        brandLabel: brandLabel.trim(),
        businessName: businessName.trim(),
        inviteEmail: inviteEmail.trim(),
        inviteName: inviteName.trim(),
        logoFileName: logoFileName || undefined,
        previewMode,
      };
      setSavedLogoUrl(safeLogoUrl(savedBrand.logoUrl));
      onComplete?.(setup);
      setRoute("complete");
    } catch {
      setSaveError("Workspace setup could not be completed. Try again.");
    } finally {
      setSaving(false);
    }
  }

  function previousBrandStep() {
    const previousStep = BRAND_STEPS[stepIndex - 1];
    if (previousStep) setBrandStep(previousStep.id);
    else setRoute("choice");
  }

  async function prepareInvite() {
    if (!validInvite || !validInviteName || saving) return;
    setSaveError(null);
    setSaving(true);
    try {
      if (!(await sendClientInvite())) {
        setSaveError("The client invitation could not be sent. Try again.");
      }
    } catch {
      setSaveError("The client invitation could not be sent. Try again.");
    } finally {
      setSaving(false);
    }
  }

  if (route === "choice") {
    return (
      <section className={cn("mx-auto max-w-5xl space-y-6", className)}>
        <SetupHeader
          description="Choose the shortest path into your workspace. Brand setup saves and publishes the portal theme; client invitations are sent through the secure account-invite flow."
          headingLevel={embedded ? "h2" : "h1"}
          title="How do you want to start?"
        />

        <div className="grid gap-4 md:grid-cols-2">
          <button
            className="group rounded-xl border border-primary-ink bg-card p-5 text-left shadow-[var(--consumer-surface-shadow)] outline-none transition-colors hover:bg-primary/5 focus-visible:ring-3 focus-visible:ring-ring/50"
            onClick={() => {
              setBrandStep("identity");
              setRoute("brand");
            }}
            type="button"
          >
            <div className="flex items-start gap-4">
              <span className="grid size-10 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary-ink">
                <Paintbrush aria-hidden className="size-5" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="flex flex-wrap items-center gap-2">
                  <strong className="text-base">Set up my brand first</strong>
                  <span className="rounded-full border border-primary/20 bg-primary/10 px-2 py-0.5 text-[0.65rem] font-semibold text-primary-ink">
                    Recommended · ~5 min
                  </span>
                </span>
                <span className="mt-2 block text-sm leading-6 text-muted-foreground">
                  Confirm your identity, portal theme, app icon, and client
                  invitation before anyone enters the workspace.
                </span>
              </span>
              <ArrowRight
                aria-hidden
                className="mt-1 size-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5"
              />
            </div>
          </button>

          <button
            className="group rounded-xl border border-border bg-card p-5 text-left shadow-[var(--consumer-surface-shadow)] outline-none transition-colors hover:border-primary/30 focus-visible:ring-3 focus-visible:ring-ring/50"
            onClick={() => {
              setInvitePrepared(false);
              setRoute("invite");
            }}
            type="button"
          >
            <div className="flex items-start gap-4">
              <span className="grid size-10 shrink-0 place-items-center rounded-lg bg-muted text-muted-foreground">
                <UserPlus aria-hidden className="size-5" />
              </span>
              <span className="min-w-0 flex-1">
                <strong className="text-base">
                  I have a client ready — invite now
                </strong>
                <span className="mt-2 block text-sm leading-6 text-muted-foreground">
                  Prepare an invitation now, then finish branding from the
                  workspace later.
                </span>
              </span>
              <ArrowRight
                aria-hidden
                className="mt-1 size-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5"
              />
            </div>
          </button>
        </div>

        <p className="text-xs leading-5 text-muted-foreground">
          Uploaded logos are stored in the workspace brand bucket. Invitation delivery and acceptance are recorded in the audit trail.
        </p>
      </section>
    );
  }

  if (route === "invite") {
    return (
      <section className={cn("mx-auto max-w-3xl space-y-6", className)}>
        <SetupHeader
          description="Prepare the first client invitation without waiting for brand setup."
          headingLevel={embedded ? "h2" : "h1"}
          onBack={() => setRoute("choice")}
          title="Invite a client"
        />
        <div className="rounded-xl border border-border bg-card p-5 shadow-[var(--consumer-surface-shadow)]">
          <label className="text-xs font-medium" htmlFor="first-client-name">
            Client name
          </label>
          <Input
            className="mt-2"
            id="first-client-name"
            maxLength={120}
            onChange={(event) => {
              setInviteName(event.target.value);
              setInvitePrepared(false);
            }}
            placeholder="Jordan Newcomer"
            value={inviteName}
          />
          <label className="mt-5 block text-xs font-medium" htmlFor="first-client-email">
            Client email
          </label>
          <div className="mt-2 flex flex-col gap-2 sm:flex-row">
            <Input
              aria-invalid={inviteEmail.length > 0 && !validInvite}
              className="flex-1"
              id="first-client-email"
              onChange={(event) => {
                setInviteEmail(event.target.value);
                setInvitePrepared(false);
              }}
              placeholder="client@example.com"
              type="email"
              value={inviteEmail}
            />
            <Button
              disabled={!validInvite || !validInviteName || saving}
              onClick={() => { void prepareInvite(); }}
            >
              <Mail aria-hidden />
              {saving ? "Sending invitation" : "Send invitation"}
            </Button>
          </div>
          {inviteEmail.length > 0 && !validInvite ? (
            <p className="mt-2 text-xs text-destructive">
              Enter a complete email address.
            </p>
          ) : null}
          {invitePrepared ? (
            <div
              className="mt-5 rounded-lg border border-[color-mix(in_srgb,var(--consumer-positive),transparent_74%)] bg-[color-mix(in_srgb,var(--consumer-positive),transparent_92%)] p-4"
              role="status"
            >
              <p className="flex items-center gap-2 text-sm font-medium text-[var(--consumer-positive)]">
                <Check aria-hidden className="size-4" />
                Invitation sent
              </p>
              <p className="mt-1 text-xs leading-5 text-muted-foreground">
                Sent to {inviteEmail.trim()}. The client record will be created
                when the secure invitation is accepted.
              </p>
            </div>
          ) : null}
          {saveError ? (
            <p className="mt-4 text-xs text-destructive" role="alert">
              {saveError}
            </p>
          ) : null}
        </div>
      </section>
    );
  }

  if (route === "complete") {
    return (
      <section className={cn("mx-auto max-w-3xl space-y-6", className)}>
        <SetupHeader
          description="Your workspace branding is published for supported surfaces, and any client invitation entered in setup has been sent."
          headingLevel={embedded ? "h2" : "h1"}
          title="Brand setup complete"
        />
        <div className="rounded-xl border border-[color-mix(in_srgb,var(--consumer-positive),transparent_74%)] bg-[color-mix(in_srgb,var(--consumer-positive),transparent_92%)] p-5">
          <p className="flex items-center gap-2 text-sm font-semibold text-[var(--consumer-positive)]">
            <Check aria-hidden className="size-4" />
            {brandLabel || businessName} is live
          </p>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">
            The portal name, colour, and available logo are saved for the
            product surfaces that consume published workspace branding.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button onClick={onExit}>Enter operator workspace</Button>
          <Button
            onClick={() => {
              setBrandStep("identity");
              setRoute("brand");
            }}
            variant="outline"
          >
            Review setup
          </Button>
        </div>
      </section>
    );
  }

  const previewSurface =
    previewMode === "light"
      ? "border-border bg-card text-foreground"
      : "border-[#1E2A3D] bg-[#0E1626] text-[#E6EBF1]";
  const previewMuted =
    previewMode === "light" ? "text-muted-foreground" : "text-[#E6EBF1]";

  return (
    <section className={cn("mx-auto max-w-6xl space-y-5", className)}>
      <SetupHeader
        description="Shape the operator identity while the client-facing result stays visible."
        headingLevel={embedded ? "h2" : "h1"}
        onBack={previousBrandStep}
        title="Set up your brand"
      />

      <div className="grid grid-cols-3 gap-2" aria-label="Brand setup progress">
        {BRAND_STEPS.map((step, index) => (
          <button
            aria-current={step.id === brandStep ? "step" : undefined}
            className="min-h-11 rounded-lg px-2 text-left outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
            key={step.id}
            onClick={() => setBrandStep(step.id)}
            type="button"
          >
            <span
              className={cn(
                "block h-1.5 rounded-full",
                index <= stepIndex ? "bg-primary" : "bg-muted",
              )}
            />
            <span
              className={cn(
                "mt-2 block text-xs font-medium",
                step.id === brandStep
                  ? "text-foreground"
                  : "text-muted-foreground",
              )}
            >
              {index + 1}. {step.label}
            </span>
          </button>
        ))}
      </div>

      <div className="grid gap-5 xl:grid-cols-[0.86fr_1.14fr]">
        <div className="rounded-xl border border-border bg-card p-5 shadow-[var(--consumer-surface-shadow)]">
          {brandStep === "identity" ? (
            <div className="space-y-5">
              <div>
                <label className="text-xs font-medium" htmlFor="business-name">
                  Business name
                </label>
                <Input
                  className="mt-2"
                  id="business-name"
                  maxLength={MAX_WORKSPACE_NAME_LENGTH}
                  onChange={(event) => setBusinessName(event.target.value)}
                  value={businessName}
                />
              </div>
              <div>
                <label className="text-xs font-medium" htmlFor="brand-label">
                  Name shown in the portal
                </label>
                <Input
                  className="mt-2"
                  id="brand-label"
                  maxLength={MAX_WORKSPACE_NAME_LENGTH}
                  onChange={(event) => setBrandLabel(event.target.value)}
                  value={brandLabel}
                />
              </div>

              {mismatch ? (
                <div className="rounded-lg border border-[color-mix(in_srgb,var(--consumer-warning-border),transparent_72%)] bg-[color-mix(in_srgb,var(--consumer-warning),transparent_88%)] p-3">
                  <div className="flex gap-3">
                    <AlertTriangle
                      aria-hidden
                      className="mt-0.5 size-4 shrink-0 text-[var(--consumer-warning-ink)]"
                    />
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-[var(--consumer-warning-ink)]">
                        The portal name and business name differ
                      </p>
                      <p className="mt-1 text-xs leading-5 text-muted-foreground">
                        The invitation will say “{brandLabel},” while workspace
                        records say “{businessName}.”
                      </p>
                      <Button
                        className="mt-2"
                        onClick={() => setBrandLabel(businessName)}
                        size="sm"
                        variant="outline"
                      >
                        Use {businessName || "business name"}
                      </Button>
                    </div>
                  </div>
                </div>
              ) : null}

              <div>
                <p className="text-xs font-medium">Logo file</p>
                <label className="mt-2 flex min-h-11 cursor-pointer items-center gap-3 rounded-lg border border-border bg-background px-3 text-sm outline-none transition-colors hover:bg-muted focus-within:ring-3 focus-within:ring-ring/50">
                  <Upload aria-hidden className="size-4 text-muted-foreground" />
                  <span className="min-w-0 flex-1 truncate">
                    {logoFileName || (savedLogoUrl ? "Saved workspace logo" : "Choose a local image")}
                  </span>
                  <input
                    accept="image/png,image/jpeg,image/webp"
                    className="sr-only"
                    onChange={chooseLogo}
                    type="file"
                  />
                </label>
                <p className="mt-2 text-xs leading-5 text-muted-foreground">
                  PNG, JPEG, and WebP files up to 2 MB are uploaded when setup
                  is finished.
                </p>
              </div>
            </div>
          ) : null}

          {brandStep === "theme" ? (
            <div className="space-y-6">
              <fieldset>
                <legend className="text-xs font-medium">Portal accent</legend>
                <div className="mt-3 flex gap-3">
                  {(["green", "forest", "navy"] as Accent[]).map((choice) => (
                    <button
                      aria-label={`Use ${choice} accent`}
                      aria-pressed={
                        selectedColor === accentColors[choice].toLowerCase()
                      }
                      className={cn(
                        "grid size-11 place-items-center rounded-full outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
                        selectedColor === accentColors[choice].toLowerCase()
                          && "ring-2 ring-foreground ring-offset-2",
                      )}
                      key={choice}
                      onClick={() => {
                        setAccent(choice);
                        setSelectedColor(accentColors[choice].toLowerCase());
                      }}
                      type="button"
                    >
                      <span
                        aria-hidden
                        className={cn(
                          "size-8 rounded-full",
                          accentStyles[choice].button,
                        )}
                      />
                    </button>
                  ))}
                </div>
              </fieldset>

              <fieldset>
                <legend className="text-xs font-medium">Home-screen icon</legend>
                <div className="mt-3 grid grid-cols-2 gap-2">
                  {(
                    [
                      ["initials", "Two initials"],
                      ["mark", "Compact mark"],
                    ] as Array<[AppIconStyle, string]>
                  ).map(([choice, label]) => (
                    <button
                      aria-pressed={appIconStyle === choice}
                      className={cn(
                        "min-h-11 rounded-lg border px-3 text-sm font-medium outline-none transition-colors focus-visible:ring-3 focus-visible:ring-ring/50",
                        appIconStyle === choice
                          ? "border-primary-ink bg-primary/10 text-primary-ink"
                          : "border-border hover:bg-muted",
                      )}
                      key={choice}
                      onClick={() => setAppIconStyle(choice)}
                      type="button"
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </fieldset>

              <div>
                <p className="text-xs font-medium">Preview appearance</p>
                <div className="mt-3 inline-flex rounded-lg border border-border bg-muted/40 p-1">
                  <Button
                    aria-pressed={previewMode === "light"}
                    onClick={() => setPreviewMode("light")}
                    size="sm"
                    variant={previewMode === "light" ? "secondary" : "ghost"}
                  >
                    <Sun aria-hidden /> Light
                  </Button>
                  <Button
                    aria-pressed={previewMode === "dark"}
                    onClick={() => setPreviewMode("dark")}
                    size="sm"
                    variant={previewMode === "dark" ? "secondary" : "ghost"}
                  >
                    <Moon aria-hidden /> Dark
                  </Button>
                </div>
              </div>
            </div>
          ) : null}

          {brandStep === "invite" ? (
            <div className="space-y-5">
              <div>
                <label
                  className="text-xs font-medium"
                  htmlFor="branded-invite-name"
                >
                  Client name
                </label>
                <Input
                  className="mt-2"
                  id="branded-invite-name"
                  maxLength={120}
                  onChange={(event) => setInviteName(event.target.value)}
                  placeholder="Jordan Newcomer"
                  value={inviteName}
                />
              </div>
              <div>
                <label
                  className="text-xs font-medium"
                  htmlFor="branded-invite-email"
                >
                  Preview recipient
                </label>
                <Input
                  aria-invalid={inviteEmail.length > 0 && !validInvite}
                  className="mt-2"
                  id="branded-invite-email"
                  onChange={(event) => setInviteEmail(event.target.value)}
                  placeholder="client@example.com"
                  type="email"
                  value={inviteEmail}
                />
              </div>
              <div className="rounded-lg border border-border bg-muted/30 p-4">
                <p className="text-xs font-medium">Before you finish</p>
                <ul className="mt-3 space-y-2 text-xs leading-5 text-muted-foreground">
                  <li className="flex gap-2">
                    <Check
                      aria-hidden
                      className="mt-0.5 size-3.5 shrink-0 text-[var(--consumer-positive)]"
                    />
                    The published name, colour, and logo are available to
                    supported branded surfaces.
                  </li>
                  <li className="flex gap-2">
                    <Check
                      aria-hidden
                      className="mt-0.5 size-3.5 shrink-0 text-[var(--consumer-positive)]"
                    />
                    Platform disclosures remain unchanged.
                  </li>
                  <li className="flex gap-2">
                    <Check
                      aria-hidden
                      className="mt-0.5 size-3.5 shrink-0 text-[var(--consumer-positive)]"
                    />
                    Finishing saves and publishes the theme, uploads the
                    selected logo, and sends the invitation when a recipient is
                    entered.
                  </li>
                </ul>
              </div>
            </div>
          ) : null}

          <div className="mt-6 flex flex-wrap justify-between gap-2 border-t border-border pt-4">
            <Button onClick={previousBrandStep} variant="ghost">
              Back
            </Button>
            <Button
              disabled={
                saving ||
                !validBusinessName ||
                !validBrandLabel ||
                (brandStep === "invite" &&
                  inviteEmail.length > 0 &&
                  (!validInvite || !validInviteName))
              }
              onClick={() => { void nextBrandStep(); }}
            >
              {stepIndex === BRAND_STEPS.length - 1
                ? saving ? "Saving setup" : "Finish setup"
                : "Continue"}
              <ArrowRight aria-hidden />
            </Button>
          </div>
          {saveError ? (
            <p className="mt-3 text-xs text-destructive" role="alert">
              {saveError}
            </p>
          ) : null}
        </div>

        <div className="space-y-4">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-sm font-semibold">Live client preview</p>
              <p className="mt-1 text-xs text-muted-foreground">
                Portal and home-screen identity
              </p>
            </div>
            <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
              {previewMode === "light" ? (
                <Sun aria-hidden className="size-3.5" />
              ) : (
                <Moon aria-hidden className="size-3.5" />
              )}
              {previewMode === "light" ? "Light" : "Dark"}
            </span>
          </div>

          <div
            className={cn(
              "overflow-hidden rounded-xl border shadow-[0_1px_2px_oklch(0_0_0/0.035)]",
              previewSurface,
            )}
          >
            <div className="flex items-center gap-3 border-b border-current/10 px-5 py-4">
              <span
                className="grid size-9 place-items-center rounded-lg text-xs font-semibold text-white"
                style={{ ...savedLogoStyle, backgroundColor: selectedColor }}
              >
                {savedLogoUrl ? null : iconText}
              </span>
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold">
                  {brandLabel || "Your portal"}
                </p>
                <p className={cn("text-[0.68rem]", previewMuted)}>
                  Client workspace
                </p>
              </div>
            </div>
            <div className="p-5">
              <div
                className={cn(
                  "rounded-xl p-5",
                  previewMode === "dark" && "bg-[#1E2A3D] text-[#E6EBF1]",
                )}
                style={previewMode === "light"
                  ? { backgroundColor: `${selectedColor}18`, color: selectedColor }
                  : undefined}
              >
                <p className="text-[0.65rem] font-semibold uppercase tracking-[0.12em] opacity-70">
                  Today
                </p>
                <h2 className="mt-3 text-xl font-semibold tracking-[-0.025em]">
                  Your client&rsquo;s next action appears here.
                </h2>
                <p className="mt-2 text-sm leading-6 opacity-75">
                  This preview shows your colours and name, not a client record.
                </p>
              </div>
              <div className="mt-4 grid gap-3 sm:grid-cols-2">
                {/* A layout sample, not a client. The tiles used to read
                    "Optimization" and "Next update: Aug 13" — a stage and a
                    date for somebody who does not exist. */}
                <div className="rounded-lg border border-current/10 p-3">
                  <p className={cn("text-xs", previewMuted)}>Current stage</p>
                  <p className="mt-1 text-sm font-semibold">—</p>
                </div>
                <div className="rounded-lg border border-current/10 p-3">
                  <p className={cn("text-xs", previewMuted)}>Next update</p>
                  <p className="mt-1 text-sm font-semibold">—</p>
                </div>
              </div>
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-[8rem_1fr]">
            <div className="rounded-xl border border-border bg-card p-4">
              <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
                <Smartphone aria-hidden className="size-3.5" />
                App icon
              </div>
              <div
                className="mx-auto mt-4 grid size-14 place-items-center rounded-xl text-base font-semibold text-white shadow-sm"
                style={{ ...savedLogoStyle, backgroundColor: selectedColor }}
              >
                {savedLogoUrl ? null : iconText}
              </div>
            </div>

            <div className="rounded-xl border border-border bg-card p-4">
              <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
                <Mail aria-hidden className="size-3.5" />
                Branded invitation
              </div>
              <p className="mt-4 text-sm font-semibold">
                {brandLabel || businessName} invited you to your client portal
              </p>
              <p className="mt-2 text-xs leading-5 text-muted-foreground">
                Use your secure invitation to review tasks, documents, and
                application progress in one place.
              </p>
              <div className="mt-3 flex items-center gap-2 text-[0.68rem] text-muted-foreground">
                <ImageIcon aria-hidden className="size-3.5" />
                {logoFileName
                  || (savedLogoUrl ? "Saved workspace logo" : "Initials placeholder in use")}
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

// TODO(question #81): Confirm how this standalone setup hands off into the
// protected Brand Studio before adding any Brand Studio mutations.
