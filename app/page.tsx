import { HomeContent } from '../components/home/home-content';
import { listLevelRecords, listMacroRecords, listProfileRecords } from '../lib/data/repository';

export default async function Home() {
  const [levels, macros, profiles] = await Promise.all([
    listLevelRecords(),
    listMacroRecords(),
    listProfileRecords(),
  ]);
  return <HomeContent levels={levels} macros={macros} profiles={profiles} />;
}
