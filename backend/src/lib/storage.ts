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
  await fs.mkdir(path.dirname(targetPath), { recursive: true });
  await fs.writeFile(targetPath, buffer, { flag: "wx" });
}

export async function deleteListingImageFile(objectKey: string): Promise<void> {
  const targetPath = resolveListingObjectPath(objectKey);

  try {
    await fs.unlink(targetPath);
  } catch (error: unknown) {
    if (typeof error === "object" && error && "code" in error && error.code !== "ENOENT") {
      throw error;
    }
  }
}

export async function deleteListingImageFiles(objectKeys: string[]): Promise<void> {
  await Promise.all(objectKeys.map((objectKey) => deleteListingImageFile(objectKey)));
}

export function getListingImageUrl(objectKey: string): string {
  resolveListingObjectPath(objectKey);
  return `${uploadBaseUrl}/${objectKey}`;
}
