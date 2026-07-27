import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";

const env = Object.fromEntries(Object.entries({
  ...process.env,
  NEXT_PUBLIC_NOVA_DEMO_MODE: "true",
  NEXT_PUBLIC_NOVA_DEMO_PROVIDER_BASE:
    process.argv[2] ||
    process.env.NEXT_PUBLIC_NOVA_DEMO_PROVIDER_BASE ||
    "https://antidamage.github.io/nova-dummy-data-provider/",
}).filter(([, value]) => value !== undefined));

const apiDir = path.join(process.cwd(), "app", "api");
const disabledApiDir = path.join(process.cwd(), ".demo-disabled-api");

async function restoreApiDir() {
  if (existsSync(disabledApiDir) && !existsSync(apiDir)) {
    await rename(disabledApiDir, apiDir);
  }
}

if (existsSync(disabledApiDir)) {
  throw new Error(`Refusing to run demo build while ${disabledApiDir} already exists.`);
}

if (existsSync(apiDir)) {
  await rename(apiDir, disabledApiDir);
}

let code = 1;
try {
  await rm(path.join(process.cwd(), ".next"), { force: true, recursive: true });
  const child = spawn(process.platform === "win32" ? "npx.cmd" : "npx", ["next", "build"], {
    env,
    shell: process.platform === "win32",
    stdio: "inherit",
  });

  code = await new Promise((resolve) => {
    child.on("error", () => resolve(1));
    child.on("exit", resolve);
  });
  if (code === 0) {
    await writeFile(path.join(process.cwd(), "out", ".nojekyll"), "");
  }
} finally {
  await restoreApiDir();
}

process.exit(code ?? 1);
