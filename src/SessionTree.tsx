import { useEffect, useRef, useState } from "react";
import { Button, Switch } from "./primitives";
import {
  Bot,
  ChevronRight,
  GitBranch,
  SlidersHorizontal,
  Tag,
  UserRound,
  Wrench,
} from "lucide-react";
import { t, useLocale, getLocale } from "./i18n";
import { Empty, Field, Hint, IconButton } from "./ui";
import type { DesktopSnapshot, TreeItem } from "../shared/types";
import type { Run } from "./Workspace";

const rowHeight = 52;
const laneWidth = 28;
type TreeRow = { node: TreeItem; lane: number; level: number; parent?: number };

export function TreeView({
  snapshot,
  run,
  editLabel,
}: {
  snapshot: DesktopSnapshot;
  run: Run;
  editLabel: (node: TreeItem) => void;
}) {
  useLocale();
  const [summarize, setSummarize] = useState(true);
  const [filter, setFilter] = useState("");
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [focused, setFocused] = useState(snapshot.leafId);
  const rowElements = useRef(new Map<string, HTMLDivElement>());
  useEffect(() => {
    setCollapsed(new Set());
  }, [snapshot.sessionId]);
  useEffect(() => {
    setFocused(snapshot.leafId);
  }, [snapshot.leafId]);
  const nodeTypeLabels: Record<string, string> = {
    model_change: t("切换模型"),
    thinking_level_change: t("调整思考等级"),
    compaction: t("压缩上下文"),
    branch_summary: t("分支摘要"),
  };
  const nodes = new Map(snapshot.tree.map((node) => [node.id, node]));
  const children = new Map<string, TreeItem[]>();
  for (const node of snapshot.tree) {
    const parent =
      node.parentId && nodes.has(node.parentId) ? node.parentId : "";
    const siblings = children.get(parent) ?? [];
    siblings.push(node);
    children.set(parent, siblings);
  }
  const query = filter.trim().toLowerCase();
  const matches = new Set(
    snapshot.tree
      .filter((node) =>
        `${node.text} ${node.label ?? ""}`.toLowerCase().includes(query),
      )
      .map((node) => node.id),
  );
  if (query)
    for (const id of [...matches]) {
      let parent = nodes.get(id)?.parentId;
      const seen = new Set<string>([id]);
      while (parent && nodes.has(parent) && !seen.has(parent)) {
        seen.add(parent);
        matches.add(parent);
        parent = nodes.get(parent)?.parentId;
      }
    }
  const rows: TreeRow[] = [];
  const visited = new Set<string>();
  const append = (node: TreeItem, lane = 0, level = 1, parent?: number) => {
    if (visited.has(node.id) || (query && !matches.has(node.id))) return;
    visited.add(node.id);
    const index = rows.length;
    rows.push({ node, lane, level, parent });
    const descendants = children.get(node.id) ?? [];
    if (query || !collapsed.has(node.id))
      for (const child of descendants)
        // A conversation stays on one lane until it actually forks.
        append(child, lane + Number(descendants.length > 1), level + 1, index);
  };
  for (const root of children.get("") ?? []) append(root);
  const branch = new Set<string>();
  let pointer = snapshot.leafId;
  while (pointer && nodes.has(pointer) && !branch.has(pointer)) {
    branch.add(pointer);
    pointer = nodes.get(pointer)!.parentId;
  }
  const toggle = (id: string) =>
    setCollapsed((previous) => {
      const next = new Set(previous);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const navigate = (node: TreeItem) => {
    if (!snapshot.busy)
      void run("session.navigate", { id: node.id, summarize });
  };
  const focusRow = (index: number) => {
    const row = rows[index];
    if (row) rowElements.current.get(row.node.id)?.focus();
  };
  const focusId = rows.some((row) => row.node.id === focused)
    ? focused
    : rows[0]?.node.id;
  const x = (lane: number) => 14 + lane * laneWidth;
  const maxLane = rows.reduce((max, row) => Math.max(max, row.lane), 0);
  const edges = rows
    .flatMap((row, index) => {
      if (row.parent === undefined) return [];
      const parent = rows[row.parent];
      const startX = x(parent.lane),
        endX = x(row.lane);
      const startY = row.parent * rowHeight + rowHeight / 2;
      const endY = index * rowHeight + rowHeight / 2;
      return [
        {
          id: row.node.id,
          active: branch.has(row.node.id),
          path:
            startX === endX
              ? `M ${startX} ${startY} V ${endY}`
              : `M ${startX} ${startY} V ${endY - 10} Q ${startX} ${endY} ${startX + 10} ${endY} H ${endX}`,
        },
      ];
    })
    .sort((a, b) => Number(a.active) - Number(b.active));
  return (
    <section className="workspace-section session-tree-view">
      <div className="section-toolbar">
        <Field
          name={t("搜索会话树")}
          value={filter}
          onChange={setFilter}
          placeholder={t("搜索节点")}
        />
        <Switch
          name="branch-summary"
          checked={summarize}
          onChange={({ checked }) => setSummarize(checked)}
        >
          {t("生成分支摘要")}
        </Switch>
        <Button
          size="small"
          variant="ghost"
          onClick={() => setCollapsed(new Set())}
        >
          {t("展开全部")}
        </Button>
        <Button
          size="small"
          variant="ghost"
          disabled={!!query}
          onClick={() => setCollapsed(new Set(children.keys()))}
        >
          {t("折叠全部")}
        </Button>
      </div>
      <div className="session-tree-heading">
        <div>
          <GitBranch size={16} />
          <h2>{t("会话分支")}</h2>
          <span>{t("{value1} 个节点", { value1: snapshot.tree.length })}</span>
        </div>
        <span className="tree-legend">
          <i />
          {t("当前路径")}
        </span>
      </div>
      {snapshot.tree.length === 0 ? (
        <Empty icon={GitBranch} title={t("会话树为空")} />
      ) : (
        <div className="tree-list" role="tree" aria-label={t("会话分支")}>
          <div
            className="session-tree-canvas"
            style={{ minWidth: 280 + maxLane * laneWidth }}
          >
            <svg
              className="tree-connectors"
              width={x(maxLane) + 8}
              height={rows.length * rowHeight}
              aria-hidden="true"
            >
              {edges.map((edge) => (
                  <path
                    key={edge.id}
                    data-node-id={edge.id}
                  className={`tree-edge${edge.active ? " is-active" : ""}`}
                  d={edge.path}
                />
              ))}
            </svg>
            {rows.map(({ node, lane, level }, index) => {
              const descendants = children.get(node.id) ?? [];
              const expanded = !!query || !collapsed.has(node.id);
              const current = node.id === snapshot.leafId;
              const text =
                node.label ||
                (node.text === node.type
                  ? (nodeTypeLabels[node.type] ?? node.text)
                  : node.text) ||
                t("空消息");
              const role =
                node.role === "user"
                  ? t("你")
                  : node.role === "assistant"
                    ? "Pi"
                    : node.role === "toolResult"
                      ? t("工具")
                      : t("事件");
              const Icon =
                node.role === "user"
                  ? UserRound
                  : node.role === "assistant"
                    ? Bot
                    : node.role === "toolResult"
                      ? Wrench
                      : SlidersHorizontal;
              return (
                <div
                  key={node.id}
                  ref={(element) => {
                    if (element) rowElements.current.set(node.id, element);
                    else rowElements.current.delete(node.id);
                  }}
                  className={`tree-row${branch.has(node.id) ? " in-branch" : ""}${current ? " current" : ""}`}
                  data-node-id={node.id}
                  data-lane={lane}
                  role="treeitem"
                  tabIndex={node.id === focusId ? 0 : -1}
                  aria-label={`${role}: ${text}`}
                  aria-level={level}
                  aria-current={current ? "true" : undefined}
                  aria-expanded={descendants.length ? expanded : undefined}
                  onFocus={() => setFocused(node.id)}
                  onKeyDown={(event) => {
                    if (event.target !== event.currentTarget) return;
                    if (
                      ![
                        "ArrowUp",
                        "ArrowDown",
                        "ArrowLeft",
                        "ArrowRight",
                        "Home",
                        "End",
                        "Enter",
                        " ",
                      ].includes(event.key)
                    )
                      return;
                    event.preventDefault();
                    if (event.key === "ArrowUp") focusRow(index - 1);
                    else if (event.key === "ArrowDown") focusRow(index + 1);
                    else if (event.key === "Home") focusRow(0);
                    else if (event.key === "End") focusRow(rows.length - 1);
                    else if (event.key === "ArrowRight") {
                      if (descendants.length && !expanded) toggle(node.id);
                      else if (descendants.length) focusRow(index + 1);
                    } else if (event.key === "ArrowLeft") {
                      if (descendants.length && expanded && !query)
                        toggle(node.id);
                      else if (node.parentId)
                        rowElements.current.get(node.parentId)?.focus();
                    } else navigate(node);
                  }}
                >
                  <span
                    className="tree-gutter"
                    style={{ width: x(lane) + 12 }}
                    aria-hidden="true"
                  >
                    <i
                      className="tree-node-dot"
                      style={{ left: x(lane) - 4 }}
                    />
                  </span>
                  {descendants.length ? (
                    <button
                      type="button"
                      tabIndex={-1}
                      className="tree-toggle"
                      disabled={!!query}
                      aria-label={t("{value1}节点", {
                        value1: expanded ? t("折叠") : t("展开"),
                      })}
                      onClick={() => toggle(node.id)}
                    >
                      <ChevronRight size={14} />
                    </button>
                  ) : (
                    <span className="tree-toggle-spacer" />
                  )}
                  <button
                    className="tree-content"
                    tabIndex={-1}
                    disabled={snapshot.busy}
                    onClick={() => navigate(node)}
                    title={text}
                  >
                    <span
                      className={`tree-kind-icon tree-kind-${node.role ?? "event"}`}
                    >
                      <Icon size={15} />
                    </span>
                    <span className="tree-role">{role}</span>
                    <span className="tree-summary">{text}</span>
                    {current && (
                      <span className="tree-current-badge">
                        {t("当前位置")}
                      </span>
                    )}
                    <time
                      title={new Date(node.timestamp).toLocaleString(
                        getLocale(),
                      )}
                    >
                      {new Date(node.timestamp).toLocaleTimeString(
                        getLocale(),
                        { hour: "2-digit", minute: "2-digit" },
                      )}
                    </time>
                  </button>
                  <span className="tree-label-action">
                    <IconButton
                      icon={Tag}
                      label={t("编辑节点标签")}
                        attributes={{ tabIndex: node.id === focusId ? 0 : -1 }}
                      onClick={() => editLabel(node)}
                    />
                  </span>
                </div>
              );
            })}
          </div>
          {!rows.length && (
            <p className="muted small-pad">{t("没有匹配的节点")}</p>
          )}
        </div>
      )}
    </section>
  );
}
