import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from 'recharts';
import type { HealthScore } from '../types';

interface HealthChartProps {
  scores: HealthScore[];
}

function scoreColor(score: number): string {
  if (score < 30) return '#FF4444';
  if (score < 50) return '#FF6B2B';
  if (score < 70) return '#F8A51B';
  return '#00C9A7';
}

export function HealthChart({ scores }: HealthChartProps) {
  const data = scores.map((s) => ({
    name: s.dimension.replace(' ', '\n'),
    score: s.score,
  }));

  return (
    <ResponsiveContainer width="100%" height={200}>
      <BarChart data={data} layout="vertical" margin={{ left: 20, right: 20 }}>
        <XAxis type="number" domain={[0, 100]} hide />
        <YAxis type="category" dataKey="name" width={100} tick={{ fill: '#6B7D96', fontSize: 11 }} />
        <Tooltip
          contentStyle={{ background: '#141C2E', border: '1px solid #1E2D48', borderRadius: 8 }}
          labelStyle={{ color: '#C0CCDB' }}
          itemStyle={{ color: '#FF6B2B' }}
        />
        <Bar dataKey="score" radius={[0, 4, 4, 0]} barSize={16}>
          {data.map((entry, i) => (
            <Cell key={i} fill={scoreColor(entry.score)} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}
