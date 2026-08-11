"use client";

import { Check, Crosshair, Loader2, RotateCcw, Save, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  isUsableReferenceSelection,
  normalizedRectangle,
  type NormalizedPoint,
  type NormalizedRectangle,
} from "../../lib/reference-selection";
import { ModalOverlay } from "./ModalOverlay";
import { MomentaryFeedbackButton } from "./MomentaryFeedbackButton";

export function VehicleReferenceEditor({
  file,
  initialName,
  onClose,
  onSave,
  saving,
}: {
  file: File;
  initialName: string;
  onClose: () => void;
  onSave: (name: string, crop: NormalizedRectangle) => Promise<boolean>;
  saving: boolean;
}) {
  const [name, setName] = useState(initialName);
  const [crop, setCrop] = useState<NormalizedRectangle | null>(null);
  const [imageSize, setImageSize] = useState({ width: 16, height: 9 });
  const [message, setMessage] = useState("Drag a box tightly around one vehicle.");
  const [imageUrl, setImageUrl] = useState("");
  const stageRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ pointerId: number; start: NormalizedPoint } | null>(null);

  useEffect(() => {
    const next = URL.createObjectURL(file);
    setImageUrl(next);
    return () => URL.revokeObjectURL(next);
  }, [file]);

  const pointFor = useCallback((clientX: number, clientY: number): NormalizedPoint | null => {
    const bounds = stageRef.current?.getBoundingClientRect();
    if (!bounds?.width || !bounds.height) return null;
    return { x: (clientX - bounds.left) / bounds.width, y: (clientY - bounds.top) / bounds.height };
  }, []);

  const beginSelection = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    const start = pointFor(event.clientX, event.clientY);
    if (!start) return;
    dragRef.current = { pointerId: event.pointerId, start };
    event.currentTarget.setPointerCapture(event.pointerId);
    setCrop(normalizedRectangle(start, start));
    setMessage("Keep dragging until the box contains only the vehicle.");
  }, [pointFor]);

  const updateSelection = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const end = pointFor(event.clientX, event.clientY);
    if (end) setCrop(normalizedRectangle(drag.start, end));
  }, [pointFor]);

  const endSelection = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if (dragRef.current?.pointerId !== event.pointerId) return;
    dragRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    setCrop((current) => {
      if (isUsableReferenceSelection(current)) {
        setMessage("Vehicle designated. Name it, then save this reference.");
        return current;
      }
      setMessage("That box was too small. Drag around the whole vehicle.");
      return null;
    });
  }, []);

  const save = useCallback(async () => {
    const trimmed = name.trim();
    if (!trimmed || !crop || !isUsableReferenceSelection(crop)) {
      setMessage(!trimmed ? "Give this vehicle a memorable name." : "Drag a box around the vehicle first.");
      return;
    }
    if (await onSave(trimmed, crop)) {
      setCrop(null);
      setMessage(`${trimmed} is remembered. Draw another box to save another vehicle from this photo, or close.`);
    }
  }, [crop, name, onSave]);

  return (
    <ModalOverlay
      open
      onClose={() => { if (!saving) onClose(); }}
      ariaLabelledBy="vehicle-reference-title"
      ariaDescribedBy="vehicle-reference-help"
      className="vehicle-reference-modal"
    >
      <header className="camera-events-modal-header">
        <div>
          <p className="camera-events-kicker">Vehicle memory</p>
          <h2 id="vehicle-reference-title">Designate a vehicle</h2>
        </div>
        <button type="button" className="camera-events-close" disabled={saving} onClick={onClose}><X className="h-4 w-4" /> Close</button>
      </header>
      <div className="vehicle-reference-body">
        <p id="vehicle-reference-help" className="vehicle-reference-help"><Crosshair className="h-4 w-4" /> Drag from one corner of the vehicle to the opposite corner. Exclude nearby people, road, and other vehicles.</p>
        <div
          ref={stageRef}
          className="vehicle-reference-stage"
          style={{ aspectRatio: `${imageSize.width} / ${imageSize.height}` }}
          data-nova-no-drag-scroll
          onPointerDown={beginSelection}
          onPointerMove={updateSelection}
          onPointerUp={endSelection}
          onPointerCancel={endSelection}
        >
          {imageUrl ? <img src={imageUrl} alt={`Photo containing ${name.trim() || "a vehicle"}`} draggable={false} onLoad={(event) => setImageSize({ width: event.currentTarget.naturalWidth, height: event.currentTarget.naturalHeight })} /> : null}
          <svg viewBox="0 0 1 1" preserveAspectRatio="none" aria-hidden="true">
            {crop ? <rect x={crop.x} y={crop.y} width={crop.width} height={crop.height} className="vehicle-reference-selection" vectorEffect="non-scaling-stroke" /> : null}
          </svg>
        </div>
        <div className="vehicle-reference-controls">
          <label>
            <span>Vehicle name</span>
            <input autoFocus aria-label="Vehicle name" placeholder="e.g. Addie's ute" maxLength={80} value={name} onChange={(event) => setName(event.target.value)} />
          </label>
          <div className="camera-analysis-actions">
            <MomentaryFeedbackButton type="button" className="config-page-button" disabled={!crop || saving} onClick={() => { setCrop(null); setMessage("Drag a new box tightly around one vehicle."); }}><RotateCcw className="h-4 w-4" /> Redraw</MomentaryFeedbackButton>
            <MomentaryFeedbackButton type="button" className="config-page-button" disabled={!name.trim() || !isUsableReferenceSelection(crop) || saving} onClick={() => void save()}>
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : crop ? <Save className="h-4 w-4" /> : <Check className="h-4 w-4" />} Remember vehicle
            </MomentaryFeedbackButton>
          </div>
        </div>
        <p className="vehicle-reference-status" aria-live="polite">{message}</p>
      </div>
    </ModalOverlay>
  );
}
