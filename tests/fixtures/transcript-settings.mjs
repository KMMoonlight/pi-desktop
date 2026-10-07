export default function (sdk, args) {
  if (args.mode) sdk.session.settingsManager.setMermaidRenderingMode(args.mode);
  if (args.padding !== undefined)
    sdk.session.settingsManager.setOutputPad(args.padding);
  return {
    mode: sdk.session.settingsManager.getMermaidRenderingMode(),
    padding: sdk.session.settingsManager.getOutputPad(),
  };
}
