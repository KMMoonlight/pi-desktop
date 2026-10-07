/** ConPTY's initial clear/CSI preamble is independent of write/chunk boundaries. */
export function isConPtyStartupTitle(
  output: string,
  title: string,
  executable: string,
) {
  if (title !== executable) return false;
  const titleStart = output.indexOf(`\x1b]0;${executable}\x07`);
  if (titleStart < 0) return false;
  const preamble = output.slice(0, titleStart);
  return (
    preamble.includes("\x1b[2J") &&
    preamble.replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, "").trim() === ""
  );
}
