/**
 * Workspace-level index.json — fast project list.
 *
 * Kept in sync by create/update/delete operations in `projects.ts`.
 * Stored as:
 *   { version: "1.0", updatedAt: number, projects: [{id, name, updatedAt}] }
 */

import { createLogger } from '@/shared/logging/logger'
import { INDEX_FILENAME } from './paths'
import { readJson, writeJsonAtomic, WorkspaceFileCorruptError } from './fs-primitives'

const INDEX_VERSION = '1.0'

const logger = createLogger('WorkspaceFS:Index')

export interface WorkspaceIndexEntry {
  id: string
  name: string
  updatedAt: number
}

export interface WorkspaceIndex {
  version: string
  updatedAt: number
  projects: WorkspaceIndexEntry[]
}

export async function readWorkspaceIndex(root: FileSystemDirectoryHandle): Promise<WorkspaceIndex> {
  let existing: WorkspaceIndex | null = null
  try {
    existing = await readJson<WorkspaceIndex>(root, [INDEX_FILENAME])
  } catch (error) {
    if (!(error instanceof WorkspaceFileCorruptError)) throw error
    logger.warn('index.json is corrupt — falling back to empty index', error)
  }
  if (existing) return existing
  return { version: INDEX_VERSION, updatedAt: 0, projects: [] }
}

export async function writeWorkspaceIndex(
  root: FileSystemDirectoryHandle,
  entries: WorkspaceIndexEntry[],
): Promise<void> {
  const sorted = [...entries].sort((a, b) => b.updatedAt - a.updatedAt)
  const index: WorkspaceIndex = {
    version: INDEX_VERSION,
    updatedAt: Date.now(),
    projects: sorted,
  }
  await writeJsonAtomic(root, [INDEX_FILENAME], index)
}
