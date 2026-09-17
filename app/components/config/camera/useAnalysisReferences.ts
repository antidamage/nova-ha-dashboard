"use client";

import { useCallback, useEffect, useState } from "react";
import type { NormalizedRectangle } from "../../../../lib/reference-selection";
import type { ReferenceImage, ReferenceKind } from "./types";

// The reference-image half of the analysis panel: the gallery's own state and
// the three calls behind it. `setMessage`/`setSaving` stay with the panel so
// both halves share one status line.
export function useAnalysisReferences({
  cameraId,
  setMessage,
  setSaving,
}: {
  cameraId: string;
  setMessage: (message: string) => void;
  setSaving: (saving: boolean) => void;
}) {
  const [references, setReferences] = useState<ReferenceImage[]>([]);
  const [referenceKind, setReferenceKind] = useState<ReferenceKind>("cat");
  const [referenceName, setReferenceName] = useState("");
  const [referenceFile, setReferenceFile] = useState<File | null>(null);

  const loadReferences = useCallback(async () => {
    const response = await fetch(`/api/camera/${cameraId}/analysis/references`, { cache: "no-store" });
    if (response.ok) setReferences(((await response.json()) as { references: ReferenceImage[] }).references);
  }, [cameraId]);

  useEffect(() => { void loadReferences(); }, [loadReferences]);

  const uploadReference = useCallback(async (options?: {
    crop?: NormalizedRectangle;
    file?: File;
    kind?: ReferenceKind;
    name?: string;
  }) => {
    const file = options?.file ?? referenceFile;
    const kind = options?.kind ?? referenceKind;
    const name = options?.name?.trim() ?? referenceName.trim();
    if (!file || !name) {
      setMessage("Choose an image and enter the reference name first.");
      return false;
    }
    const body = new FormData();
    body.set("kind", kind);
    body.set("name", name);
    if (kind === "person") body.set("role", "owner");
    if (options?.crop) body.set("crop", JSON.stringify(options.crop));
    body.set("sourceName", file.name);
    body.set("image", file);
    setSaving(true);
    try {
      const response = await fetch(`/api/camera/${cameraId}/analysis/references`, { method: "POST", body });
      const result = await response.json().catch(() => ({})) as { detail?: string; error?: string };
      if (!response.ok) throw new Error(result.detail ?? result.error ?? "Could not save that reference image");
      if (kind !== "vehicle") {
        setReferenceFile(null);
        setReferenceName("");
      }
      await loadReferences();
      setMessage(`${name} reference saved for detailed matching.`);
      return true;
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not save that reference image");
      return false;
    } finally {
      setSaving(false);
    }
  }, [cameraId, loadReferences, referenceFile, referenceKind, referenceName]);

  const deleteReference = useCallback(async (referenceId: string) => {
    const response = await fetch(`/api/camera/${cameraId}/analysis/references/${referenceId}`, { method: "DELETE" });
    if (response.ok) await loadReferences();
  }, [cameraId, loadReferences]);

  return {
    deleteReference,
    loadReferences,
    referenceFile,
    referenceKind,
    referenceName,
    references,
    setReferenceFile,
    setReferenceKind,
    setReferenceName,
    uploadReference,
  };
}
