import { NextResponse } from "next/server";
import {
  createNotification,
  dismissAllNotifications,
  dismissNotification,
  readNotifications,
} from "../../../lib/notifications";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const docs = {
  endpoint: "/api/notifications",
  description:
    "One-off dashboard notifications. Shown on every screen until dismissed or expired. Not reminders or tasks.",
  commands: {
    list: { method: "GET", example: "/api/notifications", response: "{ notifications: DashboardNotification[] }" },
    create: {
      method: "POST",
      example: {
        title: "Build finished",
        body: "nova-ha-dashboard PR #12 merged",
        severity: "success",
        source: "claude-code",
        ttlSeconds: 3600,
      },
      response: "201 { notification }",
    },
    dismiss: { method: "DELETE", example: "/api/notifications?id=<id>", response: "{ ok: true }" },
    dismissAll: { method: "DELETE", example: "/api/notifications?all=1", response: "{ ok: true, dismissed: string[] }" },
  },
  fields: {
    title: "Required, up to 120 characters.",
    body: "Optional, up to 500 characters.",
    severity: "info (default), success, warning or critical.",
    source: "Optional, up to 40 characters; who raised it.",
    ttlSeconds: "Optional, 1 to 604800. Default 3600.",
    sticky: "Optional. true keeps it until someone dismisses it; ttlSeconds is then ignored.",
  },
};

export async function GET(request: Request) {
  if (new URL(request.url).searchParams.get("command") === "docs") {
    return NextResponse.json(docs);
  }
  return NextResponse.json({ notifications: await readNotifications() });
}

export async function POST(request: Request) {
  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ error: "Body must be valid JSON", docs }, { status: 400 });
  }
  const created = await createNotification(payload);
  if (!created.ok) {
    return NextResponse.json({ error: created.error, docs }, { status: 400 });
  }
  return NextResponse.json({ notification: created.notification }, { status: 201 });
}

export async function DELETE(request: Request) {
  const params = new URL(request.url).searchParams;
  if (params.get("all") === "1") {
    return NextResponse.json({ ok: true, dismissed: await dismissAllNotifications() });
  }
  const id = params.get("id")?.trim();
  if (!id) {
    return NextResponse.json({ error: "id (or all=1) is required" }, { status: 400 });
  }
  if (!(await dismissNotification(id))) {
    return NextResponse.json({ error: "Notification not found" }, { status: 404 });
  }
  return NextResponse.json({ ok: true });
}
