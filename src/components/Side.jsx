import React from "react";
import MetaCol from "./MetaCol";

export default function Side({ buckets, today }) {
  return (
    <div className="w-60 flex-shrink-0 flex flex-col">
      <MetaCol
        title="Overdue"
        color="red"
        rows={buckets.overdue}
        today={today}
      />
      <div className="h-4" />
      <MetaCol title="On Hold" color="amber" rows={buckets.hold} onHold />
    </div>
  );
}
