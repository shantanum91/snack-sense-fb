/**
 * Import function triggers from their respective submodules:
 *
 * import {onCall} from "firebase-functions/v2/https";
 * import {onDocumentWritten} from "firebase-functions/v2/firestore";
 *
 * See a full list of supported triggers at https://firebase.google.com/docs/functions
 */

import { onRequest } from "firebase-functions/v2/https";
import * as logger from "firebase-functions/logger";

export const getAppVersion = onRequest({ cors: true }, (req, res) => {
    logger.info("Retriving app version", { structuredData: true });
    res.json({ latestVersion: "1.0.12" });
}); 