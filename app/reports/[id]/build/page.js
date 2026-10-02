"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import {
  useCallback,
  useRef,
  useState,
} from "react";

// ============================================================
// BRAND
// ============================================================

const BRAND = {
  ink: "#1C1917",
  blush: "#ECD8D3",
  blushSoft: "#F7EDEB",
  magenta: "#D0007F",
  moss: "#426429",
  mute: "#78716C",
  line: "#E7E1DF",
  wash: "#F5F1F0",
};

// ============================================================
// PIPELINE
// ============================================================
// "loops" means the route processes a batch per call and sets
// done:true when there is nothing left. Everything here runs in
// order, and a failure stops the run.

const STAGES = [
  {
    id: "analyse-full",
    name: "Read the report structure",
    detail:
      "Finds the rooms, subsections, meter pages and declaration.",
    loops: false,
  },
  {
    id: "analyse-images",
    name: "Map the photographs",
    detail:
      "Creates a record for every photograph and ties it to its subsection.",
    loops: false,
  },
  {
    id: "extract-photos",
    name: "Extract the photographs",
    detail:
      "Pulls each photograph out of the PDF at full size.",
    loops: true,
  },
  {
    id: "analyse-inventory-v2",
    name: "Write the captions",
    detail:
      "Describes each item once, reads meters and appliance labels.",
    loops: true,
  },
  {
    id: "polish-v2",
    name: "Polish",
    detail:
      "Removes repeated descriptions within a subsection.",
    loops: true,
  },
  {
    id: "finalise-v2",
    name: "Finalise",
    detail:
      "Builds the overview and suggested room actions.",
    loops: true,
  },
];

// A single stage should never need more calls than this.
const MAX_CALLS_PER_STAGE = 400;

function sleep(ms) {
  return new Promise((resolve) =>
    setTimeout(resolve, ms)
  );
}

// ============================================================
// UI PIECES
// ============================================================

function StatusDot({ state }) {
  const colours = {
    waiting: "#D6CFCC",
    running: BRAND.magenta,
    done: BRAND.moss,
    failed: "#B4243F",
  };

  return (
    <span
      className="mt-1.5 inline-block h-2.5 w-2.5 shrink-0 rounded-full"
      style={{
        backgroundColor:
          colours[state] || colours.waiting,
      }}
    />
  );
}

function StageRow({ stage, state, note }) {
  const isActive = state === "running";

  return (
    <div
      className="flex items-start gap-3 px-6 py-4"
      style={{
        borderTop: `1px solid ${BRAND.line}`,
        backgroundColor: isActive
          ? BRAND.blushSoft
          : "transparent",
      }}
    >
      <StatusDot state={state} />

      <div className="min-w-0 flex-1">
        <p
          className="font-semibold"
          style={{
            color:
              state === "waiting"
                ? BRAND.mute
                : BRAND.ink,
          }}
        >
          {stage.name}
        </p>

        <p
          className="mt-0.5 text-sm"
          style={{ color: BRAND.mute }}
        >
          {note || stage.detail}
        </p>
      </div>

      <span
        className="shrink-0 text-sm font-semibold tabular-nums"
        style={{
          color:
            state === "done"
              ? BRAND.moss
              : state === "failed"
                ? "#B4243F"
                : BRAND.mute,
        }}
      >
        {state === "done"
          ? "Done"
          : state === "running"
            ? "Running"
            : state === "failed"
              ? "Failed"
              : "Waiting"}
      </span>
    </div>
  );
}

// ============================================================
// PAGE
// ============================================================

