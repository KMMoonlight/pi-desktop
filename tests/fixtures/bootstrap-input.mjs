import { Input } from "@earendil-works/pi-tui";

export default function (pi) {
  pi.on("session_start", async (_event, ctx) => {
    if (!ctx.cwd.endsWith("next-workspace")) return;
    const value = await ctx.ui.custom((_tui, _theme, _keys, done) => {
      const input = new Input({ prompt: "Startup extension input" });
      input.onSubmit = done;
      return input;
    });
    ctx.ui.setStatus("bootstrap-input", value);
  });
}
