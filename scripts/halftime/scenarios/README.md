# Replay scenarios

Each file is a recorded/synthetic matchday: what SportMonks would have served, minute
by minute, if we could watch it. `replay-server.mjs` serves them; the poller and the
Vercel watchdog run **unmodified** against it (the only seam is `SPORTMONKS_BASE_URL`).

## The clock

Every offset is in **nominal minutes** from T0 (the moment the replay server starts).
`--scale N` compresses them: at `--scale 60`, one nominal minute takes one real second,
so a full Saturday replays in a few minutes. The poller is given the same scale via
`HALFTIME_SCALE`, which divides *its* durations (lineup lead, veto window, assembly
lead, poll cadence) by the same factor. At `--scale 1` everything is real time.

Fixture kickoffs are served as **real ISO timestamps** (`T0 + kickoff_min/scale`), so
nothing in the app or the poller has to know a replay is happening.

## Shape

```jsonc
{
  "name": "normal-match",
  "fixtures": [
    {
      "id": 19427455,                 // SportMonks-shaped fixture id
      "home": "Arsenal",
      "away": "Coventry City",
      "season_id": 28083,             // 2026/27 PL
      "round": "Round 1",
      "kickoff_min": 90,              // scheduled kickoff, nominal minutes from T0
      "lineups_at_min": 30,           // when confirmed XIs publish (null = never)
      "timeline": [
        { "at_min": 0,   "state": "NS" },                 // developer_name, never an id
        { "at_min": 90,  "state": "INPLAY_1ST_HALF" },
        { "at_min": 137, "state": "HT" },                 // the real whistle: KO+47'
        { "at_min": 152, "state": "INPLAY_2ND_HALF" },
        { "at_min": 200, "state": "FT" }
      ],
      "kickoff_shift": { "at_min": 50, "to_min": 110 }    // optional: KO moved
    }
  ]
}
```

States are named by `developer_name` and resolved through the real
`GET /v3/football/states` catalogue (`states.json`, pulled from the live API), so a
scenario can never accidentally hardcode a wrong state id — the same property the
production code relies on.

## The standard timeline (nominal minutes)

| min | what |
|---|---|
| 0 | poller starts (T0) |
| 15 | T-75: lineup watch opens |
| 30 | T-60: confirmed XIs land → fresh slice → veto message |
| 80 | T-10: veto deadline → assemble → `staged` |
| 90 | kickoff |
| 137 | **half time** (KO+47' — not KO+45') |
| 152 | second half |
| 200 | full time |
