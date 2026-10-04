/**
 * Loads server-side settings from the project's .env.local (git-ignored) into
 * process.env before anything else reads them — e.g. RESEND_API_KEY, EMAIL_FROM,
 * APP_URL. Variables already set in the environment take precedence.
 * Must be the first import in server/index.js.
 */

import { existsSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const envFile = join(dirname(fileURLToPath(import.meta.url)), '..', '.env.local');
if (existsSync(envFile)) process.loadEnvFile(envFile);
