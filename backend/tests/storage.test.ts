import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test, { after } from "node:test";
import sharp from "sharp";

import "../scripts/test-database.js";

process.env.EMAIL_PROVIDER = "resend";
process.env.RESEND_API_KEY = "test-key";
process.env.EMAIL_FROM ??= "noreply@campus-marketplace.test";
process.env.APP_URL ??= "http://localhost:3000";
process.env.CORS_ORIGIN ??= "http://localhost:5173";

const uploadRoot = await mkdtemp(path.join(os.tmpdir(), "mut-market-storage-"));
const frontendRoot = await mkdtemp(path.join(os.tmpdir(), "mut-market-frontend-"));
process.env.UPLOAD_ROOT = uploadRoot;
await writeFile(path.join(frontendRoot, "index.html"), "<!doctype html><html><body>MUT Market app</body></html>");

const {
  createListingObjectKey,
  deleteListingImageFile,
  getListingImageFile,
  getListingImageUrl,
  getUploadRootPath,
  writeListingImageFile,
} = await import("../src/lib/storage.js");
const { buildApp } = await import("../src/app/app.js");
const app = buildApp({ frontendDistPath: frontendRoot });

const listingId = "6d155ee0-f7f6-45b7-b9e4-582c26ac4f41";

after(async () => {
  await app.close();
  await rm(uploadRoot, { recursive: true, force: true });
  await rm(frontendRoot, { recursive: true, force: true });
});

test("uploads, image reads, and deletions share one configured storage root", async () => {
  const objectKey = createListingObjectKey(listingId, "image/png");
  const filePath = path.join(uploadRoot, ...objectKey.split("/"));
  const contents = await sharp({
    create: { width: 1, height: 1, channels: 3, background: "#fff" },
  }).png().toBuffer();

  assert.equal(getUploadRootPath(), uploadRoot);
  assert.equal(
    getListingImageUrl(objectKey),
    `${process.env.APP_URL!.replace(/\/$/, "")}/uploads/${objectKey}`,
  );
  await writeListingImageFile(objectKey, contents);
  assert.deepEqual(await readFile(filePath), contents);
  assert.deepEqual(await getListingImageFile(objectKey), {
    filePath: await realpath(filePath),
    mimeType: "image/png",
  });

  const unrelatedFilePath = path.join(uploadRoot, "unrelated.txt");
  await writeFile(unrelatedFilePath, "keep this file");
  await deleteListingImageFile(objectKey);
  await assert.rejects(readFile(filePath));
  assert.equal(await readFile(unrelatedFilePath, "utf8"), "keep this file");
});

test("listing image storage rejects invalid keys and MIME types", async () => {
  assert.throws(() => createListingObjectKey("../outside", "image/png"));
  assert.throws(() => createListingObjectKey(listingId, "image/gif"));

  const invalidKeys = [
    "../outside.txt",
    `listings/${listingId}/../../outside.png`,
    `listings\\${listingId}\\image.png`,
    `listings/${listingId}/not-a-generated-uuid.png`,
  ];

  for (const objectKey of invalidKeys) {
    assert.throws(() => getListingImageUrl(objectKey));
    await assert.rejects(writeListingImageFile(objectKey, Buffer.from("x")));
    await assert.rejects(deleteListingImageFile(objectKey));
  }
});

test("generated listing image URL is served from the configured upload root", async () => {
  const fixtures = [
    { mimeType: "image/jpeg", extension: "jpg", create: () => sharp({ create: { width: 1, height: 1, channels: 3, background: "#fff" } }).jpeg().toBuffer() },
    { mimeType: "image/png", extension: "png", create: () => sharp({ create: { width: 1, height: 1, channels: 3, background: "#fff" } }).png().toBuffer() },
    { mimeType: "image/webp", extension: "webp", create: () => sharp({ create: { width: 1, height: 1, channels: 3, background: "#fff" } }).webp().toBuffer() },
  ];

  for (const fixture of fixtures) {
    const objectKey = createListingObjectKey(listingId, fixture.mimeType);
    assert.ok(objectKey.endsWith(`.${fixture.extension}`));
    const contents = await fixture.create();
    await writeListingImageFile(objectKey, contents);

    try {
      const imageUrl = new URL(getListingImageUrl(objectKey));
      assert.equal(imageUrl.pathname, `/uploads/${objectKey}`);

      const response = await app.inject({ method: "GET", url: imageUrl.pathname });
      assert.equal(response.statusCode, 200);
      assert.match(response.headers["content-type"] || "", new RegExp(`^${fixture.mimeType}`));
      assert.equal(response.headers["x-content-type-options"], "nosniff");
      assert.deepEqual(response.rawPayload, contents);
    } finally {
      await deleteListingImageFile(objectKey);
    }
  }
});

