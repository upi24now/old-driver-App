---
name: PG parameterized-query casts
description: node-postgres parameters used inside CASE/COALESCE/boolean contexts need explicit ::type casts.
---

# "could not determine data type of parameter $N"

When a node-postgres parameter is referenced in a position where Postgres cannot
infer its type — e.g. inside a `CASE WHEN $4 IS NULL ...` expression, or both as a
boolean test and as a value — the prepared statement fails with
`could not determine data type of parameter $N`. This fires for ALL rows, even
non-null values, because it is a planning-time type-inference error, not a data error.

**Fix:** add explicit casts in the SQL text, e.g. `$4::text`, `$5::timestamptz`,
`$6::double precision`, `$7::integer`, `$8::boolean`. Cast every parameter that the
planner can't infer from its column position (those wrapped in CASE/COALESCE/etc.).

**How to apply:** any raw `pool.query(sql, params)` that uses a `$N` inside a CASE,
COALESCE, or boolean predicate — cast it at the call site.
