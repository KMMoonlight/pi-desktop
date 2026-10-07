import { execFile } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { createServer } from "node:http";
import {
  access,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve, sep } from "node:path";
import { promisify } from "node:util";

const execute = promisify(execFile);

export interface PackageNetworkConfig {
  url: string;
  token: string;
  npmCommand: string[];
  npmEnvironment: Record<string, string>;
  legacyModules: string;
  primary: string;
  secondary: string;
  dependency: string;
  command: string;
  gitSource: string;
}

export async function createPackageNetworkFixture() {
  const root = await mkdtemp(join(tmpdir(), "pi-package-network-"));
  const id = randomUUID().slice(0, 8);
  const token = randomUUID();
  const command = `network-${id}`;
  const primary = `@pi-network/package-${id}`;
  const secondary = `pi-network-secondary-${id}`;
  const dependency = `pi-network-dependency-${id}`;
  const cliCandidates = [
    process.env.npm_execpath,
    join(dirname(process.execPath), "node_modules/npm/bin/npm-cli.js"),
    resolve(
      dirname(process.execPath),
      "../lib/node_modules/npm/bin/npm-cli.js",
    ),
  ].filter((path): path is string => !!path);
  let npmCli: string | undefined;
  for (const path of cliCandidates) {
    if (!path.endsWith("npm-cli.js")) continue;
    if (
      await access(path).then(
        () => true,
        () => false,
      )
    ) {
      npmCli = path;
      break;
    }
  }
  if (!npmCli) {
    await rm(root, { recursive: true, force: true });
    throw new Error(
      "A real npm CLI is required by the package network fixture",
    );
  }
  const userConfig = join(root, "npmrc");
  const globalConfig = join(root, "global-npmrc");
  await writeFile(userConfig, "");
  await writeFile(globalConfig, "");
  const npmBase = [process.execPath, npmCli];
  const legacyPrefix = join(root, "legacy-global");
  const isolatedArgs = [
    `--cache=${join(root, "cache")}`,
    `--userconfig=${userConfig}`,
    `--globalconfig=${globalConfig}`,
    "--no-audit",
    "--no-fund",
    "--fetch-retries=0",
    "--fetch-timeout=5000",
  ];
  const gitRoot = join(root, "git");
  const repository = join(gitRoot, "owner", `${command}.git`);
  const work = join(root, "work");
  const packages = new Map<string, Map<string, Record<string, unknown>>>();
  const tarballs = new Map<string, Buffer>();
  const published = new Set(["1.0.0"]);
  const requests: { method: string; path: string; status: number }[] = [];
  const commits: Record<string, string> = {};
  let registryFault = false;
  let gitFault = false;
  let url = "";
  const runGit = async (cwd: string, args: string[]) =>
    (
      await execute(
        "git",
        [
          "-c",
          "user.name=Pi package fixture",
          "-c",
          "user.email=fixture@example.invalid",
          "-c",
          "core.autocrlf=false",
          ...args,
        ],
        { cwd, windowsHide: true, timeout: 20000 },
      )
    ).stdout.trim();
  const writePackage = async (
    directory: string,
    name: string,
    version: string,
    git = false,
  ) => {
    await mkdir(join(directory, "extensions"), { recursive: true });
    await writeFile(
      join(directory, "package.json"),
      JSON.stringify({
        name,
        version,
        dependencies: { [dependency]: "1.0.0" },
        peerDependencies: { "@earendil-works/pi-coding-agent": "^1.0.0" },
        ...(git
          ? {
              devDependencies: {
                [secondary]: "1.0.0",
              },
            }
          : {}),
        pi: { extensions: ["extensions"] },
      }),
    );
    await writeFile(
      join(directory, "extensions", "primary.ts"),
      `import marker from ${JSON.stringify(dependency)};
export default pi => pi.registerCommand(${JSON.stringify(command)}, {
  handler: (_args, ctx) => {
    ctx.ui.setEditorText(marker + ":${version}");
    ctx.ui.setStatus("sdk-package-network", marker + ":${version}");
  }
});`,
    );
    await writeFile(
      join(directory, "extensions", "secondary.ts"),
      `export default pi => pi.registerCommand(${JSON.stringify(`${command}-secondary`)}, {handler() {}});`,
    );
  };
  const advanceGit = async (version: string) => {
    if (commits[version]) return;
    await writePackage(work, `pi-network-git-${id}`, version, true);
    await runGit(work, ["add", "."]);
    await runGit(work, ["commit", "-m", `Fixture ${version}`]);
    await runGit(work, ["tag", `v${version}`]);
    await runGit(work, ["push", "origin", "main", "--tags"]);
    await runGit(repository, ["update-server-info"]);
    commits[version] = await runGit(work, ["rev-parse", "HEAD"]);
  };
  const server = createServer(async (req, res) => {
    const requestUrl = new URL(req.url ?? "/", url);
    const path = decodeURIComponent(requestUrl.pathname);
    const send = (
      status: number,
      content: string | Buffer,
      type = "application/json",
    ) => {
      if (path !== "/control")
        requests.push({ method: req.method ?? "GET", path, status });
      res.writeHead(status, {
        "content-type": type,
        "cache-control": "no-store",
      });
      res.end(req.method === "HEAD" ? undefined : content);
    };
    try {
      if (path === "/control") {
        if (req.method !== "POST" || req.headers["x-fixture-token"] !== token) {
          send(403, "{}");
          return;
        }
        let body = "";
        for await (const chunk of req) body += chunk;
        const action = JSON.parse(body);
        if (action.operation === "publish") published.add(action.version);
        else if (action.operation === "advanceGit")
          await advanceGit(action.version);
        else if (action.operation === "installLegacy")
          await execute(
            npmBase[0],
            [
              ...npmBase.slice(1),
              ...isolatedArgs,
              `--registry=${url}`,
              "install",
              "--global",
              "--legacy-peer-deps",
              "--prefix",
              legacyPrefix,
              `${primary}@1.0.0`,
            ],
            { windowsHide: true, timeout: 20000 },
          );
        else if (action.operation === "faults") {
          registryFault = action.registry === true;
          gitFault = action.git === true;
        }
        send(
          200,
          JSON.stringify({ commits, requests, published: [...published] }),
        );
        return;
      }
      if (path.startsWith("/git/")) {
        if (gitFault) {
          send(503, "Git fixture unavailable", "text/plain");
          return;
        }
        const target = resolve(root, `.${path}`);
        if (!target.startsWith(`${gitRoot}${sep}`)) {
          send(404, "{}");
          return;
        }
        const content = await readFile(target).catch(() => undefined);
        send(content ? 200 : 404, content ?? "", "application/octet-stream");
        return;
      }
      if (registryFault) {
        send(503, '{"error":"fixture unavailable"}');
        return;
      }
      const tarball = tarballs.get(path);
      if (tarball) {
        send(200, tarball, "application/octet-stream");
        return;
      }
      const name = path.slice(1);
      const available = packages.get(name);
      if (!available) {
        send(404, '{"error":"package not found"}');
        return;
      }
      const versions = Object.fromEntries(
        [...available].filter(([version]) =>
          name === primary || name === secondary
            ? published.has(version)
            : true,
        ),
      );
      const latest = [...Object.keys(versions)].at(-1);
      send(200, JSON.stringify({ name, "dist-tags": { latest }, versions }));
    } catch (error) {
      send(500, JSON.stringify({ error: String(error) }));
    }
  });
  try {
    await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
    url = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
    for (const [name, versions] of [
      [dependency, ["1.0.0"]],
      [primary, ["1.0.0", "1.1.0", "2.0.0"]],
      [secondary, ["1.0.0", "1.1.0", "2.0.0"]],
    ] as const) {
      const records = new Map<string, Record<string, unknown>>();
      packages.set(name, records);
      for (const version of versions) {
        const directory = join(
          root,
          "packs",
          name.replace(/[@/]/g, "-"),
          version,
        );
        await mkdir(directory, { recursive: true });
        if (name === dependency) {
          await writeFile(
            join(directory, "package.json"),
            JSON.stringify({ name, version, main: "index.js" }),
          );
          await writeFile(
            join(directory, "index.js"),
            'module.exports = "dependency-loaded";',
          );
        } else await writePackage(directory, name, version);
        const packed = await execute(
          npmBase[0],
          [
            ...npmBase.slice(1),
            ...isolatedArgs,
            "pack",
            "--json",
            "--ignore-scripts",
            "--offline",
            `--cache=${join(root, "pack-cache")}`,
          ],
          { cwd: directory, windowsHide: true, timeout: 20000 },
        );
        const [{ filename }] = JSON.parse(packed.stdout);
        const archive = await readFile(join(directory, filename));
        const tarPath = `/tarballs/${filename}`;
        tarballs.set(tarPath, archive);
        records.set(version, {
          ...JSON.parse(
            await readFile(join(directory, "package.json"), "utf8"),
          ),
          dist: {
            tarball: `${url}${tarPath}`,
            shasum: createHash("sha1").update(archive).digest("hex"),
            integrity: `sha512-${createHash("sha512").update(archive).digest("base64")}`,
          },
        });
      }
    }
    await mkdir(repository, { recursive: true });
    await mkdir(work, { recursive: true });
    await runGit(repository, ["init", "--bare"]);
    await runGit(repository, ["symbolic-ref", "HEAD", "refs/heads/main"]);
    await runGit(work, ["init", "-b", "main"]);
    await runGit(work, ["remote", "add", "origin", repository]);
    await advanceGit("1.0.0");
  } catch (error) {
    server.closeAllConnections();
    await new Promise<void>((done) => server.close(() => done()));
    await rm(root, {
      recursive: true,
      force: true,
      maxRetries: 10,
      retryDelay: 100,
    });
    throw error;
  }
  return {
    config: {
      url,
      token,
      primary,
      secondary,
      dependency,
      command,
      npmCommand: [
        process.platform === "win32"
          ? join(dirname(process.execPath), "npm.cmd")
          : "npm",
        ...isolatedArgs,
        `--registry=${url}`,
      ],
      npmEnvironment: {
        npm_config_registry: url,
        npm_config_cache: join(root, "cache"),
        npm_config_userconfig: userConfig,
        npm_config_globalconfig: globalConfig,
        npm_config_audit: "false",
        npm_config_fund: "false",
        npm_config_fetch_retries: "0",
        npm_config_fetch_timeout: "5000",
        npm_config_prefix: legacyPrefix,
      },
      legacyModules: join(
        legacyPrefix,
        ...(process.platform === "win32" ? [] : ["lib"]),
        "node_modules",
      ),
      gitSource: `${url}/git/owner/${command}.git`,
    } satisfies PackageNetworkConfig,
    async close() {
      server.closeAllConnections();
      await new Promise<void>((done) => server.close(() => done()));
      await rm(root, {
        recursive: true,
        force: true,
        maxRetries: 10,
        retryDelay: 100,
      });
    },
  };
}
