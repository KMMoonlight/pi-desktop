import { t, useLocale, localizeText } from "./i18n";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { Button, Modal, Switch, Tooltip } from "./primitives";
import {
  Plus,
  Search,
  Settings2,
  FolderOpen,
  MessageSquare,
  GitBranch,
  Files,
  PanelLeftClose,
  PanelLeftOpen,
  PanelRightClose,
  PanelRightOpen,
  MoreHorizontal,
  PencilLine,
  CopyPlus,
  Copy,
  CircleCheck,
  Upload,
  Download,
  Minimize2,
  ArrowUp,
  Square,
  X,
  Wrench,
  Check,
  CircleAlert,
  Clock3,
  Terminal,
  ExternalLink,
  LoaderCircle,
  Gauge,
} from "lucide-react";
import {
  action,
  subscribe,
  selectFolder,
  selectSession,
  exportPath,
  external,
  setDesktopWindowState,
} from "./client";
import {
  Field,
  SelectField,
  IconButton,
  Empty,
  baseName,
  money,
  number,
  Hint,
} from "./ui";
import { Messages } from "./Messages";
import { PiLogo } from "./PiLogo";
import { GenerationStatus, SessionTokenUsage } from "./GenerationStatus";
import { ImagePreview } from "./ImagePreview";
import { TranscriptLayout, syncTranscriptLayout } from "./TranscriptLayout";
import { TerminalPanel } from "./TerminalPanel";
import { StyledText } from "./StyledText";
import { NativeWidgets } from "./NativeWidgets";
import { resizeComposer } from "./composer-layout";
import { DialogCountdown } from "./DialogCountdown";
import { DialogOptions } from "./DialogOptions";
import {
  DesktopSlotView,
  DesktopExtensionDialog,
  desktopFocusRevision,
} from "./DesktopExtensions";
import { Autocomplete } from "./Autocomplete";
import { useTextSelection } from "./useTextSelection";
import { closeDesktop } from "./client";
import { useExtensionInput } from "./ExtensionInput";
import { enqueueExtensionEvent } from "./extensionEvents";
import { FilesView, TreeView, type Run } from "./Workspace";
import { SettingsView } from "./Settings";
import { UpdateNotice } from "./AppUpdates";
import { startUpdateChecks } from "./updates";
import { useSessionDraft } from "./draft";
import { useSessionActivity } from "./useSessionActivity";
import type {
  DesktopEvent,
  DesktopSnapshot,
  DesktopSettingsSnapshot,
  DialogRequest,
  SessionItem,
  FilePreview,
  TreeItem,
} from "../shared/types";
import { SessionRail } from "./SessionRail";
import { ContextMenu } from "./ContextMenu";
import { WorkspacePicker } from "./WorkspacePicker";
import { FolderPicker } from "./FolderPicker";
import { menuKeyboard } from "./menuKeyboard";
import { ContextUsage } from "./ContextUsage";
import { FileNavigation, FileWorkspace, type FileTarget } from "./FileNavigation";

