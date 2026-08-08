import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { EffectGroupEntry } from "./EffectGroupEntry";
import { EffectEntry } from "./EffectEntry";
import { effectCatalogue, effectGroups, effectOptionFor, newEffectBinding } from "./effectCatalogue";
import type { PhonoscopeDriver, PhonoscopeEffectBinding } from "../../../lib/types";

/**
 * The rule this file exists for: a parameter group owns exactly ONE ramp, and
 * every group obeys it. A ramp per parameter is the bug — the parameters of a
 * group move together, so several ramps would be several controls for one
 * decision.
 */

const catalogue = effectCatalogue([]);
const groups = effectGroups(catalogue, []);
const driver: PhonoscopeDriver = { type: "beat", every: 1 };

const groupNamed = (id: string) => {
  const group = groups.find((entry) => entry.id === id);
  if (!group) throw new Error(`no ${id} effect group`);
  return group;
};

/** The whole group, every parameter of it added, rendered as the panel does. */
function renderGroup(groupId: string) {
  const group = groupNamed(groupId);
  const bindings: PhonoscopeEffectBinding[] = group.members
    .map((member, index) => newEffectBinding(`b${index}`, member));
  render(
    <EffectGroupEntry
      bindings={bindings}
      combine={{}}
      group={group}
      laneId="lane"
      onAdd={() => {}}
      onRemoveAll={() => {}}
      onSharedCombineChange={() => {}}
      onSharedRampChange={() => {}}
      renderMember={(binding) => {
        const effect = effectOptionFor(catalogue, binding.effect);
        if (!effect) return null;
        return (
          <EffectEntry
            key={binding.id}
            binding={binding}
            combine={undefined}
            companions={bindings}
            driver={driver}
            effect={effect}
            variant="row"
            onChange={() => {}}
            onCombineChange={() => {}}
            onCombineRemove={() => {}}
            onCompanionChange={() => {}}
            onDuplicate={() => {}}
            onPaste={() => {}}
            onRemove={() => {}}
          />
        );
      }}
    />,
  );
  // The effect is a collapsible and starts closed, so nothing is on screen
  // until it is opened.
  fireEvent.click(screen.getByRole("button", { name: group.label }));
  return group;
}

afterEach(() => {
  cleanup();
  // The accordion remembers what was open, so without this the next test's
  // click closes a section that restored itself as already open.
  window.sessionStorage.clear();
});

describe("one ramp per parameter group", () => {
  // Glow is the case that kept coming back: five parameters, one ramp.
  it.each(["glow", "centre", "background", "grid"])("holds for %s", (groupId) => {
    const group = renderGroup(groupId);
    const ramps = screen.queryAllByText("Ramp");
    for (const parameters of group.parameterGroups) {
      const owned = ramps.filter((node) => node.closest("[data-parameter-group]")
        ?.getAttribute("data-parameter-group") === parameters.id);
      expect(owned.length, `${groupId}/${parameters.id}`).toBeLessThanOrEqual(1);
    }
    // Nothing draws a ramp outside a parameter group either.
    expect(ramps.every((node) => node.closest("[data-parameter-group]"))).toBe(true);
  });

  it("gives the glow's five parameters exactly one", () => {
    const group = renderGroup("glow");
    expect(group.members.length).toBe(5);
    expect(screen.queryAllByText("Ramp")).toHaveLength(1);
  });

  it("gives the centre one for Size and one for Transition, and no more", () => {
    renderGroup("centre");
    // Size's ramp is drawn by the group; the transition's is its motion
    // profile, drawn inside its control set — one each, not one per parameter.
    expect(screen.queryAllByText("Ramp")).toHaveLength(2);
  });
});

/**
 * The same rule for stacking: how two lanes setting a group's value resolve is
 * one decision for the group, so it is offered once — not once per parameter.
 */
describe("one stacking mode per parameter group", () => {
  it.each(["glow", "centre", "background", "grid"])("holds for %s", (groupId) => {
    const group = renderGroup(groupId);
    const controls = screen.queryAllByText("When stacked");
    for (const parameters of group.parameterGroups) {
      const owned = controls.filter((node) => node.closest("[data-parameter-group]")
        ?.getAttribute("data-parameter-group") === parameters.id);
      expect(owned.length, `${groupId}/${parameters.id}`).toBeLessThanOrEqual(1);
    }
    // A parameter never draws its own, so none sits outside a group either.
    expect(controls.every((node) => node.closest("[data-parameter-group]"))).toBe(true);
  });

  it("gives the glow's five parameters exactly one", () => {
    renderGroup("glow");
    expect(screen.queryAllByText("When stacked")).toHaveLength(1);
  });
});
