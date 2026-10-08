import type { DesktopMarkdownBlock } from "../shared/desktop-ui";
import { StyledText } from "./StyledText";
import { CodeBlock } from "./CodeBlock";

export function ComponentMarkdown({
  blocks,
}: {
  blocks: DesktopMarkdownBlock[];
}) {
  return (
    <>
      {blocks.map((block, index) => {
        switch (block.kind) {
          case "paragraph":
            return (
              <p
                key={index}
                className={
                  block.preformatted
                    ? "desktop-markdown-preformatted"
                    : undefined
                }
              >
                <StyledText {...block} />
              </p>
            );
          case "heading": {
            const Heading =
              `h${Math.max(1, Math.min(6, block.depth ?? 1))}` as "h1";
            return (
              <Heading key={index}>
                <StyledText {...block} />
              </Heading>
            );
          }
          case "quote":
            return (
              <blockquote
                key={index}
                style={{ borderColor: block.borderStyle?.color }}
              >
                <ComponentMarkdown blocks={block.children} />
              </blockquote>
            );
          case "list": {
            const List = block.ordered ? "ol" : "ul";
            return (
              <List
                key={index}
                start={block.ordered ? block.start : undefined}
                className="desktop-markdown-list"
                role="list"
              >
                {block.items.map((item, itemIndex) => (
                  <li key={itemIndex}>
                    {item.checked !== undefined ? (
                      <input
                        type="checkbox"
                        checked={item.checked}
                        disabled
                        aria-label={item.children
                          .map((child) => ("text" in child ? child.text : ""))
                          .join(" ")}
                        className="desktop-markdown-checkbox"
                      />
                    ) : (
                      <span
                        className="desktop-markdown-marker"
                        aria-hidden="true"
                      >
                        {block.ordered ? item.marker.text : "•"}
                      </span>
                    )}
                    <div>
                      <ComponentMarkdown blocks={item.children} />
                    </div>
                  </li>
                ))}
              </List>
            );
          }
          case "code":
            return (
              <CodeBlock
                key={index}
                text={block.text}
                copyText={block.copyText}
                language={block.language}
              >
                <code data-language={block.language}>
                  <StyledText {...block} />
                </code>
              </CodeBlock>
            );
          case "table":
            return (
              <div key={index} className="desktop-markdown-table">
                <table>
                  <thead>
                    <tr>
                      {block.headers.map((cell, column) => (
                        <th
                          key={column}
                          style={{
                            textAlign: block.align[column] ?? undefined,
                          }}
                        >
                          <StyledText {...cell} />
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {block.rows.map((row, rowIndex) => (
                      <tr key={rowIndex}>
                        {row.map((cell, column) => (
                          <td
                            key={column}
                            style={{
                              textAlign: block.align[column] ?? undefined,
                            }}
                          >
                            <StyledText {...cell} />
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            );
          case "divider":
            return <hr key={index} className="desktop-markdown-divider" />;
        }
      })}
    </>
  );
}
