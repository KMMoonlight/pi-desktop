export default function (pi) {
  pi.registerMarkdownTransformer((markdown) => {
    if (markdown.includes("transcript-fail"))
      throw new Error("Expected transformer failure");
    return markdown;
  });
  pi.registerMarkdownTransformer((markdown) =>
    markdown.includes("transcript-fail") ? undefined : markdown,
  );
  pi.registerMarkdownTransformer((markdown, context) => {
    if (markdown.includes("transcript-layout-probe"))
      return (
        markdown +
        `\n\n\`Layout ${context.messageType}: ${context.availableWidth} 0000000000\`\n`
      );
    if (!markdown.includes("transcript-fail")) return markdown;
    return (
      markdown.replace(
        "transcript-fail",
        "\x1b[38;2;18;130;90mTransformed transcript\x1b[39m",
      ) + (markdown.includes("┌") ? "\n\nMermaid before extensions." : "")
    );
  });
}
