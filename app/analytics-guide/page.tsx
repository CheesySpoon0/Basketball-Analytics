import Link from 'next/link';

export default function AnalyticsGuidePage() {
  return (
    <main className="max-w-4xl mx-auto px-6 lg:px-8 py-10 lg:py-14">
      {/* Hero Section */}
      <header className="mb-16">
        <div className="relative">
          <div
            className="absolute -left-6 top-2 bottom-2 w-[3px] bg-accent"
          />
          <div className="mono text-[11px] uppercase tracking-[0.2em] text-text-dim mb-3">
            Analytics Guide
          </div>
          <h1 className="display text-[48px] sm:text-[64px] leading-[0.95] tracking-tight font-medium mb-6">
            How to Read the Numbers
          </h1>
          <div className="text-lg text-text-dim leading-relaxed max-w-3xl">
            <p className="mb-4">
              This app is built to answer three essential questions about basketball:
            </p>
            <ul className="space-y-2 ml-6">
              <li className="flex items-start gap-3">
                <span className="text-accent mt-1">•</span>
                <span><strong className="text-text">What happened?</strong> The actual results on the court</span>
              </li>
              <li className="flex items-start gap-3">
                <span className="text-accent mt-1">•</span>
                <span><strong className="text-text">Was it sustainable?</strong> Whether it was built on good process or luck</span>
              </li>
              <li className="flex items-start gap-3">
                <span className="text-accent mt-1">•</span>
                <span><strong className="text-text">Which players and lineups actually drive winning?</strong> Who makes the biggest impact</span>
              </li>
            </ul>
          </div>
        </div>
      </header>

      {/* Core Idea Section */}
      <section className="mb-16">
        <div className="bg-surface border border-border p-8">
          <h2 className="display text-2xl font-medium mb-6">Four Layers of Analysis</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="space-y-4">
              <LayerCard
                title="Team Efficiency"
                description="How good a team is overall at scoring and preventing scores"
                link="/teams"
                linkText="View Teams"
              />
              <LayerCard
                title="Shot Quality"
                description="Whether teams and players create good looks vs. just make tough shots"
                link="/shot-quality"
                linkText="View Shot Quality"
              />
            </div>
            <div className="space-y-4">
              <LayerCard
                title="Player Impact"
                description="Who actually changes winning when they're on the court"
                link="/impact"
                linkText="View Impact"
              />
              <LayerCard
                title="Lineup Optimization"
                description="Which 5-man groups work best together"
                link="/lineups"
                linkText="View Lineups"
              />
            </div>
          </div>
        </div>
      </section>

      {/* Team Efficiency Section */}
      <section className="mb-16">
        <h2 className="display text-2xl font-medium mb-6">Team Efficiency</h2>
        <div className="bg-surface border border-border p-8">
          <div className="mb-6">
            <CoachTakeaway>
              PPG can lie because fast teams get more possessions. ORtg and DRtg help compare teams fairly.
            </CoachTakeaway>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
            <div className="space-y-6">
              <StatExplanation
                stat="Offensive Rating (ORtg)"
                meaning="Points scored per 100 possessions"
                why="Shows how efficiently a team scores, regardless of pace. A team that scores 75 points in 60 possessions is more efficient than one that scores 85 in 75 possessions."
              />
              <StatExplanation
                stat="Defensive Rating (DRtg)"
                meaning="Points allowed per 100 possessions"
                why="Shows defensive efficiency. Lower is better. Helps you see which teams actually stop opponents vs. just play slow."
              />
              <StatExplanation
                stat="Net Rating"
                meaning="ORtg minus DRtg"
                why="Overall team strength. +10 means they outscore opponents by 10 points per 100 possessions. Elite teams are usually +15 or higher."
              />
            </div>
            <div className="space-y-6">
              <StatExplanation
                stat="Pace"
                meaning="Possessions per 40 minutes"
                why="How fast a team plays. Fast teams create more possessions but may sacrifice efficiency. Helps explain why some teams score more despite being less efficient."
              />
              <div className="bg-surface-2 border border-border p-4 rounded">
                <h4 className="font-medium text-text mb-3">Four Factors (Why Teams Win)</h4>
                <ul className="text-sm text-text-dim space-y-1">
                  <li>• <strong className="text-text">Shooting:</strong> eFG% — making shots efficiently</li>
                  <li>• <strong className="text-text">Turnovers:</strong> Taking care of the ball</li>
                  <li>• <strong className="text-text">Rebounding:</strong> Getting second chances</li>
                  <li>• <strong className="text-text">Free Throws:</strong> Getting to the line</li>
                </ul>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Shot Quality Section */}
      <section className="mb-16">
        <h2 className="display text-2xl font-medium mb-6">Shot Quality vs. Shot Making</h2>
        <div className="bg-surface border border-border p-8">
          <div className="mb-6">
            <CoachTakeaway>
              A player making tough shots and a player getting easy looks can have the same shooting percentage, but they mean different things. Expected FG% helps separate process from results.
            </CoachTakeaway>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
            <div className="space-y-6">
              <StatExplanation
                stat="Expected FG% (xFG)"
                meaning="What their shooting percentage should be based on shot locations"
                why="Tells you if someone is creating good looks. High xFG% means they get clean shots consistently."
              />
              <StatExplanation
                stat="Expected eFG% (xeFG)"
                meaning="Expected effective field goal percentage (accounts for 3-pointers being worth more)"
                why="More complete than regular xFG because it weights threes properly. Shows true shot diet quality."
              />
            </div>
            <div className="space-y-6">
              <StatExplanation
                stat="Actual vs Expected"
                meaning="How much better or worse they shot compared to expectations"
                why="Positive delta = hot shooting that may cool off. Negative delta = cold shooting that may improve. Helps predict future performance."
              />
              <div className="bg-surface-2 border border-border p-4 rounded">
                <h4 className="font-medium text-text mb-3">What This Means for Scouting</h4>
                <ul className="text-sm text-text-dim space-y-1">
                  <li>• <strong className="text-text">High xeFG + High Actual:</strong> Elite shot creator and maker</li>
                  <li>• <strong className="text-text">High xeFG + Low Actual:</strong> Good looks, cold streak</li>
                  <li>• <strong className="text-text">Low xeFG + High Actual:</strong> Tough shot maker, may regress</li>
                  <li>• <strong className="text-text">Low xeFG + Low Actual:</strong> Poor shot selection and execution</li>
                </ul>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* RAPM Section */}
      <section className="mb-16">
        <h2 className="display text-2xl font-medium mb-6">Player Impact (RAPM)</h2>
        <div className="bg-surface border border-border p-8">
          <div className="mb-6">
            <CoachTakeaway>
              RAPM is designed to find players whose impact is bigger than the box score. It adjusts for teammates, opponents, and lineup context to isolate individual impact.
            </CoachTakeaway>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
            <div className="space-y-6">
              <StatExplanation
                stat="Offensive RAPM (ORAPM)"
                meaning="Points per 100 possessions added to team offense"
                why="Captures offensive impact beyond scoring. Includes passing, spacing, screening, and offensive rebounding. Positive is good."
              />
              <StatExplanation
                stat="Defensive RAPM (DRAPM)"
                meaning="Points per 100 possessions subtracted from opponent offense"
                why="Measures defensive impact including steals, help defense, rebounding, and deterrence. Positive is good (fewer points allowed)."
              />
            </div>
            <div className="space-y-6">
              <StatExplanation
                stat="Net RAPM"
                meaning="Total estimated impact (ORAPM + DRAPM)"
                why="Overall player value. +5 means the team outscores opponents by 5 more points per 100 possessions when this player is on court."
              />
              <StatExplanation
                stat="Expected RAPM"
                meaning="What their RAPM should be based on box score stats"
                why="Helps identify players who impact winning more (or less) than their traditional stats suggest."
              />
            </div>
          </div>

          <div className="mt-6 bg-surface-2 border border-border p-4 rounded">
            <h4 className="font-medium text-text mb-3">Confidence Labels</h4>
            <p className="text-sm text-text-dim mb-2">RAPM gets more reliable with more data:</p>
            <ul className="text-sm text-text-dim space-y-1">
              <li>• <strong className="text-made">High:</strong> 400+ possessions, very reliable</li>
              <li>• <strong className="text-text">Medium:</strong> 200-399 possessions, mostly reliable</li>
              <li>• <strong className="text-missed">Low:</strong> Under 200 possessions, use with caution</li>
            </ul>
          </div>
        </div>
      </section>

      {/* Lineup Optimizer Section */}
      <section className="mb-16">
        <h2 className="display text-2xl font-medium mb-6">Lineup Analysis</h2>
        <div className="bg-surface border border-border p-8">
          <div className="mb-6">
            <CoachTakeaway>
              Actual lineup stats tell us what happened. Expected lineup stats tell us whether it was built on good process or hot shooting.
            </CoachTakeaway>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
            <div className="space-y-6">
              <StatExplanation
                stat="Observed Lineups"
                meaning="What lineups actually did in games"
                why="Shows real results with real chemistry, but sample sizes can be small and results can be noisy."
              />
              <StatExplanation
                stat="Projected Lineups"
                meaning="What lineups should do based on individual player impacts"
                why="Helps evaluate untested lineups or predict performance with larger samples. Less noise, but may miss chemistry effects."
              />
            </div>
            <div className="space-y-6">
              <StatExplanation
                stat="Expected vs Actual"
                meaning="How lineups performed relative to shot quality"
                why="Great actual + poor expected = hot shooting. Average actual + strong expected = unlucky, worth more minutes."
              />
              <div className="bg-surface-2 border border-border p-4 rounded">
                <h4 className="font-medium text-text mb-3">When to Trust Each</h4>
                <ul className="text-sm text-text-dim space-y-1">
                  <li>• <strong className="text-text">Small samples (≤50 poss):</strong> Use projected</li>
                  <li>• <strong className="text-text">Medium samples (50-200):</strong> Blend both</li>
                  <li>• <strong className="text-text">Large samples (200+):</strong> Trust observed</li>
                </ul>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Defensive Impact Section */}
      <section className="mb-16">
        <h2 className="display text-2xl font-medium mb-6">Defensive Impact</h2>
        <div className="bg-surface border border-border p-8">
          <div className="mb-6">
            <div className="bg-yellow-500/10 border border-yellow-500/30 p-4 rounded">
              <h4 className="font-medium text-yellow-300 mb-2">Important Note</h4>
              <p className="text-sm text-yellow-200">
                This app does not have player-tracking or matchup-assignment data. Defensive stats measure observed impact and on-court results, not exact defensive assignments.
              </p>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
            <div className="space-y-6">
              <StatExplanation
                stat="DRAPM"
                meaning="Defensive impact in points per 100 possessions"
                why="Most reliable defensive metric. Adjusts for teammates and opponents to isolate individual impact."
              />
              <StatExplanation
                stat="On-court DRtg"
                meaning="Team defense when this player is on court"
                why="Shows what actually happened defensively. Lower is better. Good for seeing which players are on court for good or bad defense."
              />
              <StatExplanation
                stat="On/Off Defense"
                meaning="Team defense with player on court vs. off court"
                why="Measures defensive impact. Negative numbers are good (team allows fewer points with player on court)."
              />
            </div>
            <div className="space-y-6">
              <StatExplanation
                stat="Forced Turnover Rate"
                meaning="Opponent turnovers while player is on court"
                why="Measures disruptive defense. Includes steals, deflections, and pressure that leads to turnovers."
              />
              <StatExplanation
                stat="Individual Rates (per 40)"
                meaning="Steals, blocks, defensive rebounds, fouls per 40 minutes"
                why="Traditional defensive stats scaled for playing time. Good for seeing specific defensive skills and tendencies."
              />
            </div>
          </div>
        </div>
      </section>

      {/* Actual vs Expected Section */}
      <section className="mb-16">
        <h2 className="display text-2xl font-medium mb-6">Actual vs. Expected: Reading the Tea Leaves</h2>
        <div className="bg-surface border border-border p-8">
          <div className="mb-8">
            <CoachTakeaway>
              The gap between what happened and what should have happened tells you whether to expect improvement, regression, or more of the same.
            </CoachTakeaway>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
            <div className="space-y-4">
              <div className="bg-made/10 border border-made/30 p-4 rounded">
                <h4 className="font-medium text-made mb-2">Overperformance</h4>
                <p className="text-sm text-text-dim mb-2">Better results than expected process suggests</p>
                <ul className="text-sm text-text-dim space-y-1">
                  <li>• Making tough shots</li>
                  <li>• Getting lucky bounces</li>
                  <li>• Facing cold opponents</li>
                  <li>• May regress over time</li>
                </ul>
              </div>

              <div className="bg-missed/10 border border-missed/30 p-4 rounded">
                <h4 className="font-medium text-missed mb-2">Underperformance</h4>
                <p className="text-sm text-text-dim mb-2">Worse results than expected process suggests</p>
                <ul className="text-sm text-text-dim space-y-1">
                  <li>• Missing good looks</li>
                  <li>• Getting unlucky bounces</li>
                  <li>• Facing hot opponents</li>
                  <li>• May improve over time</li>
                </ul>
              </div>
            </div>

            <div className="space-y-4">
              <div className="bg-surface-2 border border-border p-4 rounded">
                <h4 className="font-medium text-text mb-3">Example Scenarios</h4>
                <div className="space-y-3 text-sm">
                  <div>
                    <p className="text-text font-medium">"Great lineup that's shooting poorly"</p>
                    <p className="text-text-dim">Strong expected numbers, weak actual numbers. Increase minutes.</p>
                  </div>
                  <div>
                    <p className="text-text font-medium">"Hot lineup with poor process"</p>
                    <p className="text-text-dim">Weak expected numbers, strong actual numbers. May want alternatives ready.</p>
                  </div>
                  <div>
                    <p className="text-text font-medium">"Consistently good"</p>
                    <p className="text-text-dim">Strong expected and actual numbers. Trust it.</p>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Practical Use Cases */}
      <section className="mb-16">
        <h2 className="display text-2xl font-medium mb-6">How I Would Use This</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <UseCase
            title="Preparing for an Opponent"
            description="Check their efficiency numbers, shot quality, and which lineups/players drive their success. Focus on their highest-RAPM players and most effective lineups."
          />
          <UseCase
            title="Choosing a Closing Lineup"
            description="Look for lineups with strong Net RAPM and good expected numbers, even if small samples. Avoid lineups riding hot shooting (high actual, low expected)."
          />
          <UseCase
            title="Finding Undervalued Players"
            description="Look for positive RAPM players with low minutes. Check if their expected numbers suggest they deserve more opportunities."
          />
          <UseCase
            title="Evaluating Transfers"
            description="Focus on RAPM and expected numbers rather than raw stats. A player with good impact metrics in a bad system may excel in your system."
          />
          <UseCase
            title="Identifying Shot-Quality Problems"
            description="Players with low xeFG% but decent actual shooting may struggle against better defenses. Work on shot selection and creation."
          />
          <UseCase
            title="Finding Defensive Lineups"
            description="Look for combinations of high-DRAPM players. Check on-court DRtg for lineups that actually stop teams, not just play slow."
          />
        </div>
      </section>

      {/* Final Summary */}
      <section className="mb-16">
        <div className="bg-accent/10 border border-accent/30 p-8 rounded">
          <h2 className="display text-2xl font-medium mb-4 text-accent">The Bottom Line</h2>
          <p className="text-lg leading-relaxed text-text-dim">
            The goal is not to replace coaching feel. The goal is to give coaches a cleaner way to separate noise from signal.
            Use these numbers to confirm what your eyes tell you, challenge your assumptions, and make decisions with more confidence.
          </p>
          <div className="mt-6 flex flex-wrap gap-3">
            <Link href="/teams" className="bg-accent text-bg px-4 py-2 rounded font-medium hover:bg-accent/90 transition-colors">
              Explore Teams
            </Link>
            <Link href="/players" className="border border-border px-4 py-2 rounded font-medium hover:bg-surface transition-colors">
              Browse Players
            </Link>
            <Link href="/impact" className="border border-border px-4 py-2 rounded font-medium hover:bg-surface transition-colors">
              View Impact Leaders
            </Link>
          </div>
        </div>
      </section>
    </main>
  );
}

