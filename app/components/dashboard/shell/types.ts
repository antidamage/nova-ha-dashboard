import type { DashboardEntity } from "../../../../lib/types";

export type LoungeEnvironment = {
  humidity: number | null;
  humidityEntity?: DashboardEntity;
  temperature: number | null;
  temperatureEntity?: DashboardEntity;
};

export type BedroomHeaterDevices = {
  humidity: number | null;
  humidityEntity?: DashboardEntity;
  switchEntity?: DashboardEntity;
  temperature: number | null;
  temperatureEntity?: DashboardEntity;
};
