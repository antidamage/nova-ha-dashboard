import { describe, expect, it } from "vitest";
import { BUILTIN_ORB_MODULE_MAP } from "../../../../lib/orb-modules";
import { groupModule, ORB_GROUPS, orbGroupOf } from "./orbGroups";

// specs/tutorial-mode.md, "Layer sets": the five body cards partition the
// module's layers, so together they are the body and no layer is drawn twice.
describe("orb body groups", () => {
  for (const module of BUILTIN_ORB_MODULE_MAP.values()) {
    it(`partitions every layer of ${module.id} into exactly one group`, () => {
      module.layers.forEach((layer, index) => {
        const owners = ORB_GROUPS.filter((group) => groupModule(module, group).layers[index].enabled !== false);
        if (layer.enabled === false) expect(owners, `layer ${index}`).toEqual([]);
        else expect(owners, `layer ${index}`).toEqual([orbGroupOf(layer)]);
      });
    });

    it(`keeps ${module.id}'s layer order and indices in every group`, () => {
      for (const group of ORB_GROUPS) {
        const grouped = groupModule(module, group);
        expect(grouped.layers.map((layer) => layer.type)).toEqual(module.layers.map((layer) => layer.type));
      }
    });
  }

  it("puts a rim-clipped layer in gloss whatever its type", () => {
    expect(orbGroupOf({ type: "disc", clip: true } as never)).toBe("gloss");
    expect(orbGroupOf({ type: "ring" } as never)).toBe("rings");
    expect(orbGroupOf({ type: "lineField" } as never)).toBe("fields");
    expect(orbGroupOf({ type: "polygon" } as never)).toBe("marks");
  });
});
