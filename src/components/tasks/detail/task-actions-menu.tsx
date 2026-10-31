"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Check, Link2, Ellipsis, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/primitives";
import { ServerActionForm } from "@/components/forms/server-action-form";
import { useI18n } from "@/lib/i18n/client";
import { deleteTaskAction } from "@/server/use-cases/tasks";

const itemClass =
  "flex w-full items-center gap-2.5 rounded-md px-3 py-2 text-start text-sm text-ink transition-colors hover:bg-surface-muted focus-visible:bg-surface-muted focus-visible:outline-none";

/** "…" menu: copy link, delete (with confirmation) for allowed users. */
export function TaskActionsMenu({
  taskId,
  canDelete,
  afterDeleteHref,
}: {
  taskId: string;
  canDelete: boolean;
  afterDeleteHref: string;
}) {
  const { t } = useI18n();
  const th = t.tasksDetail.header;
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [copied, setCopied] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onPointer(e: PointerEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("pointerdown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  async function copyLink() {
    const url = `${window.location.origin}/tasks/${taskId}`;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      window.prompt(th.copyLink, url);
    }
    setOpen(false);
  }

  const onDeleted = useCallback(() => {
    setConfirming(false);
    router.replace(afterDeleteHref);
  }, [router, afterDeleteHref]);

  return (
    <div ref={rootRef} className="relative">
      <Button
        type="button"
        variant="outline"
        className="h-9 w-9 min-h-9 px-0"
        aria-label={th.moreActions}
        title={th.moreActions}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        data-testid="task-actions-menu"
      >
        {copied ? <Check aria-hidden className="h-4 w-4 text-success" /> : <Ellipsis aria-hidden className="h-4 w-4" />}
      </Button>
      <span className="sr-only" role="status" aria-live="polite">
        {copied ? th.linkCopied : ""}
      </span>
      {open ? (
        <div
          role="menu"
          className="mt-pop-in absolute end-0 top-full z-30 mt-2 w-52 rounded-[var(--radius-surface)] border border-line bg-surface p-1.5 shadow-[var(--shadow-2)]"
        >
          <button type="button" role="menuitem" className={itemClass} onClick={copyLink}>
            <Link2 aria-hidden className="h-4 w-4 text-muted" />
            {th.copyLink}
          </button>
          {canDelete ? (
            <button
              type="button"
              role="menuitem"
              className={`${itemClass} text-danger hover:bg-danger-soft focus-visible:bg-danger-soft`}
              onClick={() => {
                setOpen(false);
                setConfirming(true);
              }}
              data-testid="task-delete"
            >
              <Trash2 aria-hidden className="h-4 w-4" />
              {th.deleteTask}
            </button>
          ) : null}
        </div>
      ) : null}
      {confirming ? (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-overlay p-4 sm:items-center"
          role="dialog"
          aria-modal="true"
          aria-labelledby="task-delete-title"
          onKeyDown={(e) => {
            if (e.key === "Escape") setConfirming(false);
          }}
        >
          <div className="mt-pop-in w-full max-w-md rounded-[var(--radius-surface)] border border-line bg-surface p-5 shadow-[var(--shadow-2)]">
            <h2 id="task-delete-title" className="font-semibold text-ink">
              {th.deleteTitle}
            </h2>
            <p className="mt-2 text-sm leading-relaxed text-muted">{th.deleteBody}</p>
            <ServerActionForm action={deleteTaskAction} className="mt-4 grid gap-2" testId="task-delete-form" onSuccess={onDeleted}>
              <input type="hidden" name="taskId" value={taskId} />
              <div className="flex flex-wrap gap-2">
                <Button type="submit" variant="danger">
                  {th.deleteConfirm}
                </Button>
                <Button type="button" variant="secondary" onClick={() => setConfirming(false)} autoFocus>
                  {t.tasksDetail.cancel}
                </Button>
              </div>
            </ServerActionForm>
          </div>
        </div>
      ) : null}
    </div>
  );
}
