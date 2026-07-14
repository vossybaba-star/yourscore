/**
 * Fantasy fixture ticker — club × gameweek grid.
 *
 * Deliberately NOT on the feed (/fantasy/news). This is REFERENCE DATA: a 20×5
 * grid you consult when planning a transfer, not content you browse. It shipped
 * at the top of the feed once and buried the articles/tweets people actually
 * came for. Tools get a tab; the feed stays a feed.
 *
 * Rows = clubs, columns = GWs, each cell = that club's opponent tinted by THAT
 * club's difficulty — so "tough" always has an unambiguous subject (a match
 * list can't say who a fixture is tough FOR).
 */
import { Fragment } from "react";
import { NewsTabs } from "@/components/fantasy/NewsTabs";
import {
  DIFF, GOLD, INK, MUTED, card, column, h2, loadFeedDoc, shell, ukTime,
} from "@/components/fantasy/newsUi";

export const revalidate = 300;

export const metadata = {
  title: "Fantasy fixture ticker — YourScore",
  description:
    "Every Premier League club's next five fixtures, colour-coded by difficulty.",
};

export default async function FantasyFixtures() {
  const doc = await loadFeedDoc();
  const gws = doc?.fixtures?.gws ?? [];
  const runs = doc?.fixtures?.runs ?? [];

  return (
    <main style={shell}>
      <div style={column}>
        <header>
          <div style={{ color: MUTED, fontSize: 12 }}>Fantasy</div>
          <h1 style={{ color: INK, fontSize: 22, fontWeight: 700, margin: "2px 0 0" }}>
            News &amp; insights
          </h1>
        </header>

        <NewsTabs active="/fantasy/fixtures" />

        {runs.length === 0 ? (
          <section style={card}>
            <div style={{ color: INK, fontSize: 14, fontWeight: 600 }}>No fixtures yet</div>
            <div style={{ color: MUTED, fontSize: 13, marginTop: 6, lineHeight: 1.5 }}>
              The ticker fills in once the gameweek calendar opens.
            </div>
          </section>
        ) : (
          <section style={card}>
            <h2 style={h2}>Next {gws.length} gameweeks</h2>
            <div style={{ color: MUTED, fontSize: 11, margin: "-4px 0 10px" }}>
              CAPS = home. Colour is difficulty for the club in that row.
            </div>
            <div style={{ overflowX: "auto" }}>
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: `44px repeat(${gws.length}, minmax(44px, 1fr))`,
                  gap: 4,
                  minWidth: 44 + gws.length * 48,
                }}
              >
                <div />
                {gws.map((g) => (
                  <div key={g} style={{ color: MUTED, fontSize: 10, textAlign: "center" }}>
                    GW{g}
                  </div>
                ))}

                {runs.map((r) => (
                  <Fragment key={r.clubId}>
                    <div style={{ color: INK, fontSize: 12, fontWeight: 600, alignSelf: "center" }}>
                      {r.short}
                    </div>
                    {gws.map((g) => {
                      // .filter, not .find — a double gameweek pushes TWO cells
                      // for this club into the same GW, and .find silently
                      // rendered only the first, hiding half of it.
                      const cells = r.cells.filter((c) => c.gw === g);
                      if (cells.length === 0)
                        return (
                          <div
                            key={g}
                            style={{ color: MUTED, fontSize: 11, textAlign: "center", padding: "5px 0" }}
                          >
                            —
                          </div>
                        );
                      const isDouble = cells.length > 1;
                      return (
                        <div
                          key={g}
                          title={cells
                            .map((c) => `${c.home ? "vs" : "away to"} ${c.opponent} — ${DIFF[c.difficulty].label}`)
                            .join(" · ")}
                          style={{
                            display: "flex",
                            flexDirection: "column",
                            gap: 2,
                            border: isDouble ? `1px solid ${GOLD}88` : undefined,
                            borderRadius: 6,
                            padding: isDouble ? 1 : 0,
                          }}
                        >
                          {cells.map((cell, i) => (
                            <div
                              key={i}
                              style={{
                                background: DIFF[cell.difficulty].bg,
                                color: INK,
                                fontSize: isDouble ? 9.5 : 11,
                                textAlign: "center",
                                padding: "5px 0",
                                borderRadius: 5,
                                // CAPS = home, lower = away — standard ticker convention.
                                textTransform: cell.home ? "uppercase" : "lowercase",
                              }}
                            >
                              {cell.oppShort}
                            </div>
                          ))}
                        </div>
                      );
                    })}
                  </Fragment>
                ))}
              </div>
            </div>
            {doc?.deadline && new Date(doc.deadline).getTime() > Date.now() && (
              <div style={{ color: MUTED, fontSize: 11, marginTop: 10 }}>
                GW{doc.gw} deadline · {ukTime(doc.deadline)}
              </div>
            )}
          </section>
        )}
      </div>
    </main>
  );
}
