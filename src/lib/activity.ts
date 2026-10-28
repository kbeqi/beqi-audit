// Human labels for audit_log actions, shared by the portfolio and client pages.
const LABELS: Record<string, string> = {
  "client.created": "Client added",
  "client.updated": "Client updated",
  "client.deleted": "Client deleted",
  "client.logo_updated": "Client logo updated",
  "client.logo_removed": "Client logo removed",
  "webflow.connected": "Webflow workspace connected",
  "webflow.connect_failed": "Webflow connection failed",
  "webflow.sites_imported": "Sites imported from Webflow",
  "webflow.import_failed": "Site import from Webflow failed",
  "webflow.disconnected": "Webflow workspace disconnected",
  "run.started": "Audit started",
  "run.shared": "Report link created",
  "run.unshared": "Report link turned off",
  "site.settings_updated": "Site settings changed",
  "ignore_rule.created": "Ignore rule added",
  "finding.state_changed": "Finding status changed",
  "fix.approved": "Fix approved",
  "fix.rejected": "Fix rejected",
  "fix.resolved_manually": "Fix marked as done by hand",
  "fix.apply_started": "Fix application started",
  "fix.applied": "Fix applied",
  "fix.skipped": "Fix skipped (value changed since audit)",
  "fix.failed": "Fix failed",
  "email.sent": "Email sent",
  "email.skipped": "Email skipped (not configured)",
  "email.failed": "Email failed",
  "action.error": "An action failed (details in the log)",
  "team.user_added": "Team member added",
  "team.role_changed": "Team role changed",
  "team.user_removed": "Team member removed",
  "auth.signed_in": "Signed in",
};

export function humanAction(action: string): string {
  return LABELS[action] ?? action;
}
