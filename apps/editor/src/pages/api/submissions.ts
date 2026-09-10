import type { APIRoute } from 'astro'

import { createSubmission } from '../../server/github/submission.ts'
import { handleSubmissionRequest } from '../../server/submissions/http.ts'

const handle: APIRoute = ({ request }) =>
  handleSubmissionRequest(request, {
    createSubmission,
    isProduction: import.meta.env.PROD,
    logError: (message, fields) => console.error(message, fields),
  })

// This route intentionally remains a static-output development endpoint until real authentication
// and a production server adapter are introduced. The production guard is also enforced in the handler.
export const POST = handle
export const ALL = handle
