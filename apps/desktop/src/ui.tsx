/**
 * Shared UI building blocks. Every screen uses these instead of ad-hoc markup, so spacing, focus rings,
 * tooltips and menus behave the same everywhere.
 */
import { forwardRef, type ComponentProps, type ReactNode } from "react";
import * as Dropdown from "@radix-ui/react-dropdown-menu";
import * as Tip from "@radix-ui/react-tooltip";
import { ChevronRight, CircleCheck, Info, OctagonAlert, TriangleAlert, type LucideIcon } from "lucide-react";

export const TooltipProvider = ({ children }: { children: ReactNode }) => (
  <Tip.Provider delayDuration={350} skipDelayDuration={150}>
    {children}
  </Tip.Provider>
);

/** A tooltip with an optional keyboard shortcut. */
export function Tooltip({ label, shortcut, side = "bottom", children }: { label: string; shortcut?: string; side?: "top" | "bottom" | "left" | "right"; children: ReactNode }) {
  return (
    <Tip.Root>
      <Tip.Trigger asChild>{children}</Tip.Trigger>
      <Tip.Portal>
        <Tip.Content className="tooltip" side={side} sideOffset={6}>
          {label}
          {shortcut && <span className="kbd">{shortcut}</span>}
        </Tip.Content>
      </Tip.Portal>
    </Tip.Root>
  );
}

type ButtonProps = Omit<ComponentProps<"button">, "children"> & {
  icon?: LucideIcon;
  variant?: "default" | "primary" | "ghost" | "danger";
  size?: "md" | "sm";
  pressed?: boolean;
  children?: ReactNode;
};

/** A button with an optional leading icon. */
export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button({ icon: Icon, variant = "default", size = "md", pressed, className = "", children, ...rest }, ref) {
  const cls = ["btn", variant !== "default" && variant, size === "sm" && "sm", className].filter(Boolean).join(" ");
  return (
    <button ref={ref} type="button" className={cls} aria-pressed={pressed} {...rest}>
      {Icon && <Icon size={size === "sm" ? 14 : 15} strokeWidth={1.8} aria-hidden />}
      {children}
    </button>
  );
});

/** An icon-only button. `label` is its accessible name and its tooltip. */
export const IconButton = forwardRef<HTMLButtonElement, Omit<ButtonProps, "children"> & { label: string; shortcut?: string; badge?: ReactNode; tooltipSide?: "top" | "bottom" | "left" | "right" }>(function IconButton(
  { icon: Icon, label, shortcut, badge, variant = "ghost", size = "md", pressed, className = "", tooltipSide, ...rest },
  ref,
) {
  const cls = ["btn", "icon", variant !== "default" && variant, size === "sm" && "sm", className].filter(Boolean).join(" ");
  return (
    <Tooltip label={label} shortcut={shortcut} side={tooltipSide}>
      <button ref={ref} type="button" className={cls} aria-label={label} aria-pressed={pressed} style={badge ? { position: "relative" } : undefined} {...rest}>
        {Icon && <Icon size={size === "sm" ? 14 : 16} strokeWidth={1.8} aria-hidden />}
        {badge}
      </button>
    </Tooltip>
  );
});

export interface MenuItem {
  label: string;
  icon?: LucideIcon;
  shortcut?: string;
  disabled?: boolean;
  onSelect?: () => void;
  /** Nested items open as a submenu. */
  items?: MenuEntry[];
}
export type MenuEntry = MenuItem | "separator" | { heading: string };

