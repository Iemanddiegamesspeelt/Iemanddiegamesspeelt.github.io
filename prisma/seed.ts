import { PrismaClient } from '@prisma/client';
import { PrismaNeon } from '@prisma/adapter-neon';
import {
  formatCompatibilityRegistry,
  formatRegistry,
  replayToolRegistry,
} from '../lib/replay/registry';

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error('DATABASE_URL is required to seed MacroHub');

const prisma = new PrismaClient({ adapter: new PrismaNeon({ connectionString }) });

const formatIds = new Map(
  formatRegistry.map((format, index) => [
    format.id,
    `20000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`,
  ]),
);
const toolIds = new Map(
  replayToolRegistry.map((tool, index) => [
    tool.id,
    `30000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`,
  ]),
);

async function main() {
  for (const format of formatRegistry) {
    await prisma.macroFormat.upsert({
      where: { slug: format.id },
      create: {
        id: formatIds.get(format.id)!,
        slug: format.id,
        name: format.displayName,
        defaultExtension: format.extensions[0],
        mimeTypes: [...format.mediaTypes],
        implementationStatus: format.status.toUpperCase() as 'IMPLEMENTED' | 'PLANNED' | 'DISABLED',
        enabled: format.status === 'implemented',
        sortOrder: formatRegistry.indexOf(format),
        warning: format.status === 'implemented' ? null : format.summary,
      },
      update: {
        name: format.displayName,
        defaultExtension: format.extensions[0],
        mimeTypes: [...format.mediaTypes],
        implementationStatus: format.status.toUpperCase() as 'IMPLEMENTED' | 'PLANNED' | 'DISABLED',
        sortOrder: formatRegistry.indexOf(format),
      },
    });
  }

  for (const tool of replayToolRegistry) {
    await prisma.replayTool.upsert({
      where: { slug: tool.id },
      create: {
        id: toolIds.get(tool.id)!,
        slug: tool.id,
        name: tool.displayName,
        status: tool.status.toUpperCase() as 'ACTIVE' | 'DEPRECATED' | 'PLANNED',
      },
      update: {
        name: tool.displayName,
      },
    });
  }

  for (const compatibility of formatCompatibilityRegistry) {
    const formatId = formatIds.get(compatibility.formatId);
    const replayToolId = toolIds.get(compatibility.replayToolId);
    if (!formatId || !replayToolId) continue;
    const canRead = compatibility.direction === 'import' || compatibility.direction === 'both';
    const canWrite = compatibility.direction === 'export' || compatibility.direction === 'both';
    const supportLevel = compatibility.support === 'native'
      ? 'NATIVE'
      : compatibility.support === 'plugin'
        ? 'COMPATIBLE'
        : 'EXPERIMENTAL';
    await prisma.formatToolCompatibility.upsert({
      where: { formatId_replayToolId: { formatId, replayToolId } },
      create: {
        formatId,
        replayToolId,
        direction: compatibility.direction.toUpperCase() as 'IMPORT' | 'EXPORT' | 'BOTH',
        supportLevel,
        verification: compatibility.verification,
        canRead,
        canWrite,
        recommended: compatibility.recommended ?? false,
        warning: compatibility.notes,
      },
      update: {},
    });
  }

  console.log(`Seeded ${formatRegistry.length} formats and ${replayToolRegistry.length} replay tools. Public catalog: 0 levels, 0 macros.`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
