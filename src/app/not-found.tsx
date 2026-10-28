import Link from "next/link";
import { Card, EmptyState, btnSecondary } from "@/components/ui";

export default function NotFound() {
  return (
    <Card>
      <EmptyState
        title="Not found"
        body="That page, site, run or fix doesn't exist or was removed."
        action={
          <Link href="/" className={btnSecondary}>
            Back to portfolio
          </Link>
        }
      />
    </Card>
  );
}
