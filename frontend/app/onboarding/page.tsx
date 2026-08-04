"use client";

import { useAuth0 } from "@auth0/auth0-react";
import { useEffect, useState, type FormEvent } from "react";

import { useAuthSession } from "../auth/AuthBootstrap";

const inputClassName =
  "mt-2 w-full rounded-lg border border-[var(--border2)] bg-[var(--surface2)] px-3.5 py-2.5 text-[13px] font-light text-[var(--text)] outline-none transition placeholder:italic placeholder:text-[var(--text-dim)] focus:border-[rgba(201,147,90,0.35)] focus:shadow-[0_0_0_3px_rgba(201,147,90,0.05)]";

type OnboardingStep = 1 | 2 | 3;

const voicePresets = [
  {
    id: "default",
    label: "Default",
    description: "Warm, direct, human",
  },
  {
    id: "softer",
    label: "Softer",
    description: "Gentler when it matters",
  },
  {
    id: "firmer",
    label: "Firmer",
    description: "Blunt, no excuses",
  },
  {
    id: "playful",
    label: "Playful",
    description: "Teasing, still grounded",
  },
  {
    id: "nurturing",
    label: "Nurturing",
    description: "Protective, mommy-like",
  },
  {
    id: "intimate",
    label: "Intimate",
    description: "Closer, lightly seductive",
  },
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
    instruction: "Never use pet names or endearments; use my preferred name instead.",
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

export default function OnboardingPage() {
  const { getAccessTokenSilently, user } = useAuth0();
  const { account, refreshAccount } = useAuthSession();
  const auth0Name = user?.given_name ?? user?.name ?? "";
  const [displayName, setDisplayName] = useState(auth0Name);
  const [timezone, setTimezone] = useState("UTC");
  const [personaName, setPersonaName] = useState(
    account?.persona.name ?? "Cantarella",
  );
  const [voicePreset, setVoicePreset] =
    useState<VoicePresetId>("default");
  const [customStyle, setCustomStyle] = useState("");
  const [preferredUserName, setPreferredUserName] = useState(auth0Name);
  const [endearmentPreference, setEndearmentPreference] =
    useState<EndearmentId>("natural");
  const [selectedBoundaries, setSelectedBoundaries] = useState<string[]>([]);
  const [boundaries, setBoundaries] = useState("");
  const [step, setStep] = useState<OnboardingStep>(1);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");

  useEffect(() => {
    const detectedTimezone =
      Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";

    if (supportedTimezones.includes(detectedTimezone)) {
      setTimezone(detectedTimezone);
    }
  }, []);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (step < 3) {
      setErrorMessage("");
      setStep((step + 1) as OnboardingStep);
      return;
    }

    const apiUrl = process.env.NEXT_PUBLIC_API_URL;

    if (!apiUrl) {
      setErrorMessage("NEXT_PUBLIC_API_URL is not configured");
      return;
    }

    setIsSubmitting(true);
    setErrorMessage("");

    try {
      const selectedEndearment =
        endearmentOptions.find(
          (option) => option.id === endearmentPreference,
        ) ?? endearmentOptions[0];
      const customBoundaries = boundaries
        .split("\n")
        .map((boundary) => boundary.trim())
        .filter(Boolean);
      const finalBoundaries = [
        ...new Set([...selectedBoundaries, ...customBoundaries]),
      ];
      const token = await getAccessTokenSilently();
      const response = await fetch(`${apiUrl}/api/v1/onboarding`, {
        method: "PUT",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          displayName,
          timezone,
          persona: {
            name: personaName.trim() || "Cantarella",
            voiceDirection: voicePreset,
            customStyle: customStyle.trim(),
            preferredUserName:
              preferredUserName.trim() || displayName.trim() || null,
            endearmentPreference: selectedEndearment.instruction,
            boundaries: finalBoundaries,
          },
        }),
      });
      const payload = await response.json().catch(() => null);

      if (!response.ok) {
        throw new Error(
          payload?.error?.message ?? "Onboarding could not be completed.",
        );
      }

      await refreshAccount();
    } catch (error) {
      setErrorMessage(
        error instanceof Error
          ? error.message
          : "Onboarding could not be completed.",
      );
      setIsSubmitting(false);
    }
  };

  return (
    <main className="relative h-dvh w-full overflow-y-auto bg-[var(--bg)] font-[family-name:var(--font-body)] text-[var(--text)] lg:overflow-hidden">
      <div className="pointer-events-none absolute inset-x-0 top-0 h-[45vh] bg-[radial-gradient(ellipse_at_50%_0%,rgba(201,147,90,0.11),transparent_68%)]" />
      <div className="pointer-events-none absolute right-[-10vw] bottom-[-20vh] h-[55vh] w-[55vw] bg-[radial-gradient(ellipse_at_center,rgba(201,147,90,0.035),transparent_70%)]" />

      <section className="relative mx-auto flex min-h-full w-full max-w-[1180px] flex-col px-5 sm:px-8 lg:h-dvh lg:min-h-0 lg:overflow-hidden">
        <header className="flex shrink-0 flex-col items-center pt-7 pb-5 text-center lg:pt-5 lg:pb-4">
          <div className="flex items-center gap-2.5">
            <div className="relative flex h-9 w-9 items-center justify-center rounded-full border border-[var(--border2)] bg-[linear-gradient(135deg,#2A1F14,#3D2A18)] font-[family-name:var(--font-display)] text-base text-[var(--amber)]">
              C
              <span className="absolute right-0 bottom-0 h-2 w-2 rounded-full border border-[var(--bg)] bg-[#4CAF50]" />
            </div>
            <div className="text-left">
              <div className="font-[family-name:var(--font-display)] text-[17px] font-light italic tracking-[0.04em]">
                Cantarella
              </div>
              <div className="text-[9px] tracking-[0.08em] text-[var(--text-dim)] uppercase">
                First meeting
              </div>
            </div>
          </div>

          <div className="mt-4 flex items-center gap-4">
            <span className="h-px w-10 bg-gradient-to-r from-transparent to-[var(--border2)]" />
            <span className="h-1 w-1 rounded-full bg-[var(--amber)] opacity-70" />
            <span className="h-px w-10 bg-gradient-to-l from-transparent to-[var(--border2)]" />
          </div>

          <h1 className="mt-3 font-[family-name:var(--font-display)] text-[30px] leading-none font-light tracking-[0.04em] sm:text-[34px]">
            Make her <span className="text-[var(--amber)] italic">yours</span>
          </h1>
          <p className="mt-2 text-[11px] font-light tracking-[0.03em] text-[var(--text-dim)] sm:text-xs">
            Set the defaults now — everything stays editable from settings.
          </p>
        </header>

        <form
          onSubmit={submit}
          className="mx-auto flex w-full max-w-[760px] flex-1 flex-col pb-8 lg:min-h-0 lg:pb-5"
        >
          <div className="mb-4 flex shrink-0 items-center justify-center gap-2">
            {([1, 2, 3] as const).map((item) => (
              <div key={item} className="flex items-center gap-2">
                <span
                  className={`flex h-6 w-6 items-center justify-center rounded-full border text-[10px] transition ${
                    item <= step
                      ? "border-[rgba(201,147,90,0.3)] bg-[var(--amber-dim)] text-[var(--amber-soft)]"
                      : "border-[var(--border)] bg-[var(--surface)] text-[var(--text-dim)]"
                  }`}
                >
                  {item}
                </span>
                {item < 3 && (
                  <span
                    className={`h-px w-10 transition sm:w-16 ${
                      item < step ? "bg-[var(--amber)]/40" : "bg-[var(--border)]"
                    }`}
                  />
                )}
              </div>
            ))}
          </div>

          <div
            key={step}
            className="animate-fadeup flex min-h-[330px] flex-1 flex-col border-y border-[var(--border)] py-5 lg:min-h-0"
          >
            {step === 1 && (
              <div className="mx-auto flex w-full max-w-[620px] flex-col">
                <div className="mb-5 text-center">
                  <div className="text-[10px] font-medium tracking-[0.12em] text-[var(--amber)] uppercase">
                    Step 1 of 3
                  </div>
                  <h2 className="mt-2 font-[family-name:var(--font-display)] text-[24px] font-light italic text-[var(--text)]">
                    First, you
                  </h2>
                  <p className="mt-1 text-[11px] text-[var(--text-dim)]">
                    Just enough context to know who she&apos;s talking to.
                  </p>
                </div>

                <div className="grid gap-4 sm:grid-cols-2">
                  <label className="text-[12px] text-[var(--text-secondary)]">
                    Your display name
                    <input
                      required
                      maxLength={80}
                      value={displayName}
                      onChange={(event) => setDisplayName(event.target.value)}
                      className={inputClassName}
                    />
                  </label>

                  <label className="text-[12px] text-[var(--text-secondary)]">
                    What she calls you
                    <input
                      maxLength={120}
                      value={preferredUserName}
                      onChange={(event) =>
                        setPreferredUserName(event.target.value)
                      }
                      className={inputClassName}
                    />
                  </label>

                  <label className="text-[12px] text-[var(--text-secondary)] sm:col-span-2">
                    <span className="flex items-center justify-between gap-3">
                      <span>Your timezone</span>
                      <span className="text-[9px] tracking-[0.05em] text-[var(--text-dim)] uppercase">
                        Detected automatically
                      </span>
                    </span>
                    <span className="relative block">
                      <select
                      required
                      value={timezone}
                      onChange={(event) => setTimezone(event.target.value)}
                        className={`${inputClassName} cursor-pointer appearance-none pr-10`}
                      >
                        {supportedTimezones.map((timeZone) => (
                          <option
                            key={timeZone}
                            value={timeZone}
                            className="bg-[var(--surface2)] text-[var(--text)]"
                          >
                            {timeZone.replaceAll("_", " ")}
                          </option>
                        ))}
                      </select>
                      <svg
                        aria-hidden="true"
                        viewBox="0 0 16 16"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="1.5"
                        className="pointer-events-none absolute right-3.5 bottom-3 h-3.5 w-3.5 text-[var(--text-dim)]"
                      >
                        <path
                          d="m4 6 4 4 4-4"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        />
                      </svg>
                    </span>
                  </label>
                </div>
              </div>
            )}

            {step === 2 && (
              <div className="mx-auto flex w-full max-w-[620px] flex-col">
                <div className="mb-5 text-center">
                  <div className="text-[10px] font-medium tracking-[0.12em] text-[var(--amber)] uppercase">
                    Step 2 of 3
                  </div>
                  <h2 className="mt-2 font-[family-name:var(--font-display)] text-[24px] font-light italic text-[var(--text)]">
                    Give her a voice
                  </h2>
                  <p className="mt-1 text-[11px] text-[var(--text-dim)]">
                    Start with a direction. Add details only if you want to.
                  </p>
                </div>

                <div className="grid gap-4 sm:grid-cols-2">
                  <label className="text-[12px] text-[var(--text-secondary)]">
                    Her name
                    <input
                      required
                      maxLength={80}
                      value={personaName}
                      onChange={(event) => setPersonaName(event.target.value)}
                      className={inputClassName}
                    />
                  </label>

                  <label className="text-[12px] text-[var(--text-secondary)]">
                    Endearment preference
                    <select
                      value={endearmentPreference}
                      onChange={(event) =>
                        setEndearmentPreference(
                          event.target.value as EndearmentId,
                        )
                      }
                      className={inputClassName}
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
                        const isSelected = voicePreset === preset.id;

                        return (
                          <button
                            key={preset.id}
                            type="button"
                            aria-pressed={isSelected}
                            onClick={() => setVoicePreset(preset.id)}
                            className={`rounded-lg border px-3 py-2.5 text-left transition ${
                              isSelected
                                ? "border-[rgba(201,147,90,0.3)] bg-[var(--amber-dim)]"
                                : "border-[var(--border)] bg-[var(--surface)] hover:border-[var(--border2)] hover:bg-[var(--surface2)]"
                            }`}
                          >
                            <span
                              className={`block text-[11px] font-medium ${
                                isSelected
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
                    Anything more? <span className="text-[var(--text-dim)]">Optional</span>
                    <textarea
                      maxLength={4000}
                      rows={2}
                      value={customStyle}
                      onChange={(event) => setCustomStyle(event.target.value)}
                      placeholder="e.g. gentler when I'm stressed, more sarcastic about work..."
                      className={`${inputClassName} resize-none leading-[1.6]`}
                    />
                  </label>
                </div>
              </div>
            )}

            {step === 3 && (
              <div className="mx-auto flex w-full max-w-[620px] flex-col py-1 sm:py-2">
                <div className="mb-6 text-center">
                  <div className="text-[10px] font-medium tracking-[0.12em] text-[var(--amber)] uppercase">
                    Step 3 of 3
                  </div>
                  <h2 className="mt-2 font-[family-name:var(--font-display)] text-[24px] font-light italic text-[var(--text)]">
                    Draw the lines
                  </h2>
                  <p className="mt-1 text-[11px] text-[var(--text-dim)]">
                    Pick common limits, then add anything personal.
                  </p>
                </div>

                <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3">
                  {commonBoundaries.map((boundary) => {
                    const isSelected = selectedBoundaries.includes(boundary);

                    return (
                      <button
                        key={boundary}
                        type="button"
                        aria-pressed={isSelected}
                        onClick={() =>
                          setSelectedBoundaries((current) =>
                            current.includes(boundary)
                              ? current.filter((item) => item !== boundary)
                              : [...current, boundary],
                          )
                        }
                        className={`rounded-lg border px-3 py-2.5 text-[10px] transition ${
                          isSelected
                            ? "border-[rgba(201,147,90,0.3)] bg-[var(--amber-dim)] text-[var(--amber-soft)]"
                            : "border-[var(--border)] bg-[var(--surface)] text-[var(--text-secondary)] hover:border-[var(--border2)] hover:bg-[var(--surface2)]"
                        }`}
                      >
                        {boundary.replace(/^Never /, "No ")}
                      </button>
                    );
                  })}
                </div>

                <label className="mt-5 block text-[12px] text-[var(--text-secondary)]">
                  Custom boundaries <span className="text-[var(--text-dim)]">Optional</span>
                  <textarea
                    rows={3}
                    maxLength={3000}
                    value={boundaries}
                    onChange={(event) => setBoundaries(event.target.value)}
                    placeholder={"don't bring up my family unless I do\nnever joke about my work"}
                    className={`${inputClassName} resize-none leading-[1.6]`}
                  />
                  <span className="mt-1.5 block text-[10px] text-[var(--text-dim)]">
                    One per line. Leaving this blank is completely fine.
                  </span>
                </label>

                <div className="mt-5 flex flex-wrap items-center justify-center gap-2">
                  <span className="rounded-full border border-[rgba(201,147,90,0.2)] bg-[var(--amber-dim)] px-3 py-1 text-[10px] text-[var(--amber-soft)]">
                    {personaName}
                  </span>
                  <span className="rounded-full border border-[var(--border)] bg-[var(--surface)] px-3 py-1 text-[10px] text-[var(--text-secondary)]">
                    calls you {preferredUserName || displayName}
                  </span>
                  <span className="rounded-full border border-[var(--border)] bg-[var(--surface)] px-3 py-1 text-[10px] text-[var(--text-secondary)]">
                    {timezone}
                  </span>
                  <span className="rounded-full border border-[var(--border)] bg-[var(--surface)] px-3 py-1 text-[10px] text-[var(--text-secondary)]">
                    {voicePresets.find((preset) => preset.id === voicePreset)
                      ?.label ?? "Default"} voice
                  </span>
                </div>
              </div>
            )}
          </div>

          <div className="shrink-0 pt-4">
            {errorMessage && (
              <p className="mb-3 rounded-lg border border-red-900/40 bg-red-950/20 px-4 py-2.5 text-[12px] text-red-300">
                {errorMessage}
              </p>
            )}

            <div className="flex items-center justify-between">
              {step > 1 ? (
                <button
                  type="button"
                  onClick={() => {
                    setErrorMessage("");
                    setStep((step - 1) as OnboardingStep);
                  }}
                  disabled={isSubmitting}
                  className="rounded-lg border border-[var(--border)] bg-transparent px-4 py-2.5 text-[12px] text-[var(--text-secondary)] transition hover:border-[var(--border2)] hover:bg-[var(--surface)] hover:text-[var(--text)] disabled:opacity-50"
                >
                  Back
                </button>
              ) : (
                <span className="text-[10px] tracking-[0.06em] text-[var(--text-dim)] uppercase">
                  Saved at the end
                </span>
              )}

              <button
                type="submit"
                disabled={isSubmitting}
                className={`rounded-[9px] px-5 py-2.5 text-[12px] font-medium transition active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50 ${
                  step === 3
                    ? "bg-[var(--amber)] text-[#1A0F08] hover:bg-[var(--amber-soft)]"
                    : "border border-[var(--border2)] bg-[var(--surface)] text-[var(--amber-soft)] hover:bg-[var(--surface2)]"
                }`}
              >
                {step === 3
                  ? isSubmitting
                    ? "Saving…"
                    : "Start talking to her"
                  : "Continue"}
              </button>
            </div>
          </div>
        </form>
      </section>
    </main>
  );
}
