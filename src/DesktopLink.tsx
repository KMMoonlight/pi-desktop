import {
  useContext,
  useEffect,
  useRef,
  useState,
  type ComponentProps,
} from "react";
import { external } from "./client";
import { FileNavigation, desktopFileTarget } from "./FileNavigation";

/** Preserve native link presentation while reporting failures at the clicked link. */
export function DesktopLink({ href, children, ...props }: ComponentProps<"a">) {
  const openFile = useContext(FileNavigation);
  const [error, setError] = useState<string>();
  const currentHref = useRef(href);
  const request = useRef(0);
  currentHref.current = href;
  useEffect(() => {
    setError(undefined);
    request.current++;
  }, [href]);
  return (
    <>
      <a
        {...props}
        href={href}
        onClick={(event) => {
          event.preventDefault();
          setError(undefined);
          const id = ++request.current;
          if (href) {
            const target = desktopFileTarget(href);
            // Extension dialogs retain their own focus scope and external opener.
            const opening =
              target &&
              openFile &&
              !event.currentTarget.closest('[role="dialog"]')
                ? openFile(target)
                : external(href);
            void opening.catch((reason) => {
              if (currentHref.current === href && request.current === id)
                setError(
                  reason instanceof Error ? reason.message : String(reason),
                );
            });
          }
        }}
      >
        {children}
      </a>
      {error && (
        <span role="alert" className="desktop-link-error">
          {error}
        </span>
      )}
    </>
  );
}
