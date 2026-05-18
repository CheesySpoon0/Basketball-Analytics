import 'dotenv/config';

async function main() {
  // ===== CBBD API DIAGNOSIS =====
  console.log('=== CBBD API: GET /teams?year=2026 (no conference filter) ===\n');
  const res = await fetch('https://api.collegebasketballdata.com/teams?year=2026', {
    headers: { Authorization: `Bearer ${process.env.CBBD_API_KEY}` },
  });
  console.log('Status:', res.status);
  const teams: any[] = await res.json();
  console.log('Total teams returned:', teams.length);
  console.log('\nFirst 3 teams (full shape):');
  console.log(JSON.stringify(teams.slice(0, 3), null, 2));

  console.log('\n=== Searching for Big West teams ===');
  const bigWest = teams.filter((t) => {
    const blob = JSON.stringify(t).toLowerCase();
    return blob.includes('uc irvine') || blob.includes('uc santa barbara') || blob.includes('big west');
  });
  console.log(`Found ${bigWest.length} candidate Big West teams:`);
  bigWest.forEach((t) => console.log(JSON.stringify(t, null, 2)));

  console.log('\n=== Unique conference values ===');
  const confs = new Set<string>();
  teams.forEach((t) => {
    if (t.conference) confs.add(t.conference);
  });
  console.log([...confs].sort().join('\n'));

  // ===== DATABASE URL DIAGNOSIS =====
  console.log('\n\n=== DATABASE URL Diagnosis ===');
  const mask = (url: string) => url.replace(/:([^:@]+)@/, ':***@');
  const dbUrl = process.env.DATABASE_URL || '';
  const directUrl = process.env.DIRECT_URL || '';
  console.log('DATABASE_URL:', mask(dbUrl));
  console.log('  port:', new URL(dbUrl).port, '| host:', new URL(dbUrl).hostname);
  console.log('DIRECT_URL: ', mask(directUrl));
  console.log('  port:', new URL(directUrl).port, '| host:', new URL(directUrl).hostname);
}

main().catch((e) => {
  console.error('ERROR:', e);
  process.exit(1);
});