function Entries({ items }: { items: MenuEntry[] }) {
  return (
    <>
      {items.map((it, i) => {
        if (it === "separator") return <Dropdown.Separator key={i} className="menu-sep" />;
        if ("heading" in it) return <Dropdown.Label key={i} className="menu-label">{it.heading}</Dropdown.Label>;
        const Icon = it.icon;
        if (it.items)
          return (
            <Dropdown.Sub key={i}>
              <Dropdown.SubTrigger className="menu-item">
                {Icon && <Icon size={15} strokeWidth={1.8} aria-hidden />}
                {it.label}
                <ChevronRight size={14} className="shortcut" aria-hidden />
              </Dropdown.SubTrigger>
              <Dropdown.Portal>
                <Dropdown.SubContent className="menu" sideOffset={4}>
                  <Entries items={it.items} />
                </Dropdown.SubContent>
              </Dropdown.Portal>
            </Dropdown.Sub>
          );
        return (
          <Dropdown.Item key={i} className="menu-item" disabled={it.disabled} onSelect={it.onSelect}>
            {Icon && <Icon size={15} strokeWidth={1.8} aria-hidden />}
            {it.label}
            {it.shortcut && <span className="shortcut">{it.shortcut}</span>}
          </Dropdown.Item>
        );
      })}
    </>
  );
}

/** A dropdown menu on any trigger (usually a Button or IconButton). */
export function Menu({ trigger, items, align = "start", label }: { trigger: ReactNode; items: MenuEntry[]; align?: "start" | "end" | "center"; label?: string }) {
  return (
    <Dropdown.Root modal={false}>
      <Dropdown.Trigger asChild>{trigger}</Dropdown.Trigger>
      <Dropdown.Portal>
        <Dropdown.Content className="menu" align={align} sideOffset={6} aria-label={label}>
          <Entries items={items} />
        </Dropdown.Content>
      </Dropdown.Portal>
    </Dropdown.Root>
  );
}

/** Title, description and actions at the top of every page. */
export function PageHeader({ title, description, actions, icon: Icon }: { title: string; description?: ReactNode; actions?: ReactNode; icon?: LucideIcon }) {
  return (
    <header className="page-header">
      {Icon && (
        <span className="brand-mark" style={{ width: 32, height: 32, borderRadius: 8, background: "var(--accent-soft)", color: "var(--accent-soft-text)" }} aria-hidden>
          <Icon size={17} strokeWidth={1.8} />
        </span>
      )}
      <div className="titles">
        <h2>{title}</h2>
        {description && <p>{description}</p>}
      </div>
      {actions && <div className="actions">{actions}</div>}
    </header>
  );
}

/** What a screen shows when it has nothing yet, with the next step. */
export function EmptyState({ icon: Icon, title, children, action }: { icon?: LucideIcon; title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="empty">
      {Icon && <Icon size={28} strokeWidth={1.5} aria-hidden />}
      <h3>{title}</h3>
      {children && <p style={{ margin: "0 auto 14px", maxWidth: 440 }}>{children}</p>}
      {action}
    </div>
  );
}

/** Segmented tabs. */
export function Tabs<T extends string>({ value, onChange, tabs, label }: { value: T; onChange(v: T): void; tabs: [T, string][]; label: string }) {
  return (
    <div role="tablist" aria-label={label} className="tabs">
      {tabs.map(([id, text]) => (
        <button key={id} type="button" role="tab" aria-selected={value === id} onClick={() => onChange(id)}>
          {text}
        </button>
      ))}
    </div>
  );
}

/** The platform's modifier key for shortcut hints. */
export const MOD = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform) ? "⌘" : "Ctrl+";

const SEVERITY: Record<"error" | "warning" | "info" | "ok", [LucideIcon, string]> = {
  error: [OctagonAlert, "var(--danger)"],
  warning: [TriangleAlert, "var(--warn)"],
  info: [Info, "var(--faint)"],
  ok: [CircleCheck, "var(--ok)"],
};
/** A severity marker: shape and colour differ, so colour is never the only signal. */
export function SeverityIcon({ level, size = 15 }: { level: "error" | "warning" | "info" | "ok"; size?: number }) {
  const [Icon, color] = SEVERITY[level];
  return <Icon size={size} strokeWidth={2} style={{ color, flex: "none" }} aria-label={level} role="img" />;
}

/** A link target from workspace or imported data, limited to web and mail links: anything else (javascript:, file:, data:) becomes inert. */
export const safeHref = (href: string) => (/^(https?:|mailto:)/i.test(href.trim()) ? href.trim() : undefined);
