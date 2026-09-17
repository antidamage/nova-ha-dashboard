// Server identity, shared input-schema fragments, and the resource and prompt
// catalogues.
export const serverInfo = {
  name: "nova-dashboard",
  version: "1.0.0",
};

export const emptyInputSchema = {
  type: "object",
  additionalProperties: false,
};

export const confirmSchema = {
  confirm: {
    type: "boolean",
    description: "Required true for mutating tools.",
  },
};

export const resources = [
  {
    uri: "nova://dashboard/config/schema",
    name: "Dashboard Config Schema",
    description: "JSON Schema for portable Nova dashboard config.",
    mimeType: "application/schema+json",
  },
  {
    uri: "nova://dashboard/config/current",
    name: "Current Dashboard Config",
    description: "Current portable dashboard config with secrets excluded.",
    mimeType: "application/json",
  },
  {
    uri: "nova://dashboard/setup/checklist",
    name: "Setup Checklist",
    description: "Runtime secret and setup status checklist.",
    mimeType: "application/json",
  },
  {
    uri: "nova://dashboard/home-assistant/entities",
    name: "Home Assistant Entities",
    description: "Current Home Assistant states available to the dashboard.",
    mimeType: "application/json",
  },
  {
    uri: "nova://dashboard/modules/status",
    name: "Module Status",
    description: "Dashboard modules, whether active, and unmet Home Assistant requirements.",
    mimeType: "application/json",
  },
];

export const prompts = [
  {
    name: "nova.setup.wizard",
    title: "Nova setup wizard",
    description: "Guide a new user through configuring Nova Dashboard safely.",
  },
  {
    name: "nova.config.review",
    title: "Nova config review",
    description: "Review an imported Nova Dashboard config before applying it.",
  },
  {
    name: "nova.deployment.check",
    title: "Nova deployment check",
    description: "Verify deployment health after install or config changes.",
  },
];
