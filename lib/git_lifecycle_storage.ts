import {
  lstat,
  link,
  mkdir,
  readFile,
  unlink,
  writeFile,
} from "node:fs/promises";
import { isAbsolute, join, relative, sep } from "node:path";
import { randomUUID } from "node:crypto";

export class GitLifecycleStorageError extends Error {
  readonly code:
    | "INVALID_STORAGE_COMPONENT"
    | "STORAGE_FAILED"
    | "RECORD_NOT_FOUND"
    | "INVALID_RECORD_STORAGE";

  constructor(code: GitLifecycleStorageError["code"], message: string) {
    super(message);
    this.name = "GitLifecycleStorageError";
    this.code = code;
  }
}

export type PersistPrivateJsonRecordInput = {
  storage_root: string;
  project_key: string;
  proposal_id: string;
  record: unknown;
};

export type ReadPrivateJsonRecordInput = {
  storage_root: string;
  project_key: string;
  proposal_id: string;
  maximum_bytes?: number;
};

export type LoadedPrivateJsonRecord = {
  value: unknown;
  text: string;
  record_path: string;
};

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isNodeError(error: unknown, code: string): boolean {
  return (
    error instanceof Error &&
    "code" in error &&
    (error as NodeJS.ErrnoException).code === code
  );
}

function validateStorageComponent(value: string, label: string): void {
  if (
    value.length === 0 ||
    value === "." ||
    value === ".." ||
    !/^[A-Za-z0-9._-]+$/.test(value)
  ) {
    throw new GitLifecycleStorageError(
      "INVALID_STORAGE_COMPONENT",
      `${label} is not a safe storage path component`,
    );
  }
}

function isPrivateDirectoryMode(mode: number): boolean {
  return (mode & 0o077) === 0;
}

function isPrivateFileMode(mode: number): boolean {
  return (mode & 0o177) === 0;
}

async function inspectPrivateDirectory(directory: string): Promise<void> {
  const status = await lstat(directory);

  if (
    status.isSymbolicLink() ||
    !status.isDirectory() ||
    !isPrivateDirectoryMode(status.mode)
  ) {
    throw new GitLifecycleStorageError(
      "INVALID_RECORD_STORAGE",
      "Git lifecycle proposal storage contains an unsafe directory",
    );
  }
}

async function ensurePrivateDirectory(
  directory: string,
  storageRoot: string,
): Promise<void> {
  const relativePath = relative(storageRoot, directory);

  if (
    !isAbsolute(storageRoot) ||
    relativePath === ".." ||
    relativePath.startsWith(`..${sep}`) ||
    isAbsolute(relativePath)
  ) {
    throw new GitLifecycleStorageError(
      "INVALID_RECORD_STORAGE",
      "Git lifecycle proposal path escapes its state root",
    );
  }

  await mkdir(storageRoot, {
    recursive: true,
    mode: 0o700,
  });

  await inspectPrivateDirectory(storageRoot);

  if (relativePath === "") {
    return;
  }

  let current = storageRoot;

  for (const segment of relativePath.split(sep)) {
    current = join(current, segment);

    try {
      await mkdir(current, {
        mode: 0o700,
      });
    } catch (error) {
      if (!isNodeError(error, "EEXIST")) {
        throw error;
      }
    }

    await inspectPrivateDirectory(current);
  }
}

