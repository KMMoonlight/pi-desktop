import { readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import * as sdk from "@earendil-works/pi-coding-agent";
import * as access from "../backend/sdk-access.ts";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const index = fileURLToPath(
  import.meta.resolve("@earendil-works/pi-coding-agent"),
).replace(/\.js$/, ".d.ts");
const program = ts.createProgram([index], {
  target: ts.ScriptTarget.ES2022,
  module: ts.ModuleKind.NodeNext,
  moduleResolution: ts.ModuleResolutionKind.NodeNext,
  skipLibCheck: true,
});
const checker = program.getTypeChecker();
const module = checker.getSymbolAtLocation(program.getSourceFile(index));
if (!module) throw new Error("SDK declaration module was not resolved");
const nativeSurfaces = new Set([
  "AgentSession",
  "AgentSessionRuntime",
  "SessionManager",
  "SettingsManager",
  "ModelRuntime",
  "ModelRegistry",
  "DefaultResourceLoader",
  "ResourceLoader",
  "DefaultPackageManager",
  "ProjectTrustStore",
  "ExtensionRunner",
  "ExtensionAPI",
  "ExtensionContext",
  "ExtensionCommandContext",
  "ExtensionToolContext",
  "ExtensionUIContext",
  "CreateAgentSessionOptions",
  "CreateAgentSessionServicesOptions",
  "CreateAgentSessionFromServicesOptions",
  "ToolDefinition",
]);
function publicMembers(type, excludePrototype = false) {
  return checker
    .getPropertiesOfType(type)
    .filter((member) => !(excludePrototype && member.getName() === "prototype"))
    .filter(
      (member) =>
        !member.declarations?.some((item) =>
          item.modifiers?.some(
            (modifier) =>
              modifier.kind === ts.SyntaxKind.PrivateKeyword ||
              modifier.kind === ts.SyntaxKind.ProtectedKeyword,
          ),
        ),
    )
    .map((member) => ({
      name: member.getName(),
      signature: checker.typeToString(
        checker.getTypeOfSymbolAtLocation(
          member,
          member.valueDeclaration ?? member.declarations[0],
        ),
      ),
    }));
}
const declarations = checker
  .getExportsOfModule(module)
  .map((symbol) => {
    const declaration =
      symbol.flags & ts.SymbolFlags.Alias
        ? checker.getAliasedSymbol(symbol)
        : symbol;
    const name = symbol.getName();
    const instance = checker.getDeclaredTypeOfSymbol(declaration);
    const isClass = !!(declaration.flags & ts.SymbolFlags.Class);
    const classType = isClass
      ? checker.getTypeOfSymbolAtLocation(
          declaration,
          declaration.valueDeclaration ?? declaration.declarations[0],
        )
      : undefined;
    const members =
      isClass || nativeSurfaces.has(name) ? publicMembers(instance) : undefined;
    const staticMembers = classType
      ? publicMembers(classType, true)
      : undefined;
    const constructors = classType
      ? classType
          .getConstructSignatures()
          .filter(
            (signature) =>
              !signature.declaration?.modifiers?.some(
                (modifier) =>
                  modifier.kind === ts.SyntaxKind.PrivateKeyword ||
                  modifier.kind === ts.SyntaxKind.ProtectedKeyword,
              ),
          )
          .map((signature) => checker.signatureToString(signature))
      : undefined;
    return {
      name,
      runtime: Object.hasOwn(sdk, name),
      constructors,
      members,
      staticMembers,
    };
  })
  .sort((a, b) => a.name.localeCompare(b.name));
const mismatches = Object.keys(sdk).filter(
  (name) => access[name] !== sdk[name],
);
if (mismatches.length)
  throw new Error(`Native exports differ: ${mismatches.join(", ")}`);
const packageJson = JSON.parse(
  await readFile(resolve(dirname(index), "..", "package.json"), "utf8"),
);
const inventory = {
  package: packageJson.name,
  version: packageJson.version,
  declarationExports: declarations.length,
  runtimeExports: Object.keys(sdk).length,
  nativeExportIdentity: true,
  publicClassStaticMembers: declarations.reduce(
    (count, item) => count + (item.staticMembers?.length ?? 0),
    0,
  ),
  nativeClassStaticMembers: declarations.reduce(
    (count, item) =>
      count + (item.runtime ? (item.staticMembers?.length ?? 0) : 0),
    0,
  ),
  publicClassConstructors: declarations.reduce(
    (count, item) => count + (item.constructors?.length ?? 0),
    0,
  ),
  note: "Native availability does not imply desktop rendering compatibility or behavioral test coverage. See sdk-api-audit.md.",
  declarations,
};
await writeFile(
  resolve(root, "docs/sdk-api-inventory.json"),
  JSON.stringify(inventory, null, 2) + "\n",
);
console.log(
  `${packageJson.name}@${packageJson.version}: ${inventory.declarationExports} declaration exports, ${inventory.runtimeExports} unchanged native exports. Inventory written to docs/sdk-api-inventory.json.`,
);
console.log(
  `Public class static members inventoried: ${inventory.publicClassStaticMembers}.`,
);
console.log(
  `Public class constructors inventoried: ${inventory.publicClassConstructors}; runtime class static members: ${inventory.nativeClassStaticMembers}.`,
);
