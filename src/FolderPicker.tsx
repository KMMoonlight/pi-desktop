import { t, useLocale, localizeText } from "./i18n";
import { useEffect, useRef, useState } from "react";
import { Button, Modal } from "reshaped";
import {
  ArrowUp,
  Check,
  ChevronRight,
  Folder,
  FolderPlus,
  Home,
  RefreshCw,
  X,
} from "lucide-react";
import { action } from "./client";
import { baseName, IconButton } from "./ui";
import type { DirectoryEntry, DirectoryListing } from "../shared/types";
import { menuKeyboard } from "./menuKeyboard";
import "./folder-picker.css";

export function FolderPicker({
  cwd,
  close,
  choose,
}: {
  cwd?: string;
  close: () => void;
  choose: (
    path: string,
    onError: (message: string) => void,
  ) => Promise<boolean>;
}) {
  useLocale();
  const [listing, setListing] = useState<DirectoryListing>();
  const [path, setPath] = useState(cwd ?? "");
  const [showDot, setShowDot] = useState(false);
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [newFolder, setNewFolder] = useState<string>();
  const request = useRef(0);
  const pathInput = useRef<HTMLInputElement>(null);
  const currentPath = useRef(cwd ?? "");
  const browse = async (next: string, visibility = showDot) => {
    const id = ++request.current;
    setLoading(true);
    setError("");
    try {
      const data = await action<DirectoryListing>("folders.list", {
        path: next,
        showDot: visibility,
      });
      if (id !== request.current) return;
      setListing(data);
      setPath(data.path);
      currentPath.current = data.path;
    } catch (error) {
      if (id === request.current)
        setError(error instanceof Error ? error.message : String(error));
    } finally {
      if (id === request.current) setLoading(false);
    }
  };
  useEffect(() => {
    void browse(currentPath.current, showDot);
    return () => {
      request.current++;
    };
  }, [showDot]);
  const select = async () => {
    if (!listing || loading || pending || path !== listing.path) return;
    setPending(true);
    setError("");
    try {
      if (await choose(listing.path, setError)) close();
    } finally {
      setPending(false);
    }
  };
  const create = async () => {
    if (!listing || !newFolder?.trim() || pending) return;
    setPending(true);
    setError("");
    try {
      const next = await action<string>("folders.create", {
        path: listing.path,
        name: newFolder,
      });
      setNewFolder(undefined);
      await browse(next);
    } catch (error) {
      setError(error instanceof Error ? error.message : String(error));
    } finally {
      setPending(false);
    }
  };
  const column = (
    entries: DirectoryEntry[],
    label: string,
    siblings = false,
  ) => (
    <div className={`directory-column ${siblings ? "directory-siblings" : ""}`}>
      <div className="directory-column-title">{label}</div>
      <div
        role="list"
        aria-label={siblings ? t("同级文件夹") : t("文件夹")}
        onKeyDown={menuKeyboard}
      >
        {entries.map((entry) => (
          <div key={entry.path} role="listitem">
            <button
              type="button"
              disabled={pending || loading}
              title={entry.path}
              aria-current={entry.path === listing?.path ? "true" : undefined}
              onClick={() => {
                void browse(entry.path);
              }}
            >
              <Folder size={16} />
              <span>{entry.name}</span>
              {entry.path === listing?.path ? (
                <Check size={14} />
              ) : (
                <ChevronRight size={14} />
              )}
            </button>
          </div>
        ))}
        {!entries.length && !loading && (
          <p className="directory-empty">{t("没有子文件夹")}</p>
        )}
      </div>
    </div>
  );
  return (
    <Modal
      active
      onClose={() => {
        if (!pending) close();
      }}
      size="680px"
      attributes={{
        "data-desktop-native-input": "",
        className: "folder-picker-modal",
      }}
    >
      <Modal.Title>{t("添加工作区")}</Modal.Title>
      <div className="folder-browser">
        <div className="directory-toolbar">
          <IconButton
            icon={ArrowUp}
            label={t("上一级文件夹")}
            disabled={!listing?.parent || pending || loading}
            onClick={() => {
              if (listing?.parent) void browse(listing.parent);
            }}
          />
          <IconButton
            icon={Home}
            label={t("主文件夹")}
            disabled={!listing || pending || loading}
            onClick={() => {
              if (listing) void browse(listing.home);
            }}
          />
          <form
            className="directory-path"
            onSubmit={(event) => {
              event.preventDefault();
              void browse(path);
            }}
          >
            <input
              ref={pathInput}
              autoFocus
              aria-label={t("文件夹路径")}
              value={path}
              disabled={pending}
              onChange={(event) => {
                setPath(event.target.value);
                setError("");
              }}
            />
            <button
              type="submit"
              aria-label={t("转到文件夹")}
              disabled={pending || loading}
            >
              <ChevronRight size={16} />
            </button>
          </form>
          <IconButton
            icon={RefreshCw}
            label={t("刷新文件夹")}
            disabled={pending || loading}
            onClick={() => {
              void browse(currentPath.current);
            }}
          />
        </div>
        <nav className="directory-breadcrumbs" aria-label={t("文件夹层级")}>
          {listing?.ancestors.map((entry) => (
            <button
              type="button"
              key={entry.path}
              title={entry.path}
              disabled={pending || loading}
              onClick={() => {
                void browse(entry.path);
              }}
            >
              {entry.name}
              <ChevronRight size={12} />
            </button>
          ))}
        </nav>
        <div className="directory-location-bar" aria-label={t("磁盘位置")}>
          {listing?.roots.map((entry) => (
            <button
              type="button"
              key={entry.path}
              disabled={pending || loading}
              onClick={() => {
                void browse(entry.path);
              }}
            >
              {entry.name}
            </button>
          ))}
          <label>
            <input
              type="checkbox"
              checked={showDot}
              disabled={pending}
              onChange={(event) => setShowDot(event.target.checked)}
            />
            {t("显示点目录")}
          </label>
        </div>
        <div className="directory-columns" aria-busy={loading}>
          {listing?.parent &&
            column(listing.siblings, baseName(listing.parent), true)}
          {column(
            listing?.directories ?? [],
            listing ? baseName(listing.path) : t("文件夹"),
          )}
          {loading && (
            <div className="directory-loading" role="status">
              {t("正在读取文件夹…")}
            </div>
          )}
        </div>
        {newFolder !== undefined && (
          <form
            className="directory-new-folder"
            onSubmit={(event) => {
              event.preventDefault();
              void create();
            }}
          >
            <input
              autoFocus
              aria-label={t("新文件夹名称")}
              value={newFolder}
              disabled={pending}
              onChange={(event) => {
                setNewFolder(event.target.value);
                setError("");
              }}
              placeholder={t("文件夹名称")}
            />
            <Button
              size="small"
              disabled={pending || !newFolder.trim()}
              onClick={() => {
                void create();
              }}
            >
              {t("创建")}
            </Button>
            <IconButton
              icon={X}
              label={t("取消新建文件夹")}
              disabled={pending}
              onClick={() => {
                setNewFolder(undefined);
                setError("");
              }}
            />
          </form>
        )}
        {error && (
          <p className="error-inline" role="alert">
            {localizeText(error)}
          </p>
        )}
        <div className="directory-footer">
          <IconButton
            icon={FolderPlus}
            label={t("新建文件夹")}
            disabled={pending || loading || !listing}
            onClick={() => setNewFolder("")}
          />
          <span title={listing?.path}>{listing && baseName(listing.path)}</span>
          <Button variant="ghost" disabled={pending} onClick={close}>
            {t("取消")}
          </Button>
          <Button
            color="primary"
            disabled={
              !listing ||
              loading ||
              pending ||
              path !== listing.path ||
              newFolder !== undefined
            }
            loading={pending}
            onClick={() => {
              void select();
            }}
          >
            {t("打开")}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
