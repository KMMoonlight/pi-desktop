import { test } from "@playwright/test";
import { verifyInteractiveRender } from "../interactive-render-workflows.ts";
import { verifyListRender } from "../list-render-workflows.ts";
import { verifyNestedFrame } from "../nested-frame-workflows.ts";
import {
  verifyRenderAdditions,
  verifyStandardRenderAdditions,
  verifyPassiveRenderReplacement,
  verifyEmptyRender,
  verifyRenderBaseline,
  verifyContainerRender,
} from "../render-additions-workflows.ts";

for (const width of [1440, 390])
  for (const parentKind of ["HStack", "ScrollView"])
    for (const kind of [
      "Input",
      "Editor",
      "CustomEditor",
      "SelectList",
      "SettingsList",
    ])
      test(`layout frame ${parentKind} retains ${kind} operations at ${width}px`, async ({
        page,
      }) => {
        await page.setViewportSize({ width, height: 940 });
        await page.goto("/");
        await verifyNestedFrame(
          page,
          parentKind,
          kind,
          `.local/screenshots/layout-frame-${parentKind}-${kind}-${width}.png`,
        );
      });

for (const width of [1440, 390])
  for (const parentKind of ["HStack", "ScrollView"])
    for (const kind of ["Editor", "SettingsList"])
      for (const innerKinds of [["Box"], ["Container", "Box", "VStack"]])
        test(`layout frame nested ${parentKind} retains ${kind} through ${innerKinds.join("/")} at ${width}px`, async ({
          page,
        }) => {
          await page.setViewportSize({ width, height: 940 });
          await page.goto("/");
          await verifyNestedFrame(
            page,
            parentKind,
            kind,
            `.local/screenshots/layout-frame-nested-${parentKind}-${kind}-${innerKinds.length}-${width}.png`,
            innerKinds,
          );
        });

for (const width of [1440, 390])
  for (const parentKind of ["Container", "Box", "VStack"])
    for (const kind of [
      "Input",
      "Editor",
      "CustomEditor",
      "SelectList",
      "SettingsList",
    ])
      test(`recursive ${parentKind} transformations retain ${kind} operations at ${width}px`, async ({
        page,
      }) => {
        await page.setViewportSize({ width, height: 940 });
        await page.goto("/");
        await verifyNestedFrame(
          page,
          parentKind,
          kind,
          `.local/screenshots/recursive-frame-${parentKind}-${kind}-${width}.png`,
          ["Container", "Box", "VStack"],
        );
      });

for (const width of [1440, 390])
  for (const innerKind of ["Container", "Box", "VStack"])
    test(`recursive plain ${innerKind} retains original editor operations at ${width}px`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height: 940 });
      await page.goto("/");
      await verifyNestedFrame(
        page,
        "Box",
        "Editor",
        `.local/screenshots/recursive-plain-${innerKind}-${width}.png`,
        [`plain:${innerKind}`],
      );
    });

for (const width of [1440, 390])
  for (const parentKind of ["Container", "Box", "VStack"])
    for (const kind of [
      "Input",
      "Editor",
      "CustomEditor",
      "SelectList",
      "SettingsList",
    ])
      test(`parent ${parentKind} transformations retain nested ${kind} operations at ${width}px`, async ({
        page,
      }) => {
        await page.setViewportSize({ width, height: 940 });
        await page.goto("/");
        await verifyNestedFrame(
          page,
          parentKind,
          kind,
          `.local/screenshots/nested-frame-${parentKind}-${kind}-${width}.png`,
        );
      });

for (const width of [1440, 390])
  for (const kind of ["SelectList", "SettingsList"])
    for (const helper of [false, true])
      test(`custom ${kind} frames retain SDK operations at ${width}px, inherited helper ${helper}`, async ({
        page,
      }) => {
        await page.setViewportSize({ width, height: 940 });
        await page.goto("/");
        await verifyListRender(
          page,
          kind,
          helper,
          `.local/screenshots/list-frame-${kind}-${width}-${helper}.png`,
        );
      });

for (const width of [1440, 390])
  for (const kind of ["Input", "Editor", "CustomEditor"])
    test(`interactive ${kind} custom frames retain SDK editing without native plaintext at ${width}px`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height: 940 });
      await page.goto("/");
      await verifyInteractiveRender(
        page,
        kind,
        `.local/screenshots/interactive-frame-${kind}-${width}.png`,
      );
    });

for (const width of [1440, 390])
  for (const kind of ["Container", "Box", "VStack"])
    test(`vertical ${kind} custom frames preserve original desktop controls at ${width}px`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height: 940 });
      await page.goto("/");
      await verifyContainerRender(
        page,
        kind,
        `.local/screenshots/container-frame-${kind}-${width}.png`,
      );
    });

for (const width of [1440, 390])
  for (const own of [false, true])
    test(`inherited helper renders and original caches retain desktop controls at ${width}px, instance helpers ${own}`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height: 940 });
      await page.goto("/");
      await verifyRenderBaseline(
        page,
        own,
        `.local/screenshots/render-baseline-${width}-${own}.png`,
      );
    });

for (const width of [1440, 390])
  test(`empty standard rendering removes native controls while original SDK operations remain live at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 940 });
    await page.goto("/");
    await verifyEmptyRender(
      page,
      `.local/screenshots/empty-render-${width}.png`,
    );
  });

for (const width of [1440, 390])
  test(`passive standard components retain replacements and original callbacks at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 940 });
    await page.goto("/");
    await verifyPassiveRenderReplacement(
      page,
      `.local/screenshots/passive-render-${width}.png`,
    );
  });

for (const width of [1440, 390])
  test(`nested standard component subclasses retain rendering and original controls at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 940 });
    await page.goto("/");
    await verifyStandardRenderAdditions(
      page,
      `.local/screenshots/standard-render-${width}.png`,
    );
  });

for (const width of [1440, 390])
  test(`standard subclasses preserve custom rendered information at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 940 });
    await page.goto("/");
    await verifyRenderAdditions(
      page,
      `.local/screenshots/render-additions-${width}.png`,
    );
  });
