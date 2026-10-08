import {
  createContext,
  useContext,
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type HTMLAttributes,
  type ReactNode,
  type CSSProperties,
} from "react";
import { createPortal } from "react-dom";
import { LoaderCircle, type LucideIcon } from "lucide-react";

/** Native React controls; all visual decisions come from Tailwind and design tokens. */
export function Button({
  children,
  icon: Icon,
  endIcon: EndIcon,
  variant = "solid",
  color = "neutral",
  size = "medium",
  align = "center",
  fullWidth,
  highlighted,
  loading,
  disabled,
  pending,
  attributes,
  className,
  ...props
}: Omit<ButtonHTMLAttributes<HTMLButtonElement>, "color"> & {
  icon?: LucideIcon;
  endIcon?: LucideIcon;
  variant?: "solid" | "ghost" | "outline";
  color?: "primary" | "critical" | "neutral";
  size?: "small" | "medium";
  align?: "center" | "start";
  fullWidth?: boolean;
  highlighted?: boolean;
  loading?: boolean;
  pending?: boolean;
  attributes?: ButtonHTMLAttributes<HTMLButtonElement> &
    Record<`data-${string}`, unknown>;
}) {
  const tone =
    variant === "ghost"
      ? color === "critical"
        ? "text-danger"
        : "text-ink"
      : color === "primary"
        ? "border-transparent bg-coral text-white active:bg-coral-pressed disabled:bg-line disabled:text-muted"
        : color === "critical"
          ? "border-danger/25 bg-danger/10 text-danger active:bg-danger/20"
          : "border-line bg-canvas text-ink active:bg-card";
  return (
    <button
      {...props}
      {...attributes}
      type={props.type ?? "button"}
      disabled={disabled || loading}
      aria-busy={loading || pending || undefined}
      aria-disabled={pending || attributes?.["aria-disabled"] || props["aria-disabled"]}
      onClick={(event) => {
        if (pending) { event.preventDefault(); event.stopPropagation(); return; }
        (attributes?.onClick ?? props.onClick)?.(event);
      }}
      data-ui-button
      data-variant={variant}
      data-color={color}
      className={`inline-flex appearance-none shrink-0 items-center ${align === "start" ? "justify-start text-left" : "justify-center"} gap-2 ${children ? "rounded-lg" : "rounded-full"} border font-medium leading-5 outline-none focus-visible:ring-2 focus-visible:ring-coral/50 focus-visible:ring-offset-2 focus-visible:ring-offset-canvas disabled:cursor-not-allowed disabled:opacity-50 ${size === "small" ? "min-h-8 text-[13px]" : "min-h-9 text-sm"} ${children ? (size === "small" ? "px-2 py-1" : "px-3 py-1.5") : "aspect-square p-0"} ${variant === "ghost" ? `border-transparent ${highlighted ? "bg-card" : "bg-transparent"} active:bg-card` : ""} ${tone} ${fullWidth ? "w-full" : ""} ${className ?? ""} ${attributes?.className ?? ""}`}
    >
      {loading ? (
        <LoaderCircle className="size-4 shrink-0 animate-spin" aria-hidden />
      ) : Icon ? (
        <Icon className="size-4 shrink-0" aria-hidden />
      ) : null}
      {children}
      {EndIcon && <EndIcon className="size-4 shrink-0" aria-hidden />}
    </button>
  );
}

export function Switch({
  name,
  checked,
  disabled,
  onChange,
  size: _size,
  children,
}: {
  name: string;
  checked?: boolean;
  disabled?: boolean;
  size?: "small";
  children?: ReactNode;
  onChange: (event: { checked: boolean; name: string }) => void;
}) {
  const control = (
    <input
      type="checkbox"
      role="switch"
      name={name}
      checked={!!checked}
      disabled={disabled}
      className="ui-switch relative h-5 w-9 shrink-0 cursor-pointer appearance-none rounded-full border border-line bg-card outline-none before:absolute before:top-0.5 before:left-0.5 before:size-3.5 before:rounded-full before:bg-white before:shadow-sm checked:border-coral checked:bg-coral checked:before:translate-x-4 focus-visible:ring-2 focus-visible:ring-coral/50 focus-visible:ring-offset-2 focus-visible:ring-offset-canvas disabled:cursor-not-allowed disabled:opacity-50"
      onChange={(event) => onChange({ checked: event.target.checked, name })}
    />
  );
  return children ? (
    <label className="inline-flex items-center gap-2 text-sm text-body">
      {control}
      <span>{children}</span>
    </label>
  ) : (
    control
  );
}

const TitleId = createContext("");
const dialogStack: HTMLElement[] = [];
const focusable =
  'button:not(:disabled),input:not(:disabled),textarea:not(:disabled),select:not(:disabled),a[href],[tabindex]:not([tabindex="-1"])';
