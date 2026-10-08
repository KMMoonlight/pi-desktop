import type { ComponentProps } from "react";
import { Button } from "./primitives";

/** Body actions share geometry; their variant conveys the action's priority. */
export function SettingsButton({
  attributes,
  className,
  variant,
  color,
  ...props
}: Omit<ComponentProps<typeof Button>, "size">) {
  return (
    <Button
      {...props}
      size="medium"
      color={color}
      variant={variant ?? (color === "primary" || color === "critical" ? "solid" : "outline")}
      className={["settings-action", className, attributes?.className].filter(Boolean).join(" ")}
      attributes={attributes}
    />
  );
}
