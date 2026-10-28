// Tests that open tables or write players run at noon Eastern, whatever the real time: from 23:55 until
// the new day opens the server turns new tables and names away (DATABASE.md, "The day"), which would fail
// them for five minutes every night. The clock still runs; it only starts at today's 12:00 America/New_York.
// Import it before anything else in the test file.
import { easternMinute } from '../js/util.js';

const RealDate = Date;
const OFFSET = (12 * 60 - easternMinute(RealDate.now())) * 60e3;
class NoonDate extends RealDate {
  constructor(...a) { if (a.length) super(...a); else super(RealDate.now() + OFFSET); }
  static now() { return RealDate.now() + OFFSET; }
}
globalThis.Date = NoonDate;
