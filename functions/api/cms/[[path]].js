import { validCmsContactEmail, validCmsContactPhone } from "../../../app/cms/contact-validation.js";

const COOKIE_NAME = "__Host-chiuel_cms_session";
const SESSION_MAX_AGE_SECONDS = 8 * 60 * 60;
const TOTP_STEP_SECONDS = 30;
const TOTP_TOLERANCE = [-1, 0, 1];
const DEFAULT_BODY_LIMIT = 196608;
const DEFAULT_IMAGE_UPLOAD_BODY_LIMIT = 2_500_000;
const DEFAULT_IMAGE_FILE_LIMIT = 1_500_000;
const DEFAULT_PUBLISH_LIMIT = 5;
const GITHUB_API_VERSION = "2022-11-28";

export async function onRequest(context) {
  const { request, env, params } = context;
  const route = normalizeRoute(params.path);

  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204 });
  }

  try {
    if (route === "login" && request.method === "POST") {
      return await login(request, env);
    }

    if (route === "logout" && request.method === "POST") {
      return logout(request);
    }

    if (route === "session" && request.method === "GET") {
      return await session(request, env);
    }

    if (route === "content" && request.method === "GET") {
      const auth = await requireSession(request, env);
      if (auth instanceof Response) {
        return auth;
      }

      const missing = missingGitHubReadConfig(env);
      if (missing.length > 0) {
        return json({ error: `CMS GitHub config missing: ${missing.join(", ")}` }, 503);
      }

      const stored = await readGitHubContent(env);

      if (!stored) {
        return json({ error: "CMS content file not found." }, 404);
      }

      return json({ content: stored.content, contentSha: stored.sha });
    }

    if (route === "content" && request.method === "POST") {
      return await saveContent(request, env);
    }

    if (route === "retry-deploy" && request.method === "POST") {
      if (!sameOrigin(request)) return json({ error: "Request not allowed." }, 403);
      const auth = await requireSession(request, env);
      if (auth instanceof Response) return auth;
      const body = await readJson(request, env);
      if (!validIdempotencyKey(body?.idempotencyKey)) {
        return json({ error: "Invalid update reference." }, 400);
      }
      const result = await coordinatorRequest(env, "retry", {
        idempotencyKey: body.idempotencyKey,
        email: auth.email,
      });
      if (!result.ok) {
        return json({ error: "Unable to retry this update. Wait a moment or contact support." }, 409);
      }
      return json({ state: "pending" });
    }

    if (route === "publish-usage" && request.method === "GET") {
      const auth = await requireSession(request, env);
      if (auth instanceof Response) {
        return auth;
      }

      const month = currentUtcMonth();
      const limit = Number(env.CMS_PUBLISH_LIMIT_MONTHLY ?? DEFAULT_PUBLISH_LIMIT);
      const status = await coordinatorRequest(env, "status", {
        email: auth.email,
        month,
        limit,
      });
      return json({ used: Number(status.used ?? 0), limit, month });
    }

    if (route === "deploy-status" && request.method === "GET") {
      const auth = await requireSession(request, env);
      if (auth instanceof Response) {
        return auth;
      }

      const idempotencyKey = new URL(request.url).searchParams.get("idempotencyKey");
      if (!idempotencyKey) return json({ state: "idle" });
      const status = await coordinatorRequest(env, "status", {
        email: auth.email,
        idempotencyKey,
        month: currentUtcMonth(),
        limit: Number(env.CMS_PUBLISH_LIMIT_MONTHLY ?? DEFAULT_PUBLISH_LIMIT),
      });
      return json({ state: publicDeployState(status.operation?.state) });
    }

    return json({ error: "Not found." }, 404);
  } catch (error) {
    if (error instanceof HttpError) {
      return json({ error: error.publicMessage }, error.status);
    }

    console.error(JSON.stringify({ event: "cms_request_failed", detail: safeErrorMessage(error) }));
    return json({ error: "CMS request failed." }, 500);
  }
}

function publicDeployState(state) {
  if (state === "success") return "success";
  if (["failed", "dispatch_failed"].includes(state)) return "failed";
  if (["reserved", "scheduled", "deploying"].includes(state)) return "pending";
  return "idle";
}

async function login(request, env) {
  if (!sameOrigin(request)) {
    return json({ error: "Cross-origin request rejected." }, 403);
  }

  const missing = missingAuthConfig(env);
  if (missing.length > 0) {
    return json({ error: `CMS auth config missing: ${missing.join(", ")}` }, 503);
  }

  const body = await readJson(request, env);
  const email = String(body.email ?? "").trim().toLowerCase();
  const password = String(body.password ?? "");
  const totp = String(body.totp ?? "").trim();
  const loginSubject = await loginThrottleSubject(request, env);

  const lockout = await readLockout(env, loginSubject);
  if (lockout.locked) {
    return json({ error: "Too many failed attempts. Try again later." }, 429);
  }

  if (
    !/^\S+@\S+\.\S+$/.test(email) ||
    email.length > 254 ||
    !password ||
    password.length > 1024 ||
    !/^[0-9]{6}$/.test(totp)
  ) {
    return recordFailedLogin(env, loginSubject, "Invalid sign-in details.");
  }

  const expectedEmail = String(env.ADMIN_EMAIL).trim().toLowerCase();
  const emailOk = timingSafeEqual(textBytes(email), textBytes(expectedEmail));
  const totpResult = await verifyTotp(env, email, totp);
  if (lockout.underAttack && (!emailOk || !totpResult.ok)) {
    return recordFailedLogin(env, loginSubject, "Invalid sign-in details.");
  }
  const passwordOk = await verifyPassword(password, env.ADMIN_PASSWORD_VERIFIER);

  if (!emailOk || !passwordOk || !totpResult.ok) {
    return recordFailedLogin(env, loginSubject, "Invalid sign-in details.");
  }

  const claimed = await coordinatorRequest(env, "claim-totp", {
    email,
    step: totpResult.step,
    nowStep: Math.floor(Date.now() / 1000 / TOTP_STEP_SECONDS),
  });
  if (!claimed.ok) return recordFailedLogin(env, loginSubject, "Invalid sign-in details.");

  await clearFailedLogin(env, loginSubject);

  const token = await createSessionToken(env, email);

  return json(
    { authenticated: true, email },
    200,
    {
      "Set-Cookie": serializeCookie(COOKIE_NAME, token, SESSION_MAX_AGE_SECONDS),
    },
  );
}

