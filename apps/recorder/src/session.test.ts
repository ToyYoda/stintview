import { describe, expect, it } from 'vitest';
import { parseSessionYaml, quoteOddValues } from './session.ts';
import { parseSessionCars } from './spectator.ts';

// Shortened from real session info (.ibt files of 14.05. and 05.06.2026): one odd name made the
// whole YAML unreadable, so the session had no drivers at all.
const YAML = `---
WeekendInfo:
 TeamRacing: 1
DriverInfo:
 Drivers:
 - CarIdx: 21
   UserName: Marco Rossi
   AbbrevName: Rossi, M
   TeamName: - BLACKSUIT - Catteam Agency (ISRA)
   CarNumber: "35"
   CarNumberRaw: 35
   CarScreenName: Porsche 911 GT3 R (992)
 - CarIdx: 22
   UserName:
   AbbrevName:  ,
   TeamName: Bob: the builder
   CarNumber: "7"
   CarNumberRaw: 7
   LicColor: 0xfc0706
 - CarIdx: 23
   UserName: 'Mad' Max
   TeamName: 'Quoted Team'
   CarNumber: "-1"
   CarNumberRaw: -1
...
`;

describe('session info with odd names', () => {
  it('reads all drivers', () => {
    const cars = parseSessionCars(YAML);
    expect([...cars.drivers.keys()]).toEqual([21, 22, 23]);
    expect(cars.drivers.get(21)).toMatchObject({ name: 'Marco Rossi', team: '- BLACKSUIT - Catteam Agency (ISRA)', number: 35, label: '35' });
    expect(cars.drivers.get(22)).toMatchObject({ team: 'Bob: the builder', number: 7 });
    expect(cars.drivers.get(23)).toMatchObject({ name: "'Mad' Max", team: 'Quoted Team', number: -1 });
  });

  it('leaves valid values alone', () => {
    const ok = 'A:\n B: 12\n C: -0.5\n D: "x"\n E: plain text\n F: 0xfc0706\n';
    expect(quoteOddValues(ok)).toBe(ok);
    expect(parseSessionYaml<{ A: { C: number } }>(`${ok}`).A.C).toBe(-0.5);
  });
});