export default function BuildReportPage() {
  const params = useParams();

  const reportId = String(
    params?.id || ""
  );

  const [states, setStates] = useState(
    () =>
      Object.fromEntries(
        STAGES.map((stage) => [
          stage.id,
          "waiting",
        ])
      )
  );

  const [notes, setNotes] = useState({});
  const [running, setRunning] = useState(false);
  const [finished, setFinished] = useState(false);
  const [errorText, setErrorText] = useState("");
  const [log, setLog] = useState([]);

  const cancelled = useRef(false);

  const addLog = useCallback((line) => {
    setLog((current) => [
      ...current.slice(-120),
      `${new Date().toLocaleTimeString(
        "en-GB"
      )}  ${line}`,
    ]);
  }, []);

  function setStage(id, state) {
    setStates((current) => ({
      ...current,
      [id]: state,
    }));
  }

  function setNote(id, note) {
    setNotes((current) => ({
      ...current,
      [id]: note,
    }));
  }

  async function callStage(stage) {
    // A dropped connection mid-run should not end the build.
    // Retry the network call itself before giving up.
    let response = null;
    let networkError = null;

    for (
      let attempt = 1;
      attempt <= 3;
      attempt += 1
    ) {
      try {
        response = await fetch(
          `/api/reports/${reportId}/${stage.id}`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
            },
            body: JSON.stringify({}),
          }
        );

        networkError = null;
        break;
      } catch (error) {
        networkError = error;
        response = null;

        if (attempt < 3) {
          addLog(
            `${stage.name} — connection dropped, retrying (${attempt} of 3)`
          );

          await sleep(attempt * 4000);
        }
      }
    }

    if (!response) {
      throw new Error(
        `Lost connection to the server during ${stage.name}. ${
          networkError?.message || ""
        }`.trim()
      );
    }

    let payload = {};

    try {
      payload = await response.json();
    } catch {
      throw new Error(
        `${stage.name} returned a response that could not be read (HTTP ${response.status}).`
      );
    }

    if (!response.ok || payload.error) {
      throw new Error(
        payload.message ||
          payload.error ||
          `${stage.name} failed (HTTP ${response.status}).`
      );
    }

    return payload;
  }

  async function runStage(stage) {
    setStage(stage.id, "running");

    if (!stage.loops) {
      await callStage(stage);
      setStage(stage.id, "done");
      addLog(`${stage.name} — complete`);
      return;
    }

    for (
      let call = 1;
      call <= MAX_CALLS_PER_STAGE;
      call += 1
    ) {
      if (cancelled.current) {
        throw new Error("Stopped.");
      }

      let payload;

      try {
        payload = await callStage(stage);
      } catch (error) {
        // Gemini returns 429 as a thrown error rather than a
        // quota_limited flag. Wait the stated time and retry the
        // same batch instead of ending the build.
        const message = String(
          error?.message || ""
        );

        const isQuota =
          message.includes("429") ||
          message
            .toLowerCase()
            .includes("quota") ||
          message
            .toLowerCase()
            .includes("rate limit");

        if (!isQuota) {
          throw error;
        }

        const match = message.match(
          /retry in ([\d.]+)s/i
        );

        const wait = Math.ceil(
          Math.max(
            10,
            match
              ? Number(match[1]) + 3
              : 35
          )
        );

        setNote(
          stage.id,
          `Gemini quota reached. Waiting ${wait}s, then continuing.`
        );

        addLog(
          `${stage.name} — quota reached, waiting ${wait}s`
        );

        await sleep(wait * 1000);
        continue;
      }

      // Gemini rate limit. Wait it out rather than failing.
      if (payload.quota_limited) {
        const wait = Math.max(
          5,
          Number(
            payload.retry_after_seconds || 30
          )
        );

        setNote(
          stage.id,
          `Rate limited, waiting ${wait}s before continuing.`
        );

        addLog(
          `${stage.name} — rate limited, waiting ${wait}s`
        );

        await sleep(wait * 1000);
        continue;
      }

      const progress = [
        payload.completed_photos,
        payload.total_real_photos,
      ];

      if (
        Number.isFinite(progress[0]) &&
        Number.isFinite(progress[1])
      ) {
        setNote(
          stage.id,
          `${progress[0]} of ${progress[1]} photographs.`
        );
      } else if (payload.end_page) {
        setNote(
          stage.id,
          `Pages up to ${payload.end_page}.`
        );
      } else {
        setNote(
          stage.id,
          `Batch ${call} complete.`
        );
      }

      if (payload.done) {
        setStage(stage.id, "done");
        addLog(`${stage.name} — complete`);
        return;
      }
    }

    throw new Error(
      `${stage.name} did not finish after ${MAX_CALLS_PER_STAGE} batches.`
    );
  }

  async function runAll() {
    cancelled.current = false;
    setRunning(true);
    setFinished(false);
    setErrorText("");
    setLog([]);
    setNotes({});

    setStates(
      Object.fromEntries(
        STAGES.map((stage) => [
          stage.id,
          "waiting",
        ])
      )
    );

    addLog("Starting full report build.");

    for (const stage of STAGES) {
      try {
        await runStage(stage);
      } catch (error) {
        setStage(stage.id, "failed");

        const message =
          error?.message ||
          "Something went wrong.";

        setErrorText(message);
        addLog(`FAILED — ${message}`);
        setRunning(false);
        return;
      }
    }

    addLog("Report ready.");
    setRunning(false);
    setFinished(true);
  }

  const doneCount = STAGES.filter(
    (stage) => states[stage.id] === "done"
  ).length;

  const percent = Math.round(
    (doneCount / STAGES.length) * 100
  );

  return (
    <div
      className="space-y-5"
      style={{
        color: BRAND.ink,
        fontFamily:
          "ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif",
      }}
    >
      <header
        className="rounded-xl px-6 py-5"
        style={{
          backgroundColor: BRAND.blushSoft,
          border: `1px solid ${BRAND.blush}`,
        }}
      >
        <h1 className="text-2xl font-semibold tracking-tight">
          Build the report
        </h1>

        <p
          className="mt-1 text-sm"
          style={{ color: BRAND.mute }}
        >
          Runs every stage in order. Leave this tab open
          until it finishes.
        </p>
      </header>

      {errorText && (
        <div
          className="rounded-xl px-5 py-4 text-sm"
          style={{
            backgroundColor: "#FDF2F4",
            border: "1px solid #F2C9D2",
            color: "#8A0030",
          }}
        >
          <p className="font-semibold">
            The build stopped.
          </p>

          <p className="mt-1">{errorText}</p>

          <p className="mt-2">
            Nothing already finished is lost. Press
            Build again and it will carry on from
            where it stopped.
          </p>
        </div>
      )}

      {finished && (
        <div
          className="flex flex-col justify-between gap-3 rounded-xl px-5 py-4 sm:flex-row sm:items-center"
          style={{
            backgroundColor: "#F1F6EE",
            border: "1px solid #CBDCC0",
          }}
        >
          <p
            className="text-sm font-semibold"
            style={{ color: BRAND.moss }}
          >
            Report ready.
          </p>

          <Link
            href={`/reports/${reportId}/final-v2`}
            className="shrink-0 rounded-lg px-4 py-2.5 text-sm font-semibold text-white"
            style={{
              backgroundColor: BRAND.magenta,
            }}
          >
            Open the report
          </Link>
        </div>
      )}

      <section
        className="overflow-hidden rounded-xl bg-white"
        style={{
          border: `1px solid ${BRAND.line}`,
        }}
      >
        <div className="flex flex-col justify-between gap-4 px-6 py-5 sm:flex-row sm:items-center">
          <div>
            <p className="font-semibold">
              {running
                ? "Building"
                : finished
                  ? "Complete"
                  : "Ready to build"}
            </p>

            <p
              className="mt-0.5 text-sm tabular-nums"
              style={{ color: BRAND.mute }}
            >
              {doneCount} of {STAGES.length} stages
            </p>
          </div>

          <div className="flex gap-3">
            {running ? (
              <button
                type="button"
                onClick={() => {
                  cancelled.current = true;
                }}
                className="rounded-lg px-4 py-2.5 text-sm font-semibold"
                style={{
                  border: `1px solid ${BRAND.line}`,
                  color: BRAND.ink,
                }}
              >
                Stop after this batch
              </button>
            ) : (
              <button
                type="button"
                onClick={runAll}
                className="rounded-lg px-5 py-2.5 text-sm font-semibold text-white"
                style={{
                  backgroundColor: BRAND.magenta,
                }}
              >
                {finished || errorText
                  ? "Build again"
                  : "Build the whole report"}
              </button>
            )}
          </div>
        </div>

        <div
          className="mx-6 mb-5 h-2 overflow-hidden rounded-full"
          style={{ backgroundColor: "#F1ECEA" }}
        >
          <div
            className="h-full transition-all"
            style={{
              width: `${percent}%`,
              backgroundColor: BRAND.moss,
            }}
          />
        </div>

        {STAGES.map((stage) => (
          <StageRow
            key={stage.id}
            stage={stage}
            state={states[stage.id]}
            note={notes[stage.id]}
          />
        ))}
      </section>

      {log.length > 0 && (
        <section
          className="overflow-hidden rounded-xl bg-white"
          style={{
            border: `1px solid ${BRAND.line}`,
          }}
        >
          <div
            className="px-6 py-4"
            style={{
              borderBottom: `1px solid ${BRAND.line}`,
            }}
          >
            <p className="font-semibold">
              Progress log
            </p>
          </div>

          <pre
            className="max-h-72 overflow-auto px-6 py-4 text-xs leading-relaxed"
            style={{
              color: BRAND.mute,
              whiteSpace: "pre-wrap",
            }}
          >
            {log.join("\n")}
          </pre>
        </section>
      )}
    </div>
  );
}