async function logout(request) {
  if (!sameOrigin(request)) {
    return json({ error: "Cross-origin request rejected." }, 403);
  }

  return json(
    { authenticated: false },
    200,
    {
      "Set-Cookie": `${COOKIE_NAME}=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax; Secure`,
    },
  );
}

async function session(request, env) {
  const auth = await requireSession(request, env);

  if (auth instanceof Response) {
    return json({ authenticated: false });
  }

  return json({ authenticated: true, email: auth.email });
}

async function saveContent(request, env) {
  if (!sameOrigin(request)) {
    return json({ error: "Cross-origin request rejected." }, 403);
  }

  const auth = await requireSession(request, env);
  if (auth instanceof Response) {
    return auth;
  }

  const missing = missingGitHubWriteConfig(env);
  if (missing.length > 0) {
    return json({ error: `CMS publish config missing: ${missing.join(", ")}` }, 503);
  }

  const month = currentUtcMonth();
  const limit = Number(env.CMS_PUBLISH_LIMIT_MONTHLY ?? DEFAULT_PUBLISH_LIMIT);
  const payload = await readSavePayload(request, env);
  const idempotencyKey = String(payload.idempotencyKey ?? "");
  if (!validIdempotencyKey(idempotencyKey)) {
    return json({ error: "Invalid publish request identifier." }, 400);
  }

  const document = {
    ...payload.content,
    updatedAt: new Date().toISOString(),
  };
  const expectedContentSha = payload.expectedContentSha;
  const imageUploads = payload.imageUploads;
  const validation = validateCmsDocument(document, env);

  if (!validation.ok) {
    return json({ error: validation.error }, 400);
  }

  const imageValidation = await validateImageUploads(imageUploads, document, env);
  if (!imageValidation.ok) {
    return json({ error: imageValidation.error }, 400);
  }

  const current = await readGitHubContent(env);
  const policy = validateCmsModulePolicy(document, current?.content, env);
  if (!policy.ok) {
    return json({ error: policy.error }, 400);
  }

  const contentAlreadyWritten = Boolean(
    current?.sha && equivalentCmsContent(current.content, document),
  );
  if (current?.sha && !expectedContentSha && !contentAlreadyWritten) {
    return json(
      {
        error: "Content changed in GitHub. Refresh before saving.",
        content: current.content,
        contentSha: current.sha,
      },
      409,
    );
  }

  if (current?.sha && current.sha !== expectedContentSha && !contentAlreadyWritten) {
    return json(
      {
        error: "Content changed in GitHub. Review the latest version before saving.",
        content: current.content,
        contentSha: current.sha,
      },
      409,
    );
  }

  // A genuine no-op cannot become an accepted publish if cancellation is unavailable.
  if (contentAlreadyWritten && current.sha === expectedContentSha && imageValidation.uploads.length === 0) {
    return json({ error: "No content changes to publish." }, 400);
  }
  const fingerprint = await saveFingerprint(document, expectedContentSha, imageValidation.uploads);
  const reservation = await coordinatorRequest(env, "reserve", {
    email: auth.email,
    fingerprint,
    idempotencyKey,
    month,
    limit,
  });
  if (!reservation.ok) {
    return coordinatorFailureResponse(reservation);
  }

  if (reservation.operation?.quotaCounted) {
    if (reservation.operation.state === "dispatch_failed") {
      const retried = await coordinatorRequest(env, "retry", { idempotencyKey, email: auth.email });
      if (!retried.ok) return coordinatorFailureResponse(retried);
    }
    const currentUsage = await coordinatorRequest(env, "status", { email: auth.email, month, limit });
    if (!currentUsage.ok) return coordinatorFailureResponse(currentUsage);
    return json({
      content: current?.content ?? document,
      contentSha: current?.sha,
      commitSha: reservation.operation.commitSha,
      idempotencyKey,
      message: "Content was already saved. Deployment is queued.",
      replayed: true,
      usage: { used: currentUsage.used, limit, month },
    });
  }

  if (contentAlreadyWritten && imageValidation.uploads.length === 0 && !reservation.replayed) {
    await coordinatorRequestBestEffort(env, "cancel", { idempotencyKey });
    return json({ error: "No content changes to publish." }, 400);
  }

  let saved;
  const writtenUploads = [];
  let contentWriteAttempted = contentAlreadyWritten;
  try {
    if (contentAlreadyWritten) {
      saved = {
        contentSha: current.sha,
        commitSha: await readGitHubHead(env),
      };
    } else {
      for (const upload of imageValidation.uploads) {
        await writeGitHubImage(env, upload);
        writtenUploads.push(upload);
      }
      contentWriteAttempted = true;
      saved = await writeGitHubContent(env, document, current?.sha);
    }
  } catch (error) {
    // A lost GitHub response can follow a successful commit. Keep the reservation
    // and uploaded assets so an identical retry can reconcile the stored content.
    if (!contentWriteAttempted) {
      await deleteFailedGitHubImagesBestEffort(env, writtenUploads, current?.content);
      await coordinatorRequestBestEffort(env, "cancel", { idempotencyKey });
    }
    throw error;
  }

  const committed = await coordinatorRequest(env, "commit", {
    idempotencyKey,
    commitSha: saved.commitSha ?? saved.contentSha,
  });
  if (!committed.ok) {
    return json(
      {
        error: "Content was saved, but deployment could not be queued. Retry the same publish.",
        retryable: true,
        idempotencyKey,
      },
      503,
    );
  }

  try {
    await deleteReplacedGitHubImages(env, imageValidation.uploads, document);
  } catch (error) {
    console.error(JSON.stringify({ event: "cms_image_cleanup_failed", detail: safeErrorMessage(error) }));
  }

  return json({
    content: document,
    contentSha: saved.contentSha,
    commitSha: saved.commitSha,
    idempotencyKey,
    message: "Content saved and deployment queued.",
    usage: { used: committed.operation.acceptedQuotaCount, limit, month },
  });
}

