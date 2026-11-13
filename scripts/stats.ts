/**
 * Reads the play logs and the feedback (DESIGN.md 20.1, 20.2) and prints
 * reports for finding what to improve. Read only: it runs SELECTs through
 * `wrangler d1 execute` and writes nothing. Nothing it prints names a player:
 * accounts appear only as the first 8 characters of their ID, to tell one
 * player's rows from another's.
 *
 *   npm run stats -- <report> [--env local|dev|production] [--days N]
 *                    [--difficulty easy|normal|hard] [--limit N]
 *
 * Reports:
 *   summary   per difficulty: attempts, clears, abandons, time, hints, assist
 *   stuck     the boards players stared at for a minute or more, and the
 *             technique the next step needed there (by replaying the logs)
 *   hints     what the hints players asked for were about
 *   abandon   where abandoned attempts stopped: progress and next technique
 *   feedback  the newest feedback with what the game was showing
 *   log <playId>  one attempt's events, as a timeline
 *
 * Reading dev or production reads a remote database: ask the user first
 * (AGENTS.md 「プレイログと感想」).
 */
import { execFileSync } from "node:child_process";
import { boardGeometry } from "../src/core/board";
import { generatePuzzle } from "../src/core/generator";
import { findHint, hintLabel } from "../src/core/hint";
import { isPlayId } from "../src/core/attempt";
import {
  DIFFICULTIES,
  type Puzzle,
  LINE,
  isDifficulty,
} from "../src/core/model";
import { type PlayLogEvent, isPlayLogEvent } from "../src/core/play-log";
import { percentile, replayPlayLog } from "../src/core/play-log-analysis";
import { parseSeedCode } from "../src/core/seed-code";

/** A wait this long on one board counts as being stuck. */
const STALL_MS = 60_000;
const PAGE_SIZE = 200;

// --- arguments ------------------------------------------------------------------

const args = process.argv.slice(2);
const report = args[0];

function option(name: string): string | undefined {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
}

const env = option("env") ?? "local";
if (!["local", "dev", "production"].includes(env)) {
  throw new Error(`Unknown --env ${env}: local, dev or production.`);
}
const days = Number(option("days") ?? 30);
const since = Date.now() - days * 86_400_000;
const difficulty = option("difficulty");
if (difficulty && !isDifficulty(difficulty)) {
  throw new Error(`Unknown --difficulty ${difficulty}.`);
}
const limit = Number(option("limit") ?? 30);

// --- reading D1 -----------------------------------------------------------------

const target = env === "local" ? ["--local"] : ["--env", env, "--remote"];

/** Runs one SELECT; retried once, since D1 sometimes fails for a moment. */
function query<T>(sql: string): T[] {
  const run = () =>
    execFileSync(
      "npx",
      [
        "wrangler",
        "d1",
        "execute",
        "DB",
        ...target,
        "--json",
        "--command",
        sql,
      ],
      {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
        maxBuffer: 1 << 28,
      },
    );
  let output: string;
  try {
    output = run();
  } catch {
    output = run();
  }
  const [result] = JSON.parse(output) as { results: T[] }[];
  return result.results;
}

/** Every row, a page at a time by rowid. */
function pages<T extends { row: number }>(sql: (after: number) => string): T[] {
  const rows: T[] = [];
  let after = 0;
  for (;;) {
    const page = query<T>(sql(after));
    rows.push(...page);
    if (page.length < PAGE_SIZE) return rows;
    after = page[page.length - 1].row;
  }
}

/** A literal for SQL; only our own option values reach here. */
const literal = (value: string) => `'${value.replaceAll("'", "''")}'`;

const difficultyFilter = difficulty
  ? `AND difficulty = ${literal(difficulty)}`
  : "";

interface LogRow {
  row: number;
  account: string;
  play_id: string;
  seed_code: string;
  difficulty: string;
  outcome: "cleared" | "abandoned";
  elapsed_ms: number;
  hints_used: number;
  max_assist: number;
  app_version: string;
  events: string;
}

/** The columns of LogRow, but the events. */
const LOG_COLUMNS = `rowid AS row, substr(account_id, 1, 8) AS account,
  play_id, seed_code, difficulty, outcome, elapsed_ms, hints_used,
  max_assist, app_version`;

function readLogs(withEvents: boolean): LogRow[] {
  return pages<LogRow>(
    (after) => `SELECT ${LOG_COLUMNS},
      ${withEvents ? "events" : "'[]' AS events"}
      FROM play_logs
      WHERE received_at >= ${since} ${difficultyFilter} AND rowid > ${after}
      ORDER BY rowid LIMIT ${PAGE_SIZE}`,
  );
}

// --- boards -----------------------------------------------------------------------

const boards = new Map<string, Puzzle>();

/** The board a seed code makes, cached: logs of one board share it. */
function boardOf(seedCode: string): Puzzle | undefined {
  let puzzle = boards.get(seedCode);
  if (!puzzle) {
    const code = parseSeedCode(seedCode);
    if (!code) return undefined;
    puzzle = generatePuzzle(code.seed, code.difficulty, {
      version: code.version,
    }).puzzle;
    boards.set(seedCode, puzzle);
  }
  return puzzle;
}

