import { t, useLocale } from "./i18n";
import { Button } from "reshaped";
import type { DialogRequest } from "../shared/types";
import { StyledText } from "./StyledText";

export function DialogOptions({
  dialog,
  onAnswer,
}: {
  dialog: DialogRequest;
  onAnswer: (value: string) => void;
}) {
  useLocale();
  return (
    <div className="dialog-options">
      {dialog.options?.map((option, index) => {
        const value = typeof option === "string" ? option : option.value;
        const mapped = dialog.presentation?.options?.[index];
        const label = mapped?.label ?? {
          text: typeof option === "string" ? option : option.label,
        };
        const description =
          mapped?.description ??
          (typeof option !== "string" && option.description !== undefined
            ? { text: option.description }
            : undefined);
        const hasLinks = [label, description].some((text) =>
          text?.runs?.some((run) => run.href),
        );
        const content = (
          <span className="dialog-option-content">
            <span>
              <StyledText {...label} desktopCopy={dialog.desktopOptions} />
            </span>
            {description && (
              <span className="dialog-option-description">
                <StyledText {...description} />
              </span>
            )}
          </span>
        );
        return hasLinks ? (
          <div key={`${index}:${value}`} className="dialog-option-with-links">
            {content}
            <Button
              variant="outline"
              attributes={{
                "aria-label": t("选择 {value1}", { value1: label.text }),
                "data-dialog-option": String(index),
              }}
              onClick={() => onAnswer(value)}
            >
              {t("选择")}
            </Button>
          </div>
        ) : (
          <Button
            key={`${index}:${value}`}
            variant="outline"
            fullWidth
            attributes={{ "data-dialog-option": String(index) }}
            onClick={() => onAnswer(value)}
          >
            {content}
          </Button>
        );
      })}
    </div>
  );
}
