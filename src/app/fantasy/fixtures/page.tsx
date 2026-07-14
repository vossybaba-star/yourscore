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
  DIFF, INK, MUTED, card, column, h2, loadFeedDoc, shell, ukTime,
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
                      const cell = r.cells.find((c) => c.gw === g);
                      if (!cell)
                        return (
                          <div
                            key={g}
                            style={{ color: MUTED, fontSize: 11, textAlign: "center", padding: "5px 0" }}
                          >
                            —
                          </div>
                        );
                      return (
                        <div
                          key={g}
                          title={`${cell.home ? "vs" : "away to"} ${cell.opponent} — ${DIFF[cell.difficulty].label}`}
                          style={{
                            background: DIFF[cell.difficulty].bg,
                            color: INK,
                            fontSize: 11,
                            textAlign: "center",
                            padding: "5px 0",
                            borderRadius: 6,
                            // CAPS = home, lower = away — standard ticker convention.
                            textTransform: cell.home ? "uppercase" : "lowercase",
                          }}
                        >
                          {cell.oppShort}
                        </div>
                      );
                    })}
                  </Fragment>
                ))}
              </div>
            </div>
            {doc?.deadline && (
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
