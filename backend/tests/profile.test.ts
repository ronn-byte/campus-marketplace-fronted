import assert from "node:assert/strict";
import test, { after } from "node:test";
import { AccountStatus, Role, VerificationStatus } from "@prisma/client";
import "../scripts/test-database.js";

process.env.EMAIL_PROVIDER = "resend";
process.env.RESEND_API_KEY = "test-key";
process.env.EMAIL_FROM = "noreply@campus-marketplace.test";
process.env.APP_URL = "http://localhost:3000";
process.env.CORS_ORIGIN = "http://localhost:5173";

const { env } = await import("../src/config/env.js");
const { buildApp } = await import("../src/app/app.js");
const { prisma } = await import("../src/lib/prisma.js");
const { createSession } = await import("../src/modules/auth/auth.service.js");
const { createOpaqueToken, hashPassword, hashToken } = await import("../src/modules/auth/auth.utils.js");

const app = buildApp();

async function cleanupUser(email: string) {
  await prisma.$transaction([
    prisma.profile.deleteMany({ where: { user: { email } } }),
    prisma.session.deleteMany({ where: { user: { email } } }),
    prisma.emailVerificationToken.deleteMany({ where: { user: { email } } }),
    prisma.passwordResetToken.deleteMany({ where: { user: { email } } }),
    prisma.verification.deleteMany({ where: { user: { email } } }),
    prisma.studentProfile.deleteMany({ where: { user: { email } } }),
    prisma.user.deleteMany({ where: { email } }),
  ]);
}

after(async () => {
  await app.close();
});

