import { createConnection } from "node:net";

/** The native app owns this loopback listener; stdout remains extension output. */
export async function connectNativeChannel() {
  const port = Number(process.env.PI_DESKTOP_CHANNEL_PORT);
  const token = process.env.PI_DESKTOP_CHANNEL_TOKEN;
  delete process.env.PI_DESKTOP_CHANNEL_PORT;
  delete process.env.PI_DESKTOP_CHANNEL_TOKEN;
  if (
    !Number.isInteger(port) ||
    port < 1 ||
    port > 65535 ||
    !/^[a-f0-9]{32}$/.test(token ?? "")
  )
    throw new Error("Invalid native desktop channel configuration");
  const socket = createConnection({ host: "127.0.0.1", port });
  await new Promise<void>((resolve, reject) => {
    const failed = (error: Error) => {
      socket.destroy();
      reject(error);
    };
    // Keep an error observer across the await boundary until the protocol
    // installs its own lifecycle handlers.
    socket.on("error", failed);
    socket.once("close", () =>
      reject(new Error("Native desktop channel closed before authentication")),
    );
    socket.setTimeout(15000, () =>
      socket.destroy(new Error("Native desktop channel connection timed out")),
    );
    socket.once("connect", () => {
      socket.setTimeout(0);
      socket.write(`${token}\n`, (error) => {
        if (error) failed(error);
        else resolve();
      });
    });
  });
  return socket;
}
