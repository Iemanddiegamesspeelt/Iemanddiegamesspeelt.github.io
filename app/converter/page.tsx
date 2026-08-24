import type { Metadata } from 'next';
import { ConverterWorkspace } from '../../components/converter/converter-workspace';
import { replayToolRegistry } from '../../lib/replay/registry';

export const metadata: Metadata = {
  title: 'Converter',
  description: 'Open a Geometry Dash macro and download an available replay format.',
};

export default function ConverterPage() {
  return (
    <main className="mx-auto min-h-[75vh] max-w-7xl px-5 py-12 lg:px-8">
      <header className="mb-9 max-w-3xl">
        <p className="text-[10px] font-semibold uppercase tracking-[.2em] text-violet-300">Macro converter</p>
        <h1 className="mt-3 text-4xl font-semibold tracking-[-.045em] sm:text-5xl">Convert a macro</h1>
        <p className="mt-3 text-sm leading-6 text-zinc-500">Open a replay, review its details, and choose an available output.</p>
      </header>
      <ConverterWorkspace tools={replayToolRegistry.filter((tool) => tool.id !== 'macrohub').map((tool) => ({ id: tool.id, label: tool.displayName }))} />
    </main>
  );
}
