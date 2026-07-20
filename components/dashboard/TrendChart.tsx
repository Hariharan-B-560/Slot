"use client";

import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

export type TrendRow = { bucket: string; delivered: number; verified: number };

// Delivered vs verified over the selected range. Buckets come from the DB
// (daily for short ranges, weekly for long ones), so this just plots them.
// A widening gap between the two lines is the drift worth noticing.
export function TrendChart({ data }: { data: TrendRow[] }) {
  const rows = data.map((d) => ({
    name: new Date(d.bucket + "T00:00:00").toLocaleDateString("en-IN", { day: "numeric", month: "short" }),
    Delivered: Number(d.delivered),
    Verified: Number(d.verified),
  }));

  if (rows.length === 0) {
    return <p className="text-sm text-muted-foreground">No activity in this range.</p>;
  }

  return (
    <div className="h-64 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={rows} margin={{ top: 8, right: 8, bottom: 8, left: 8 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
          <XAxis dataKey="name" tick={{ fontSize: 11 }} stroke="#64748b" minTickGap={16} />
          <YAxis tick={{ fontSize: 12 }} stroke="#64748b" width={32} allowDecimals={false} />
          <Tooltip contentStyle={{ fontSize: 12, borderRadius: 8, border: "1px solid #e2e8f0" }} />
          <Legend wrapperStyle={{ fontSize: 12 }} />
          <Line type="monotone" dataKey="Delivered" stroke="#94a3b8" strokeWidth={2} dot={false} />
          <Line type="monotone" dataKey="Verified" stroke="#10b981" strokeWidth={2} dot={false} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