async function requireSession(request, env) {
  const missing = missingBaseConfig(env);
  if (missing.length > 0) {
    return json({ error: `CMS base config missing: ${missing.join(", ")}` }, 503);
  }

  const cookie = parseCookies(request.headers.get("Cookie") ?? "")[COOKIE_NAME];
  if (!cookie) {
    return json({ error: "Unauthorized." }, 401);
  }

  const sessionData = await verifySessionToken(env, cookie);
  if (!sessionData) {
    return json({ error: "Unauthorized." }, 401);
  }

  return sessionData;
}

async function readJson(request, env) {
  const limit = Number(env.CMS_BODY_LIMIT_BYTES ?? DEFAULT_BODY_LIMIT);
  const bytes = await readBodyBytes(request, limit, "Request body too large.");
  const text = new TextDecoder().decode(bytes);

  try {
    return JSON.parse(text);
  } catch {
    throw new HttpError(400, "Invalid JSON.");
  }
}

async function readSavePayload(request, env) {
  const contentType = request.headers.get("Content-Type") ?? "";

  if (!contentType.toLowerCase().includes("multipart/form-data")) {
    const payload = await readJson(request, env);
    const envelope = isPlainObject(payload) ? payload : {};
    return {
      content: isPlainObject(envelope.content) ? envelope.content : payload,
      expectedContentSha:
        typeof envelope.expectedContentSha === "string" ? envelope.expectedContentSha : undefined,
      idempotencyKey:
        typeof envelope.idempotencyKey === "string" ? envelope.idempotencyKey : undefined,
      imageUploads: [],
    };
  }

  const limit = Number(env.CMS_IMAGE_UPLOAD_BODY_LIMIT_BYTES ?? DEFAULT_IMAGE_UPLOAD_BODY_LIMIT);
  const bytes = await readBodyBytes(request, limit, "Image upload request too large.");
  const formData = await new Response(bytes, {
    headers: { "Content-Type": contentType },
  }).formData();
  const contentText = formData.get("content");
  const uploadsText = formData.get("imageUploads") ?? "[]";

  if (typeof contentText !== "string" || typeof uploadsText !== "string") {
    throw new HttpError(400, "Invalid image upload payload.");
  }

  let content;
  let uploadMetadata;
  try {
    content = JSON.parse(contentText);
    uploadMetadata = JSON.parse(uploadsText);
  } catch {
    throw new HttpError(400, "Invalid image upload JSON.");
  }

  if (!Array.isArray(uploadMetadata) || uploadMetadata.length > 8) {
    throw new HttpError(400, "Invalid image upload list.");
  }

  const imageUploads = uploadMetadata.map((upload) => ({
    ...upload,
    file: formData.get(String(upload.fileField ?? "")),
  }));

  const totalImageBytes = imageUploads.reduce((total, upload) => total + Number(upload.file?.size ?? 0), 0);
  if (totalImageBytes > limit) {
    throw new HttpError(413, "Image upload request too large.");
  }

  return {
    content,
    expectedContentSha: stringFormValue(formData.get("expectedContentSha")),
    idempotencyKey: stringFormValue(formData.get("idempotencyKey")),
    imageUploads,
  };
}

async function readGitHubContent(env) {
  const response = await fetch(githubContentUrl(env), {
    headers: githubHeaders(env.GITHUB_CONTENT_TOKEN),
  });

  if (response.status === 404) {
    return null;
  }

  if (!response.ok) {
    throw new Error(`GitHub read failed with ${response.status}.`);
  }

  const data = await response.json();
  const bytes = base64ToBytes(String(data.content ?? "").replace(/\s/g, ""));
  const content = JSON.parse(new TextDecoder().decode(bytes));

  return {
    content,
    sha: data.sha,
  };
}

async function readGitHubHead(env) {
  const url = `https://api.github.com/repos/${encodeURIComponent(env.GITHUB_OWNER)}/${encodeURIComponent(env.GITHUB_REPO)}/commits/${encodeURIComponent(env.GITHUB_BRANCH)}`;
  const response = await fetch(url, { headers: githubHeaders(env.GITHUB_CONTENT_TOKEN) });
  if (!response.ok) throw new HttpError(503, "Unable to recover the saved update. Retry the same publish.");
  const data = await response.json();
  if (!/^[a-f0-9]{40}$/.test(data.sha)) throw new HttpError(503, "Unable to recover the saved update.");
  return data.sha;
}

async function writeGitHubContent(env, document, sha) {
  const encoded = bytesToBase64(new TextEncoder().encode(`${JSON.stringify(document, null, 2)}\n`));
  const payload = {
    message: `Update ${env.SITE_ID} CMS content`,
    content: encoded,
    branch: env.GITHUB_BRANCH,
    ...(sha ? { sha } : {}),
  };

  const response = await fetch(githubContentUrl(env), {
    method: "PUT",
    headers: githubHeaders(env.GITHUB_CONTENT_TOKEN),
    body: JSON.stringify(payload),
  });

  if (response.status === 409) {
    throw new HttpError(409, "GitHub content changed during save. Refresh and try again.");
  }

  if (!response.ok) {
    throw new Error(`GitHub write failed with ${response.status}.`);
  }

  const data = await response.json();

  return {
    commitSha: data.commit?.sha,
    contentSha: data.content?.sha,
  };
}

async function writeGitHubImage(env, upload) {
  await writeGitHubFile(
    env,
    publicAssetGitHubPath(upload.path),
    upload.bytes,
    `Upload ${env.SITE_ID} CMS image ${upload.dishId}`,
  );
}

async function deleteReplacedGitHubImages(env, uploads, document) {
  const activePaths = activeCmsImagePaths(document);

  for (const upload of uploads) {
    const previousPath = upload.previousPath;
    if (
      previousPath &&
      previousPath !== upload.path &&
      validCmsUploadPath(previousPath, env) &&
      !activePaths.has(previousPath)
    ) {
      await deleteGitHubFile(env, publicAssetGitHubPath(previousPath), `Remove replaced ${env.SITE_ID} CMS image`);
      await deleteGitHubFile(env, previousPath.slice(1), `Remove legacy replaced ${env.SITE_ID} CMS image`);
    }
  }
}

