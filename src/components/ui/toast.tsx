import * as React from "react";
import { X } from "lucide-react";

import { cn } from "@/lib/utils";

type ToastProps = React.HTMLAttributes<HTMLDivElement> & {
  onOpenChange?: (open: boolean) => void;
};

const Toast = React.forwardRef<HTMLDivElement, ToastProps>(
  ({ className, children, onOpenChange, ...props }, ref) => (
    <div
      ref={ref}
      className={cn(
        "pointer-events-auto relative flex w-full items-center justify-between space-x-2 overflow-hidden rounded-md border border-border bg-background px-4 py-3 text-sm shadow-lg",
        className
      )}
      {...props}
    >
      {children}
    </div>
  )
);
Toast.displayName = "Toast";

const ToastTitle = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
  <div ref={ref} className={cn("font-semibold", className)} {...props} />
));
ToastTitle.displayName = "ToastTitle";

const ToastDescription = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
  <div
    ref={ref}
    className={cn("text-sm text-muted-foreground", className)}
    {...props}
  />
));
ToastDescription.displayName = "ToastDescription";

const ToastClose = React.forwardRef<
  HTMLButtonElement,
  React.ButtonHTMLAttributes<HTMLButtonElement>
>(({ className, ...props }, ref) => (
  <button
    ref={ref}
    className={cn(
      "absolute right-2 top-2 rounded-md p-1 text-muted-foreground opacity-70 transition-opacity hover:opacity-100 focus:outline-none focus:ring-2 focus:ring-foreground",
      className
    )}
    type="button"
    {...props}
  >
    <X className="h-4 w-4" />
  </button>
));
ToastClose.displayName = "ToastClose";

export { Toast, ToastTitle, ToastDescription, ToastClose };

