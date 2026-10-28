"use client";

import { SubmitButton } from "./submit-button";

// Kept for existing call sites: a SubmitButton that confirms first.
export function ConfirmButton({ message, className, children, pendingLabel }: { message: string; className?: string; children: React.ReactNode; pendingLabel?: string }) {
  return (
    <SubmitButton confirm={message} className={className} pendingLabel={pendingLabel}>
      {children}
    </SubmitButton>
  );
}
