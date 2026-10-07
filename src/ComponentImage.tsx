import { useState } from "react";
import { localizeText, useLocale } from "./i18n";
import type { DesktopNode } from "../shared/desktop-ui";
import { StyledText } from "./StyledText";

export function ComponentImage({
  node,
}: {
  node: Extract<DesktopNode, { kind: "image" }>;
}) {
  useLocale();
  const alt = node.desktopLabel ? localizeText(node.alt) : node.alt;
  const [failedSource, setFailedSource] = useState<string>();
  if (failedSource === node.src && node.fallback)
    return (
      <span role="img" aria-label={alt}>
        <StyledText {...node.fallback} />
      </span>
    );
  return (
    <img
      key={node.src}
      className="desktop-image"
      src={node.src}
      alt={alt}
      style={
        node.width === undefined
          ? undefined
          : {
              width: node.width,
              aspectRatio: node.aspectRatio,
              maxHeight: "none",
            }
      }
      onError={() => setFailedSource(node.src)}
      onLoad={() => setFailedSource(undefined)}
    />
  );
}
