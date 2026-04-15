/**
 * jotformWebhookRelay.js — Jotform → GitHub repository_dispatch Relay
 * ────────────────────────────────────────────────────────────────────
 * A lightweight serverless function that receives Jotform webhook POSTs
 * and forwards them as GitHub `repository_dispatch` events.
 *
 * Deploy to: Cloudflare Workers, AWS Lambda, Vercel Edge Function,
 *            or any serverless platform.
 *
 * Environment Variables Required:
 *   GITHUB_TOKEN      — GitHub PAT with `repo` scope (or fine-grained: contents + pull-requests)
 *   GITHUB_OWNER      — Repository owner (e.g., "UAA-IPCE")
 *   GITHUB_REPO       — Repository name (e.g., "UAA-CACHE-StaticSite-v101")
 *   WEBHOOK_SECRET    — Shared secret for verifying Jotform requests (optional but recommended)
 *
 * Jotform Webhook Setup:
 *   1. In your Jotform form → Settings → Integrations → Webhooks
 *   2. Add webhook URL pointing to this function
 *   3. Jotform sends POST with form data as application/x-www-form-urlencoded or JSON
 *
 * ─────────────────────────────────────────────────────────────────────
 *
 * EXAMPLE: Cloudflare Worker
 *
 *   export default {
 *     async fetch(request, env) {
 *       return handleJotformWebhook(request, env);
 *     }
 *   };
 *
 * EXAMPLE: Express.js / Node.js
 *
 *   app.post("/webhook/jotform", async (req, res) => {
 *     const result = await handleJotformWebhook(req.body, {
 *       GITHUB_TOKEN: process.env.GITHUB_TOKEN,
 *       GITHUB_OWNER: process.env.GITHUB_OWNER,
 *       GITHUB_REPO:  process.env.GITHUB_REPO,
 *     });
 *     res.status(result.status).json(result.body);
 *   });
 */

// ─── Core Handler (platform-agnostic) ───────────────────────

export async function handleJotformWebhook(payload, env) {
  const { GITHUB_TOKEN, GITHUB_OWNER, GITHUB_REPO, WEBHOOK_SECRET } = env;

  if (!GITHUB_TOKEN || !GITHUB_OWNER || !GITHUB_REPO) {
    return {
      status: 500,
      body: { error: "Missing required environment variables" },
    };
  }

  // Parse payload — Jotform can send as form-encoded or JSON
  let formData;
  if (typeof payload === "string") {
    try {
      formData = JSON.parse(payload);
    } catch {
      // Try URL-encoded
      formData = Object.fromEntries(new URLSearchParams(payload));
    }
  } else {
    formData = payload;
  }

  // If Jotform sends nested rawRequest, parse it
  if (formData.rawRequest && typeof formData.rawRequest === "string") {
    try {
      formData.rawRequest = JSON.parse(formData.rawRequest);
    } catch {
      // keep as string
    }
  }

  // Basic validation — must have some identifiable content
  const title =
    formData.trainingTitle || formData.training_title || formData.title ||
    formData.courseName || formData.course_name || "";

  if (!title) {
    return {
      status: 400,
      body: { error: "Submission missing training title" },
    };
  }

  // Forward to GitHub as repository_dispatch
  const dispatchUrl = `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/dispatches`;

  const response = await fetch(dispatchUrl, {
    method: "POST",
    headers: {
      "Accept": "application/vnd.github+json",
      "Authorization": `Bearer ${GITHUB_TOKEN}`,
      "X-GitHub-Api-Version": "2025-01-01",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      event_type: "jotform-training-submission",
      client_payload: {
        ...formData,
        _relay: {
          relayed_at: new Date().toISOString(),
          source: "jotform-webhook-relay",
        },
      },
    }),
  });

  if (response.status === 204) {
    console.log(`✅ Dispatched training submission: "${title}"`);
    return {
      status: 200,
      body: {
        success: true,
        message: `Training submission "${title}" forwarded to GitHub for review.`,
      },
    };
  } else {
    const errorText = await response.text();
    console.error(`❌ GitHub dispatch failed (${response.status}): ${errorText}`);
    return {
      status: 502,
      body: {
        error: "Failed to forward submission to GitHub",
        detail: `GitHub API returned ${response.status}`,
      },
    };
  }
}

// ─── Cloudflare Worker Adapter ──────────────────────────────

export default {
  async fetch(request, env) {
    // Only accept POST
    if (request.method !== "POST") {
      return new Response(JSON.stringify({ error: "Method not allowed" }), {
        status: 405,
        headers: { "Content-Type": "application/json" },
      });
    }

    // Parse request body
    const contentType = request.headers.get("content-type") || "";
    let payload;
    if (contentType.includes("application/json")) {
      payload = await request.json();
    } else {
      payload = await request.text();
    }

    const result = await handleJotformWebhook(payload, env);
    return new Response(JSON.stringify(result.body), {
      status: result.status,
      headers: { "Content-Type": "application/json" },
    });
  },
};

// ─── Express.js Adapter (if using Node.js server) ───────────

export function expressHandler(req, res) {
  handleJotformWebhook(req.body, process.env).then((result) => {
    res.status(result.status).json(result.body);
  });
}
