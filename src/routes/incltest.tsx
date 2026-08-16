import { createFileRoute } from "@tanstack/react-router";
import { WhatsIncludedSheet } from "@/components/WhatsIncludedSheet";

export const Route = createFileRoute("/incltest")({
  component: () => (
    <WhatsIncludedSheet
      open
      segmentId={null}
      taskSlug="house-cleaning"
      onClose={() => {}}
      onSchedule={() => {}}
      onBookInstant={() => {}}
    />
  ),
});