async function deleteFailedGitHubImagesBestEffort(env, uploads, currentDocument) {
  const activePaths = activeCmsImagePaths(currentDocument ?? {});
  for (const upload of uploads) {
    if (activePaths.has(upload.path)) continue;
    try {
      await deleteGitHubFile(
        env,
        publicAssetGitHubPath(upload.path),
        `Remove failed ${env.SITE_ID} CMS image upload`,
      );
    } catch (error) {
      console.error(JSON.stringify({ event: "cms_failed_upload_cleanup_failed", detail: safeErrorMessage(error) }));
    }
  }
}

function publicAssetGitHubPath(path) {
  return `public${path}`;
}

async function writeGitHubFile(env, path, bytes, message) {
  const existingSha = await readGitHubFileSha(env, path);
  const payload = {
    message,
    content: bytesToBase64(bytes),
    branch: env.GITHUB_BRANCH,
    ...(existingSha ? { sha: existingSha } : {}),
  };

  const response = await fetch(githubFileUrl(env, path), {
    method: "PUT",
    headers: githubHeaders(env.GITHUB_CONTENT_TOKEN),
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    throw new Error(`GitHub image write failed with ${response.status}.`);
  }
}

async function deleteGitHubFile(env, path, message) {
  const sha = await readGitHubFileSha(env, path);
  if (!sha) {
    return;
  }

  const response = await fetch(githubFileUrl(env, path), {
    method: "DELETE",
    headers: githubHeaders(env.GITHUB_CONTENT_TOKEN),
    body: JSON.stringify({
      message,
      sha,
      branch: env.GITHUB_BRANCH,
    }),
  });

  if (!response.ok && response.status !== 404) {
    throw new Error(`GitHub image delete failed with ${response.status}.`);
  }
}

async function readGitHubFileSha(env, path) {
  const response = await fetch(githubFileUrl(env, path, true), {
    headers: githubHeaders(env.GITHUB_CONTENT_TOKEN),
  });

  if (response.status === 404) {
    return null;
  }

  if (!response.ok) {
    throw new Error(`GitHub file lookup failed with ${response.status}.`);
  }

  const data = await response.json();
  return typeof data.sha === "string" ? data.sha : null;
}

async function coordinatorRequest(env, action, body) {
  const baseUrl = String(env.CMS_COORDINATOR_URL).replace(/\/+$/g, "");
  let response;
  try {
    response = await fetch(`${baseUrl}/v1/clients/${encodeURIComponent(env.SITE_ID)}/${action}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.CMS_COORDINATOR_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });
  } catch {
    throw new HttpError(503, "CMS coordinator is unavailable. Try again.");
  }
  if (!response.ok) {
    throw new HttpError(503, "CMS coordinator rejected the request. Try again.");
  }
  const result = await response.json().catch(() => null);
  if (!isPlainObject(result)) {
    throw new HttpError(503, "CMS coordinator returned an invalid response.");
  }
  return result;
}

async function coordinatorRequestBestEffort(env, action, body) {
  try {
    return await coordinatorRequest(env, action, body);
  } catch {
    return null;
  }
}

async function verifyPassword(password, verifier) {
  const parts = String(verifier).split(":");

  if (parts.length !== 4 || parts[0] !== "pbkdf2-sha256") {
    return false;
  }

  const iterations = Number(parts[1]);
  const salt = base64ToBytes(parts[2]);
  const expected = base64ToBytes(parts[3]);
  if (
    !Number.isInteger(iterations) ||
    iterations < 10_000 ||
    iterations > 2_000_000 ||
    salt.length < 16 ||
    salt.length > 64 ||
    expected.length < 32 ||
    expected.length > 64
  ) {
    return false;
  }
  const key = await crypto.subtle.importKey("raw", textBytes(password), "PBKDF2", false, [
    "deriveBits",
  ]);
  const bits = await crypto.subtle.deriveBits(
    {
      name: "PBKDF2",
      hash: "SHA-256",
      salt,
      iterations,
    },
    key,
    expected.length * 8,
  );

  return timingSafeEqual(new Uint8Array(bits), expected);
}

async function verifyTotp(env, email, token) {
  const secret = base32ToBytes(env.ADMIN_TOTP_SECRET_BASE32);
  const step = Math.floor(Date.now() / 1000 / TOTP_STEP_SECONDS);

  for (const offset of TOTP_TOLERANCE) {
    const candidateStep = step + offset;
    const generated = await totp(secret, candidateStep);
    if (timingSafeEqual(textBytes(generated), textBytes(token))) {
      return { ok: true, step: candidateStep };
    }
  }

  return { ok: false };
}

async function totp(secret, step) {
  const counter = new ArrayBuffer(8);
  const view = new DataView(counter);
  view.setUint32(4, step, false);

  const key = await crypto.subtle.importKey(
    "raw",
    secret,
    { name: "HMAC", hash: "SHA-1" },
    false,
    ["sign"],
  );
  const signature = new Uint8Array(await crypto.subtle.sign("HMAC", key, counter));
  const offset = signature[signature.length - 1] & 0x0f;
  const code =
    ((signature[offset] & 0x7f) << 24) |
    ((signature[offset + 1] & 0xff) << 16) |
    ((signature[offset + 2] & 0xff) << 8) |
    (signature[offset + 3] & 0xff);

  return String(code % 1000000).padStart(6, "0");
}

async function createSessionToken(env, email) {
  const payload = base64UrlEncode(
    textBytes(
      JSON.stringify({
        email,
        siteId: String(env.SITE_ID),
        exp: Math.floor(Date.now() / 1000) + SESSION_MAX_AGE_SECONDS,
      }),
    ),
  );
  const signature = await hmacSha256(env.AUTH_SECRET, payload);

  return `${payload}.${base64UrlEncode(signature)}`;
}

async function verifySessionToken(env, token) {
  try {
    const [payload, signature] = String(token).split(".");

    if (!payload || !signature) {
      return null;
    }

    const expected = base64UrlEncode(await hmacSha256(env.AUTH_SECRET, payload));
    if (!timingSafeEqual(textBytes(signature), textBytes(expected))) {
      return null;
    }

    const data = JSON.parse(new TextDecoder().decode(base64UrlDecode(payload)));
    const expectedEmail = String(env.ADMIN_EMAIL).trim().toLowerCase();

    if (
      data.exp < Math.floor(Date.now() / 1000) ||
      data.email !== expectedEmail ||
      data.siteId !== String(env.SITE_ID)
    ) {
      return null;
    }

    return { email: data.email };
  } catch {
    return null;
  }
}

async function hmacSha256(secret, value) {
  const key = await crypto.subtle.importKey(
    "raw",
    textBytes(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );

  return new Uint8Array(await crypto.subtle.sign("HMAC", key, textBytes(value)));
}

async function readLockout(env, subject) {
  const result = await coordinatorRequest(env, "login-status", { subject });
  if (!result.ok) throw new HttpError(503, "Login protection is unavailable. Try again.");
  return { locked: result.locked === true, underAttack: result.underAttack === true };
}

async function recordFailedLogin(env, subject, message) {
  const result = await coordinatorRequest(env, "login-failure", { subject });
  if (!result.ok) throw new HttpError(503, "Login protection is unavailable. Try again.");
  return result.locked
    ? json({ error: "Too many failed attempts. Try again later." }, 429)
    : json({ error: message }, 401);
}

async function clearFailedLogin(env, subject) {
  const result = await coordinatorRequest(env, "login-clear", { subject });
  if (!result.ok) throw new HttpError(503, "Login protection is unavailable. Try again.");
}

function validateCmsDocument(document, env) {
  const localeList = cmsLocales(env);
  const defaultLocale = String(env.CMS_DEFAULT_LOCALE ?? localeList[0]);
  const locales = new Set(localeList);
  const topLevelKeys = new Set(["version", "updatedAt", "site", "openingHours", "menuCategories"]);

  if (!isPlainObject(document)) {
    return { ok: false, error: "CMS document must be an object." };
  }

  for (const key of Object.keys(document)) {
    if (!topLevelKeys.has(key)) {
      return { ok: false, error: `Unsupported top-level key: ${key}` };
    }
  }

  if (document.version !== 1) {
    return { ok: false, error: "Unsupported CMS document version." };
  }

  const forbidden = findForbiddenField(document);
  if (forbidden) {
    return { ok: false, error: `Forbidden content field or value: ${forbidden}` };
  }

  if (!isPlainObject(document.site)) {
    return { ok: false, error: "Site info is required." };
  }

  const localizedFields = ["name", "tagline", "description", "metaTitle", "metaDescription"];
  for (const field of localizedFields) {
    if (document.site[field] && !validLocalizedText(document.site[field], locales)) {
      return { ok: false, error: `Invalid localized field: site.${field}` };
    }
  }
  if (!document.site.name || !validShortString(document.site.name[defaultLocale], 5000)) {
    return { ok: false, error: `Restaurant name is required in ${defaultLocale}.` };
  }

  if (!validCmsContactPhone(document.site.phone)) {
    return { ok: false, error: "Invalid phone number." };
  }
  if (!validCmsContactEmail(document.site.email)) {
    return { ok: false, error: "Invalid contact email address." };
  }
  if (document.site.address && !validPostalAddress(document.site.address)) {
    return { ok: false, error: "Invalid site field: site.address" };
  }

  if (document.site.googleMapsUrl && !validHttpUrl(document.site.googleMapsUrl)) {
    return { ok: false, error: "Invalid URL: site.googleMapsUrl" };
  }

  for (const field of ["bookingHref", "orderUrl", "reservationUrl", "instagramUrl", "facebookUrl"]) {
    if (document.site[field] && !validLinkTarget(document.site[field])) {
      return { ok: false, error: `Invalid link target: site.${field}` };
    }
  }

  for (const field of ["orderLinks", "socialLinks"]) {
    if (document.site[field] && !validLinks(document.site[field])) {
      return { ok: false, error: `Invalid links: site.${field}` };
    }
  }

  if (document.site.featuredDishes && !validFeaturedDishes(document.site.featuredDishes, locales, env)) {
    return { ok: false, error: "Invalid featured images." };
  }

  if (!Array.isArray(document.openingHours) || !Array.isArray(document.menuCategories)) {
    return { ok: false, error: "Opening hours and menu categories must be arrays." };
  }

  const seenDays = new Set();
  for (const hour of document.openingHours) {
    if (!isPlainObject(hour) || !validDay(hour.dayKey) || seenDays.has(hour.dayKey)) {
      return { ok: false, error: `Invalid day key: ${hour.dayKey}` };
    }
    seenDays.add(hour.dayKey);
    if (!Number.isInteger(hour.sortOrder) || hour.sortOrder < 0 || hour.sortOrder > 1000) {
      return { ok: false, error: `Invalid opening-hours order: ${hour.dayKey}` };
    }
    if (hour.note && !validLocalizedText(hour.note, locales)) {
      return { ok: false, error: `Invalid opening-hours note: ${hour.dayKey}` };
    }

    for (const field of ["lunchOpen", "lunchClose", "dinnerOpen", "dinnerClose"]) {
      if (hour[field] && !validTime(hour[field])) {
        return { ok: false, error: `Invalid time: ${field}` };
      }
    }
  }

  const categoryIds = new Set();
  const itemIds = new Set();
  for (const category of document.menuCategories) {
    if (!isPlainObject(category) || !validId(category.id) || categoryIds.has(category.id) || !validLocalizedText(category.title, locales)) {
      return { ok: false, error: "Invalid menu category." };
    }
    categoryIds.add(category.id);
    if (!Number.isInteger(category.sortOrder) || category.sortOrder < 0 || category.sortOrder > 1000) {
      return { ok: false, error: `Invalid menu category order: ${category.id}` };
    }
    if (category.description && !validLocalizedText(category.description, locales)) {
      return { ok: false, error: `Invalid category description: ${category.id}` };
    }

    if (!Array.isArray(category.items)) {
      return { ok: false, error: `Menu category ${category.id} needs an items array.` };
    }

    for (const item of category.items) {
      if (!isPlainObject(item) || !validId(item.id) || itemIds.has(item.id) || !validLocalizedText(item.name, locales)) {
        return { ok: false, error: `Invalid menu item in ${category.id}.` };
      }
      itemIds.add(item.id);
      if (!Number.isInteger(item.sortOrder) || item.sortOrder < 0 || item.sortOrder > 10000) {
        return { ok: false, error: `Invalid menu item order in ${category.id}.` };
      }

      if (item.description && !validLocalizedText(item.description, locales)) {
        return { ok: false, error: `Invalid item description in ${category.id}.` };
      }

      if (!validShortString(item.price, 80)) {
        return { ok: false, error: `Invalid item price in ${category.id}.` };
      }
    }
  }

  return { ok: true };
}

async function validateImageUploads(imageUploads, document, env) {
  if (!Array.isArray(imageUploads)) {
    return { ok: false, error: "Invalid image uploads." };
  }

  const dishes = Array.isArray(document.site?.featuredDishes) ? document.site.featuredDishes : [];
  const normalizedUploads = [];

  for (const upload of imageUploads) {
    if (!isPlainObject(upload)) {
      return { ok: false, error: "Invalid image upload." };
    }

    const dishId = String(upload.dishId ?? "");
    const path = String(upload.path ?? "");
    const previousPath = typeof upload.previousPath === "string" ? upload.previousPath : undefined;
    const file = upload.file;

    if (!validId(dishId) || !validCmsUploadPath(path, env)) {
      return { ok: false, error: "Invalid image upload path." };
    }

    const dish = dishes.find((item) => item.id === dishId);
    if (!dish || dish.image?.path !== path) {
      return { ok: false, error: "Image upload does not match the saved content." };
    }

    if (!isUploadedFile(file)) {
      return { ok: false, error: "Missing image file." };
    }

    if (!String(file.name ?? "").toLowerCase().endsWith(".avif")) {
      return { ok: false, error: "Only .avif images are allowed." };
    }

    if (file.type && file.type !== "image/avif") {
      return { ok: false, error: "Only AVIF image uploads are allowed." };
    }

    if (file.size <= 0 || file.size > Number(env.CMS_IMAGE_FILE_LIMIT_BYTES ?? DEFAULT_IMAGE_FILE_LIMIT)) {
      return { ok: false, error: "Image file is too large." };
    }

    const bytes = new Uint8Array(await file.arrayBuffer());
    if (!looksLikeAvif(bytes)) {
      return { ok: false, error: "Uploaded file is not a valid AVIF image." };
    }

    normalizedUploads.push({
      dishId,
      path,
      previousPath,
      bytes,
    });
  }

  return { ok: true, uploads: normalizedUploads };
}

function findForbiddenField(value, path = "") {
  const forbiddenKeys = new Set(["html", "script", "style", "class", "className", "layout", "component"]);

  if (Array.isArray(value)) {
    for (let index = 0; index < value.length; index += 1) {
      const nested = findForbiddenField(value[index], `${path}[${index}]`);
      if (nested) {
        return nested;
      }
    }
    return null;
  }

  if (isPlainObject(value)) {
    for (const [key, nestedValue] of Object.entries(value)) {
      if (forbiddenKeys.has(key)) {
        return path ? `${path}.${key}` : key;
      }

      const nested = findForbiddenField(nestedValue, path ? `${path}.${key}` : key);
      if (nested) {
        return nested;
      }
    }
    return null;
  }

  if (typeof value === "string") {
    if (value.length > 5000) {
      return path;
    }

    if (/[<>]|\b(?:class|style|on[a-z]+)\s*=/i.test(value)) {
      return path;
    }
  }

  return null;
}

function validLocalizedText(value, locales) {
  if (!isPlainObject(value)) {
    return false;
  }

  return Object.entries(value).every(
    ([key, text]) => locales.has(key) && typeof text === "string" && text.length <= 5000,
  );
}

function validLinks(value) {
  return (
    Array.isArray(value) &&
    value.length <= 20 &&
    value.every(
      (link) =>
        isPlainObject(link) &&
        validShortString(link.label, 80) &&
        validLinkTarget(link.href),
    )
  );
}

function validPostalAddress(value) {
  if (!isPlainObject(value)) return false;
  const allowed = new Set([
    "streetAddress",
    "postalCode",
    "addressLocality",
    "addressRegion",
    "addressCountry",
  ]);
  if (Object.keys(value).some((key) => !allowed.has(key))) return false;
  return (
    validShortString(value.streetAddress, 500) &&
    validShortString(value.postalCode, 40) &&
    validShortString(value.addressLocality, 200) &&
    validShortString(value.addressCountry, 2) &&
    (!value.addressRegion || validShortString(value.addressRegion, 200))
  );
}

function validFeaturedDishes(value, locales, env) {
  const configuredMaximum = Number(env.CMS_FEATURED_IMAGE_MAX_ITEMS ?? 12);
  const maximum = Number.isInteger(configuredMaximum) && configuredMaximum >= 0 && configuredMaximum <= 12
    ? configuredMaximum
    : 12;
  return (
    Array.isArray(value) &&
    value.length <= maximum &&
    value.every(
      (dish) =>
        isPlainObject(dish) &&
        validId(dish.id) &&
        validLocalizedText(dish.name, locales) &&
        Number.isInteger(dish.sortOrder) &&
        dish.sortOrder >= 0 &&
        dish.sortOrder <= 1000 &&
        isPlainObject(dish.image) &&
        validImagePath(dish.image.path, env) &&
        (!dish.image.alt || validLocalizedText(dish.image.alt, locales)),
    )
  );
}

function validImagePath(value, env) {
  if (typeof value !== "string" || value.length > 240 || value.includes("..") || value.includes("//")) {
    return false;
  }

  if (/^\/assets\/[a-z0-9][a-z0-9-]*\.(avif|webp|png|jpg|jpeg|svg)$/i.test(value)) {
    return true;
  }

  return validCmsUploadPath(value, env);
}

function validateCmsModulePolicy(document, currentDocument, env) {
  const modules = enabledCmsModules(env);
  const currentSite = currentDocument?.site ?? {};
  const nextSite = document.site ?? {};

  for (const field of ["metaTitle", "metaDescription"]) {
    if (!valuesEqual(nextSite[field], currentSite[field])) {
      return { ok: false, error: `The code-owned SEO field site.${field} cannot be changed in the CMS.` };
    }
  }

  const protectedGroups = [
    {
      enabled: modules.has("links"),
      label: "links",
      next: pick(nextSite, ["orderUrl", "reservationUrl", "instagramUrl", "facebookUrl", "orderLinks", "socialLinks"]),
      current: pick(currentSite, ["orderUrl", "reservationUrl", "instagramUrl", "facebookUrl", "orderLinks", "socialLinks"]),
    },
    {
      enabled: modules.has("featuredImages"),
      label: "featured images",
      next: nextSite.featuredDishes,
      current: currentSite.featuredDishes,
    },
    {
      enabled: modules.has("openingHours"),
      label: "opening hours",
      next: document.openingHours,
      current: currentDocument?.openingHours,
    },
    {
      enabled: modules.has("menu"),
      label: "menu",
      next: document.menuCategories,
      current: currentDocument?.menuCategories,
    },
  ];

  for (const group of protectedGroups) {
    if (!group.enabled && !valuesEqual(group.next, group.current)) {
      return { ok: false, error: `The disabled ${group.label} module cannot be changed.` };
    }
  }
  return { ok: true };
}

function enabledCmsModules(env) {
  const allowed = new Set(["restaurantInfo", "links", "openingHours", "menu", "featuredImages"]);
  const configured = String(env.CMS_MODULES ?? [...allowed].join(","))
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  return new Set(configured.filter((value) => allowed.has(value)));
}

function cmsLocales(env) {
  const configured = String(env.CMS_LOCALES ?? [env.CMS_DEFAULT_LOCALE ?? "it", env.CMS_SECONDARY_LOCALE ?? "en"].join(","))
    .split(",")
    .map((value) => value.trim())
    .filter((value) => /^[a-z]{2}(?:-[A-Z]{2})?$/.test(value));
  return [...new Set(configured)].slice(0, 4).length > 0
    ? [...new Set(configured)].slice(0, 4)
    : ["it"];
}

function pick(value, keys) {
  return Object.fromEntries(keys.filter((key) => value[key] !== undefined).map((key) => [key, value[key]]));
}

function valuesEqual(left, right) {
  return stableStringify(left) === stableStringify(right);
}

function equivalentCmsContent(left, right) {
  if (!isPlainObject(left) || !isPlainObject(right)) return false;
  return valuesEqual({ ...left, updatedAt: undefined }, { ...right, updatedAt: undefined });
}

async function saveFingerprint(document, expectedContentSha, uploads) {
  const imageFingerprints = [];
  for (const upload of uploads) {
    imageFingerprints.push({
      dishId: upload.dishId,
      path: upload.path,
      previousPath: upload.previousPath,
      sha256: await sha256Hex(upload.bytes),
    });
  }
  imageFingerprints.sort((left, right) => left.dishId.localeCompare(right.dishId));
  return sha256Hex(
    textBytes(
      stableStringify({
        content: { ...document, updatedAt: undefined },
        expectedContentSha: expectedContentSha ?? null,
        images: imageFingerprints,
      }),
    ),
  );
}

async function sha256Hex(bytes) {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
  return Array.from(digest, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function stableStringify(value) {
  if (value === undefined) return "undefined";
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  return `{${Object.keys(value)
    .filter((key) => value[key] !== undefined)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`)
    .join(",")}}`;
}

function validIdempotencyKey(value) {
  return typeof value === "string" && /^[a-zA-Z0-9][a-zA-Z0-9_-]{15,127}$/.test(value);
}

function coordinatorFailureResponse(result) {
  if (result.code === "quota_exhausted") {
    return json({ error: "Monthly publish limit reached." }, 429);
  }
  if (result.code === "publish_in_progress") {
    return json({ error: "Another publish is already in progress. Try again shortly." }, 409);
  }
  if (["idempotency_conflict", "commit_conflict"].includes(result.code)) {
    return json({ error: "This publish identifier was already used for different content." }, 409);
  }
  return json({ error: "The publish coordinator rejected this request. Try again." }, 503);
}

function missingBaseConfig(env) {
  return missing(env, ["AUTH_SECRET", "ADMIN_EMAIL", "SITE_ID"]);
}

function missingAuthConfig(env) {
  return missing(env, [
    "AUTH_SECRET",
    "ADMIN_EMAIL",
    "ADMIN_PASSWORD_VERIFIER",
    "ADMIN_TOTP_SECRET_BASE32",
    "SITE_ID",
    "CMS_COORDINATOR_URL",
    "CMS_COORDINATOR_TOKEN",
  ]);
}

function missingGitHubReadConfig(env) {
  return missing(env, ["SITE_ID", "GITHUB_OWNER", "GITHUB_REPO", "GITHUB_BRANCH", "GITHUB_CONTENT_TOKEN"]);
}

function missingGitHubWriteConfig(env) {
  return missing(env, [
    "SITE_ID",
    "GITHUB_OWNER",
    "GITHUB_REPO",
    "GITHUB_BRANCH",
    "GITHUB_CONTENT_TOKEN",
    "CMS_COORDINATOR_URL",
    "CMS_COORDINATOR_TOKEN",
  ]);
}

function missing(env, keys) {
  return keys.filter((key) => !env[key]);
}

function githubContentUrl(env) {
  return githubFileUrl(env, cmsContentPath(env), true);
}

function githubFileUrl(env, path, includeRef = false) {
  const encodedPath = path.split("/").map(encodeURIComponent).join("/");
  const owner = encodeURIComponent(env.GITHUB_OWNER);
  const repo = encodeURIComponent(env.GITHUB_REPO);
  const branch = encodeURIComponent(env.GITHUB_BRANCH);

  const baseUrl = `https://api.github.com/repos/${owner}/${repo}/contents/${encodedPath}`;
  return includeRef ? `${baseUrl}?ref=${branch}` : baseUrl;
}

function cmsContentPath(env) {
  const expected = `content/sites/${env.SITE_ID}/content.json`;
  const path = String(env.CMS_CONTENT_PATH ?? expected);

  if (path !== expected || path.startsWith("/") || path.includes("..")) {
    throw new HttpError(500, "Invalid CMS content path.");
  }

  return path;
}

function githubHeaders(token) {
  return {
    Accept: "application/vnd.github+json",
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
    "User-Agent": "chiuel-restaurant-cms",
    "X-GitHub-Api-Version": GITHUB_API_VERSION,
  };
}

function currentUtcMonth() {
  return new Date().toISOString().slice(0, 7);
}

async function loginThrottleSubject(request, env) {
  const ip = request.headers.get("CF-Connecting-IP") ?? "unknown-ip";
  return bytesToHex(await hmacSha256(env.AUTH_SECRET, `${env.SITE_ID}:${ip}`));
}

function sameOrigin(request) {
  const origin = request.headers.get("Origin");

  if (!origin) {
    return true;
  }

  try {
    return new URL(origin).origin === new URL(request.url).origin;
  } catch {
    return false;
  }
}

function normalizeRoute(path) {
  if (Array.isArray(path)) {
    return path.join("/");
  }

  return String(path ?? "").replace(/^\/+|\/+$/g, "");
}

function json(body, status = 200, headers = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      ...headers,
    },
  });
}

function serializeCookie(name, value, maxAge) {
  return `${name}=${value}; Path=/; Max-Age=${maxAge}; HttpOnly; SameSite=Lax; Secure`;
}

function parseCookies(header) {
  return Object.fromEntries(
    header
      .split(";")
      .map((part) => part.trim())
      .filter(Boolean)
      .map((part) => {
        const index = part.indexOf("=");
        return [part.slice(0, index), part.slice(index + 1)];
      }),
  );
}

function validDay(day) {
  return [
    "monday",
    "tuesday",
    "wednesday",
    "thursday",
    "friday",
    "saturday",
    "sunday",
  ].includes(day);
}

function validTime(value) {
  return /^([01][0-9]|2[0-3]):[0-5][0-9]$/.test(value);
}

function validId(value) {
  return typeof value === "string" && /^[a-z0-9][a-z0-9-]{0,80}$/.test(value);
}

function validShortString(value, limit) {
  return typeof value === "string" && value.length <= limit;
}

function validHttpUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:";
  } catch {
    return false;
  }
}

