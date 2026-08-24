'use client';

import { MousePointerClick } from 'lucide-react';

export type TimelineEvent = {
  tick: string;
  player: number;
  state: string;
  control: string;
};

export function MacroTimeline({ events }: { events: TimelineEvent[] }) {
  const maxTick = Math.max(...events.map((event) => Number(event.tick)), 1);
  if (!events.length) {
    return <div className="grid h-28 place-items-center rounded-2xl border border-white/[.06] bg-white/[.02] text-xs text-zinc-600">No input events available</div>;
  }
  return (
    <div className="overflow-hidden rounded-2xl border border-white/[.07] bg-[#0a0d12]">
      <div className="flex items-center justify-between border-b border-white/[.055] px-4 py-3">
        <p className="flex items-center gap-2 text-xs font-semibold text-zinc-300"><MousePointerClick className="h-3.5 w-3.5 text-violet-300" /> Input timeline</p>
        <p className="text-[10px] text-zinc-600">First {events.length} inputs</p>
      </div>
      <div className="timeline-grid relative mx-4 my-4 h-28 overflow-hidden rounded-xl border border-white/[.045]">
        <div className="absolute inset-x-0 top-1/2 border-t border-white/[.07]" />
        <span className="absolute left-2 top-2 text-[9px] text-zinc-700">P1</span>
        <span className="absolute bottom-2 left-2 text-[9px] text-zinc-700">P2</span>
        {events.map((event, index) => {
          const left = Math.min(99, (Number(event.tick) / maxTick) * 100);
          const top = event.player === 2 ? '73%' : '27%';
          return (
            <span
              key={`${event.tick}-${index}`}
              title={`P${event.player} ${event.control} ${event.state} at tick ${event.tick}`}
              className={`absolute h-2.5 w-1.5 -translate-x-1/2 -translate-y-1/2 rounded-full ${event.state === 'press' ? 'bg-violet-400 shadow-[0_0_10px_rgba(139,92,246,.7)]' : 'bg-cyan-300'}`}
              style={{ left: `${left}%`, top }}
            />
          );
        })}
      </div>
    </div>
  );
}