test("profile API requires auth and supports safe profile updates", async () => {
  const email = "profile-user@example.com";
  const password = "SecurePassword123!";
  await cleanupUser(email);

  const user = await prisma.user.create({
    data: {
      email,
      passwordHash: await hashPassword(password),
      role: Role.STUDENT,
      accountStatus: AccountStatus.ACTIVE,
      emailVerifiedAt: new Date(),
    },
  });

  const rawToken = createOpaqueToken();
  await createSession(user.id, hashToken(rawToken), {});
  const cookie = `${env.SESSION_COOKIE_NAME}=${rawToken}`;

  const unauthenticated = await app.inject({
    method: "GET",
    url: "/api/v1/profile",
  });
  assert.equal(unauthenticated.statusCode, 401);

  const me = await app.inject({
    method: "GET",
    url: "/api/v1/profile",
    headers: { cookie },
  });
  assert.equal(me.statusCode, 200);
  assert.equal(me.json().profile.email, email);

  await prisma.studentProfile.create({
    data: {
      userId: user.id,
      displayName: "Profile User",
      verificationStatus: VerificationStatus.PENDING,
    },
  });

  const updated = await app.inject({
    method: "PATCH",
    url: "/api/v1/profile",
    headers: { cookie },
    payload: {
      nickname: "Campus Alex",
      phoneNumber: "+254712345678",
      whatsappNumber: "0712345678",
      sellerPublicPhoneNumber: "+254722222222",
      sellerPublicWhatsappNumber: "+254733333333",
      yearOfStudy: 3,
      course: "Computer Science",
      bio: "Campus seller exploring the market.",
      role: "ADMINISTRATOR",
    },
  });
  assert.equal(updated.statusCode, 422);

  const validUpdate = await app.inject({
    method: "PATCH",
    url: "/api/v1/profile",
    headers: { cookie },
    payload: {
      nickname: "Campus Alex",
      phoneNumber: "+254712345678",
      whatsappNumber: "0712345678",
      sellerPublicPhoneNumber: "+254722222222",
      sellerPublicWhatsappNumber: "+254733333333",
      yearOfStudy: 3,
      course: "Computer Science",
      bio: "Campus seller exploring the market.",
    },
  });
  assert.equal(validUpdate.statusCode, 200);
  const response = validUpdate.json();
  assert.equal(response.profile.nickname, "Campus Alex");
  assert.equal(response.profile.phoneNumber, "+254712345678");
  assert.equal(response.profile.whatsappNumber, "+254712345678");
  assert.equal(response.profile.sellerPublicPhoneNumber, "+254722222222");
  assert.equal(response.profile.sellerPublicWhatsappNumber, "+254733333333");
  assert.equal(response.profile.course, "Computer Science");

  const sellerCategory = await prisma.category.create({
    data: { name: "Profile seller test", slug: `profile-seller-${Date.now()}` },
  });
  const sellerListing = await prisma.listing.create({
    data: {
      sellerId: user.id,
      categoryId: sellerCategory.id,
      title: "Seller contact visibility fixture",
      description: "Persisted listing ownership establishes seller identity.",
      price: 10,
      condition: "GOOD",
      location: "Campus",
      status: "DRAFT",
    },
  });

  const publicProfile = await app.inject({
    method: "GET",
    url: `/api/v1/sellers/${user.id}`,
  });
  assert.equal(publicProfile.statusCode, 200);
  assert.deepEqual(publicProfile.json().profile, {
    name: "Campus Alex",
    avatarUrl: null,
    description: "Campus seller exploring the market.",
    sellerPublicPhoneNumber: null,
    sellerPublicWhatsappNumber: null,
    buyerPrivatePhoneNumber: null,
    buyerPrivateWhatsappNumber: null,
  });
  const anonymousProfileJson = JSON.stringify(publicProfile.json());
  assert.equal(anonymousProfileJson.includes(email), false);
  assert.equal(anonymousProfileJson.includes("+254712345678"), false);
  assert.equal(anonymousProfileJson.includes("0712345678"), false);

  const invalidSessionProfile = await app.inject({
    method: "GET",
    url: `/api/v1/sellers/${user.id}`,
    headers: { cookie: `${env.SESSION_COOKIE_NAME}=invalid-session-token` },
  });
  assert.equal(invalidSessionProfile.statusCode, 200);
  assert.deepEqual(invalidSessionProfile.json().profile, publicProfile.json().profile);

  const authenticatedSellerProfile = await app.inject({
    method: "GET",
    url: `/api/v1/sellers/${user.id}`,
    headers: { cookie },
  });
  assert.equal(authenticatedSellerProfile.statusCode, 200);
  assert.deepEqual(authenticatedSellerProfile.json().profile, {
    name: "Campus Alex",
    avatarUrl: null,
    description: "Campus seller exploring the market.",
    sellerPublicPhoneNumber: "+254722222222",
    sellerPublicWhatsappNumber: "+254733333333",
    buyerPrivatePhoneNumber: null,
    buyerPrivateWhatsappNumber: null,
  });
  assert.equal(JSON.stringify(authenticatedSellerProfile.json()).includes(email), false);

  const persistedStudentProfile = await prisma.studentProfile.findUnique({
    where: { userId: user.id },
  });
  assert.ok(persistedStudentProfile);
  assert.equal(persistedStudentProfile.verificationStatus, VerificationStatus.PENDING);

  const invalidPayload = await app.inject({
    method: "PATCH",
    url: "/api/v1/profile",
    headers: { cookie },
    payload: {
      phoneNumber: "invalid-phone",
      whatsappNumber: "javascript:alert(1)",
      yearOfStudy: 18,
    },
  });
  assert.equal(invalidPayload.statusCode, 422);

  await prisma.listing.delete({ where: { id: sellerListing.id } });
  await prisma.category.delete({ where: { id: sellerCategory.id } });
  await cleanupUser(email);
});