function validLinkTarget(value) {
  if (typeof value !== "string" || value.length > 1000) {
    return false;
  }

  if (value.startsWith("#") || value.startsWith("/")) {
    return true;
  }

  try {
    const url = new URL(value);
    return ["https:", "http:", "tel:", "mailto:"].includes(url.protocol);
  } catch {
    return false;
  }
}

function validCmsUploadPath(value, env) {
  const siteId = String(env.SITE_ID ?? "");
  if (!validId(siteId)) {
    return false;
  }

  const escapedSiteId = siteId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`^/uploads/cms/${escapedSiteId}/featured/[a-z0-9][a-z0-9_-]{0,96}\\.avif$`, "i").test(value);
}

function activeCmsImagePaths(document) {
  const paths = new Set();

  for (const dish of document.site?.featuredDishes ?? []) {
    if (typeof dish.image?.path === "string") {
      paths.add(dish.image.path);
    }
  }

  return paths;
}

function looksLikeAvif(bytes) {
  if (bytes.length < 16) {
    return false;
  }

  const header = new TextDecoder("ascii").decode(bytes.slice(4, Math.min(bytes.length, 32)));
  return header.startsWith("ftyp") && ["avif", "avis", "mif1", "msf1"].some((brand) => header.includes(brand));
}

function isUploadedFile(value) {
  return Boolean(
    value &&
      typeof value === "object" &&
      typeof value.arrayBuffer === "function" &&
      typeof value.size === "number",
  );
}

