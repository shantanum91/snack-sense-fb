/**
 * Import function triggers from their respective submodules:
 *
 * import {onCall} from "firebase-functions/v2/https";
 * import {onDocumentWritten} from "firebase-functions/v2/firestore";
 *
 * See a full list of supported triggers at https://firebase.google.com/docs/functions
 */

import { onRequest } from "firebase-functions/v2/https";
import { defineSecret } from "firebase-functions/params";
import * as logger from "firebase-functions/logger";
import { getAuth } from "firebase-admin/auth";
import { initializeApp } from "firebase-admin/app";

initializeApp();

// OpenAI API key, stored server-side as a Firebase secret.
// Set it with:  firebase functions:secrets:set OPENAI_KEY
const OPENAI_KEY = defineSecret("OPENAI_KEY");

const OPENAI_URL = "https://api.openai.com/v1/chat/completions";

export const getAppVersion = onRequest({ cors: true }, (req, res) => {
    logger.info("Retriving app version", { structuredData: true });
    res.json({ latestVersion: "1.0.16" });
});

/**
 * Thin proxy to the OpenAI Chat Completions API.
 *
 * The client sends the exact same request body it used to send directly to
 * OpenAI (model, messages, response_format, etc.). This function injects the
 * secret API key server-side and forwards the request, returning OpenAI's
 * response verbatim so the client parsing (choices[0].message.content) is
 * unchanged.
 *
 * Protected by Firebase Auth: requests must carry a valid Firebase ID token in
 * the "Authorization: Bearer <token>" header, proving the caller is a
 * signed-in user. Enforced only when ENFORCE_AUTH is "true" so the endpoint
 * can be rolled out before every shipped client sends a token.
 */
export const openaiProxy = onRequest(
    {
        cors: true,
        secrets: [OPENAI_KEY],
        // base64 image payloads can be several MB; give room for request +
        // model work.
        memory: "512MiB",
        timeoutSeconds: 120,
    },
    async (req, res) => {
        if (req.method !== "POST") {
            res.status(405).json({ error: "Method not allowed" });
            return;
        }

        // Firebase Auth ID token verification.
        // - Skipped entirely in the local emulator.
        // - In production, a missing token is rejected only when ENFORCE_AUTH
        //   is "true" (roll-out switch). A token that IS present is always
        //   verified, and an invalid one is always rejected.
        const isEmulator = process.env.FUNCTIONS_EMULATOR === "true";
        const enforceAuth = process.env.ENFORCE_AUTH === "true";
        if (!isEmulator) {
            const authHeader = req.header("Authorization") || "";
            const match = authHeader.match(/^Bearer\s+(.+)$/i);
            const idToken = match?.[1];
            if (!idToken) {
                if (enforceAuth) {
                    logger.warn("Missing ID token");
                    res.status(401).json({ error: "Unauthorized: sign-in required" });
                    return;
                }
            } else {
                try {
                    await getAuth().verifyIdToken(idToken);
                } catch (err) {
                    logger.warn("Invalid ID token", { error: String(err) });
                    res.status(401).json({ error: "Unauthorized: invalid token" });
                    return;
                }
            }
        }

        const body = req.body;
        if (!body || typeof body !== "object" || !Array.isArray(body.messages)) {
            res.status(400).json({ error: "Bad request: expected an OpenAI chat body with messages" });
            return;
        }

        try {
            const openaiRes = await fetch(OPENAI_URL, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${OPENAI_KEY.value()}`,
                },
                body: JSON.stringify(body),
            });

            const text = await openaiRes.text();
            // Pass OpenAI's status and body straight through.
            res.status(openaiRes.status);
            res.set("Content-Type", "application/json");
            res.send(text);
        } catch (err) {
            logger.error("OpenAI request failed", { error: String(err) });
            res.status(502).json({ error: "Upstream OpenAI request failed" });
        }
    }
);
