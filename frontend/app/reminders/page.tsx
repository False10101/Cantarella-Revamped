"use client";

import { useAuth0 } from "@auth0/auth0-react";
import {
  AlertTriangle,
  Check,
  Clock3,
  Pause,
  Pencil,
  Play,
  Plus,
  Timer,
  Trash2,
  X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";

import { useAuthSession } from "../auth/AuthBootstrap";
import Navbar from "../navbar";

type Recurrence = "daily" | "weekly" | "monthly" | null;
type ReminderStatus = "scheduled" | "paused" | "completed" | "cancelled";

type ReminderRecord = {
  id: string;
  title: string;
  timezone: string;
  scheduledFor: string;
  recurrence: Recurrence;
  nextRunAt: string | null;
  status: ReminderStatus;
  lastFiredAt: string | null;
  createdAt: string;
  updatedAt: string;
};

type ReminderDraft = {
  title: string;
  mode: "schedule" | "timer";
  scheduledFor: string;
  duration: number;
  durationUnit: "minutes" | "hours" | "days";
  recurrence: Recurrence;
};

type ApiError = { error?: { message?: string } };

const emptyDraft = (timezone?: string): ReminderDraft => ({
  title: "",
  mode: "schedule",
  scheduledFor: localInputValue(
    new Date(Date.now() + 60 * 60_000),
    timezone,
  ),
  duration: 10,
  durationUnit: "minutes",
  recurrence: null,
});

const inputClassName =
  "h-10 w-full rounded-lg border border-[var(--border2)] bg-[var(--surface2)] px-3 text-[12px] font-light text-[var(--text)] outline-none transition focus:border-[rgba(201,147,90,0.4)] focus:shadow-[0_0_0_3px_rgba(201,147,90,0.05)]";

function localInputValue(value: Date | string, timezone?: string): string {
  const date = value instanceof Date ? value : new Date(value);
  if (timezone) {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    }).formatToParts(date);
    const valueOf = (type: Intl.DateTimeFormatPartTypes) =>
      parts.find((part) => part.type === type)?.value ?? "";
    return `${valueOf("year")}-${valueOf("month")}-${valueOf("day")}T${valueOf("hour")}:${valueOf("minute")}`;
  }
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}

function scheduledDate(draft: ReminderDraft): Date {
  if (draft.mode === "schedule") return new Date(draft.scheduledFor);
  const unitMillis =
    draft.durationUnit === "minutes"
      ? 60_000
      : draft.durationUnit === "hours"
        ? 60 * 60_000
        : 24 * 60 * 60_000;
  return new Date(Date.now() + draft.duration * unitMillis);
}

function draftFor(reminder: ReminderRecord, timezone?: string): ReminderDraft {
  return {
    title: reminder.title,
    mode: "schedule",
    scheduledFor: localInputValue(
      reminder.nextRunAt ?? reminder.scheduledFor,
      timezone,
    ),
    duration: 10,
    durationUnit: "minutes",
    recurrence: reminder.recurrence,
  };
}

