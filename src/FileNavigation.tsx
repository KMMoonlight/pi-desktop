import { createContext } from "react";
import type { FilePreview } from "../shared/types";
export { desktopFileReference as desktopFileTarget } from "../shared/links";

export type FileTarget = { path: string; line?: number; preview?: FilePreview };
export const FileNavigation = createContext<
  ((target: FileTarget) => Promise<void>) | undefined
>(undefined);
