"use client";

import { useEffect, useState } from "react";
import type {
  AirconPreferences,
  BedroomHeaterPreferences,
  DashboardEntity,
  DashboardPreferences,
  ClimateControlRoomState,
} from "../../../../lib/types";
import { ControlCard } from "../ControlCard";
import { ModuleSlot } from "../../modules/ModuleSlot";
import { loadSharedClientConfig, readCachedClientConfig } from "../../sharedConfigCache";
import { AirconKnob } from "./AirconKnob";
import { HeaterKnob } from "./HeaterKnob";
import { PanelHeaterControl } from "./PanelHeaterControl";
import { climateCardTitles } from "./useClimateCardTitles";
import type { EntityActionsHandler } from "./types";
import { climateDevicesForZone, type BedroomHeaterDevices } from "../shared";
import type { DashboardZone } from "../../../../lib/types";

// The switch that used to live here is `LabeledSlideSwitch` in
// `app/components/SlideSwitch.tsx` — the surface's only toggle now
// (specs/slide-switch.md).

/**
 * The bedroom heater: one knob and nothing else (Adeline, 2026-09-12).
 *
 * Its target, its Auto/Off lights and its sleep timer are all on the dial now,
 * so the card carries no stepper, no button grid, no timer row and no humidity
 * line. See specs/temperature-encoder.md.
 */
function BedroomHeaterControl({
  humidity,
  onNotice,
  preferences,
  preferredRange,
  switchEntity,
  temperature,
  title,
}: {
  controlState?: ClimateControlRoomState;
  humidity: number | null;
  onNotice?: (message: string) => void;
  preferences?: BedroomHeaterPreferences;
  preferredRange?: { min: number; max: number };
  switchEntity?: DashboardEntity;
  temperature: number | null;
  /** Usually the room, from dashboard.bedroomHeater.title in config. */
  title: string;
}) {
  if (!switchEntity) {
    return <ControlCard subPanel cardId="bedroom-heater" kicker="Heating Unit" title={title} />;
  }

  // No card header: the knob's title arc names the room (Adeline, 2026-09-12,
  // specs/temperature-encoder.md). The card above, with no entity to show, keeps
  // its header — there is no knob there to carry the name.
  return (
    <ControlCard subPanel cardId="bedroom-heater" entity={switchEntity}>
      <div className="climate-knob-body">
        <HeaterKnob
          humidity={humidity}
          preferences={preferences}
          preferredRange={preferredRange}
          switchEntity={switchEntity}
          temperature={temperature}
          title={title}
          onNotice={onNotice}
        />
      </div>
      <ModuleSlot id="thermostat.heater.controls" context={{ entity: switchEntity, preferences }} />
    </ControlCard>
  );
}

/**
 * The air conditioner: one knob and nothing else (Adeline, 2026-09-12).
 *
 * Mode, fan speed, fresh air and the off timer are its rings, and the power
 * state is its lights. See specs/temperature-encoder.md.
 */
function AirConditionerControl({
  controlState,
  entity,
  freshAirSwitch,
  preferences,
  preferredRange,
  quietSwitch,
  title,
  turboSwitch,
  onEntityActions,
}: {
  controlState?: ClimateControlRoomState;
  entity?: DashboardEntity;
  freshAirSwitch?: DashboardEntity;
  preferences?: AirconPreferences;
  preferredRange?: { min: number; max: number };
  quietSwitch?: DashboardEntity;
  /** Usually the room, from dashboard.aircon.title in config. */
  title: string;
  turboSwitch?: DashboardEntity;
  onEntityActions: EntityActionsHandler;
}) {
  if (!entity) {
    return <ControlCard subPanel cardId="aircon" kicker="Air Control" title={title} />;
  }

  // No card header — see BedroomHeaterControl above.
  return (
    <ControlCard subPanel cardId="aircon" entity={entity}>
      <div className="climate-knob-body">
        <AirconKnob
          climateControl={controlState}
          entity={entity}
          freshAirSwitch={freshAirSwitch}
          preferences={preferences}
          preferredRange={preferredRange}
          quietSwitch={quietSwitch}
          title={title}
          turboSwitch={turboSwitch}
          onEntityActions={onEntityActions}
        />
      </div>
      <ModuleSlot id="thermostat.aircon.controls" context={{ entity, preferences }} />
    </ControlCard>
  );
}

function legacyPanelHeaterEnabled(payload: unknown) {
  const config = payload as { dashboard?: { legacyPanelHeaterCardEnabled?: unknown } } | null;
  return config?.dashboard?.legacyPanelHeaterCardEnabled === true;
}

export function ClimateControls({
  bedroomHeater,
  climateControl,
  onEntityActions,
  onNotice,
  preferences,
  zone,
}: {
  bedroomHeater?: BedroomHeaterDevices;
  climateControl?: import("../../../../lib/types").ClimateControlState;
  onEntityActions: EntityActionsHandler;
  onNotice?: (message: string) => void;
  preferences?: DashboardPreferences;
  zone: DashboardZone;
}) {
  const { aircon, freshAirSwitch, heater, quietSwitch, turboSwitch } = climateDevicesForZone(zone);
  // The original panel heater died in August 2026; its card stays in the tree
  // but is off unless an equivalent unit is reinstated in config.
  const [showLegacyPanelHeater, setShowLegacyPanelHeater] = useState(() =>
    legacyPanelHeaterEnabled(readCachedClientConfig()),
  );
  const [titles, setTitles] = useState(() => climateCardTitles(readCachedClientConfig()));

  useEffect(() => {
    let alive = true;

    void loadSharedClientConfig()
      .then((payload) => {
        if (alive) {
          setShowLegacyPanelHeater(legacyPanelHeaterEnabled(payload));
          setTitles(climateCardTitles(payload));
        }
      })
      .catch(() => {
        // Keep the cached answer when config cannot be read.
      });

    return () => {
      alive = false;
    };
  }, []);

  return (
    <div className="climate-control-grid grid gap-5">
      {/*
        Each card renders only when this home actually has the device. A home
        with no air conditioner used to get an empty card headed "Lounge", and
        one with no heater an empty "Bedroom" — a room it may not have, holding
        controls that do nothing.
      */}
      {aircon ? (
        <AirConditionerControl
          controlState={climateControl?.lounge}
          entity={aircon}
          freshAirSwitch={freshAirSwitch}
          preferences={preferences?.aircon}
          preferredRange={preferences?.climateTargetRange}
          quietSwitch={quietSwitch}
          title={titles.aircon}
          turboSwitch={turboSwitch}
          onEntityActions={onEntityActions}
        />
      ) : null}
      {bedroomHeater?.switchEntity ? (
        <BedroomHeaterControl
          controlState={climateControl?.bedroom}
          humidity={bedroomHeater?.humidity ?? null}
          preferences={preferences?.bedroomHeater}
          preferredRange={preferences?.climateTargetRange}
          switchEntity={bedroomHeater?.switchEntity}
          temperature={bedroomHeater?.temperature ?? null}
          title={titles.heater}
          onNotice={onNotice}
        />
      ) : null}
      {showLegacyPanelHeater ? (
        <PanelHeaterControl entity={heater} preferences={preferences?.panelHeater} onEntityActions={onEntityActions} />
      ) : null}
    </div>
  );
}