function stringFormValue(value) {
  return typeof value === "string" && value ? value : undefined;
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function textBytes(value) {
  return new TextEncoder().encode(value);
}

function base64ToBytes(value) {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);

  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }

  return bytes;
}

function bytesToBase64(bytes) {
  let binary = "";

  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }

  return btoa(binary);
}

function bytesToHex(bytes) {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function readBodyBytes(request, limit, message) {
  if (!Number.isInteger(limit) || limit < 1) {
    throw new HttpError(500, "Invalid request body limit.");
  }
  const declaredHeader = request.headers.get("Content-Length");
  if (declaredHeader !== null) {
    const declaredLength = Number(declaredHeader);
    if (!Number.isFinite(declaredLength) || declaredLength < 0 || declaredLength > limit) {
      throw new HttpError(413, message);
    }
  }
  if (!request.body) return new Uint8Array();

  const reader = request.body.getReader();
  const chunks = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > limit) {
      await reader.cancel();
      throw new HttpError(413, message);
    }
    chunks.push(value);
  }

  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

function base64UrlEncode(bytes) {
  return bytesToBase64(bytes).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function base64UrlDecode(value) {
  const padded = `${value}${"=".repeat((4 - (value.length % 4)) % 4)}`;
  return base64ToBytes(padded.replace(/-/g, "+").replace(/_/g, "/"));
}

function base32ToBytes(value) {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  const clean = String(value).replace(/=+$/g, "").replace(/\s/g, "").toUpperCase();
  let bits = "";

  for (const char of clean) {
    const index = alphabet.indexOf(char);
    if (index === -1) {
      throw new Error("Invalid TOTP secret.");
    }
    bits += index.toString(2).padStart(5, "0");
  }

  const bytes = [];
  for (let index = 0; index + 8 <= bits.length; index += 8) {
    bytes.push(parseInt(bits.slice(index, index + 8), 2));
  }

  return new Uint8Array(bytes);
}

function timingSafeEqual(left, right) {
  if (left.length !== right.length) {
    return false;
  }

  let diff = 0;
  for (let index = 0; index < left.length; index += 1) {
    diff |= left[index] ^ right[index];
  }

  return diff === 0;
}

function safeErrorMessage(error) {
  if (error instanceof Error) {
    return error.message;
  }

  return "Unknown error.";
}

class HttpError extends Error {
  constructor(status, publicMessage) {
    super(publicMessage);
    this.name = "HttpError";
    this.status = status;
    this.publicMessage = publicMessage;
  }
}
