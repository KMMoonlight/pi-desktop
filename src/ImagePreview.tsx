import { useState } from "react";
import { X } from "lucide-react";
import { Modal } from "./primitives";
import { t, useLocale } from "./i18n";

/** Local image data stays in the renderer, including while enlarged. */
export function ImagePreview({
  src,
  alt,
  className,
}: {
  src: string;
  alt: string;
  className?: string;
}) {
  useLocale();
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        className="image-preview-trigger"
        aria-label={t("放大查看 {value1}", { value1: alt })}
        onClick={() => setOpen(true)}
      >
        <img src={src} alt={alt} className={className} />
      </button>
      <Modal
        active={open}
        onClose={() => setOpen(false)}
        ariaLabel={t("图片预览")}
        size="max-content"
        padding={0}
        className="image-preview-dialog overflow-visible rounded-none border-0 bg-transparent shadow-none"
      >
        <button
          type="button"
          className="absolute right-2 top-2 flex size-8 items-center justify-center rounded-full bg-canvas/90 text-ink shadow-sm outline-none hover:bg-canvas focus-visible:ring-2 focus-visible:ring-coral/50"
          aria-label={t("关闭图片预览")}
          onClick={() => setOpen(false)}
        >
          <X size={16} aria-hidden="true" />
        </button>
        <img
          src={src}
          alt={alt}
          className="block h-auto w-auto max-h-[calc(100dvh-48px)] max-w-[calc(100vw-48px)] object-contain"
        />
      </Modal>
    </>
  );
}