test("a missing image returns a real 404 instead of the frontend app", async () => {
  const objectKey = createListingObjectKey(listingId, "image/jpeg");
  const response = await app.inject({ method: "GET", url: `/uploads/${objectKey}` });

  assert.equal(response.statusCode, 404);
  assert.match(response.headers["content-type"] || "", /^application\/json/);
  assert.doesNotMatch(response.body, /<!doctype html/i);
});

test("frontend routes keep serving the application and missing API routes stay JSON", async () => {
  const frontendResponse = await app.inject({ method: "GET", url: "/messages" });
  assert.equal(frontendResponse.statusCode, 200);
  assert.match(frontendResponse.headers["content-type"] || "", /^text\/html/);
  assert.match(frontendResponse.body, /MUT Market app/);

  const apiResponse = await app.inject({ method: "GET", url: "/api/v1/route-that-does-not-exist" });
  assert.equal(apiResponse.statusCode, 404);
  assert.match(apiResponse.headers["content-type"] || "", /^application\/json/);
  assert.doesNotMatch(apiResponse.body, /<!doctype html/i);
});

test("image routes reject traversal and files outside the listing-image key format", async () => {
  const secretContents = "must not be served";
  await writeFile(path.join(uploadRoot, "private.txt"), secretContents);
  const outsideRoot = await mkdtemp(path.join(os.tmpdir(), "mut-market-outside-"));
  const outsideFile = path.join(outsideRoot, "outside.jpg");
  await writeFile(outsideFile, secretContents);

  try {
    const invalidKeyResponse = await app.inject({ method: "GET", url: "/uploads/private.txt" });
    assert.equal(invalidKeyResponse.statusCode, 404);
    assert.doesNotMatch(invalidKeyResponse.body, /must not be served/);

    const traversalResponse = await app.inject({
      method: "GET",
      url: `/uploads/%252e%252e%252f..%252f..%252f..%252f${path.basename(outsideRoot)}%252foutside.jpg`,
    });
    assert.equal(traversalResponse.statusCode, 404);
    assert.doesNotMatch(traversalResponse.body, /must not be served/);
    assert.equal(await readFile(outsideFile, "utf8"), secretContents);
  } finally {
    await rm(outsideRoot, { recursive: true, force: true });
  }
});

test("image reads, writes, and deletions reject listing-directory symlink escapes", async () => {
  const outsideRoot = await mkdtemp(path.join(os.tmpdir(), "mut-market-symlink-outside-"));
  const listingDirectory = path.join(uploadRoot, "listings", listingId);
  await mkdir(path.dirname(listingDirectory), { recursive: true });
  await rm(listingDirectory, { recursive: true, force: true });
  await symlink(outsideRoot, listingDirectory, "junction");

  const deleteObjectKey = createListingObjectKey(listingId, "image/png");
  const outsideImagePath = path.join(outsideRoot, path.basename(deleteObjectKey));
  const outsideContents = "outside upload root";
  await writeFile(outsideImagePath, outsideContents);

  try {
    assert.equal(await getListingImageFile(deleteObjectKey), null);
    assert.equal(await readFile(path.join(listingDirectory, path.basename(deleteObjectKey)), "utf8"), outsideContents);
    await assert.rejects(
      writeListingImageFile(createListingObjectKey(listingId, "image/jpeg"), Buffer.from("image")),
      /outside the upload directory/,
    );
    await assert.rejects(deleteListingImageFile(deleteObjectKey), /outside the upload directory/);
    assert.equal(await readFile(outsideImagePath, "utf8"), outsideContents);
  } finally {
    await rm(listingDirectory, { recursive: true, force: true });
    await rm(outsideRoot, { recursive: true, force: true });
  }
});
