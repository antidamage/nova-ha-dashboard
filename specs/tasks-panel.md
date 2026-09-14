# Tasks panel lists

Adeline, 2026-09-14. Plan `we-ve-separated-the-landscape-s-ancient-parnas`,
task log `20260914T101019Z-06c0031b`.

`app/components/TasksPanel.tsx`; the filter is `taskVisibleInTab` in
`app/components/tasks/task-model.ts`.

## Two lists, not two tabs

- The **Today** / **Upcoming** tab switch is gone. The panel shows **two lists,
  each under its own heading, Today on top** (Adeline, 2026-09-14). Portrait and
  landscape alike.
- Membership is unchanged: a reminder is in Today or Upcoming by exactly the
  rule `taskVisibleInTab` already applies, and in neither if it has ended
  before today.
- Headings are the panel's existing small uppercase heading style ("TODAY",
  "UPCOMING").
- An empty list keeps its heading and shows its existing empty line: "No
  reminders today" / "No upcoming reminders".
- Edit mode, selection, Delete, the row editor and Add behave as before across
  both lists; the Delete button that sat beside the tabs stays in that row.

## Done means

- Both headings render, Today first, each with its own reminders.
- `TasksPanel.test.ts` still passes; a render test covers the two headings and
  their order.
