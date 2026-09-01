"use client";

import { useAuth0 } from "@auth0/auth0-react";
import { Bell, Check, Save } from "lucide-react";
import { useEffect, useMemo, useState, type FormEvent } from "react";

import { useAuthSession } from "../auth/AuthBootstrap";
import Navbar from "../navbar";

const voicePresets = [
  { id: "default", label: "Default", description: "Balanced, warm, candid" },
  { id: "softer", label: "Softer", description: "Patient, gentle, reassuring" },
  { id: "firmer", label: "Firmer", description: "Direct accountability" },
  { id: "playful", label: "Playful", description: "Light banter, still kind" },
  { id: "nurturing", label: "Nurturing", description: "Protective, mommy-like" },
  { id: "intimate", label: "Intimate", description: "Closer, lightly seductive" },
] as const;

type VoicePresetId = (typeof voicePresets)[number]["id"];

const endearmentOptions = [
  {
    id: "natural",
    label: "Natural",
    instruction:
      "Use endearments only when they naturally land; never force or overuse them.",
  },
  {
    id: "rare",
    label: "Rare",
    instruction:
      "Use endearments rarely and only during emotionally meaningful moments.",
  },
  {
    id: "frequent",
    label: "Frequent",
    instruction:
      "Use fitting endearments fairly often, while still varying how you address me.",
  },
  {
    id: "never",
    label: "Never",
    instruction:
      "Never use pet names or endearments; use my preferred name instead.",
  },
] as const;

type EndearmentId = (typeof endearmentOptions)[number]["id"];

const commonBoundaries = [
  "Never use emojis",
  "Never swear",
  "Never use pet names",
  "Never sound like a therapist",
  "Never become sexual or explicit",
  "Never use guilt or emotional manipulation",
] as const;

const supportedTimezones = [
  ...new Set([
    "UTC",
    ...(typeof Intl.supportedValuesOf === "function"
      ? Intl.supportedValuesOf("timeZone")
      : []),
  ]),
].sort((first, second) => first.localeCompare(second));

type SettingsDraft = {
  displayName: string;
  preferredUserName: string;
  timezone: string;
  personaName: string;
  voiceDirection: VoicePresetId;
  endearment: EndearmentId;
  customStyle: string;
  selectedBoundaries: string[];
  customBoundaries: string;
};

type UsagePhase = "thought" | "voice" | "memory" | "summary" | "reminder_voice";

type UsagePeriod = {
  totalUsd: number;
  byPhase: Record<UsagePhase, number>;
};

type UsageOverview = {
  today: UsagePeriod;
  thisMonth: UsagePeriod;
  allTime: UsagePeriod;
};

const inputClassName =
  "mt-2 w-full rounded-lg border border-[var(--border2)] bg-[var(--surface2)] px-3.5 py-2.5 text-[13px] font-light text-[var(--text)] outline-none transition placeholder:italic placeholder:text-[var(--text-dim)] focus:border-[rgba(201,147,90,0.35)] focus:shadow-[0_0_0_3px_rgba(201,147,90,0.05)]";

function endearmentId(instruction: string | null): EndearmentId {
  return (
    endearmentOptions.find((option) => option.instruction === instruction)?.id ??
    "natural"
  );
}

function serializeDraft(draft: SettingsDraft): string {
  return JSON.stringify({
    ...draft,
    selectedBoundaries: [...draft.selectedBoundaries].sort(),
  });
}

function formatUsd(value: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: value > 0 && value < 0.01 ? 4 : 2,
    maximumFractionDigits: 4,
  }).format(value);
}

