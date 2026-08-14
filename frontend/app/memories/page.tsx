"use client";

import { useAuth0 } from "@auth0/auth0-react";
import {
  AlertTriangle,
  Check,
  Pencil,
  Plus,
  Search,
  Trash2,
  X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";

import { useAuthSession } from "../auth/AuthBootstrap";
import Navbar from "../navbar";

type MemoryType =
  | "profile"
  | "preference"
  | "relationship"
  | "boundary"
  | "situation"
  | "event";

type MemoryTopic =
  | "personal"
  | "finances"
  | "university"
  | "projects"
  | "people"
  | "health"
  | "routines"
  | "home"
  | "logistics"
  | "other";

type MemoryRecord = {
  id: string;
  type: MemoryType;
  topic: MemoryTopic;
  subject: string | null;
  content: string;
  importance: number;
  confidence: number;
  status: "active" | "pending" | "superseded" | "archived" | "deleted";
  expiresAt: string | null;
  lastReinforcedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

type MemoryDraft = {
  content: string;
  type: MemoryType;
  topic: MemoryTopic;
  subject: string;
  expiresAt: string;
};

type ApiError = {
  error?: { message?: string };
};

const memoryTypes: Array<{ id: MemoryType; label: string }> = [
  { id: "profile", label: "Profile" },
  { id: "preference", label: "Preference" },
  { id: "relationship", label: "Relationship" },
  { id: "boundary", label: "Boundary" },
  { id: "situation", label: "Situation" },
  { id: "event", label: "Event" },
];

const memoryTopics: Array<{
  id: MemoryTopic;
  label: string;
  color: string;
}> = [
  { id: "personal", label: "About you", color: "#C9935A" },
  { id: "finances", label: "Finances", color: "#73A39B" },
  { id: "university", label: "University", color: "#9090D0" },
  { id: "projects", label: "Projects", color: "#B98AA5" },
  { id: "people", label: "People & relationships", color: "#C88282" },
  { id: "health", label: "Health & wellbeing", color: "#8FAF7A" },
  { id: "routines", label: "Routines", color: "#B4A078" },
  { id: "home", label: "Home", color: "#9A9A9A" },
  { id: "logistics", label: "Logistics", color: "#7D9DBF" },
  { id: "other", label: "Other", color: "#83808F" },
];

const emptyDraft: MemoryDraft = {
  content: "",
  type: "profile",
  topic: "other",
  subject: "",
  expiresAt: "",
};

function localInputValue(value: string | null): string {
  if (!value) return "";
  const date = new Date(value);
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}

function draftFor(memory: MemoryRecord): MemoryDraft {
  return {
    content: memory.content,
    type: memory.type,
    topic: memory.topic,
    subject: memory.subject ?? "",
    expiresAt: localInputValue(memory.expiresAt),
  };
}

function requestBody(draft: MemoryDraft) {
  return {
    content: draft.content.trim(),
    type: draft.type,
    topic: draft.topic,
    subject: draft.subject.trim() || null,
    expiresAt:
      draft.type === "situation" && draft.expiresAt
        ? new Date(draft.expiresAt).toISOString()
        : null,
  };
}

function MemoryEditor({
  draft,
  onChange,
  onCancel,
  onSave,
  saving,
  submitLabel,
}: {
  draft: MemoryDraft;
  onChange: (draft: MemoryDraft) => void;
  onCancel: () => void;
  onSave: () => void;
  saving: boolean;
  submitLabel: string;
}) {
  const invalid =
    !draft.content.trim() ||
    (draft.type === "situation" && !draft.expiresAt);

  return (
    <div className="rounded-xl border border-[var(--border2)] bg-[var(--surface)] p-4 shadow-[0_16px_50px_rgba(0,0,0,0.18)]">
      <textarea
        autoFocus
        value={draft.content}
        onChange={(event) => onChange({ ...draft, content: event.target.value })}
        maxLength={500}
        rows={3}
        placeholder="What should Cantarella remember?"
        className="w-full resize-none rounded-lg border border-[var(--border2)] bg-[var(--surface2)] px-3.5 py-3 text-[13px] font-light leading-6 text-[var(--text)] outline-none transition focus:border-[rgba(201,147,90,0.4)] focus:shadow-[0_0_0_3px_rgba(201,147,90,0.05)] placeholder:text-[var(--text-dim)]"
      />

      <div className="mt-3 flex flex-wrap items-end gap-3">
        <label className="flex min-w-[150px] flex-col gap-1.5 text-[10px] uppercase tracking-[0.12em] text-[var(--text-dim)]">
          Memory type
          <select
            value={draft.type}
            onChange={(event) =>
              onChange({ ...draft, type: event.target.value as MemoryType })
            }
            className="h-10 rounded-lg border border-[var(--border2)] bg-[var(--surface2)] px-3 text-[12px] normal-case tracking-normal text-[var(--text)] outline-none focus:border-[rgba(201,147,90,0.4)]"
          >
            {memoryTypes.map((type) => (
              <option key={type.id} value={type.id}>
                {type.label}
              </option>
            ))}
          </select>
        </label>

        {draft.type === "situation" && (
          <label className="flex min-w-[210px] flex-col gap-1.5 text-[10px] uppercase tracking-[0.12em] text-[var(--text-dim)]">
            Remember until
            <input
              type="datetime-local"
              value={draft.expiresAt}
              onChange={(event) =>
                onChange({ ...draft, expiresAt: event.target.value })
              }
              className="h-10 rounded-lg border border-[var(--border2)] bg-[var(--surface2)] px-3 text-[12px] normal-case tracking-normal text-[var(--text)] outline-none focus:border-[rgba(201,147,90,0.4)]"
            />
          </label>
        )}

        <label className="flex min-w-[150px] flex-col gap-1.5 text-[10px] uppercase tracking-[0.12em] text-[var(--text-dim)]">
          Topic
          <select
            value={draft.topic}
            onChange={(event) =>
              onChange({ ...draft, topic: event.target.value as MemoryTopic })
            }
            className="h-10 rounded-lg border border-[var(--border2)] bg-[var(--surface2)] px-3 text-[12px] normal-case tracking-normal text-[var(--text)] outline-none focus:border-[rgba(201,147,90,0.4)]"
          >
            {memoryTopics.map((topic) => (
              <option key={topic.id} value={topic.id}>
                {topic.label}
              </option>
            ))}
          </select>
        </label>

        <div className="ml-auto flex gap-2">
          <button
            type="button"
            onClick={onCancel}
            disabled={saving}
            className="inline-flex h-10 items-center gap-2 rounded-lg border border-[var(--border2)] px-3.5 text-[12px] text-[var(--text-secondary)] transition hover:bg-[var(--surface2)] hover:text-[var(--text)] disabled:opacity-50"
          >
            <X className="h-3.5 w-3.5" />
            Cancel
          </button>
          <button
            type="button"
            onClick={onSave}
            disabled={saving || invalid}
            className="inline-flex h-10 items-center gap-2 rounded-lg bg-[var(--amber)] px-4 text-[12px] font-medium text-[#1A0F08] transition hover:bg-[var(--amber-soft)] disabled:cursor-not-allowed disabled:opacity-45"
          >
            <Check className="h-3.5 w-3.5" />
            {saving ? "Saving…" : submitLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function MemoriesPage() {
  const { getAccessTokenSilently } = useAuth0();
  const { account } = useAuthSession();
  const [memories, setMemories] = useState<MemoryRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState<MemoryType | "all">("all");
  const [adding, setAdding] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<MemoryDraft>(emptyDraft);
  const [saving, setSaving] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<MemoryRecord | null>(null);

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
            "Cantarella couldn't update her memories.",
        );
      }

      return payload as T;
    },
    [getAccessTokenSilently],
  );

  const loadMemories = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const payload = await apiRequest<{ data: { memories: MemoryRecord[] } }>(
        "/memories?status=active&limit=200",
      );
      setMemories(payload.data.memories);
    } catch (loadError) {
      setError(
        loadError instanceof Error
          ? loadError.message
          : "Cantarella couldn't load her memories.",
      );
    } finally {
      setLoading(false);
    }
  }, [apiRequest]);

  useEffect(() => {
    void loadMemories();
  }, [loadMemories]);

  const visibleMemories = useMemo(() => {
    const normalizedSearch = search.trim().toLocaleLowerCase();
    return memories.filter((memory) => {
      if (typeFilter !== "all" && memory.type !== typeFilter) return false;
      return (
        !normalizedSearch ||
        memory.content.toLocaleLowerCase().includes(normalizedSearch)
      );
    });
  }, [memories, search, typeFilter]);

  const groupedMemories = useMemo(
    () =>
      memoryTopics
        .map((topic) => ({
          ...topic,
          memories: visibleMemories.filter((memory) =>
            memory.topic === topic.id,
          ),
        }))
        .filter((topic) => topic.memories.length > 0),
    [visibleMemories],
  );

  const formatStoredDate = (value: string) =>
    new Intl.DateTimeFormat("en-US", {
      timeZone: account?.timezone ?? "UTC",
      month: "short",
      day: "numeric",
      year: "numeric",
    }).format(new Date(value));

  const saveNewMemory = async () => {
    setSaving(true);
    setError("");
    try {
      const payload = await apiRequest<{ data: { memory: MemoryRecord } }>(
        "/memories",
        { method: "POST", body: JSON.stringify(requestBody(draft)) },
      );
      setMemories((current) => [payload.data.memory, ...current]);
      setAdding(false);
      setDraft(emptyDraft);
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Memory save failed.");
    } finally {
      setSaving(false);
    }
  };

  const saveEditedMemory = async () => {
    if (!editingId) return;
    setSaving(true);
    setError("");
    try {
      const payload = await apiRequest<{ data: { memory: MemoryRecord } }>(
        `/memories/${editingId}`,
        { method: "PATCH", body: JSON.stringify(requestBody(draft)) },
      );
      setMemories((current) =>
        current.map((memory) =>
          memory.id === editingId ? payload.data.memory : memory,
        ),
      );
      setEditingId(null);
      setDraft(emptyDraft);
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Memory update failed.");
    } finally {
      setSaving(false);
    }
  };

  const deleteMemory = async () => {
    if (!deleteTarget) return;
    setSaving(true);
    setError("");
    try {
      await apiRequest(`/memories/${deleteTarget.id}`, { method: "DELETE" });
      setMemories((current) =>
        current.filter((memory) => memory.id !== deleteTarget.id),
      );
      setDeleteTarget(null);
    } catch (deleteError) {
      setError(
        deleteError instanceof Error ? deleteError.message : "Memory deletion failed.",
      );
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
              What she <span className="italic text-[var(--amber)]">Remembers</span>
            </h1>
            <p className="mt-0.5 text-[11px] font-light tracking-wide text-[var(--text-dim)]">
              the details worth carrying forward
            </p>
          </div>
          <button
            type="button"
            onClick={() => {
              setEditingId(null);
              setDraft(emptyDraft);
              setAdding(true);
            }}
            className="inline-flex h-10 items-center gap-2 rounded-lg bg-[var(--amber)] px-4 text-[12px] font-medium text-[#1A0F08] transition hover:bg-[var(--amber-soft)] active:scale-[0.98] max-sm:w-10 max-sm:justify-center max-sm:px-0"
          >
            <Plus className="h-4 w-4" />
            <span className="max-sm:hidden">Add memory</span>
          </button>
        </header>

        <div className="relative z-10 flex-1 overflow-y-auto px-7 py-5 [scrollbar-color:var(--surface3)_transparent] [scrollbar-width:thin] max-sm:px-4">
          <div className="mx-auto w-full max-w-[1040px]">
            <div className="relative">
              <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--text-dim)]" />
              <input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Search memories…"
                className="h-11 w-full rounded-[10px] border border-[var(--border2)] bg-[var(--surface)] pl-10 pr-4 text-[13px] font-light text-[var(--text)] outline-none transition placeholder:text-[var(--text-dim)] focus:border-[rgba(201,147,90,0.4)] focus:shadow-[0_0_0_3px_rgba(201,147,90,0.05)]"
              />
            </div>

            <div className="mt-3 flex gap-2 overflow-x-auto pb-1 [scrollbar-width:none]">
              {[{ id: "all" as const, label: "All" }, ...memoryTypes].map(
                (type) => (
                  <button
                    key={type.id}
                    type="button"
                    onClick={() => setTypeFilter(type.id)}
                    className={`shrink-0 rounded-full border px-3 py-1.5 text-[10px] uppercase tracking-[0.1em] transition ${
                      typeFilter === type.id
                        ? "border-[rgba(201,147,90,0.24)] bg-[var(--amber-dim)] text-[var(--amber-soft)]"
                        : "border-[var(--border)] bg-[var(--surface)] text-[var(--text-dim)] hover:border-[var(--border2)] hover:text-[var(--text-secondary)]"
                    }`}
                  >
                    {type.label}
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
                <MemoryEditor
                  draft={draft}
                  onChange={setDraft}
                  onCancel={() => {
                    setAdding(false);
                    setDraft(emptyDraft);
                  }}
                  onSave={() => void saveNewMemory()}
                  saving={saving}
                  submitLabel="Remember this"
                />
              </div>
            )}

            {loading ? (
              <div className="flex h-52 items-center justify-center gap-2" aria-label="Loading memories">
                <span className="h-1.5 w-1.5 animate-typing-1 rounded-full bg-[var(--amber)]" />
                <span className="h-1.5 w-1.5 animate-typing-2 rounded-full bg-[var(--amber)]" />
                <span className="h-1.5 w-1.5 animate-typing-3 rounded-full bg-[var(--amber)]" />
              </div>
            ) : groupedMemories.length === 0 ? (
              <div className="mt-10 rounded-xl border border-dashed border-[var(--border2)] bg-[rgba(22,18,16,0.55)] px-6 py-12 text-center">
                <div className="font-[family-name:var(--font-display)] text-xl italic text-[var(--text-secondary)]">
                  Nothing here yet
                </div>
                <p className="mt-2 text-[12px] font-light text-[var(--text-dim)]">
                  {search || typeFilter !== "all"
                    ? "Try a different search or memory type."
                    : "Useful details from your conversations will appear here."}
                </p>
              </div>
            ) : (
              <div className="mt-6 pb-6">
                {groupedMemories.map((topic) => (
                  <section key={topic.id} className="mb-7">
                    <div className="mb-2.5 flex items-center gap-2 text-[10px] font-medium uppercase tracking-[0.12em] text-[var(--text-dim)]">
                      <span
                        className="h-1.5 w-1.5 rounded-full"
                        style={{ background: topic.color }}
                      />
                      {topic.label}
                      <span className="ml-1 text-[9px] text-[var(--text-dim)] opacity-60">
                        {topic.memories.length}
                      </span>
                    </div>

                    <div className="space-y-1.5">
                      {topic.memories.map((memory) =>
                        editingId === memory.id ? (
                          <MemoryEditor
                            key={memory.id}
                            draft={draft}
                            onChange={setDraft}
                            onCancel={() => {
                              setEditingId(null);
                              setDraft(emptyDraft);
                            }}
                            onSave={() => void saveEditedMemory()}
                            saving={saving}
                            submitLabel="Save changes"
                          />
                        ) : (
                          <article
                            key={memory.id}
                            className="group flex items-start gap-3 rounded-[10px] border border-[var(--border)] bg-[var(--surface)] px-3.5 py-3 transition hover:border-[var(--border2)]"
                          >
                            <span className="mt-0.5 inline-flex shrink-0 items-center gap-1.5 rounded-full border border-[rgba(201,147,90,0.2)] bg-[var(--amber-dim)] px-2 py-0.5 text-[10px] text-[var(--amber-soft)]">
                              <span className="h-1 w-1 rounded-full bg-[var(--amber)]" />
                              {memory.type}
                            </span>

                            <div className="min-w-0 flex-1">
                              <p className="text-[13px] font-light leading-[1.65] text-[var(--text)]">
                                {memory.content}
                              </p>
                              <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-[10px] text-[var(--text-dim)]">
                                {memory.subject && <span>{memory.subject.replaceAll("_", " ")}</span>}
                                <span>stored {formatStoredDate(memory.createdAt)}</span>
                                {memory.expiresAt && (
                                  <span>expires {formatStoredDate(memory.expiresAt)}</span>
                                )}
                              </div>
                            </div>

                            <div className="flex shrink-0 gap-1 opacity-60 transition group-hover:opacity-100 max-sm:opacity-100">
                              <button
                                type="button"
                                aria-label="Edit memory"
                                title="Edit memory"
                                onClick={() => {
                                  setAdding(false);
                                  setEditingId(memory.id);
                                  setDraft(draftFor(memory));
                                }}
                                className="flex h-7 w-7 items-center justify-center rounded-md text-[var(--text-dim)] transition hover:bg-[var(--surface2)] hover:text-[var(--amber-soft)]"
                              >
                                <Pencil className="h-3.5 w-3.5" />
                              </button>
                              <button
                                type="button"
                                aria-label="Delete memory"
                                title="Delete memory"
                                onClick={() => setDeleteTarget(memory)}
                                className="flex h-7 w-7 items-center justify-center rounded-md text-[var(--text-dim)] transition hover:bg-[rgba(180,60,60,0.08)] hover:text-[#C07070]"
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                              </button>
                            </div>
                          </article>
                        ),
                      )}
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
            <div className="flex items-start gap-3">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[rgba(180,60,60,0.1)] text-[#C07070]">
                <Trash2 className="h-4 w-4" />
              </div>
              <div>
                <h2 className="font-[family-name:var(--font-display)] text-xl font-light text-[var(--text)]">
                  Forget this memory?
                </h2>
                <p className="mt-1 text-[12px] font-light leading-5 text-[var(--text-secondary)]">
                  Cantarella will stop using it immediately. Its audit record stays internal.
                </p>
              </div>
            </div>
            <div className="mt-4 rounded-lg border border-[var(--border)] bg-[var(--surface2)] px-3.5 py-3 text-[12px] font-light leading-5 text-[var(--text-secondary)]">
              {deleteTarget.content}
            </div>
            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setDeleteTarget(null)}
                disabled={saving}
                className="h-10 rounded-lg border border-[var(--border2)] px-4 text-[12px] text-[var(--text-secondary)] transition hover:bg-[var(--surface2)] hover:text-[var(--text)]"
              >
                Keep it
              </button>
              <button
                type="button"
                onClick={() => void deleteMemory()}
                disabled={saving}
                className="h-10 rounded-lg border border-[rgba(180,60,60,0.24)] bg-[rgba(180,60,60,0.12)] px-4 text-[12px] text-[#D08078] transition hover:bg-[rgba(180,60,60,0.18)] disabled:opacity-50"
              >
                {saving ? "Forgetting…" : "Forget it"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
