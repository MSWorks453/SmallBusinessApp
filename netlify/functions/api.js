/**
 * netlify/functions/api.js
 * Wraps the backend's Express app (backend/app.js) so it runs as a single
 * Netlify Function. Exposed at /api/* via the redirect in netlify.toml.
 */

const serverless = require('serverless-http');
const app = require('../../backend/app');

exports.handler = serverless(app);
