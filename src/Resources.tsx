import { useState } from "react";
import { Blocks, BookOpen, FileText, Folder, RotateCcw, Wrench } from "lucide-react";
import { t, useLocale } from "./i18n";
import { SettingsButton as Button } from "./SettingsButton";
import { Empty, Field, Hint } from "./ui";
import type { DesktopSnapshot } from "../shared/types";
import type { Run } from "./Workspace";

export function ResourcesView({
  snapshot,
  run,
  useCommand,
}: {
  snapshot?: Pick<
    DesktopSnapshot,
    "resources" | "commands" | "diagnostics" | "busy" | "changing"
  >;
  run: Run;
  useCommand: (command: string) => void;
}) {
  useLocale();
  const [kind, setKind] = useState("all");
  const [search, setSearch] = useState("");
  const [reloading, setReloading] = useState(false);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  if (!snapshot)
    return (
      <section className="settings-resources">
        <Button icon={RotateCcw} disabled onClick={() => {}}>
          {t("重新加载")}
        </Button>
        <Empty icon={Blocks} title={t("请先选择工作区")} />
      </section>
    );
  const titles: Record<string, string> = {
    extension: t("扩展"),
    skill: "Skills",
    prompt: t("提示词模板"),
    context: t("上下文"),
  };
  const resources = snapshot.resources.filter(
    (r) =>
      (kind === "all" || r.kind === kind) &&
      `${r.name} ${r.path} ${r.description ?? ""}`
        .toLowerCase()
        .includes(search.toLowerCase()),
  );
  const commands = snapshot.commands.filter(command =>
    `${command.name} ${command.description ?? ""}`.toLowerCase().includes(search.toLowerCase()),
  );
  const icons: Record<string, typeof Blocks> = { extension: Blocks, skill: BookOpen, prompt: FileText, context: Folder };
  return (
    <section className="settings-resources">
      <div className="settings-toolbar resource-toolbar">
        <Field
          name={t("搜索资源")}
          value={search}
          onChange={setSearch}
          placeholder={t("搜索资源")}
        />
        <Button
          icon={RotateCcw}
          variant="outline"
          disabled={snapshot.busy || snapshot.changing || reloading}
          loading={reloading}
          onClick={async () => {
            setReloading(true);
            try {
              await run("resources.reload");
            } finally {
              setReloading(false);
            }
          }}
        >
          {t("重新加载")}
        </Button>
      </div>
      <div className="resource-filters" role="group" aria-label={t("资源分类")}>
        {["all", "extension", "skill", "prompt", "context"].map((k) => (
          <button
            key={k}
            className={kind === k ? "selected" : ""}
            aria-pressed={kind === k}
            onClick={() => setKind(k)}
          >
            {k === "all" ? t("全部") : titles[k]}
            <span>
              {
                snapshot.resources.filter((r) => k === "all" || r.kind === k)
                  .length
              }
            </span>
          </button>
        ))}
      </div>
      <div className="resource-list">
        {resources.map((resource) => {
          const key = `${resource.kind}-${resource.path}`;
          const Icon = icons[resource.kind] ?? Blocks;
          return (
          <div
            className={`resource-row ${expanded.has(key) ? "description-expanded" : ""}`}
            key={key}
          >
            <Icon size={18} />
            <div>
              <Hint text={resource.path}>
                <strong tabIndex={0}>{resource.name}</strong>
              </Hint>
              {resource.description && <p className={resource.description.length > 120 ? "resource-description-long" : undefined}>{resource.description}</p>}
              {resource.description && resource.description.length > 120 && (
                <Button variant="ghost" className="resource-description-toggle"
                  attributes={{ "aria-expanded": expanded.has(key), "aria-label": `${resource.name} · ${expanded.has(key) ? t("收起说明") : t("展开说明")}` }}
                  onClick={() => setExpanded(previous => {
                    const next = new Set(previous);
                    if (next.has(key)) next.delete(key); else next.add(key);
                    return next;
                  })}>
                  {expanded.has(key) ? t("收起说明") : t("展开说明")}
                </Button>
              )}
            </div>
            <span className="type-label">{titles[resource.kind]}</span>
            {["skill", "prompt"].includes(resource.kind) && (
              <Button
                variant="ghost"
                onClick={() =>
                  useCommand(
                    resource.kind === "skill"
                      ? `/skill:${resource.name} `
                      : `/${resource.name} `,
                  )
                }
              >
                {t("使用")}
              </Button>
            )}
          </div>
        ); })}
        {resources.length === 0 && (
          <Empty icon={Blocks} title={t("没有匹配的资源")} />
        )}
      </div>
      {commands.length > 0 && (
        <>
          <h3 className="section-title">{t("扩展操作")}</h3>
          <div className="command-list">
            {commands.map((command) => (
              <div className="resource-command" key={command.name}>
                <Wrench size={16} />
                <div><strong>/{command.name}</strong>{command.description && <p>{command.description}</p>}</div>
                <Button variant="ghost" attributes={{ "aria-label": `${t("使用")} /${command.name}` }} onClick={() => useCommand(`/${command.name} `)}>{t("使用")}</Button>
              </div>
            ))}
          </div>
        </>
      )}
      {snapshot.diagnostics.length > 0 && (
        <div className="diagnostics">
          <h3>{t("加载诊断")}</h3>
          {snapshot.diagnostics.map((diagnostic, i) => (
            <p key={i}>{diagnostic}</p>
          ))}
        </div>
      )}
    </section>
  );
}
