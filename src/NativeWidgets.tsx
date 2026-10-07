import type { DesktopSnapshot } from "../shared/types";
import type { Run } from "./Workspace";
import { DesktopSlotView } from "./DesktopExtensions";
import { StyledText } from "./StyledText";

export function NativeWidgets({
  snapshot,
  placement,
  run,
}: {
  snapshot: DesktopSnapshot;
  placement: "aboveEditor" | "belowEditor";
  run: Run;
}) {
  const order = snapshot.widgetOrder ?? Object.keys(snapshot.widgets);
  const registered = new Set(order.map((key) => `widget:${key}`));
  return (
    <>
      {order
        .filter(
          (key) =>
            (snapshot.widgetPlacements[key] ?? "aboveEditor") === placement,
        )
        .map((key) => {
          const lines = snapshot.widgets[key];
          if (lines !== undefined)
            return (
              <pre
                className="extension-widgets"
                key={key}
                data-pi-widget={key}
                data-extension-widget={key}
              >
                <StyledText
                  {...(snapshot.extensionUI.textPresentation?.widgets[key] ?? {
                    text: lines.join("\n"),
                  })}
                />
              </pre>
            );
          const surface = snapshot.desktopSurfaces.find(
            (surface) => surface.id === `widget:${key}`,
          );
          return surface ? (
            <div key={key} data-pi-widget={key}>
              <DesktopSlotView
                surfaces={[surface]}
                slot={placement}
                run={run}
              />
            </div>
          ) : null;
        })}
      <DesktopSlotView
        surfaces={snapshot.desktopSurfaces.filter(
          (surface) => !registered.has(surface.id),
        )}
        slot={placement}
        run={run}
      />
    </>
  );
}
