# AI Usage

I used **Claude Code** (CLI) as a productivity tool during this take-home test.

The **concept, application flow, business logic, functional requirements, and technical decisions were mine**. I used AI mainly to help implement my ideas faster, generate repetitive code and tests, explore edge cases, and prepare documentation.

I always reviewed the generated output and corrected it when it did not match my requirements or environment.

The biggest time saving was the **concurrency testing**. Claude Code helped me quickly create tests for scenarios such as 10 families trying to pay for the last seat simultaneously, including idempotency and double-click cases. These tests run against the real MySQL database rather than mocks.

I also deliberately kept a clear boundary between AI-assisted development and the server environment. **I did not use AI directly on the server or give AI access to the server environment, source data, credentials, or production information.** Server-side setup, configuration, deployment, inspection, and verification were performed manually by me. I prefer this approach because infrastructure and server access require direct human control, particularly where sensitive data or credentials may be involved.

There were also several cases where I corrected the AI:

- **Ports:** the initial configuration used `80` and `3306`, which conflicted with XAMPP on my machine. I changed them to `8080` and `3307`, configurable through `.env`, with MySQL bound to localhost.
- **Duplicate prevention:** the initial suggestion used a partial unique index, which is not supported by MySQL in this form. I changed it to a stored generated column with a unique index.
- **Idempotency:** the first UI version generated a new idempotency key after every attempt. I changed this so the key is retained when the previous request has an unknown outcome, preventing a retry from potentially creating a duplicate payment.

## How I verified the result

- Integration tests against MySQL 8.4
- Concurrent booking and last-seat race-condition tests
- Idempotency and payment-failure tests
- `npm run demo:race` through nginx
- Manual testing with two browser tabs
- `/admin` and `/api/admin/invariants`
- `tsc --noEmit`
- `next build`

All final checks passed.

**In short, AI accelerated my implementation, but the concept, flow, mechanisms, engineering decisions, and server-side operations remained fully under my control.**
