"use client";

import { ImagePlus, Save, Trash2 } from "lucide-react";
import { MomentaryFeedbackButton } from "../../MomentaryFeedbackButton";
import { VehicleReferenceEditor } from "../../VehicleReferenceEditor";
import type { NormalizedRectangle } from "../../../../lib/reference-selection";
import type { ReferenceImage, ReferenceKind } from "./types";

// Recognised household subjects. Vehicle references are designated out of a
// photo through VehicleReferenceEditor rather than uploaded whole, so the crop
// stays normalised to that photo.
export function ReferenceGallery({
  cameraId,
  deleteReference,
  referenceFile,
  referenceKind,
  referenceName,
  references,
  saving,
  setReferenceFile,
  setReferenceKind,
  setReferenceName,
  uploadReference,
}: {
  cameraId: string;
  deleteReference: (referenceId: string) => Promise<void>;
  referenceFile: File | null;
  referenceKind: ReferenceKind;
  referenceName: string;
  references: ReferenceImage[];
  saving: boolean;
  setReferenceFile: (file: File | null) => void;
  setReferenceKind: (kind: ReferenceKind) => void;
  setReferenceName: (name: string) => void;
  uploadReference: (options?: {
    crop?: NormalizedRectangle;
    file?: File;
    kind?: ReferenceKind;
    name?: string;
  }) => Promise<boolean>;
}) {
  return (
    <>
    <div className="camera-reference-gallery">
      <div><p className="camera-events-kicker">Reference gallery</p><h4>Recognised household subjects</h4></div>
      <div className="camera-analysis-zone-tabs">
        {(["cat", "vehicle", "person"] as const).map((kind) => <button key={kind} type="button" className={referenceKind === kind ? "is-active" : ""} style={{ "--zone-color": kind === "cat" ? "#54f5d0" : kind === "vehicle" ? "#ffd56b" : "#8bb8ff" } as React.CSSProperties} onClick={() => { setReferenceKind(kind); setReferenceFile(null); }}>{kind === "person" ? "owner" : kind}</button>)}
      </div>
      <div className="camera-reference-add">
        {referenceKind !== "vehicle" ? <input aria-label="Reference name" placeholder={referenceKind === "cat" ? "Cat name" : "Owner name"} value={referenceName} onChange={(event) => setReferenceName(event.target.value)} /> : null}
        <label className="config-page-button"><ImagePlus className="h-4 w-4" /> {referenceFile?.name ?? (referenceKind === "vehicle" ? "Choose photo and designate" : "Choose image")}<input type="file" accept="image/*" onChange={(event) => { setReferenceFile(event.target.files?.[0] ?? null); event.currentTarget.value = ""; }} /></label>
        {referenceKind !== "vehicle" ? <MomentaryFeedbackButton type="button" className="config-page-button" disabled={saving || !referenceFile || !referenceName.trim()} onClick={() => void uploadReference()}><Save className="h-4 w-4" /> Add reference</MomentaryFeedbackButton> : null}
      </div>
      <ul className="camera-reference-list">
        {references.filter((reference) => reference.kind === referenceKind).map((reference) => <li key={reference.id}>
          <img src={reference.imageUrl ?? `/api/camera/${cameraId}/analysis/references/${reference.id}/image`} alt="" />
          <span><strong>{reference.name}</strong><small>{reference.legacy ? "Legacy whole-photo reference" : reference.crop ? `Designated from ${reference.source_name ?? "photo"}` : reference.kind === "person" ? "Owner reference" : "Image reference"}</small></span>
          <button type="button" aria-label={`Delete ${reference.name} reference`} onClick={() => void deleteReference(reference.id)}><Trash2 className="h-4 w-4" /></button>
        </li>)}
      </ul>
      {references.every((reference) => reference.kind !== referenceKind) ? <p className="camera-reference-empty">No {referenceKind === "person" ? "owner" : referenceKind} references remembered yet.</p> : null}
      <p className="text-xs text-neutral-400">For vehicles, designate the vehicle tightly in several daylight photos from different angles. Cat and owner references should also use varied close views. Recognition remains tentative unless local analysis agrees across multiple event frames.</p>
    </div>
    {referenceKind === "vehicle" && referenceFile ? <VehicleReferenceEditor
      file={referenceFile}
      initialName={referenceName}
      saving={saving}
      onClose={() => setReferenceFile(null)}
      onSave={(name, crop) => uploadReference({ crop, file: referenceFile, kind: "vehicle", name })}
    /> : null}
    </>
  );
}
