/** URL kinds handled by the desktop's default external application opener. */
export function desktopExternalLink(value: string): string | undefined {
  if (!value || /[\x00-\x20\x7f]/.test(value) || /^[a-z]:[\\/]/i.test(value))
    return undefined;
  try {
    const url = new URL(value);
    if (
      ["javascript:", "vbscript:", "data:", "blob:", "about:"].includes(
        url.protocol,
      )
    )
      return undefined;
    if (
      url.href.length === url.protocol.length ||
      ((url.protocol === "mailto:" || url.protocol === "tel:") && !url.pathname)
    )
      return undefined;
    return url.href;
  } catch {
    return undefined;
  }
}

export function isCustomExternalProtocol(url: string): boolean {
  return !["http:", "https:", "mailto:", "tel:", "file:"].includes(
    new URL(url).protocol,
  );
}

/** Local Markdown/OSC references consumed by the workspace preview, never the external opener. */
export function desktopFileReference(
  href: string,
): { path: string; line?: number } | undefined {
  if (!href || href.startsWith("#") || /[\x00-\x1f\x7f]/.test(href)) return;
  let path = href;
  const fragment = /#L?(\d+)(?:[-:]L?\d+)?$/i.exec(path);
  let line = fragment ? Number(fragment[1]) : undefined;
  if (fragment) path = path.slice(0, fragment.index);
  if (path.startsWith("file:")) {
    try {
      const url = new URL(path);
      path = decodeURIComponent(url.pathname);
      if (/^\/[a-z]:\//i.test(path)) path = path.slice(1);
      if (url.hostname && url.hostname !== "localhost")
        path = `//${url.hostname}${path}`;
    } catch {
      return;
    }
  } else {
    if (!/^[a-z]:[\\/]/i.test(path) && /^[a-z][a-z\d+.-]*:/i.test(path)) return;
    const suffix = /:(\d+)(?::\d+)?$/.exec(path);
    if (suffix) {
      line ??= Number(suffix[1]);
      path = path.slice(0, suffix.index);
    }
    try {
      path = decodeURIComponent(path);
    } catch {
      return;
    }
  }
  if (!path || /[\x00-\x1f\x7f]/.test(path)) return;
  return { path, line: line && Number.isSafeInteger(line) ? line : undefined };
}
