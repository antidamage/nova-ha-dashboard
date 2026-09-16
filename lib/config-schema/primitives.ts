import { z } from "zod";

export const DASHBOARD_CONFIG_SCHEMA_VERSION = 1;

export const entityIdSchema = z.string().min(1);
export const stringListSchema = z.array(z.string().min(1)).default([]);
export const millisecondsSchema = z.number().int().nonnegative();
export const dayOfMonthSchema = z.number().int().min(1).max(31);
export const urlTemplateSchema = z.string().min(1);
export const lightBrightnessPctSchema = z.number().int().min(1).max(100);
export const colorTemperatureKelvinSchema = z.number().int().min(1000).max(10000);

export const HaDomainSchema = z.enum(["light", "switch", "climate", "fan", "cover", "humidifier", "sensor"]);
