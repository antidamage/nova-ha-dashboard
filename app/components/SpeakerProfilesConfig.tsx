"use client";

import { RefreshCw, Trash2, Users } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import type {
  SpeakerProfileSummary,
  SpeakerProfilesPayload,
  SpeakerTemplateSummary,
} from "../../lib/voice-host-settings";

const identityDateFormatter = new Intl.DateTimeFormat(undefined, {
  dateStyle: "medium",
  timeStyle: "short",
});

const DEFAULT_SPEECH_PREFERENCES = {
  language: "Auto",
  speech_rate: 100,
  delivery_mode: "auto" as const,
  accessibility_pacing: false,
  pronunciations: {} as Record<string, string>,
};

function relativeLastSeen(value: string, nowMs: number | null): string {
  const timestamp = new Date(value).getTime();
  if (!Number.isFinite(timestamp)) return "Last seen unknown";
  const absolute = identityDateFormatter.format(timestamp);
  if (nowMs === null) return `Last seen ${absolute}`;
  const elapsedSeconds = Math.max(0, Math.floor((nowMs - timestamp) / 1_000));
  let relative = "just now";
  if (elapsedSeconds >= 86_400) relative = `${Math.floor(elapsedSeconds / 86_400)}d ago`;
  else if (elapsedSeconds >= 3_600) relative = `${Math.floor(elapsedSeconds / 3_600)}h ago`;
  else if (elapsedSeconds >= 60) relative = `${Math.floor(elapsedSeconds / 60)}m ago`;
  return `Last seen ${absolute} (${relative})`;
}

function timeToExpiry(value: string | null | undefined, nowMs: number | null): string {
  if (!value) return "Does not expire while associated";
  const timestamp = new Date(value).getTime();
  if (!Number.isFinite(timestamp)) return "Expiry unknown";
  if (nowMs === null) return `Expires ${identityDateFormatter.format(timestamp)}`;
  const remainingSeconds = Math.ceil((timestamp - nowMs) / 1_000);
  if (remainingSeconds <= 0) return "Expiry due";
  const days = Math.floor(remainingSeconds / 86_400);
  const hours = Math.floor((remainingSeconds % 86_400) / 3_600);
  const minutes = Math.max(1, Math.ceil((remainingSeconds % 3_600) / 60));
  if (days > 0) return `Expires in ${days}d ${hours}h`;
  if (hours > 0) return `Expires in ${hours}h ${minutes}m`;
  return `Expires in ${minutes}m`;
}

function RecordedIdentityRow({
  template,
  profile,
  nowMs,
  onDelete,
  profiles = [],
  onAssign,
  deleting,
}: {
  template: SpeakerTemplateSummary;
  profile?: SpeakerProfileSummary;
  nowMs: number | null;
  onDelete: (id: string) => Promise<void>;
  profiles?: SpeakerProfileSummary[];
  onAssign?: (templateId: string, personId: string) => Promise<void>;
  deleting?: boolean;
}) {
  const identityLabel = profile?.displayName
    ?? (template.claimedName ? `Unassociated — claims ${template.claimedName}` : "Unassociated voice");
  return (
    <div className="grid gap-2 border border-neutral-800 bg-black/20 px-3 py-2.5 text-xs sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
      <div className="min-w-0">
        <p className="truncate font-semibold text-neutral-200">{identityLabel}</p>
        <p className="mt-0.5 text-neutral-500">
          <span className="font-bold uppercase text-neutral-400">{template.state}</span>
          <span className="ml-2">{template.sampleCount} sample{template.sampleCount === 1 ? "" : "s"}</span>
          <span className="ml-2 font-mono text-neutral-600">{template.id.slice(0, 8)}</span>
        </p>
        <p className="mt-1 text-neutral-400">{relativeLastSeen(template.lastSeenAt, nowMs)}</p>
        <p className={template.expiresAt ? "text-amber-300/80" : "text-neutral-500"}>
          {timeToExpiry(template.expiresAt, nowMs)}
        </p>
      </div>
      <div className="flex items-center gap-2 sm:justify-self-end">
      {onAssign && profiles.length ? (
        <select
          aria-label="Assign voice template to person"
          className="border border-neutral-700 bg-neutral-950 px-1.5 py-1 text-neutral-300"
          value={profile?.id ?? ""}
          onChange={(event) => {
            if (event.target.value) void onAssign(template.id, event.target.value);
          }}
        >
          <option value="" disabled>Assign to…</option>
          {profiles.map((profile) => (
            <option key={profile.id} value={profile.id}>{profile.displayName}</option>
          ))}
        </select>
      ) : null}
      <button
        type="button"
        disabled={deleting}
        className="rounded border border-red-900/70 px-2 py-1 text-red-300 hover:bg-red-950/50 disabled:opacity-50"
        aria-label={`Delete recorded identity ${identityLabel}`}
        onClick={() => void onDelete(template.id)}
      >
        <Trash2 className="mr-1 inline h-3.5 w-3.5" aria-hidden="true" /> Delete
      </button>
      </div>
    </div>
  );
}

