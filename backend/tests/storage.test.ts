import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test, { after } from "node:test";

import "../scripts/test-database.js";

process.env.RESEND_API_KEY ??= "test-key";
process.env.EMAIL_FROM ??= "noreply@campus-marketplace.test";
process.env.APP_URL ??= "http://localhost:3000";
process.env.CORS_ORIGIN ??= "http://localhost:5173";

const uploadRoot = await mkdtemp(path.join(os.tmpdir(), "mut-market-storage-"));
process.env.UPLOAD_ROOT = uploadRoot;

const {
  createListingObjectKey,
  deleteListingImageFile,
  getListingImageUrl,
  writeListingImageFile,
} = await import("../src/lib/storage.js");

const listingId = "6d155ee0-f7f6-45b7-b9e4-582c26ac4f41";

after(async () => {
  await rm(uploadRoot, { recursive: true, force: true });
});

test("listing image storage uses a generated key and keeps files inside the upload root", async () => {
  const objectKey = createListingObjectKey(listingId, "image/png");

  assert.match(
    objectKey,
    /^listings\/[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\/[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.png$/i,
  );
  assert.equal(
    getListingImageUrl(objectKey),
    `${process.env.APP_URL!.replace(/\/$/, "")}/uploads/${objectKey}`,
  );

  const contents = Buffer.from("image bytes");
  await writeListingImageFile(objectKey, contents);
  assert.deepEqual(
    await readFile(path.join(uploadRoot, ...objectKey.split("/"))),
    contents,
  );

  await deleteListingImageFile(objectKey);
  await assert.rejects(readFile(path.join(uploadRoot, ...objectKey.split("/"))));
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