function ModalRoot({
  active,
  onClose,
  children,
  size = "480px",
  padding,
  className,
  ariaLabel,
  attributes,
  disableCloseOnOutsideClick,
}: {
  active?: boolean;
  onClose: () => void;
  children: ReactNode;
  size?: string;
  padding?: number;
  className?: string;
  ariaLabel?: string;
  attributes?: HTMLAttributes<HTMLDivElement> &
    Record<`data-${string}`, unknown>;
  disableCloseOnOutsideClick?: boolean;
}) {
  const titleId = useId();
  const root = useRef<HTMLDivElement>(null);
  const close = useRef(onClose);
  close.current = onClose;
  useLayoutEffect(() => {
    if (!active || !root.current) return;
    const element = root.current;
    const previous =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    dialogStack.push(element);
    // SDK dialogs can assign their own initial focus during mounting.
    const frame = requestAnimationFrame(() => {
      if (!element.contains(document.activeElement))
        (
          element.querySelector<HTMLElement>("[autofocus]") ??
          element.querySelector<HTMLElement>(focusable) ??
          element
        ).focus({ preventScroll: true });
    });
    const key = (event: KeyboardEvent) => {
      if (
        dialogStack.at(-1) !== element ||
        event.defaultPrevented ||
        event.isComposing
      )
        return;
      if (event.key === "Escape") {
        event.preventDefault();
        close.current();
      }
      if (event.key !== "Tab") return;
      // Select menus live in portals and manage their own keyboard cycle.
      if (
        !element.contains(document.activeElement) &&
        document.activeElement?.closest('[role="listbox"],[role="menu"]')
      )
        return;
      const nodes = [
        ...element.querySelectorAll<HTMLElement>(focusable),
      ].filter(
        (node) =>
          node.getClientRects().length && !node.closest("[hidden],[inert]"),
      );
      const first = nodes[0],
        last = nodes.at(-1);
      if (!first) {
        event.preventDefault();
        element.focus();
      } else if (
        event.shiftKey &&
        (document.activeElement === first ||
          !element.contains(document.activeElement))
      ) {
        event.preventDefault();
        last?.focus();
      } else if (
        !event.shiftKey &&
        (document.activeElement === last ||
          !element.contains(document.activeElement))
      ) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", key);
    return () => {
      cancelAnimationFrame(frame);
      document.removeEventListener("keydown", key);
      dialogStack.splice(dialogStack.indexOf(element), 1);
      if (previous?.isConnected) previous.focus({ preventScroll: true });
    };
  }, [active]);
  if (!active) return null;
  return createPortal(
    <div
      className="fixed inset-0 z-[1000] flex items-center justify-center bg-black/25 p-6"
      data-modal-backdrop
      onPointerDown={(event) => {
        if (event.target === event.currentTarget && !disableCloseOnOutsideClick)
          close.current();
      }}
    >
      <div
        {...attributes}
        ref={root}
        role="dialog"
        aria-modal="true"
        aria-label={ariaLabel}
        aria-labelledby={ariaLabel ? undefined : titleId}
        tabIndex={-1}
        className={`ui-dialog relative max-h-[calc(100dvh-48px)] max-w-[calc(100vw-48px)] overflow-y-auto rounded-2xl border border-line bg-canvas text-ink outline-none ${padding === 0 ? "p-0" : "p-6"} ${className ?? ""} ${attributes?.className ?? ""}`}
        style={{ width: size, ...attributes?.style }}
      >
        <TitleId.Provider value={titleId}>{children}</TitleId.Provider>
      </div>
    </div>,
    document.body,
  );
}
function ModalTitle({ children }: { children: ReactNode }) {
  return (
    <h2
      id={useContext(TitleId)}
      className="mb-4 font-display text-[22px] font-normal leading-tight tracking-[-0.02em]"
    >
      {children}
    </h2>
  );
}
export const Modal = Object.assign(ModalRoot, { Title: ModalTitle });

export function Tooltip({
  text,
  children,
  contentAttributes,
  contentMaxWidth = "min(320px, calc(100vw - 24px))",
  contentZIndex = 10020,
}: {
  text: ReactNode;
  children: (attributes: HTMLAttributes<HTMLElement>) => ReactNode;
  contentAttributes?: HTMLAttributes<HTMLDivElement>;
  contentMaxWidth?: string;
  contentZIndex?: number;
}) {
  const id = useId();
  const tip = useRef<HTMLDivElement>(null);
  const openTimer = useRef<number | undefined>(undefined);
  const [target, setTarget] = useState<HTMLElement | null>(null);
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const [position, setPosition] = useState<CSSProperties>({});
  const hide = useCallback(() => {
    window.clearTimeout(openTimer.current);
    openTimer.current = undefined;
    setTarget(null);
    setAnchor(null);
  }, []);
  useEffect(() => {
    if (!target) return;
    const timer = window.setTimeout(() => {
      openTimer.current = undefined;
      if (target.isConnected) setAnchor(target);
    }, 500);
    openTimer.current = timer;
    window.addEventListener("scroll", hide, true);
    window.addEventListener("blur", hide);
    return () => {
      window.clearTimeout(timer);
      if (openTimer.current === timer) openTimer.current = undefined;
      window.removeEventListener("scroll", hide, true);
      window.removeEventListener("blur", hide);
    };
  }, [target, hide]);
  useLayoutEffect(() => {
    if (!anchor) return;
    const box = anchor.getBoundingClientRect();
    const width = tip.current?.getBoundingClientRect().width ?? 160;
    setPosition({
      left: Math.max(
        12,
        Math.min(innerWidth - width - 12, box.left + box.width / 2 - width / 2),
      ),
      top: box.bottom + 8 < innerHeight - 60 ? box.bottom + 8 : undefined,
      bottom:
        box.bottom + 8 < innerHeight - 60
          ? undefined
          : innerHeight - box.top + 8,
    });
  }, [anchor]);
  return (
    <>
      {children({
        "aria-describedby": anchor ? id : undefined,
        onMouseEnter: (event) => setTarget(event.currentTarget),
        onMouseLeave: hide,
        onFocus: (event) => setTarget(event.currentTarget),
        onBlur: hide,
        onPointerDown: hide,
      })}
      {anchor &&
        createPortal(
          <div
            {...contentAttributes}
            ref={tip}
            id={id}
            role="tooltip"
            className="pointer-events-none fixed font-sans rounded-lg bg-ink px-3 py-2 text-xs leading-5 text-canvas shadow-sm"
            style={{
              ...position,
              maxWidth: contentMaxWidth,
              zIndex: contentZIndex,
            }}
          >
            {text}
          </div>,
          document.body,
        )}
    </>
  );
}