function LayerCard({
  title,
  description,
  link,
  linkText,
}: {
  title: string;
  description: string;
  link: string;
  linkText: string;
}) {
  return (
    <div className="bg-surface-2 border border-border p-4 rounded">
      <h3 className="font-medium text-text mb-2">{title}</h3>
      <p className="text-sm text-text-dim mb-3">{description}</p>
      <Link href={link} className="text-accent text-sm hover:underline">
        {linkText} →
      </Link>
    </div>
  );
}

function CoachTakeaway({ children }: { children: React.ReactNode }) {
  return (
    <div className="bg-accent/10 border border-accent/30 p-4 rounded">
      <div className="mono text-[10px] uppercase tracking-widest text-accent mb-2">
        Coach Takeaway
      </div>
      <p className="text-text leading-relaxed">{children}</p>
    </div>
  );
}

function StatExplanation({
  stat,
  meaning,
  why,
}: {
  stat: string;
  meaning: string;
  why: string;
}) {
  return (
    <div>
      <h4 className="font-medium text-text mb-1">{stat}</h4>
      <p className="text-sm text-text-dim mb-2">{meaning}</p>
      <div className="mono text-[10px] uppercase tracking-widest text-accent mb-1">
        Why it matters
      </div>
      <p className="text-sm text-text-dim">{why}</p>
    </div>
  );
}

function UseCase({ title, description }: { title: string; description: string }) {
  return (
    <div className="bg-surface border border-border p-6">
      <h3 className="font-medium text-text mb-3">{title}</h3>
      <p className="text-sm text-text-dim leading-relaxed">{description}</p>
    </div>
  );
}