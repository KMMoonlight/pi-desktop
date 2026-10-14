import {
  createReadToolDefinition,
  createWriteToolDefinition,
  createEditToolDefinition,
  createBashToolDefinition,
  createPowerShellToolDefinition,
  createGrepToolDefinition,
  createFindToolDefinition,
  createLsToolDefinition,
  type AgentSession,
  type ToolRenderers,
} from "@earendil-works/pi-coding-agent";

const builtins = new Map<string, ToolRenderers>(
  [
    createReadToolDefinition,
    createWriteToolDefinition,
    createEditToolDefinition,
    createBashToolDefinition,
    createPowerShellToolDefinition,
    createGrepToolDefinition,
    createFindToolDefinition,
    createLsToolDefinition,
  ].map((create) => {
    const definition = create(".");
    return [definition.name, definition as unknown as ToolRenderers];
  }),
);
const sessions = new WeakMap<
  AgentSession,
  Map<
    string,
    {
      definition: ReturnType<AgentSession["getToolDefinition"]>;
      extensions: ReturnType<
        AgentSession["resourceLoader"]["getExtensions"]
      >["extensions"];
      resolved: ToolRenderers | undefined;
    }
  >
>();

/** Match Pi's interactive renderer resolution, including resumed, unavailable tools. */
export function resolveToolRenderers(session: AgentSession, name: string) {
  const definition = session.getToolDefinition(name);
  const extensions = session.resourceLoader.getExtensions().extensions;
  let cache = sessions.get(session);
  if (!cache) sessions.set(session, (cache = new Map()));
  const previous = cache.get(name);
  if (
    previous &&
    previous.definition === definition &&
    previous.extensions === extensions
  )
    return previous.resolved;
  const resolved = session.extensionRunner.resolveToolRenderers(name, () => {
    const builtin = builtins.get(name);
    if (!definition) return builtin;
    if (!builtin) return definition;
    return {
      ...definition,
      renderCall: definition.renderCall ?? builtin.renderCall,
      renderResult: definition.renderResult ?? builtin.renderResult,
    };
  });
  // Resolver callbacks may construct fresh functions. Retain the native row's
  // rendering identity until the registry or extension generation changes.
  cache.set(name, { definition, extensions, resolved });
  return resolved;
}