function eventsOf(row: LogRow): PlayLogEvent[] {
  const events: unknown = JSON.parse(row.events);
  return Array.isArray(events) ? events.filter(isPlayLogEvent) : [];
}

/** What the next step needed on a board, as the hint finder sees it. */
function nextStepLabel(puzzle: Puzzle, states: Uint8Array): string {
  const hint = findHint(boardGeometry(puzzle.size), puzzle, states);
  return hint ? hintLabel(hint) : "NONE";
}

// --- printing ---------------------------------------------------------------------

function table(
  header: readonly string[],
  rows: readonly (string | number)[][],
) {
  console.log(header.join("\t"));
  for (const row of rows) console.log(row.join("\t"));
  console.log("");
}

const seconds = (ms: number) =>
  Number.isNaN(ms) ? "—" : `${Math.round(ms / 1000)}s`;
const share = (part: number, whole: number) =>
  whole === 0 ? "—" : `${Math.round((part / whole) * 100)}%`;

function countBy<T>(items: readonly T[], key: (item: T) => string) {
  const counts = new Map<string, number>();
  for (const item of items) {
    counts.set(key(item), (counts.get(key(item)) ?? 0) + 1);
  }
  return [...counts].sort((a, b) => b[1] - a[1]);
}

/** The items by key, the largest group first. */
function groupBy<T>(items: readonly T[], key: (item: T) => string) {
  const groups = new Map<string, T[]>();
  for (const item of items) {
    const group = groups.get(key(item));
    if (group) group.push(item);
    else groups.set(key(item), [item]);
  }
  return [...groups].sort((a, b) => b[1].length - a[1].length);
}

/** Prints a section per difficulty that has any of the items. */
function byDifficulty<T extends { difficulty: string }>(
  items: readonly T[],
  print: (here: readonly T[]) => void,
): void {
  for (const level of DIFFICULTIES) {
    const here = items.filter((item) => item.difficulty === level);
    if (here.length === 0) continue;
    console.log(`### ${level}\n`);
    print(here);
  }
}

const median = (values: readonly number[]) => seconds(percentile(values, 0.5));

// --- reports ----------------------------------------------------------------------

function summary(): void {
  const logs = readLogs(false);
  console.log(
    `## 概要（${env}、直近 ${days} 日、ログ ${logs.length} 件、プレイヤー ${new Set(logs.map((l) => l.account)).size} 人）\n`,
  );
  table(
    [
      "難易度",
      "試行",
      "クリア",
      "放棄",
      "放棄率",
      "クリア時間の中央値",
      "ヒント 0 回のクリア",
      "アシストなしのクリア",
    ],
    DIFFICULTIES.map((level) => {
      const all = logs.filter((l) => l.difficulty === level);
      const cleared = all.filter((l) => l.outcome === "cleared");
      return [
        level,
        all.length,
        cleared.length,
        all.length - cleared.length,
        share(all.length - cleared.length, all.length),
        median(cleared.map((l) => l.elapsed_ms)),
        share(cleared.filter((l) => l.hints_used === 0).length, cleared.length),
        share(cleared.filter((l) => l.max_assist === 0).length, cleared.length),
      ];
    }),
  );
  table(
    ["版", "ログ"],
    countBy(logs, (l) => l.app_version),
  );
}

function stuck(): void {
  const logs = readLogs(true);
  const stalls: {
    difficulty: string;
    label: string;
    gapMs: number;
    then: string;
  }[] = [];
  for (const row of logs) {
    const puzzle = boardOf(row.seed_code);
    if (!puzzle) continue;
    const replay = replayPlayLog(
      eventsOf(row),
      boardGeometry(puzzle.size).edgeCount,
      STALL_MS,
    );
    for (const stall of replay.stalls) {
      stalls.push({
        difficulty: row.difficulty,
        label: nextStepLabel(puzzle, stall.states),
        gapMs: stall.gapMs,
        then: stall.then,
      });
    }
  }
  console.log(
    `## 詰まった局面（${STALL_MS / 1000} 秒以上手が止まった盤面 ${stalls.length} か所、ログ ${logs.length} 件）\n`,
  );
  console.log(
    "次の一手に要る定石（MISTAKE は誤りがある盤面、TRIAL は仮置きが要る盤面）ごとの件数と、止まった時間。「その後」は止まった後の操作。\n",
  );
  byDifficulty(stalls, (here) =>
    table(
      [
        "次の一手",
        "件数",
        "止まった時間の中央値",
        "その後ヒント",
        "その後放棄",
      ],
      groupBy(here, (s) => s.label).map(([label, these]) => [
        label,
        these.length,
        median(these.map((s) => s.gapMs)),
        share(these.filter((s) => s.then === "hint").length, these.length),
        share(these.filter((s) => s.then === "end").length, these.length),
      ]),
    ),
  );
}

