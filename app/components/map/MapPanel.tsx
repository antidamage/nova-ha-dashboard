"use client";

import { useEffect, useRef } from "react";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import {
  LEFT_MOUSE_BUTTON,
  LEFT_MOUSE_BUTTON_MASK,
  RADAR_SOURCE_POLL_MS,
  RAIN_RADAR_ATTRIBUTION_LABEL,
  RAIN_RADAR_ATTRIBUTION_URL,
  RIGHT_MOUSE_BUTTON,
  RIGHT_MOUSE_BUTTON_MASK,
  WHEEL_ZOOM_EASE_SECONDS,
  WHEEL_ZOOM_MAX_DELTA_PER_SECOND,
  WHEEL_ZOOM_RATE,
  WHEEL_ZOOM_RENDER_THRESHOLD,
} from "./constants";
import { applyMapTheme } from "./apply-theme";
import { fetchConfiguredMapCenter, parseMapCenter, readCachedConfiguredMapCenter } from "./client";
import {
  clampDelta,
  clampValue,
  classNames,
  dampValue,
  frameDeltaSeconds,
  getCameraRelativePanOffset,
  getCenterRotationScale,
  isPanKey,
  normalizeWheelDelta,
} from "./interaction-model";
import { buildCyberpunkStyle, createHomeMarkerElement } from "./map-style";
import { updateRadarSource } from "./store";
import type { DragRotateHandlerShim } from "./types";
import { useMapViewportFit } from "./useMapViewportFit";

