import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { env } from "../config/env.js";

export const MAX_LISTING_IMAGE_BYTES = 5 * 1024 * 1024;
export const MAX_LISTING_IMAGES_PER_LISTING = 8;
export const ALLOWED_LISTING_IMAGE_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
]);

const uploadRoot = path.resolve(process.cwd(), env.UPLOAD_ROOT);
const uploadBaseUrl = (env.UPLOAD_BASE_URL ?? `${env.APP_URL.replace(/\/$/, "")}/uploads`).replace(/\/$/, "");
const listingObjectKeyPattern =
  /^listings\/[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\/[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.(?:jpg|png|webp)$/i;

class UploadPathOutsideRootError extends Error {}

function mimeToExtension(mimeType: string): string {
  switch (mimeType.toLowerCase()) {
    case "image/jpeg":
      return ".jpg";
    case "image/png":
      return ".png";
    case "image/webp":
      return ".webp";
    default:
      throw new Error("Unsupported listing image MIME type.");
  }
}

export function getUploadRootPath(): string {
  return uploadRoot;
}

function resolveListingObjectPath(objectKey: string): string {
  if (!listingObjectKeyPattern.test(objectKey)) {
    throw new Error("Invalid listing image object key.");
  }

  const targetPath = path.resolve(uploadRoot, ...objectKey.split("/"));
  const relativePath = path.relative(uploadRoot, targetPath);
  if (
    relativePath === "" ||
    relativePath === ".." ||
    relativePath.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relativePath)
  ) {
    throw new Error("Listing image object key is outside the upload directory.");
  }

  return targetPath;
}

async function resolveRealPathWithinUploadRoot(targetPath: string): Promise<string> {
  const [rootRealPath, targetRealPath] = await Promise.all([
    fs.realpath(uploadRoot),
    fs.realpath(targetPath),
  ]);
  const relativePath = path.relative(rootRealPath, targetRealPath);
  if (
    relativePath === "" ||
    relativePath === ".." ||
    relativePath.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relativePath)
  ) {
    throw new UploadPathOutsideRootError("Listing image path is outside the upload directory.");
  }
  return targetRealPath;
}

const IMAGE_MIME_TYPES: Record<string, string> = {
  ".jpg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
};

/** Resolve only generated listing-image keys, and ensure symlinks cannot escape the upload root. */
export async function getListingImageFile(objectKey: string): Promise<{
  filePath: string;
  mimeType: string;
} | null> {
  let targetPath: string;
  try {
    targetPath = resolveListingObjectPath(objectKey);
  } catch {
    return null;
  }

  try {
    const [targetStat, targetRealPath] = await Promise.all([
      fs.lstat(targetPath),
      resolveRealPathWithinUploadRoot(targetPath),
    ]);
    if (!targetStat.isFile()) {
      return null;
    }

    const mimeType = IMAGE_MIME_TYPES[path.extname(objectKey).toLowerCase()];
    return mimeType ? { filePath: targetRealPath, mimeType } : null;
  } catch (error: unknown) {
    if (error instanceof UploadPathOutsideRootError) {
      return null;
    }
    if (typeof error === "object" && error && "code" in error && error.code === "ENOENT") {
      return null;
    }
    throw error;
  }
}

export function createListingObjectKey(listingId: string, mimeType: string): string {
  const normalizedMimeType = mimeType.toLowerCase();
  if (!ALLOWED_LISTING_IMAGE_TYPES.has(normalizedMimeType)) {
    throw new Error("Unsupported listing image MIME type.");
  }

  const objectKey = path.posix.join(
    "listings",
    listingId,
    `${randomUUID()}${mimeToExtension(normalizedMimeType)}`,
  );
  resolveListingObjectPath(objectKey);
  return objectKey;
}

export async function writeListingImageFile(objectKey: string, buffer: Buffer): Promise<void> {
  const targetPath = resolveListingObjectPath(objectKey);
  const targetDirectory = path.dirname(targetPath);
  await fs.mkdir(targetDirectory, { recursive: true });
  const realTargetDirectory = await resolveRealPathWithinUploadRoot(targetDirectory);
  await fs.writeFile(path.join(realTargetDirectory, path.basename(targetPath)), buffer, { flag: "wx" });
}

export async function deleteListingImageFile(objectKey: string): Promise<void> {
  const targetPath = resolveListingObjectPath(objectKey);

  try {
    const realTargetPath = await resolveRealPathWithinUploadRoot(targetPath);
    await fs.unlink(realTargetPath);
  } catch (error: unknown) {
    if (!(typeof error === "object" && error && "code" in error && error.code === "ENOENT")) throw error;
  }
}

export async function deleteListingImageFiles(objectKeys: string[]): Promise<void> {
  await Promise.all(objectKeys.map((objectKey) => deleteListingImageFile(objectKey)));
}

export function getListingImageUrl(objectKey: string): string {
  resolveListingObjectPath(objectKey);
  return `${uploadBaseUrl}/${objectKey}`;
}