function hints(): void {
  const logs = readLogs(true);
  // The first step of a hint is the hint asked for; later steps follow it.
  const asked = logs.flatMap((row) =>
    eventsOf(row).flatMap((event) =>
      event[0] === "hint" && event[2] === 1
        ? [{ difficulty: row.difficulty, label: event[3] }]
        : [],
    ),
  );
  console.log(
    `## ヒントの内容（${asked.length} 回、ログ ${logs.length} 件）\n`,
  );
  byDifficulty(asked, (here) =>
    table(
      ["ヒント", "回数", "割合"],
      countBy(here, (a) => a.label).map(([label, n]) => [
        label,
        n,
        share(n, here.length),
      ]),
    ),
  );
}

const PROGRESS_BANDS = ["0〜25%", "25〜50%", "50〜75%", "75〜100%"];

function abandon(): void {
  const logs = readLogs(true).filter((l) => l.outcome === "abandoned");
  const rows = logs.flatMap((row) => {
    const puzzle = boardOf(row.seed_code);
    if (!puzzle) return [];
    const { final } = replayPlayLog(
      eventsOf(row),
      boardGeometry(puzzle.size).edgeCount,
      Infinity,
    );
    const onLoop = puzzle.solution.filter(
      (edge) => final[edge] === LINE,
    ).length;
    return [
      {
        difficulty: row.difficulty,
        progress: onLoop / puzzle.solution.length,
        label: nextStepLabel(puzzle, final),
        elapsedMs: row.elapsed_ms,
      },
    ];
  });
  console.log(`## 放棄（${rows.length} 件）\n`);
  console.log("進み具合は、正解の輪のうち引けていた線の割合。\n");
  byDifficulty(rows, (here) => {
    table(
      ["進み具合", "件数"],
      countBy(
        here,
        (r) => PROGRESS_BANDS[Math.min(3, Math.floor(r.progress * 4))],
      ),
    );
    table(
      ["放棄した盤面の次の一手", "件数", "放棄までの時間の中央値"],
      groupBy(here, (r) => r.label).map(([label, these]) => [
        label,
        these.length,
        median(these.map((r) => r.elapsedMs)),
      ]),
    );
  });
}

function feedback(): void {
  const rows = query<{
    created_at: number;
    account: string;
    body: string;
    play_id: string | null;
    source: string;
    seed_code: string | null;
    cleared: number;
    elapsed_seconds: number;
    hints_used: number;
    max_assist: number | null;
    app_version: string;
  }>(
    `SELECT created_at, substr(account_id, 1, 8) AS account, body, source,
       play_id, seed_code, cleared, elapsed_seconds, hints_used, max_assist,
       app_version
     FROM feedback WHERE created_at >= ${since} ${difficultyFilter}
     ORDER BY created_at DESC LIMIT ${limit}`,
  );
  console.log(`## 感想（新しい順に ${rows.length} 件）\n`);
  for (const row of rows) {
    const when = new Date(row.created_at).toLocaleString("ja-JP", {
      timeZone: "Asia/Tokyo",
    });
    const board = row.seed_code
      ? `${row.seed_code} ${row.cleared ? "クリア済み" : "プレイ中"} ${row.elapsed_seconds}s ヒント ${row.hints_used} アシスト ${row.max_assist ?? "—"}`
      : "盤面なし";
    console.log(
      `- ${when} ${row.account} ${row.source} ${board} 版 ${row.app_version}${row.play_id ? ` playId ${row.play_id}` : ""}`,
    );
    console.log(`  ${row.body.replaceAll("\n", "\n  ")}\n`);
  }
}

function log(playId: string | undefined): void {
  if (!isPlayId(playId)) {
    throw new Error("Usage: npm run stats -- log <playId>");
  }
  const [row] = query<LogRow>(
    `SELECT ${LOG_COLUMNS}, events FROM play_logs WHERE play_id = ${literal(playId)} LIMIT 1`,
  );
  if (!row) throw new Error(`No log ${playId}.`);
  console.log(
    `## ${row.play_id}（${row.seed_code}、${row.outcome}、版 ${row.app_version}）\n`,
  );
  const puzzle = boardOf(row.seed_code);
  let previous = 0;
  for (const event of eventsOf(row)) {
    const [kind, t] = event;
    const gap =
      t - previous >= STALL_MS ? `  ← ${seconds(t - previous)} 止まった` : "";
    const detail =
      kind === "move"
        ? `${event[2]} ${event[3].map(([edge, , after]) => `${edge}:${after}`).join(" ")}`
        : event.slice(2).join(" ");
    console.log(`${seconds(t).padStart(6)} ${kind} ${detail}${gap}`);
    previous = t;
  }
  if (puzzle)
    console.log(`\n盤面: ${puzzle.clues.map((c) => c ?? ".").join("")}`);
}

switch (report) {
  case "summary":
    summary();
    break;
  case "stuck":
    stuck();
    break;
  case "hints":
    hints();
    break;
  case "abandon":
    abandon();
    break;
  case "feedback":
    feedback();
    break;
  case "log":
    log(args[1]);
    break;
  default:
    console.error(
      "Usage: npm run stats -- summary|stuck|hints|abandon|feedback|log <playId> [--env local|dev|production] [--days N] [--difficulty easy|normal|hard] [--limit N]",
    );
    process.exitCode = 1;
}
