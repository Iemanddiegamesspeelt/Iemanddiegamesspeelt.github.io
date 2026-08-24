export default function Loading() {
  return (
    <main className="mx-auto min-h-[68vh] max-w-7xl animate-pulse px-5 py-12 lg:px-8" aria-label="Loading">
      <div className="h-3 w-24 rounded-full bg-white/[.06]" />
      <div className="mt-4 h-10 w-80 max-w-full rounded-xl bg-white/[.07]" />
      <div className="mt-3 h-4 w-[32rem] max-w-full rounded-lg bg-white/[.045]" />
      <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {[0, 1, 2].map((item) => <div key={item} className="h-56 rounded-[22px] border border-white/[.05] bg-white/[.025]" />)}
      </div>
    </main>
  );
}

