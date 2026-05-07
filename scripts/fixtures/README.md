# Test fixtures

`snapshot.json` is a real-data snapshot used by
`scripts/test-forecast-parity.mjs` to verify that the case-modal forecast
strip produces the same verdict the Efficiency screen does.

## Regenerating the snapshot

The snapshot is a JSON object with two keys:

```jsonc
{
  "cases": [/* every non-archived row from the cases table */],
  "history_845": [/* case_history rows for one focal case (case 845) */]
}
```

It's small (~230 KB) because it only carries case_history for one focal
case — peer cases don't need history attached for the parity check we do
here (we're verifying `concurrent`, not stage-timing trends).

To refresh against the live database, run this SQL via the Supabase MCP
or `psql` and write the result to `scripts/fixtures/snapshot.json`:

```sql
SELECT json_build_object(
  'cases', (SELECT jsonb_agg(jsonb_build_object(
    'id', id, 'casenumber', casenumber, 'due', due, 'completed', completed,
    'created_at', created_at, 'department', department, 'modifiers', modifiers,
    'priority', priority, 'hold_started', hold_started, 'archived', archived
  ) ORDER BY due) FROM cases WHERE archived = false),
  'history_845', (
    SELECT jsonb_agg(row_to_json(h) ORDER BY h.created_at DESC)
    FROM case_history h
    JOIN cases c ON c.id = h.case_id
    WHERE c.casenumber = '845' AND c.archived = false
  )
) AS snapshot;
```

To use a different focal case, edit the `WHERE c.casenumber = '845'`
clause (or extend `history_*` with more cases).
