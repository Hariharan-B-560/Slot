"use client";

import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

export type UtilisationRow = {
  teacher_name: string;
  available_hours: number;
  verified_hours: number;
  utilisation: number;
};

export function UtilisationChart({ data }: { data: UtilisationRow[] }) {
  const rows = data.map((d) => ({
    name: d.teacher_name,
    Available: Number(d.available_hours),
    Verified: Number(d.verified_hours),
  }));

  return (
    <div className="h-72 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={rows} margin={{ top: 8, right: 8, bottom: 8, left: 8 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
          <XAxis dataKey="name" tick={{ fontSize: 12 }} stroke="#64748b" />
          <YAxis tick={{ fontSize: 12 }} stroke="#64748b" unit="h" width={40} />
          <Tooltip
            contentStyle={{ fontSize: 12, borderRadius: 8, border: "1px solid #e2e8f0" }}
            formatter={(v) => [`${v} h`, ""]}
          />
          <Legend wrapperStyle={{ fontSize: 12 }} />
          <Bar dataKey="Available" fill="#94a3b8" radius={[4, 4, 0, 0]} />
          <Bar dataKey="Verified" fill="#10b981" radius={[4, 4, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