function ProfileEditor({ profile, onSaved, onDeleteProfile }: {
  profile: SpeakerProfileSummary;
  onSaved: () => Promise<void>;
  onDeleteProfile?: (id: string) => Promise<void>;
}) {
  const [displayName, setDisplayName] = useState(profile.displayName);
  const [pronouns, setPronouns] = useState(profile.pronouns ?? "");
  const initialSpeech = profile.speechPreferences ?? DEFAULT_SPEECH_PREFERENCES;
  const [language, setLanguage] = useState(initialSpeech.language);
  const [speechRate, setSpeechRate] = useState(initialSpeech.speech_rate);
  const [deliveryMode, setDeliveryMode] = useState(initialSpeech.delivery_mode);
  const [accessibilityPacing, setAccessibilityPacing] = useState(
    initialSpeech.accessibility_pacing,
  );
  const [pronunciations, setPronunciations] = useState(
    Object.entries(initialSpeech.pronunciations)
      .map(([source, spoken]) => `${source} = ${spoken}`).join("\n"),
  );
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const saveQueueRef = useRef<Promise<void>>(Promise.resolve());
  const saveVersionRef = useRef(0);

  useEffect(() => {
    setDisplayName(profile.displayName);
    setPronouns(profile.pronouns ?? "");
    const speech = profile.speechPreferences ?? DEFAULT_SPEECH_PREFERENCES;
    setLanguage(speech.language);
    setSpeechRate(speech.speech_rate);
    setDeliveryMode(speech.delivery_mode);
    setAccessibilityPacing(speech.accessibility_pacing);
    setPronunciations(Object.entries(speech.pronunciations)
      .map(([source, spoken]) => `${source} = ${spoken}`).join("\n"));
  }, [profile]);

  type EditorValues = {
    displayName: string;
    pronouns: string;
    language: string;
    speechRate: number;
    deliveryMode: typeof deliveryMode;
    accessibilityPacing: boolean;
    pronunciations: string;
  };

  const save = (overrides: Partial<EditorValues> = {}) => {
    const values: EditorValues = {
      displayName,
      pronouns,
      language,
      speechRate,
      deliveryMode,
      accessibilityPacing,
      pronunciations,
      ...overrides,
    };
    if (!values.displayName.trim()) return;
    const version = ++saveVersionRef.current;
    setSaving(true);
    setSaveError(null);
    saveQueueRef.current = saveQueueRef.current.catch(() => undefined).then(async () => {
      const response = await fetch(`/api/voice/speaker-profiles/${encodeURIComponent(profile.id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          displayName: values.displayName.trim(),
          pronouns: values.pronouns.trim(),
          speechPreferences: {
            language: values.language,
            speech_rate: values.speechRate,
            delivery_mode: values.deliveryMode,
            accessibility_pacing: values.accessibilityPacing,
            pronunciations: Object.fromEntries(values.pronunciations.split("\n").flatMap((line) => {
              const separator = line.indexOf("=");
              if (separator < 1) return [];
              const source = line.slice(0, separator).trim();
              const spoken = line.slice(separator + 1).trim();
              return source && spoken ? [[source, spoken]] : [];
            })),
          },
        }),
      });
      if (!response.ok) throw new Error(`Profile update failed: ${response.status}`);
      if (version === saveVersionRef.current) await onSaved();
    }).catch((error) => {
      if (version === saveVersionRef.current) setSaveError(error instanceof Error ? error.message : "Profile update failed");
    }).finally(() => {
      if (version === saveVersionRef.current) setSaving(false);
    });
    return saveQueueRef.current;
  };

  return (
    <div className="grid gap-3 border border-neutral-700 bg-neutral-950/50 p-3">
      <div className="grid gap-2 sm:grid-cols-[1fr_1fr_auto]">
        <label className="grid gap-1 text-xs text-neutral-400">
          Name
          <input
            className="border border-neutral-700 bg-black/40 px-2 py-1.5 text-sm text-neutral-100"
            value={displayName}
            maxLength={80}
            onChange={(event) => setDisplayName(event.target.value)}
            onBlur={() => void save()}
            onKeyDown={(event) => { if (event.key === "Enter") event.currentTarget.blur(); }}
          />
        </label>
        <label className="grid gap-1 text-xs text-neutral-400">
          Pronouns
          <input
            className="border border-neutral-700 bg-black/40 px-2 py-1.5 text-sm text-neutral-100"
            value={pronouns}
            maxLength={80}
            placeholder="she/her, they/them…"
            onChange={(event) => setPronouns(event.target.value)}
            onBlur={() => void save()}
            onKeyDown={(event) => { if (event.key === "Enter") event.currentTarget.blur(); }}
          />
        </label>
        <span className={`self-end pb-2 text-xs ${saveError ? "text-red-300" : "text-neutral-500"}`} role="status">
          {saveError ?? (saving ? "Saving…" : "Changes save automatically")}
        </span>
      </div>
      <div className="grid gap-2 md:grid-cols-3">
        <label className="grid gap-1 text-xs text-neutral-400">
          Spoken language
          <select
            className="border border-neutral-700 bg-black/40 px-2 py-1.5 text-sm text-neutral-100"
            value={language}
            onChange={(event) => { const next = event.target.value; setLanguage(next); void save({ language: next }); }}
          >
            {["Auto", "English", "Chinese", "Japanese", "Korean", "German", "French", "Russian", "Portuguese", "Spanish", "Italian"].map((item) => (
              <option key={item} value={item}>{item}</option>
            ))}
          </select>
        </label>
        <label className="grid gap-1 text-xs text-neutral-400">
          Delivery
          <select
            className="border border-neutral-700 bg-black/40 px-2 py-1.5 text-sm text-neutral-100"
            value={deliveryMode}
            onChange={(event) => { const next = event.target.value as typeof deliveryMode; setDeliveryMode(next); void save({ deliveryMode: next }); }}
          >
            <option value="auto">Auto (quiet at night)</option>
            <option value="normal">Normal</option>
            <option value="whisper">Whisper</option>
          </select>
        </label>
        <label className="grid gap-1 text-xs text-neutral-400">
          Pace: {speechRate}%
          <input
            type="range"
            min={70}
            max={130}
            step={5}
            value={speechRate}
            onChange={(event) => setSpeechRate(Number(event.target.value))}
            onPointerUp={() => void save()}
            onKeyUp={() => void save()}
          />
        </label>
      </div>
      <label className="flex items-center gap-2 text-xs text-neutral-300">
        <input
          type="checkbox"
          checked={accessibilityPacing}
          onChange={(event) => { const next = event.target.checked; setAccessibilityPacing(next); void save({ accessibilityPacing: next }); }}
        />
        Clear accessibility pacing and deliberate word boundaries
      </label>
      <label className="grid gap-1 text-xs text-neutral-400">
        Pronunciation dictionary (one “written = spoken” entry per line)
        <textarea
          className="min-h-20 border border-neutral-700 bg-black/40 px-2 py-1.5 font-mono text-sm text-neutral-100"
          value={pronunciations}
          placeholder="Ngā = Ngar"
          onChange={(event) => setPronunciations(event.target.value)}
          onBlur={() => void save()}
          onKeyDown={(event) => {
            if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) event.currentTarget.blur();
          }}
        />
      </label>
      <p className="text-xs text-neutral-500">
        {profile.templates.length} associated recorded identit{profile.templates.length === 1 ? "y" : "ies"}
      </p>
      {onDeleteProfile ? (
        <button
          type="button"
          className="justify-self-start text-xs font-semibold text-red-300 hover:text-red-200"
          onClick={() => void onDeleteProfile(profile.id)}
        >
          Delete person and all voice templates
        </button>
      ) : null}
    </div>
  );
}

export function SpeakerProfilesConfig() {
  const [data, setData] = useState<SpeakerProfilesPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [deletingTemplateId, setDeletingTemplateId] = useState<string | null>(null);
  const [deletingAll, setDeletingAll] = useState(false);
  const [nowMs, setNowMs] = useState<number | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch("/api/voice/speaker-profiles", { cache: "no-store" });
      if (!response.ok) throw new Error(`Speaker profiles unavailable: ${response.status}`);
      setData(await response.json() as SpeakerProfilesPayload);
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Speaker profiles are unavailable");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    setNowMs(Date.now());
    const timer = window.setInterval(() => setNowMs(Date.now()), 30_000);
    return () => window.clearInterval(timer);
  }, []);

  const deleteTemplate = async (templateId: string) => {
    if (!window.confirm("Delete this recorded voice identity? It will need to be learned again.")) return;
    setDeletingTemplateId(templateId);
    try {
      const response = await fetch(`/api/voice/speaker-templates/${encodeURIComponent(templateId)}`, {
        method: "DELETE",
      });
      if (!response.ok) throw new Error(`Identity deletion failed: ${response.status}`);
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Identity deletion failed");
    } finally {
      setDeletingTemplateId(null);
    }
  };

  const deleteAllTemplates = async () => {
    const identityCount = data
      ? data.provisionalTemplates.length
        + data.profiles.reduce((count, profile) => count + profile.templates.length, 0)
      : 0;
    if (!identityCount || deletingAll) return;
    if (!window.confirm(
      `Delete all ${identityCount} recorded voice identit${identityCount === 1 ? "y" : "ies"}? `
      + "This cannot be undone. Household person profiles will remain.",
    )) return;
    setDeletingAll(true);
    try {
      const response = await fetch("/api/voice/speaker-templates", { method: "DELETE" });
      if (!response.ok) throw new Error(`Delete-all failed: ${response.status}`);
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Delete-all failed");
    } finally {
      setDeletingAll(false);
    }
  };

  const deleteProfile = async (personId: string) => {
    if (!window.confirm("Delete this person and every associated voice template?")) return;
    const response = await fetch(`/api/voice/speaker-profiles/${encodeURIComponent(personId)}`, {
      method: "DELETE",
    });
    if (!response.ok) {
      setError(`Profile deletion failed: ${response.status}`);
      return;
    }
    await load();
  };

  const assignTemplate = async (templateId: string, personId: string) => {
    const response = await fetch(`/api/voice/speaker-templates/${encodeURIComponent(templateId)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ personId }),
    });
    if (!response.ok) {
      setError(`Template assignment failed: ${response.status}`);
      return;
    }
    await load();
  };

  const recordedIdentities = data
    ? [
        ...data.profiles.flatMap((profile) => profile.templates.map((template) => ({ template, profile }))),
        ...data.provisionalTemplates.map((template) => ({ template, profile: undefined })),
      ].sort((left, right) => (
        new Date(right.template.lastSeenAt).getTime() - new Date(left.template.lastSeenAt).getTime()
      ))
    : [];

  return (
    <div className="grid gap-3">
      <p className="mb-1 text-sm leading-relaxed text-neutral-400">
        Household people, recognized speakers, and the voice identities Nova has learned for them.
      </p>
      <div className="flex items-center justify-between gap-3">
        <p className="flex items-center gap-2 text-xs font-black uppercase text-neutral-400">
          <Users className="h-4 w-4" aria-hidden="true" /> Household speaker profiles
        </p>
        <button
          type="button"
          className="rounded border border-neutral-700 p-2 text-neutral-300 hover:bg-neutral-900"
          aria-label="Refresh speaker profiles"
          disabled={loading}
          onClick={() => void load()}
        >
          <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} aria-hidden="true" />
        </button>
      </div>
      <p className="text-xs leading-snug text-neutral-500">
        One person can have multiple voice templates. Pending templates activate after one explicit
        identity claim and three consistent addressed turns; unnamed templates expire after 30 days.
      </p>
      {error ? <p role="status" className="text-sm text-red-300">{error}</p> : null}
      <section className="grid gap-1.5" aria-labelledby="recorded-identities-heading">
        <div className="flex items-center justify-between gap-3">
          <p id="recorded-identities-heading" className="text-xs font-bold uppercase text-neutral-400">
            Recorded identities {data ? `(${recordedIdentities.length})` : ""}
          </p>
          <button
            type="button"
            disabled={!recordedIdentities.length || deletingAll}
            className="rounded border border-red-900/70 px-2.5 py-1 text-xs font-semibold text-red-300 hover:bg-red-950/50 disabled:cursor-not-allowed disabled:opacity-40"
            onClick={() => void deleteAllTemplates()}
          >
            <Trash2 className="mr-1 inline h-3.5 w-3.5" aria-hidden="true" />
            {deletingAll ? "Deleting…" : "Delete all"}
          </button>
        </div>
        {recordedIdentities.map(({ template, profile }) => (
          <RecordedIdentityRow
            key={template.id}
            template={template}
            profile={profile}
            profiles={data?.profiles}
            nowMs={nowMs}
            deleting={deletingAll || deletingTemplateId === template.id}
            onAssign={assignTemplate}
            onDelete={deleteTemplate}
          />
        ))}
        {data && !recordedIdentities.length ? (
          <p className="text-sm text-neutral-500">No recorded voice identities.</p>
        ) : null}
      </section>
      {data?.profiles.length ? (
        <section className="mt-2 grid gap-2" aria-labelledby="household-people-heading">
          <p id="household-people-heading" className="text-xs font-bold uppercase text-neutral-500">
            Household people
          </p>
          {data.profiles.map((profile) => (
            <ProfileEditor
              key={profile.id}
              profile={profile}
              onSaved={load}
              onDeleteProfile={deleteProfile}
            />
          ))}
        </section>
      ) : null}
    </div>
  );
}
