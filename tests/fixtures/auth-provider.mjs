let records = [];
let promptController;

export function abortPrompt() {
  promptController?.abort();
}

export default function ({ session }, { operation, scenario = "success" }) {
  if (operation === "records") return records;
  if (operation === "abortPrompt") return abortPrompt();
  records = [];
  const runtime = session.modelRuntime;
  const base = runtime.getProvider("desktop-test");
  const provider = "desktop-auth-test";
  runtime.registerNativeProvider({
    ...base,
    id: provider,
    name: "Desktop login fixture",
    getModels: () => [],
    getAllModels: () => [],
    auth: {
      oauth: {
        name: "Fixture OAuth",
        async login(interaction, options) {
          const deviceId = options?.getDeviceId?.();
          if (!/^[0-9a-f-]{36}$/i.test(deviceId ?? ""))
            throw new Error("Fixture login requires a device ID");
          records.push({ type: "device", value: deviceId });
          if (scenario === "late-notify") {
            interaction.notify({
              type: "auth_url",
              url: "https://example.invalid/active",
            });
            try {
              await interaction.prompt({
                type: "manual_code",
                message: "Fixture delayed prompt",
              });
            } finally {
              interaction.notify({
                type: "auth_url",
                url: "https://example.invalid/retired",
              });
            }
          } else if (scenario === "prompt-race") {
            promptController = new AbortController();
            try {
              await interaction.prompt({
                type: "manual_code",
                message: "Fixture callback code",
                placeholder: "callback URL",
                signal: promptController.signal,
              });
              throw new Error("The callback prompt was not cancelled");
            } catch (error) {
              if (
                !promptController.signal.aborted ||
                interaction.signal.aborted
              )
                throw error;
              records.push({ type: "prompt-cancelled" });
            }
          } else {
            interaction.notify({
              type: "info",
              message: "Fixture account selection",
              links: [
                {
                  label: "Account settings",
                  url: "https://example.invalid/account",
                },
              ],
            });
            interaction.notify({
              type: "device_code",
              verificationUri: "https://example.invalid/activate",
              userCode: "FIXTURE-CODE",
              intervalSeconds: 2,
              expiresInSeconds: 60,
            });
            const account = await interaction.prompt({
              type: "select",
              message: "Fixture account",
              options: [
                {
                  id: "account-a",
                  label: "Same account",
                  description: "Personal workspace",
                },
                {
                  id: "account-b",
                  label: "Same account",
                  description: "Team workspace",
                },
              ],
            });
            records.push({ type: "account", value: account });
            const zone = await interaction.prompt({
              type: "text",
              message: "Fixture region",
              placeholder: "region-name",
            });
            records.push({ type: "region", value: zone });
            const secret = await interaction.prompt({
              type: "secret",
              message: "Fixture secret",
              placeholder: "fixture credential",
            });
            records.push({
              type: "secret",
              accepted: secret === "fixture-only",
            });
          }
          return {
            type: "oauth",
            access: "fixture-access",
            refresh: "fixture-refresh",
            expires: Date.now() + 3_600_000,
          };
        },
        refresh: async (credential) => credential,
        toAuth: async (credential) => ({ apiKey: credential.access }),
      },
    },
  });
  return provider;
}
