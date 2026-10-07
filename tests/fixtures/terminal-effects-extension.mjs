export default function (pi) {
  pi.registerCommand("terminal-effect-component", {
    handler: async (_args, ctx) => {
      const result = await ctx.ui.custom((_tui, _theme, _keys, done) => ({
        render: () => [
          "\x1b]2;Component terminal title\x07\x1b]9;4;3\x07\x1b]52;c;Y29tcG9uZW50IGNvcHk=\x07Terminal component effects",
        ],
        invalidate() {},
        handleInput(data) {
          if (data === "\r") done("submitted");
        },
      }));
      ctx.ui.setStatus("terminal-effect-component-result", result);
    },
  });
}
