import { WEAPONS, type PrimaryId } from '../config/weapons';
import type { WeaponId } from '../sim/types';

export const PROFILE_KEY = 'stickfight.profile.v1';
export const ARMORY: { id: PrimaryId; price: number; role: string; description: string }[] = [
  { id: 'ar', price: 0, role: 'All-round rifle', description: 'Controlled bursts. Dependable at every lane.' },
  { id: 'sniper', price: 0, role: 'Bolt-action sniper', description: 'One chest hit. Make every chamber count.' },
  { id: 'smg', price: 350, role: '900 RPM runner', description: 'Fast feet, close fights. Loses damage at distance.' },
  { id: 'carbine', price: 500, role: 'Precision semi-auto', description: '43 chest damage. Accurate taps reward steady aim.' },
];
export const INKS = [
  { id: 'yellow', name: 'Original', color: 0xffd23f, price: 0 },
  { id: 'cyan', name: 'Blueprint', color: 0x22c6e0, price: 160 },
  { id: 'coral', name: 'Redline', color: 0xff715b, price: 220 },
  { id: 'mint', name: 'Fresh ink', color: 0x3ddc84, price: 220 },
] as const;
export interface ProfileData {
  version: 1;
  ink: number;
  xp: number;
  owned: PrimaryId[];
  inks: string[];
  equippedInk: string;
  mastery: Partial<Record<WeaponId, number>>;
  matches: number;
  wins: number;
  paidMatches: string[];
  daily: { date: string; kills: number; heads: number; objective: number; claimed: string[] };
}
export interface MatchReward {
  id: string; kills: number; headshots: number; objective: number; won: boolean;
  weaponKills: Partial<Record<WeaponId, number>>;
}
export interface RewardReceipt { ink: number; xp: number; contracts: string[]; won: boolean }
const count = (v: unknown, max = 1e9) => typeof v === 'number' && Number.isFinite(v) ? Math.max(0, Math.min(max, Math.floor(v))) : 0;
const day = () => new Date().toISOString().slice(0, 10);
const fresh = (): ProfileData => ({ version: 1, ink: 600, xp: 0, owned: ['ar', 'sniper'], inks: ['yellow'], equippedInk: 'yellow', mastery: {}, matches: 0, wins: 0, paidMatches: [], daily: { date: day(), kills: 0, heads: 0, objective: 0, claimed: [] } });
export const CONTRACTS = [
  { id: 'kills', label: 'Erase 10 rivals', field: 'kills', target: 10, reward: 100 },
  { id: 'heads', label: 'Land 5 headshot kills', field: 'heads', target: 5, reward: 120 },
  { id: 'objective', label: 'Hold the sketch for 30 points', field: 'objective', target: 30, reward: 140 },
] as const;

/** Local profile only. Future server must validate rewards and purchases; never trust client saves. */
export class Profile {
  data: ProfileData = fresh();
  storageAvailable = true;
  constructor(private storage: Pick<Storage, 'getItem' | 'setItem'> | null = typeof localStorage === 'undefined' ? null : localStorage) {
    try {
      const raw = storage?.getItem(PROFILE_KEY);
      if (raw) {
        const p = JSON.parse(raw);
        if (p && p.version === 1) {
          this.data.ink = count(p.ink);
          this.data.xp = count(p.xp);
          this.data.matches = count(p.matches);
          this.data.wins = count(p.wins);
          this.data.owned = ARMORY.filter(a => a.price === 0 || (Array.isArray(p.owned) && p.owned.includes(a.id))).map(a => a.id);
          this.data.inks = INKS.filter(a => a.price === 0 || (Array.isArray(p.inks) && p.inks.includes(a.id))).map(a => a.id);
          this.data.equippedInk = this.data.inks.includes(p.equippedInk) ? p.equippedInk : 'yellow';
          for (const id of Object.keys(WEAPONS) as WeaponId[]) this.data.mastery[id] = count(p.mastery?.[id]);
          this.data.paidMatches = Array.isArray(p.paidMatches) ? p.paidMatches.filter((id: unknown) => typeof id === 'string').slice(-64) : [];
          if (p.daily?.date === day()) this.data.daily = {
            date: day(), kills: count(p.daily.kills), heads: count(p.daily.heads), objective: count(p.daily.objective),
            claimed: CONTRACTS.filter(c => Array.isArray(p.daily.claimed) && p.daily.claimed.includes(c.id)).map(c => c.id),
          };
        }
      }
    } catch { this.storageAvailable = false; }
  }
  get level() { return 1 + Math.floor(this.data.xp / 500); }
  get color() { return INKS.find(i => i.id === this.data.equippedInk)!.color; }
  owns(id: PrimaryId) { return this.data.owned.includes(id); }
  save() {
    try { if (!this.storage) throw new Error('No storage'); this.storage.setItem(PROFILE_KEY, JSON.stringify(this.data)); this.storageAvailable = true; }
    catch { this.storageAvailable = false; }
  }
  refreshDay() { if (this.data.daily.date !== day()) this.data.daily = fresh().daily; }
  buyWeapon(id: PrimaryId): boolean {
    const item = ARMORY.find(i => i.id === id);
    if (!item || this.owns(id) || this.data.ink < item.price) return false;
    this.data.ink -= item.price;
    this.data.owned.push(id);
    this.save();
    return true;
  }
  selectInk(id: string): boolean {
    const item = INKS.find(i => i.id === id);
    if (!item) return false;
    if (!this.data.inks.includes(id)) {
      if (this.data.ink < item.price) return false;
      this.data.ink -= item.price;
      this.data.inks.push(id);
    }
    this.data.equippedInk = id;
    this.save();
    return true;
  }
  settle(r: MatchReward): RewardReceipt | null {
    if (!r.id || this.data.paidMatches.includes(r.id)) return null;
    this.refreshDay();
    const kills = count(r.kills, 500), heads = Math.min(kills, count(r.headshots, 500)), objective = count(r.objective, 600);
    let ink = 60 + kills * 8 + heads * 4 + Math.floor(objective / 3) + (r.won ? 60 : 0);
    const xp = 100 + kills * 20 + objective * 2 + (r.won ? 100 : 0);
    const d = this.data.daily;
    d.kills += kills; d.heads += heads; d.objective += objective;
    const contracts: string[] = [];
    for (const c of CONTRACTS) if (d[c.field] >= c.target && !d.claimed.includes(c.id)) {
      d.claimed.push(c.id); ink += c.reward; contracts.push(c.label);
    }
    this.data.ink += ink; this.data.xp += xp; this.data.matches++; if (r.won) this.data.wins++;
    let remaining = kills;
    for (const id of Object.keys(WEAPONS) as WeaponId[]) {
      const n = Math.min(remaining, count(r.weaponKills[id], 500));
      this.data.mastery[id] = (this.data.mastery[id] ?? 0) + n;
      remaining -= n;
    }
    this.data.paidMatches.push(r.id); this.data.paidMatches = this.data.paidMatches.slice(-64);
    this.save();
    return { ink, xp, contracts, won: r.won };
  }
}
