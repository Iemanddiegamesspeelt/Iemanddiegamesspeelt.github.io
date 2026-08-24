-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('USER', 'MODERATOR', 'ADMIN');

-- CreateEnum
CREATE TYPE "UserState" AS ENUM ('ACTIVE', 'SUSPENDED', 'BANNED', 'DELETED');

-- CreateEnum
CREATE TYPE "LevelDifficulty" AS ENUM ('AUTO', 'EASY', 'NORMAL', 'HARD', 'HARDER', 'INSANE', 'DEMON', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "DemonDifficulty" AS ENUM ('EASY', 'MEDIUM', 'HARD', 'INSANE', 'EXTREME');

-- CreateEnum
CREATE TYPE "LevelLength" AS ENUM ('TINY', 'SHORT', 'MEDIUM', 'LONG', 'XL', 'PLATFORMER', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "MacroWorkingStatus" AS ENUM ('WORKING', 'UNVERIFIED', 'POSSIBLY_OUTDATED', 'BROKEN', 'REMOVED');

-- CreateEnum
CREATE TYPE "PublicationState" AS ENUM ('DRAFT', 'PUBLISHED', 'HIDDEN', 'REMOVED');

-- CreateEnum
CREATE TYPE "MacroFileKind" AS ENUM ('ORIGINAL', 'GENERATED_CACHE');

-- CreateEnum
CREATE TYPE "FileState" AS ENUM ('PENDING', 'READY', 'QUARANTINED', 'REJECTED', 'DELETED');

-- CreateEnum
CREATE TYPE "FormatImplementationStatus" AS ENUM ('IMPLEMENTED', 'PLANNED', 'DISABLED');

-- CreateEnum
CREATE TYPE "ToolStatus" AS ENUM ('ACTIVE', 'DEPRECATED', 'PLANNED');

-- CreateEnum
CREATE TYPE "CompatibilitySupport" AS ENUM ('NATIVE', 'COMPATIBLE', 'EXPERIMENTAL', 'UNSUPPORTED');

-- CreateEnum
CREATE TYPE "CompatibilityDirection" AS ENUM ('IMPORT', 'EXPORT', 'BOTH');

-- CreateEnum
CREATE TYPE "ConversionQuality" AS ENUM ('LOSSLESS', 'COMPATIBLE', 'OPTIONAL_METADATA_LOSS', 'BLOCKED');

-- CreateEnum
CREATE TYPE "CommentState" AS ENUM ('VISIBLE', 'DELETED', 'REMOVED');

-- CreateEnum
CREATE TYPE "CollectionVisibility" AS ENUM ('PUBLIC', 'UNLISTED', 'PRIVATE');

-- CreateEnum
CREATE TYPE "ReportVerdict" AS ENUM ('WORKING', 'BROKEN', 'OUTDATED', 'MALICIOUS', 'OTHER');

-- CreateEnum
CREATE TYPE "ReportReviewState" AS ENUM ('OPEN', 'REVIEWING', 'RESOLVED', 'DISMISSED');

-- CreateEnum
CREATE TYPE "ModerationActionType" AS ENUM ('REMOVE_MACRO', 'RESTORE_MACRO', 'REMOVE_COMMENT', 'RESTORE_COMMENT', 'BAN_USER', 'UNBAN_USER', 'SET_MACRO_STATUS', 'UPDATE_FORMAT', 'UPDATE_REPLAY_TOOL', 'UPDATE_COMPATIBILITY', 'RESOLVE_REPORT');

-- CreateTable
CREATE TABLE "User" (
    "id" UUID NOT NULL,
    "authProvider" VARCHAR(32) NOT NULL DEFAULT 'chatgpt',
    "authSubject" VARCHAR(191) NOT NULL,
    "email" VARCHAR(320) NOT NULL,
    "emailNormalized" VARCHAR(320) NOT NULL,
    "role" "UserRole" NOT NULL DEFAULT 'USER',
    "state" "UserState" NOT NULL DEFAULT 'ACTIVE',
    "bannedUntil" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    "deletedAt" TIMESTAMPTZ(3),

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Profile" (
    "userId" UUID NOT NULL,
    "username" VARCHAR(32) NOT NULL,
    "usernameNormalized" VARCHAR(32) NOT NULL,
    "displayName" VARCHAR(80),
    "bio" VARCHAR(500),
    "avatarStorageKey" VARCHAR(512),
    "macroCount" INTEGER NOT NULL DEFAULT 0,
    "totalDownloads" INTEGER NOT NULL DEFAULT 0,
    "totalLikes" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Profile_pkey" PRIMARY KEY ("userId")
);

-- CreateTable
CREATE TABLE "Level" (
    "id" UUID NOT NULL,
    "providerKey" VARCHAR(64) NOT NULL DEFAULT 'geometry-dash',
    "externalId" VARCHAR(32) NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "nameNormalized" VARCHAR(120) NOT NULL,
    "creatorName" VARCHAR(80) NOT NULL,
    "creatorNormalized" VARCHAR(80) NOT NULL,
    "difficulty" "LevelDifficulty" NOT NULL DEFAULT 'UNKNOWN',
    "demonDifficulty" "DemonDifficulty",
    "length" "LevelLength" NOT NULL DEFAULT 'UNKNOWN',
    "stars" INTEGER,
    "gdVersion" VARCHAR(32),
    "metadata" JSONB,
    "metadataFetchedAt" TIMESTAMPTZ(3),
    "macroCount" INTEGER NOT NULL DEFAULT 0,
    "totalDownloads" INTEGER NOT NULL DEFAULT 0,
    "isDemo" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Level_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Macro" (
    "id" UUID NOT NULL,
    "levelId" UUID NOT NULL,
    "uploaderId" UUID NOT NULL,
    "originalFormatId" UUID NOT NULL,
    "sourceUploadId" UUID NOT NULL,
    "title" VARCHAR(140) NOT NULL,
    "titleNormalized" VARCHAR(140) NOT NULL,
    "description" VARCHAR(4000),
    "completionBasisPoints" INTEGER,
    "tps" DECIMAL(10,3),
    "fps" DECIMAL(10,3),
    "inputCount" INTEGER NOT NULL,
    "durationMs" INTEGER NOT NULL,
    "player1InputCount" INTEGER NOT NULL,
    "player2InputCount" INTEGER NOT NULL DEFAULT 0,
    "recordedGdVersion" VARCHAR(32),
    "workingStatus" "MacroWorkingStatus" NOT NULL DEFAULT 'UNVERIFIED',
    "publicationState" "PublicationState" NOT NULL DEFAULT 'DRAFT',
    "canonicalHash" CHAR(64) NOT NULL,
    "downloadCount" INTEGER NOT NULL DEFAULT 0,
    "likeCount" INTEGER NOT NULL DEFAULT 0,
    "commentCount" INTEGER NOT NULL DEFAULT 0,
    "publishedAt" TIMESTAMPTZ(3),
    "isDemo" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    "deletedAt" TIMESTAMPTZ(3),

    CONSTRAINT "Macro_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MacroCanonicalReplay" (
    "macroId" UUID NOT NULL,
    "schemaVersion" INTEGER NOT NULL,
    "storageKey" VARCHAR(512) NOT NULL,
    "sha256" CHAR(64) NOT NULL,
    "byteSize" INTEGER NOT NULL,
    "eventCount" INTEGER NOT NULL,
    "extensions" JSONB,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "MacroCanonicalReplay_pkey" PRIMARY KEY ("macroId")
);

-- CreateTable
CREATE TABLE "MacroFile" (
    "id" UUID NOT NULL,
    "macroId" UUID NOT NULL,
    "formatId" UUID NOT NULL,
    "kind" "MacroFileKind" NOT NULL,
    "storageKey" VARCHAR(512) NOT NULL,
    "sha256" CHAR(64) NOT NULL,
    "byteSize" INTEGER NOT NULL,
    "mimeType" VARCHAR(191) NOT NULL,
    "extension" VARCHAR(24) NOT NULL,
    "state" "FileState" NOT NULL DEFAULT 'PENDING',
    "exporterVersion" VARCHAR(64),
    "generationKey" VARCHAR(191),
    "expiresAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "MacroFile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MacroFormat" (
    "id" UUID NOT NULL,
    "slug" VARCHAR(64) NOT NULL,
    "name" VARCHAR(80) NOT NULL,
    "defaultExtension" VARCHAR(24) NOT NULL,
    "mimeTypes" TEXT[],
    "implementationStatus" "FormatImplementationStatus" NOT NULL DEFAULT 'PLANNED',
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "documentationUrl" VARCHAR(512),
    "warning" VARCHAR(500),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "MacroFormat_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReplayTool" (
    "id" UUID NOT NULL,
    "slug" VARCHAR(64) NOT NULL,
    "name" VARCHAR(80) NOT NULL,
    "websiteUrl" VARCHAR(512),
    "iconStorageKey" VARCHAR(512),
    "status" "ToolStatus" NOT NULL DEFAULT 'ACTIVE',
    "currentVersion" VARCHAR(64),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "ReplayTool_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FormatToolCompatibility" (
    "formatId" UUID NOT NULL,
    "replayToolId" UUID NOT NULL,
    "direction" "CompatibilityDirection" NOT NULL DEFAULT 'IMPORT',
    "supportLevel" "CompatibilitySupport" NOT NULL DEFAULT 'COMPATIBLE',
    "verification" VARCHAR(32) NOT NULL DEFAULT 'unknown',
    "canRead" BOOLEAN NOT NULL DEFAULT true,
    "canWrite" BOOLEAN NOT NULL DEFAULT false,
    "recommended" BOOLEAN NOT NULL DEFAULT false,
    "minToolVersion" VARCHAR(64),
    "maxToolVersion" VARCHAR(64),
    "warning" VARCHAR(500),
    "verifiedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "FormatToolCompatibility_pkey" PRIMARY KEY ("formatId","replayToolId")
);

-- CreateTable
CREATE TABLE "MacroConversionCapability" (
    "macroId" UUID NOT NULL,
    "formatId" UUID NOT NULL,
    "quality" "ConversionQuality" NOT NULL,
    "warningCodes" TEXT[],
    "details" JSONB,
    "canonicalHash" CHAR(64) NOT NULL,
    "exporterVersion" VARCHAR(64) NOT NULL,
    "checkedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MacroConversionCapability_pkey" PRIMARY KEY ("macroId","formatId")
);

-- CreateTable
CREATE TABLE "Like" (
    "userId" UUID NOT NULL,
    "macroId" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Like_pkey" PRIMARY KEY ("userId","macroId")
);

-- CreateTable
CREATE TABLE "Comment" (
    "id" UUID NOT NULL,
    "macroId" UUID NOT NULL,
    "authorId" UUID NOT NULL,
    "parentId" UUID,
    "body" VARCHAR(2000) NOT NULL,
    "state" "CommentState" NOT NULL DEFAULT 'VISIBLE',
    "editedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Comment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CommentReport" (
    "id" UUID NOT NULL,
    "commentId" UUID NOT NULL,
    "reporterId" UUID NOT NULL,
    "reason" VARCHAR(80) NOT NULL,
    "details" VARCHAR(1000),
    "state" "ReportReviewState" NOT NULL DEFAULT 'OPEN',
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "CommentReport_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Collection" (
    "id" UUID NOT NULL,
    "ownerId" UUID NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "slugNormalized" VARCHAR(120) NOT NULL,
    "description" VARCHAR(1000),
    "visibility" "CollectionVisibility" NOT NULL DEFAULT 'PUBLIC',
    "macroCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Collection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CollectionMacro" (
    "collectionId" UUID NOT NULL,
    "macroId" UUID NOT NULL,
    "position" INTEGER,
    "note" VARCHAR(500),
    "addedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CollectionMacro_pkey" PRIMARY KEY ("collectionId","macroId")
);

-- CreateTable
CREATE TABLE "MacroReport" (
    "id" UUID NOT NULL,
    "macroId" UUID NOT NULL,
    "reporterId" UUID NOT NULL,
    "verdict" "ReportVerdict" NOT NULL,
    "details" VARCHAR(1000),
    "state" "ReportReviewState" NOT NULL DEFAULT 'OPEN',
    "reviewedById" UUID,
    "reviewedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "MacroReport_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Download" (
    "id" UUID NOT NULL,
    "macroId" UUID NOT NULL,
    "formatId" UUID NOT NULL,
    "userId" UUID,
    "replayToolId" UUID,
    "actorHash" CHAR(64) NOT NULL,
    "dedupeWindowStart" TIMESTAMPTZ(3) NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Download_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ModerationAction" (
    "id" UUID NOT NULL,
    "moderatorId" UUID NOT NULL,
    "action" "ModerationActionType" NOT NULL,
    "reason" VARCHAR(1000) NOT NULL,
    "snapshot" JSONB,
    "targetUserId" UUID,
    "targetMacroId" UUID,
    "targetCommentId" UUID,
    "targetFormatId" UUID,
    "targetToolId" UUID,
    "revertedById" UUID,
    "revertedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ModerationAction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RateLimitBucket" (
    "bucketKey" VARCHAR(191) NOT NULL,
    "windowStart" TIMESTAMPTZ(3) NOT NULL,
    "count" INTEGER NOT NULL DEFAULT 1,
    "expiresAt" TIMESTAMPTZ(3) NOT NULL,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "RateLimitBucket_pkey" PRIMARY KEY ("bucketKey", "windowStart")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_emailNormalized_key" ON "User"("emailNormalized");

-- CreateIndex
CREATE INDEX "User_role_state_idx" ON "User"("role", "state");

-- CreateIndex
CREATE INDEX "User_createdAt_idx" ON "User"("createdAt" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "User_authProvider_authSubject_key" ON "User"("authProvider", "authSubject");

-- CreateIndex
CREATE UNIQUE INDEX "Profile_usernameNormalized_key" ON "Profile"("usernameNormalized");

-- CreateIndex
CREATE INDEX "Profile_totalDownloads_idx" ON "Profile"("totalDownloads" DESC);

-- CreateIndex
CREATE INDEX "Profile_totalLikes_idx" ON "Profile"("totalLikes" DESC);

-- CreateIndex
CREATE INDEX "Level_nameNormalized_idx" ON "Level"("nameNormalized");

-- CreateIndex
CREATE INDEX "Level_creatorNormalized_idx" ON "Level"("creatorNormalized");

-- CreateIndex
CREATE INDEX "Level_difficulty_demonDifficulty_length_gdVersion_idx" ON "Level"("difficulty", "demonDifficulty", "length", "gdVersion");

-- CreateIndex
CREATE INDEX "Level_totalDownloads_idx" ON "Level"("totalDownloads" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "Level_providerKey_externalId_key" ON "Level"("providerKey", "externalId");

-- CreateIndex
CREATE INDEX "Macro_levelId_publicationState_publishedAt_idx" ON "Macro"("levelId", "publicationState", "publishedAt" DESC);

-- CreateIndex
CREATE INDEX "Macro_publicationState_workingStatus_downloadCount_idx" ON "Macro"("publicationState", "workingStatus", "downloadCount" DESC);

-- CreateIndex
CREATE INDEX "Macro_publicationState_likeCount_idx" ON "Macro"("publicationState", "likeCount" DESC);

-- CreateIndex
CREATE INDEX "Macro_uploaderId_publicationState_publishedAt_idx" ON "Macro"("uploaderId", "publicationState", "publishedAt" DESC);

-- CreateIndex
CREATE INDEX "Macro_originalFormatId_publicationState_idx" ON "Macro"("originalFormatId", "publicationState");

-- CreateIndex
CREATE UNIQUE INDEX "Macro_sourceUploadId_key" ON "Macro"("sourceUploadId");

-- CreateIndex
CREATE INDEX "Macro_canonicalHash_idx" ON "Macro"("canonicalHash");

-- CreateIndex
CREATE INDEX "Macro_titleNormalized_idx" ON "Macro"("titleNormalized");

-- CreateIndex
CREATE UNIQUE INDEX "MacroCanonicalReplay_storageKey_key" ON "MacroCanonicalReplay"("storageKey");

-- CreateIndex
CREATE UNIQUE INDEX "MacroFile_storageKey_key" ON "MacroFile"("storageKey");

-- CreateIndex
CREATE UNIQUE INDEX "MacroFile_generationKey_key" ON "MacroFile"("generationKey");

-- CreateIndex
CREATE INDEX "MacroFile_macroId_kind_state_idx" ON "MacroFile"("macroId", "kind", "state");

-- CreateIndex
CREATE INDEX "MacroFile_formatId_state_idx" ON "MacroFile"("formatId", "state");

-- CreateIndex
CREATE INDEX "MacroFile_expiresAt_idx" ON "MacroFile"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "MacroFormat_slug_key" ON "MacroFormat"("slug");

-- CreateIndex
CREATE INDEX "MacroFormat_enabled_sortOrder_idx" ON "MacroFormat"("enabled", "sortOrder");

-- CreateIndex
CREATE UNIQUE INDEX "ReplayTool_slug_key" ON "ReplayTool"("slug");

-- CreateIndex
CREATE INDEX "ReplayTool_status_name_idx" ON "ReplayTool"("status", "name");

-- CreateIndex
CREATE INDEX "FormatToolCompatibility_replayToolId_canRead_supportLevel_f_idx" ON "FormatToolCompatibility"("replayToolId", "canRead", "supportLevel", "formatId");

-- CreateIndex
CREATE INDEX "MacroConversionCapability_formatId_quality_macroId_idx" ON "MacroConversionCapability"("formatId", "quality", "macroId");

-- CreateIndex
CREATE INDEX "Like_macroId_createdAt_idx" ON "Like"("macroId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "Comment_macroId_state_createdAt_idx" ON "Comment"("macroId", "state", "createdAt");

-- CreateIndex
CREATE INDEX "Comment_authorId_createdAt_idx" ON "Comment"("authorId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "Comment_parentId_idx" ON "Comment"("parentId");

-- CreateIndex
CREATE INDEX "CommentReport_state_createdAt_idx" ON "CommentReport"("state", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "CommentReport_commentId_reporterId_key" ON "CommentReport"("commentId", "reporterId");

-- CreateIndex
CREATE INDEX "Collection_visibility_updatedAt_idx" ON "Collection"("visibility", "updatedAt" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "Collection_ownerId_slugNormalized_key" ON "Collection"("ownerId", "slugNormalized");

-- CreateIndex
CREATE INDEX "CollectionMacro_macroId_idx" ON "CollectionMacro"("macroId");

-- CreateIndex
CREATE INDEX "CollectionMacro_collectionId_position_idx" ON "CollectionMacro"("collectionId", "position");

-- CreateIndex
CREATE INDEX "MacroReport_state_createdAt_idx" ON "MacroReport"("state", "createdAt");

-- CreateIndex
CREATE INDEX "MacroReport_reviewedById_idx" ON "MacroReport"("reviewedById");

-- CreateIndex
CREATE UNIQUE INDEX "MacroReport_macroId_reporterId_key" ON "MacroReport"("macroId", "reporterId");

-- CreateIndex
CREATE INDEX "Download_macroId_createdAt_idx" ON "Download"("macroId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "Download_formatId_createdAt_idx" ON "Download"("formatId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "Download_userId_createdAt_idx" ON "Download"("userId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "Download_replayToolId_idx" ON "Download"("replayToolId");

-- CreateIndex
CREATE UNIQUE INDEX "Download_macroId_formatId_actorHash_dedupeWindowStart_key" ON "Download"("macroId", "formatId", "actorHash", "dedupeWindowStart");

-- CreateIndex
CREATE INDEX "ModerationAction_moderatorId_createdAt_idx" ON "ModerationAction"("moderatorId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "ModerationAction_targetUserId_idx" ON "ModerationAction"("targetUserId");

-- CreateIndex
CREATE INDEX "ModerationAction_targetMacroId_idx" ON "ModerationAction"("targetMacroId");

-- CreateIndex
CREATE INDEX "ModerationAction_targetCommentId_idx" ON "ModerationAction"("targetCommentId");

-- CreateIndex
CREATE INDEX "ModerationAction_targetFormatId_idx" ON "ModerationAction"("targetFormatId");

-- CreateIndex
CREATE INDEX "ModerationAction_targetToolId_idx" ON "ModerationAction"("targetToolId");

-- CreateIndex
CREATE INDEX "RateLimitBucket_expiresAt_idx" ON "RateLimitBucket"("expiresAt");

-- AddForeignKey
ALTER TABLE "Profile" ADD CONSTRAINT "Profile_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Macro" ADD CONSTRAINT "Macro_levelId_fkey" FOREIGN KEY ("levelId") REFERENCES "Level"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Macro" ADD CONSTRAINT "Macro_uploaderId_fkey" FOREIGN KEY ("uploaderId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Macro" ADD CONSTRAINT "Macro_originalFormatId_fkey" FOREIGN KEY ("originalFormatId") REFERENCES "MacroFormat"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MacroCanonicalReplay" ADD CONSTRAINT "MacroCanonicalReplay_macroId_fkey" FOREIGN KEY ("macroId") REFERENCES "Macro"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MacroFile" ADD CONSTRAINT "MacroFile_macroId_fkey" FOREIGN KEY ("macroId") REFERENCES "Macro"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MacroFile" ADD CONSTRAINT "MacroFile_formatId_fkey" FOREIGN KEY ("formatId") REFERENCES "MacroFormat"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FormatToolCompatibility" ADD CONSTRAINT "FormatToolCompatibility_formatId_fkey" FOREIGN KEY ("formatId") REFERENCES "MacroFormat"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FormatToolCompatibility" ADD CONSTRAINT "FormatToolCompatibility_replayToolId_fkey" FOREIGN KEY ("replayToolId") REFERENCES "ReplayTool"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MacroConversionCapability" ADD CONSTRAINT "MacroConversionCapability_macroId_fkey" FOREIGN KEY ("macroId") REFERENCES "Macro"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MacroConversionCapability" ADD CONSTRAINT "MacroConversionCapability_formatId_fkey" FOREIGN KEY ("formatId") REFERENCES "MacroFormat"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Like" ADD CONSTRAINT "Like_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Like" ADD CONSTRAINT "Like_macroId_fkey" FOREIGN KEY ("macroId") REFERENCES "Macro"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Comment" ADD CONSTRAINT "Comment_macroId_fkey" FOREIGN KEY ("macroId") REFERENCES "Macro"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Comment" ADD CONSTRAINT "Comment_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Comment" ADD CONSTRAINT "Comment_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "Comment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommentReport" ADD CONSTRAINT "CommentReport_commentId_fkey" FOREIGN KEY ("commentId") REFERENCES "Comment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommentReport" ADD CONSTRAINT "CommentReport_reporterId_fkey" FOREIGN KEY ("reporterId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Collection" ADD CONSTRAINT "Collection_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CollectionMacro" ADD CONSTRAINT "CollectionMacro_collectionId_fkey" FOREIGN KEY ("collectionId") REFERENCES "Collection"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CollectionMacro" ADD CONSTRAINT "CollectionMacro_macroId_fkey" FOREIGN KEY ("macroId") REFERENCES "Macro"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MacroReport" ADD CONSTRAINT "MacroReport_macroId_fkey" FOREIGN KEY ("macroId") REFERENCES "Macro"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MacroReport" ADD CONSTRAINT "MacroReport_reporterId_fkey" FOREIGN KEY ("reporterId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MacroReport" ADD CONSTRAINT "MacroReport_reviewedById_fkey" FOREIGN KEY ("reviewedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Download" ADD CONSTRAINT "Download_macroId_fkey" FOREIGN KEY ("macroId") REFERENCES "Macro"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Download" ADD CONSTRAINT "Download_formatId_fkey" FOREIGN KEY ("formatId") REFERENCES "MacroFormat"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Download" ADD CONSTRAINT "Download_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Download" ADD CONSTRAINT "Download_replayToolId_fkey" FOREIGN KEY ("replayToolId") REFERENCES "ReplayTool"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ModerationAction" ADD CONSTRAINT "ModerationAction_moderatorId_fkey" FOREIGN KEY ("moderatorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ModerationAction" ADD CONSTRAINT "ModerationAction_targetUserId_fkey" FOREIGN KEY ("targetUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ModerationAction" ADD CONSTRAINT "ModerationAction_targetMacroId_fkey" FOREIGN KEY ("targetMacroId") REFERENCES "Macro"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ModerationAction" ADD CONSTRAINT "ModerationAction_targetCommentId_fkey" FOREIGN KEY ("targetCommentId") REFERENCES "Comment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ModerationAction" ADD CONSTRAINT "ModerationAction_targetFormatId_fkey" FOREIGN KEY ("targetFormatId") REFERENCES "MacroFormat"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ModerationAction" ADD CONSTRAINT "ModerationAction_targetToolId_fkey" FOREIGN KEY ("targetToolId") REFERENCES "ReplayTool"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ModerationAction" ADD CONSTRAINT "ModerationAction_revertedById_fkey" FOREIGN KEY ("revertedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- Production invariants that Prisma cannot express directly.
ALTER TABLE "Level"
  ADD CONSTRAINT "Level_stars_check" CHECK ("stars" IS NULL OR ("stars" >= 0 AND "stars" <= 10)),
  ADD CONSTRAINT "Level_counts_check" CHECK ("macroCount" >= 0 AND "totalDownloads" >= 0);

ALTER TABLE "Macro"
  ADD CONSTRAINT "Macro_completion_check" CHECK ("completionBasisPoints" BETWEEN 0 AND 10000),
  ADD CONSTRAINT "Macro_rate_check" CHECK (("tps" IS NULL OR "tps" > 0) AND ("fps" IS NULL OR "fps" > 0)),
  ADD CONSTRAINT "Macro_counts_check" CHECK (
    "inputCount" >= 0 AND "durationMs" >= 0 AND
    "player1InputCount" >= 0 AND "player2InputCount" >= 0 AND
    "downloadCount" >= 0 AND "likeCount" >= 0 AND "commentCount" >= 0
  ),
  ADD CONSTRAINT "Macro_player_inputs_check" CHECK ("player1InputCount" + "player2InputCount" <= "inputCount");

ALTER TABLE "MacroCanonicalReplay"
  ADD CONSTRAINT "MacroCanonicalReplay_sizes_check" CHECK ("byteSize" >= 0 AND "eventCount" >= 0);

ALTER TABLE "MacroFile"
  ADD CONSTRAINT "MacroFile_byte_size_check" CHECK ("byteSize" >= 0);

ALTER TABLE "Collection"
  ADD CONSTRAINT "Collection_macro_count_check" CHECK ("macroCount" >= 0);

ALTER TABLE "ModerationAction"
  ADD CONSTRAINT "ModerationAction_has_target_check" CHECK (
    (
      "action" IN ('REMOVE_MACRO', 'RESTORE_MACRO', 'SET_MACRO_STATUS', 'RESOLVE_REPORT') AND
      "targetMacroId" IS NOT NULL AND
      num_nonnulls("targetUserId", "targetMacroId", "targetCommentId", "targetFormatId", "targetToolId") = 1
    ) OR (
      "action" IN ('REMOVE_COMMENT', 'RESTORE_COMMENT') AND
      "targetCommentId" IS NOT NULL AND
      num_nonnulls("targetUserId", "targetMacroId", "targetCommentId", "targetFormatId", "targetToolId") = 1
    ) OR (
      "action" IN ('BAN_USER', 'UNBAN_USER') AND
      "targetUserId" IS NOT NULL AND
      num_nonnulls("targetUserId", "targetMacroId", "targetCommentId", "targetFormatId", "targetToolId") = 1
    ) OR (
      "action" = 'UPDATE_FORMAT' AND "targetFormatId" IS NOT NULL AND
      num_nonnulls("targetUserId", "targetMacroId", "targetCommentId", "targetFormatId", "targetToolId") = 1
    ) OR (
      "action" = 'UPDATE_REPLAY_TOOL' AND "targetToolId" IS NOT NULL AND
      num_nonnulls("targetUserId", "targetMacroId", "targetCommentId", "targetFormatId", "targetToolId") = 1
    ) OR (
      "action" = 'UPDATE_COMPATIBILITY' AND
      "targetFormatId" IS NOT NULL AND "targetToolId" IS NOT NULL AND
      num_nonnulls("targetUserId", "targetMacroId", "targetCommentId", "targetFormatId", "targetToolId") = 2
    )
  );

CREATE UNIQUE INDEX "MacroFile_one_original_per_macro"
  ON "MacroFile" ("macroId")
  WHERE "kind" = 'ORIGINAL' AND "state" <> 'DELETED';

CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE INDEX "Level_name_trgm_idx" ON "Level" USING GIN ("nameNormalized" gin_trgm_ops);
CREATE INDEX "Level_creator_trgm_idx" ON "Level" USING GIN ("creatorNormalized" gin_trgm_ops);
CREATE INDEX "Macro_title_trgm_idx" ON "Macro" USING GIN ("titleNormalized" gin_trgm_ops);
CREATE INDEX "Profile_username_trgm_idx" ON "Profile" USING GIN ("usernameNormalized" gin_trgm_ops);

ALTER TABLE "FormatToolCompatibility"
  ADD CONSTRAINT "FormatToolCompatibility_direction_check" CHECK (
    ("supportLevel" = 'UNSUPPORTED' AND NOT "canRead" AND NOT "canWrite") OR
    ("supportLevel" <> 'UNSUPPORTED' AND (
      ("direction" = 'IMPORT' AND "canRead" AND NOT "canWrite") OR
      ("direction" = 'EXPORT' AND NOT "canRead" AND "canWrite") OR
      ("direction" = 'BOTH' AND "canRead" AND "canWrite")
    ))
  );

ALTER TABLE "Macro"
  ADD CONSTRAINT "Macro_published_at_check" CHECK (
    "publicationState" <> 'PUBLISHED' OR "publishedAt" IS NOT NULL
  );

CREATE OR REPLACE FUNCTION macrohub_validate_comment_parent() RETURNS trigger AS $$
BEGIN
  IF NEW."parentId" IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM "Comment" parent
    WHERE parent."id" = NEW."parentId"
      AND parent."macroId" = NEW."macroId"
      AND parent."parentId" IS NULL
  ) THEN
    RAISE EXCEPTION 'Comment parent must be a top-level comment on the same macro';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "Comment_parent_macro_check"
  BEFORE INSERT OR UPDATE OF "parentId", "macroId" ON "Comment"
  FOR EACH ROW EXECUTE FUNCTION macrohub_validate_comment_parent();

CREATE OR REPLACE FUNCTION macrohub_assert_published_macro_assets(macro_id UUID) RETURNS void AS $$
DECLARE
  published_macro "Macro"%ROWTYPE;
BEGIN
  SELECT * INTO published_macro FROM "Macro"
  WHERE "id" = macro_id AND "publicationState" = 'PUBLISHED';
  IF FOUND THEN
    IF NOT EXISTS (
      SELECT 1 FROM "MacroCanonicalReplay" replay
      WHERE replay."macroId" = published_macro."id"
        AND replay."sha256" = published_macro."canonicalHash"
    ) THEN
      RAISE EXCEPTION 'Published macro requires a canonical replay';
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM "MacroFile" file
      WHERE file."macroId" = published_macro."id"
        AND file."kind" = 'ORIGINAL'
        AND file."state" = 'READY'
        AND file."formatId" = published_macro."originalFormatId"
    ) THEN
      RAISE EXCEPTION 'Published macro requires a ready original file matching originalFormatId';
    END IF;
  END IF;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION macrohub_validate_published_macro() RETURNS trigger AS $$
BEGIN
  PERFORM macrohub_assert_published_macro_assets(NEW."id");
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE CONSTRAINT TRIGGER "Macro_published_assets_check"
  AFTER INSERT OR UPDATE OF "publicationState", "originalFormatId", "canonicalHash" ON "Macro"
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION macrohub_validate_published_macro();

CREATE OR REPLACE FUNCTION macrohub_validate_published_child_assets() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    PERFORM macrohub_assert_published_macro_assets(NEW."macroId");
  ELSIF TG_OP = 'UPDATE' THEN
    PERFORM macrohub_assert_published_macro_assets(OLD."macroId");
    IF NEW."macroId" IS DISTINCT FROM OLD."macroId" THEN
      PERFORM macrohub_assert_published_macro_assets(NEW."macroId");
    END IF;
  ELSE
    PERFORM macrohub_assert_published_macro_assets(OLD."macroId");
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE CONSTRAINT TRIGGER "MacroCanonicalReplay_parent_assets_check"
  AFTER INSERT OR UPDATE OR DELETE ON "MacroCanonicalReplay"
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION macrohub_validate_published_child_assets();

CREATE CONSTRAINT TRIGGER "MacroFile_parent_assets_check"
  AFTER INSERT OR UPDATE OR DELETE ON "MacroFile"
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION macrohub_validate_published_child_assets();
