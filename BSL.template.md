# Business Source License 1.1 — Clipkit parameters

Two packages carry the BSL: `packages/runtime` and
`packages/render-service`. Each package's `LICENSE` file contains the
parameters below (with its own `Licensed Work` name), followed by a
pointer to the canonical BSL 1.1 text:

> https://mariadb.com/bsl11/

The BSL is designed to be parameterized — you pin the four values below
and inherit the rest of the license verbatim. **Never edit the canonical
text**; the parameters are the only customization the BSL permits.

## Parameters

```
Licensor:              Clipkit Contributors

Licensed Work:         @clipkit/runtime  (or @clipkit/render-service)
                       The Licensed Work is (c) 2026 Clipkit Contributors

Additional Use Grant:  You may make production use of the Licensed
                       Work, provided that:

                       (a) you do not use the Licensed Work for a
                           Competing Service; and

                       (b) your Total Rendered Output does not exceed
                           250 minutes in any calendar month, unless
                           that use is covered by a separate commercial
                           license from the Licensor.

                       A "Competing Service" is a commercial product or
                       service offered to third parties that provides
                       Clipkit Protocol video rendering as a service
                       (whether offered as software-as-a-service, a
                       hosted API, or any similar offering whose primary
                       purpose is providing rendering of Clipkit
                       Protocol documents). A Competing Service is not
                       permitted at any volume.

                       "Total Rendered Output" means the total duration,
                       in minutes of finished video, rendered using the
                       Licensed Work in production by or for your
                       organization and its affiliates, across all
                       deployments combined. Renders performed for
                       development, testing, evaluation, or
                       demonstration are not production use and do not
                       count toward Total Rendered Output.

                       The volume limit in (b) does not apply to:
                         - personal, educational, or research use
                         - non-commercial open-source projects

                       [runtime LICENSE additionally lists the
                       for-clarity permitted uses: embedding (incl. as
                       an @clipkit/editor dependency), rendering for
                       your own product/customers, internal use, and
                       independent protocol implementations]

Change Date:           Four years from the date the Licensed Work is
                       published.

Change License:        Apache License, Version 2.0
```

## Grant history

- **v1 (shipped in @clipkit/runtime 1.0.0–1.3.1, 2026-06-26):**
  everything permitted except a Competing Service — no volume tier.
  Versions published under v1 keep that grant forever.
- **v2 (2026-08-04, ships with the next publish):** adds the
  250-minutes/month production free tier; above it, production use
  requires a commercial license. Motivation: monetize commercial-scale
  self-hosters (the Remotion/HyperFrames-replacement segment) while
  keeping small/indie/non-commercial use free. Threshold picked by Ian
  (over 500/1,000/2,000 options). See `ENTERPRISE-LICENSE-PLAN.md`.

## How to apply

1. Keep the parameters at the top of each package's `LICENSE`.
2. Follow them with the pointer to the canonical BSL 1.1 text at
   https://mariadb.com/bsl11/.
3. In each package's `package.json`, keep:
   - `"license": "SEE LICENSE IN ./LICENSE"`
   - (npm does not recognize BSL-1.1 as a SPDX identifier, so the
     license field points at the file instead.)

## Per-release change date

The Change Date pins to *each release* of the Licensed Work. In
practice this means: when you cut version 1.0.0 on date D, the
v1.0.0 source becomes Apache-2.0 on D + 4 years; when you cut
v1.1.0 on date D', that release becomes Apache-2.0 on D' + 4 years.

The recommended workflow is to update the Licensor / Change Date
line at release time (e.g. via a release script that rewrites the
LICENSE header).

## Why this license

See [LICENSING.md](./LICENSING.md) for the full rationale. Short
version: BSL gives us a four-year window where competitors cannot
fork the render-service code to undercut our hosted rendering
business, while preserving every other open-source freedom and
auto-converting to Apache-2.0 afterward.

## Resources

- BSL 1.1 canonical text: https://mariadb.com/bsl11/
- BSL FAQ: https://mariadb.com/bsl-faq-mariadb/
- BSL adopters: CockroachDB, MariaDB Enterprise, Couchbase, HashiCorp
  Terraform (pre-2023)
