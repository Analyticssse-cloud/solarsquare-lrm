/* ── Action Center · Next-Day Driver ratios ───────────────────────────────────
   MEASURED cost of booking one meeting FOR TOMORROW, per city.

   WHY THIS EXISTS. msplan.js offers two bases and both are known-wrong for a
   next-day plan:
     * "Observed" divides today's dials by meetings booked today — but those
       dials also produce meetings for T+1/T+2, and the meetings already on a
       day's calendar were produced by EARLIER days' dials.
     * "Funnel" dodges that with assumed rates — 25% connect x 20% conv, i.e.
       1/(0.25 x 0.20) = 20 dials/meeting. An assumption, not a measurement.
   The next-day ratio measures it instead: dials on day D over meetings
   confirmed on D whose meeting_schedule_date is D+1 — both sides the same day's
   work, nothing leaking across days.

   WHAT IT DECOMPOSES INTO (v3 split, outbound-only, 2026-09-01 onward):
       3.4 dials per connect  x  7.2 connects per meeting  x  1.8 bookings
       per next-day booking  =  45.04 dials per next-day MS
   Read that carefully, because it overturns the obvious diagnosis: the floor
   converts CONVERSATIONS well — 13.9% of connects book a meeting, roughly
   7.2 conversations each. The loss is REACH: at a 29.2% connect rate,
   71% of dials never reach anyone. Reach is the binding constraint,
   not persuasion, and the ranked levers follow from that:
     connect rate 29% -> 40%   => 32.89 dials/MS  (-27%)
     next-day share 55% -> 70% => 35.15 dials/MS  (-22%)
     MS per connect +1pp       => 42.02 dials/MS  (-7%)

   ⚠ CONNECT DEFINITION — AN EARLIER VERSION OF THIS FILE WAS WRONG BY 2x,
   AND THE FIX IS PER CALL TYPE, not one global rule.
   OUTBOUND must use the strict list, payload_CustomerStatus IN
   ('answered','success','connected'): a regex test (any leg matching 'answer'
   but not 'not answer') counted 61,070 outbound connects where strict finds
   29,363 — a 59.9% connect rate against a documented ~31% baseline.
   INBOUND must NOT use that list. Inbound statuses are compound
   ('MaxDialTimeExceeded -> answered') and an equality test on 'answered' is
   documented in this repo to have reported 3 answered where the CDR showed 37,
   so the strict list collapses inbound connects toward zero. The regex was only
   ever wrong for outbound. sql/ms-driver-history-cluster-v4-strict.sql applies
   each test to its own direction and emits both as per-direction tripwires. That
   inflation made conversion look like the bottleneck (it read 14.5 connects per
   meeting instead of 7.2) and understated the reach problem. Inbound was NOT
   the cause: it is 4% of calls and moves the blended rate by 0.8pp. If a
   connect rate here ever prints near 60%, the loose test is back.

   WHEN TO USE THIS BASIS — AND WHEN NOT TO.
   A day's calendar is filled by MANY prior days of dialling. Two separate costs:
     * SUSTAINING a day at target — whole dial rate over whole calendar:
       26,553 dials/day against 1,117 meetings on each day's calendar
       = ~23.8 dials per meeting. The driver sheet's 22.17 is close to this,
       so the sheet was about right FOR CAPACITY PLANNING.
     * ADDING one more meeting to TOMORROW — only today's dials reach it, so it
       costs 45.04. A rescue/marginal number.
   THEREFORE apply this basis to the GAP (target minus what is already on the
   calendar), NEVER to a full day's target. msplan.js does the right thing — its
   math runs on MS Left — but multiplying 45.04 by a full 1,152 "proves" a need for
   ~52,000 dials/day against a real ~27,000. That is an artifact of pricing
   tomorrow as if its calendar were empty.

   LIMITS. Four days cannot carry a trend or a day-of-week coefficient.
   EXCLUDE ANY DAY WHOSE T+1 FALLS ON A NON-WORKING DAY: Mon 7 Sep was a
   week-off, so Sun 6 Sep had almost nothing to book for "tomorrow" —
   12,922 dials against 91 next-day meetings, a ratio of 142. A missing
   denominator, not low productivity; the floor pivoted to same-day booking
   (65% T+0 that day). Including 6 Sep moves the floor ratio
   45.04 -> 52.56; dropping it gives 46.14 on 4-5 Sep alone, within
   2% of the 2-5 figure, which is why 45.04 is kept. The ALL-MS ratio
   barely moves across those windows (24.6 / 24.78 / 25.81) because a closed
   Monday changes which day gets booked, not whether meetings get booked.

   A city needs 15+ next-day meetings in the window to use its own figure;
   below that it borrows the floor.
   ───────────────────────────────────────────────────────────────────────────── */
