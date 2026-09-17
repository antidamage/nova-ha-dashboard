// Validation and the published JSON schema. Pure: nothing here touches disk.
import { toJSONSchema } from "zod";
import {
  DashboardConfigSchema,
  type ConfigValidationIssue,
  type ConfigValidationResult,
} from "../config-schema";

function validationIssues(error: { issues: Array<{ code: string; message: string; path: PropertyKey[] }> }) {
  return error.issues.map<ConfigValidationIssue>((issue) => ({
    code: issue.code,
    message: issue.message,
    path: issue.path.length ? issue.path.map(String).join(".") : "$",
  }));
}

export function validateDashboardConfig(value: unknown): ConfigValidationResult {
  const result = DashboardConfigSchema.safeParse(value);
  if (result.success) {
    const people = result.data.dashboard.people;
    const primary = people.find((person) => person.primary) ?? people[0];
    result.data.dashboard.people = people.map((person) => ({ ...person, primary: person === primary }));
    return { ok: true, config: result.data, errors: [] };
  }
  return { ok: false, errors: validationIssues(result.error) };
}

export function dashboardConfigJsonSchema() {
  const schema = toJSONSchema(DashboardConfigSchema, {
    target: "draft-2020-12",
  }) as Record<string, unknown>;

  return {
    $id: "https://nova-dashboard.example/schemas/dashboard-config.v1.schema.json",
    title: "Nova Dashboard Config",
    ...schema,
  };
}