export function MapPanel({ className }: { className?: string }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const isLeftMouseHeld = useRef(false);
  const isRightMouseHeld = useRef(false);
  const centerRotationScale = useRef(1);
  const heldKeys = useRef(new Set<string>());
  const animFrameRef = useRef<number>(0);
  const wheelZoomTarget = useRef<number | null>(null);
  const wheelZoomAround = useRef<[number, number] | null>(null);

  useEffect(() => {
    if (!containerRef.current) {
      return;
    }

    const mapContainer = containerRef.current;
    const homeCenter = parseMapCenter(process.env.NEXT_PUBLIC_MAP_CENTER);
    const map = new maplibregl.Map({
      bearing: -17,
      canvasContextAttributes: {
        antialias: true,
      },
      centerClampedToGround: false,
      center: homeCenter,
      container: containerRef.current,
      pitch: 45,
      style: buildCyberpunkStyle(),
      zoom: 15,
    });

    mapRef.current = map;
    map.setCenterClampedToGround(false);
    map.scrollZoom.disable();
    map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), "top-right");
    const homeMarker = new maplibregl.Marker({
      anchor: "center",
      element: createHomeMarkerElement(),
      pitchAlignment: "viewport",
      rotationAlignment: "viewport",
    })
      .setLngLat(homeCenter)
      .addTo(map);

    const applyConfiguredCenter = (configuredCenter: [number, number] | null) => {
      if (!configuredCenter || mapRef.current !== map) {
        return;
      }
      map.jumpTo({ center: configuredCenter });
      homeMarker.setLngLat(configuredCenter);
    };

    applyConfiguredCenter(readCachedConfiguredMapCenter());
    void fetchConfiguredMapCenter().then((configuredCenter) => {
      applyConfiguredCenter(configuredCenter);
    });

    const mouseRotate = (map.dragRotate as unknown as DragRotateHandlerShim)._mouseRotate;
    const originalRotateMove = mouseRotate?._moveFunction;
    if (mouseRotate && originalRotateMove) {
      mouseRotate._moveFunction = (lastPoint, currentPoint) => {
        const result = originalRotateMove(lastPoint, currentPoint);

        if (!result?.bearingDelta || !isRightMouseHeld.current) {
          return result;
        }

        return {
          ...result,
          bearingDelta: result.bearingDelta * centerRotationScale.current,
        };
      };
    }

    let previousFrameTime: number | null = null;
    const radarSourceRefreshTimer = window.setInterval(() => updateRadarSource(map), RADAR_SOURCE_POLL_MS);

    const handleLoad = () => {
      map.jumpTo({
        bearing: -17,
        center: homeCenter,
        pitch: 45,
        zoom: 15,
      });
      map.setCenterClampedToGround(false);
      wheelZoomTarget.current = map.getZoom();
      wheelZoomAround.current = null;
      applyMapTheme(map);
    };
    const handleAccentChange = () => applyMapTheme(map);
    const handleKeyDown = (event: KeyboardEvent) => {
      const key = event.key.toLowerCase();

      if ((isLeftMouseHeld.current || isRightMouseHeld.current) && isPanKey(key)) {
        event.preventDefault();
      }

      heldKeys.current.add(key);
    };
    const handleKeyUp = (event: KeyboardEvent) => {
      heldKeys.current.delete(event.key.toLowerCase());
    };
    const handleWindowBlur = () => {
      isLeftMouseHeld.current = false;
      isRightMouseHeld.current = false;
      heldKeys.current.clear();
    };
    const handleWindowMouseUp = (event: MouseEvent) => {
      if (event.button === LEFT_MOUSE_BUTTON) {
        isLeftMouseHeld.current = false;
      }
      if (event.button === RIGHT_MOUSE_BUTTON) {
        isRightMouseHeld.current = false;
      }
      if (event.buttons === 0) {
        isLeftMouseHeld.current = false;
        isRightMouseHeld.current = false;
      }
    };
    const handleWheel = (event: WheelEvent) => {
      event.preventDefault();
      const delta = normalizeWheelDelta(event.deltaY, event.deltaMode, event.shiftKey);
      if (!delta) {
        return;
      }

      const rect = mapContainer.getBoundingClientRect();
      const point: [number, number] = [event.clientX - rect.left, event.clientY - rect.top];
      const anchor = map.unproject(point);
      const startZoom = wheelZoomTarget.current ?? map.getZoom();
      const targetZoom = clampValue(startZoom - delta * WHEEL_ZOOM_RATE, map.getMinZoom(), map.getMaxZoom());

      wheelZoomTarget.current = targetZoom;
      wheelZoomAround.current = [anchor.lng, anchor.lat];
    };
    const frameLoop = (frameTime: number) => {
      const deltaSeconds = frameDeltaSeconds(frameTime, previousFrameTime);
      previousFrameTime = frameTime;

      const targetWheelZoom = wheelZoomTarget.current;
      if (typeof targetWheelZoom === "number") {
        const currentZoom = map.getZoom();
        const nextZoom = clampDelta(
          currentZoom,
          dampValue(currentZoom, targetWheelZoom, deltaSeconds, WHEEL_ZOOM_EASE_SECONDS),
          WHEEL_ZOOM_MAX_DELTA_PER_SECOND * deltaSeconds,
        );

        if (Math.abs(nextZoom - currentZoom) > WHEEL_ZOOM_RENDER_THRESHOLD) {
          map.easeTo({
            around: wheelZoomAround.current ?? map.getCenter(),
            animate: false,
            duration: 0,
            essential: true,
            zoom: nextZoom,
          });
        } else {
          wheelZoomTarget.current = null;
          wheelZoomAround.current = null;
        }
      }

      if (isLeftMouseHeld.current || isRightMouseHeld.current) {
        const [dx, dy] = getCameraRelativePanOffset(heldKeys.current);

        if (dx || dy) {
          map.panBy([dx, dy], { duration: 0 });
        }
      }

      animFrameRef.current = window.requestAnimationFrame(frameLoop);
    };

    map.on("load", handleLoad);
    window.addEventListener("nova-accent-change", handleAccentChange);
    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("keyup", handleKeyUp);
    window.addEventListener("blur", handleWindowBlur);
    window.addEventListener("mouseup", handleWindowMouseUp);
    mapContainer.addEventListener("wheel", handleWheel, { passive: false });
    animFrameRef.current = window.requestAnimationFrame(frameLoop);

    return () => {
      window.cancelAnimationFrame(animFrameRef.current);
      window.removeEventListener("nova-accent-change", handleAccentChange);
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("keyup", handleKeyUp);
      window.removeEventListener("blur", handleWindowBlur);
      window.removeEventListener("mouseup", handleWindowMouseUp);
      mapContainer.removeEventListener("wheel", handleWheel);
      window.clearInterval(radarSourceRefreshTimer);
      if (mouseRotate && originalRotateMove) {
        mouseRotate._moveFunction = originalRotateMove;
      }
      map.off("load", handleLoad);
      homeMarker.remove();
      map.remove();
      mapRef.current = null;
    };
  }, []);

  useMapViewportFit(containerRef, mapRef);


  return (
    <div
      className={classNames("relative overflow-hidden touch-manipulation", className)}
      onContextMenu={(event) => event.preventDefault()}
      onMouseDownCapture={(event) => {
        if (event.button === LEFT_MOUSE_BUTTON) {
          isLeftMouseHeld.current = true;
        }
        if (event.button === RIGHT_MOUSE_BUTTON) {
          isRightMouseHeld.current = true;
          centerRotationScale.current = getCenterRotationScale(event.currentTarget.getBoundingClientRect(), event.clientX, event.clientY);
        }
        wheelZoomTarget.current = null;
        wheelZoomAround.current = null;
      }}
      onMouseLeave={(event) => {
        if (event.buttons === 0) {
          isLeftMouseHeld.current = false;
          isRightMouseHeld.current = false;
        }
      }}
      onMouseMove={(event) => {
        isLeftMouseHeld.current = (event.buttons & LEFT_MOUSE_BUTTON_MASK) === LEFT_MOUSE_BUTTON_MASK;
        isRightMouseHeld.current = (event.buttons & RIGHT_MOUSE_BUTTON_MASK) === RIGHT_MOUSE_BUTTON_MASK;
      }}
      onMouseUp={(event) => {
        if (event.button === LEFT_MOUSE_BUTTON) {
          isLeftMouseHeld.current = false;
        }
        if (event.button === RIGHT_MOUSE_BUTTON) {
          isRightMouseHeld.current = false;
        }
      }}
    >
      <div ref={containerRef} className="h-full w-full" />
      <div className="nova-map-attribution">
        <a href={RAIN_RADAR_ATTRIBUTION_URL} target="_blank" rel="noreferrer">
          {RAIN_RADAR_ATTRIBUTION_LABEL}
        </a>
      </div>
    </div>
  );
}
