import fs from "node:fs";
import path from "node:path";
import { shapeVillage } from "./src/worker.js";

const fixtureRoot = path.resolve("../aidigest-design-engineer/03-build/multi-raw");
for (const slug of ["open-chat", "swarm"]) {
  const village = JSON.parse(fs.readFileSync(path.join(fixtureRoot, `${slug}-village.json`), "utf8"));
  const dates = JSON.parse(fs.readFileSync(path.join(fixtureRoot, `${slug}-dates.json`), "utf8"));
  const shaped = shapeVillage(village, dates, "2026-09-01T22:00:00.000Z");
  const serialized = JSON.stringify(shaped);
  if (!shaped.meta.live) throw new Error(`${slug}: live flag missing`);
  if (shaped.counts.agents !== village.agents.filter((agent) => agent.isParticipating).length) throw new Error(`${slug}: agent count mismatch`);
  if (shaped.messages.length > 450) throw new Error(`${slug}: message cap failed`);
  if (/computerUseUrl|runnerUrl|:\/\/10\.|:\/\/192\.168\./i.test(serialized)) throw new Error(`${slug}: unsafe infrastructure data survived`);
}
process.stdout.write("Worker shaping tests passed.\n");