var MSDRIVER = {
  window: '2-5 Sep 2026',
  excluded: '6 Sep (Mon 7 was a week-off)',
  /* PER CALL TYPE — not one global rule. Outbound needs the strict IN-list;
     inbound statuses are compound and an equality test undercounts them badly. */
  connectRule: 'outbound: strict IN-list | inbound: compound-aware match',
  minT1: 15,
  org: { dials:45.04, conn:13.16, tt:19.53 },
  funnel: { connectRate:0.29, msPerConnect:0.14, t1Share:0.55 },
  sustainPerMS: 23.8,
  t1Share: 54.62,
  vsAvg: 1.83,
  city: {
    "Agra": { dials:26.98, conn:8.84, tt:13.33, t1:56 },
    "Ahmedabad": { dials:27.68, conn:8.45, tt:13.45, t1:76 },
    "Amravati": { dials:49.39, conn:14.22, tt:17.97, t1:36 },
    "Aurangabad": { dials:43.28, conn:11.34, tt:17.02, t1:53 },
    "Bangalore": { dials:28.33, conn:7.13, tt:7.71, t1:93 },
    "Bareilly": { dials:44.26, conn:12, tt:30.78, t1:19 },
    "Bhopal": { dials:52.63, conn:13.26, tt:21.66, t1:68 },
    "Chennai": { dials:29.58, conn:6.31, tt:8.99, t1:131 },
    "Coimbatore": { dials:41.93, conn:9.73, tt:10.07, t1:15 },
    "Delhi": { dials:28.2, conn:11.14, tt:18.34, t1:133 },
    "Gurgaon": { dials:24.64, conn:9.91, tt:12.2, t1:75 },
    "Gwalior": { dials:59.75, conn:15.63, tt:19.42, t1:57 },
    "Hyderabad": { dials:48.46, conn:14.42, tt:16.03, t1:79 },
    "Indore": { dials:33.28, conn:10.92, tt:15.95, t1:90 },
    "Jabalpur": { dials:89.53, conn:23.42, tt:34.31, t1:43 },
    "Jaipur": { dials:31.63, conn:9.79, tt:14.09, t1:200 },
    "Jalgaon": { dials:18.7, conn:6.04, tt:12.88, t1:23 },
    "Jodhpur": { dials:17.71, conn:4.64, tt:4.54, t1:28 },
    "Kanpur": { dials:49.78, conn:12.48, tt:20.54, t1:130 },
    "Kolhapur": { dials:31.79, conn:8.52, tt:11.79, t1:42 },
    "Kota": { dials:20.28, conn:6.93, tt:10.9, t1:29 },
    "Lucknow": { dials:46.67, conn:13.33, tt:18.51, t1:171 },
    "Meerut": { dials:17.65, conn:6.07, tt:12.93, t1:57 },
    "Nagpur": { dials:69.24, conn:18.56, tt:24.74, t1:199 },
    "Nashik": { dials:49.78, conn:12.89, tt:18.86, t1:80 },
    "Noida": { dials:53.24, conn:18.16, tt:26.79, t1:58 },
    "Pune": { dials:54.02, conn:17.67, tt:31.33, t1:207 },
    "Solapur": { dials:32.33, conn:10.2, tt:13.81, t1:15 },
    "Varanasi": { dials:66.09, conn:17.56, tt:17.51, t1:32 }
  }
};
function msDriverRatio(city){
  var c = MSDRIVER.city[city];
  if (c && c.t1 >= MSDRIVER.minT1) return { dials:c.dials, conn:c.conn, tt:c.tt, thin:false };
  return { dials:MSDRIVER.org.dials, conn:MSDRIVER.org.conn, tt:MSDRIVER.org.tt, thin:true };
}
