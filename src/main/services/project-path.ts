import { realpath } from "node:fs/promises";
import path from "node:path";

export async function resolveExistingProjectPath(
  projectDirectory: string,
  relativePath: string,
): Promise<string> {
  const realProjectDirectory = await realpath(projectDirectory);
  const candidate = await realpath(path.resolve(projectDirectory, relativePath));
  const allowedPrefix = `${realProjectDirectory}${path.sep}`;
  if (candidate !== realProjectDirectory && !candidate.startsWith(allowedPrefix)) {
    throw new Error("A project-relative file resolves outside its project directory.");
  }
  return candidate;
}