export default function SettingsPage() {
  const { getAccessTokenSilently } = useAuth0();
  const { account, refreshAccount } = useAuthSession();
  const [draft, setDraft] = useState<SettingsDraft | null>(null);
  const [baseline, setBaseline] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  const [notificationPermission, setNotificationPermission] = useState<
    NotificationPermission | "unsupported"
  >("default");
  const [usage, setUsage] = useState<UsageOverview | null>(null);
  const [usageError, setUsageError] = useState("");

  useEffect(() => {
    if (!account) return;

    let cancelled = false;
    const loadUsage = async () => {
      try {
        const token = await getAccessTokenSilently();
        const response = await fetch(
          `${process.env.NEXT_PUBLIC_API_URL}/api/v1/usage/costs`,
          { headers: { Authorization: `Bearer ${token}` } },
        );
        const payload = await response.json().catch(() => null);
        if (!response.ok) {
          throw new Error(payload?.error?.message ?? "Couldn't load usage.");
        }
        if (!cancelled) setUsage(payload.data as UsageOverview);
      } catch (loadError) {
        if (!cancelled) {
          setUsageError(
            loadError instanceof Error ? loadError.message : "Couldn't load usage.",
          );
        }
      }
    };

    void loadUsage();
    return () => {
      cancelled = true;
    };
  }, [account, getAccessTokenSilently]);

  useEffect(() => {
    if (!("Notification" in window)) {
      setNotificationPermission("unsupported");
      return;
    }

    setNotificationPermission(Notification.permission);
  }, []);

  const enableDesktopNotifications = async () => {
    if (!("Notification" in window)) {
      setNotificationPermission("unsupported");
      return;
    }

    const permission = await Notification.requestPermission();
    setNotificationPermission(permission);
  };

  useEffect(() => {
    if (!account) return;

    const selectedBoundaries = account.persona.boundaries.filter((boundary) =>
      commonBoundaries.includes(boundary as (typeof commonBoundaries)[number]),
    );
    const customBoundaries = account.persona.boundaries.filter(
      (boundary) =>
        !commonBoundaries.includes(
          boundary as (typeof commonBoundaries)[number],
        ),
    );
    const nextDraft: SettingsDraft = {
      displayName: account.name ?? "",
      preferredUserName: account.persona.preferredUserName ?? "",
      timezone: account.timezone,
      personaName: account.persona.name,
      voiceDirection: account.persona.voiceDirection,
      endearment: endearmentId(account.persona.endearmentPreference),
      customStyle: account.persona.customStyle,
      selectedBoundaries,
      customBoundaries: customBoundaries.join("\n"),
    };

    setDraft(nextDraft);
    setBaseline(serializeDraft(nextDraft));
  }, [account]);

  const dirty = useMemo(
    () => Boolean(draft && serializeDraft(draft) !== baseline),
    [baseline, draft],
  );

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!draft || !dirty) return;

    const apiUrl = process.env.NEXT_PUBLIC_API_URL;
    if (!apiUrl) {
      setError("NEXT_PUBLIC_API_URL is not configured");
      return;
    }

    const selectedEndearment =
      endearmentOptions.find((option) => option.id === draft.endearment) ??
      endearmentOptions[0];
    const customBoundaries = draft.customBoundaries
      .split("\n")
      .map((boundary) => boundary.trim())
      .filter(Boolean);
    const boundaries = [
      ...new Set([...draft.selectedBoundaries, ...customBoundaries]),
    ];

    setSaving(true);
    setError("");
    setSaved(false);

    try {
      const token = await getAccessTokenSilently();
      const response = await fetch(`${apiUrl}/api/v1/settings`, {
        method: "PUT",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          displayName: draft.displayName.trim(),
          timezone: draft.timezone,
          persona: {
            name: draft.personaName.trim(),
            voiceDirection: draft.voiceDirection,
            customStyle: draft.customStyle.trim(),
            preferredUserName:
              draft.preferredUserName.trim() || draft.displayName.trim() || null,
            endearmentPreference: selectedEndearment.instruction,
            boundaries,
          },
        }),
      });
      const payload = await response.json().catch(() => null);

      if (!response.ok) {
        throw new Error(
          payload?.error?.message ?? "Cantarella couldn't save these settings.",
        );
      }

      await refreshAccount();
      setSaved(true);
      window.setTimeout(() => setSaved(false), 2500);
    } catch (saveError) {
      setError(
        saveError instanceof Error
          ? saveError.message
          : "Cantarella couldn't save these settings.",
      );
    } finally {
      setSaving(false);
    }
  };

  if (!draft) return null;

  return (
    <div className="grid h-screen w-full grid-cols-[260px_1fr] overflow-hidden bg-[var(--bg)] max-[820px]:grid-cols-[76px_1fr]">
      <Navbar />

      <main className="relative flex min-w-0 flex-col overflow-hidden">
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_78%_10%,rgba(201,147,90,0.025),transparent_42%),radial-gradient(ellipse_at_18%_86%,rgba(201,147,90,0.025),transparent_44%)]" />

        <header className="relative z-10 flex shrink-0 items-center justify-between border-b border-[var(--border)] bg-[rgba(12,10,9,0.82)] px-7 py-[18px] backdrop-blur-md max-sm:px-4">
          <div>
            <h1 className="font-[family-name:var(--font-display)] text-[clamp(22px,2.6vw,30px)] font-light tracking-wide text-[var(--text)]">
              Her <span className="italic text-[var(--amber)]">Settings</span>
            </h1>
            <p className="mt-0.5 text-[11px] font-light tracking-wide text-[var(--text-dim)]">
              how she speaks to you, without changing who she is
            </p>
          </div>
          <button
            type="submit"
            form="settings-form"
            disabled={!dirty || saving}
            className="inline-flex h-10 items-center gap-2 rounded-lg bg-[var(--amber)] px-4 text-[12px] font-medium text-[#1A0F08] transition hover:bg-[var(--amber-soft)] active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-40 max-sm:w-10 max-sm:justify-center max-sm:px-0"
          >
            {saved ? <Check className="h-4 w-4" /> : <Save className="h-4 w-4" />}
            <span className="max-sm:hidden">
              {saving ? "Saving…" : saved ? "Saved" : "Save changes"}
            </span>
          </button>
        </header>

        <div className="relative z-10 flex-1 overflow-y-auto px-7 py-5 [scrollbar-color:var(--surface3)_transparent] [scrollbar-width:thin] max-sm:px-4">
          <form
            id="settings-form"
            onSubmit={submit}
            className="mx-auto w-full max-w-[900px] pb-8"
          >
            {error && (
              <div className="mb-4 rounded-lg border border-red-900/40 bg-red-950/20 px-4 py-3 text-[12px] text-red-300">
                {error}
              </div>
            )}

            <section className="mb-4 rounded-xl border border-[var(--border)] bg-[var(--surface)] p-5 max-sm:p-4">
              <div className="flex items-start justify-between gap-4 border-b border-[var(--border)] pb-3">
                <div>
                  <h2 className="font-[family-name:var(--font-display)] text-[15px] font-light italic tracking-wide text-[var(--amber-soft)]">
                    Model usage
                  </h2>
                  <p className="mt-1 text-[10px] leading-4 text-[var(--text-dim)]">
                    Exact costs reported by OpenRouter for completed model calls.
                  </p>
                </div>
                <span className="rounded-full border border-[var(--border2)] bg-[var(--surface2)] px-2.5 py-1 text-[9px] uppercase tracking-[0.1em] text-[var(--text-dim)]">
                  USD
                </span>
              </div>
              {usageError ? (
                <p className="mt-4 text-[11px] text-red-300">{usageError}</p>
              ) : (
                <div className="mt-4 grid gap-2 sm:grid-cols-3">
                  {[
                    ["Today", usage?.today],
                    ["This month", usage?.thisMonth],
                    ["All time", usage?.allTime],
                  ].map(([label, period]) => (
                    <div key={label as string} className="rounded-lg border border-[var(--border)] bg-[var(--surface2)] px-3.5 py-3">
                      <span className="block text-[10px] text-[var(--text-dim)]">{label as string}</span>
                      <span className="mt-1 block text-[16px] font-light text-[var(--text)]">
                        {period ? formatUsd((period as UsagePeriod).totalUsd) : "…"}
                      </span>
                      {period && (
                        <span className="mt-1 block text-[9px] text-[var(--text-dim)]">
                          Thought {formatUsd((period as UsagePeriod).byPhase.thought)} · Voice {formatUsd((period as UsagePeriod).byPhase.voice)}
                        </span>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </section>

            <section className="mb-4 rounded-xl border border-[var(--border)] bg-[var(--surface)] p-5 max-sm:p-4">
              <h2 className="border-b border-[var(--border)] pb-3 font-[family-name:var(--font-display)] text-[15px] font-light italic tracking-wide text-[var(--amber-soft)]">
                You
              </h2>
              <div className="mt-4 grid gap-4 sm:grid-cols-2">
                <label className="text-[12px] text-[var(--text-secondary)]">
                  Display name
                  <input
                    required
                    maxLength={80}
                    value={draft.displayName}
                    onChange={(event) =>
                      setDraft({ ...draft, displayName: event.target.value })
                    }
                    className={inputClassName}
                  />
                </label>
                <label className="text-[12px] text-[var(--text-secondary)]">
                  What she calls you
                  <input
                    maxLength={120}
                    value={draft.preferredUserName}
                    onChange={(event) =>
                      setDraft({
                        ...draft,
                        preferredUserName: event.target.value,
                      })
                    }
                    className={inputClassName}
                  />
                </label>
                <label className="text-[12px] text-[var(--text-secondary)] sm:col-span-2">
                  Timezone
                  <span className="relative block">
                    <select
                      required
                      value={draft.timezone}
                      onChange={(event) =>
                        setDraft({ ...draft, timezone: event.target.value })
                      }
                      className={`${inputClassName} cursor-pointer appearance-none pr-10`}
                    >
                      {supportedTimezones.map((timezone) => (
                        <option key={timezone} value={timezone}>
                          {timezone.replaceAll("_", " ")}
                        </option>
                      ))}
                    </select>
                    <span className="pointer-events-none absolute right-3.5 bottom-3 text-[10px] text-[var(--text-dim)]">
                      ▾
                    </span>
                  </span>
                </label>
              </div>
            </section>

            <section className="mb-4 rounded-xl border border-[var(--border)] bg-[var(--surface)] p-5 max-sm:p-4">
              <div className="flex items-start justify-between gap-4 border-b border-[var(--border)] pb-3">
                <div>
                  <h2 className="font-[family-name:var(--font-display)] text-[15px] font-light italic tracking-wide text-[var(--amber-soft)]">
                    Her voice
                  </h2>
                  <p className="mt-1 text-[10px] text-[var(--text-dim)]">
                    These are additions to Cantarella&apos;s protected core, not a replacement.
                  </p>
                </div>
                <span className="shrink-0 rounded-full border border-[rgba(122,158,122,0.2)] bg-[rgba(122,158,122,0.08)] px-2.5 py-1 text-[9px] uppercase tracking-[0.1em] text-[#91B091]">
                  SOUL protected
                </span>
              </div>

              <div className="mt-4 grid gap-4 sm:grid-cols-2">
                <label className="text-[12px] text-[var(--text-secondary)]">
                  Her name
                  <input
                    required
                    maxLength={80}
                    value={draft.personaName}
                    onChange={(event) =>
                      setDraft({ ...draft, personaName: event.target.value })
                    }
                    className={inputClassName}
                  />
                </label>
                <label className="text-[12px] text-[var(--text-secondary)]">
                  Endearment preference
                  <select
                    value={draft.endearment}
                    onChange={(event) =>
                      setDraft({
                        ...draft,
                        endearment: event.target.value as EndearmentId,
                      })
                    }
                    className={`${inputClassName} cursor-pointer`}
                  >
                    {endearmentOptions.map((option) => (
                      <option key={option.id} value={option.id}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </label>

                <div className="sm:col-span-2">
                  <div className="mb-2 text-[12px] text-[var(--text-secondary)]">
                    Voice direction
                  </div>
                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                    {voicePresets.map((preset) => {
                      const selected = draft.voiceDirection === preset.id;
                      return (
                        <button
                          key={preset.id}
                          type="button"
                          aria-pressed={selected}
                          onClick={() =>
                            setDraft({ ...draft, voiceDirection: preset.id })
                          }
                          className={`rounded-lg border px-3 py-2.5 text-left transition ${
                            selected
                              ? "border-[rgba(201,147,90,0.3)] bg-[var(--amber-dim)]"
                              : "border-[var(--border)] bg-[var(--surface2)] hover:border-[var(--border2)]"
                          }`}
                        >
                          <span
                            className={`block text-[11px] font-medium ${
                              selected
                                ? "text-[var(--amber-soft)]"
                                : "text-[var(--text)]"
                            }`}
                          >
                            {preset.label}
                          </span>
                          <span className="mt-0.5 block text-[9px] leading-4 text-[var(--text-dim)]">
                            {preset.description}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </div>

                <label className="flex flex-col text-[12px] text-[var(--text-secondary)] sm:col-span-2">
                  Extra voice guidance <span className="text-[var(--text-dim)]">Optional</span>
                  <textarea
                    maxLength={4000}
                    rows={3}
                    value={draft.customStyle}
                    onChange={(event) =>
                      setDraft({ ...draft, customStyle: event.target.value })
                    }
                    placeholder="e.g. gentler when I'm stressed, more sarcastic about work..."
                    className={`${inputClassName} resize-none leading-[1.6]`}
                  />
                  <span className="mt-1.5 text-[10px] leading-4 text-[var(--text-dim)]">
                    Your instruction wins only where it directly conflicts with the core or selected direction.
                  </span>
                </label>
              </div>
            </section>

            <section className="mb-4 rounded-xl border border-[var(--border)] bg-[var(--surface)] p-5 max-sm:p-4">
              <div className="flex items-center justify-between gap-5">
                <div className="flex min-w-0 items-start gap-3">
                  <span className="mt-0.5 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-[var(--border2)] bg-[var(--surface2)] text-[var(--amber-soft)]">
                    <Bell className="h-3.5 w-3.5" strokeWidth={1.6} />
                  </span>
                  <div>
                    <h2 className="font-[family-name:var(--font-display)] text-[15px] font-light italic tracking-wide text-[var(--amber-soft)]">
                      Desktop messages
                    </h2>
                    <p className="mt-1 text-[11px] leading-5 text-[var(--text-dim)]">
                      Get a browser alert when Cantarella replies while she is open in a background tab.
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => void enableDesktopNotifications()}
                  disabled={
                    notificationPermission === "granted" ||
                    notificationPermission === "unsupported"
                  }
                  className="shrink-0 rounded-lg border border-[rgba(201,147,90,0.28)] bg-[var(--amber-dim)] px-3 py-2 text-[10px] font-medium text-[var(--amber-soft)] transition hover:border-[rgba(201,147,90,0.5)] hover:bg-[rgba(201,147,90,0.12)] disabled:cursor-default disabled:opacity-60"
                >
                  {notificationPermission === "granted"
                    ? "Enabled"
                    : notificationPermission === "denied"
                      ? "Blocked in browser"
                      : notificationPermission === "unsupported"
                        ? "Not supported"
                        : "Enable"}
                </button>
              </div>
            </section>

            <section className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-5 max-sm:p-4">
              <h2 className="border-b border-[var(--border)] pb-3 font-[family-name:var(--font-display)] text-[15px] font-light italic tracking-wide text-[var(--amber-soft)]">
                Boundaries
              </h2>
              <p className="mt-3 text-[11px] leading-5 text-[var(--text-dim)]">
                Explicit boundaries have the highest priority when anything conflicts.
              </p>
              <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3">
                {commonBoundaries.map((boundary) => {
                  const selected = draft.selectedBoundaries.includes(boundary);
                  return (
                    <button
                      key={boundary}
                      type="button"
                      aria-pressed={selected}
                      onClick={() =>
                        setDraft({
                          ...draft,
                          selectedBoundaries: selected
                            ? draft.selectedBoundaries.filter(
                                (item) => item !== boundary,
                              )
                            : [...draft.selectedBoundaries, boundary],
                        })
                      }
                      className={`rounded-lg border px-3 py-2.5 text-[10px] transition ${
                        selected
                          ? "border-[rgba(201,147,90,0.3)] bg-[var(--amber-dim)] text-[var(--amber-soft)]"
                          : "border-[var(--border)] bg-[var(--surface2)] text-[var(--text-secondary)] hover:border-[var(--border2)]"
                      }`}
                    >
                      {boundary.replace(/^Never /, "No ")}
                    </button>
                  );
                })}
              </div>
              <label className="mt-4 block text-[12px] text-[var(--text-secondary)]">
                Custom boundaries <span className="text-[var(--text-dim)]">Optional</span>
                <textarea
                  rows={4}
                  maxLength={3000}
                  value={draft.customBoundaries}
                  onChange={(event) =>
                    setDraft({ ...draft, customBoundaries: event.target.value })
                  }
                  placeholder={"don't bring up my family unless I do\nnever joke about my work"}
                  className={`${inputClassName} resize-none leading-[1.6]`}
                />
                <span className="mt-1.5 block text-[10px] text-[var(--text-dim)]">
                  One boundary per line.
                </span>
              </label>
            </section>
          </form>
        </div>
      </main>
    </div>
  );
}