export async function persistPrivateJsonRecord(
  input: PersistPrivateJsonRecordInput,
): Promise<string> {
  validateStorageComponent(input.project_key, "Project key");
  validateStorageComponent(input.proposal_id, "Proposal identifier");

  const projectDirectory = join(input.storage_root, input.project_key);
  const finalPath = join(projectDirectory, `${input.proposal_id}.json`);
  const temporaryPath = join(
    projectDirectory,
    `.${input.proposal_id}.${randomUUID()}.tmp`,
  );
  const serialized = `${JSON.stringify(input.record, null, 2)}\n`;

  try {
    await ensurePrivateDirectory(projectDirectory, input.storage_root);

    await writeFile(temporaryPath, serialized, {
      encoding: "utf8",
      mode: 0o600,
      flag: "wx",
    });

    await link(temporaryPath, finalPath);
    await unlink(temporaryPath);

    return finalPath;
  } catch (error) {
    try {
      await unlink(temporaryPath);
    } catch {
      // Best-effort cleanup only.
    }

    if (error instanceof GitLifecycleStorageError) {
      throw error;
    }

    if (isNodeError(error, "EEXIST")) {
      throw new GitLifecycleStorageError(
        "STORAGE_FAILED",
        "Git lifecycle proposal already exists",
      );
    }

    throw new GitLifecycleStorageError(
      "STORAGE_FAILED",
      `Unable to persist Git lifecycle proposal: ${errorMessage(error)}`,
    );
  }
}

export async function readPrivateJsonRecord(
  input: ReadPrivateJsonRecordInput,
): Promise<LoadedPrivateJsonRecord> {
  validateStorageComponent(input.project_key, "Project key");
  validateStorageComponent(input.proposal_id, "Proposal identifier");

  if (!isAbsolute(input.storage_root)) {
    throw new GitLifecycleStorageError(
      "INVALID_RECORD_STORAGE",
      "Git lifecycle proposal state root must be absolute",
    );
  }

  const projectDirectory = join(input.storage_root, input.project_key);
  const recordPath = join(projectDirectory, `${input.proposal_id}.json`);

  let rootStatus;
  let projectStatus;
  let recordStatus;

  try {
    [rootStatus, projectStatus, recordStatus] = await Promise.all([
      lstat(input.storage_root),
      lstat(projectDirectory),
      lstat(recordPath),
    ]);
  } catch (error) {
    if (isNodeError(error, "ENOENT")) {
      throw new GitLifecycleStorageError(
        "RECORD_NOT_FOUND",
        "Git lifecycle proposal was not found for the current project",
      );
    }

    throw new GitLifecycleStorageError(
      "INVALID_RECORD_STORAGE",
      `Could not inspect Git lifecycle proposal storage: ${errorMessage(error)}`,
    );
  }

  if (
    rootStatus.isSymbolicLink() ||
    !rootStatus.isDirectory() ||
    !isPrivateDirectoryMode(rootStatus.mode) ||
    projectStatus.isSymbolicLink() ||
    !projectStatus.isDirectory() ||
    !isPrivateDirectoryMode(projectStatus.mode) ||
    recordStatus.isSymbolicLink() ||
    !recordStatus.isFile() ||
    !isPrivateFileMode(recordStatus.mode)
  ) {
    throw new GitLifecycleStorageError(
      "INVALID_RECORD_STORAGE",
      "Git lifecycle proposal storage contains an unsafe path component",
    );
  }

  const maximumBytes = input.maximum_bytes ?? 1024 * 1024;

  if (
    !Number.isSafeInteger(maximumBytes) ||
    maximumBytes <= 0 ||
    recordStatus.size > maximumBytes
  ) {
    throw new GitLifecycleStorageError(
      "INVALID_RECORD_STORAGE",
      "Git lifecycle proposal record has an invalid size",
    );
  }

  let text: string;

  try {
    const bytes = await readFile(recordPath);

    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch (error) {
    throw new GitLifecycleStorageError(
      "INVALID_RECORD_STORAGE",
      `Could not read Git lifecycle proposal: ${errorMessage(error)}`,
    );
  }

  let value: unknown;

  try {
    value = JSON.parse(text);
  } catch (error) {
    throw new GitLifecycleStorageError(
      "INVALID_RECORD_STORAGE",
      `Git lifecycle proposal is not valid JSON: ${errorMessage(error)}`,
    );
  }

  return {
    value,
    text,
    record_path: recordPath,
  };
}
