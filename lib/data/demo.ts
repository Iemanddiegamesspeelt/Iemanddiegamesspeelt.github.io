import type { CollectionRecord, CommentRecord, LevelRecord, MacroRecord, ProfileRecord } from './types';

// MacroHub deliberately starts with an empty public catalog.
// The seed command creates registries and schema-ready infrastructure, not fabricated community activity.
export const profiles: ProfileRecord[] = [];
export const levels: LevelRecord[] = [];
export const macros: MacroRecord[] = [];
export const comments: CommentRecord[] = [];
export const collections: CollectionRecord[] = [];

export function getLevel(levelId: string) {
  return levels.find((level) => level.id === levelId);
}

export function getMacro(macroId: string) {
  return macros.find((macro) => macro.id === macroId);
}

export function getProfileById(profileId: string) {
  return profiles.find((profile) => profile.id === profileId);
}

export function getProfile(username: string) {
  return profiles.find((profile) => profile.username.toLowerCase() === username.toLowerCase());
}

export function getMacrosForLevel(levelId: string) {
  return macros.filter((macro) => macro.levelId === levelId);
}

export function getMacrosForProfile(profileId: string) {
  return macros.filter((macro) => macro.uploaderId === profileId);
}

export function getCollection(collectionId: string) {
  return collections.find((collection) => collection.id === collectionId);
}

