# Business Source License 1.1 — Clipkit parameters

When `packages/render-service` is created, its `LICENSE` file should
contain the parameters below, followed by the canonical BSL 1.1 text
available at:

> https://mariadb.com/bsl11/

The BSL is designed to be parameterized — you pin the four values below
and inherit the rest of the license verbatim.

## Parameters

```
Licensor:              Clipkit Contributors

Licensed Work:         @clipkit/render-service
                       The Licensed Work is (c) 2026 Clipkit Contributors

Additional Use Grant:  You may make use of the Licensed Work, provided
                       that you do not use the Licensed Work for a
                       Competing Service.

                       A "Competing Service" is a commercial product or
                       service offered to third parties that provides
                       Clipkit Protocol video rendering as a service
                       (whether offered as software-as-a-service, a
                       hosted API, or any similar offering whose primary
                       purpose is providing rendering of Clipkit
                       Protocol documents).

                       For clarity, the following uses are NOT a
                       Competing Service and ARE permitted:
                         - rendering videos for your own product or app
                         - rendering videos for your own customers as
                           part of a broader product offering
                         - internal use within an organization
                         - personal, educational, or research use
                         - non-commercial open-source projects

Change Date:           Four years from the date the Licensed Work is
                       published.

Change License:        Apache License, Version 2.0
```

## How to apply

When the `packages/render-service` directory is created:

1. Create `packages/render-service/LICENSE`.
2. Paste the four parameters above at the top.
3. Append the canonical BSL 1.1 text from
   https://mariadb.com/bsl11/.
4. In `packages/render-service/package.json`, set:
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