type LocalDialog = {
  kind: "name" | "label" | "compact" | "import" | "export" | "bash" | "delete" | "workspace-remove";
  value: string;
  id?: string;
  path?: string;
  format?: string;
  error?: string;
};
type Notice = {
  id: number;
  message: string;
  level: string;
  desktopCopy?: boolean;
  presentation?: Extract<DesktopEvent, { type: "notice" }>["presentation"];
};
export function App() {
  useLocale();
  useEffect(startUpdateChecks, []);
  const [updateRequest, setUpdateRequest] = useState(0);
const tabs = [
  { id: "chat", name: t("对话"), icon: MessageSquare },
  { id: "files", name: t("文件与更改"), icon: Files },
  { id: "tree", name: t("会话树"), icon: GitBranch },
];
const labels: Record<string, string> = {
  workspace: t("添加工作区"),
  name: t("会话名称"),
  label: t("节点标签"),
  compact: t("压缩上下文"),
  import: t("导入会话"),
  export: t("导出会话"),
  bash: t("运行 Shell 命令"),
  delete: t("删除会话"),
  "workspace-remove": t("移除工作区"),
};

  const shutdownRequested = useRef(false);
  const [snapshot, storeSnapshot] = useState<DesktopSnapshot>();
  const [globalSettings, setGlobalSettings] = useState<DesktopSettingsSnapshot>();
  const setSnapshot = useCallback((next: DesktopSnapshot) => {
    if (shutdownRequested.current) return;
    storeSnapshot((previous) =>
      previous?.backendId === next.backendId &&
      previous.revision >= next.revision
        ? previous
        : next,
    );
  }, []);
  const [sessions, setSessions] = useState<SessionItem[]>([]);
  const [workspaces, setWorkspaces] = useState<string[]>([]);
  useEffect(() => {
    if (snapshot) setWorkspaces(snapshot.recentWorkspaces);
  }, [snapshot?.recentWorkspaces]);
  const [tab, setTab] = useState("chat");
  const draftKey = snapshot
    ? snapshot.sessionFile
      ? snapshot.sessionId
      : `workspace:${snapshot.cwd}`
    : undefined;
  const [text, setText] = useSessionDraft(draftKey);
  const [attachments, setAttachments] = useState<string[]>([]);
  const [images, setImages] = useState<
    { name: string; data: string; mimeType: string }[]
  >([]);
  const [queueMode, setQueueMode] = useState(() =>
    localStorage.getItem("pi.messageMode") === "followUp" ? "followUp" : "steer",
  );
  useEffect(() => {
    localStorage.setItem("pi.messageMode", queueMode);
  }, [queueMode]);
  const [search, setSearch] = useState("");
  const [fileTarget, setFileTarget] = useState<FileTarget>();
  const [terminalOpen, setTerminalOpen] = useState(false);
  const [connected, setConnected] = useState(false);
  const [shutdown, setShutdown] = useState(false);
  const [booting, setBooting] = useState(true);
  const [sidebar, setSidebar] = useState(() => innerWidth >= 1024);
  const [inspector, setInspector] = useState(false);
  const [menu, setMenu] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  useEffect(() => {
    const shortcut = (event: KeyboardEvent) => {
      if (
        !(event.ctrlKey || event.metaKey) ||
        event.key !== "," ||
        event.isComposing
      )
        return;
      event.preventDefault();
      event.stopImmediatePropagation();
      setSettingsOpen(true);
    };
    // Register the host shortcut before the SDK editor's capture listener.
    window.addEventListener("keydown", shortcut, true);
    return () => window.removeEventListener("keydown", shortcut, true);
  }, []);
  const menuTrigger = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!menu) return;
    menuTrigger.current
      ?.querySelector<HTMLButtonElement>(".menu-list button:not(:disabled)")
      ?.focus();
    const dismiss = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      event.preventDefault();
      setMenu(false);
      menuTrigger.current?.querySelector<HTMLButtonElement>("button")?.focus();
    };
    document.addEventListener("keydown", dismiss);
    return () => document.removeEventListener("keydown", dismiss);
  }, [menu]);
  const [localDialog, setLocalDialog] = useState<LocalDialog>();
  const [dialogs, setDialogs] = useState<DialogRequest[]>([]);
  const [answer, setAnswer] = useState("");
  const [authLink, setAuthLink] = useState<{
    url: string;
    message?: string;
    id?: string;
    desktopCopy?: boolean;
  }>();
  const [notices, setNotices] = useState<Notice[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [choosingWorkspace, setChoosingWorkspace] = useState(false);
  const [folderPickerOpen, setFolderPickerOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [showThinking, setShowThinking] = useState(
    localStorage.getItem("pi.showThinking") !== "false",
  );
  const [colorMode, setColorMode] = useState(
    localStorage.getItem("pi.colorMode") ?? "light",
  );
  const [pins, setPins] = useState<string[]>(() => {
    try {
      return JSON.parse(localStorage.getItem("pi.pins") ?? "[]");
    } catch {
      return [];
    }
  });
  const searchRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (searchOpen) searchRef.current?.focus();
  }, [searchOpen]);
  const composerRef = useRef<HTMLTextAreaElement>(null);
  const sdkDialogNode = useRef<HTMLDivElement | null>(null);
  const focusSdkDialog = useCallback((node: HTMLDivElement | null) => {
    sdkDialogNode.current = node;
    // Establish Pi's initial selection at mount, before the modal focus trap.
    // A stable ref avoids resetting the user's focus on subsequent updates.
    node
      ?.querySelector<HTMLElement>('[data-dialog-option="0"],input,textarea')
      ?.focus();
  }, []);
  const sendEditor = useRef<(text?: string, mode?: string) => void>(() => {});
  const [pendingSelection, setPendingSelection] =
    useState<import("../shared/desktop-ui").DesktopSelection>();
  const uploadRef = useRef<HTMLInputElement>(null);
  const started = useRef(false);
  const mounted = useRef(true);
  const connectionEpoch = useRef(0);
  const connectionOpen = useRef(false);
  const currentSnapshot = useRef(snapshot);
  currentSnapshot.current = snapshot;
  const draftSession = useRef<string | undefined>(undefined);
  const workspaceIdentity = useRef<string | undefined>(undefined);

  const notify = useCallback(
    (
      message: string,
      level = "info",
      presentation?: Notice["presentation"],
      desktopCopy = true,
    ) => {
      setNotices((previous) => [
        ...previous.slice(-2),
        { id: Date.now() + Math.random(), message, level, presentation, desktopCopy },
      ]);
    },
    [],
  );
  const run: Run = useCallback(
    async <T,>(
      name: string,
      args?: Record<string, unknown>,
      onError?: (message: string) => void,
    ) => {
      const epoch = connectionEpoch.current;
      if (name === "initialize") setBooting(true);
      try {
        if (name === "prompt" || name === "transcript.thinking") {
          await syncTranscriptLayout();
          if (epoch !== connectionEpoch.current) return undefined;
        }
        const data = await action<T>(name, args);
        if (epoch !== connectionEpoch.current) return undefined;
        if (data && typeof data === "object" && "sessionId" in data)
          setSnapshot(data as unknown as DesktopSnapshot);
        return data;
      } catch (error) {
        if (epoch !== connectionEpoch.current) return undefined;
        const message = error instanceof Error ? error.message : String(error);
        if (onError) onError(message);
        else notify(message, "error");
        return undefined;
      } finally {
        if (name === "initialize" && epoch === connectionEpoch.current)
          setBooting(false);
      }
    },
    [notify, setSnapshot],
  );
  const forkMessage = useCallback((id: string) => {
    if (!currentSnapshot.current?.busy) void run("session.fork", { id });
  }, [run]);
  const runSettings: Run = useCallback(async <T,>(name: string, args?: Record<string, unknown>, onError?: (message: string) => void) => {
    const result = await run<T>(name, args, onError);
    if (result !== undefined && name !== "settings.snapshot" && !currentSnapshot.current) {
      const next = await run<DesktopSettingsSnapshot>("settings.snapshot");
      if (next) setGlobalSettings(next);
    }
    return result;
  }, [run]);
  useEffect(() => {
    if (!connected || snapshot) return;
    let active = true;
    void run<DesktopSettingsSnapshot>("settings.snapshot").then(next => {
      if (active && next) setGlobalSettings(next);
    });
    return () => { active = false; };
  }, [connected, !!snapshot, settingsOpen, run]);
  const workspaceReady =
    connected && !booting && !!snapshot && !snapshot.changing;
  const unreadSessions = useSessionActivity(snapshot, workspaceReady && tab === "chat" && !settingsOpen);
  useExtensionInput(connected ? snapshot : undefined, run);
  useTextSelection(composerRef, (target) => {
    if (!workspaceReady) return;
    void run("editor.update", {
      sessionId: snapshot.sessionId,
      text: target.value,
      selection: {
        start: target.selectionStart,
        end: target.selectionEnd,
      },
    });
  });
  useEffect(() => {
    mounted.current = true;
    let cleanup: (() => void) | undefined;
    let initialization = 0;
    const initialize = () => {
      const id = ++initialization;
      const epoch = connectionEpoch.current;
      started.current = true;
      setBooting(true);
      void run<DesktopSnapshot | null>("initialize", {
        resumeExisting: true,
        cwd: localStorage.getItem("pi.workspace.userSelection") ?? undefined,
        appearance: matchMedia("(prefers-color-scheme: dark)").matches
          ? "dark"
          : "light",
      })
        .then((data) => {
          if (!mounted.current || id !== initialization) return;
          started.current = data !== undefined;
          if (data) setSnapshot(data);
          else if (data === null) void run<string[]>("workspaces.list").then((paths) => {
            if (mounted.current && paths) setWorkspaces(paths);
          });
        })
        .finally(() => {
          if (!mounted.current || id !== initialization) return;
          if (
            epoch !== connectionEpoch.current &&
            connectionOpen.current &&
            !shutdownRequested.current
          )
            initialize();
          else setBooting(false);
        });
    };
    void subscribe(
      (event) => {
        if (!mounted.current) return;
        if (event.type === "shutdown") {
          shutdownRequested.current = true;
          setShutdown(true);
          storeSnapshot(undefined);
          setDialogs([]);
          setAuthLink(undefined);
        } else if (event.type === "workspace_closed") {
          storeSnapshot(undefined);
          setWorkspaces(event.workspaces);
          localStorage.setItem("pi.workspace.userSelection", "");
          setTerminalOpen(false);
          setInspector(false);
          setAttachments([]);
          setImages([]);
          setTab("chat");
        } else if (event.type === "snapshot") setSnapshot(event.data);
        else if (event.type === "dialog")
          setDialogs((previous) =>
            previous.some((d) => d.id === event.data.id)
              ? previous
              : [...previous, event.data],
          );
        else if (event.type === "dialog_closed")
          setDialogs((previous) => previous.filter((d) => d.id !== event.id));
        else if (event.type === "notice")
          notify(event.message, event.level, event.presentation, event.desktopCopy === true);
        else if (event.type === "editor") {
          setPendingSelection(event.selection);
          setText((previous) =>
            event.append ? previous + event.text : event.text,
          );
          setTab("chat");
        } else if (event.type === "auth_url")
          setAuthLink({ url: event.url, message: event.message, id: event.id, desktopCopy: event.desktopCopy });
        else if (event.type === "activity") {
          if (event.name === "desktop_editor_exit") void closeDesktop();
          if (event.name === "desktop_editor_submit")
            sendEditor.current(
              typeof event.data === "string" ? event.data : undefined,
            );
          if (event.name === "desktop_editor_followUp")
            sendEditor.current(
              typeof event.data === "string" ? event.data : undefined,
              "followUp",
            );
          if (event.name === "thinking_visible")
            setShowThinking(event.data === true);
          if (
            event.name === "desktop_clipboard_image" &&
            event.data &&
            typeof event.data === "object"
          ) {
            const image = event.data as {
              sessionId: string;
              name: string;
              data: string;
              mimeType: string;
            };
            if (image.sessionId === currentSnapshot.current?.sessionId) {
              setImages((previous) => [...previous, image]);
              setTab("chat");
            }
          }
          if (event.name === "desktop_focus") {
            const previousFocus = document.activeElement;
            const focusRevision = desktopFocusRevision();
            requestAnimationFrame(() => {
              if (
                document.activeElement !== previousFocus ||
                desktopFocusRevision() !== focusRevision
              )
                return;
              if (typeof event.data === "string") {
                const root = document.querySelector<HTMLElement>(
                  `[data-surface-id="${CSS.escape(event.data)}"]`,
                );
                if (root?.contains(document.activeElement)) return;
                (
                  root?.querySelector<HTMLElement>(
                    "input,textarea,select,button,[tabindex]",
                  ) ?? root
                )?.focus();
              } else composerRef.current?.focus();
            });
          }
          if (event.name === "tools_expanded") setExpanded(event.data === true);
          if (event.name === "auth_complete") {
            const id =
              event.data && typeof event.data === "object" && "id" in event.data
                ? event.data.id
                : undefined;
            setAuthLink((current) =>
              !id || current?.id === id ? undefined : current,
            );
          }
          if (
            event.name === "extension_theme" &&
            event.data &&
            typeof event.data === "object"
          ) {
            const appearance = (event.data as { appearance?: string })
              .appearance;
            if (appearance === "dark" || appearance === "light")
              setColorMode(appearance);
          }
        }
      },
      (connected, restarted) => {
        if (!mounted.current) return;
        if (!connected && connectionOpen.current) connectionEpoch.current++;
        connectionOpen.current = connected;
        setConnected(connected);
        if (restarted) {
          connectionEpoch.current++;
          started.current = false;
          storeSnapshot(undefined);
          setSessions([]);
          setDialogs([]);
          setAuthLink(undefined);
          draftSession.current = undefined;
        }
        if (connected && !started.current && !shutdownRequested.current)
          initialize();
      },
    )
      .then((unsubscribe) => {
        cleanup = unsubscribe;
        if (!mounted.current) unsubscribe();
      })
      .catch((error) => {
        notify(error.message, "error");
        setBooting(false);
      });
    return () => {
      mounted.current = false;
      cleanup?.();
    };
  }, [run, notify, setSnapshot]);
  useEffect(() => {
    if (!connected) return;
    const media = matchMedia("(prefers-color-scheme: dark)");
    const update = () => {
      void run("desktop.appearance", {
        appearance: media.matches ? "dark" : "light",
      });
    };
    media.addEventListener("change", update);
    update();
    return () => media.removeEventListener("change", update);
  }, [connected, run]);
  useEffect(() => {
    if (!snapshot) return;
    void setDesktopWindowState(
      snapshot.extensionUI.windowTitle,
      snapshot.extensionUI.windowProgress,
    ).catch((error) =>
      notify(error instanceof Error ? error.message : String(error), "error"),
    );
  }, [
    snapshot?.extensionUI.windowTitle,
    snapshot?.extensionUI.windowProgress,
    notify,
  ]);
  useEffect(() => {
    if (!workspaceReady) return;
    const identity = `${snapshot.backendId}/${snapshot.sessionId}`;
    if (workspaceIdentity.current !== identity) {
      workspaceIdentity.current = identity;
      setAttachments([]);
      setImages([]);
    }
  }, [workspaceReady, snapshot?.backendId, snapshot?.sessionId, snapshot?.cwd]);
  useEffect(() => {
    if (!workspaceReady) return;
    if (draftSession.current !== snapshot.sessionId) {
      draftSession.current = snapshot.sessionId;
      const cached = localStorage.getItem(`pi.draft.${draftKey}`);
      if (cached && !snapshot.editor.text) {
        void run("editor.restore", {
          sessionId: snapshot.sessionId,
          revision: snapshot.editor.revision,
          text: cached,
        });
        return;
      }
    }
    setText(snapshot.editor.text);
  }, [
    snapshot?.sessionId,
    draftKey,
    snapshot?.editor.text,
    snapshot?.editor.revision,
    workspaceReady,
    run,
    setText,
  ]);
  useEffect(() => {
    if (snapshot) setShowThinking(snapshot.settings.hideThinkingBlock !== true);
  }, [snapshot?.settings.hideThinkingBlock]);
  useEffect(() => {
    const timer = setTimeout(() => {
      if (
        workspaceReady &&
        snapshot &&
        !snapshot.desktopSurfaces.some((surface) => surface.slot === "editor")
      )
        void run("editor.update", {
          sessionId: snapshot.sessionId,
          text,
          selection: composerRef.current
            ? {
                start: composerRef.current.selectionStart,
                end: composerRef.current.selectionEnd,
              }
            : undefined,
        });
    }, 200);
    return () => clearTimeout(timer);
  }, [text, snapshot?.sessionId, snapshot?.backendId, workspaceReady, run]);
  useEffect(() => {
    if (pendingSelection && composerRef.current) {
      composerRef.current.setSelectionRange(
        pendingSelection.start,
        pendingSelection.end,
      );
      setPendingSelection(undefined);
    }
  }, [text, pendingSelection]);
  useEffect(() => {
    setAnswer(dialogs[0]?.prefill ?? "");
  }, [dialogs[0]?.id]);
  const loadSessions = useCallback(async () => {
    if (!workspaceReady) return;
    const data = await run<SessionItem[]>("sessions.list", { all: true });
    if (data) setSessions(data);
  }, [workspaceReady, run]);
  useEffect(() => {
    if (snapshot) void loadSessions();
  }, [
    snapshot?.sessionId,
    snapshot?.busy,
    snapshot?.messages.length,
    snapshot?.sessionName,
    loadSessions,
  ]);
  useEffect(() => {
    localStorage.setItem("pi.showThinking", String(showThinking));
  }, [showThinking]);
  useEffect(() => {
    localStorage.setItem("pi.pins", JSON.stringify(pins));
  }, [pins]);
  useEffect(() => {
    localStorage.setItem("pi.colorMode", colorMode);
    const media = matchMedia("(prefers-color-scheme: dark)");
    const update = () => {
      const dark =
        colorMode === "dark" || (colorMode === "system" && media.matches);
      document.documentElement.dataset.theme = dark ? "dark" : "light";
    };
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, [colorMode]);
  useEffect(() => {
    const theme = snapshot?.extensionUI.theme;
    if (!theme) return;
    setColorMode(theme.appearance);
    const root = document.documentElement;
    const mapped: Record<string, string> = {
      accent: "--accent",
      border: "--line",
      text: "--text",
      muted: "--muted",
      error: "--danger",
      selectedBg: "--panel",
    };
    for (const [token, color] of Object.entries(theme.colors)) {
      root.style.setProperty(`--pi-${token}`, color);
      if (mapped[token]) root.style.setProperty(mapped[token], color);
    }
    return () => {
      for (const token of Object.keys(theme.colors)) {
        root.style.removeProperty(`--pi-${token}`);
        if (mapped[token]) root.style.removeProperty(mapped[token]);
      }
    };
  }, [JSON.stringify(snapshot?.extensionUI.theme)]);
  useEffect(() => {
    const keydown = (event: KeyboardEvent) => {
      if (
        (event.ctrlKey || event.metaKey) &&
        event.code === "Backquote" &&
        !event.isComposing
      ) {
        event.preventDefault();
        setTerminalOpen((open) => !open);
        return;
      }
      if (event.target instanceof Element && event.target.closest(".xterm"))
        return;
      if (shutdown) return;
      if (!(event.ctrlKey || event.metaKey)) return;
      if (event.key === "n") {
        event.preventDefault();
        if (!snapshot?.busy) void run("session.new");
      }
      if (event.key === "k") {
        event.preventDefault();
        setSidebar(true);
        setSearchOpen(true);
        searchRef.current?.focus();
      }
      if (event.key === ",") {
        event.preventDefault();
        setSettingsOpen(true);
      }
    };
    window.addEventListener("keydown", keydown);
    return () => window.removeEventListener("keydown", keydown);
  }, [snapshot?.busy, run, shutdown]);
  useEffect(() => {
    setFileTarget(undefined);
  }, [snapshot?.cwd]);
  const startWorkspaceSession = async (
    cwd: string,
    onError?: (message: string) => void,
  ) => {
    const data = snapshot
      ? await run<DesktopSnapshot>("session.new", { cwd }, onError)
      : await run<DesktopSnapshot>("initialize", { cwd }, onError);
    if (data) {
      // Persist only an explicit user selection, never an arriving snapshot.
      localStorage.setItem("pi.workspace.userSelection", data.cwd);
      setTab("chat");
      if (innerWidth < 1024) setSidebar(false);
    }
    return data;
  };
  const addWorkspace = async (
    cwd: string,
    onError?: (message: string) => void,
  ) => {
    const data = await run("workspace.add", { cwd }, onError);
    if (data !== undefined) return startWorkspaceSession(cwd, onError);
  };
  const openWorkspace = async () => {
    if (choosingWorkspace) return;
    setChoosingWorkspace(true);
    try {
      const path = await selectFolder();
      if (path === undefined) setFolderPickerOpen(true);
      else if (path) await addWorkspace(path);
    } catch (error) {
      notify(error instanceof Error ? error.message : String(error), "error");
    } finally {
      setChoosingWorkspace(false);
    }
  };
  const importSession = async () => {
    const path = await selectSession();
    if (path) await run("session.import", { path });
    else if (path === undefined) setLocalDialog({ kind: "import", value: "" });
    setMenu(false);
  };
  const attach = (path: string) => {
    setAttachments((previous) => [...new Set([...previous, path])]);
    setTab("chat");
    requestAnimationFrame(() => {
      composerRef.current?.focus();
      if (snapshot?.desktopSurfaces.some((surface) => surface.slot === "editor"))
        void run("desktop.focus", { id: "editor" });
    });
  };
  const commandName = /^\/([^\s]+)/.exec(text)?.[1];
  const extensionCommand = snapshot?.commands.some(
    (command) => command.name === commandName,
  );
  const hasComposerContent = Boolean(
    text.trim() || attachments.length || images.length,
  );
  const stopButton = Boolean(snapshot?.running && !hasComposerContent);
  const canSend = Boolean(
    hasComposerContent &&
    (snapshot?.model || extensionCommand),
  );
  const send = async (editorText?: string, mode?: string) => {
    if (snapshot?.changing) return;
    const editor = document.querySelector<HTMLTextAreaElement>(
      '[data-surface-id="editor"] textarea',
    );
    const currentText = editorText ?? editor?.value ?? text;
    const allowed =
      editorText === undefined && !editor
        ? canSend
        : !snapshot?.changing &&
          (currentText.trim() || attachments.length || images.length) &&
          (snapshot?.model ||
            snapshot?.commands.some(
              (command) =>
                command.name === /^\/([^\s]+)/.exec(currentText)?.[1],
            ));
    if (!allowed || submitting) return;
    setSubmitting(true);
    const result = await run("prompt", {
      message: currentText.trim() || t("请分析附件。"),
      mode: mode ?? queueMode,
      clearEditor: true,
      files: attachments,
      images: images.map(({ data, mimeType }) => ({ data, mimeType })),
    });
    if (result) {
      setText("");
      setAttachments([]);
      setImages([]);
    }
    setSubmitting(false);
  };
  sendEditor.current = (value, mode) => void send(value, mode);
  const confirmLocal = async () => {
    if (!localDialog || submitting) return;
    const d = localDialog;
    setSubmitting(true);
    let result: unknown;
    const onError = (message: string) =>
      setLocalDialog((current) =>
        current === d ? { ...current, error: message } : current,
      );
    try {
      if (d.kind === "name")
        result = await run("session.name", { name: d.value }, onError);
      if (d.kind === "label")
        result = await run(
          "session.label",
          { id: d.id, label: d.value },
          onError,
        );
      if (d.kind === "compact")
        result = await run("compact", { instructions: d.value }, onError);
      if (d.kind === "import")
        result = await run("session.import", { path: d.value }, onError);
      if (d.kind === "bash")
        result = await run("bash", { command: d.value }, onError);
      if (d.kind === "delete") {
        result = await run("session.delete", { id: d.id, path: d.path }, onError);
        if (result !== undefined) {
          setPins((previous) => previous.filter((id) => id !== d.id));
          localStorage.removeItem(`pi.draft.${d.id}`);
          setSessions((previous) => previous.filter((item) => item.id !== d.id));
          await loadSessions();
        }
      }
      if (d.kind === "workspace-remove") {
        const next = await run<DesktopSnapshot | null>("workspace.remove", { cwd: d.path }, onError);
        result = next;
        if (result !== undefined) {
          if (next) localStorage.setItem("pi.workspace.userSelection", next.cwd);
          const paths = await run<string[]>("workspaces.list");
          if (paths) setWorkspaces(paths);
          setSearch("");
          setTab("chat");
        }
      }
      if (d.kind === "export") {
        const path = await exportPath(d.format ?? "html");
        if (path === null) {
          setSubmitting(false);
          return;
        }
        result = await run<string>(
          "session.export",
          {
            path: path || d.value || undefined,
            format: d.format,
          },
          onError,
        );
        if (result) notify(t("已导出：{value1}", { value1: String(result) }));
      }
      if (result !== undefined) {
        setLocalDialog(undefined);
        if (d.kind === "import") setTab("chat");
      }
    } catch (error) {
      onError(error instanceof Error ? error.message : String(error));
    } finally {
      setSubmitting(false);
    }
  };
  const chooseImages = async (files: FileList | null) => {
    if (!files) return;
    for (const file of files) {
      if (
        !/^image\/(png|jpeg|webp|gif)$/.test(file.type) ||
        file.size > 5 * 1024 * 1024
      ) {
        notify(t("请选择 5 MB 以下的 PNG、JPEG、WebP 或 GIF 图片"), "error");
        continue;
      }
      const reader = new FileReader();
      reader.onload = () =>
        setImages((previous) => [
          ...previous,
          {
            name: file.name,
            mimeType: file.type,
            data: String(reader.result).split(",")[1],
          },
        ]);
      reader.readAsDataURL(file);
    }
  };
  const sessionMatches = sessions
    .filter((s) =>
      `${s.name ?? ""} ${s.firstMessage} ${s.cwd}`
        .toLowerCase()
        .includes(search.toLowerCase()),
    )
    .sort(
      (a, b) =>
        Number(pins.includes(b.id)) - Number(pins.includes(a.id)) ||
        new Date(b.modified).getTime() - new Date(a.modified).getTime(),
    );
  const currentDialog = dialogs[0];
  const navigate = (destination: string) => {
    setTab(destination);
    if (innerWidth < 800) setSidebar(false);
  };
  const openFile = async (target: FileTarget) => {
    const preview = await action<FilePreview>("files.read", {
      path: target.path,
    });
    setFileTarget({ ...target, preview });
    setTab("files");
  };
  const applyComposerText = (value: string) => {
    setText(value);
    if (snapshot)
      void run("editor.update", {
        sessionId: snapshot.sessionId,
        text: value,
        selection: { start: value.length, end: value.length },
      });
  };
  const emptyConversation =
    !!snapshot &&
    snapshot.messages.length === 0 &&
    !snapshot.streaming &&
    !snapshot.conversationNotices?.length;
  const customEditor = snapshot?.desktopSurfaces.some(
    (surface) => surface.slot === "editor",
  );
  useLayoutEffect(() => {
    const editor = composerRef.current;
    if (!editor || customEditor) return;
    const resize = () => resizeComposer(editor);
    resize();
    let width = editor.getBoundingClientRect().width;
    const observer = new ResizeObserver(() => {
      const next = editor.getBoundingClientRect().width;
      if (next !== width) {
        width = next;
        resize();
      }
    });
    observer.observe(editor);
    return () => observer.disconnect();
  }, [text, emptyConversation, customEditor, !!snapshot]);
  if (shutdown)
    return (
      <main className="empty-state" role="status">
        <h2>{t("Pi 已关闭")}</h2>
        <p>{t("可以关闭此窗口。")}</p>
      </main>
    );
  const feedback =
    notices.length > 0 ? (
      <div className="notice-list" aria-label={t("通知")}>
        {notices.map((notice) => (
          <div
            className={`notice notice-${notice.level}`}
            key={notice.id}
            role={notice.level === "error" ? "alert" : "status"}
          >
            <CircleAlert size={15} />
            <span>
              <StyledText
                {...(notice.presentation ?? { text: notice.message })}
                desktopCopy={notice.desktopCopy}
              />
            </span>
            <button
              type="button"
              aria-label={t("关闭通知")}
              onClick={() =>
                setNotices((previous) =>
                  previous.filter((item) => item.id !== notice.id),
                )
              }
            >
              <X size={14} />
            </button>
          </div>
        ))}
      </div>
    ) : undefined;
  return (
    <FileNavigation.Provider value={openFile}>
    <FileWorkspace.Provider value={snapshot?.cwd}>
      <div
        className={`app-shell ${sidebar ? "" : "sidebar-hidden"} ${inspector && !settingsOpen ? "" : "inspector-hidden"}`}
      >
        <aside className={`sidebar min-h-0 flex-col border-r border-line bg-soft ${sidebar ? "flex" : "hidden collapsed"}`}>
          <div className="brand flex h-11 min-h-11 shrink-0 items-center gap-3 border-b border-transparent px-4 py-1">
            <span className="brand-mark mr-auto" role="img" aria-label="Pi Agent">
              <PiLogo size={24} />
            </span>
            <IconButton
              icon={PanelLeftClose}
              label={t("收起侧边栏")}
              onClick={() => setSidebar(false)}
            />
          </div>
          <div className="sidebar-actions">
            <Button
              icon={Plus}
              fullWidth
              variant="outline"
              disabled={!snapshot || snapshot.running}
              pending={snapshot?.changing}
              onClick={() => {
                void run("session.new");
                setTab("chat");
              }}
            >
              {t("新建会话")}
            </Button>
          </div>
          <section className="workspace-navigation flex min-h-0 flex-1 flex-col" aria-label={t("工作区会话")}>
            <header className="workspace-section-header">
              {!searchOpen && <h2>{t("工作区")}</h2>}
              {searchOpen ? (
                <label className="session-search">
                  <Search size={14} />
                  <input
                    ref={searchRef}
                    aria-label={t("搜索会话")}
                    placeholder={t("搜索会话")}
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Escape") {
                        event.preventDefault();
                        event.stopPropagation();
                        setSearch("");
                        setSearchOpen(false);
                      }
                    }}
                  />
                  {search && (
                    <button
                      type="button"
                      aria-label={t("清除会话搜索")}
                      onClick={() => {
                        setSearch("");
                        searchRef.current?.focus();
                      }}
                    >
                      <X size={12} />
                    </button>
                  )}
                  <button
                    type="button"
                    aria-label={t("关闭会话搜索")}
                    onClick={() => {
                      setSearch("");
                      setSearchOpen(false);
                    }}
                  >
                    <X size={14} />
                  </button>
                </label>
              ) : (
                <Hint text={t("搜索会话 · Ctrl+K")}>
                  <button
                    type="button"
                    aria-label={t("搜索会话")}
                    onClick={() => setSearchOpen(true)}
                  >
                    <Search size={15} />
                  </button>
                </Hint>
              )}
              <Hint text={t("添加目录并打开新会话")}>
                <button
                  type="button"
                  className="workspace-add"
                  aria-label={t("添加工作区")}
                  onClick={() => {
                    if (!snapshot?.changing) void openWorkspace();
                  }}
                  disabled={snapshot?.running || choosingWorkspace || !connected}
                  aria-disabled={snapshot?.changing || undefined}
                >
                  <Plus size={16} />
                </button>
              </Hint>
            </header>
            <SessionRail
              sessions={sessionMatches}
              workspaces={workspaces}
              pins={pins}
              currentId={snapshot?.sessionFile ? snapshot.sessionId : undefined}
              cwd={snapshot?.cwd}
              currentName={snapshot?.sessionName}
              search={search}
              busy={snapshot?.running ?? false}
              unreadSessions={unreadSessions}
              pending={snapshot?.changing}
              newSession={(cwd) => {
                void startWorkspaceSession(cwd);
              }}
              select={(session) => {
                if (session)
                  void run<DesktopSnapshot>("session.switch", { path: session.path }).then((data) => {
                    if (data) localStorage.setItem("pi.workspace.userSelection", data.cwd);
                  });
                setTab("chat");
                if (innerWidth < 1024) setSidebar(false);
              }}
              pin={(id) =>
                setPins((previous) =>
                  previous.includes(id)
                    ? previous.filter((item) => item !== id)
                    : [...previous, id],
                )
              }
              remove={(session) => setLocalDialog({
                kind: "delete",
                id: session.id,
                path: session.path,
                value: session.name || (session.messageCount > 0 && session.firstMessage) || t("新会话"),
              })}
              removeWorkspace={(cwd) => setLocalDialog({ kind: "workspace-remove", path: cwd, value: baseName(cwd) })}
            />
          </section>
          <div className="sidebar-footer">
            <button
              className={`settings-link ${settingsOpen ? "selected" : ""}`}
              onClick={() => {
                setSettingsOpen(true);
                setMenu(false);
                if (innerWidth < 1024) setSidebar(false);
              }}
            >
              <Settings2 size={17} />
              <span>{t("设置")}</span>
            </button>
          </div>
        </aside>
        {sidebar && (
          <button
            className="panel-backdrop sidebar-backdrop"
            aria-label={t("关闭侧边栏遮罩")}
            onClick={() => setSidebar(false)}
          />
        )}
        <main className="main-area">
          <header className="workspace-header flex h-11 min-h-11 items-center justify-between gap-4 border-b border-line px-6">
            <div className="header-title flex min-w-0 items-center gap-2">
              {!sidebar && (
                <IconButton
                  icon={PanelLeftOpen}
                  label={t("打开侧边栏")}
                  onClick={() => setSidebar(true)}
                />
              )}
              <div className="group/session-title flex min-w-0 items-center gap-1">
                <Hint text={snapshot?.cwd ?? "Pi Desktop"}>
                  <h1 tabIndex={0}>
                    {snapshot?.sessionFile
                      ? snapshot.sessionName ?? t("新会话")
                      : t("开始对话")}
                  </h1>
                </Hint>
                {snapshot?.sessionFile && tab === "chat" && (
                  <IconButton
                    icon={PencilLine}
                    label={t("重命名会话")}
                    attributes={{
                      className: "pointer-events-none opacity-0 group-hover/session-title:pointer-events-auto group-hover/session-title:opacity-100 group-focus-within/session-title:pointer-events-auto group-focus-within/session-title:opacity-100 [&>svg]:size-3.5",
                    }}
                    onClick={() =>
                      setLocalDialog({
                        kind: "name",
                        value: snapshot.sessionName ?? "",
                      })
                    }
                  />
                )}
              </div>
            </div>
            <div className="header-tools">
              {snapshot && !settingsOpen && (
                <>
                  <IconButton
                    icon={Terminal}
                    label={t("终端")}
                    active={terminalOpen}
                    attributes={{
                      "aria-expanded": terminalOpen,
                      "aria-controls": "pi-terminal-panel",
                    }}
                    onClick={() => setTerminalOpen(!terminalOpen)}
                  />
                </>
              )}
              {snapshot?.running ? (
                <span className="status-tag running">
                  <span />
                  {snapshot.compacting
                    ? t("压缩中")
                    : snapshot.retrying
                      ? t("重试中")
                      : t("执行中")}
                </span>
              ) : !connected && !booting ? (
                <span className="status-tag disconnected" role="status">
                  {t("连接断开")}
                </span>
              ) : null}
              {snapshot && !inspector && !settingsOpen && (
                <IconButton
                  icon={PanelRightOpen}
                  label={t("打开检查器")}
                  onClick={() => setInspector(true)}
                />
              )}
              {!settingsOpen && (
                <div
                  className="session-menu"
                  ref={menuTrigger}
                  data-desktop-native-input
                  onKeyDownCapture={(event) => {
                    if (!menu && event.key === "ArrowDown") {
                      event.preventDefault();
                      setMenu(true);
                    }
                  }}
                >
                  <IconButton
                    icon={MoreHorizontal}
                    label={t("会话操作")}
                    attributes={{
                      "aria-expanded": menu,
                      "aria-haspopup": "dialog",
                    }}
                    onClick={() => setMenu(!menu)}
                  />
                  {menu && (
                    <>
                      <button
                        className="menu-scrim"
                        aria-label={t("关闭会话菜单")}
                        onClick={() => setMenu(false)}
                      />
                      <div
                        className="menu-list"
                        role="dialog"
                        aria-label={t("会话操作")}
                        onKeyDown={(event) =>
                          menuKeyboard(event, () => {
                            setMenu(false);
                            menuTrigger.current
                              ?.querySelector<HTMLButtonElement>("button")
                              ?.focus();
                          })
                        }
                      >
                        <div
                          className="transcript-view-menu"
                          role="group"
                          aria-label={t("对话视图")}
                        >
                          <span>{t("对话视图")}</span>
                          {(
                            [
                              ["normal", t("普通")],
                              ["thinking", t("思考")],
                              ["detailed", t("详细")],
                            ] as const
                          ).map(([mode, label]) => (
                            <button
                              key={mode}
                              aria-pressed={
                                (expanded
                                  ? "detailed"
                                  : showThinking
                                    ? "thinking"
                                    : "normal") === mode
                              }
                              onClick={() => {
                                setExpanded(mode === "detailed");
                                setShowThinking(mode !== "normal");
                                void (async () => {
                                  await run("display.tools", {
                                    expanded: mode === "detailed",
                                  });
                                  await run("display.thinking", {
                                    visible: mode !== "normal",
                                  });
                                })();
                                setMenu(false);
                              }}
                            >
                              {label}
                            </button>
                          ))}
                        </div>
                        <button
                          disabled={snapshot?.busy}
                          onClick={() => {
                            void run("session.clone");
                            setMenu(false);
                          }}
                        >
                          <CopyPlus size={15} />
                          {t("复制会话")}
                        </button>
                        <button
                          disabled={snapshot?.busy}
                          onClick={() => {
                            void importSession();
                          }}
                        >
                          <Upload size={15} />
                          {t("导入会话")}
                        </button>
                        <button
                          disabled={snapshot?.busy}
                          onClick={() => {
                            setLocalDialog({
                              kind: "export",
                              value: "",
                              format: "html",
                            });
                            setMenu(false);
                          }}
                        >
                          <Download size={15} />
                          {t("导出会话")}
                        </button>
                        <button
                          disabled={snapshot?.busy}
                          onClick={() => {
                            setLocalDialog({ kind: "compact", value: "" });
                            setMenu(false);
                          }}
                        >
                          <Minimize2 size={15} />
                          {t("压缩上下文")}
                        </button>
                        <button
                          onClick={() => {
                            setLocalDialog({ kind: "bash", value: "" });
                            setMenu(false);
                          }}
                        >
                          <Terminal size={15} />
                          {t("运行 Shell 命令…")}
                        </button>
                      </div>
                    </>
                  )}
                </div>
              )}
            </div>
          </header>
          {!snapshot ? (
            <div className="startup-state">
              <PiLogo size={32} />
              <h2>Pi Desktop</h2>
              <p className="startup-help" role={booting ? "status" : undefined}>
                {booting ? t("正在打开工作区…") : t("选择项目文件夹，开始新会话或继续之前的任务。")}
              </p>
              {booting ? (
                <LoaderCircle className="spin" size={20} aria-hidden="true" />
              ) : (
                <Button
                  icon={FolderOpen}
                  onClick={() => {
                    void openWorkspace();
                  }}
                >
                  {t("打开工作区")}
                </Button>
              )}
            </div>
          ) : (
            <>
              {
                <nav className="workspace-tabs" aria-label={t("会话视图")}>
                  {tabs.map((t) => (
                    <button
                      key={t.id}
                      className={tab === t.id ? "selected" : ""}
                      aria-current={tab === t.id ? "page" : undefined}
                      onClick={() => navigate(t.id)}
                    >
                      <t.icon size={15} />
                      {t.name}
                    </button>
                  ))}
                </nav>
              }
              <div className="workspace-content">
                <div className="view-content">
                  {tab === "chat" && (
                    <div
                      className={`chat-view ${emptyConversation ? "is-empty" : ""}`}
                    >
                      <TranscriptLayout
                        backendId={snapshot.backendId}
                        sessionId={snapshot.sessionId}
                        ready={workspaceReady}
                        outputPad={snapshot.settings.outputPad === 0 ? 0 : 1}
                        messagesVisible={
                          snapshot.messages.length > 0 || !!snapshot.streaming
                        }
                        run={run}
                      />
                      <DesktopSlotView
                        surfaces={snapshot.desktopSurfaces}
                        slot="header"
                        run={run}
                      />
                      {emptyConversation ? (
                        <div className="conversation-empty">
                          <div className="empty-brand">
                            <PiLogo size={28} />
                          </div>
                          <h2>{t("今天，想完成什么？")}</h2>
                          {!snapshot.model && (
                            <Button
                              icon={Settings2}
                              variant="ghost"
                              onClick={() => setSettingsOpen(true)}
                            >
                              {t("配置模型账号")}
                            </Button>
                          )}
                        </div>
                      ) : (
                        <>
                          <Messages
                            sessionId={snapshot.sessionId}
                            messages={snapshot.messages}
                            conversationNotices={snapshot.conversationNotices}
                            streaming={snapshot.streaming}
                            busy={snapshot.running}
                            showThinking={showThinking}
                            expanded={expanded}
                            activeTools={snapshot.activeTools}
                            extensionUI={snapshot.extensionUI}
                            surfaces={snapshot.desktopSurfaces}
                            run={run}
                            outputPad={
                              snapshot.settings.outputPad === 0 ? 0 : 1
                            }
                            showImages={snapshot.toolImages?.visible ?? true}
                            imageWidth={
                              (snapshot.toolImages?.widthCells ?? 60) * 8
                            }
                            onFork={forkMessage}
                          />
                        </>
                      )}
                      {(snapshot.queue.steering.length > 0 ||
                        snapshot.queue.followUp.length > 0) && (
                        <section
                          className="queue-strip message-queue"
                          aria-label={t("待处理消息")}
                        >
                          <header className="queue-header">
                            <div className="queue-heading">
                              <Clock3 size={15} aria-hidden="true" />
                              <strong>{t("待处理消息")}</strong>
                              <span className="queue-count">
                                {snapshot.queue.steering.length + snapshot.queue.followUp.length}
                              </span>
                            </div>
                            <Button
                              icon={PencilLine}
                              variant="outline"
                              size="small"
                              className="queue-restore hover:border-muted hover:bg-card"
                              onClick={() => {
                                void run("queue.restore");
                              }}
                            >
                              {snapshot.queue.steering.length + snapshot.queue.followUp.length > 1
                                ? t("全部取回编辑")
                                : t("取回编辑")}
                            </Button>
                          </header>
                          <div className="queue-items">
                            {([
                              ["steer", snapshot.queue.steering],
                              ["followUp", snapshot.queue.followUp],
                            ] as const).flatMap(([mode, messages]) =>
                              messages.map((message, i) => (
                                <div className="queue-item" key={`${mode}-${i}`}>
                                  <span
                                    className={`queue-kind ${mode}`}
                                    title={mode === "steer"
                                      ? t("当前工具结束后交付")
                                      : t("本轮任务结束后交付")}
                                  >
                                    <span aria-hidden="true" className="queue-kind-dot" />
                                    {mode === "steer" ? t("调整方向") : t("任务结束后")}
                                  </span>
                                  <p className="queue-message">{message}</p>
                                </div>
                              )),
                            )}
                          </div>
                        </section>
                      )}
                      <NativeWidgets
                        snapshot={snapshot}
                        placement="aboveEditor"
                        run={run}
                      />
                      <div className="composer-region">
                        {emptyConversation && (
                          <WorkspacePicker
                            cwd={snapshot.cwd}
                            workspaces={snapshot.recentWorkspaces}
                            disabled={snapshot.running || choosingWorkspace}
                            pending={snapshot.changing}
                            choose={(cwd) => {
                              void startWorkspaceSession(cwd);
                            }}
                            add={() => {
                              void openWorkspace();
                            }}
                          />
                        )}
                        <Autocomplete
                          text={text}
                          editor={composerRef}
                          onComplete={setText}
                          enabled={
                            !snapshot.desktopSurfaces.some(
                              (surface) => surface.slot === "editor",
                            )
                          }
                        />
                        <div
                          className="composer rounded-2xl border border-line bg-canvas shadow-sm"
                          onPaste={(event) => {
                            if (event.clipboardData.files.length) {
                              event.preventDefault();
                              void chooseImages(event.clipboardData.files);
                            }
                          }}
                        >
                          <div className="attachment-list">
                            {attachments.map((path) => (
                              <span key={path}>
                                <Files size={13} />
                                {baseName(path)}
                                <button
                                  aria-label={t("移除 {value1}", { value1: path })}
                                  onClick={() =>
                                    setAttachments((p) =>
                                      p.filter((f) => f !== path),
                                    )
                                  }
                                >
                                  <X size={12} />
                                </button>
                              </span>
                            ))}
                            {images.map((image, index) => (
                              <span key={`${index}-${image.name}`}>
                                <ImagePreview
                                  src={`data:${image.mimeType};base64,${image.data}`}
                                  alt={image.name}
                                />
                                <button
                                  aria-label={t("移除 {value1}", { value1: image.name })}
                                  onClick={() =>
                                    setImages((p) =>
                                      p.filter((_, i) => i !== index),
                                    )
                                  }
                                >
                                  <X size={12} />
                                </button>
                              </span>
                            ))}
                          </div>
                          {snapshot.desktopSurfaces.some(
                            (surface) => surface.slot === "editor",
                          ) ? (
                            <DesktopSlotView
                              surfaces={snapshot.desktopSurfaces}
                              slot="editor"
                              run={run}
                            />
                          ) : (
                            <textarea
                              ref={composerRef}
                              aria-label={t("消息")}
                              data-message-composer
                              placeholder={
                                snapshot.running ? t("追加消息…") : t("描述你的任务…")
                              }
                              value={text}
                              onChange={(e) => setText(e.target.value)}
                              onKeyDown={(e) => {
                                if (
                                  e.key === "Enter" &&
                                  !e.shiftKey &&
                                  e.nativeEvent.keyCode !== 229 &&
                                  !e.nativeEvent.isComposing
                                ) {
                                  e.preventDefault();
                                  void send();
                                }
                              }}
                            />
                          )}
                          <div className="composer-toolbar grid items-center gap-2 px-3 pb-3">
                            <div className="composer-options">
                              <ContextMenu
                                snapshot={snapshot}
                                images={() => uploadRef.current?.click()}
                                files={() => navigate("files")}
                                useCommand={(command) => {
                                  applyComposerText(command);
                                  composerRef.current?.focus();
                                  if (
                                    snapshot.desktopSurfaces.some(
                                      (surface) => surface.slot === "editor",
                                    )
                                  )
                                    void run("desktop.focus", { id: "editor" });
                                }}
                              />
                              <input
                                hidden
                                ref={uploadRef}
                                type="file"
                                accept="image/png,image/jpeg,image/webp,image/gif"
                                multiple
                                onChange={(e) => {
                                  void chooseImages(e.target.files);
                                  e.target.value = "";
                                }}
                              />
                            </div>
                            <div className="send-controls">
                              <div className="composer-models flex min-w-0 items-center gap-1">
                                <SelectField
                                  name={t("模型")}
                                  appearance="embedded"
                                  value={
                                    snapshot.model
                                      ? `${snapshot.model.provider}/${snapshot.model.id}`
                                      : ""
                                  }
                                  disabled={snapshot.running}
                                  pending={snapshot.changing}
                                  onChange={(value) => {
                                    const model = snapshot.models.find(
                                      (m) => `${m.provider}/${m.id}` === value,
                                    );
                                    if (model)
                                      void run("model.set", {
                                        provider: model.provider,
                                        id: model.id,
                                      });
                                  }}
                                >
                                  <option value="" disabled>
                                    {t("选择模型")}
                                  </option>
                                  {snapshot.models
                                    .filter(
                                      (m) =>
                                        m.available ||
                                        (m.id === snapshot.model?.id &&
                                          m.provider ===
                                            snapshot.model.provider),
                                    )
                                    .map((model) => (
                                      <option
                                        key={`${model.provider}/${model.id}`}
                                        value={`${model.provider}/${model.id}`}
                                      >
                                        {model.name} · {model.provider}
                                      </option>
                                    ))}
                                </SelectField>
                                <SelectField
                                  name={t("思考等级")}
                                  appearance="embedded"
                                  value={snapshot.thinking}
                                  disabled={snapshot.running}
                                  pending={snapshot.changing}
                                  onChange={(level) => {
                                    void run("thinking.set", { level });
                                  }}
                                >
                                  {snapshot.thinkingLevels.map((level) => (
                                    <option key={level} value={level}>
                                      {level}
                                    </option>
                                  ))}
                                </SelectField>
                              </div>
                              <Tooltip
                                text={stopButton
                                  ? t("停止任务")
                                  : t("Enter 发送 · Shift + Enter 换行 · / 命令 · @ 文件")}
                              >
                                {(attributes) => (
                                  <Button
                                    icon={stopButton ? Square : ArrowUp}
                                    className="size-9 min-h-9 min-w-9 shrink-0 rounded-full p-0"
                                    color="primary"
                                    disabled={(!stopButton && !canSend) || !connected}
                                    pending={snapshot.changing}
                                    loading={!stopButton && submitting}
                                    onClick={() => {
                                      if (stopButton) void run("abort");
                                      else void send();
                                    }}
                                    attributes={{
                                      ...attributes,
                                      "aria-label": stopButton
                                        ? t("停止任务")
                                        : t("发送消息"),
                                      "data-composer-action": stopButton ? "stop" : "send",
                                    }}
                                  />
                                )}
                              </Tooltip>
                            </div>
                          </div>
                        </div>
                        <div className="composer-usage mt-2 flex min-h-6 flex-wrap items-center gap-x-3 gap-y-1 px-1 text-[11px] text-muted">
                          <ContextUsage
                            snapshot={snapshot}
                            inspect={() => setInspector(true)}
                          />
                          {snapshot.streaming && (
                            <GenerationStatus
                              message={snapshot.streaming}
                              compact
                            />
                          )}
                          <SessionTokenUsage tokens={snapshot.stats.tokens} />
                        </div>
                        <div className="composer-footnote">
                          <span>
                            {snapshot.statuses.working ? (
                              <StyledText
                                {...(snapshot.extensionUI.textPresentation
                                  ?.statuses.working ?? {
                                  text: snapshot.statuses.working,
                                })}
                              />
                            ) : !snapshot.model ? (
                              t("未配置模型")
                            ) : null}
                          </span>
                        </div>
                      </div>
                      <NativeWidgets
                        snapshot={snapshot}
                        placement="belowEditor"
                        run={run}
                      />
                      <DesktopSlotView
                        surfaces={snapshot.desktopSurfaces}
                        slot="footer"
                        run={run}
                      />
                    </div>
                  )}
                  {tab === "files" && (
                    <FilesView
                      key={snapshot.cwd}
                      snapshot={snapshot}
                      run={run}
                      attach={attach}
                      target={fileTarget}
                      close={() => navigate("chat")}
                    />
                  )}
                  {tab === "tree" && (
                    <TreeView
                      snapshot={snapshot}
                      run={run}
                      editLabel={(node) =>
                        setLocalDialog({
                          kind: "label",
                          id: node.id,
                          value: node.label ?? "",
                        })
                      }
                    />
                  )}
                </div>
              </div>
            </>
          )}
          <div
            className="workspace-terminal-dock"
            data-workspace-terminal-dock
          />
        </main>
        <TerminalPanel open={terminalOpen} onOpenChange={setTerminalOpen} cwd={snapshot?.cwd} />
        {snapshot && inspector && !settingsOpen && (
          <>
            <button
              className="panel-backdrop inspector-backdrop"
              aria-label={t("关闭检查器遮罩")}
              onClick={() => setInspector(false)}
            />
            <aside className="inspector">
              <header className="flex h-11 min-h-11 shrink-0 items-center justify-between border-b border-line px-4 py-1">
                <strong>{t("会话检查器")}</strong>
                <IconButton
                  icon={PanelRightClose}
                  label={t("关闭检查器")}
                  onClick={() => setInspector(false)}
                />
              </header>
              <section>
                <h2>{t("上下文")}</h2>
                <div className="context-number">
                  <strong>
                    {snapshot.stats.contextUsage?.percent == null
                      ? "—"
                      : `${Math.round(snapshot.stats.contextUsage.percent)}%`}
                  </strong>
                  <span>
                    {number(snapshot.stats.contextUsage?.tokens ?? undefined)} /{" "}
                    {number(snapshot.model?.contextWindow)}
                  </span>
                </div>
                <div className="context-meter">
                  <span
                    style={{
                      width: `${Math.min(100, snapshot.stats.contextUsage?.percent ?? 0)}%`,
                    }}
                  />
                </div>
                <div className="metrics">
                  <div>
                    <span>{t("消息")}</span>
                    <strong>{snapshot.messages.length}</strong>
                  </div>
                  <div>
                    <span>{t("工具调用")}</span>
                    <strong>{snapshot.stats.toolCalls}</strong>
                  </div>
                  <div>
                    <span>{t("累计用量")}</span>
                    <strong>{number(snapshot.stats.tokens.total)}</strong>
                  </div>
                  <div>
                    <span>{t("费用")}</span>
                    <strong>{money(snapshot.stats.cost)}</strong>
                  </div>
                </div>
                <Button
                  icon={Minimize2}
                  variant="outline"
                  fullWidth
                  size="small"
                  disabled={snapshot.busy || snapshot.messages.length === 0}
                  onClick={() => setLocalDialog({ kind: "compact", value: "" })}
                >
                  {t("压缩上下文")}
                </Button>
              </section>
              <section>
                <div className="inspector-heading">
                  <h2>{t("工具")}</h2>
                  <span>
                    {snapshot.tools.filter((t) => t.active).length} /{" "}
                    {snapshot.tools.length}
                  </span>
                </div>
                <div className="tool-list">
                  {snapshot.tools.map((tool) => (
                    <details key={tool.name}>
                      <summary>
                        <Wrench size={14} />
                        <span>{tool.name}</span>
                        <Switch
                          size="small"
                          name={`tool-${tool.name}`}
                          checked={tool.active}
                          disabled={snapshot.busy || tool.exposure === "hidden"}
                          onChange={({ checked }) => {
                            void run("tools.set", {
                              names: checked
                                ? [
                                    ...snapshot.tools
                                      .filter((t) => t.active)
                                      .map((t) => t.name),
                                    tool.name,
                                  ]
                                : snapshot.tools
                                    .filter(
                                      (t) => t.active && t.name !== tool.name,
                                    )
                                    .map((t) => t.name),
                            });
                          }}
                        />
                      </summary>
                      <p>{tool.description}</p>
                      <pre>{JSON.stringify(tool.parameters, null, 2)}</pre>
                    </details>
                  ))}
                </div>
              </section>
              <section>
                <h2>{t("显示")}</h2>
                <div className="setting-row">
                  <span>{t("展开工具输出")}</span>
                  <Switch
                    size="small"
                    name="expand-tools"
                    checked={expanded}
                    onChange={({ checked }) => {
                      setExpanded(checked);
                      void run("display.tools", { expanded: checked });
                    }}
                  />
                </div>
                <div className="setting-row">
                  <span>{t("展开思考")}</span>
                  <Switch
                    size="small"
                    name="expand-thinking"
                    checked={showThinking}
                    onChange={({ checked }) => setShowThinking(checked)}
                  />
                </div>
              </section>
              {Object.keys(snapshot.statuses).length > 0 && (
                <section>
                  <h2>{t("扩展状态")}</h2>
                  {Object.entries(snapshot.statuses).map(([key, value]) => (
                    <div
                      className="extension-status"
                      key={key}
                      data-extension-status={key}
                    >
                      <p>
                        <StyledText
                          {...(snapshot.extensionUI.textPresentation
                            ?.statuses[key] ?? { text: value })}
                        />
                      </p>
                    </div>
                  ))}
                </section>
              )}
              <footer className="inspector-footer">
                <Hint text={snapshot.sessionFile || snapshot.sessionId}>
                  <span className="inspector-save-status" tabIndex={0}>
                    {snapshot.sessionFile ? <CircleCheck size={14} aria-hidden="true" /> : <Clock3 size={14} aria-hidden="true" />}
                    {snapshot.sessionFile ? t("已保存到本机") : t("新会话")}
                  </span>
                </Hint>
                <IconButton
                  icon={Copy}
                  label={t("复制会话 ID")}
                  onClick={() => {
                    void navigator.clipboard.writeText(snapshot.sessionId);
                  }}
                />
              </footer>
            </aside>
          </>
        )}
        {(snapshot || globalSettings) && (
          <SettingsView
            snapshot={(snapshot ?? globalSettings)!}
            resourceSnapshot={snapshot}
            useCommand={(command) => {
              applyComposerText(command);
              setTab("chat");
              setSettingsOpen(false);
              requestAnimationFrame(() => {
                document.querySelector<HTMLTextAreaElement>('.composer textarea')?.focus();
                if (snapshot?.desktopSurfaces.some(surface => surface.slot === "editor"))
                  void run("desktop.focus", { id: "editor" });
              });
            }}
            run={runSettings}
            open={settingsOpen}
            updateRequest={updateRequest}
            onClose={() => setSettingsOpen(false)}
            messageMode={queueMode}
            onMessageMode={setQueueMode}
            showThinking={showThinking}
            onShowThinking={(visible) => {
              setShowThinking(visible);
              void runSettings("display.thinking", { visible });
            }}
            colorMode={
              snapshot?.extensionUI.theme?.followsSystem ? "system" : colorMode
            }
            onColorMode={(theme) => {
              if (!snapshot) setColorMode(theme);
              void runSettings("theme.set", { theme });
            }}
          />
        )}
        <Modal
          key={`local:${localDialog?.kind ?? "closed"}`}
          active={!!localDialog && !currentDialog}
          attributes={{ "data-desktop-native-input": "" }}
          onClose={() => {
            if (!submitting) setLocalDialog(undefined);
          }}
          size="480px"
        >
          <Modal.Title>
            {localDialog ? labels[localDialog.kind] : ""}
          </Modal.Title>
          {localDialog && (
            <div className="modal-body flex min-w-0 flex-col gap-4">
              {localDialog.kind === "delete" && (
                <p className="dialog-help break-words text-[13px] leading-relaxed text-muted">
                  {t("确定删除「{value1}」吗？会话及其消息将被永久删除。", { value1: localDialog.value })}
                </p>
              )}
              {localDialog.kind === "workspace-remove" && (
                <div className="dialog-help break-words text-[13px] leading-relaxed text-muted">
                  <p>{t("确定移除工作区「{value1}」吗？本地文件和历史会话会保留，重新添加后仍可继续使用。", { value1: localDialog.value })}</p>
                  <p className="mt-2 break-all text-xs">{localDialog.path}</p>
                </div>
              )}
              {localDialog.kind === "bash" && (
                <p className="dialog-help text-[13px] leading-relaxed text-muted">
                  {t("在当前 workspace 中运行一次 Shell 命令。命令和输出会记录到对话，供后续模型读取。")}
                </p>
              )}
              {localDialog.kind === "export" && (
                <p className="dialog-help text-[13px] leading-relaxed text-muted">{t("HTML 用于阅读和分享，JSONL 可重新导入。导出时选择保存位置。")}</p>
              )}
              {localDialog.kind === "import" && (
                <p className="dialog-help text-[13px] leading-relaxed text-muted">{t("填写 Pi 会话 JSONL 文件的路径。导入后会打开该会话。")}</p>
              )}
              {localDialog.kind === "compact" && (
                <p className="dialog-help text-[13px] leading-relaxed text-muted">{t("将较早的对话整理为摘要，为后续任务释放上下文空间。")}</p>
              )}
              {localDialog.kind === "export" && (
                <SelectField
                  label={t("格式")}
                  name="export-format"
                  value={localDialog.format ?? "html"}
                  onChange={(format) =>
                    setLocalDialog({ ...localDialog, format })
                  }
                >
                  <option value="html">HTML</option>
                  <option value="jsonl">JSONL</option>
                </SelectField>
              )}
              {!["delete", "workspace-remove"].includes(localDialog.kind) && <Field
                label={
                  localDialog.kind === "compact"
                    ? t("摘要重点（可选）")
                    : localDialog.kind === "export"
                      ? t("输出路径（可选）")
                      : localDialog.kind === "import"
                        ? t("路径")
                        : localDialog.kind === "bash"
                          ? t("命令")
                          : t("名称")
                }
                name="dialog-value"
                autoFocus
                value={localDialog.value}
                placeholder={
                  localDialog.kind === "bash" ? t("例如：git status") : undefined
                }
                onChange={(value) =>
                  setLocalDialog({ ...localDialog, value, error: undefined })
                }
              />}
              {localDialog.error && (
                <p className="error-inline" role="alert">
                  {localizeText(localDialog.error)}
                </p>
              )}
              <div className="modal-actions">
                <Button
                  variant="ghost"
                  disabled={submitting}
                  onClick={() => setLocalDialog(undefined)}
                >
                  {t("取消")}
                </Button>
                <Button
                  color={["delete", "workspace-remove"].includes(localDialog.kind) ? "critical" : "primary"}
                  loading={submitting}
                  disabled={["import", "bash"].includes(localDialog.kind) && !localDialog.value.trim()}
                  onClick={() => {
                    void confirmLocal();
                  }}
                >
                  {localDialog.kind === "delete" ? t("删除会话")
                    : localDialog.kind === "workspace-remove" ? t("移除工作区")
                    : localDialog.kind === "bash" ? t("运行命令")
                    : localDialog.kind === "import" ? t("导入会话")
                    : localDialog.kind === "export" ? t("导出会话")
                    : localDialog.kind === "compact" ? t("开始压缩")
                    : localDialog.kind === "label" ? t("保存标签")
                    : t("保存名称")}
                </Button>
              </div>
            </div>
          )}
        </Modal>
        {folderPickerOpen && !currentDialog && (
          <FolderPicker
            cwd={snapshot?.cwd}
            close={() => setFolderPickerOpen(false)}
            choose={async (path, onError) =>
              (await addWorkspace(path, onError)) !== undefined
            }
          />
        )}
        <Modal
          key={`sdk:${currentDialog?.id ?? "closed"}`}
          active={!!currentDialog}
          disableCloseOnOutsideClick
          onClose={() => {
            if (currentDialog)
              void run("dialog.answer", { id: currentDialog.id });
          }}
          size="480px"
        >
          <Modal.Title>
            <StyledText
              {...(currentDialog?.presentation?.title ?? {
                text: currentDialog?.title ?? "",
              })}
              desktopCopy={currentDialog?.desktopTitle}
            />
            <DialogCountdown expiresAt={currentDialog?.expiresAt} />
          </Modal.Title>
          {currentDialog && (
            <div
              className="modal-body flex min-w-0 flex-col gap-4"
              ref={focusSdkDialog}
              data-dialog-id={currentDialog.id}
            >
              {currentDialog.message && (
                <p className="dialog-message">
                  <StyledText
                    {...(currentDialog.presentation?.message ?? {
                      text: currentDialog.message,
                    })}
                  />
                </p>
              )}
              {currentDialog.kind === "input" &&
                currentDialog.presentation?.placeholder?.runs && (
                  <p className="dialog-message">
                    <StyledText {...currentDialog.presentation.placeholder} />
                  </p>
                )}
              {currentDialog.kind === "select" ? (
                <DialogOptions
                  dialog={currentDialog}
                  onAnswer={(value) => {
                    void run("dialog.answer", { id: currentDialog.id, value });
                  }}
                />
              ) : currentDialog.kind === "editor" ? (
                <textarea
                  className="dialog-editor"
                  value={answer}
                  aria-label={
                    currentDialog.desktopTitle ? localizeText(currentDialog.title) :
                    currentDialog.presentation?.title.text ?? currentDialog.title
                  }
                  onChange={(e) => setAnswer(e.target.value)}
                />
              ) : currentDialog.kind === "input" ? (
                <Field
                  name="extension-input"
                  label={
                    currentDialog.desktopTitle ? localizeText(currentDialog.title) :
                    currentDialog.presentation?.title.text ?? currentDialog.title
                  }
                  value={answer}
                  onChange={setAnswer}
                  secret={currentDialog.secret}
                  placeholder={
                    currentDialog.presentation?.placeholder?.text ??
                    currentDialog.placeholder
                  }
                />
              ) : null}
              <div className="modal-actions">
                <Button
                  variant="ghost"
                  attributes={
                    currentDialog.kind === "confirm"
                      ? { "data-dialog-option": "1" }
                      : undefined
                  }
                  onClick={() => {
                    void run("dialog.answer", {
                      id: currentDialog.id,
                      value:
                        currentDialog.kind === "confirm" ? false : undefined,
                    });
                  }}
                >
                  {t("取消")}
                </Button>
                {currentDialog.kind !== "select" && (
                  <Button
                    color="primary"
                    attributes={
                      currentDialog.kind === "confirm"
                        ? { "data-dialog-option": "0" }
                        : undefined
                    }
                    onClick={() => {
                      if (currentDialog.kind === "confirm") {
                        void run("dialog.answer", {
                          id: currentDialog.id,
                          value: true,
                        });
                        return;
                      }
                      const node = sdkDialogNode.current;
                      const id = currentDialog.id;
                      const sessionId = snapshot?.sessionId;
                      void enqueueExtensionEvent(async () => {
                        if (
                          !node?.isConnected ||
                          node.dataset.dialogId !== id ||
                          currentSnapshot.current?.sessionId !== sessionId
                        )
                          return;
                        const control = node.querySelector<
                          HTMLInputElement | HTMLTextAreaElement
                        >("input,textarea");
                        if (control)
                          await run("dialog.answer", {
                            id,
                            value: control.value,
                          });
                      });
                    }}
                  >
                    {t("确认")}
                  </Button>
                )}
              </div>
            </div>
          )}
        </Modal>
        {snapshot && (
          <DesktopExtensionDialog
            surfaces={snapshot.desktopSurfaces}
            run={run}
            ready={workspaceReady}
          />
        )}
        {authLink && (
          <div className="auth-banner">
            <div>
              <strong>{t("账号授权")}</strong>
              {authLink.message && <span>{authLink.desktopCopy ? localizeText(authLink.message) : authLink.message}</span>}
            </div>
            <Button
              icon={ExternalLink}
              size="small"
              onClick={() => {
                void external(authLink.url);
              }}
            >
              {t("打开授权页面")}
            </Button>
            <IconButton
              icon={X}
              label={t("取消登录")}
              onClick={() => {
                void run(
                  "auth.cancel",
                  authLink.id ? { id: authLink.id } : undefined,
                );
                setAuthLink(undefined);
              }}
            />
          </div>
        )}
      </div>
      {!settingsOpen && <UpdateNotice onOpen={() => { setUpdateRequest(value => value + 1); setSettingsOpen(true); }} />}
      {feedback && createPortal(feedback, document.body)}
    </FileWorkspace.Provider>
    </FileNavigation.Provider>
  );
}
