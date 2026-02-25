 "use client";

import * as React from "react";

import { Toast as PrimitiveToast } from "./toast";
import { useToast } from "./use-toast";

export function Toaster() {
  const { toasts, removeToast } = useToast();

  if (!toasts.length) return null;

  return (
    <div className="fixed bottom-4 right-4 z-50 flex w-full max-w-sm flex-col gap-2">
      {toasts.map((toast) => (
        <PrimitiveToast
          key={toast.id}
          onOpenChange={(open) => {
            if (!open) removeToast(toast.id);
          }}
        >
          {toast.title && (
            <div className="font-semibold">{toast.title}</div>
          )}
          {toast.description && (
            <div className="text-sm text-muted-foreground">
              {toast.description}
            </div>
          )}
        </PrimitiveToast>
      ))}
    </div>
  );
}

