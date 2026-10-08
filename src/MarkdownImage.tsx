import { useContext, useEffect, useState } from "react";
import type { FilePreview } from "../shared/types";
import { action } from "./client";
import { DesktopLink } from "./DesktopLink";
import { desktopFileTarget, FileWorkspace } from "./FileNavigation";
import { ImagePreview } from "./ImagePreview";

/** Relative Markdown images use the same bounded workspace reader as file previews. */
export function MarkdownImage({ src, alt }: { src: string; alt: string }) {
  const workspace = useContext(FileWorkspace);
  const direct =
    /^(https?:\/\/|data:image\/(?:png|jpeg|gif|webp);base64,)/i.test(src);
  const path = !direct ? desktopFileTarget(src)?.path : undefined;
  const [loaded, setLoaded] = useState<{
    src: string;
    workspace: string;
    image: string;
  }>();
  useEffect(() => {
    if (!path || !workspace) return;
    let active = true;
    void action<FilePreview>("files.read", { path })
      .then((preview) => {
        if (active && preview.image)
          setLoaded({ src, workspace, image: preview.image });
      })
      .catch(() => {
        /* Keep the source as a usable file link when it cannot be previewed. */
      });
    return () => {
      active = false;
    };
  }, [src, path, workspace]);
  const image = direct
    ? src
    : loaded?.src === src && loaded.workspace === workspace
      ? loaded.image
      : undefined;
  return image ? (
    <ImagePreview src={image} alt={alt} className="markdown-image" />
  ) : path ? (
    <DesktopLink href={src}>{alt || src}</DesktopLink>
  ) : (
    <span>{alt}</span>
  );
}
