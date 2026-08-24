import type { Metadata } from 'next';
import { UploadWizard } from '../../components/upload/upload-wizard';
import { getChatGPTUser } from '../chatgpt-auth';

export const metadata: Metadata = {
  title: 'Upload',
  description: 'Upload and publish a Geometry Dash macro on MacroHub.',
};

export default async function UploadPage() {
  const user = await getChatGPTUser();
  return (
    <main className="mx-auto min-h-[75vh] max-w-6xl px-5 py-12 lg:px-8">
      <header className="mb-9 max-w-3xl">
        <p className="text-[10px] font-semibold uppercase tracking-[.2em] text-violet-300">Share a macro</p>
        <h1 className="mt-3 text-4xl font-semibold tracking-[-.045em] sm:text-5xl">Upload once</h1>
        <p className="mt-3 text-sm leading-6 text-zinc-500">Add a macro file, check its details, and publish it to the community.</p>
      </header>
      <UploadWizard signedIn={Boolean(user)} />
    </main>
  );
}
