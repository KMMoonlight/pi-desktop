import type { LucideIcon } from "lucide-react";
import { formatNumber } from "./i18n";
import { Button, Tooltip } from "./primitives";
import { SelectControl } from "./SelectControl";
import {
  cloneElement,
  type HTMLAttributes,
  type ReactElement,
  type ReactNode,
  type SelectHTMLAttributes,
  useId,
} from "react";

export function Hint({
  text,
  children,
}: {
  text: ReactNode;
  children: ReactElement<HTMLAttributes<HTMLElement>>;
}) {
  return (
    <Tooltip
      text={text}
      contentAttributes={{ className: "ui-tooltip" }}
      contentMaxWidth="min(320px, calc(100vw - 24px))"
      contentZIndex={10020}
    >
      {(attributes) =>
        cloneElement(children, { ...children.props, ...attributes })
      }
    </Tooltip>
  );
}

export function IconButton({
  icon,
  label,
  onClick,
  disabled,
  active,
  color,
  attributes: buttonAttributes,
}: {
  icon: LucideIcon;
  label: string;
  onClick: () => void;
  disabled?: boolean;
  active?: boolean;
  color?: "critical";
  attributes?: HTMLAttributes<HTMLButtonElement> & {
    [name: `data-${string}`]: string | number | boolean | undefined;
  };
}) {
  return (
    <Tooltip
      text={label}
      contentAttributes={{ className: "ui-tooltip" }}
      contentMaxWidth="min(320px, calc(100vw - 24px))"
      contentZIndex={10020}
    >
      {(attributes) => (
        <Button
          icon={icon}
          variant="ghost"
          size="small"
          className="size-8 min-h-8 rounded-full"
          disabled={disabled}
          color={color}
          highlighted={active}
          onClick={onClick}
          attributes={{
            ...attributes,
            ...buttonAttributes,
            "aria-label": label,
          }}
        />
      )}
    </Tooltip>
  );
}
export function Field({
  label,
  name,
  value,
  onChange,
  placeholder,
  secret,
  autoFocus,
  readOnly,
  type,
  appearance = "outlined",
}: {
  label?: string;
  name: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  secret?: boolean;
  autoFocus?: boolean;
  readOnly?: boolean;
  type?: "text" | "number";
  appearance?: "outlined" | "embedded";
}) {
  return (
    <label className={`field field-${appearance}`}>
      {label && <span>{label}</span>}
      <input
        className="min-h-9 w-full rounded-lg border border-line bg-canvas px-3 py-1.5 text-sm text-ink outline-none focus:border-coral focus:ring-[3px] focus:ring-coral/15"
        name={name}
        autoFocus={autoFocus}
        readOnly={readOnly}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        aria-label={label ?? name}
        type={secret ? "password" : (type ?? "text")}
      />
    </label>
  );
}
export function SelectField({
  label,
  labelContent,
  description,
  name,
  value,
  onChange,
  children,
  disabled,
  inputAttributes,
  pending,
  appearance = "outlined",
}: {
  label?: string;
  labelContent?: ReactNode;
  description?: ReactNode;
  name: string;
  value: string;
  onChange: (value: string) => void;
  children: ReactNode;
  disabled?: boolean;
  pending?: boolean;
  appearance?: "outlined" | "embedded";
  inputAttributes?: SelectHTMLAttributes<HTMLSelectElement> & {
    "data-desktop-action"?: string;
  };
}) {
  const labelId = useId();
  if (!inputAttributes)
    return (
      <div className={`field field-${appearance}`}>
        {label && (
          <span className="field-label">
            <span id={labelId}>{labelContent ?? label}</span>
            {description && (
              <small id={`${labelId}-description`}>{description}</small>
            )}
          </span>
        )}
        <SelectControl
          name={label ?? name}
          value={value}
          onChange={onChange}
          disabled={disabled}
          pending={pending}
          labelledBy={label ? labelId : undefined}
          describedBy={description ? `${labelId}-description` : undefined}
        >
          {children}
        </SelectControl>
      </div>
    );
  return (
    <label className={`field field-${appearance}`}>
      {label && <span>{labelContent ?? label}</span>}
      <select
        {...inputAttributes}
        name={name}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        disabled={disabled || pending}
        aria-label={inputAttributes?.["aria-label"] ?? label ?? name}
      >
        {children}
      </select>
    </label>
  );
}
export function Empty({
  icon: Icon,
  title,
  children,
}: {
  icon: LucideIcon;
  title: string;
  children?: ReactNode;
}) {
  return (
    <div className="empty-state flex min-w-0 flex-col items-center justify-center gap-3 text-center text-muted">
      <Icon size={30} strokeWidth={1.4} />
      <h2>{title}</h2>
      {children}
    </div>
  );
}
export function number(value: number | undefined) {
  return formatNumber(value ?? 0, { maximumFractionDigits: 1 });
}
export function money(value: number) {
  return `$${value.toFixed(value < 0.01 ? 5 : 3)}`;
}
export function baseName(value: string) {
  return value.split(/[\\/]/).filter(Boolean).pop() ?? value;
}
