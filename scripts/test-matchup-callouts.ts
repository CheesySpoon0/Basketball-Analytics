import 'dotenv/config';
import { prisma } from '../lib/prisma';

async function testMatchupCallouts() {
  const SEASON = 2025;
  const UCI_TEAM_ID = 308;

  // Get UCSB's stats to test matchup
  const ucsb = await prisma.teamSeasonStats.findUnique({
    where: { teamId_season: { teamId: 311, season: SEASON } },
    include: { team: true }
  });

  const uci = await prisma.teamSeasonStats.findUnique({
    where: { teamId_season: { teamId: UCI_TEAM_ID, season: SEASON } },
    include: { team: true }
  });

  if (!ucsb || !uci) {
    console.log('Missing team data');
    return;
  }

  console.log('\n🏀 UCI vs UC Santa Barbara Matchup Test\n');

  // UCI offensive stats
  const uciFga = uci.fieldGoalsAttempted ?? 0;
  const uciTpa = uci.threePointsAttempted ?? 0;
  const uciTpm = uci.threePointsMade ?? 0;

  // UCSB defensive stats (what they allow)
  const ucsbOppTpa = ucsb.oppThreePointsAttempted ?? 0;
  const ucsbOppTpm = ucsb.oppThreePointsMade ?? 0;

  const uciThreePct = uciTpa > 0 ? uciTpm / uciTpa : null;
  const ucsbAllow3PtPct = ucsbOppTpa > 0 ? ucsbOppTpm / ucsbOppTpa : null;

  console.log(`UCI 3PT%: ${uciThreePct ? (uciThreePct * 100).toFixed(1) : 'N/A'}% (${uciTpm}/${uciTpa})`);
  console.log(`UCSB allows 3PT%: ${ucsbAllow3PtPct ? (ucsbAllow3PtPct * 100).toFixed(1) : 'N/A'}% (${ucsbOppTpm}/${ucsbOppTpa})`);

  if (uciThreePct && ucsbAllow3PtPct && uciThreePct > 0.33 && ucsbAllow3PtPct > 0.35) {
    console.log('✅ CALLOUT: Attack Their Perimeter Defense');
  } else {
    console.log('❌ No perimeter attack callout');
  }

  // Check FTR matchup
  const uciFtr = uciFga > 0 ? (uci.freeThrowsAttempted ?? 0) / uciFga : null;
  const ucsbAllowFtr = (ucsb.oppFieldGoalsAttempted ?? 0) > 0 ? (ucsb.oppFreeThrowsAttempted ?? 0) / (ucsb.oppFieldGoalsAttempted ?? 0) : null;

  console.log(`\nUCI FTR: ${uciFtr ? (uciFtr * 100).toFixed(1) : 'N/A'}%`);
  console.log(`UCSB allows FTR: ${ucsbAllowFtr ? (ucsbAllowFtr * 100).toFixed(1) : 'N/A'}%`);

  if (uciFtr && ucsbAllowFtr && uciFtr > 0.22 && ucsbAllowFtr > 0.25) {
    console.log('✅ CALLOUT: Get to the Line');
  } else {
    console.log('❌ No free throw callout');
  }

  await prisma.$disconnect();
}

testMatchupCallouts().catch(console.error);