function ReminderEditor({
  draft,
  onChange,
  onCancel,
  onSave,
  saving,
  editing,
  timezone,
}: {
  draft: ReminderDraft;
  onChange: (draft: ReminderDraft) => void;
  onCancel: () => void;
  onSave: () => void;
  saving: boolean;
  editing: boolean;
  timezone: string;
}) {
  const invalid =
    !draft.title.trim() ||
    (draft.mode === "schedule" && !draft.scheduledFor) ||
    (draft.mode === "timer" && (!draft.duration || draft.duration < 1));

  return (
    <div className="rounded-xl border border-[var(--border2)] bg-[var(--surface)] p-4 shadow-[0_16px_50px_rgba(0,0,0,0.18)]">
      {!editing && (
        <div className="mb-4 grid grid-cols-2 gap-2 rounded-lg bg-[var(--surface2)] p-1">
          <button
            type="button"
            onClick={() => onChange({ ...draft, mode: "schedule" })}
            className={`flex h-9 items-center justify-center gap-2 rounded-md text-[11px] transition ${
              draft.mode === "schedule"
                ? "bg-[var(--amber-dim)] text-[var(--amber-soft)]"
                : "text-[var(--text-dim)] hover:text-[var(--text-secondary)]"
            }`}
          >
            <Clock3 className="h-3.5 w-3.5" />
            Date & time
          </button>
          <button
            type="button"
            onClick={() =>
              onChange({ ...draft, mode: "timer", recurrence: null })
            }
            className={`flex h-9 items-center justify-center gap-2 rounded-md text-[11px] transition ${
              draft.mode === "timer"
                ? "bg-[var(--amber-dim)] text-[var(--amber-soft)]"
                : "text-[var(--text-dim)] hover:text-[var(--text-secondary)]"
            }`}
          >
            <Timer className="h-3.5 w-3.5" />
            Countdown timer
          </button>
        </div>
      )}

      <label className="block text-[10px] uppercase tracking-[0.12em] text-[var(--text-dim)]">
        What should she remind you?
        <input
          autoFocus
          required
          maxLength={300}
          value={draft.title}
          onChange={(event) => onChange({ ...draft, title: event.target.value })}
          placeholder="Submit the project proposal"
          className={`${inputClassName} mt-1.5 normal-case tracking-normal placeholder:text-[var(--text-dim)]`}
        />
      </label>

      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        {draft.mode === "schedule" ? (
          <label className="text-[10px] uppercase tracking-[0.12em] text-[var(--text-dim)]">
            Date and time
            <input
              required
              type="datetime-local"
              value={draft.scheduledFor}
              onChange={(event) =>
                onChange({ ...draft, scheduledFor: event.target.value })
              }
              className={`${inputClassName} mt-1.5 normal-case tracking-normal`}
            />
          </label>
        ) : (
          <div className="text-[10px] uppercase tracking-[0.12em] text-[var(--text-dim)]">
            Duration
            <div className="mt-1.5 grid grid-cols-[1fr_130px] gap-2">
              <input
                required
                type="number"
                min={1}
                max={10080}
                value={draft.duration}
                onChange={(event) =>
                  onChange({ ...draft, duration: Number(event.target.value) })
                }
                className={`${inputClassName} normal-case tracking-normal`}
              />
              <select
                value={draft.durationUnit}
                onChange={(event) =>
                  onChange({
                    ...draft,
                    durationUnit: event.target.value as ReminderDraft["durationUnit"],
                  })
                }
                className={`${inputClassName} cursor-pointer normal-case tracking-normal`}
              >
                <option value="minutes">Minutes</option>
                <option value="hours">Hours</option>
                <option value="days">Days</option>
              </select>
            </div>
          </div>
        )}

        <label className="text-[10px] uppercase tracking-[0.12em] text-[var(--text-dim)]">
          Repeat
          <select
            value={draft.recurrence ?? "none"}
            disabled={draft.mode === "timer"}
            onChange={(event) =>
              onChange({
                ...draft,
                recurrence:
                  event.target.value === "none"
                    ? null
                    : (event.target.value as Exclude<Recurrence, null>),
              })
            }
            className={`${inputClassName} mt-1.5 cursor-pointer normal-case tracking-normal disabled:opacity-45`}
          >
            <option value="none">One time</option>
            <option value="daily">Every day</option>
            <option value="weekly">Every week</option>
            <option value="monthly">Every month</option>
          </select>
        </label>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-3 border-t border-[var(--border)] pt-3">
        <span className="text-[10px] text-[var(--text-dim)]">
          Timezone: {timezone.replaceAll("_", " ")}
        </span>
        <div className="ml-auto flex gap-2">
          <button
            type="button"
            onClick={onCancel}
            disabled={saving}
            className="inline-flex h-9 items-center gap-2 rounded-lg border border-[var(--border2)] px-3 text-[11px] text-[var(--text-secondary)] transition hover:bg-[var(--surface2)] disabled:opacity-50"
          >
            <X className="h-3.5 w-3.5" /> Cancel
          </button>
          <button
            type="button"
            onClick={onSave}
            disabled={saving || invalid}
            className="inline-flex h-9 items-center gap-2 rounded-lg bg-[var(--amber)] px-3.5 text-[11px] font-medium text-[#1A0F08] transition hover:bg-[var(--amber-soft)] disabled:cursor-not-allowed disabled:opacity-45"
          >
            <Check className="h-3.5 w-3.5" />
            {saving ? "Saving…" : editing ? "Save changes" : "Set reminder"}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function RemindersPage() {
  const { getAccessTokenSilently } = useAuth0();
  const { account } = useAuthSession();
  const [reminders, setReminders] = useState<ReminderRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [filter, setFilter] = useState<"all" | Exclude<ReminderStatus, "cancelled">>("all");
  const [adding, setAdding] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<ReminderDraft>(emptyDraft);
  const [saving, setSaving] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<ReminderRecord | null>(null);
  const [createRequestId, setCreateRequestId] = useState(() =>
    crypto.randomUUID(),
  );

  const apiRequest = useCallback(
    async <T,>(path: string, options?: RequestInit): Promise<T> => {
      const apiUrl = process.env.NEXT_PUBLIC_API_URL;
      if (!apiUrl) throw new Error("NEXT_PUBLIC_API_URL is not configured");
      const token = await getAccessTokenSilently();
      const response = await fetch(`${apiUrl}/api/v1${path}`, {
        ...options,
        headers: {
          Authorization: `Bearer ${token}`,
          ...(options?.body ? { "Content-Type": "application/json" } : {}),
          ...options?.headers,
        },
        cache: "no-store",
      });
      const payload = (await response.json().catch(() => null)) as
        | T
        | ApiError
        | null;
      if (!response.ok) {
        throw new Error(
          (payload as ApiError | null)?.error?.message ??
            "Cantarella couldn't update that reminder.",
        );
      }
      return payload as T;
    },
    [getAccessTokenSilently],
  );

  const loadReminders = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const payload = await apiRequest<{
        data: { reminders: ReminderRecord[] };
      }>("/reminders?limit=200");
      setReminders(payload.data.reminders);
    } catch (loadError) {
      setError(
        loadError instanceof Error
          ? loadError.message
          : "Cantarella couldn't load your reminders.",
      );
    } finally {
      setLoading(false);
    }
  }, [apiRequest]);

  useEffect(() => {
    void loadReminders();
  }, [loadReminders]);

  const visible = useMemo(
    () =>
      reminders.filter(
        (reminder) => filter === "all" || reminder.status === filter,
      ),
    [filter, reminders],
  );

  const grouped = useMemo(
    () => [
      {
        id: "scheduled" as const,
        label: "Upcoming",
        records: visible.filter((reminder) => reminder.status === "scheduled"),
      },
      {
        id: "paused" as const,
        label: "Paused",
        records: visible.filter((reminder) => reminder.status === "paused"),
      },
      {
        id: "completed" as const,
        label: "Completed",
        records: visible.filter((reminder) => reminder.status === "completed"),
      },
    ].filter((group) => group.records.length > 0),
    [visible],
  );

  const formatDate = (value: string) =>
    new Intl.DateTimeFormat("en-US", {
      timeZone: account?.timezone ?? "UTC",
      weekday: "short",
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    }).format(new Date(value));

  const formatTime = (value: string) =>
    new Intl.DateTimeFormat("en-US", {
      timeZone: account?.timezone ?? "UTC",
      hour: "numeric",
      minute: "2-digit",
    }).formatToParts(new Date(value));

  const saveNew = async () => {
    setSaving(true);
    setError("");
    try {
      const scheduledFor = scheduledDate(draft);
      if (draft.mode === "timer" && scheduledFor <= new Date()) {
        throw new Error("Choose a time in the future.");
      }
      const payload = await apiRequest<{ data: { reminder: ReminderRecord } }>(
        "/reminders",
        {
          method: "POST",
          body: JSON.stringify({
            title: draft.title.trim(),
            ...(draft.mode === "schedule"
              ? { scheduledForLocal: draft.scheduledFor }
              : { scheduledFor: scheduledFor.toISOString() }),
            recurrence: draft.mode === "timer" ? null : draft.recurrence,
            clientRequestId: createRequestId,
          }),
        },
      );
      setReminders((current) => [payload.data.reminder, ...current]);
      setAdding(false);
      setDraft(emptyDraft(account?.timezone));
      setCreateRequestId(crypto.randomUUID());
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Reminder save failed.");
    } finally {
      setSaving(false);
    }
  };

  const saveEdit = async () => {
    if (!editingId) return;
    setSaving(true);
    setError("");
    try {
      const payload = await apiRequest<{ data: { reminder: ReminderRecord } }>(
        `/reminders/${editingId}`,
        {
          method: "PATCH",
          body: JSON.stringify({
            title: draft.title.trim(),
            scheduledForLocal: draft.scheduledFor,
            recurrence: draft.recurrence,
          }),
        },
      );
      setReminders((current) =>
        current.map((reminder) =>
          reminder.id === editingId ? payload.data.reminder : reminder,
        ),
      );
      setEditingId(null);
      setDraft(emptyDraft(account?.timezone));
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Reminder update failed.");
    } finally {
      setSaving(false);
    }
  };

  const changeStatus = async (reminder: ReminderRecord) => {
    if (
      reminder.status === "paused" &&
      !reminder.recurrence &&
      new Date(reminder.scheduledFor) <= new Date()
    ) {
      setAdding(false);
      setEditingId(reminder.id);
      setDraft({
        ...draftFor(reminder, account?.timezone),
        scheduledFor: localInputValue(
          new Date(Date.now() + 10 * 60_000),
          account?.timezone,
        ),
      });
      setError("Choose a new time before resuming this reminder.");
      return;
    }

    setSaving(true);
    setError("");
    try {
      const status = reminder.status === "paused" ? "scheduled" : "paused";
      const payload = await apiRequest<{ data: { reminder: ReminderRecord } }>(
        `/reminders/${reminder.id}`,
        { method: "PATCH", body: JSON.stringify({ status }) },
      );
      setReminders((current) =>
        current.map((record) =>
          record.id === reminder.id ? payload.data.reminder : record,
        ),
      );
    } catch (statusError) {
      setError(statusError instanceof Error ? statusError.message : "Status update failed.");
    } finally {
      setSaving(false);
    }
  };

  const deleteReminder = async () => {
    if (!deleteTarget) return;
    setSaving(true);
    setError("");
    try {
      await apiRequest(`/reminders/${deleteTarget.id}`, { method: "DELETE" });
      setReminders((current) =>
        current.filter((reminder) => reminder.id !== deleteTarget.id),
      );
      setDeleteTarget(null);
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : "Reminder deletion failed.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="grid h-screen w-full grid-cols-[260px_1fr] overflow-hidden bg-[var(--bg)] max-[820px]:grid-cols-[76px_1fr]">
      <Navbar />
      <main className="relative flex min-w-0 flex-col overflow-hidden">
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_78%_10%,rgba(201,147,90,0.025),transparent_42%),radial-gradient(ellipse_at_18%_86%,rgba(201,147,90,0.025),transparent_44%)]" />
        <header className="relative z-10 flex shrink-0 items-center justify-between border-b border-[var(--border)] bg-[rgba(12,10,9,0.82)] px-7 py-[18px] backdrop-blur-md max-sm:px-4">
          <div>
            <h1 className="font-[family-name:var(--font-display)] text-[clamp(22px,2.6vw,30px)] font-light tracking-wide text-[var(--text)]">
              Your <span className="italic text-[var(--amber)]">Reminders</span>
            </h1>
            <p className="mt-0.5 text-[11px] font-light tracking-wide text-[var(--text-dim)]">
              she&apos;ll bring it back when the time comes
            </p>
          </div>
          <button
            type="button"
            onClick={() => {
              setEditingId(null);
              setDraft(emptyDraft(account?.timezone));
              setCreateRequestId(crypto.randomUUID());
              setAdding(true);
            }}
            className="inline-flex h-10 items-center gap-2 rounded-lg bg-[var(--amber)] px-4 text-[12px] font-medium text-[#1A0F08] transition hover:bg-[var(--amber-soft)] active:scale-[0.98] max-sm:w-10 max-sm:justify-center max-sm:px-0"
          >
            <Plus className="h-4 w-4" />
            <span className="max-sm:hidden">Set reminder</span>
          </button>
        </header>

        <div className="relative z-10 flex-1 overflow-y-auto px-7 py-5 [scrollbar-color:var(--surface3)_transparent] [scrollbar-width:thin] max-sm:px-4">
          <div className="mx-auto w-full max-w-[960px] pb-8">
            <div className="flex gap-2 overflow-x-auto pb-1 [scrollbar-width:none]">
              {(["all", "scheduled", "paused", "completed"] as const).map(
                (status) => (
                  <button
                    key={status}
                    type="button"
                    onClick={() => setFilter(status)}
                    className={`shrink-0 rounded-full border px-3 py-1.5 text-[10px] uppercase tracking-[0.1em] transition ${
                      filter === status
                        ? "border-[rgba(201,147,90,0.24)] bg-[var(--amber-dim)] text-[var(--amber-soft)]"
                        : "border-[var(--border)] bg-[var(--surface)] text-[var(--text-dim)] hover:border-[var(--border2)]"
                    }`}
                  >
                    {status === "scheduled" ? "Upcoming" : status}
                  </button>
                ),
              )}
            </div>

            {error && (
              <div className="mt-4 flex items-start gap-2.5 rounded-lg border border-[rgba(180,70,70,0.2)] bg-[rgba(180,60,60,0.08)] px-3.5 py-3 text-[12px] text-[#C98A82]">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                <span className="flex-1">{error}</span>
                <button type="button" onClick={() => setError("")}>
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            )}

            {adding && (
              <div className="mt-5">
                <ReminderEditor
                  draft={draft}
                  onChange={setDraft}
                  onCancel={() => {
                    setAdding(false);
                    setDraft(emptyDraft(account?.timezone));
                  }}
                  onSave={() => void saveNew()}
                  saving={saving}
                  editing={false}
                  timezone={account?.timezone ?? "UTC"}
                />
              </div>
            )}

            {loading ? (
              <div className="flex h-52 items-center justify-center gap-2" aria-label="Loading reminders">
                <span className="h-1.5 w-1.5 animate-typing-1 rounded-full bg-[var(--amber)]" />
                <span className="h-1.5 w-1.5 animate-typing-2 rounded-full bg-[var(--amber)]" />
                <span className="h-1.5 w-1.5 animate-typing-3 rounded-full bg-[var(--amber)]" />
              </div>
            ) : grouped.length === 0 ? (
              <div className="mt-10 rounded-xl border border-dashed border-[var(--border2)] bg-[rgba(22,18,16,0.55)] px-6 py-12 text-center">
                <div className="font-[family-name:var(--font-display)] text-xl italic text-[var(--text-secondary)]">
                  Nothing waiting
                </div>
                <p className="mt-2 text-[12px] font-light text-[var(--text-dim)]">
                  Set a date, time, or countdown and she&apos;ll message you when it&apos;s due.
                </p>
              </div>
            ) : (
              <div className="mt-6">
                {grouped.map((group) => (
                  <section key={group.id} className="mb-7">
                    <div className="mb-2.5 flex items-center gap-2 text-[10px] font-medium uppercase tracking-[0.12em] text-[var(--text-dim)]">
                      {group.label}
                      <span className="text-[9px] opacity-60">{group.records.length}</span>
                    </div>
                    <div className="space-y-2">
                      {group.records.map((reminder) => {
                        if (editingId === reminder.id) {
                          return (
                            <ReminderEditor
                              key={reminder.id}
                              draft={draft}
                              onChange={setDraft}
                              onCancel={() => {
                                setEditingId(null);
                                setDraft(emptyDraft(account?.timezone));
                              }}
                              onSave={() => void saveEdit()}
                              saving={saving}
                              editing
                              timezone={account?.timezone ?? "UTC"}
                            />
                          );
                        }

                        const dueAt = reminder.nextRunAt ?? reminder.scheduledFor;
                        const timeParts = formatTime(dueAt);
                        const clock = timeParts.find((part) => part.type === "hour")?.value + ":" + timeParts.find((part) => part.type === "minute")?.value;
                        const dayPeriod = timeParts.find((part) => part.type === "dayPeriod")?.value ?? "";

                        return (
                          <article
                            key={reminder.id}
                            className={`group flex items-center gap-3 rounded-[10px] border border-[var(--border)] bg-[var(--surface)] px-4 py-3.5 transition hover:border-[var(--border2)] ${
                              reminder.status === "completed" ? "opacity-55" : ""
                            }`}
                          >
                            <div className="w-[52px] shrink-0 text-center">
                              <div className="font-[family-name:var(--font-display)] text-[18px] font-light leading-none text-[var(--amber)]">
                                {clock}
                              </div>
                              <div className="mt-1 text-[9px] uppercase text-[var(--text-dim)]">
                                {dayPeriod}
                              </div>
                            </div>
                            <div className="h-9 w-px shrink-0 bg-[var(--border)]" />
                            <div className="min-w-0 flex-1">
                              <div className="text-[13px] font-normal text-[var(--text)]">
                                {reminder.title}
                              </div>
                              <div className="mt-1 text-[10px] text-[var(--text-dim)]">
                                {reminder.recurrence
                                  ? reminder.recurrence === "daily"
                                    ? "Every day"
                                    : reminder.recurrence === "weekly"
                                      ? "Every week"
                                      : "Every month"
                                  : "One time"}
                                <span className="mx-1.5 opacity-50">·</span>
                                {formatDate(dueAt)}
                              </div>
                            </div>
                            <span className={`shrink-0 rounded-full border px-2.5 py-1 text-[9px] uppercase tracking-[0.08em] ${
                              reminder.status === "scheduled"
                                ? "border-[rgba(201,147,90,0.2)] bg-[var(--amber-dim)] text-[var(--amber-soft)]"
                                : reminder.status === "paused"
                                  ? "border-[rgba(144,144,208,0.2)] bg-[rgba(100,100,180,0.1)] text-[#9090D0]"
                                  : "border-[rgba(122,158,122,0.2)] bg-[rgba(80,130,80,0.08)] text-[#80A880]"
                            }`}>
                              {reminder.status}
                            </span>
                            <div className="flex shrink-0 gap-1 opacity-60 transition group-hover:opacity-100 max-sm:opacity-100">
                              {reminder.status !== "completed" && (
                                <button
                                  type="button"
                                  title={reminder.status === "paused" ? "Resume" : "Pause"}
                                  aria-label={reminder.status === "paused" ? "Resume reminder" : "Pause reminder"}
                                  disabled={saving}
                                  onClick={() => void changeStatus(reminder)}
                                  className="flex h-7 w-7 items-center justify-center rounded-md text-[var(--text-dim)] transition hover:bg-[var(--surface2)] hover:text-[var(--amber-soft)]"
                                >
                                  {reminder.status === "paused" ? <Play className="h-3.5 w-3.5" /> : <Pause className="h-3.5 w-3.5" />}
                                </button>
                              )}
                              {reminder.status !== "completed" && <button
                                type="button"
                                title="Edit"
                                aria-label="Edit reminder"
                                onClick={() => {
                                  setAdding(false);
                                  setEditingId(reminder.id);
                                  setDraft(draftFor(reminder, account?.timezone));
                                }}
                                className="flex h-7 w-7 items-center justify-center rounded-md text-[var(--text-dim)] transition hover:bg-[var(--surface2)] hover:text-[var(--amber-soft)]"
                              >
                                <Pencil className="h-3.5 w-3.5" />
                              </button>}
                              <button
                                type="button"
                                title="Delete"
                                aria-label="Delete reminder"
                                onClick={() => setDeleteTarget(reminder)}
                                className="flex h-7 w-7 items-center justify-center rounded-md text-[var(--text-dim)] transition hover:bg-[rgba(180,60,60,0.08)] hover:text-[#C07070]"
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                              </button>
                            </div>
                          </article>
                        );
                      })}
                    </div>
                  </section>
                ))}
              </div>
            )}
          </div>
        </div>
      </main>

      {deleteTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-[rgba(5,4,3,0.72)] px-5 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-2xl border border-[var(--border2)] bg-[var(--surface)] p-5 shadow-2xl">
            <h2 className="font-[family-name:var(--font-display)] text-xl font-light text-[var(--text)]">
              Delete this reminder?
            </h2>
            <p className="mt-2 text-[12px] font-light leading-5 text-[var(--text-secondary)]">
              {deleteTarget.title}
            </p>
            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setDeleteTarget(null)}
                disabled={saving}
                className="h-10 rounded-lg border border-[var(--border2)] px-4 text-[12px] text-[var(--text-secondary)] hover:bg-[var(--surface2)]"
              >
                Keep it
              </button>
              <button
                type="button"
                onClick={() => void deleteReminder()}
                disabled={saving}
                className="h-10 rounded-lg border border-[rgba(180,60,60,0.24)] bg-[rgba(180,60,60,0.12)] px-4 text-[12px] text-[#D08078] disabled:opacity-50"
              >
                {saving ? "Deleting…" : "Delete"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
