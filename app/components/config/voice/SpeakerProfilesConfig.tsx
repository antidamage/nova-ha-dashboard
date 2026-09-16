"use client";

import { RefreshCw, Trash2, Users } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import type { SpeakerProfilesPayload } from "../../../../lib/voice-host-settings";
import { ProfileEditor } from "./ProfileEditor";
import { RecordedIdentityRow } from "./RecordedIdentityRow";

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
