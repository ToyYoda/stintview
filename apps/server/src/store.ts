import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import type { TeamCredentials } from '@stintview/protocol';

interface Member { name: string; tokenHash: string }
interface Team { id: string; name: string; inviteCode: string; members: Member[] }

export interface Identity { teamId: string; teamName: string; memberName: string }

const hash = (token: string) => createHash('sha256').update(token).digest('hex');

// Unambiguous characters only (no 0/O, 1/I/L).
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
function inviteCode() {
  const bytes = randomBytes(8);
  let code = '';
  for (let i = 0; i < 8; i++) code += CODE_ALPHABET[bytes[i]! % CODE_ALPHABET.length];
  return `${code.slice(0, 4)}-${code.slice(4)}`;
}

/** Teams and member tokens, persisted as a JSON file. Tokens are stored hashed. */
export class TeamStore {
  private teams: Team[] = [];

  constructor(private readonly file: string | null) {
    if (!file) return;
    try {
      this.teams = JSON.parse(readFileSync(file, 'utf8')).teams;
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e;
    }
  }

  createTeam(teamName: string, memberName: string): TeamCredentials {
    const team: Team = { id: randomUUID(), name: teamName, inviteCode: inviteCode(), members: [] };
    this.teams.push(team);
    return this.addMember(team, memberName);
  }

  join(code: string, memberName: string): TeamCredentials | null {
    const normalized = code.trim().toUpperCase();
    const team = this.teams.find((t) => t.inviteCode === normalized);
    return team ? this.addMember(team, memberName) : null;
  }

  authenticate(token: string): Identity | null {
    const h = hash(token);
    for (const team of this.teams) {
      const member = team.members.find((m) => m.tokenHash === h);
      if (member) return { teamId: team.id, teamName: team.name, memberName: member.name };
    }
    return null;
  }

  private addMember(team: Team, memberName: string): TeamCredentials {
    const token = randomBytes(32).toString('base64url');
    team.members.push({ name: memberName, tokenHash: hash(token) });
    this.save();
    return { teamId: team.id, teamName: team.name, memberName, inviteCode: team.inviteCode, token };
  }

  private save() {
    if (!this.file) return;
    mkdirSync(dirname(this.file), { recursive: true });
    const tmp = `${this.file}.tmp`;
    writeFileSync(tmp, JSON.stringify({ teams: this.teams }, null, 2));
    renameSync(tmp, this.file);
  }
}