test("eligible non-student sellers have public profiles while inactive accounts stay hidden", async () => {
  const email = "profile-moderator-seller@example.com";
  await cleanupUser(email);

  const seller = await prisma.user.create({
    data: {
      email,
      passwordHash: await hashPassword("SecurePassword123!"),
      role: Role.MODERATOR,
      accountStatus: AccountStatus.ACTIVE,
      emailVerifiedAt: new Date(),
      profile: {
        create: {
          nickname: "Campus Moderator",
          phoneNumber: "+254712345678",
          whatsappNumber: "+254723456789",
          sellerPublicPhoneNumber: "+254712345678",
          sellerPublicWhatsappNumber: "+254723456789",
          course: "Marketplace Operations",
        },
      },
    },
  });

  const sellerCategory = await prisma.category.create({
    data: { name: "Moderator seller test", slug: `moderator-seller-${Date.now()}` },
  });
  const sellerListing = await prisma.listing.create({
    data: {
      sellerId: seller.id,
      categoryId: sellerCategory.id,
      title: "Moderator seller contact fixture",
      description: "Persisted listing ownership establishes seller identity.",
      price: 10,
      condition: "GOOD",
      location: "Campus",
      status: "DRAFT",
    },
  });

  const anonymousProfile = await app.inject({
    method: "GET",
    url: `/api/v1/sellers/${seller.id}`,
  });
  assert.equal(anonymousProfile.statusCode, 200);
  assert.deepEqual(anonymousProfile.json().profile, {
    name: "Campus Moderator",
    avatarUrl: null,
    description: null,
    sellerPublicPhoneNumber: null,
    sellerPublicWhatsappNumber: null,
    buyerPrivatePhoneNumber: null,
    buyerPrivateWhatsappNumber: null,
  });

  const invalidSessionProfile = await app.inject({
    method: "GET",
    url: `/api/v1/sellers/${seller.id}`,
    headers: { cookie: `${env.SESSION_COOKIE_NAME}=invalid-session-token` },
  });
  assert.equal(invalidSessionProfile.statusCode, 200);
  assert.deepEqual(invalidSessionProfile.json().profile, anonymousProfile.json().profile);

  const rawToken = createOpaqueToken();
  await createSession(seller.id, hashToken(rawToken), {});
  const authenticatedProfile = await app.inject({
    method: "GET",
    url: `/api/v1/sellers/${seller.id}`,
    headers: { cookie: `${env.SESSION_COOKIE_NAME}=${rawToken}` },
  });
  assert.equal(authenticatedProfile.statusCode, 200);
  assert.deepEqual(authenticatedProfile.json().profile, {
    name: "Campus Moderator",
    avatarUrl: null,
    description: null,
    sellerPublicPhoneNumber: "+254712345678",
    sellerPublicWhatsappNumber: "+254723456789",
    buyerPrivatePhoneNumber: null,
    buyerPrivateWhatsappNumber: null,
  });
  assert.equal(JSON.stringify(authenticatedProfile.json()).includes(email), false);

  await prisma.user.update({
    where: { id: seller.id },
    data: { accountStatus: AccountStatus.SUSPENDED },
  });
  const suspendedProfile = await app.inject({
    method: "GET",
    url: `/api/v1/sellers/${seller.id}`,
  });
  assert.equal(suspendedProfile.statusCode, 404);

  await prisma.user.update({
    where: { id: seller.id },
    data: { accountStatus: AccountStatus.DISABLED },
  });
  const disabledProfile = await app.inject({
    method: "GET",
    url: `/api/v1/sellers/${seller.id}`,
  });
  assert.equal(disabledProfile.statusCode, 404);

  await prisma.listing.delete({ where: { id: sellerListing.id } });
  await prisma.category.delete({ where: { id: sellerCategory.id } });
  await cleanupUser(email);
});

