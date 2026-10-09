# 应用内更新

设置 → 应用更新可手动检查更新。正式桌面版本在启动时、每 6 小时及网络恢复时检查 GitHub Release；默认自动下载，可关闭自动下载。下载完成后显示提示，安装前需确认关闭并重启应用。下载完成指更新包已通过签名验证；联网失败或签名失败不会替换现有应用。

当前发布平台为 Windows x64 和 macOS Apple Silicon。浏览器预览不运行更新。下载包保存在当前进程的内存中，退出应用后需要重新下载；暂不支持断点续传。安装前结束任务并保存编辑；Windows 启动安装器后退出，macOS 安装后重启。

## 首次启用发布

1. 在安全位置生成一次签名密钥，例如 `npx tauri signer generate -w /安全目录/pi-desktop.key`。妥善备份私钥，不提交到仓库；后续发布必须使用同一密钥。
2. 在 GitHub 仓库 Actions 配置中添加：
   - Secret `TAURI_SIGNING_PRIVATE_KEY`：私钥文件的完整内容。
   - Secret `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`：生成时的密码（没有密码可留空）。
   - Variable `TAURI_UPDATER_PUBLIC_KEY`：`.pub` 文件的完整内容，不是文件路径。
3. 同步修改 `package.json`、`package-lock.json`、`src-tauri/tauri.conf.json`、`src-tauri/Cargo.toml` / `Cargo.lock` 的应用版本，创建对应 `vX.Y.Z` tag 并推送。
4. `Desktop installers` 工作流将公钥写入构建配置，生成带签名的安装包；只有两个平台均成功后才创建 Release，上传安装包、签名和 `latest.json`。已有 Release 不会被覆盖，重试前先检查远端状态。带 `-` 的预发布 tag 不进入稳定更新通道。

签名未配置时，普通分支构建仍可用，但在线更新禁用；tag 构建会直接失败，避免发布无法升级的正式版本。仓库内空公钥是开发默认值，不是发布公钥。

现有不含更新模块的旧版本，仍需要手动安装一次支持更新的正式版；此后可通过应用内更新。首次支持更新的版本必须附带 `latest.json`，即使没有新版本也能正常检查。

## 更新通道

固定地址：`https://github.com/KMMoonlight/pi-desktop/releases/latest/download/latest.json`。清单指向对应 tag 下不可变的更新包 URL。依然需要网络能够访问 GitHub；无需用户打开 GitHub 下载。

本地签名构建可设置上述三个环境变量（公钥变量同名），运行 `node scripts/configure-updates.mjs` 后按现有方式构建。脚本会修改本地 Tauri 配置，勿将临时生成的配置误提交。macOS 使用额外配置 `--config src-tauri/tauri.macos.conf.json`。Tauri 更新签名与操作系统的代码签名、公证是不同机制。

验证命令：`npm run check`、`npx tsx --test tests/update-controller.test.ts tests/update-release.test.ts`、`cargo check --manifest-path src-tauri/Cargo.toml`。上线前仍需用两个不同版本的真实签名安装包验证 Windows 和 macOS 升级。