test("buyer profile contacts require the authenticated seller's specific inquiry", async () => {
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const emails = [
    `contact-buyer-${suffix}@example.test`,
    `contact-seller-a-${suffix}@example.test`,
    `contact-seller-b-${suffix}@example.test`,
    `contact-other-buyer-${suffix}@example.test`,
    `contact-unrelated-${suffix}@example.test`,
    `contact-buyer-no-history-${suffix}@example.test`,
    `contact-dual-role-${suffix}@example.test`,
  ];
  const createdUsers: Array<{ id: string; email: string }> = [];
  const listingIds: string[] = [];
  let categoryId: string | undefined;

  const createActor = async (email: string, profile?: {
    nickname: string;
    phoneNumber?: string;
    whatsappNumber?: string;
    sellerPublicPhoneNumber?: string;
    sellerPublicWhatsappNumber?: string;
    bio?: string;
  }) => {
    await cleanupUser(email);
    const user = await prisma.user.create({
      data: {
        email,
        passwordHash: await hashPassword("SecurePassword123!"),
        role: Role.STUDENT,
        accountStatus: AccountStatus.ACTIVE,
        emailVerifiedAt: new Date(),
        ...(profile ? { profile: { create: profile } } : {}),
      },
    });
    createdUsers.push(user);
    const rawToken = createOpaqueToken();
    await createSession(user.id, hashToken(rawToken), {});
    return { user, cookie: `${env.SESSION_COOKIE_NAME}=${rawToken}` };
  };

  try {
    const [buyer, sellerA, sellerB, otherBuyer, unrelated, buyerNoHistory, dualRole] = await Promise.all([
      createActor(emails[0]!, { nickname: "Public Buyer Name", phoneNumber: "+254712345678", whatsappNumber: "+254723456789", bio: "Public buyer description." }),
      createActor(emails[1]!, { nickname: "Seller A", phoneNumber: "+254701111111", whatsappNumber: "+254702222222", sellerPublicPhoneNumber: "+254711111111", sellerPublicWhatsappNumber: "+254722222222" }),
      createActor(emails[2]!, { nickname: "Seller B", phoneNumber: "+254703333333", whatsappNumber: "+254704444444", sellerPublicPhoneNumber: "+254733333333", sellerPublicWhatsappNumber: "+254744444444" }),
      createActor(emails[3]!),
      createActor(emails[4]!),
      createActor(emails[5]!, { nickname: "Buyer Without History", phoneNumber: "+254734567890", whatsappNumber: "+254745678901", bio: "Public buyer description." }),
      createActor(emails[6]!, { nickname: "Dual Role User", phoneNumber: "+254756789012", whatsappNumber: "+254767890123", sellerPublicPhoneNumber: "+254778901234", sellerPublicWhatsappNumber: "+254789012345", bio: "Buyer and seller." }),
    ]);
    const category = await prisma.category.create({
      data: { name: `Contact Privacy ${suffix}`, slug: `contact-privacy-${suffix}` },
    });
    categoryId = category.id;
    const listingA = await prisma.listing.create({
      data: {
        sellerId: sellerA.user.id,
        categoryId,
        title: "Privacy inquiry listing A",
        description: "Listing for contact authorization test.",
        price: 10,
        condition: "GOOD",
        location: "Campus",
        status: "PUBLISHED",
      },
    });
    const listingB = await prisma.listing.create({
      data: {
        sellerId: sellerB.user.id,
        categoryId,
        title: "Privacy inquiry listing B",
        description: "Second listing for contact authorization test.",
        price: 10,
        condition: "GOOD",
        location: "Campus",
        status: "PUBLISHED",
      },
    });
    const dualRoleListing = await prisma.listing.create({
      data: {
        sellerId: dualRole.user.id,
        categoryId,
        title: "Dual role seller listing",
        description: "A listing owned by a user who also buys.",
        price: 10,
        condition: "GOOD",
        location: "Campus",
        status: "DRAFT",
      },
    });
    listingIds.push(listingA.id, listingB.id, dualRoleListing.id);
    const inquiryA = await prisma.listingInquiry.create({
      data: { listingId: listingA.id, buyerId: buyer.user.id },
    });
    const inquiryB = await prisma.listingInquiry.create({
      data: { listingId: listingB.id, buyerId: otherBuyer.user.id },
    });
    const dualRoleInquiry = await prisma.listingInquiry.create({
      data: { listingId: listingA.id, buyerId: dualRole.user.id },
    });

    const profileRequest = (cookie?: string, inquiryId?: string, profileId = buyer.user.id) => app.inject({
      method: "GET",
      url: `/api/v1/sellers/${profileId}${inquiryId ? `?inquiryId=${inquiryId}` : ""}`,
      ...(cookie ? { headers: { cookie } } : {}),
    });
    const expectNoBuyerContact = async (
      response: Awaited<ReturnType<typeof profileRequest>>,
      expectedName = "Public Buyer Name",
      expectedDescription = "Public buyer description.",
    ) => {
      assert.equal(response.statusCode, 200);
      assert.equal(response.json().profile.sellerPublicPhoneNumber, null);
      assert.equal(response.json().profile.sellerPublicWhatsappNumber, null);
      assert.equal(response.json().profile.buyerPrivatePhoneNumber, null);
      assert.equal(response.json().profile.buyerPrivateWhatsappNumber, null);
      assert.equal(response.json().profile.name, expectedName);
      assert.equal(response.json().profile.description, expectedDescription);
    };

    await expectNoBuyerContact(await profileRequest());
    await expectNoBuyerContact(await profileRequest(sellerA.cookie));
    await expectNoBuyerContact(await profileRequest(buyer.cookie));
    await expectNoBuyerContact(await profileRequest(buyer.cookie, inquiryA.id));
    await expectNoBuyerContact(await profileRequest(dualRole.cookie, dualRoleInquiry.id, dualRole.user.id), "Dual Role User", "Buyer and seller.");
    await expectNoBuyerContact(await profileRequest(sellerB.cookie, inquiryA.id));
    await expectNoBuyerContact(await profileRequest(unrelated.cookie, inquiryA.id));
    await expectNoBuyerContact(await profileRequest(unrelated.cookie));
    await expectNoBuyerContact(await profileRequest(sellerB.cookie, inquiryB.id));
    await expectNoBuyerContact(await profileRequest(undefined, undefined, buyerNoHistory.user.id), "Buyer Without History");
    await expectNoBuyerContact(await profileRequest(unrelated.cookie, undefined, buyerNoHistory.user.id), "Buyer Without History");
    await expectNoBuyerContact(await profileRequest(buyerNoHistory.cookie, undefined, buyerNoHistory.user.id), "Buyer Without History");

    const buyerViewsSeller = await profileRequest(buyer.cookie, undefined, sellerA.user.id);
    assert.equal(buyerViewsSeller.statusCode, 200);
    assert.equal(buyerViewsSeller.json().profile.sellerPublicPhoneNumber, "+254711111111");
    assert.equal(buyerViewsSeller.json().profile.sellerPublicWhatsappNumber, "+254722222222");
    assert.equal(buyerViewsSeller.json().profile.buyerPrivatePhoneNumber, null);
    assert.equal(buyerViewsSeller.json().profile.buyerPrivateWhatsappNumber, null);

    // General seller profiles expose only the separate seller-public values.
    const dualRoleProfile = await profileRequest(buyer.cookie, undefined, dualRole.user.id);
    assert.equal(dualRoleProfile.json().profile.sellerPublicPhoneNumber, "+254778901234");
    assert.equal(dualRoleProfile.json().profile.sellerPublicWhatsappNumber, "+254789012345");
    assert.equal(dualRoleProfile.json().profile.buyerPrivatePhoneNumber, null);
    assert.equal(dualRoleProfile.json().profile.buyerPrivateWhatsappNumber, null);

    const authorized = await profileRequest(sellerA.cookie, inquiryA.id);
    assert.equal(authorized.statusCode, 200);
    assert.equal(authorized.json().profile.buyerPrivatePhoneNumber, "+254712345678");
    assert.equal(authorized.json().profile.buyerPrivateWhatsappNumber, "+254723456789");
    assert.equal(authorized.json().profile.sellerPublicPhoneNumber, null);
    assert.equal(authorized.json().profile.sellerPublicWhatsappNumber, null);
    assert.equal(authorized.json().profile.name, "Public Buyer Name");
    assert.equal(authorized.json().profile.description, "Public buyer description.");
  } finally {
    const userIds = createdUsers.map(({ id }) => id);
    if (userIds.length > 0) {
      await prisma.listingInquiry.deleteMany({
        where: { OR: [{ buyerId: { in: userIds } }, { listingId: { in: listingIds } }] },
      });
    }
    if (listingIds.length > 0) {
      await prisma.listing.deleteMany({ where: { id: { in: listingIds } } });
    }
    if (categoryId) await prisma.category.delete({ where: { id: categoryId } });
    for (const email of emails) await cleanupUser(email);
  }
});
